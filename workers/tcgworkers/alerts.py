"""Admin alerts: operational problems an admin must hear about.

Queued as ``admin_alert`` emails to ADMIN_ALERT_EMAIL through the normal
outbox (so they get retries and logging too), deduplicated per ``key`` within
a window. Every alert is also logged at ERROR, which Sentry captures, so an
alert is never silent even when ADMIN_ALERT_EMAIL is unset.
"""

from __future__ import annotations

import json
import logging
import time
from datetime import timedelta
from typing import Any

import psycopg

log = logging.getLogger(__name__)

Conn = psycopg.Connection[dict[str, Any]]

DEFAULT_WINDOW = timedelta(hours=6)


def queue_admin_alert(
    conn: Conn,
    admin_email: str | None,
    *,
    key: str,
    title: str,
    body: str,
    details: dict[str, Any] | None = None,
    window: timedelta = DEFAULT_WINDOW,
) -> bool:
    """Queue (and commit) an admin alert unless one with ``key`` was queued
    within ``window``. Returns True when a new email was queued."""
    log.error("ADMIN ALERT [%s] %s: %s", key, title, body)
    if not admin_email:
        log.error("ADMIN_ALERT_EMAIL is not set; admin alert %s not emailed", key)
        return False
    # Serialise concurrent callers on the same key (runner threads, jobs).
    conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"admin_alert:{key}",))
    recent = conn.execute(
        """select 1 from public.email_outbox
            where template = 'admin_alert' and data ->> 'alert_key' = %s
              and created_at > now() - %s::interval
            limit 1""",
        (key, f"{int(window.total_seconds())} seconds"),
    ).fetchone()
    if recent:
        conn.commit()
        return False
    data = {"alert_key": key, "title": title, "body": body, "details": details or {}, "url": "/admin/"}
    conn.execute(
        """insert into public.email_outbox (user_id, to_email, template, data, dedupe_key)
           values (null, %s, 'admin_alert', %s::jsonb, %s)
           on conflict (dedupe_key) do nothing""",
        (admin_email, json.dumps(data, default=str), f"admin:{key}:{time.time_ns()}"),
    )
    conn.commit()
    return True
