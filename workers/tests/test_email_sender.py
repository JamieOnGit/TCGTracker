from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from tcgworkers.email.providers import EmailSendError, OutgoingEmail
from tcgworkers.email.sender import MAX_ATTEMPTS, OutboxRow, backoff, send_due

NOW = datetime(2026, 9, 28, 1, 0, tzinfo=UTC)
USER = "00000000-0000-0000-0000-000000000001"


@dataclass
class FakeOutbox:
    """In-memory OutboxStore mirroring PostgresOutboxStore's state machine."""

    rows: dict[int, dict[str, Any]] = field(default_factory=dict)
    prefs: dict[tuple[str, str], bool] = field(default_factory=dict)
    users_by_email: dict[str, str] = field(default_factory=dict)
    tokens: dict[tuple[str, str], str] = field(default_factory=dict)
    log: list[tuple[int, str, str | None]] = field(default_factory=list)
    alerts: list[tuple[str, str]] = field(default_factory=list)
    now: datetime = NOW

    def add(
        self, template: str, data: dict[str, Any] | None = None, user_id: str | None = USER, **kw: Any
    ) -> int:
        rid = len(self.rows) + 1
        self.rows[rid] = {
            "id": rid,
            "user_id": user_id,
            "to_email": kw.get("to_email", "ash@example.com"),
            "template": template,
            "data": data or {},
            "status": "queued",
            "attempts": 0,
            "send_after": kw.get("send_after", self.now),
            "last_error": None,
            "dedupe_key": None,
        }
        return rid

    def recover_stuck(self, older_than: timedelta) -> int:
        return 0

    def claim(self, limit: int) -> list[OutboxRow]:
        out = []
        for r in sorted(self.rows.values(), key=lambda r: r["id"]):
            if r["status"] == "queued" and r["send_after"] <= self.now and len(out) < limit:
                r["status"] = "sending"
                r["attempts"] += 1
                out.append(
                    OutboxRow(r["id"], r["user_id"], r["to_email"], r["template"], r["data"], r["attempts"])
                )
        return out

    def wants_email(self, user_id: str, alert_type: str) -> bool:
        return self.prefs.get((user_id, alert_type), True)

    def resolve_user(self, email: str) -> str | None:
        return self.users_by_email.get(email)

    def unsubscribe_token(self, user_id: str, alert_type: str) -> str:
        return self.tokens.setdefault((user_id, alert_type), f"tok-{alert_type}")

    def mark_sent(self, row: OutboxRow, provider_message_id: str) -> None:
        self.rows[row.id].update(status="sent", provider_message_id=provider_message_id)
        self.log.append((row.id, "sent", None))

    def mark_suppressed(self, row: OutboxRow, reason: str) -> None:
        self.rows[row.id].update(status="suppressed", last_error=reason)
        self.log.append((row.id, "suppressed", reason))

    def mark_retry(self, row: OutboxRow, error: str, send_after: datetime) -> None:
        self.rows[row.id].update(status="queued", last_error=error, send_after=send_after)
        self.log.append((row.id, "failed", error))

    def mark_failed(self, row: OutboxRow, error: str) -> None:
        self.rows[row.id].update(status="failed", last_error=error)
        self.log.append((row.id, "failed", error))

    def admin_alert(self, key: str, title: str, body: str, details: dict[str, Any]) -> bool:
        self.alerts.append((key, body))
        return True


@dataclass
class FakeProvider:
    fail_times: int = 0
    permanent: bool = False
    sent: list[OutgoingEmail] = field(default_factory=list)
    calls: int = 0
    name: str = "fake"

    def send(self, email: OutgoingEmail) -> str:
        self.calls += 1
        if self.calls <= self.fail_times:
            raise EmailSendError("provider down", permanent=self.permanent)
        self.sent.append(email)
        return f"id-{len(self.sent)}"


def test_sends_due_rows_with_unsubscribe_headers():
    store, provider = FakeOutbox(), FakeProvider()
    rid = store.add("message", {"title": "New message about Charizard", "body": "hi", "url": "/messages/1/"})
    result = send_due(store, provider, now=NOW)
    assert result.sent == 1 and store.rows[rid]["status"] == "sent"
    email = provider.sent[0]
    assert email.to == "ash@example.com" and email.subject == "New message about Charizard"
    assert email.headers["List-Unsubscribe"] == "<https://tcgtracker.com.au/unsubscribe/?t=tok-message>"
    assert email.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert "https://tcgtracker.com.au/unsubscribe/?t=tok-message" in email.text
    assert store.log == [(rid, "sent", None)]


def test_rows_not_yet_due_wait():
    store, provider = FakeOutbox(), FakeProvider()
    store.add("message", send_after=NOW + timedelta(minutes=10))
    assert send_due(store, provider, now=NOW).claimed == 0 and provider.calls == 0


def test_suppressed_when_member_turned_the_alert_off_after_queueing():
    store, provider = FakeOutbox(), FakeProvider()
    rid = store.add("wishlist", {"title": "Now listed"})
    store.prefs[(USER, "wishlist")] = False
    result = send_due(store, provider, now=NOW)
    assert result.suppressed == 1 and provider.calls == 0
    assert store.rows[rid]["status"] == "suppressed"
    assert store.log[0][1] == "suppressed"


def test_welcome_and_admin_alerts_ignore_alert_preferences():
    store, provider = FakeOutbox(), FakeProvider()
    store.prefs[(USER, "marketing")] = False
    store.add("welcome", {"username": "ash"})
    store.add("admin_alert", {"title": "x"}, user_id=None, to_email="admin@tcgtracker.com.au")
    assert send_due(store, provider, now=NOW).sent == 2


def test_admin_alerts_carry_no_unsubscribe_token():
    store, provider = FakeOutbox(), FakeProvider()
    store.users_by_email["admin@tcgtracker.com.au"] = "admin-id"
    store.add("admin_alert", {"title": "x"}, user_id=None, to_email="admin@tcgtracker.com.au")
    send_due(store, provider, now=NOW)
    assert "List-Unsubscribe" not in provider.sent[0].headers and not store.tokens
    assert "https://tcgtracker.com.au/account/settings/" in provider.sent[0].text


def test_member_email_without_user_id_is_matched_by_address():
    store, provider = FakeOutbox(), FakeProvider()
    store.users_by_email["ash@example.com"] = USER
    store.add("billing", {"kind": "receipt", "amount_aud": "12.99"}, user_id=None)
    send_due(store, provider, now=NOW)
    assert (
        provider.sent[0].headers["List-Unsubscribe"]
        == "<https://tcgtracker.com.au/unsubscribe/?t=tok-billing>"
    )


def test_transient_failure_backs_off_exponentially_then_succeeds():
    store, provider = FakeOutbox(), FakeProvider(fail_times=2)
    rid = store.add("drop", {"event_type": "IN_STOCK", "product_title": "ETB", "tier": "premium"})

    r1 = send_due(store, provider, now=NOW)
    assert r1.retried == 1 and store.rows[rid]["status"] == "queued"
    assert store.rows[rid]["send_after"] == NOW + timedelta(seconds=30)

    store.now = NOW + timedelta(seconds=10)
    assert send_due(store, provider, now=store.now).claimed == 0  # still backing off

    store.now = NOW + timedelta(seconds=30)
    send_due(store, provider, now=store.now)
    assert store.rows[rid]["send_after"] == store.now + timedelta(seconds=60)

    store.now += timedelta(seconds=60)
    r3 = send_due(store, provider, now=store.now)
    assert r3.sent == 1 and store.rows[rid]["status"] == "sent" and store.rows[rid]["attempts"] == 3
    assert [s for _, s, _ in store.log] == ["failed", "failed", "sent"]
    assert not store.alerts


def test_backoff_schedule():
    assert [backoff(n).total_seconds() for n in range(1, 8)] == [30, 60, 120, 240, 480, 960, 1920]
    assert backoff(20) == timedelta(hours=1)


def test_gives_up_after_six_retries_and_alerts_admin():
    store, provider = FakeOutbox(), FakeProvider(fail_times=100)
    rid = store.add("message", {"title": "hi"})
    for _ in range(20):
        store.now += timedelta(hours=2)
        send_due(store, provider, now=store.now)
    assert provider.calls == MAX_ATTEMPTS == 7  # the first try + 6 retries
    assert store.rows[rid]["status"] == "failed"
    assert len(store.alerts) == 1 and store.alerts[0][0] == "email-failed:message"


def test_permanent_failure_fails_immediately_and_alerts():
    store, provider = FakeOutbox(), FakeProvider(fail_times=1, permanent=True)
    rid = store.add("message", {"title": "hi"})
    result = send_due(store, provider, now=NOW)
    assert result.failed == 1 and store.rows[rid]["status"] == "failed" and provider.calls == 1
    assert store.alerts


def test_failed_admin_alert_never_alerts_about_itself():
    store, provider = FakeOutbox(), FakeProvider(fail_times=1, permanent=True)
    store.add("admin_alert", {"title": "x"}, user_id=None)
    send_due(store, provider, now=NOW)
    assert not store.alerts


def test_unknown_template_fails_without_crashing_the_batch():
    store, provider = FakeOutbox(), FakeProvider()
    bad = store.add("mystery", {})
    good = store.add("message", {"title": "hi"})
    result = send_due(store, provider, now=NOW)
    assert store.rows[bad]["status"] == "failed" and store.rows[good]["status"] == "sent"
    assert result.failed == 1 and result.sent == 1


def test_unexpected_exception_is_retried_not_lost():
    class Exploding(FakeOutbox):
        def unsubscribe_token(self, user_id: str, alert_type: str) -> str:
            raise RuntimeError("db hiccup")

    store, provider = Exploding(), FakeProvider()
    rid = store.add("message", {"title": "hi"})
    result = send_due(store, provider, now=NOW)
    assert result.retried == 1 and store.rows[rid]["status"] == "queued"
    assert "db hiccup" in store.rows[rid]["last_error"]


def test_rows_are_claimed_once():
    store, provider = FakeOutbox(), FakeProvider()
    store.add("message", {"title": "hi"})
    send_due(store, provider, now=NOW)
    send_due(store, provider, now=NOW)
    assert provider.calls == 1
