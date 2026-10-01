"""Probe a store before adding it to the monitor (admin "Add store" flow, and
for checking the registry).

    python -m tcgworkers.drops.probe https://www.example.com.au
    python -m tcgworkers.drops.probe https://www.example.com.au --collection pokemon-tcg
    python -m tcgworkers.drops.probe https://shop.example --platform woocommerce --category 82 --json

1. reads robots.txt (and Crawl-delay) and says whether the catalogue feeds
   are allowed for our user agent;
2. detects the platform: Shopify (``/collections.json``) or WooCommerce (the
   Store API's ``/products/categories``), unless ``--platform`` is given;
3. lists candidate Pokémon / One Piece collections or categories with their
   product counts;
4. fetches ONE page of the chosen (or most likely) collection and prints the
   parsed observations, the sealed-product filter's verdict and the matcher's
   output.

Same honest user agent and politeness as the monitor (robots, >= 5 s between
requests, back-off on 429/403). A handful of requests per run, never a loop.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

from tcgworkers.config import Env
from tcgworkers.drops.adapters.catalogue import CatalogueAdapter
from tcgworkers.drops.adapters.shopify import PAGE_LIMIT, ShopifyAdapter, parse_page
from tcgworkers.drops.adapters.woocommerce import STORE_API, WooCommerceAdapter
from tcgworkers.drops.adapters.woocommerce import parse_product as parse_woo
from tcgworkers.drops.base import AdapterBlocked
from tcgworkers.drops.filters import classify, non_sealed_reason
from tcgworkers.drops.http import BackingOff, PoliteClient
from tcgworkers.drops.models import Observation
from tcgworkers.drops.products import Catalogue, analyse

_CANDIDATE = re.compile(r"pok[eé]mon|ptcg|one[\s-]?piece|optcg|\btcg\b|trading[\s-]?card", re.IGNORECASE)
MAX_COLLECTION_PAGES = 3


@dataclass
class Report:
    base_url: str
    platform: str | None = None
    robots: dict[str, Any] = field(default_factory=dict)
    candidates: list[dict[str, Any]] = field(default_factory=list)
    fetched: str | None = None
    products_on_page: int = 0
    observations: list[dict[str, Any]] = field(default_factory=list)
    blocked: str | None = None
    errors: list[str] = field(default_factory=list)
    page: Any = field(default=None, repr=False)  # the fetched page as served (for --save)

    def as_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items() if k != "page"}


def _origin(url: str) -> str:
    parts = urlsplit(url if "://" in url else f"https://{url}")
    if not parts.netloc:
        raise ValueError(f"not a URL: {url!r}")
    return f"https://{parts.netloc}"


def _row(obs: Observation, product_type: str, tags: list[str], catalogue: Catalogue) -> dict[str, Any]:
    c = classify(obs.title, game_hint=obs.game_hint)
    skip = non_sealed_reason(obs.title, product_type=product_type, tags=tags)
    a = analyse(obs.title, catalogue, game_hint=c.game or obs.game_hint, lang_hint=obs.lang_hint)
    return {
        "sku": obs.sku,
        "title": obs.title,
        "url": obs.url,
        "availability": obs.availability.value,
        "price_aud": str(obs.price_aud) if obs.price_aud is not None else None,
        "image_url": obs.image_url,
        "kept": skip is None and c.is_tcg,
        "why": skip or c.reason,
        "game": c.game,
        "match": a.match.slug if a.match else None,
        "match_name": a.match.name if a.match else None,
        "confidence": str(a.match.confidence) if a.match else None,
        "lang": a.lang,
        "match_reason": a.reason,
    }


def _shopify_candidates(
    adapter: CatalogueAdapter, client: PoliteClient, max_pages: int
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        data, _ = adapter.get_json(client, f"{adapter.base_url}/collections.json?limit=250&page={page}")
        cols = data.get("collections") if isinstance(data, dict) else None
        if not isinstance(cols, list):
            raise ValueError("not a Shopify collections.json")
        for c in cols:
            if isinstance(c, dict) and _CANDIDATE.search(f"{c.get('handle', '')} {c.get('title', '')}"):
                out.append(
                    {"handle": c.get("handle"), "title": c.get("title"), "count": c.get("products_count")}
                )
        if len(cols) < 250:
            break
    return out


def _woo_candidates(adapter: CatalogueAdapter, client: PoliteClient) -> list[dict[str, Any]]:
    data, _ = adapter.get_json(client, f"{adapter.base_url}{STORE_API}/categories?per_page=100")
    if not isinstance(data, list):
        raise ValueError("not a WooCommerce Store API category list")
    return [
        {"id": c.get("id"), "handle": c.get("slug"), "title": c.get("name"), "count": c.get("count")}
        for c in data
        if isinstance(c, dict) and _CANDIDATE.search(f"{c.get('slug', '')} {c.get('name', '')}")
    ]


def _best(candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Prefer a sealed Pokémon collection, then any Pokémon / One Piece one, by size."""

    def score(c: dict[str, Any]) -> tuple[int, int]:
        text = f"{c.get('handle', '')} {c.get('title', '')}".lower()
        s = 2 if re.search(r"pok[eé]mon|ptcg", text) else 1 if re.search(r"one.?piece|optcg", text) else 0
        s += 1 if "sealed" in text else 0
        s -= 2 if re.search(r"single|graded|lego|plush|accessor|break", text) else 0
        count = c.get("count")
        return s, count if isinstance(count, int) else 0

    usable = [c for c in candidates if not isinstance(c.get("count"), int) or c["count"] > 0]
    return max(usable, key=score) if usable else None


def probe(
    base_url: str,
    client: PoliteClient,
    *,
    platform: str | None = None,
    collection: str | None = None,
    catalogue: Catalogue | None = None,
    max_collection_pages: int = MAX_COLLECTION_PAGES,
) -> Report:
    origin = _origin(base_url)
    report = Report(origin)
    catalogue = catalogue or Catalogue.build()
    shopify = ShopifyAdapter(slug="probe", name=urlsplit(origin).netloc, base_url=origin)
    woo = WooCommerceAdapter(slug="probe", name=urlsplit(origin).netloc, base_url=origin)

    feeds = {
        "shopify": shopify.page_url(collection or "all", 1),
        "woocommerce": woo.page_url(collection or "1", 1),
    }
    report.robots = {name: client.allowed(url) for name, url in feeds.items()}
    report.robots["crawl_delay"] = client.crawl_delay(origin + "/")  # robots.txt already cached

    try:
        if platform in (None, "shopify") and report.robots["shopify"]:
            try:
                if collection is None:
                    report.candidates = _shopify_candidates(shopify, client, max_collection_pages)
                report.platform = "shopify"
            except (LookupError, ValueError) as exc:
                report.errors.append(f"shopify: {exc}")
        if report.platform is None and platform in (None, "woocommerce") and report.robots["woocommerce"]:
            try:
                if collection is None:
                    report.candidates = _woo_candidates(woo, client)
                report.platform = "woocommerce"
            except (LookupError, ValueError) as exc:
                report.errors.append(f"woocommerce: {exc}")
        if report.platform is None:
            if not (report.robots["shopify"] or report.robots["woocommerce"]):
                report.blocked = "robots: robots.txt disallows the catalogue feeds"
            return report

        chosen = collection
        if chosen is None:
            best = _best(report.candidates)
            chosen = str(best.get("id") or best.get("handle")) if best else None
            if report.platform == "shopify" and best:
                chosen = str(best.get("handle"))
        if not chosen:
            report.errors.append("no Pokémon / One Piece collection found; pass --collection")
            return report

        now = datetime.now(UTC)
        if report.platform == "shopify":
            url = shopify.page_url(chosen, 1)
            data, _ = shopify.get_json(client, url)
            report.fetched, report.page = url, data
            count, parsed = parse_page(
                data, retailer="probe", base_url=origin, collection=chosen, observed_at=now
            )
            report.products_on_page = count
            for obs, p in parsed:
                tags = p.get("tags") or []
                tags = tags.split(",") if isinstance(tags, str) else [str(t) for t in tags]
                report.observations.append(_row(obs, str(p.get("product_type") or ""), tags, catalogue))
            if count >= PAGE_LIMIT:
                report.errors.append("more pages exist (the monitor reads up to 8 per collection)")
        else:
            url = woo.page_url(chosen, 1)
            data, _ = woo.get_json(client, url)
            report.fetched, report.page = url, data
            items = [p for p in data if isinstance(p, dict)] if isinstance(data, list) else []
            report.products_on_page = len(items)
            for p in items:
                woo_obs = parse_woo(p, retailer="probe", category=chosen, observed_at=now)
                if woo_obs:
                    cats = [str(c.get("name")) for c in p.get("categories") or [] if isinstance(c, dict)]
                    tags = [str(t.get("name")) for t in p.get("tags") or [] if isinstance(t, dict)]
                    report.observations.append(_row(woo_obs, " ".join(cats), tags, catalogue))
    except AdapterBlocked as exc:
        report.blocked = str(exc)
    except BackingOff as exc:
        report.blocked = f"backing off: {exc}"
    except (LookupError, ValueError) as exc:
        report.errors.append(str(exc))
    return report


def render(report: Report) -> str:
    lines = [f"Store:     {report.base_url}", f"Platform:  {report.platform or 'not detected'}"]
    lines.append(
        "Robots:    "
        + ", ".join(
            f"{k}={'allowed' if v else 'disallowed'}" for k, v in report.robots.items() if k != "crawl_delay"
        )
        + (f", crawl-delay={report.robots['crawl_delay']}s" if report.robots.get("crawl_delay") else "")
    )
    if report.blocked:
        lines.append(f"BLOCKED:   {report.blocked}")
    if report.candidates:
        lines.append("Candidate collections / categories:")
        for c in report.candidates:
            ident = f"{c['id']} " if c.get("id") else ""
            lines.append(f"  {ident}{c.get('handle')}  ({c.get('count', '?')} products)  {c.get('title')}")
    if report.fetched:
        kept = [o for o in report.observations if o["kept"]]
        matched = [o for o in kept if o["match"]]
        lines.append(f"Fetched:   {report.fetched}")
        lines.append(
            f"Products:  {report.products_on_page} on the page, {len(kept)} kept as sealed TCG, {len(matched)} matched"
        )
        for o in report.observations:
            mark = "+" if o["kept"] else "-"
            price = f"A${o['price_aud']}" if o["price_aud"] else "no price"
            lines.append(f"  {mark} [{o['availability']}] {price}  {o['title']}")
            if o["kept"]:
                lines.append(f"      -> {o['match'] or 'unmatched'} ({o['match_reason']}; lang {o['lang']})")
            else:
                lines.append(f"      skipped: {o['why']}")
    for e in report.errors:
        lines.append(f"Note:      {e}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m tcgworkers.drops.probe")
    parser.add_argument("base_url")
    parser.add_argument("--platform", choices=("shopify", "woocommerce"))
    parser.add_argument("--collection", help="Shopify collection handle to fetch")
    parser.add_argument(
        "--category", help="WooCommerce category id or slug to fetch (implies --platform woocommerce)"
    )
    parser.add_argument("--json", action="store_true", help="print the report as JSON")
    parser.add_argument(
        "--save", metavar="PATH", help="also write the fetched page's JSON here (test fixtures)"
    )
    parser.add_argument(
        "--db", action="store_true", help="match against the DB set catalogue (DATABASE_URL) as well"
    )
    args = parser.parse_args(argv)

    env = Env.from_environ()
    catalogue = None
    if args.db and env.database_url:
        from tcgworkers.db import connect
        from tcgworkers.drops.products import load_catalogue

        with connect(env.database_url) as conn:
            catalogue = load_catalogue(conn)
    client = PoliteClient(user_agent=env.user_agent, min_delay=5.0, max_delay=8.0, cache_ttl=0)
    platform = "woocommerce" if args.category else "shopify" if args.collection else args.platform
    report = probe(
        args.base_url,
        client,
        platform=platform,
        collection=args.category or args.collection,
        catalogue=catalogue,
    )
    print(json.dumps(report.as_dict(), indent=2, default=str) if args.json else render(report))
    if args.save and report.page is not None:
        with open(args.save, "w", encoding="utf-8") as f:
            json.dump(report.page, f, indent=1, ensure_ascii=False)
    return 0 if report.platform and not report.blocked else 1


if __name__ == "__main__":
    sys.exit(main())
