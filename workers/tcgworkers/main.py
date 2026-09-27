"""Worker entrypoint: ``python -m tcgworkers.main`` (or ``--once <job>``).

Runs on an always-on host (Railway / Fly.io / a VPS), not Vercel or GitHub
Actions, because drop polling is sub-5-minute (brief 11).
"""

from __future__ import annotations

import argparse
import logging
import sys

from apscheduler.schedulers.blocking import BlockingScheduler

from tcgworkers.config import Env
from tcgworkers.db import connect, load_rules
from tcgworkers.jobs.registry import JOBS, Job
from tcgworkers.sources.population.base import SourceNotApproved

log = logging.getLogger("tcgworkers")


def _run(job: Job, env: Env) -> None:
    assert env.database_url, "DATABASE_URL is required"
    try:
        with connect(env.database_url) as conn:
            job.run(conn, env.user_agent)
        log.info("job %s ok", job.name)
    except SourceNotApproved as exc:
        log.info("job %s skipped: %s", job.name, exc)
    except Exception:
        log.exception("job %s failed", job.name)  # Sentry picks this up


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", metavar="JOB", help="run one job now and exit")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

    env = Env.from_environ()
    if env.sentry_dsn:
        import sentry_sdk

        sentry_sdk.init(dsn=env.sentry_dsn, traces_sample_rate=0.05)
    if not env.database_url:
        log.error("DATABASE_URL is not set")
        return 2

    jobs = {j.name: j for j in JOBS}
    if args.once:
        _run(jobs[args.once], env)
        return 0

    with connect(env.database_url) as conn:
        rules = load_rules(conn)
    scheduler = BlockingScheduler(timezone="Australia/Melbourne")
    for job in JOBS:
        hours = job.every_hours_default
        if job.every_hours_setting:
            hours = float(getattr(rules, job.every_hours_setting.replace(".", "_"), hours))
        scheduler.add_job(
            _run,
            "interval",
            hours=hours,
            args=(job, env),
            id=job.name,
            max_instances=1,
            coalesce=True,
            jitter=60,
        )
    log.info("scheduling %s", ", ".join(jobs))
    scheduler.start()
    return 0


if __name__ == "__main__":
    sys.exit(main())
