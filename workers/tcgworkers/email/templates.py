"""Email templates for every ``email_outbox.template`` value.

Each template turns the outbox row's ``data`` into a list of simple blocks;
one layout renders those blocks as HTML (inline CSS, 560px, TCG Trade
colours) and as the plain-text part, so both always carry the same content.

Every email carries (Spam Act 2003, Gmail/Yahoo bulk-sender rules):
* sender identification - TCG Trade, Australia;
* a link to the notification preferences centre;
* a one-click unsubscribe link for that alert type (the sender adds the
  matching List-Unsubscribe / List-Unsubscribe-Post headers).

Templates never raise on a missing field: they fall back to the generic
``title`` / ``body`` / ``url`` that ``public.notify()`` always stores.
"""

from __future__ import annotations

import html
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urljoin, urlsplit
from zoneinfo import ZoneInfo

from tcgworkers.config import DEFAULT_SITE_URL
from tcgworkers.drops import rrp as rrp_mod
from tcgworkers.drops.models import RrpTag

BRAND = "TCG Trade"
TIMEZONE = ZoneInfo("Australia/Melbourne")
PREFERENCES_PATH = "/account/settings/"
UNSUBSCRIBE_PATH = "/unsubscribe/"
PREMIUM_PATH = "/premium/"

TEMPLATES: tuple[str, ...] = (
    "message",
    "listing_status",
    "listing_expiring",
    "wishlist",
    "saved_search",
    "drop",
    "billing",
    "admin_alert",
    "welcome",
)

# notification_preferences.alert_type checked at send time (None = always send:
# the member did not opt into these, they are part of having an account).
PREFERENCE_TYPE: dict[str, str | None] = {
    "message": "message",
    "listing_status": "listing_status",
    "listing_expiring": "listing_expiring",
    "wishlist": "wishlist",
    "saved_search": "saved_search",
    "drop": "drop",
    "billing": "billing",
    "admin_alert": None,
    "welcome": None,
}

# alert_type written on the unsubscribe token (what one click turns off).
UNSUBSCRIBE_TYPE: dict[str, str] = {
    "message": "message",
    "listing_status": "listing_status",
    "listing_expiring": "listing_expiring",
    "wishlist": "wishlist",
    "saved_search": "saved_search",
    "drop": "drop",
    "billing": "billing",
    "admin_alert": "admin_alert",
    "welcome": "marketing",
}

_UNSUBSCRIBE_LABEL: dict[str, str] = {
    "message": "new-message emails",
    "listing_status": "listing status emails",
    "listing_expiring": "listing expiry reminders",
    "wishlist": "wishlist alerts",
    "saved_search": "saved-search alerts",
    "drop": "retail drop alert emails",
    "billing": "billing emails",
    "admin_alert": "admin alert emails",
    "welcome": "marketing emails",
}

EVENT_LABELS: dict[str, str] = {
    "IN_STOCK": "IN STOCK",
    "PREORDER_OPEN": "PRE-ORDER OPEN",
    "NEW_LISTING": "NEW LISTING",
    "PRICE_CHANGE": "PRICE CHANGE",
    "QUEUE_LIVE": "QUEUE LIVE",
}

FREE_DELAY_LINE = "You're seeing this 24 hours after Premium members. Upgrade for instant alerts: {url}"

# Palette / type (docs/research/05-design-review.md direction).
BG = "#F7F5F0"
INK = "#1C1B19"
MUTED = "#6B675F"
RULE = "#E4E0D6"
CARD = "#FFFFFF"
SERIF = "'Cormorant Garamond', Georgia, serif"
SANS = "Inter, Arial, sans-serif"


class UnknownTemplate(ValueError):
    pass


@dataclass(frozen=True)
class RenderContext:
    site_url: str = DEFAULT_SITE_URL
    unsubscribe_token: str | None = None

    @property
    def preferences_url(self) -> str:
        return self.site_url.rstrip("/") + PREFERENCES_PATH

    @property
    def unsubscribe_url(self) -> str | None:
        if not self.unsubscribe_token:
            return None
        return f"{self.site_url.rstrip('/')}{UNSUBSCRIBE_PATH}?t={self.unsubscribe_token}"


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    html: str
    text: str
    preheader: str = ""


# ----------------------------------------------------------------- helpers
def format_aud(value: Any) -> str:
    """A$ with thousands separators and 2 decimals; '—' when unknown."""
    if value is None or value == "":
        return "—"
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return "—"
    if not amount.is_finite():
        return "—"
    sign = "-" if amount < 0 else ""
    return f"{sign}A${abs(amount):,.2f}"


def format_when(value: Any) -> str:
    """'Fri 3 Oct 2026, 9:05 am AEST' in Melbourne time."""
    if value is None or value == "":
        return ""
    if isinstance(value, datetime):
        dt = value
    else:
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return str(value)
    if dt.tzinfo is None:
        return dt.strftime("%a %d %b %Y")
    local = dt.astimezone(TIMEZONE)
    hour = local.hour % 12 or 12
    ampm = "am" if local.hour < 12 else "pm"
    return f"{local:%a} {local.day} {local:%b %Y}, {hour}:{local:%M} {ampm} {local.tzname()}"


def absolute_url(site_url: str, url: Any, fallback: str = "/") -> str:
    """Relative site paths become absolute; only http(s) links pass through."""
    raw = str(url or "").strip() or fallback
    parts = urlsplit(raw)
    if parts.scheme in ("http", "https") and parts.netloc:
        return raw
    if parts.scheme or parts.netloc:  # javascript:, mailto:, //host - never linked
        raw = fallback
    return urljoin(site_url.rstrip("/") + "/", raw.lstrip("/"))


def _one_line(text: Any, limit: int = 200) -> str:
    s = " ".join(str(text or "").split())
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def rrp_label(tag: Any, delta: Any) -> str | None:
    try:
        t = RrpTag(str(tag)) if tag else RrpTag.UNKNOWN
    except ValueError:
        return None
    if t is RrpTag.UNKNOWN:
        return None
    d: Decimal | None
    try:
        d = Decimal(str(delta)) if delta not in (None, "") else None
    except InvalidOperation:
        d = None
    return rrp_mod.label(t, d)


# ------------------------------------------------------------------ blocks
# ("h", text) heading · ("p", text) paragraph · ("quote", text) · ("tags", [..])
# ("rows", [(label, value)]) · ("button", label, url) · ("note", text)
Block = tuple[Any, ...]


def _html_block(b: Block) -> str:
    kind = b[0]
    e = html.escape
    if kind == "h":
        return (
            f'<h1 style="margin:0 0 16px;font-family:{SERIF};font-weight:600;font-size:28px;'
            f'line-height:1.2;color:{INK};">{e(b[1])}</h1>'
        )
    if kind == "p":
        return f'<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:{INK};">{e(b[1])}</p>'
    if kind == "quote":
        return (
            f'<p style="margin:0 0 16px;padding:12px 16px;border-left:3px solid {INK};background:{BG};'
            f'font-size:15px;line-height:1.6;color:{INK};">{e(b[1])}</p>'
        )
    if kind == "tags":
        chips = "".join(
            f'<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 8px;border:1px solid {INK};'
            f'font-size:11px;font-weight:700;letter-spacing:0.06em;color:{INK};">{e(t)}</span>'
            for t in b[1]
        )
        return f'<p style="margin:0 0 12px;">{chips}</p>'
    if kind == "rows":
        rows = "".join(
            f'<tr><td style="padding:6px 0;border-bottom:1px solid {RULE};font-size:13px;color:{MUTED};'
            f'width:40%;">{e(k)}</td><td style="padding:6px 0;border-bottom:1px solid {RULE};font-size:14px;'
            f'color:{INK};text-align:right;">{e(v)}</td></tr>'
            for k, v in b[1]
        )
        return (
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'style="margin:0 0 20px;border-collapse:collapse;">{rows}</table>'
        )
    if kind == "button":
        return (
            f'<p style="margin:8px 0 24px;"><a href="{e(b[2], quote=True)}" style="display:inline-block;'
            f"padding:12px 22px;background:{INK};color:{BG};text-decoration:none;font-size:14px;"
            f'font-weight:600;border-radius:4px;">{e(b[1])}</a></p>'
        )
    if kind == "note":
        return f'<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:{MUTED};">{e(b[1])}</p>'
    raise ValueError(f"unknown block {kind!r}")


def _text_block(b: Block) -> str:
    kind = b[0]
    if kind == "h":
        return f"{b[1]}\n{'=' * min(len(str(b[1])), 60)}"
    if kind in ("p", "note"):
        return str(b[1])
    if kind == "quote":
        return "\n".join(f"> {line}" for line in str(b[1]).splitlines() or [""])
    if kind == "tags":
        return " ".join(f"[{t}]" for t in b[1])
    if kind == "rows":
        return "\n".join(f"{k}: {v}" for k, v in b[1])
    if kind == "button":
        return f"{b[1]}: {b[2]}"
    raise ValueError(f"unknown block {kind!r}")


def _footer(ctx: RenderContext, template: str, reason: str) -> tuple[str, str]:
    e = html.escape
    label = _UNSUBSCRIBE_LABEL.get(template, "these emails")
    unsub = ctx.unsubscribe_url
    site = ctx.site_url.rstrip("/")
    lines_text = [
        reason,
        f"Notification preferences: {ctx.preferences_url}",
    ]
    link = f"color:{MUTED};text-decoration:underline;"
    parts_html = [
        e(reason),
        f'<a href="{e(ctx.preferences_url, quote=True)}" style="{link}">Notification preferences</a>',
    ]
    if unsub:
        lines_text.append(f"Unsubscribe from {label} (one click): {unsub}")
        parts_html[-1] += (
            f' &middot; <a href="{e(unsub, quote=True)}" style="{link}">Unsubscribe from {e(label)}</a>'
        )
    sender = f"{BRAND}, Australia · {site}"
    lines_text.append(sender)
    disclaimer = f"{BRAND} is independent and not affiliated with The Pokémon Company, Nintendo, Bandai or any retailer."
    lines_text.append(disclaimer)
    parts_html.append(
        f'{BRAND}, Australia &middot; <a href="{e(site, quote=True)}" style="{link}">{e(site)}</a>'
    )
    parts_html.append(e(disclaimer))
    html_out = "".join(
        f'<p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:{MUTED};">{p}</p>' for p in parts_html
    )
    return html_out, "\n".join(lines_text)


def _layout(
    ctx: RenderContext, template: str, subject: str, blocks: list[Block], preheader: str, reason: str
) -> RenderedEmail:
    e = html.escape
    footer_html, footer_text = _footer(ctx, template, reason)
    body_html = "".join(_html_block(b) for b in blocks)
    site = ctx.site_url.rstrip("/")
    doc = (
        '<!doctype html><html lang="en-AU"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<meta name="color-scheme" content="light"><title>{e(subject)}</title></head>'
        f'<body style="margin:0;padding:0;background:{BG};color:{INK};font-family:{SANS};">'
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{e(preheader)}</div>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{BG};">'
        '<tr><td align="center" style="padding:24px 16px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="max-width:560px;width:100%;">'
        f'<tr><td style="padding:0 0 16px;"><a href="{e(site, quote=True)}" style="font-family:{SERIF};'
        f'font-size:24px;font-weight:600;color:{INK};text-decoration:none;">{BRAND}</a></td></tr>'
        f'<tr><td style="background:{CARD};border:1px solid {RULE};border-radius:6px;padding:28px 28px 12px;'
        f'font-family:{SANS};">{body_html}</td></tr>'
        f'<tr><td style="padding:20px 4px 0;font-family:{SANS};">{footer_html}</td></tr>'
        "</table></td></tr></table></body></html>"
    )
    text = "\n\n".join(_text_block(b) for b in blocks) + "\n\n-- \n" + footer_text + "\n"
    return RenderedEmail(subject=subject, html=doc, text=text, preheader=preheader)


# --------------------------------------------------------------- templates
Built = tuple[str, list[Block], str, str]  # subject, blocks, preheader, reason
_ACCOUNT_REASON = f"You're receiving this because you have a {BRAND} account and this alert is switched on."


def _generic(data: Mapping[str, Any], ctx: RenderContext, default_title: str, cta: str) -> Built:
    title = _one_line(data.get("title") or default_title)
    blocks: list[Block] = [("h", title)]
    if data.get("body"):
        blocks.append(("p", str(data["body"])))
    blocks.append(("button", cta, absolute_url(ctx.site_url, data.get("url"))))
    return title, blocks, _one_line(data.get("body") or title, 120), _ACCOUNT_REASON


def _message(data: Mapping[str, Any], ctx: RenderContext) -> Built:
    title = _one_line(data.get("title") or "You have a new message")
    blocks: list[Block] = [("h", title)]
    snippet = str(data.get("body") or "").strip()
    if snippet:
        blocks.append(("quote", snippet))
    blocks.append(("button", "Read and reply", absolute_url(ctx.site_url, data.get("url"), "/messages/")))
    blocks.append(
        (
            "note",
            "Keep payment and contact details inside TCG Trade messages until you trust the other party. "
            "We never ask for your password by email.",
        )
    )
    return title, blocks, _one_line(snippet or title, 120), _ACCOUNT_REASON


def _listing_status(data: Mapping[str, Any], ctx: RenderContext) -> Built:
    status = str(data.get("status") or "")
    title = _one_line(data.get("title") or "Your listing was updated")
    blocks: list[Block] = [("h", title)]
    if data.get("body"):
        blocks.append(("p", str(data["body"])))
    if data.get("reason") and status in ("rejected", "changes_requested"):
        blocks.append(("quote", str(data["reason"])))
    cta = {
        "active": "View your listing",
        "rejected": "Go to my listings",
        "changes_requested": "Edit your listing",
        "expired": "Renew your listing",
    }.get(status, "View your listings")
    blocks.append(("button", cta, absolute_url(ctx.site_url, data.get("url"), "/account/listings/")))
    return title, blocks, _one_line(data.get("body") or title, 120), _ACCOUNT_REASON


def _listing_expiring(data: Mapping[str, Any], ctx: RenderContext) -> Built:
    listing = _one_line(data.get("listing_title") or data.get("body") or "Your listing")
    when = format_when(data.get("expires_at"))
    title = _one_line(data.get("title") or f"Your listing expires soon: {listing}")
    blocks: list[Block] = [("h", title), ("p", f"“{listing}” comes down automatically unless you renew it.")]
    rows: list[tuple[str, str]] = []
    if when:
        rows.append(("Expires", when))
    if data.get("price_aud") is not None:
        rows.append(("Price", format_aud(data.get("price_aud"))))
    if rows:
        blocks.append(("rows", rows))
    blocks.append(
        ("button", "Renew in one click", absolute_url(ctx.site_url, data.get("url"), "/account/listings/"))
    )
    blocks.append(
        ("note", "Renewing keeps the same listing, link and photos. It doesn't use a listing credit.")
    )
    return title, blocks, f"{listing} expires {when}".strip(), _ACCOUNT_REASON


def _wishlist(data: Mapping[str, Any], ctx: RenderContext) -> Built:
    title, blocks, pre, _ = _generic(data, ctx, "A card on your wishlist was just listed", "View listing")
    if data.get("price_aud") is not None:
        blocks.insert(1, ("rows", [("Price", format_aud(data.get("price_aud")))]))
    return title, blocks, pre, "You're receiving this because the item is on your TCG Trade wishlist."


def _saved_search(data: Mapping[str, Any], ctx: RenderContext) -> Built:
    title, blocks, pre, _ = _generic(data, ctx, "New match for your saved search", "View listing")
    if data.get("price_aud") is not None:
        blocks.insert(1, ("rows", [("Price", format_aud(data.get("price_aud")))]))
    return title, blocks, pre, "You're receiving this because you turned on alerts for this saved search."


def drop_event_label(event_type: Any) -> str:
    return EVENT_LABELS.get(str(event_type or ""), str(event_type or "DROP").replace("_", " "))


def _drop(data: Mapping[str, Any], ctx: RenderContext) -> Built:
    label = drop_event_label(data.get("event_type"))
    product = _one_line(data.get("product_title") or data.get("title") or "A tracked product", 150)
    retailer = _one_line(data.get("retailer") or "the retailer", 60)
    price = format_aud(data.get("price_aud"))
    tag = rrp_label(data.get("rrp_tag"), data.get("rrp_delta_pct"))
    tags = [label] + ([tag] if tag else [])
    subject = _one_line(f"{label}: {product} at {retailer}" + (f" — {price}" if price != "—" else ""), 150)
    rows: list[tuple[str, str]] = [("Retailer", retailer), ("Price", price)]
    if data.get("event_type") == "PRICE_CHANGE" and data.get("previous_price_aud") is not None:
        rows.append(("Was", format_aud(data.get("previous_price_aud"))))
    if data.get("rrp_aud") is not None:
        rows.append(("RRP", format_aud(data.get("rrp_aud"))))
    if data.get("occurred_at"):
        rows.append(("Detected", format_when(data.get("occurred_at"))))
    retailer_url = absolute_url(ctx.site_url, data.get("url"), "/drops/")
    blocks: list[Block] = [
        ("tags", tags),
        ("h", product),
        ("rows", rows),
        ("button", f"Go to {retailer}", retailer_url),
    ]
    if str(data.get("tier") or "free") != "premium":
        blocks.append(("quote", FREE_DELAY_LINE.format(url=absolute_url(ctx.site_url, PREMIUM_PATH))))
    blocks.append(
        (
            "note",
            "Stock moves fast and can sell out before you get there. TCG Trade only tells you what we saw; "
            "we never buy, queue or check out for you.",
        )
    )
    pre = f"{label} · {retailer} · {price}" + (f" · {tag}" if tag else "")
    return (
        subject,
        blocks,
        pre,
        "You're receiving this because retail drop alerts are on for your TCG Trade account.",
    )


def _billing(data: Mapping[str, Any], ctx: RenderContext) -> Built:
    kind = str(data.get("kind") or "")
    defaults = {
        "receipt": (
            "Your TCG Trade Premium receipt",
            "Thanks for supporting TCG Trade. Here's your receipt.",
        ),
        "payment_failed": (
            "Payment failed for TCG Trade Premium",
            "We couldn't take your Premium payment. Update your card to keep instant drop alerts and 30 listings a month.",
        ),
        "subscription_started": (
            "Welcome to TCG Trade Premium",
            "Instant drop alerts and 30 listings a month are on.",
        ),
        "subscription_cancelled": (
            "Your Premium subscription was cancelled",
            "You'll keep Premium until the end of the current period, then move to the Free plan.",
        ),
    }
    d_title, d_body = defaults.get(kind, ("Your TCG Trade billing update", ""))
    title = _one_line(data.get("title") or d_title)
    blocks: list[Block] = [("h", title)]
    body = str(data.get("body") or d_body)
    if body:
        blocks.append(("p", body))
    rows: list[tuple[str, str]] = []
    if data.get("amount_aud") is not None:
        rows.append(("Amount (incl. GST)", format_aud(data.get("amount_aud"))))
    if data.get("period_end"):
        rows.append(("Current period ends", format_when(data.get("period_end"))))
    if data.get("invoice_number"):
        rows.append(("Invoice", str(data["invoice_number"])))
    if rows:
        blocks.append(("rows", rows))
    cta = "Update payment details" if kind == "payment_failed" else "Manage subscription"
    blocks.append(
        (
            "button",
            cta,
            absolute_url(ctx.site_url, data.get("url") or data.get("invoice_url"), "/account/billing/"),
        )
    )
    return (
        title,
        blocks,
        _one_line(body or title, 120),
        "You're receiving this because you have a TCG Trade subscription.",
    )


def _admin_alert(data: Mapping[str, Any], ctx: RenderContext) -> Built:
    title = _one_line(data.get("title") or data.get("subject") or "Worker alert")
    blocks: list[Block] = [("tags", ["ADMIN ALERT"]), ("h", title)]
    if data.get("body"):
        blocks.append(("p", str(data["body"])))
    details = data.get("details")
    if isinstance(details, Mapping) and details:
        blocks.append(("rows", [(str(k), _one_line(v, 300)) for k, v in details.items()]))
    blocks.append(
        ("button", "Open the admin console", absolute_url(ctx.site_url, data.get("url"), "/admin/"))
    )
    return (
        f"[TCG Trade admin] {title}",
        blocks,
        title,
        "You're receiving this because you're a TCG Trade administrator.",
    )


def _welcome(data: Mapping[str, Any], ctx: RenderContext) -> Built:
    name = _one_line(data.get("display_name") or data.get("username") or "", 60)
    title = f"Welcome to TCG Trade{', ' + name if name else ''}"
    blocks: list[Block] = [
        ("h", title),
        ("p", "TCG Trade tracks the Australian market for Pokémon TCG and One Piece Card Game in A$."),
        (
            "rows",
            [
                ("Market cap", "Graded card prices and populations, updated daily"),
                ("Marketplace", "Buy and sell with other Australian collectors"),
                ("Drop alerts", "Know when Australian retailers restock"),
            ],
        ),
        ("button", "Explore the market", absolute_url(ctx.site_url, data.get("url"), "/")),
    ]
    return (
        title,
        blocks,
        "Your account is ready.",
        "You're receiving this because you created a TCG Trade account.",
    )


_BUILDERS: dict[str, Callable[[Mapping[str, Any], RenderContext], Built]] = {
    "message": _message,
    "listing_status": _listing_status,
    "listing_expiring": _listing_expiring,
    "wishlist": _wishlist,
    "saved_search": _saved_search,
    "drop": _drop,
    "billing": _billing,
    "admin_alert": _admin_alert,
    "welcome": _welcome,
}


def render(template: str, data: Mapping[str, Any] | None, ctx: RenderContext) -> RenderedEmail:
    builder = _BUILDERS.get(template)
    if builder is None:
        raise UnknownTemplate(template)
    subject, blocks, preheader, reason = builder(data or {}, ctx)
    subject = _one_line(subject, 180)  # also strips CR/LF: no header injection
    return _layout(ctx, template, subject, blocks, preheader, reason)
