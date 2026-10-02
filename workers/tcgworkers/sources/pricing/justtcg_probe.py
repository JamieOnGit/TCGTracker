"""What JustTCG actually returns for one set, for diagnosing an empty import.

    fly ssh console -C "python -m tcgworkers.sources.pricing.justtcg_probe"
    fly ssh console -C "python -m tcgworkers.sources.pricing.justtcg_probe sv-scarlet-violet-151-pokemon pokemon"

Makes 4 requests (one set list, then one card page each with graded=only,
graded=include and no graded param) and prints a summary of each response:
status, rate-limit and paging headers, ``meta``, how many cards and variants
came back by type, and the first card with a price. Never prints the key.
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from typing import Any

import httpx

from tcgworkers.config import Env
from tcgworkers.sources.pricing.justtcg import BASE_URL

HEADERS = ("ratelimit", "ratelimit-policy", "link", "x-total-count", "x-ratelimit-remaining", "warning")


def summarise(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        return {"body_type": type(body).__name__}
    data = body.get("data")
    cards = [c for c in data if isinstance(c, dict)] if isinstance(data, list) else []
    kinds: Counter[str] = Counter()
    priced: Counter[str] = Counter()
    companies: Counter[str] = Counter()
    sample = None
    for c in cards:
        for v in c.get("variants") or []:
            if not isinstance(v, dict):
                continue
            kind = str(v.get("type"))
            kinds[kind] += 1
            if v.get("grading"):
                companies[str((v.get("grading") or {}).get("company"))] += 1
            markets = v.get("markets") or []
            if any(isinstance(m, dict) and m.get("price") is not None for m in markets):
                priced[kind] += 1
                if sample is None:
                    sample = {
                        "card": c.get("name"),
                        "number": c.get("number"),
                        "variant": {
                            k: v.get(k) for k in ("type", "condition", "printing", "language", "grading")
                        },
                        "markets": [
                            {k: m.get(k) for k in ("region", "currency", "price")} for m in markets[:2]
                        ],
                    }
    return {
        "top_level_keys": sorted(body),
        "meta": body.get("meta"),
        "cards": len(cards),
        "cards_without_variants": sum(1 for c in cards if not c.get("variants")),
        "variants_by_type": dict(kinds),
        "variants_with_a_price": dict(priced),
        "graded_companies": dict(companies),
        "first_card_keys": sorted(cards[0]) if cards else None,
        "first_priced": sample,
        **{k: body[k] for k in body if k not in ("data", "meta")},
    }


def main(argv: list[str]) -> int:
    env = Env.from_environ()
    key = env.justtcg_api_key
    if not key:
        print("JUSTTCG_API_KEY is not set on this machine")
        return 1
    game = argv[1] if len(argv) > 1 else "pokemon"
    http = httpx.Client(
        base_url=BASE_URL,
        timeout=30,
        headers={"User-Agent": env.user_agent, "Accept": "application/json", "x-api-key": key},
    )

    def call(path: str, params: dict[str, Any]) -> Any:
        r = http.get(path, params=params)
        try:
            body: Any = r.json()
        except ValueError:
            body = r.text[:300]
        print(f"\n=== GET {path} {params} -> HTTP {r.status_code}")
        print("headers:", {h: r.headers[h] for h in HEADERS if h in r.headers})
        return body

    set_id = argv[0] if argv else None
    sets = call("/v1/sets", {"game": game, "limit": 100})
    rows = sets.get("data") if isinstance(sets, dict) else None
    print(
        "sets meta:", sets.get("meta") if isinstance(sets, dict) else sets, "| sets on page:", len(rows or [])
    )
    if not set_id and rows:
        # The set with the most cards, so there is something to see.
        best = max(rows, key=lambda s: s.get("cards_count") or s.get("count") or 0)
        set_id = best.get("id")
        print("first set:", json.dumps(rows[0])[:400])
    if not set_id:
        print("no set to probe")
        return 1
    for graded in ("only", "include", None):
        params: dict[str, Any] = {"game": game, "set": set_id, "limit": 20}
        if graded:
            params["graded"] = graded
        body = call("/v2/cards", params)
        print(json.dumps(summarise(body), indent=1, default=str)[:3000].replace(key, "***"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
