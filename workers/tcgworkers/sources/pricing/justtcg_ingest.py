"""JustTCG records -> catalogue links + price_points (+ a one-off history backfill).

Same rules as PriceCharting (see ingest.py), with JustTCG's shapes:

1. **Set -> our set.** ``justtcg_sets`` maps (JustTCG set id, language) to
   one of our sets; a new one is mapped by name (``confirmed = false``) to a
   set with the same name, or to a new ``auto_created`` set coded ``jt-...``.
   An admin can exclude a set.
2. **Record -> card** through the shared Matcher path: link, queue for an
   admin, or auto-create (``CatalogueIngestor._match_card``). Records without
   a card number (sealed product) are skipped.
3. **Prices** (USD) -> AUD at the latest RBA rate, stored per grader and
   grade (``psa-10``, ``bgs-9.5``, ``cgc-10``...), as ``sold`` daily snapshots
   and current ``ask`` values, like PriceCharting.
4. **TCGplayer id**: each linked card keeps JustTCG's ``external_ids.tcgplayer``
   (``cards.tcgplayer_id``), the images job's exact last-resort image.
5. **History** (once per set): JustTCG's ``price_history`` points become
   ``sold`` rows dated on their own day, converted at that day's RBA rate
   (or the closest earlier one), and the value-history chart gets a
   ``market_cap_snapshots`` row per past day (population unknown).
"""

from __future__ import annotations

import bisect
import logging
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from tcgworkers.sources.pricing.ingest import CatalogueIngestor, Conn, Fx, IngestStats
from tcgworkers.sources.pricing.justtcg import SOURCE, JtGame, JtRecord

log = logging.getLogger(__name__)
CENT = Decimal("0.01")


def tcgplayer_id(value: Any) -> int | None:
    """JustTCG's ``external_ids.tcgplayer`` (a number or a numeric string) -> int."""
    text = str(value).strip() if value is not None and not isinstance(value, bool) else ""
    return int(text) if re.fullmatch(r"[0-9]{1,15}", text) and int(text) > 0 else None


@dataclass(frozen=True)
class _JtSet:
    set_id: str | None
    code: str | None
    excluded: bool


class FxHistory:
    """USD->AUD by day: the rate on that day, else the closest earlier one."""

    def __init__(self, rates: Iterable[tuple[date, Decimal]]) -> None:
        pairs = sorted(rates)
        self.days = [d for d, _ in pairs]
        self.rates = [r for _, r in pairs]

    @classmethod
    def load(cls, conn: Conn) -> FxHistory:
        return cls(
            (r["date"], r["rate_to_aud"])
            for r in conn.execute("select date, rate_to_aud from public.fx_rates where currency = 'USD'")
        )

    def at(self, day: date) -> tuple[Decimal, date] | None:
        i = bisect.bisect_right(self.days, day) - 1
        return (self.rates[i], self.days[i]) if i >= 0 else None


@dataclass
class HistoryStats:
    points: int = 0
    written: int = 0
    no_fx: int = 0
    snapshots: int = 0


class JtIngestor(CatalogueIngestor):
    source = SOURCE
    settings_prefix = "justtcg"
    set_code_prefix = "jt-"

    def __init__(self, conn: Conn, **kw: Any) -> None:
        super().__init__(conn, **kw)
        self.history = HistoryStats()

    def load(self) -> None:
        self.jt_sets: dict[tuple[str, str], _JtSet] = {}
        for r in self.conn.execute(
            """select j.justtcg_set_id, j.lang, j.set_id::text as set_id, s.code, j.excluded
                 from public.justtcg_sets j left join public.sets s on s.id = j.set_id"""
        ):
            self.jt_sets[(r["justtcg_set_id"], r["lang"])] = _JtSet(r["set_id"], r["code"], r["excluded"])
        self._load_catalogue()
        self._loaded = True

    def _jt_set(self, rec: JtRecord, game: JtGame) -> _JtSet:
        key = (rec.set_id, rec.lang)
        known = self.jt_sets.get(key)
        if known and (known.excluded or known.set_id is not None):
            return known
        self.stats.new_consoles += 1
        set_id, code = self._set_for(rec.game, rec.lang, rec.set_name)
        self.conn.execute(
            """insert into public.justtcg_sets (justtcg_set_id, justtcg_game, game, lang, set_name, set_id, confirmed)
               values (%s, %s, %s, %s, %s, %s, false)
               on conflict (justtcg_set_id, lang) do update set set_id = excluded.set_id
               where justtcg_sets.set_id is null and not justtcg_sets.excluded""",
            (rec.set_id, game.api_id, rec.game, rec.lang, rec.set_name, set_id),
        )
        jt = _JtSet(set_id, code, False)
        self.jt_sets[key] = jt
        return jt

    def card_for(self, rec: JtRecord, game: JtGame, *, discover: bool = True) -> str | None:
        if not self._loaded:
            self.load()
        jt = self._jt_set(rec, game)
        if jt.excluded or jt.set_id is None:
            self.stats.excluded_console += 1
            return None
        if rec.external_id in self.mapped:
            self.stats.already_mapped += 1
            return self.mapped[rec.external_id]
        if not rec.number:
            self.stats.no_number += 1
            return None
        return self._match_card(
            rec.external_id,
            game=rec.game,
            lang=rec.lang,
            set_id=jt.set_id,
            set_code=jt.code or "",
            number=rec.number,
            variant=rec.variant,
            name=rec.name,
            payload=rec.payload(),
            discover=discover,
        )

    def ingest(
        self,
        records: Iterable[tuple[JtRecord, JtGame]],
        fx: Fx,
        *,
        fx_history: FxHistory | None = None,
        discover: bool = True,
    ) -> IngestStats:
        """Current prices for every record; with ``fx_history``, also backfill each
        record's price history. ``discover=False`` (raw prices) only prices cards
        we already have: it never queues or creates catalogue cards."""
        if not self._loaded:
            self.load()
        rows: list[tuple[str, str | None, Decimal | None, Decimal, Decimal, str, str | None]] = []
        history: list[tuple[str, str | None, Decimal | None, Decimal, Decimal, str, date, Decimal, date]] = []
        tcgplayer: dict[str, int] = {}
        for rec, game in records:
            self.stats.products += 1
            card_id = self.card_for(rec, game, discover=discover)
            if card_id is not None and (tid := tcgplayer_id(rec.tcgplayer_id)):
                tcgplayer.setdefault(card_id, tid)
            if card_id is None or not rec.prices:
                continue
            self.stats.priced_products += 1
            for key, p in rec.prices.items():
                price_aud = (p.price_usd * fx.rate_to_aud).quantize(CENT, rounding=ROUND_HALF_UP)
                if p.price_usd <= 0 or price_aud <= 0:
                    continue
                ref = f"{rec.external_id}:{key}"
                rows.append((card_id, p.grader, p.grade, p.price_usd, price_aud, ref, None))
                if fx_history is None:
                    continue
                for t, usd in p.history:
                    day = t.date()
                    if day >= self.observed_at.date():
                        continue  # today is the current price above
                    self.history.points += 1
                    rate = fx_history.at(day)
                    if rate is None:
                        self.history.no_fx += 1
                        continue
                    aud = (usd * rate[0]).quantize(CENT, rounding=ROUND_HALF_UP)
                    if aud > 0:
                        history.append((card_id, p.grader, p.grade, usd, aud, ref, day, rate[0], rate[1]))
        self.stats.price_rows += len(rows)
        if rows:
            self._write_prices(rows, fx)
        if history:
            self._write_history(history)
        if tcgplayer:
            self._write_tcgplayer_ids(tcgplayer)
        return self.stats

    def _write_tcgplayer_ids(self, ids: dict[str, int]) -> None:
        """Each linked card's TCGplayer product id (the images job uses it for
        cards no open source has an image for). The first id a card gets stays."""
        with self.conn.cursor() as cur:
            cur.executemany(
                "update public.cards set tcgplayer_id = %s where id = %s and tcgplayer_id is null",
                [(tid, card_id) for card_id, tid in ids.items()],
            )

    def _write_history(
        self, rows: list[tuple[str, str | None, Decimal | None, Decimal, Decimal, str, date, Decimal, date]]
    ) -> None:
        """Past daily prices as 'sold' rows (one per source_ref per day), and
        value-history snapshots for days we have no snapshot for yet."""
        c = self.conn
        # The last point of each day wins (JustTCG can observe a price more than once a day).
        by_day: dict[
            tuple[str, date],
            tuple[str, str | None, Decimal | None, Decimal, Decimal, str, date, Decimal, date],
        ] = {}
        for r in rows:
            by_day[(r[5], r[6])] = r
        c.execute(
            """create temp table if not exists tmp_ext_history (
                 card_id uuid, grader text, grade numeric(3, 1), price numeric(12, 2), price_aud numeric(12, 2),
                 source_ref text, day date, fx_rate numeric(14, 8), fx_date date) on commit drop"""
        )
        c.execute("truncate tmp_ext_history")
        with (
            c.cursor() as cur,
            cur.copy(
                "copy tmp_ext_history (card_id, grader, grade, price, price_aud, source_ref, day, fx_rate, fx_date) from stdin"
            ) as copy,
        ):
            for r in by_day.values():
                copy.write_row(r)
        cur = c.execute(
            """insert into public.price_points (card_id, grader, grade, type, price, currency, fx_rate, fx_date,
                 price_aud, source, source_ref, url, observed_at)
               select card_id, grader, grade, 'sold', price, 'USD', fx_rate, fx_date, price_aud, %(src)s,
                      source_ref, null, (day::timestamp at time zone 'UTC')
                 from tmp_ext_history
               on conflict (source, source_ref, type, observed_at) where source_ref is not null do nothing""",
            {"src": self.source},
        )
        self.history.written += cur.rowcount
        # Value history: one row per card, grade and past day, from the day's
        # price. Population is unknown for past days; real snapshots (made
        # daily by the snapshots job) are never overwritten.
        cur = c.execute(
            """insert into public.market_cap_snapshots (card_id, grade_key, date, population, floor_aud, basis,
                 market_cap_aud, fx_date)
               select distinct on (card_id, public.grade_key(grader, grade), day)
                      card_id, public.grade_key(grader, grade), day, null, price_aud, 'last_sale', null, fx_date
                 from tmp_ext_history
                order by card_id, public.grade_key(grader, grade), day, price_aud
               on conflict (card_id, grade_key, date) do nothing"""
        )
        self.history.snapshots += cur.rowcount
