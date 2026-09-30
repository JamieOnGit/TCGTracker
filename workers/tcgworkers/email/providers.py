"""Email providers.

Two interchangeable implementations behind ``EmailProvider``:

* ``ResendProvider`` - Resend's HTTPS API (production default).
* ``SmtpProvider``  - plain SMTP: Mailpit locally (127.0.0.1:54325) or AWS SES
  SMTP (email-smtp.ap-southeast-2.amazonaws.com:587, STARTTLS).

Chosen with ``EMAIL_PROVIDER=resend|smtp``. A provider either returns the
provider's message id or raises ``EmailSendError``; ``permanent=True`` means
retrying cannot help (bad address, rejected payload, bad credentials).
"""

from __future__ import annotations

import smtplib
import ssl
from dataclasses import dataclass, field
from email import policy as email_policy
from email.message import EmailMessage as MimeMessage
from email.utils import formatdate, make_msgid
from typing import Protocol

import httpx

from tcgworkers.config import DEFAULT_EMAIL_FROM, Env

RESEND_URL = "https://api.resend.com/emails"

# RFC 5322 allows 998-char lines. The default 78 makes Python RFC 2047-encode
# long unbreakable headers such as List-Unsubscribe, which mail clients then
# can't use for one-click unsubscribe.
MIME_POLICY = email_policy.SMTP.clone(max_line_length=998)


@dataclass(frozen=True)
class OutgoingEmail:
    to: str
    subject: str
    html: str
    text: str
    from_addr: str = DEFAULT_EMAIL_FROM
    headers: dict[str, str] = field(default_factory=dict)
    # Makes provider retries safe: Resend drops a repeat with the same key.
    idempotency_key: str | None = None
    reply_to: str | None = None


class EmailSendError(RuntimeError):
    def __init__(self, message: str, *, permanent: bool = False) -> None:
        super().__init__(message)
        self.permanent = permanent


class ConfigError(RuntimeError):
    """The email provider is not configured."""


class EmailProvider(Protocol):
    name: str

    def send(self, email: OutgoingEmail) -> str:
        """Send and return the provider's message id; raise EmailSendError."""
        ...


@dataclass
class ResendProvider:
    api_key: str
    transport: httpx.BaseTransport | None = None
    timeout: float = 20.0
    name: str = "resend"

    def __post_init__(self) -> None:
        self._http = httpx.Client(timeout=self.timeout, transport=self.transport)

    def send(self, email: OutgoingEmail) -> str:
        payload: dict[str, object] = {
            "from": email.from_addr,
            "to": [email.to],
            "subject": email.subject,
            "html": email.html,
            "text": email.text,
        }
        if email.headers:
            payload["headers"] = dict(email.headers)
        if email.reply_to:
            payload["reply_to"] = email.reply_to
        headers = {"Authorization": f"Bearer {self.api_key}"}
        if email.idempotency_key:
            headers["Idempotency-Key"] = email.idempotency_key[:256]
        try:
            r = self._http.post(RESEND_URL, json=payload, headers=headers)
        except httpx.HTTPError as exc:  # network trouble: try again later
            raise EmailSendError(f"resend: {type(exc).__name__}: {exc}") from exc
        if r.status_code >= 400:
            # 429 and 5xx are transient; other 4xx mean the request itself is bad.
            permanent = r.status_code < 500 and r.status_code not in (408, 409, 429)
            raise EmailSendError(f"resend HTTP {r.status_code}: {r.text[:500]}", permanent=permanent)
        try:
            message_id = str(r.json().get("id") or "")
        except ValueError:
            message_id = ""
        if not message_id:
            raise EmailSendError(f"resend: no message id in response: {r.text[:200]}")
        return message_id


@dataclass
class SmtpProvider:
    host: str
    port: int = 587
    username: str | None = None
    password: str | None = None
    starttls: bool = True
    use_ssl: bool = False
    timeout: float = 20.0
    name: str = "smtp"

    def build(self, email: OutgoingEmail) -> MimeMessage:
        msg = MimeMessage(policy=MIME_POLICY)
        msg["From"] = email.from_addr
        msg["To"] = email.to
        msg["Subject"] = email.subject
        msg["Date"] = formatdate(localtime=False)
        domain = email.from_addr.rsplit("@", 1)[-1].strip(" >") or "tcgtracker.com.au"
        msg["Message-ID"] = make_msgid(domain=domain)
        if email.reply_to:
            msg["Reply-To"] = email.reply_to
        for key, value in email.headers.items():
            msg[key] = value
        msg.set_content(email.text)
        msg.add_alternative(email.html, subtype="html")
        return msg

    def send(self, email: OutgoingEmail) -> str:
        msg = self.build(email)
        try:
            smtp: smtplib.SMTP
            if self.use_ssl:
                smtp = smtplib.SMTP_SSL(
                    self.host, self.port, timeout=self.timeout, context=ssl.create_default_context()
                )
            else:
                smtp = smtplib.SMTP(self.host, self.port, timeout=self.timeout)
            with smtp:
                if self.starttls and not self.use_ssl:
                    smtp.starttls(context=ssl.create_default_context())
                if self.username:
                    smtp.login(self.username, self.password or "")
                smtp.send_message(msg)
        except (smtplib.SMTPRecipientsRefused, smtplib.SMTPSenderRefused) as exc:
            raise EmailSendError(f"smtp refused: {exc}", permanent=True) from exc
        except smtplib.SMTPAuthenticationError as exc:
            # Bad credentials are a config problem: keep retrying so nothing is
            # lost once fixed, and the admin alert fires after the last attempt.
            raise EmailSendError(f"smtp auth failed: {exc}") from exc
        except smtplib.SMTPResponseException as exc:
            permanent = 500 <= exc.smtp_code < 600
            raise EmailSendError(f"smtp {exc.smtp_code}: {exc.smtp_error!r}", permanent=permanent) from exc
        except (smtplib.SMTPException, OSError) as exc:
            raise EmailSendError(f"smtp: {type(exc).__name__}: {exc}") from exc
        return str(msg["Message-ID"])


def provider_from_env(env: Env) -> EmailProvider:
    """EMAIL_PROVIDER picks the provider; without it, whichever is configured."""
    choice = env.email_provider or ("resend" if env.resend_api_key else "smtp" if env.smtp_host else None)
    if choice == "resend":
        if not env.resend_api_key:
            raise ConfigError("EMAIL_PROVIDER=resend but RESEND_API_KEY is not set")
        return ResendProvider(env.resend_api_key)
    if choice == "smtp":
        if not env.smtp_host:
            raise ConfigError("EMAIL_PROVIDER=smtp but SMTP_HOST is not set")
        return SmtpProvider(
            env.smtp_host,
            env.smtp_port,
            env.smtp_username,
            env.smtp_password,
            starttls=env.smtp_starttls,
            use_ssl=env.smtp_ssl,
        )
    if choice is None:
        raise ConfigError("no email provider configured: set EMAIL_PROVIDER and RESEND_API_KEY or SMTP_HOST")
    raise ConfigError(f"unknown EMAIL_PROVIDER {choice!r} (expected resend or smtp)")
