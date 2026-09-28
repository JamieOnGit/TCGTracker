from __future__ import annotations

import json
import smtplib

import httpx
import pytest

from tcgworkers.config import Env
from tcgworkers.email.providers import (
    RESEND_URL,
    ConfigError,
    EmailSendError,
    OutgoingEmail,
    ResendProvider,
    SmtpProvider,
    provider_from_env,
)

EMAIL = OutgoingEmail(
    to="ash@example.com",
    subject="IN STOCK: ETB",
    html="<p>hi</p>",
    text="hi",
    headers={
        "List-Unsubscribe": "<https://tcgtrade.com.au/unsubscribe/?t=abc>",
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    idempotency_key="outbox-1-",
)


def _resend(handler):
    return ResendProvider("re_test", transport=httpx.MockTransport(handler))


def test_resend_sends_json_with_headers_and_idempotency_key():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["Authorization"]
        seen["idem"] = request.headers.get("Idempotency-Key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "msg_123"})

    assert _resend(handler).send(EMAIL) == "msg_123"
    assert seen["url"] == RESEND_URL
    assert seen["auth"] == "Bearer re_test"
    assert seen["idem"] == "outbox-1-"
    body = seen["body"]
    assert body["to"] == ["ash@example.com"] and body["text"] == "hi" and body["html"] == "<p>hi</p>"
    assert body["headers"]["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"


@pytest.mark.parametrize(
    ("status", "permanent"), [(422, True), (401, True), (429, False), (500, False), (503, False)]
)
def test_resend_errors_are_classified(status, permanent):
    provider = _resend(lambda r: httpx.Response(status, json={"message": "nope"}))
    with pytest.raises(EmailSendError) as info:
        provider.send(EMAIL)
    assert info.value.permanent is permanent


def test_resend_network_error_is_retryable():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    with pytest.raises(EmailSendError) as info:
        _resend(handler).send(EMAIL)
    assert not info.value.permanent


def test_smtp_message_has_both_parts_and_unsubscribe_headers():
    msg = SmtpProvider("localhost").build(EMAIL)
    assert msg["List-Unsubscribe"] == "<https://tcgtrade.com.au/unsubscribe/?t=abc>"
    assert msg["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert msg["Message-ID"].endswith("@tcgtrade.com.au>")
    types = [p.get_content_type() for p in msg.iter_parts()]
    assert types == ["text/plain", "text/html"]


def test_smtp_long_unsubscribe_header_is_not_encoded():
    # A real token URL is ~90 chars; the default 78-char policy RFC 2047-encodes
    # it, and Gmail then can't offer one-click unsubscribe.
    url = "https://tcgtrade.com.au/unsubscribe/?t=3x3fIxS6u_USBdeDo2Wo49qHvFssnwaAbi0nE4Z74K4"
    email = OutgoingEmail(**{**EMAIL.__dict__, "headers": {"List-Unsubscribe": f"<{url}>"}})
    raw = SmtpProvider("localhost").build(email).as_bytes()
    assert f"List-Unsubscribe: <{url}>\r\n".encode() in raw


def test_smtp_refused_recipient_is_permanent(monkeypatch):
    class FakeSMTP:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def send_message(self, msg):
            raise smtplib.SMTPRecipientsRefused({"ash@example.com": (550, b"no such user")})

    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    with pytest.raises(EmailSendError) as info:
        SmtpProvider("localhost", 25, starttls=False).send(EMAIL)
    assert info.value.permanent


def test_smtp_connection_refused_is_retryable():
    # Nothing listens on port 1.
    with pytest.raises(EmailSendError) as info:
        SmtpProvider("127.0.0.1", 1, starttls=False, timeout=2).send(EMAIL)
    assert not info.value.permanent


def test_provider_from_env():
    assert isinstance(
        provider_from_env(Env.from_environ({"EMAIL_PROVIDER": "resend", "RESEND_API_KEY": "k"})),
        ResendProvider,
    )
    smtp = provider_from_env(
        Env.from_environ(
            {
                "EMAIL_PROVIDER": "smtp",
                "SMTP_HOST": "127.0.0.1",
                "SMTP_PORT": "54325",
                "SMTP_STARTTLS": "false",
            }
        )
    )
    assert isinstance(smtp, SmtpProvider) and smtp.port == 54325 and not smtp.starttls
    ses = provider_from_env(
        Env.from_environ({"EMAIL_PROVIDER": "smtp", "SMTP_HOST": "email-smtp.ap-southeast-2.amazonaws.com"})
    )
    assert isinstance(ses, SmtpProvider) and ses.port == 587 and ses.starttls
    with pytest.raises(ConfigError):
        provider_from_env(Env.from_environ({"EMAIL_PROVIDER": "resend"}))
    with pytest.raises(ConfigError):
        provider_from_env(Env.from_environ({}))
    with pytest.raises(ConfigError):
        provider_from_env(Env.from_environ({"EMAIL_PROVIDER": "pigeon"}))
