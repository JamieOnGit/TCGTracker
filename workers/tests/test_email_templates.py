from __future__ import annotations

from decimal import Decimal

import pytest

from tcgworkers.email.templates import (
    PREFERENCE_TYPE,
    TEMPLATES,
    UNSUBSCRIBE_TYPE,
    RenderContext,
    UnknownTemplate,
    absolute_url,
    format_aud,
    format_when,
    render,
)

CTX = RenderContext(site_url="https://tcgtrade.com.au", unsubscribe_token="TOKEN123")
UNSUB = "https://tcgtrade.com.au/unsubscribe/?t=TOKEN123"
PREFS = "https://tcgtrade.com.au/account/settings/"

SAMPLE: dict[str, dict[str, object]] = {
    "message": {
        "title": "New message about Charizard PSA 10",
        "body": "Is this still available?",
        "url": "/messages/abc/",
    },
    "listing_status": {
        "title": "Your listing was not approved",
        "body": "Charizard — blurry photos",
        "status": "rejected",
        "reason": "Photos are blurry",
        "url": "/account/listings/",
    },
    "listing_expiring": {
        "listing_title": "Charizard PSA 10",
        "expires_at": "2026-10-03T02:00:00+00:00",
        "price_aud": "4500",
        "url": "/account/listings/",
    },
    "wishlist": {
        "title": "Now listed: Luffy OP01",
        "body": "A$120.00 · VIC",
        "url": "/marketplace/listing/7/",
        "price_aud": 120,
    },
    "saved_search": {
        "title": 'New match for "PSA 10 Pikachu"',
        "body": "Pikachu PSA 10",
        "url": "/marketplace/listing/8/",
    },
    "drop": {
        "event_type": "IN_STOCK",
        "product_title": "Pokémon TCG: Scarlet & Violet Elite Trainer Box",
        "retailer": "JB Hi-Fi",
        "price_aud": "89.95",
        "rrp_aud": "79.95",
        "rrp_tag": "ABOVE_RRP",
        "rrp_delta_pct": "12.5",
        "url": "https://www.jbhifi.com.au/products/etb",
        "occurred_at": "2026-09-28T01:05:00+00:00",
        "tier": "premium",
    },
    "billing": {"kind": "receipt", "amount_aud": "12.99", "invoice_number": "INV-1"},
    "admin_alert": {
        "title": "JB Hi-Fi monitor failing",
        "body": "5 failed cycles",
        "details": {"retailer": "jb-hi-fi"},
    },
    "welcome": {"username": "ash"},
}


def test_every_outbox_template_has_a_sample_and_rules():
    assert set(SAMPLE) == set(TEMPLATES)
    assert set(PREFERENCE_TYPE) == set(TEMPLATES) == set(UNSUBSCRIBE_TYPE)
    # Both must be valid notification_preferences.alert_type values (the web
    # /unsubscribe/ route upserts the token's type there).
    allowed = {
        "message",
        "listing_status",
        "listing_expiring",
        "saved_search",
        "wishlist",
        "drop",
        "billing",
        "weekly_digest",
        "marketing",
    }
    assert {v for v in PREFERENCE_TYPE.values() if v} <= allowed
    assert {v for v in UNSUBSCRIBE_TYPE.values() if v} <= allowed
    assert UNSUBSCRIBE_TYPE["admin_alert"] is None


@pytest.mark.parametrize("template", TEMPLATES)
def test_every_template_renders_with_compliance_footer(template):
    r = render(template, SAMPLE[template], CTX)
    assert r.subject and "\n" not in r.subject
    for part in (r.html, r.text):
        assert "TCG Trade" in part
        assert "Australia" in part  # sender identification (Spam Act 2003)
        assert PREFS in part
        assert UNSUB in part
    assert "max-width:560px" in r.html
    # Midnight Holo theme.
    assert "background:#0B0D14" in r.html and "background:#121521" in r.html and "color:#EEF0F7" in r.html
    assert "background:#6D5DF6;background-image:linear-gradient(100deg,#6D5DF6,#3EC6FF,#FF6AD5)" in r.html
    assert "letter-spacing:.28em" in r.html and ">TCG TRADE</a>" in r.html
    assert '<meta name="color-scheme" content="dark light">' in r.html
    assert "color:#9D8CFF" in r.html  # links
    assert "Inter" in r.html
    assert r.html.startswith("<!doctype html>")


@pytest.mark.parametrize("template", TEMPLATES)
def test_every_template_survives_empty_data(template):
    r = render(template, {}, CTX)
    assert r.subject and UNSUB in r.text


def test_no_unsubscribe_link_without_a_token():
    r = render("admin_alert", SAMPLE["admin_alert"], RenderContext())
    assert "/unsubscribe/" not in r.html and PREFS in r.text


def test_unknown_template_is_rejected():
    with pytest.raises(UnknownTemplate):
        render("nope", {}, CTX)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (Decimal("89.95"), "A$89.95"),
        ("1234.5", "A$1,234.50"),
        (12, "A$12.00"),
        (0.1 + 0.2, "A$0.30"),
        (None, "—"),
        ("", "—"),
        ("n/a", "—"),
        (Decimal("-5"), "-A$5.00"),
    ],
)
def test_format_aud(value, expected):
    assert format_aud(value) == expected


def test_prices_in_emails_are_aud_with_two_decimals():
    r = render("drop", SAMPLE["drop"], CTX)
    assert "A$89.95" in r.text and "A$79.95" in r.text
    assert "A$89.95" in r.subject
    exp = render("listing_expiring", SAMPLE["listing_expiring"], CTX)
    assert "A$4,500.00" in exp.text
    assert "A$12.99" in render("billing", SAMPLE["billing"], CTX).text


def test_drop_email_content():
    r = render("drop", SAMPLE["drop"], CTX)
    assert r.subject.startswith("IN STOCK: Pokémon TCG: Scarlet & Violet Elite Trainer Box at JB Hi-Fi")
    assert "[IN STOCK]" in r.text and "[ABOVE RRP (+12.5%)]" in r.text
    assert "https://www.jbhifi.com.au/products/etb" in r.html
    assert "Premium members" not in r.text  # premium: no upgrade line


def test_drop_email_labels():
    pre = render(
        "drop",
        {**SAMPLE["drop"], "event_type": "PREORDER_OPEN", "rrp_tag": "AT_RRP", "rrp_delta_pct": "0"},
        CTX,
    )
    assert pre.subject.startswith("PRE-ORDER OPEN:") and "[AT RRP]" in pre.text
    change = render(
        "drop",
        {**SAMPLE["drop"], "event_type": "PRICE_CHANGE", "previous_price_aud": "99.95", "rrp_tag": "UNKNOWN"},
        CTX,
    )
    assert "Was: A$99.95" in change.text and "RRP UNKNOWN" not in change.text
    assert "Price: A$89.95 ▼" in change.text and "color:#3DDC97" in change.html  # cheaper = green
    dearer = render(
        "drop", {**SAMPLE["drop"], "event_type": "PRICE_CHANGE", "previous_price_aud": "79.95"}, CTX
    )
    assert "Price: A$89.95 ▲" in dearer.text and "color:#FF6B7A" in dearer.html


def test_primary_button_and_rrp_tag_colours():
    r = render("drop", SAMPLE["drop"], CTX)
    assert "background:#6D5DF6;color:#FFFFFF" in r.html
    assert "border:1px solid #FF6B7A" in r.html  # ABOVE RRP chip
    below = render("drop", {**SAMPLE["drop"], "rrp_tag": "BELOW_RRP", "rrp_delta_pct": "-10"}, CTX)
    assert "border:1px solid #3DDC97" in below.html


def test_free_drop_email_has_the_24h_upgrade_line():
    r = render("drop", {**SAMPLE["drop"], "tier": "free"}, CTX)
    line = (
        "You're seeing this 24 hours after Premium members. Upgrade for instant alerts: "
        "https://tcgtrade.com.au/premium/"
    )
    assert line in r.text
    assert "https://tcgtrade.com.au/premium/" in r.html


def test_user_content_is_escaped_in_html():
    r = render("message", {"title": "<script>x</script>", "body": "<img src=x onerror=alert(1)>"}, CTX)
    assert "<script>" not in r.html and "&lt;script&gt;" in r.html
    assert "<img" not in r.html


def test_site_url_env_is_used_for_links():
    ctx = RenderContext(site_url="http://localhost:3000", unsubscribe_token="t")
    r = render("message", SAMPLE["message"], ctx)
    assert "http://localhost:3000/messages/abc/" in r.text
    assert "http://localhost:3000/unsubscribe/?t=t" in r.text


def test_absolute_url_never_links_unsafe_schemes():
    site = "https://tcgtrade.com.au"
    assert absolute_url(site, "/drops/") == "https://tcgtrade.com.au/drops/"
    assert absolute_url(site, "https://www.target.com.au/p/1") == "https://www.target.com.au/p/1"
    assert absolute_url(site, "javascript:alert(1)") == "https://tcgtrade.com.au/"
    assert absolute_url(site, "//evil.example/") == "https://tcgtrade.com.au/"


def test_format_when_uses_melbourne_time():
    assert format_when("2026-09-28T01:05:00+00:00") == "Mon 28 Sep 2026, 11:05 am AEST"
    assert format_when("2026-12-01T01:05:00Z").endswith("AEDT")


AFFILIATE = (
    "https://www.ebay.com.au/sch/i.html?_nkw=charizard+psa+10&_sacat=183454&mkcid=1&mkrid=705-53470-19255-0"
    "&siteid=15&campid=5336728181&customid=c-123&toolid=10001&mkevt=1"
)


@pytest.mark.parametrize("template", TEMPLATES)
def test_emails_never_carry_ebay_affiliate_links(template):
    # docs/research/07 §E: EPN links in email need EPN's prior written approval.
    data = {**SAMPLE[template], "url": AFFILIATE, "body": f"Check eBay: {AFFILIATE}"}
    r = render(template, data, CTX)
    for part in (r.html, r.text):
        for param in ("campid", "mkrid", "mkcid", "customid", "toolid", "mkevt"):
            assert f"{param}=" not in part, (template, param)
        assert "rover.ebay" not in part
    if "ebay.com.au" in r.text:
        assert "_nkw=charizard+psa+10&_sacat=183454" in r.text  # the plain search link survives


def test_rover_links_become_their_target():
    from tcgworkers.email.templates import strip_affiliate

    rover = (
        "http://rover.ebay.com/rover/1/705-53470-19255-0/1?campid=5336728181&customid=x&toolid=10001"
        "&mpre=https%3A%2F%2Fwww.ebay.com.au%2Fitm%2F123%3Fmkevt%3D1"
    )
    assert strip_affiliate(rover) == "https://www.ebay.com.au/itm/123"
    assert (
        strip_affiliate("https://www.jbhifi.com.au/products/x?campid=1")
        == "https://www.jbhifi.com.au/products/x?campid=1"
    )
