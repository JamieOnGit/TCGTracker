"""Email templates for every ``email_outbox.template`` value.

Each template turns the outbox row's ``data`` into a list of simple blocks;
one layout renders those blocks as HTML (inline CSS, 560px, TCGTracker
colours) and as the plain-text part, so both always carry the same content.

Every email carries (Spam Act 2003, Gmail/Yahoo bulk-sender rules):
* sender identification - TCGTracker, Australia;
* a link to the notification preferences centre;
* a one-click unsubscribe link for that alert type (the sender adds the
  matching List-Unsubscribe / List-Unsubscribe-Post headers).

Templates never raise on a missing field: they fall back to the generic
``title`` / ``body`` / ``url`` that ``public.notify()`` always stores.
"""

from __future__ import annotations

import contextlib
import html
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import parse_qsl, unquote, urlencode, urljoin, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

from tcgworkers.config import DEFAULT_SITE_URL
from tcgworkers.drops import rrp as rrp_mod
from tcgworkers.drops.models import RrpTag

BRAND = "TCGTracker"
TIMEZONE = ZoneInfo("Australia/Melbourne")
SYDNEY = ZoneInfo("Australia/Sydney")
DEALS_PATH = "/deals/"
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
    "release",
    "deal",
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
    "release": "release",
    "deal": "wishlist",
}

# alert_type written on the unsubscribe token (what one click turns off);
# must be a notification_preferences.alert_type. Admin alerts are internal
# operational mail to staff, not a member alert, so they carry no token.
UNSUBSCRIBE_TYPE: dict[str, str | None] = {
    "message": "message",
    "listing_status": "listing_status",
    "listing_expiring": "listing_expiring",
    "wishlist": "wishlist",
    "saved_search": "saved_search",
    "drop": "drop",
    "billing": "billing",
    "admin_alert": None,
    "welcome": "marketing",
    "release": "release",
    "deal": "wishlist",
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
    "release": "release reminder emails",
    "deal": "wishlist alerts",
}

EVENT_LABELS: dict[str, str] = {
    "IN_STOCK": "IN STOCK",
    "PREORDER_OPEN": "PRE-ORDER OPEN",
    "NEW_LISTING": "NEW LISTING",
    "PRICE_CHANGE": "PRICE CHANGE",
    "QUEUE_LIVE": "QUEUE LIVE",
}

QUANTITY_LABELS: dict[str, str] = {"few": "A few left", "some": "Some in stock", "plenty": "Plenty in stock"}

FREE_DELAY_LINE = "You're seeing this 5 minutes after Premium members. Upgrade for instant alerts: {url}"

# "Midnight Holo" palette, matching the site theme.
BG = "#0B0D14"  # page background
PANEL = "#121521"  # main content panel
INK = "#EEF0F7"  # text
MUTED = "#9AA1B5"
RULE = "#2C3347"
PRIMARY = "#6D5DF6"  # buttons, and the solid fallback for the holo bar
HOLO = "linear-gradient(100deg,#6D5DF6,#3EC6FF,#FF6AD5)"
LINK = "#9D8CFF"
UP = "#3DDC97"
DOWN = "#FF6B7A"
WORDMARK = "TCGTRACKER"
SERIF = "'Cormorant Garamond', Georgia, serif"
WORDMARK_FONT = "Georgia, 'Times New Roman', serif"
SANS = "Inter, Arial, sans-serif"


def _tag_colour(tag: str) -> str:
    """Green for good-for-the-buyer RRP tags, red for above RRP."""
    if tag.startswith(("AT RRP", "BELOW RRP")):
        return UP
    if tag.startswith("ABOVE RRP"):
        return DOWN
    return LINK


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


def format_when(value: Any, tz: ZoneInfo = TIMEZONE) -> str:
    """'Fri 3 Oct 2026, 9:05 am AEST' in Melbourne time (or ``tz``)."""
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
    local = dt.astimezone(tz)
    hour = local.hour % 12 or 12
    ampm = "am" if local.hour < 12 else "pm"
    return f"{local:%a} {local.day} {local:%b %Y}, {hour}:{local:%M} {ampm} {local.tzname()}"


# eBay Partner Network tracking parameters. EPN forbids affiliate links in
# email/SMS/push without prior written approval (docs/research/07 §E.2), so
# emails only ever carry plain eBay URLs.
_EPN_PARAMS = frozenset({"mkcid", "mkrid", "campid", "customid", "toolid", "mkevt", "mkgroupid", "siteid"})
_EBAY_HOST = re.compile(r"(^|\.)ebay\.(com|com\.au|co\.uk|ca|de|fr|it|es)$", re.IGNORECASE)
_URL_IN_TEXT = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
EBAY_AU = "https://www.ebay.com.au/"


def strip_affiliate(url: str) -> str:
    """Remove EPN tracking from an eBay URL (rover links become their target)."""
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if host.startswith("rover.ebay.") or host == "rover.ebay.com":
        target = dict(parse_qsl(parts.query)).get("mpre")
        return strip_affiliate(unquote(target)) if target and target.startswith("http") else EBAY_AU
    if not _EBAY_HOST.search(host):
        return url
    kept = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k.lower() not in _EPN_PARAMS]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(kept), parts.fragment))


def _strip_affiliate_in(text: str) -> str:
    def fix(m: re.Match[str]) -> str:
        raw = html.unescape(m.group(0))
        clean = strip_affiliate(raw)
        return (
            m.group(0) if clean == raw else html.escape(clean, quote=True) if "&amp;" in m.group(0) else clean
        )

    return _URL_IN_TEXT.sub(fix, text)


def absolute_url(site_url: str, url: Any, fallback: str = "/") -> str:
    """Relative site paths become absolute; only http(s) links pass through,
    and never with eBay affiliate tracking."""
    raw = str(url or "").strip() or fallback
    parts = urlsplit(raw)
    if parts.scheme in ("http", "https") and parts.netloc:
        return strip_affiliate(raw)
    if parts.scheme or parts.netloc:  # javascript:, mailto:, //host - never linked
        raw = fallback
    return urljoin(site_url.rstrip("/") + "/", raw.lstrip("/"))


def _one_line(text: Any, limit: int = 200) -> str:
    s = " ".join(str(text or "").split())
    return s if len(s) <= limit else s[: limit - 1].rstrip() + "…"


def _direction(price: Any, previous: Any) -> str | None:
    """Colour for a price move: green when cheaper, red when dearer."""
    try:
        now, before = Decimal(str(price)), Decimal(str(previous))
    except (InvalidOperation, ValueError):
        return None
    if now < before:
        return UP
    if now > before:
        return DOWN
    return None


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
            f'<p style="margin:0 0 16px;padding:12px 16px;border-left:3px solid {PRIMARY};background:{BG};'
            f'font-size:15px;line-height:1.6;color:{INK};">{e(b[1])}</p>'
        )
    if kind == "tags":
        chips = "".join(
            f'<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 8px;border:1px solid {_tag_colour(t)};'
            f'border-radius:3px;font-size:11px;font-weight:700;letter-spacing:0.06em;color:{_tag_colour(t)};">'
            f"{e(t)}</span>"
            for t in b[1]
        )
        return f'<p style="margin:0 0 12px;">{chips}</p>'
    if kind == "rows":
        rows = "".join(
            f'<tr><td style="padding:6px 0;border-bottom:1px solid {RULE};font-size:13px;color:{MUTED};'
            f'width:40%;">{e(row[0])}</td><td style="padding:6px 0;border-bottom:1px solid {RULE};font-size:14px;'
            f'color:{row[2] if len(row) > 2 else INK};text-align:right;">{e(row[1])}</td></tr>'
            for row in b[1]
        )
        return (
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            f'style="margin:0 0 20px;border-collapse:collapse;">{rows}</table>'
        )
    if kind == "button":
        return (
            f'<p style="margin:8px 0 24px;"><a href="{e(b[2], quote=True)}" style="display:inline-block;'
            f"padding:12px 22px;background:{PRIMARY};color:#FFFFFF;text-decoration:none;font-size:14px;"
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
        return "\n".join(f"{row[0]}: {row[1]}" for row in b[1])
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
    link = f"color:{LINK};text-decoration:underline;"
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
        '<meta name="color-scheme" content="dark light"><meta name="supported-color-schemes" content="dark light">'
        f"<title>{e(subject)}</title></head>"
        f'<body style="margin:0;padding:0;background:{BG};color:{INK};font-family:{SANS};">'
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{e(preheader)}</div>'
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{BG};">'
        '<tr><td align="center" style="padding:24px 16px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="max-width:560px;width:100%;">'
        f'<tr><td style="padding:0 0 16px;"><a href="{e(site, quote=True)}" style="font-family:{WORDMARK_FONT};'
        f'font-size:18px;font-weight:400;letter-spacing:.28em;color:{INK};text-decoration:none;">{WORDMARK}</a>'
        "</td></tr>"
        # 3px holo bar: solid fallback first for clients that drop gradients.
        f'<tr><td style="height:3px;line-height:3px;font-size:0;background:{PRIMARY};background-image:{HOLO};'
        'border-radius:6px 6px 0 0;">&nbsp;</td></tr>'
        f'<tr><td style="background:{PANEL};border:1px solid {RULE};border-top:0;border-radius:0 0 6px 6px;'
        f'padding:28px 28px 12px;font-family:{SANS};color:{INK};">{body_html}</td></tr>'
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
            "Keep payment and contact details inside TCGTracker messages until you trust the other party. "
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
    return title, blocks, pre, "You're receiving this because the item is on your TCGTracker wishlist."


def _saved_search(data: Mapping[str, Any], ctx: RenderContext) -> Built:
    title, blocks, pre, _ = _generic(data, ctx, "New match for your saved search", "View listing")
    if data.get("price_aud") is not None:
        blocks.insert(1, ("rows", [("Price", format_aud(data.get("price_aud")))]))
    return title, blocks, pre, "You're receiving this because you turned on alerts for this saved search."


def drop_event_label(event_type: Any) -> str:
    return EVENT_LABELS.get(str(event_type or ""), str(event_type or "DROP").replace("_", " "))


# ---------------------------------------------------- member sightings
def sighting_headline(channel: Any, product: str, place: str) -> str:
    """'In store: Pokémon booster bundles at Kmart Chadstone, VIC'."""
    where = "In store" if channel == "in_store" else "Online"
    return f"{where}: {product} at {place}"


def quantity_label(quantity: Any) -> str | None:
    return QUANTITY_LABELS.get(str(quantity or ""))


def limit_label(limit: Any) -> str | None:
    try:
        n = int(limit)
    except (TypeError, ValueError):
        return None
    return f"Limit {n} per customer" if n > 0 else None


def confirmed_label(count: Any) -> str:
    try:
        n = int(count or 0)
    except (TypeError, ValueError):
        n = 0
    if n <= 0:
        return "Verified by a trusted scout or moderator"
    return f"Confirmed by {n} member{'s' if n != 1 else ''}"


_DROP_REASON = "You're receiving this because retail drop alerts are on for your TCGTracker account."


def _sighting(data: Mapping[str, Any], ctx: RenderContext) -> Built:
    """A member's confirmed in-store or online sighting."""
    channel = str(data.get("channel") or "")
    in_store = channel == "in_store"
    product = _one_line(data.get("product_title") or "Stock", 150)
    retailer = _one_line(data.get("retailer") or "the retailer", 60)
    place = _one_line(data.get("place") or retailer, 100)
    price = format_aud(data.get("price_aud"))
    tag = rrp_label(data.get("rrp_tag"), data.get("rrp_delta_pct"))
    subject = _one_line(
        sighting_headline(channel, product, place) + (f" — {price}" if price != "—" else ""), 150
    )
    tags = ["IN STORE" if in_store else "ONLINE", "MEMBER SIGHTING"] + ([tag] if tag else [])
    rows: list[tuple[str, ...]] = [("Retailer", retailer)]
    if in_store:
        if data.get("store_name"):
            rows.append(("Store", _one_line(data.get("store_name"), 80)))
        suburb = _one_line(data.get("suburb"), 60)
        state = str(data.get("state") or "")
        if suburb or state:
            rows.append(("Location", ", ".join(x for x in (suburb, state) if x)))
    if price != "—":
        rows.append(("Price", price))
    if data.get("rrp_aud") is not None:
        rows.append(("RRP", format_aud(data.get("rrp_aud"))))
    stock = quantity_label(data.get("quantity"))
    if stock:
        rows.append(("Stock", stock))
    limit = limit_label(data.get("purchase_limit"))
    if limit:
        rows.append(("Purchase limit", limit))
    if data.get("occurred_at"):
        rows.append(("Confirmed", format_when(data.get("occurred_at"))))
    confirmed = confirmed_label(data.get("confirm_count"))
    blocks: list[Block] = [("tags", tags), ("h", product), ("rows", rows), ("p", f"{confirmed}.")]
    if data.get("note"):
        blocks.append(("quote", _one_line(data.get("note"), 280)))
    if data.get("photo_url"):
        blocks.append(("p", f"Photo from the store: {absolute_url(ctx.site_url, data.get('photo_url'))}"))
    if in_store:
        state = str(data.get("state") or "").upper()
        blocks.append(
            (
                "button",
                f"See {state} sightings" if state else "See sightings",
                absolute_url(ctx.site_url, data.get("drops_path"), "/drops/"),
            )
        )
    else:
        blocks.append(("button", f"Go to {retailer}", absolute_url(ctx.site_url, data.get("url"), "/drops/")))
    if str(data.get("tier") or "free") != "premium":
        blocks.append(("quote", FREE_DELAY_LINE.format(url=absolute_url(ctx.site_url, PREMIUM_PATH))))
    blocks.append(
        (
            "note",
            "Reported by a TCGTracker member and confirmed by the community. Stock moves fast and may be "
            "gone by the time you arrive; call the store if you're travelling far. "
            "TCGTracker never buys, queues or checks out for you.",
        )
    )
    pre = " · ".join(x for x in (place, price if price != "—" else None, stock, confirmed) if x)
    return subject, blocks, pre, _DROP_REASON


def _drop(data: Mapping[str, Any], ctx: RenderContext) -> Built:
    if data.get("source") == "member":
        return _sighting(data, ctx)
    label = drop_event_label(data.get("event_type"))
    product = _one_line(data.get("product_title") or data.get("title") or "A tracked product", 150)
    retailer = _one_line(data.get("retailer") or "the retailer", 60)
    price = format_aud(data.get("price_aud"))
    tag = rrp_label(data.get("rrp_tag"), data.get("rrp_delta_pct"))
    tags = [label] + ([tag] if tag else [])
    subject = _one_line(f"{label}: {product} at {retailer}" + (f" — {price}" if price != "—" else ""), 150)
    rows: list[tuple[str, ...]] = [("Retailer", retailer), ("Price", price)]
    if data.get("event_type") == "PRICE_CHANGE" and data.get("previous_price_aud") is not None:
        direction = _direction(data.get("price_aud"), data.get("previous_price_aud"))
        if direction:
            rows[1] = ("Price", f"{price} {'▼' if direction == UP else '▲'}", direction)
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
            "Stock moves fast and can sell out before you get there. TCGTracker only tells you what we saw; "
            "we never buy, queue or check out for you.",
        )
    )
    pre = f"{label} · {retailer} · {price}" + (f" · {tag}" if tag else "")
    return subject, blocks, pre, _DROP_REASON


def _billing(data: Mapping[str, Any], ctx: RenderContext) -> Built:
    kind = str(data.get("kind") or "")
    defaults = {
        "receipt": (
            "Your TCGTracker Premium receipt",
            "Thanks for supporting TCGTracker. Here's your receipt.",
        ),
        "payment_failed": (
            "Payment failed for TCGTracker Premium",
            "We couldn't take your Premium payment. Update your card to keep instant drop alerts and 30 listings a month.",
        ),
        "subscription_started": (
            "Welcome to TCGTracker Premium",
            "Instant drop alerts and 30 listings a month are on.",
        ),
        "subscription_cancelled": (
            "Your Premium subscription was cancelled",
            "You'll keep Premium until the end of the current period, then move to the Free plan.",
        ),
    }
    d_title, d_body = defaults.get(kind, ("Your TCGTracker billing update", ""))
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
        "You're receiving this because you have a TCGTracker subscription.",
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
        f"[TCGTracker admin] {title}",
        blocks,
        title,
        "You're receiving this because you're a TCGTracker administrator.",
    )


def _welcome(data: Mapping[str, Any], ctx: RenderContext) -> Built:
    name = _one_line(data.get("display_name") or data.get("username") or "", 60)
    title = f"Welcome to TCGTracker{', ' + name if name else ''}"
    blocks: list[Block] = [
        ("h", title),
        ("p", "TCGTracker tracks the Australian market for Pokémon TCG and One Piece Card Game in A$."),
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
        "You're receiving this because you created a TCGTracker account.",
    )


def _release(data: Mapping[str, Any], ctx: RenderContext) -> Built:
    """Reminder queued by public.send_release_reminders() the day before."""
    title = _one_line(data.get("title") or "A release you're following is coming up")
    blocks: list[Block] = [("tags", ["RELEASE REMINDER"]), ("h", title)]
    body = str(data.get("body") or "").strip()
    if body:
        blocks.append(("p", body))
    blocks.append(
        ("button", "See the release details", absolute_url(ctx.site_url, data.get("url"), "/releases/"))
    )
    blocks.append(
        (
            "note",
            "Release dates can move and stores stock at different times. Turn on drop alerts to hear "
            "the moment it lands at an Australian retailer.",
        )
    )
    return (
        title,
        blocks,
        _one_line(body or title, 120),
        "You're receiving this because you asked for a reminder about this release on TCGTracker.",
    )


def _site_path(value: Any, fallback: str) -> str:
    """Only a path on our own site: deal emails never carry the eBay link,
    which is affiliate-tracked when EPN is on (EPN forbids that in email)."""
    raw = str(value or "")
    return raw if raw.startswith("/") and not raw.startswith("//") else fallback


def _deal(data: Mapping[str, Any], ctx: RenderContext) -> Built:
    """eBay listing well under market value, for a card on the member's
    wishlist (queued by the ebay_deals_notify trigger)."""
    title = _one_line(data.get("title") or "A card on your wishlist is on eBay under market value")
    auction = str(data.get("buying_option") or "") == "AUCTION"
    blocks: list[Block] = [("tags", ["EBAY DEAL", "AUCTION" if auction else "BUY IT NOW"]), ("h", title)]
    rows: list[tuple[str, ...]] = []
    if data.get("price_aud") is not None:
        rows.append(("Current bid" if auction else "Price", format_aud(data.get("price_aud"))))
    if data.get("shipping_aud") is not None:
        rows.append(("Postage", format_aud(data.get("shipping_aud"))))
    if data.get("market_aud") is not None:
        rows.append(("TCGTracker market value", format_aud(data.get("market_aud"))))
    if data.get("discount_pct") not in (None, ""):
        with contextlib.suppress(InvalidOperation, ValueError):
            rows.append(("Under market value", f"{Decimal(str(data['discount_pct'])):.0f}%", UP))
    if auction and data.get("end_time"):
        rows.append(("Auction ends", format_when(data.get("end_time"), SYDNEY)))
    if rows:
        blocks.append(("rows", rows))
    body = str(data.get("body") or "").strip()
    if body:
        blocks.append(("p", body))
    blocks.append(
        ("button", "See the deal", absolute_url(ctx.site_url, _site_path(data.get("url"), DEALS_PATH)))
    )
    card_path = _site_path(data.get("card_path"), "")
    if card_path:
        blocks.append(("p", f"Price history for this card: {absolute_url(ctx.site_url, card_path)}"))
    blocks.append(
        (
            "note",
            "Found by searching eBay Australia's public listings. Check the photos, the seller and the "
            "grading certificate before you buy; TCGTracker isn't part of the sale.",
        )
    )
    return (
        title,
        blocks,
        _one_line(body or title, 120),
        "You're receiving this because the card is on your TCGTracker wishlist.",
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
    "release": _release,
    "deal": _deal,
}


def render(template: str, data: Mapping[str, Any] | None, ctx: RenderContext) -> RenderedEmail:
    builder = _BUILDERS.get(template)
    if builder is None:
        raise UnknownTemplate(template)
    subject, blocks, preheader, reason = builder(data or {}, ctx)
    subject = _one_line(subject, 180)  # also strips CR/LF: no header injection
    out = _layout(ctx, template, subject, blocks, preheader, reason)
    # Belt and braces: no eBay affiliate link survives anywhere in an email,
    # including links pasted into message text (07 §E).
    return RenderedEmail(
        subject=out.subject,
        html=_strip_affiliate_in(out.html),
        text=_strip_affiliate_in(out.text),
        preheader=out.preheader,
    )
