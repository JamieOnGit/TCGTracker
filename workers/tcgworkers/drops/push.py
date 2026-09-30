"""Web push for drop alerts (``drop_alert_deliveries.channel = 'push'``).

A member can subscribe several browsers / phones (``push_subscriptions``);
one push delivery is sent to every one of them with the same payload
``{title, body, url, tag}`` that the site's service worker shows. The tag is
per drop event, so a device never stacks two notifications for one drop.

Outcomes per subscription:

* 2xx          -> ``last_success_at`` = now, ``failures`` reset;
* 404 / 410    -> the browser dropped the subscription: the row is deleted;
* anything else -> ``failures`` + 1 and the delivery goes down the normal
  retry / back-off path (unless another device already got it).

VAPID keys come from ``VAPID_PRIVATE_KEY`` / ``VAPID_SUBJECT`` (the public
half is the web app's ``NEXT_PUBLIC_VAPID_PUBLIC_KEY``). Without them push
deliveries are skipped, not retried.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

# Seconds a push service keeps an undelivered message (phone offline). A drop
# alert older than this is stale anyway.
PUSH_TTL_SECONDS = 6 * 3600


@dataclass(frozen=True)
class PushSubscription:
    id: int
    user_id: str
    endpoint: str
    p256dh: str
    auth: str


class PushGone(Exception):
    """The push service says the subscription no longer exists (404/410)."""


# Sends one payload to one subscription; raises PushGone or any other error.
PushSender = Callable[[PushSubscription, dict[str, Any]], None]


def push_payload(title: str, body: str, url: str, tag: str) -> dict[str, Any]:
    # Push services cap the encrypted payload at 4 KB; keep well under it.
    return {"title": title[:120], "body": body[:300], "url": url, "tag": tag}


def webpush_sender(private_key: str, subject: str, *, ttl: int = PUSH_TTL_SECONDS) -> PushSender:
    """A ``PushSender`` backed by pywebpush (VAPID, aes128gcm)."""
    from pywebpush import WebPushException, webpush

    def send(sub: PushSubscription, payload: dict[str, Any]) -> None:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=json.dumps(payload, ensure_ascii=False),
                vapid_private_key=private_key,
                vapid_claims={"sub": subject},  # pywebpush adds aud/exp to this dict: fresh each call
                ttl=ttl,
                timeout=10,
                headers={"Urgency": "high"},
            )
        except WebPushException as exc:
            status = getattr(exc.response, "status_code", None)
            if status in (404, 410):
                raise PushGone(f"push HTTP {status}") from exc
            raise RuntimeError(f"push HTTP {status}: {str(exc)[:300]}") from exc

    return send


def sender_from_env(private_key: str | None, subject: str | None) -> PushSender | None:
    if not private_key or not subject:
        return None
    return webpush_sender(private_key, subject)
