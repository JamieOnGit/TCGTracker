"""Worker entrypoint: ``python -m tcgworkers.main`` (or ``--once <job>``).

One process runs everything (brief 11: an always-on host, not Vercel or
GitHub Actions, because drop polling is sub-5-minute):

* APScheduler jobs from ``jobs.registry.JOBS``: fx, population, prices,
  floors, snapshots, expiry, listing_expiring (hourly), email (every 20s),
  drops_dispatch (every 15s), expire_sightings (every 5 minutes), deals
  (eBay deal finder, every 30 minutes) and release_reminders (daily at
  08:00 Sydney time);
* the 24/7 drop monitor runner (``drops.runner``), one thread per enabled
  retailer, hot-reloading retailer config from the DB every 5 minutes;
* a heartbeat to HEALTHCHECK_URL every minute while all of the above are
  healthy (``<url>/fail`` with the reasons when they are not).

The big batch jobs (``Job.isolated``: prices, floors, images) run in a child
process, ``python -m tcgworkers.main --once <job>``, one at a time (a file
lock, which a manual ``fly ssh console`` run also takes). Their memory goes
back to the machine when they finish, they don't compete with the monitor
threads for Python's interpreter lock, and every ``--once`` process asks the
kernel to kill it first if memory runs out: the drop monitor and the alert
sender keep running whatever a batch job does.

``--once <job>`` runs one job and exits; ``--once drops_runner`` runs one
discovery cycle for every enabled retailer.
"""

from __future__ import annotations

import argparse
import fcntl
import logging
import os
import signal
import subprocess
import sys
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from types import FrameType
from typing import Any

from apscheduler.schedulers.blocking import BlockingScheduler

from tcgworkers.config import Env
from tcgworkers.db import connect, load_rules
from tcgworkers.health import Heartbeat, start_heartbeat
from tcgworkers.jobs.registry import JOBS, Job
from tcgworkers.sources.population.base import SourceNotApproved

log = logging.getLogger("tcgworkers")

RUNNER_JOB = "drops_runner"
# The project is shut down (Oct 2026): no job, monitor or alert runs, so no
# outside service is called and nothing is billed per use. Set to False (and
# redeploy) to bring everything back exactly as it was.
SHUT_DOWN = True
HEAVY_LOCK = "/tmp/tcgworkers-heavy.lock"
OOM_SCORE_ADJ = "/proc/self/oom_score_adj"


def _run(job: Job, env: Env, heartbeat: Heartbeat | None = None) -> bool:
    assert env.database_url, "DATABASE_URL is required"
    try:
        with connect(env.database_url) as conn:
            job.run(conn, env)
        if job.every_seconds is None:
            log.info("job %s ok", job.name)
        if heartbeat:
            heartbeat.beat(job.name)
        return True
    except SourceNotApproved as exc:
        log.info("job %s skipped: %s", job.name, exc)
        return True
    except Exception:
        log.exception("job %s failed", job.name)  # Sentry picks this up
        return False


def prefer_oom_kill(path: str = OOM_SCORE_ADJ) -> None:
    """If the machine runs out of memory, the kernel kills this process
    first (a process may always raise its own score), not the long-running
    one with the drop monitor in it."""
    try:
        with open(path, "w") as f:
            f.write("1000")
    except OSError:
        pass  # not Linux, or no /proc: nothing to do


@contextmanager
def heavy_lock(path: str = HEAVY_LOCK) -> Iterator[None]:
    """One big batch job at a time on this machine, scheduled or run by hand."""
    with open(path, "a+") as fh:
        try:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log.info("another big job (prices, floors or images) is running; waiting for it to finish")
            fcntl.flock(fh, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(fh, fcntl.LOCK_UN)


Spawn = Callable[[list[str]], int]


def _spawn(cmd: list[str]) -> int:
    # A batch job needs one database connection: cap the child at 2 so this
    # process (drop monitor, alerts) always keeps its share of the pooler's 15.
    env = {**os.environ, "DB_MAX_CONNECTIONS": "2"}
    return subprocess.run(cmd, check=False, env=env).returncode


def _run_isolated(job: Job, heartbeat: Heartbeat | None = None, spawn: Spawn = _spawn) -> bool:
    """Run a big job as ``python -m tcgworkers.main --once <job>`` and wait for it."""
    try:
        code = spawn([sys.executable, "-m", "tcgworkers.main", "--once", job.name])
    except OSError:
        log.exception("job %s: could not start its process", job.name)
        return False
    if code != 0:
        why = " (killed: the machine ran out of memory?)" if code in (-9, 137) else ""
        log.error("job %s failed with exit code %s%s", job.name, code, why)
        return False
    if heartbeat:
        heartbeat.beat(job.name)
    return True


def _scheduled(job: Job, env: Env, heartbeat: Heartbeat) -> bool:
    return _run_isolated(job, heartbeat) if job.isolated else _run(job, env, heartbeat)


def last_successes(conn: Any) -> dict[str, datetime]:
    """When each job last succeeded (pipeline_runs)."""
    rows = conn.execute(
        """select job, max(finished_at) as finished_at from public.pipeline_runs
            where status = 'succeeded' and finished_at is not null group by job"""
    ).fetchall()
    return {r["job"]: r["finished_at"] for r in rows}


def job_hours(job: Job, rules: Any) -> float:
    hours = job.every_hours_default
    if job.every_hours_setting:
        hours = float(getattr(rules, job.every_hours_setting.replace(".", "_"), hours))
    return hours


CATCH_UP_START = timedelta(minutes=2)
CATCH_UP_GAP = timedelta(minutes=3)


def first_runs(
    hours_of: dict[str, float], last_ok: dict[str, datetime], now: datetime
) -> dict[str, datetime]:
    """Each interval job's first run: its last success plus its interval. A job
    that is overdue (or never succeeded) runs a couple of minutes after start,
    overdue jobs a few minutes apart in their registry order (prices before
    floors before snapshots), so a restart never delays them by a whole interval."""
    out: dict[str, datetime] = {}
    overdue = 0
    for name, hours in hours_of.items():
        last = last_ok.get(name)
        due = last + timedelta(hours=hours) if last else None
        if due is None or due <= now + CATCH_UP_START:
            out[name] = now + CATCH_UP_START + overdue * CATCH_UP_GAP
            overdue += 1
        else:
            out[name] = due
    return out


def _wakeable(job: Job, env: Env, heartbeat: Heartbeat, stop: threading.Event) -> None:
    """A job that runs the moment its event is set, else every ``every_seconds``."""
    assert job.wake is not None
    while not stop.is_set():
        job.wake.wait(timeout=job.every_seconds or 15)
        job.wake.clear()  # a wake-up during this run triggers the next one at once
        if stop.is_set():
            return
        _run(job, env, heartbeat)


def job_names() -> list[str]:
    return [j.name for j in JOBS] + [RUNNER_JOB]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tcgworkers")
    parser.add_argument(
        "--once", metavar="JOB", choices=job_names(), help="run one job now and exit: %(choices)s"
    )
    parser.add_argument(
        "--no-runner", action="store_true", help="scheduler only; don't start the drop monitors"
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if SHUT_DOWN:
        log.info("TCGTracker is shut down: no jobs or drop monitors run (tcgworkers.main.SHUT_DOWN)")
        return 0
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("apscheduler.executors.default").setLevel(logging.WARNING)

    env = Env.from_environ()
    if env.sentry_dsn:
        import sentry_sdk

        sentry_sdk.init(dsn=env.sentry_dsn, traces_sample_rate=0.05)
    if not env.database_url:
        log.error("DATABASE_URL is not set")
        return 2

    jobs = {j.name: j for j in JOBS}
    if args.once == RUNNER_JOB:
        prefer_oom_kill()
        from tcgworkers.drops.runner import run_all_once

        results = run_all_once(env.database_url, user_agent=env.user_agent, admin_email=env.admin_alert_email)
        for slug, outcome in results.items():
            log.info("%s: %s", slug, outcome)
        return 0 if all(o.startswith("ok") for o in results.values()) else 1
    if args.once:
        prefer_oom_kill()
        job = jobs[args.once]
        if job.isolated:
            with heavy_lock():
                return 0 if _run(job, env) else 1
        return 0 if _run(job, env) else 1

    heartbeat = Heartbeat()
    stop = threading.Event()

    with connect(env.database_url) as conn:
        rules = load_rules(conn)
        last_ok = last_successes(conn)
    now = datetime.now(UTC)
    hours_of = {
        j.name: job_hours(j, rules) for j in JOBS if not j.cron and not j.wake and not j.every_seconds
    }
    starts = first_runs(hours_of, last_ok, now)
    scheduler = BlockingScheduler(timezone="Australia/Melbourne")
    for job in JOBS:
        if job.cron:
            scheduler.add_job(
                _scheduled,
                "cron",
                args=(job, env, heartbeat),
                id=job.name,
                name=job.name,
                max_instances=1,
                coalesce=True,
                misfire_grace_time=3600,
                **job.cron,
            )
        elif job.wake is not None:
            threading.Thread(
                target=_wakeable, args=(job, env, heartbeat, stop), name=job.name, daemon=True
            ).start()
        elif job.every_seconds:
            scheduler.add_job(
                _scheduled,
                "interval",
                seconds=job.every_seconds,
                args=(job, env, heartbeat),
                id=job.name,
                name=job.name,
                max_instances=1,
                coalesce=True,
                misfire_grace_time=int(job.every_seconds * 2),
            )
        else:
            scheduler.add_job(
                _scheduled,
                "interval",
                hours=hours_of[job.name],
                args=(job, env, heartbeat),
                id=job.name,
                name=job.name,
                max_instances=1,
                coalesce=True,
                jitter=60,
                # From its last success, not from this restart: frequent deploys
                # must not keep pushing a 4-hourly or daily job back forever.
                next_run_time=starts[job.name],
            )
        if job.heartbeat_max_age:
            heartbeat.expect(job.name, job.heartbeat_max_age)

    runner = None
    if not args.no_runner:
        from tcgworkers.drops.runner import build_runner

        runner = build_runner(env.database_url, user_agent=env.user_agent, admin_email=env.admin_alert_email)
        runner.start()
        heartbeat.add_check(RUNNER_JOB, runner.problem)
    start_heartbeat(env.healthcheck_url, heartbeat, stop)

    def shutdown(signum: int, frame: FrameType | None) -> None:
        log.info("signal %s: shutting down", signum)
        stop.set()
        scheduler.shutdown(wait=False)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    log.info("scheduling %s%s", ", ".join(jobs), "" if args.no_runner else " + drop runner")
    try:
        scheduler.start()
    finally:
        stop.set()
        if runner:
            runner.stop(timeout=20)
    return 0


if __name__ == "__main__":
    sys.exit(main())
