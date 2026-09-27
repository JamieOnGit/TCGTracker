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


@dataclass(frozen=True)
class Env:
    database_url: str | None
    sentry_dsn: str | None
    user_agent: str
    psa_api_token: str | None
    psa_population_enabled: bool

    @classmethod
    def from_environ(cls, environ: dict[str, str] | None = None) -> Env:
        e = os.environ if environ is None else environ
        return cls(
            database_url=e.get("DATABASE_URL"),
            sentry_dsn=e.get("SENTRY_DSN"),
            # Identify ourselves honestly to every site we poll (brief 9.6).
            user_agent=e.get(
                "WORKER_USER_AGENT",
                "TCGDropBot/0.1 (+https://example.invalid/about/bot; contact: bot@example.invalid)",
            ),
            psa_api_token=e.get("PSA_API_TOKEN"),
            # Off until Jamie confirms a PSA licence allows commercial display.
            psa_population_enabled=e.get("PSA_POPULATION_ENABLED", "false").lower() == "true",
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
