from __future__ import annotations

import json
from typing import Any

import pytest
import pywebpush

from tcgworkers.config import Env
from tcgworkers.drops.push import PushGone, PushSubscription, push_payload, sender_from_env, webpush_sender
from tcgworkers.jobs import registry
from tcgworkers.jobs.registry import JOBS
from tcgworkers.main import job_names

SUB = PushSubscription(1, "u1", "https://fcm.googleapis.com/fcm/send/abc", "key", "secret")


class _Response:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code
        self.text = "gone"


def _fake_webpush(calls: list[dict[str, Any]], status: int | None = None) -> Any:
    def webpush(**kwargs: Any) -> None:
        calls.append(kwargs)
        if status is not None:
            raise pywebpush.WebPushException("push failed", response=_Response(status))

    return webpush


def test_webpush_sender_sends_json_with_vapid(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict[str, Any]] = []
    monkeypatch.setattr(pywebpush, "webpush", _fake_webpush(calls))
    send = webpush_sender("PRIVATE", "mailto:hello@tcgtracker.com.au")
    send(SUB, push_payload("IN STOCK: ETB", "JB Hi-Fi · A$89.00", "/drops/", "drop-1"))
    send(SUB, push_payload("t", "b", "/", "x"))
    call = calls[0]
    assert call["subscription_info"] == {
        "endpoint": SUB.endpoint,
        "keys": {"p256dh": "key", "auth": "secret"},
    }
    assert json.loads(call["data"]) == {
        "title": "IN STOCK: ETB",
        "body": "JB Hi-Fi · A$89.00",
        "url": "/drops/",
        "tag": "drop-1",
    }
    assert call["vapid_private_key"] == "PRIVATE"
    assert call["vapid_claims"] == {"sub": "mailto:hello@tcgtracker.com.au"}
    assert calls[1]["vapid_claims"] is not call["vapid_claims"]  # pywebpush mutates it


@pytest.mark.parametrize("status", [404, 410])
def test_webpush_sender_maps_gone_subscriptions(monkeypatch: pytest.MonkeyPatch, status: int) -> None:
    monkeypatch.setattr(pywebpush, "webpush", _fake_webpush([], status))
    with pytest.raises(PushGone):
        webpush_sender("k", "mailto:x@example.com")(SUB, push_payload("t", "b", "/", "x"))


def test_webpush_sender_other_errors_are_retryable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(pywebpush, "webpush", _fake_webpush([], 500))
    with pytest.raises(RuntimeError, match="push HTTP 500"):
        webpush_sender("k", "mailto:x@example.com")(SUB, push_payload("t", "b", "/", "x"))


def test_push_payload_is_trimmed() -> None:
    p = push_payload("t" * 500, "b" * 500, "/drops/", "drop-1")
    assert len(p["title"]) == 120 and len(p["body"]) == 300


def test_push_needs_both_vapid_settings() -> None:
    assert sender_from_env(None, "mailto:x@example.com") is None
    assert sender_from_env("k", None) is None
    assert sender_from_env("k", "mailto:x@example.com") is not None
    env = Env.from_environ(
        {
            "VAPID_PRIVATE_KEY": "k",
            "VAPID_SUBJECT": "mailto:hello@tcgtracker.com.au",
            "SUPABASE_URL": "https://ref.supabase.co/",
        }
    )
    assert env.vapid_private_key == "k" and env.vapid_subject == "mailto:hello@tcgtracker.com.au"
    assert env.supabase_url == "https://ref.supabase.co"
    assert Env.from_environ({}).supabase_url is None


def test_sighting_and_release_jobs_are_registered() -> None:
    jobs = {j.name: j for j in JOBS}
    assert jobs["expire_sightings"].every_seconds == 300
    assert jobs["expire_sightings"].run is registry.expire_sightings
    release = jobs["release_reminders"]
    assert release.run is registry.send_release_reminders
    assert release.cron == {"hour": 8, "minute": 0, "timezone": "Australia/Sydney"}
    assert release.every_seconds is None
    assert {"expire_sightings", "release_reminders"} <= set(job_names())


def test_release_cron_schedules_at_8am_sydney() -> None:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    from apscheduler.triggers.cron import CronTrigger

    job = {j.name: j for j in JOBS}["release_reminders"]
    assert job.cron is not None
    trigger = CronTrigger(**job.cron)
    sydney = ZoneInfo("Australia/Sydney")
    nxt = trigger.get_next_fire_time(None, datetime(2026, 10, 1, 9, 0, tzinfo=sydney))
    assert nxt is not None
    assert nxt.astimezone(sydney).replace(tzinfo=None) == datetime(2026, 10, 2, 8, 0)


def test_pushes_go_to_every_device_at_once() -> None:
    import threading
    import time

    from tcgworkers.drops.dispatcher import send_pushes
    from tcgworkers.drops.push import PushGone, PushSubscription

    lock = threading.Lock()
    in_flight = peak = 0

    def sender(sub: PushSubscription, payload: dict) -> None:
        nonlocal in_flight, peak
        with lock:
            in_flight += 1
            peak = max(peak, in_flight)
        time.sleep(0.2)  # a slow push service
        with lock:
            in_flight -= 1
        if sub.id == 3:
            raise PushGone("410")
        if sub.id == 4:
            raise RuntimeError("503")

    subs = [PushSubscription(i, f"u{i}", f"https://fcm.googleapis.com/x{i}", "k", "a") for i in range(40)]
    started = time.monotonic()
    out = send_pushes(sender, [((100 + s.id, s.id), s, {"title": "t"}) for s in subs])
    elapsed = time.monotonic() - started
    assert elapsed < 1.0, f"40 devices took {elapsed:.2f}s: not sent in parallel"
    assert peak > 1
    assert isinstance(out[(103, 3)], PushGone) and isinstance(out[(104, 4)], RuntimeError)
    assert sum(e is None for e in out.values()) == 38


def test_a_woken_job_runs_at_once_and_still_polls(monkeypatch: pytest.MonkeyPatch) -> None:
    import threading
    import time

    from tcgworkers import main as worker_main
    from tcgworkers.config import Env
    from tcgworkers.health import Heartbeat
    from tcgworkers.jobs.registry import JOBS, Job

    runs: list[float] = []
    monkeypatch.setattr(worker_main, "_run", lambda job, env, hb=None: runs.append(time.monotonic()) or True)
    wake, stop = threading.Event(), threading.Event()
    job = Job("t", None, 0, lambda c, e: None, every_seconds=0.5, wake=wake)
    t = threading.Thread(
        target=worker_main._wakeable, args=(job, Env.from_environ({}), Heartbeat(), stop), daemon=True
    )
    t.start()
    time.sleep(0.05)
    woke = time.monotonic()
    wake.set()
    time.sleep(0.1)
    assert runs and runs[0] - woke < 0.1  # ran immediately, not after the 0.5 s poll
    time.sleep(0.6)
    assert len(runs) >= 2  # ...and keeps polling
    stop.set()
    wake.set()
    t.join(timeout=2)
    assert not t.is_alive()
    dispatch = next(j for j in JOBS if j.name == "drops_dispatch")
    assert dispatch.wake is not None and dispatch.every_seconds == 5
