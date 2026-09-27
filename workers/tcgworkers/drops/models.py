from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any


class Availability(StrEnum):
    UNKNOWN = "unknown"
    OUT_OF_STOCK = "out_of_stock"
    PREORDER = "preorder"
    IN_STOCK_ONLINE = "in_stock_online"
    IN_STOCK_CNC = "in_stock_cnc"  # click & collect only
    IN_STOCK_BOTH = "in_stock_both"

    @property
    def in_stock(self) -> bool:
        return self in (Availability.IN_STOCK_ONLINE, Availability.IN_STOCK_CNC, Availability.IN_STOCK_BOTH)

    @property
    def buyable(self) -> bool:
        return self.in_stock or self is Availability.PREORDER


class EventType(StrEnum):
    NEW_LISTING = "NEW_LISTING"
    PREORDER_OPEN = "PREORDER_OPEN"
    IN_STOCK = "IN_STOCK"
    PRICE_CHANGE = "PRICE_CHANGE"
    QUEUE_LIVE = "QUEUE_LIVE"


class RrpTag(StrEnum):
    AT_RRP = "AT_RRP"
    BELOW_RRP = "BELOW_RRP"
    ABOVE_RRP = "ABOVE_RRP"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class Observation:
    """One product as a retailer adapter saw it on one poll."""

    retailer: str
    sku: str
    url: str
    title: str
    availability: Availability
    price_aud: Decimal | None
    observed_at: datetime
    queue_live: bool = False
    is_marketplace_seller: bool = False
    raw: dict[str, Any] = field(default_factory=dict, compare=False)


@dataclass(frozen=True)
class ProductState:
    """The last stored state of a product (retail_product_states)."""

    availability: Availability
    price_aud: Decimal | None
    queue_live: bool
    observed_at: datetime


@dataclass(frozen=True)
class DropEvent:
    retailer: str
    sku: str
    url: str
    title: str
    event_type: EventType
    price_aud: Decimal | None
    previous_price_aud: Decimal | None
    occurred_at: datetime
    dedupe_key: str
    rrp_aud: Decimal | None = None
    rrp_tag: RrpTag = RrpTag.UNKNOWN
    rrp_delta_pct: Decimal | None = None
    game: str | None = None
    suppressed: bool = False
    suppressed_reason: str | None = None
