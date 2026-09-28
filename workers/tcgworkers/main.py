"""Worker entrypoint: ``python -m tcgworkers.main`` (or ``--once <job>``).

One process runs everything (brief 11: an always-on host, not Vercel or
GitHub Actions, because drop polling is sub-5-minute):

* APScheduler jobs from ``jobs.registry.JOBS``: fx, population, prices,
  floors, snapshots, expiry, listing_expiring (hourly), email (every 20s) and
  drops_dispatch (every 15s);
* the 24/7 drop monitor runner (``drops.runner``), one thread per enabled
  retailer, hot-reloading retailer config from the DB every 5 minutes;
* a heartbeat to HEALTHCHECK_URL every minute while all of the above are
  healthy (``<url>/fail`` with the reasons when they are not).

``--once <job>`` runs one job and exits; ``--once drops_runner`` runs one
discovery cycle for every enabled retailer.
"""

from __future__ import annotations

import argparse
import logging
import signal
import sys
import threading
from types import FrameType

from apscheduler.schedulers.blocking import BlockingScheduler

from tcgworkers.config import Env
from tcgworkers.db import connect, load_rules
from tcgworkers.health import Heartbeat, start_heartbeat
from tcgworkers.jobs.registry import JOBS, Job
from tcgworkers.sources.population.base import SourceNotApproved

log = logging.getLogger("tcgworkers")

RUNNER_JOB = "drops_runner"


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
        from tcgworkers.drops.runner import run_all_once

        results = run_all_once(env.database_url, user_agent=env.user_agent, admin_email=env.admin_alert_email)
        for slug, outcome in results.items():
            log.info("%s: %s", slug, outcome)
        return 0 if all(o.startswith("ok") for o in results.values()) else 1
    if args.once:
        return 0 if _run(jobs[args.once], env) else 1

    heartbeat = Heartbeat()
    stop = threading.Event()

    with connect(env.database_url) as conn:
        rules = load_rules(conn)
    scheduler = BlockingScheduler(timezone="Australia/Melbourne")
    for job in JOBS:
        if job.every_seconds:
            scheduler.add_job(
                _run,
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
            hours = job.every_hours_default
            if job.every_hours_setting:
                hours = float(getattr(rules, job.every_hours_setting.replace(".", "_"), hours))
            scheduler.add_job(
                _run,
                "interval",
                hours=hours,
                args=(job, env, heartbeat),
                id=job.name,
                name=job.name,
                max_instances=1,
                coalesce=True,
                jitter=60,
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
