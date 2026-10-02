"""Runtime configuration.

Two kinds of configuration, deliberately kept apart:

* ``Env`` - deployment wiring and secrets, read from environment variables.
* ``Rules`` - business rules (thresholds, intervals, delays). These live in the
  ``site_settings`` table so an admin can change them without a deploy; the
  defaults here mirror the seed values in
  ``supabase/migrations/20260927000100_foundations.sql`` and are only used when
  the database is unreachable (tests, local runs).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, fields
from decimal import Decimal
from typing import Any


def _flag(value: str | None, default: bool = False) -> bool:
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


DEFAULT_SITE_URL = "https://tcgtracker.com.au"
DEFAULT_EMAIL_FROM = "TCGTracker <alerts@tcgtracker.com.au>"


@dataclass(frozen=True)
class Env:
    database_url: str | None
    sentry_dsn: str | None
    user_agent: str
    psa_api_token: str | None
    psa_population_enabled: bool
    site_url: str = DEFAULT_SITE_URL
    # Email delivery (tcgworkers.email). EMAIL_PROVIDER = resend | smtp.
    email_provider: str | None = None
    email_from: str | None = None
    resend_api_key: str | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_starttls: bool = True
    smtp_ssl: bool = False
    # Alert plumbing.
    discord_drops_webhook_url: str | None = None
    # Public Storage URLs (sighting photos in alerts): https://<ref>.supabase.co
    supabase_url: str | None = None
    # Web push (tcgworkers.drops.push). Both unset = push deliveries are skipped.
    vapid_private_key: str | None = None
    vapid_subject: str | None = None
    # eBay Browse API (tcgworkers.sources.ebay_deals), client-credentials OAuth.
    ebay_client_id: str | None = None
    ebay_client_secret: str | None = None
    admin_alert_email: str | None = None
    healthcheck_url: str | None = None
    # PriceCharting (tcgworkers.sources.pricing.pricecharting).
    # JustTCG (tcgworkers.sources.pricing.justtcg): the card price source.
    justtcg_api_key: str | None = None
    pricecharting_token: str | None = None
    pricecharting_csv_url_template: str | None = None

    @classmethod
    def from_environ(cls, environ: dict[str, str] | None = None) -> Env:
        e = os.environ if environ is None else environ
        smtp_ssl = _flag(e.get("SMTP_SSL"))
        return cls(
            database_url=e.get("DATABASE_URL"),
            sentry_dsn=e.get("SENTRY_DSN"),
            # Identify ourselves honestly to every site we poll (brief 9.6).
            user_agent=e.get(
                "WORKER_USER_AGENT",
                "TCGTrackerBot/1.0 (+https://tcgtracker.com.au/about/bot/; contact: hello@tcgtracker.com.au)",
            ),
            psa_api_token=e.get("PSA_API_TOKEN"),
            # Off until Jamie confirms a PSA licence allows commercial display.
            psa_population_enabled=e.get("PSA_POPULATION_ENABLED", "false").lower() == "true",
            site_url=(e.get("SITE_URL") or DEFAULT_SITE_URL).rstrip("/"),
            email_provider=(e.get("EMAIL_PROVIDER") or "").strip().lower() or None,
            email_from=e.get("EMAIL_FROM") or None,
            resend_api_key=e.get("RESEND_API_KEY") or None,
            smtp_host=e.get("SMTP_HOST") or None,
            smtp_port=int(e.get("SMTP_PORT") or (465 if smtp_ssl else 587)),
            smtp_username=e.get("SMTP_USERNAME") or None,
            smtp_password=e.get("SMTP_PASSWORD") or None,
            # Plain SMTP to a local catcher (Mailpit) has no TLS; SES needs it.
            smtp_starttls=_flag(e.get("SMTP_STARTTLS"), default=not smtp_ssl),
            smtp_ssl=smtp_ssl,
            discord_drops_webhook_url=e.get("DISCORD_DROPS_WEBHOOK_URL") or None,
            supabase_url=(e.get("SUPABASE_URL") or e.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
            or None,
            vapid_private_key=e.get("VAPID_PRIVATE_KEY") or None,
            vapid_subject=e.get("VAPID_SUBJECT") or None,
            ebay_client_id=e.get("EBAY_CLIENT_ID") or None,
            ebay_client_secret=e.get("EBAY_CLIENT_SECRET") or None,
            admin_alert_email=e.get("ADMIN_ALERT_EMAIL") or None,
            healthcheck_url=e.get("HEALTHCHECK_URL") or None,
            justtcg_api_key=e.get("JUSTTCG_API_KEY") or None,
            pricecharting_token=e.get("PRICECHARTING_TOKEN") or None,
            pricecharting_csv_url_template=e.get("PRICECHARTING_CSV_URL_TEMPLATE") or None,
        )


@dataclass(frozen=True)
class Rules:
    """Business rules, keyed like site_settings (dots become underscores)."""

    market_outlier_min_ratio: Decimal = Decimal("0.5")
    market_outlier_min_sales: int = 3
    market_floor_refresh_hours: int = 4
    market_population_refresh_hours: int = 24
    market_fx_refresh_hours: int = 24
    market_matcher_auto_accept: Decimal = Decimal("0.95")
    market_external_ask_max_age_days: int = 7
    drops_public_delay_minutes: int = 30
    drops_suppress_above_rrp_pct: Decimal = Decimal("50")
    drops_rrp_tolerance_pct: Decimal = Decimal("2")
    drops_zero_product_alert_cycles: int = 5
    drops_price_drop_pct: Decimal = Decimal("5")  # PRICE_CHANGE only for drops at least this big
    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_settings(cls, rows: dict[str, Any]) -> Rules:
        """Build from ``{key: value}`` as stored in site_settings."""
        kwargs: dict[str, Any] = {}
        known = {f.name: f for f in fields(cls) if f.name != "extra"}
        extra: dict[str, Any] = {}
        for key, value in rows.items():
            name = key.replace(".", "_")
            if name in known and value is not None:
                default = getattr(cls, name)
                kwargs[name] = (
                    type(default)(str(value)) if isinstance(default, Decimal) else type(default)(value)
                )
            else:
                extra[key] = value
        return cls(**kwargs, extra=extra)
