"""Postgres access for the workers (service role - bypasses RLS).

Kept deliberately thin: SQL lives next to the job that runs it.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row

from tcgworkers.config import Rules


@contextmanager
def connect(database_url: str) -> Iterator[psycopg.Connection[dict[str, Any]]]:
    with psycopg.connect(database_url, row_factory=dict_row, autocommit=False) as conn:
        yield conn


def load_rules(conn: psycopg.Connection[dict[str, Any]]) -> Rules:
    rows = conn.execute("select key, value from public.site_settings").fetchall()
    return Rules.from_settings({r["key"]: r["value"] for r in rows})


@contextmanager
def pipeline_run(conn: psycopg.Connection[dict[str, Any]], job: str) -> Iterator[dict[str, Any]]:
    """Record a job run in pipeline_runs for the admin Market data screen."""
    run_id = conn.execute(
        "insert into public.pipeline_runs (job, status) values (%s, 'running') returning id", (job,)
    ).fetchone()
    conn.commit()
    stats: dict[str, Any] = {}
    try:
        yield stats
    except Exception as exc:
        conn.rollback()
        conn.execute(
            "update public.pipeline_runs set status='failed', finished_at=now(), error=%s, stats=%s where id=%s",
            (str(exc)[:2000], json.dumps(stats, default=str), run_id["id"] if run_id else None),
        )
        conn.commit()
        raise
    conn.execute(
        "update public.pipeline_runs set status='succeeded', finished_at=now(), stats=%s where id=%s",
        (json.dumps(stats, default=str), run_id["id"] if run_id else None),
    )
    conn.commit()
