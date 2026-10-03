"""PriceCharting products -> catalogue links + price_points.

For every product:

1. **Console -> set.** ``pricecharting_consoles`` maps the console name to one
   of our sets. A new console is mapped automatically (``confirmed=false``)
   to a set with the same name in that game/language, or to a new
   ``auto_created`` set. Excluded consoles (Chinese/Korean Pokémon, One Piece
   Carddass, anything else) are recorded with the reason and skipped.
2. **Product -> card**, through the Matcher (brief 4.2):
   * already in ``card_external_ids`` -> that card;
   * ``auto``      -> a new ``card_external_ids`` row (match_method 'auto');
   * ``review``    -> ``mapping_queue`` (pending, with the suggestion); no
     prices until an admin decides;
   * ``unmatched`` -> a new ``auto_created`` card in the console's set, linked
     (match_method 'auto_created') and logged in ``mapping_queue`` with
     status 'created_card' so an admin can confirm or merge it.
   Products without a ``#number`` (sealed product, lots) are counted and
   skipped: they aren't singles. Rejected queue rows are skipped.
3. **Prices** in USD cents -> AUD at the latest RBA USD rate (refusing a rate
   older than ``pricecharting.fx_max_age_days``). ``pricecharting.store_types``
   (default both) controls how they're stored:
   * ``sold``: PriceCharting values are sold-based market values, so a
     daily snapshot row (observed_at = ingestion date) feeds floor.py's last
     sale and 30-day median. A new row is written only when the value changed
     or the last one is over 7 days old, to keep the table small.
   * ``ask``: one current row per card+grade (older ones replaced) so every
     priced card has an external-ask floor; marketplace listings still win.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from datetime import UTC, date, datetime, time
from decimal import ROUND_HALF_UP, Decimal
from difflib import SequenceMatcher
from typing import Any

import psycopg

from tcgworkers.config import Rules
from tcgworkers.matching.matcher import (
    CatalogueCard,
    ExternalRecord,
    Matcher,
    Status,
    normalise_name,
    normalise_number,
)
from tcgworkers.sources.pricing.pricecharting import (
    PRICE_FIELDS,
    SOURCE,
    ConsoleInfo,
    PcProduct,
    parse_console,
    parse_product_name,
    product_url,
)

log = logging.getLogger(__name__)

Conn = psycopg.Connection[dict[str, Any]]
SOLD_REFRESH_DAYS = 7


class StaleFx(RuntimeError):
    pass


@dataclass(frozen=True)
class Fx:
    rate_to_aud: Decimal
    date: date


def latest_usd_fx(conn: Conn, *, max_age_days: int, today: date) -> Fx:
    row = conn.execute(
        "select rate_to_aud, date from public.fx_rates where currency = 'USD' order by date desc limit 1"
    ).fetchone()
    if row is None:
        raise StaleFx("no USD rate in fx_rates: run the fx job first")
    if (today - row["date"]).days > max_age_days:
        raise StaleFx(f"latest USD rate is from {row['date']} (older than {max_age_days} days)")
    return Fx(row["rate_to_aud"], row["date"])


def _norm_set_name(name: str) -> str:
    v = unicodedata.normalize("NFKD", name)
    v = "".join(ch for ch in v if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", "", v)


@dataclass
class IngestStats:
    products: int = 0
    excluded_console: int = 0
    no_number: int = 0
    already_mapped: int = 0
    auto_linked: int = 0
    queued_for_review: int = 0
    rejected: int = 0
    auto_created_cards: int = 0
    auto_created_sets: int = 0
    new_consoles: int = 0
    priced_products: int = 0
    price_rows: int = 0
    asks_written: int = 0
    solds_written: int = 0
    not_linked: int = 0  # raw-only records for cards we don't have (never created or queued)


@dataclass(frozen=True)
class _Console:
    info: ConsoleInfo
    set_id: str | None
    set_code: str | None


class CatalogueIngestor:
    """What every price source shares: catalogue links (card_external_ids),
    the admin mapping queue, auto-created sets/cards, and price_points writes.
    A source subclass resolves its own sets and turns its records into
    ``_match_card`` calls and price rows."""

    source = ""  # card_external_ids.source / price_points.source
    settings_prefix = ""  # site_settings namespace, e.g. "pricecharting"
    set_code_prefix = ""  # code for auto-created sets, e.g. "pc-"

    def __init__(self, conn: Conn, *, rules: Rules, now: datetime | None = None) -> None:
        self.conn = conn
        self.rules = rules
        self.now = now or datetime.now(UTC)
        self.observed_at = datetime.combine(self.now.date(), time(0), UTC)
        types = rules.extra.get(f"{self.settings_prefix}.store_types", ["sold", "ask"])
        self.store_types = {
            t for t in (types if isinstance(types, list) else ["sold", "ask"]) if t in ("sold", "ask")
        }
        self.stats = IngestStats()
        self._loaded = False

    # ---------------------------------------------------------------- load
    def load(self) -> None:
        self._load_catalogue()
        self._loaded = True

    def _load_catalogue(self) -> None:
        c = self.conn
        self.mapped: dict[str, str] = {
            r["external_id"]: r["card_id"]
            for r in c.execute(
                "select external_id, card_id::text as card_id from public.card_external_ids where source = %s",
                (self.source,),
            )
        }
        self.queue: dict[str, str] = {
            r["external_id"]: r["status"]
            for r in c.execute(
                "select external_id, status::text as status from public.mapping_queue where source = %s",
                (self.source,),
            )
        }
        self.sets: dict[tuple[str, str, str], tuple[str, str]] = {}  # (game, lang, norm name) -> (id, code)
        for r in c.execute("select id::text as id, game, lang, code, name from public.sets"):
            self.sets.setdefault((r["game"], r["lang"], _norm_set_name(r["name"])), (r["id"], r["code"]))
        self.by_set: dict[str, list[CatalogueCard]] = defaultdict(list)
        self.by_number: dict[tuple[str, str, str], list[CatalogueCard]] = defaultdict(list)
        for r in c.execute(
            """select c.id::text as id, c.game, c.lang, c.set_id::text as set_id, s.code, c.number, c.variant, c.name
                 from public.cards c join public.sets s on s.id = c.set_id"""
        ):
            self._index(
                CatalogueCard(r["id"], r["game"], r["lang"], r["code"], r["number"], r["variant"], r["name"]),
                r["set_id"],
            )

    def _index(self, card: CatalogueCard, set_id: str) -> None:
        self.by_set[set_id].append(card)
        self.by_number[(card.game, card.lang, normalise_number(card.number))].append(card)

    def _set_for(self, game: str, lang: str, set_name: str) -> tuple[str, str]:
        key = (game, lang, _norm_set_name(set_name))
        if key in self.sets:
            return self.sets[key]
        code = self.set_code_prefix + re.sub(r"[^a-z0-9]+", "-", set_name.lower()).strip("-")[:60]
        row = None
        for suffix in ("", f"-{self.set_code_prefix.strip('-')}", f"-{self.source}"):
            row = self.conn.execute(
                """insert into public.sets (game, lang, code, name, slug, auto_created)
                   values (%s, %s, %s, %s, public.slugify(%s) || %s, true)
                   on conflict do nothing returning id::text as id, code""",
                (game, lang, code, set_name, set_name, suffix),
            ).fetchone()
            if row:
                break
            existing = self.conn.execute(
                "select id::text as id, code from public.sets where game = %s and lang = %s and code = %s",
                (game, lang, code),
            ).fetchone()
            if existing:
                row = existing
                break
        if row is None:
            raise RuntimeError(f"could not create a set for {game}/{lang} {set_name!r}")
        self.stats.auto_created_sets += 1
        self.sets[key] = (row["id"], row["code"])
        log.info("%s: auto-created set %s/%s %r (%s)", self.source, game, lang, set_name, row["code"])
        return row["id"], row["code"]

    # --------------------------------------------------------------- cards
    def _match_card(
        self,
        ext_id: str,
        *,
        game: str,
        lang: str,
        set_id: str,
        set_code: str,
        number: str,
        variant: str,
        name: str,
        payload: dict[str, Any],
        discover: bool = True,
    ) -> str | None:
        """Link, queue or create the catalogue card for one external record.
        With ``discover=False`` only a confident match links; nothing is
        queued or created."""
        if ext_id in self.mapped:
            self.stats.already_mapped += 1
            return self.mapped[ext_id]
        status = self.queue.get(ext_id)
        if status == "rejected":
            self.stats.rejected += 1
            return None
        record = ExternalRecord(self.source, ext_id, game, lang, set_code, number, variant, name)
        candidates = {c.id: c for c in self.by_set.get(set_id, [])}
        for c in self.by_number.get((game, lang, normalise_number(number)), []):
            candidates[c.id] = c
        decision = Matcher(candidates.values(), auto_accept=self.rules.market_matcher_auto_accept).match(
            record
        )

        if decision.status is Status.AUTO and decision.card_id:
            self._link(ext_id, decision.card_id, lang, variant, decision.confidence, "auto")
            if status == "pending":
                self.conn.execute(
                    """update public.mapping_queue set status = 'approved', resolved_card_id = %s, reviewed_at = now()
                        where source = %s and external_id = %s""",
                    (decision.card_id, self.source, ext_id),
                )
            self.stats.auto_linked += 1
            return decision.card_id

        if not discover:
            self.stats.not_linked += 1
            return None

        suggested, reasons = decision.card_id, list(decision.reasons)
        if decision.status is Status.UNMATCHED:
            # Sources name sets their own way ("Scarlet & Violet 151" vs our
            # "151"), so a set miss alone must not create a duplicate card:
            # same number + near-identical name goes to an admin instead.
            twin = _lookalike(candidates.values(), number, name)
            if twin:
                suggested = twin.id
                reasons.append(
                    f"same number and name as {twin.set_code} {twin.number}: check the set mapping"
                )

        if decision.status is Status.REVIEW or suggested:
            self._queue(ext_id, payload, game, lang, suggested, decision.confidence, reasons, "pending", None)
            self.stats.queued_for_review += 1
            return None

        card_id = self._create_card(set_id, game, lang, number, name, variant, ext_id)
        self._link(ext_id, card_id, lang, variant, None, "auto_created")
        self._queue(
            ext_id,
            payload,
            game,
            lang,
            None,
            decision.confidence,
            ["no catalogue match: card auto-created"],
            "created_card",
            card_id,
        )
        self._index(CatalogueCard(card_id, game, lang, set_code, number, variant, name), set_id)
        self.stats.auto_created_cards += 1
        return card_id

    def _link(
        self, ext_id: str, card_id: str, lang: str, variant: str, confidence: Decimal | None, method: str
    ) -> None:
        self.conn.execute(
            """insert into public.card_external_ids (card_id, source, external_id, lang, variant, match_confidence, match_method)
               values (%s, %s, %s, %s, %s, %s, %s) on conflict (source, external_id) do nothing""",
            (card_id, self.source, ext_id, lang, variant, confidence, method),
        )
        self.mapped[ext_id] = card_id

    def _queue(
        self,
        ext_id: str,
        payload: dict[str, Any],
        game: str,
        lang: str,
        suggested: str | None,
        confidence: Decimal,
        reasons: list[str],
        status: str,
        resolved: str | None,
    ) -> None:
        self.conn.execute(
            """insert into public.mapping_queue
                 (source, external_id, payload, game, lang, suggested_card_id, confidence, reasons, status, resolved_card_id)
               values (%s, %s, %s::jsonb, %s, %s, %s, %s, %s::jsonb, %s::public.mapping_status, %s)
               on conflict (source, external_id) do update set
                 payload = excluded.payload, suggested_card_id = excluded.suggested_card_id,
                 confidence = excluded.confidence, reasons = excluded.reasons
               where mapping_queue.status = 'pending'""",
            (
                self.source,
                ext_id,
                json.dumps(payload),
                game,
                lang,
                suggested,
                min(confidence, Decimal("0.999")),
                json.dumps(reasons),
                status,
                resolved,
            ),
        )
        self.queue[ext_id] = status

    def _create_card(
        self, set_id: str, game: str, lang: str, number: str, name: str, variant: str, ext_id: str
    ) -> str:
        base = f"{number} {name}" + ("" if variant == "standard" else f" {variant}")
        for slug_extra in ("", f" {ext_id[:12]}"):
            row = self.conn.execute(
                """insert into public.cards (set_id, game, lang, number, name, slug, variant, auto_created)
                   values (%s, %s, %s, %s, %s, public.slugify(%s), %s, true)
                   on conflict do nothing returning id::text as id""",
                (set_id, game, lang, number, name[:200], base + slug_extra, variant),
            ).fetchone()
            if row:
                return str(row["id"])
            existing = self.conn.execute(
                "select id::text as id from public.cards where set_id = %s and number = %s and variant = %s",
                (set_id, number, variant),
            ).fetchone()
            if existing:
                return str(existing["id"])
        raise RuntimeError(f"could not create a card for {self.source} {ext_id}")

    # -------------------------------------------------------------- prices
    def _write_prices(
        self, rows: list[tuple[str, str | None, Decimal | None, Decimal, Decimal, str, str | None]], fx: Fx
    ) -> None:
        """Current prices: rows are (card_id, grader, grade, price_usd, price_aud, source_ref, url)."""
        c = self.conn
        c.execute(
            """create temp table if not exists tmp_ext_prices (
                 card_id uuid, grader text, grade numeric(3, 1), price numeric(12, 2), price_aud numeric(12, 2),
                 source_ref text, url text) on commit drop"""
        )
        c.execute("truncate tmp_ext_prices")
        with (
            c.cursor() as cur,
            cur.copy(
                "copy tmp_ext_prices (card_id, grader, grade, price, price_aud, source_ref, url) from stdin"
            ) as copy,
        ):
            for row in rows:
                copy.write_row(row)
        params = {"obs": self.observed_at, "fx": fx.rate_to_aud, "fxd": fx.date, "src": self.source}
        if "ask" in self.store_types:
            c.execute(
                """delete from public.price_points p using tmp_ext_prices t
                    where p.source = %(src)s and p.type = 'ask' and p.source_ref = t.source_ref
                      and p.observed_at < %(obs)s""",
                params,
            )
            cur = c.execute(
                """insert into public.price_points (card_id, grader, grade, type, price, currency, fx_rate, fx_date,
                     price_aud, source, source_ref, url, observed_at)
                   select card_id, grader, grade, 'ask', price, 'USD', %(fx)s, %(fxd)s, price_aud, %(src)s,
                          source_ref, url, %(obs)s
                     from tmp_ext_prices
                   on conflict (source, source_ref, type, observed_at) where source_ref is not null do update set
                     card_id = excluded.card_id, price = excluded.price, price_aud = excluded.price_aud,
                     fx_rate = excluded.fx_rate, fx_date = excluded.fx_date""",
                params,
            )
            self.stats.asks_written += cur.rowcount
        if "sold" in self.store_types:
            cur = c.execute(
                f"""insert into public.price_points (card_id, grader, grade, type, price, currency, fx_rate, fx_date,
                      price_aud, source, source_ref, url, observed_at)
                    select t.card_id, t.grader, t.grade, 'sold', t.price, 'USD', %(fx)s, %(fxd)s, t.price_aud, %(src)s,
                           t.source_ref, t.url, %(obs)s
                      from tmp_ext_prices t
                      left join lateral (
                        select p.price, p.observed_at from public.price_points p
                         where p.source = %(src)s and p.type = 'sold' and p.source_ref = t.source_ref
                         order by p.observed_at desc limit 1) l on true
                     where l.observed_at is null
                        or (l.observed_at < %(obs)s
                            and (l.price <> t.price or l.observed_at < %(obs)s - interval '{SOLD_REFRESH_DAYS} days'))""",
                params,
            )
            self.stats.solds_written += cur.rowcount


class PcIngestor(CatalogueIngestor):
    source = SOURCE
    settings_prefix = "pricecharting"
    set_code_prefix = "pc-"

    # ---------------------------------------------------------------- load
    def load(self) -> None:
        c = self.conn
        self.consoles: dict[str, _Console] = {}
        for r in c.execute(
            """select pc.console_name, pc.game, pc.lang, pc.set_name, pc.set_id::text as set_id, s.code,
                      pc.excluded, pc.excluded_reason
                 from public.pricecharting_consoles pc left join public.sets s on s.id = pc.set_id"""
        ):
            info = ConsoleInfo(
                r["game"], r["lang"], r["set_name"], r["excluded_reason"] if r["excluded"] else None
            )
            if r["excluded"] and info.excluded_reason is None:
                info = ConsoleInfo(None, None, None, "excluded by an admin")
            self.consoles[r["console_name"]] = _Console(info, r["set_id"], r["code"])
        self._load_catalogue()
        self._loaded = True

    # ------------------------------------------------------------ consoles
    def _console(self, console_name: str) -> _Console:
        known = self.consoles.get(console_name)
        if known:
            return known
        info = parse_console(console_name)
        self.stats.new_consoles += 1
        if info.excluded or info.game is None or info.lang is None or info.set_name is None:
            self.conn.execute(
                """insert into public.pricecharting_consoles (console_name, excluded, excluded_reason)
                   values (%s, true, %s) on conflict (console_name) do nothing""",
                (console_name, info.excluded_reason),
            )
            console = _Console(info, None, None)
        else:
            set_id, code = self._set_for(info.game, info.lang, info.set_name)
            self.conn.execute(
                """insert into public.pricecharting_consoles (console_name, game, lang, set_name, set_id, confirmed)
                   values (%s, %s, %s, %s, %s, false) on conflict (console_name) do nothing""",
                (console_name, info.game, info.lang, info.set_name, set_id),
            )
            console = _Console(info, set_id, code)
        self.consoles[console_name] = console
        return console

    # --------------------------------------------------------------- cards
    def card_for(self, p: PcProduct) -> str | None:
        """The catalogue card for this product (creating/linking/queueing as needed)."""
        if not self._loaded:
            self.load()
        console = self._console(p.console_name)
        info = console.info
        if info.excluded or console.set_id is None or info.game is None or info.lang is None:
            self.stats.excluded_console += 1
            return None
        if p.id in self.mapped:
            self.stats.already_mapped += 1
            return self.mapped[p.id]
        if self.queue.get(p.id) == "rejected":
            self.stats.rejected += 1
            return None
        pn = parse_product_name(p.product_name)
        if not pn.number:
            self.stats.no_number += 1
            return None
        payload = {
            **p.payload(),
            "set_name": info.set_name,
            "number": pn.number,
            "variant": pn.variant,
            "variant_text": pn.variant_text,
            "name": pn.name,
        }
        return self._match_card(
            p.id,
            game=info.game,
            lang=info.lang,
            set_id=console.set_id,
            set_code=console.set_code or "",
            number=pn.number,
            variant=pn.variant,
            name=pn.name,
            payload=payload,
        )

    # -------------------------------------------------------------- prices
    def ingest(self, products: Iterable[PcProduct], fx: Fx) -> IngestStats:
        if not self._loaded:
            self.load()
        rows: list[tuple[str, str | None, Decimal | None, Decimal, Decimal, str, str | None]] = []
        for p in products:
            self.stats.products += 1
            card_id = self.card_for(p)
            if card_id is None or not p.prices:
                continue
            self.stats.priced_products += 1
            for key, cents in p.prices.items():
                grader, grade = PRICE_FIELDS[key]
                price = (Decimal(cents) / 100).quantize(Decimal("0.01"))
                price_aud = (price * fx.rate_to_aud).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                if price <= 0 or price_aud <= 0:
                    continue
                rows.append((card_id, grader, grade, price, price_aud, f"{p.id}:{key}", product_url(p.id)))
        self.stats.price_rows = len(rows)
        if rows:
            self._write_prices(rows, fx)
        return self.stats


def _lookalike(cards: Iterable[CatalogueCard], number: str, name: str) -> CatalogueCard | None:
    want_number, want_name = normalise_number(number), normalise_name(name)
    for c in cards:
        if normalise_number(c.number) != want_number:
            continue
        if SequenceMatcher(None, normalise_name(c.name), want_name).ratio() >= 0.8:
            return c
    return None


def stats_dict(stats: IngestStats) -> dict[str, int]:
    return asdict(stats)
