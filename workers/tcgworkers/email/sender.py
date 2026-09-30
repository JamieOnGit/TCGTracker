"""Outbox sender: delivers ``public.email_outbox`` rows (runs every 20s).

1. Rows stuck in ``sending`` (the worker died mid-send) go back to the queue.
2. Due rows (``queued`` and ``send_after <= now()``) are claimed with
   ``FOR UPDATE SKIP LOCKED`` and flipped to ``sending`` in one statement, so
   two workers can never send the same row.
3. Each row is re-checked against the member's notification preferences (a
   member may have switched the alert off after it was queued) -> ``suppressed``.
4. Otherwise it is rendered, given a one-click unsubscribe token and sent.
   Success -> ``sent``. Failure -> back to ``queued`` with exponential back-off
   (30s, 1m, 2m, 4m, 8m, 16m); after the first try plus 6 retries, or on a
   permanent error, -> ``failed`` and an admin alert is queued.

Every outcome is written to ``public.email_log``. The logic works against the
``OutboxStore`` protocol; ``PostgresOutboxStore`` is the production store.
"""

from __future__ import annotations

import logging
import secrets
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

import psycopg

from tcgworkers.alerts import queue_admin_alert
from tcgworkers.config import DEFAULT_EMAIL_FROM, DEFAULT_SITE_URL
from tcgworkers.email.providers import EmailProvider, EmailSendError, OutgoingEmail
from tcgworkers.email.templates import (
    PREFERENCE_TYPE,
    UNSUBSCRIBE_TYPE,
    RenderContext,
    UnknownTemplate,
    render,
)

log = logging.getLogger(__name__)

Conn = psycopg.Connection[dict[str, Any]]

MAX_ATTEMPTS = 7  # the first try + 6 retries
BASE_BACKOFF_SECONDS = 30
MAX_BACKOFF_SECONDS = 3600
STUCK_AFTER = timedelta(minutes=10)
BATCH_SIZE = 50


def backoff(attempts: int) -> timedelta:
    """Delay before the next try after ``attempts`` failed tries (1-based)."""
    return timedelta(seconds=min(BASE_BACKOFF_SECONDS * 2 ** max(attempts - 1, 0), MAX_BACKOFF_SECONDS))


@dataclass(frozen=True)
class OutboxRow:
    id: int
    user_id: str | None
    to_email: str
    template: str
    data: dict[str, Any]
    attempts: int  # including the attempt now being made
    dedupe_key: str | None = None


class OutboxStore(Protocol):
    def recover_stuck(self, older_than: timedelta) -> int: ...
    def claim(self, limit: int) -> list[OutboxRow]: ...
    def wants_email(self, user_id: str, alert_type: str) -> bool: ...
    def resolve_user(self, email: str) -> str | None: ...
    def unsubscribe_token(self, user_id: str, alert_type: str) -> str: ...
    def mark_sent(self, row: OutboxRow, provider_message_id: str) -> None: ...
    def mark_suppressed(self, row: OutboxRow, reason: str) -> None: ...
    def mark_retry(self, row: OutboxRow, error: str, send_after: datetime) -> None: ...
    def mark_failed(self, row: OutboxRow, error: str) -> None: ...
    def admin_alert(self, key: str, title: str, body: str, details: dict[str, Any]) -> bool: ...


@dataclass
class SendResult:
    sent: int = 0
    retried: int = 0
    failed: int = 0
    suppressed: int = 0
    recovered: int = 0
    errors: list[str] = field(default_factory=list)

    @property
    def claimed(self) -> int:
        return self.sent + self.retried + self.failed + self.suppressed


def build_email(
    row: OutboxRow, *, site_url: str, from_addr: str, unsubscribe_token: str | None
) -> OutgoingEmail:
    ctx = RenderContext(site_url=site_url, unsubscribe_token=unsubscribe_token)
    rendered = render(row.template, row.data, ctx)
    headers: dict[str, str] = {"X-TCGTracker-Template": row.template}
    if ctx.unsubscribe_url:
        # RFC 8058 one-click unsubscribe (Gmail/Yahoo bulk-sender requirement).
        headers["List-Unsubscribe"] = f"<{ctx.unsubscribe_url}>"
        headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    return OutgoingEmail(
        to=row.to_email,
        subject=rendered.subject,
        html=rendered.html,
        text=rendered.text,
        from_addr=from_addr,
        headers=headers,
        idempotency_key=f"outbox-{row.id}-{row.dedupe_key or ''}",
    )


def send_due(
    store: OutboxStore,
    provider: EmailProvider,
    *,
    site_url: str = DEFAULT_SITE_URL,
    from_addr: str = DEFAULT_EMAIL_FROM,
    now: datetime | None = None,
    limit: int = BATCH_SIZE,
) -> SendResult:
    result = SendResult()
    result.recovered = store.recover_stuck(STUCK_AFTER)
    if result.recovered:
        log.warning("email: %d rows were stuck in 'sending'; re-queued", result.recovered)
    for row in store.claim(limit):
        _send_one(store, provider, row, result, site_url=site_url, from_addr=from_addr, now=now)
    if result.claimed:
        log.info(
            "email: sent=%d retry=%d failed=%d suppressed=%d",
            result.sent,
            result.retried,
            result.failed,
            result.suppressed,
        )
    return result


def _send_one(
    store: OutboxStore,
    provider: EmailProvider,
    row: OutboxRow,
    result: SendResult,
    *,
    site_url: str,
    from_addr: str,
    now: datetime | None,
) -> None:
    try:
        user_id = row.user_id
        pref = PREFERENCE_TYPE.get(row.template)
        if user_id and pref and not store.wants_email(user_id, pref):
            store.mark_suppressed(row, f"member turned off {pref} emails")
            result.suppressed += 1
            return
        token = None
        unsubscribe_type = UNSUBSCRIBE_TYPE.get(row.template)
        if user_id is None and unsubscribe_type:
            user_id = store.resolve_user(row.to_email)
        if user_id and unsubscribe_type:
            token = store.unsubscribe_token(user_id, unsubscribe_type)
        email = build_email(row, site_url=site_url, from_addr=from_addr, unsubscribe_token=token)
        message_id = provider.send(email)
    except (EmailSendError, UnknownTemplate) as exc:
        permanent = isinstance(exc, UnknownTemplate) or exc.permanent
        _failure(store, row, result, f"{type(exc).__name__}: {exc}", permanent=permanent, now=now)
        return
    except Exception as exc:  # a bug or bad data must not stop the rest of the batch
        log.exception("email: unexpected error sending outbox row %s", row.id)
        _failure(store, row, result, f"{type(exc).__name__}: {exc}", permanent=False, now=now)
        return
    store.mark_sent(row, message_id)
    result.sent += 1


def _failure(
    store: OutboxStore,
    row: OutboxRow,
    result: SendResult,
    error: str,
    *,
    permanent: bool,
    now: datetime | None,
) -> None:
    error = error[:1000]
    result.errors.append(f"{row.id}: {error}")
    if not permanent and row.attempts < MAX_ATTEMPTS:
        when = (now or datetime.now(UTC)) + backoff(row.attempts)
        log.warning(
            "email %s (%s) attempt %d failed, retrying at %s: %s",
            row.id,
            row.template,
            row.attempts,
            when,
            error,
        )
        store.mark_retry(row, error, when)
        result.retried += 1
        return
    log.error("email %s (%s) FAILED after %d attempts: %s", row.id, row.template, row.attempts, error)
    store.mark_failed(row, error)
    result.failed += 1
    if row.template != "admin_alert":  # never alert about a failed alert (no loops)
        store.admin_alert(
            f"email-failed:{row.template}",
            f"{row.template} email failed permanently",
            f"Outbox row {row.id} to {row.to_email} failed after {row.attempts} attempt(s): {error}",
            {"outbox_id": row.id, "template": row.template, "attempts": row.attempts, "error": error},
        )


# ------------------------------------------------------------------ postgres
class PostgresOutboxStore:
    """``OutboxStore`` on public.email_outbox / email_log / unsubscribe_tokens.
    Commits after every state change so progress survives a crash."""

    def __init__(self, conn: Conn, *, admin_email: str | None = None) -> None:
        self.conn = conn
        self.admin_email = admin_email

    def from_address(self, override: str | None = None) -> str:
        if override:
            return override
        row = self.conn.execute("select public.setting_text('email.from') as v").fetchone()
        self.conn.commit()
        return str(row["v"]) if row and row["v"] else DEFAULT_EMAIL_FROM

    def recover_stuck(self, older_than: timedelta) -> int:
        # send_after is set to the claim time, so it doubles as "sending since".
        cur = self.conn.execute(
            """update public.email_outbox set status = 'queued', last_error = 'worker stopped mid-send; re-queued'
                where status = 'sending' and send_after < now() - %s::interval""",
            (f"{int(older_than.total_seconds())} seconds",),
        )
        self.conn.commit()
        return cur.rowcount

    def claim(self, limit: int) -> list[OutboxRow]:
        rows = self.conn.execute(
            """update public.email_outbox o
                  set status = 'sending', attempts = o.attempts + 1, send_after = now()
                where o.id in (
                  select id from public.email_outbox
                   where status = 'queued' and send_after <= now()
                   order by send_after, id
                   limit %s
                   for update skip locked)
            returning o.id, o.user_id::text as user_id, o.to_email, o.template, o.data, o.attempts, o.dedupe_key""",
            (limit,),
        ).fetchall()
        self.conn.commit()
        return [
            OutboxRow(
                id=r["id"],
                user_id=r["user_id"],
                to_email=r["to_email"],
                template=r["template"],
                data=dict(r["data"] or {}),
                attempts=r["attempts"],
                dedupe_key=r["dedupe_key"],
            )
            for r in sorted(rows, key=lambda r: r["id"])
        ]

    def wants_email(self, user_id: str, alert_type: str) -> bool:
        row = self.conn.execute(
            "select public.wants_notification(%s::uuid, %s, 'email') as ok", (user_id, alert_type)
        ).fetchone()
        self.conn.commit()
        return bool(row and row["ok"])

    def resolve_user(self, email: str) -> str | None:
        try:
            with self.conn.transaction():
                row = self.conn.execute(
                    "select id::text as id from auth.users where lower(email) = lower(%s) limit 1", (email,)
                ).fetchone()
        except psycopg.Error:
            return None
        finally:
            self.conn.commit()
        return row["id"] if row else None

    def unsubscribe_token(self, user_id: str, alert_type: str) -> str:
        row = self.conn.execute(
            """select token from public.unsubscribe_tokens
                where user_id = %s and alert_type = %s and used_at is null
                order by created_at desc limit 1""",
            (user_id, alert_type),
        ).fetchone()
        if row:
            self.conn.commit()
            return str(row["token"])
        token = secrets.token_urlsafe(32)
        self.conn.rollback()  # every earlier step committed; clear any aborted statement
        self.conn.rollback()  # every earlier step committed; clear any aborted statement
        self.conn.execute(
            "insert into public.unsubscribe_tokens (token, user_id, alert_type) values (%s, %s, %s)",
            (token, user_id, alert_type),
        )
        self.conn.commit()
        return token

    def _log(
        self, row: OutboxRow, status: str, *, message_id: str | None = None, error: str | None = None
    ) -> None:
        # Only the final 'sent' row carries the dedupe key (email_log.dedupe_key is unique).
        self.conn.execute(
            """insert into public.email_log (user_id, template, to_email, provider_message_id, status, dedupe_key, error)
               values (%s, %s, %s, %s, %s, %s, %s)
               on conflict (dedupe_key) do nothing""",
            (
                row.user_id,
                row.template,
                row.to_email,
                message_id,
                status,
                f"outbox:{row.id}" if status == "sent" else None,
                error,
            ),
        )

    def mark_sent(self, row: OutboxRow, provider_message_id: str) -> None:
        self.conn.execute(
            """update public.email_outbox set status = 'sent', sent_at = now(), provider_message_id = %s,
                 last_error = null where id = %s""",
            (provider_message_id, row.id),
        )
        self._log(row, "sent", message_id=provider_message_id)
        self.conn.commit()

    def mark_suppressed(self, row: OutboxRow, reason: str) -> None:
        self.conn.execute(
            "update public.email_outbox set status = 'suppressed', last_error = %s where id = %s",
            (reason, row.id),
        )
        self._log(row, "suppressed", error=reason)
        self.conn.commit()

    def mark_retry(self, row: OutboxRow, error: str, send_after: datetime) -> None:
        self.conn.execute(
            "update public.email_outbox set status = 'queued', last_error = %s, send_after = %s where id = %s",
            (error, send_after, row.id),
        )
        self._log(row, "failed", error=f"attempt {row.attempts}/{MAX_ATTEMPTS}, will retry: {error}")
        self.conn.commit()

    def mark_failed(self, row: OutboxRow, error: str) -> None:
        self.conn.execute(
            "update public.email_outbox set status = 'failed', last_error = %s where id = %s", (error, row.id)
        )
        self._log(row, "failed", error=f"gave up after attempt {row.attempts}: {error}")
        self.conn.commit()

    def admin_alert(self, key: str, title: str, body: str, details: dict[str, Any]) -> bool:
        return queue_admin_alert(
            self.conn, self.admin_email, key=key, title=title, body=body, details=details
        )


def run_sender(
    conn: Conn,
    provider: EmailProvider,
    *,
    site_url: str,
    from_override: str | None,
    admin_email: str | None,
    limit: int = BATCH_SIZE,
) -> SendResult:
    store = PostgresOutboxStore(conn, admin_email=admin_email)
    return send_due(
        store, provider, site_url=site_url, from_addr=store.from_address(from_override), limit=limit
    )
