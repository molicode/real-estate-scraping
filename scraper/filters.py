"""Filtros post-scraping aplicados sobre cada aviso.

Los portales ya filtran con su UI (la URL de búsqueda trae los filtros
nativos); estos filtros permiten afinar con criterios que la URL no cubre
o que queremos garantizar aunque el portal cambie.
"""

from __future__ import annotations

from typing import Any

from .models import Listing


def matches(listing: Listing, filters: dict[str, Any]) -> bool:
    if not filters:
        return True

    currency = filters.get("currency")
    if currency and listing.price_currency and listing.price_currency != currency:
        return False

    price_known = listing.price_amount is not None
    # Si se filtra por precio y la moneda del aviso no coincide con la
    # pedida, no comparamos números de monedas distintas: lo dejamos pasar
    # solo si no se exigió moneda.
    comparable = price_known and (
        not currency or listing.price_currency in (None, currency)
    )
    min_price = filters.get("min_price")
    if min_price is not None and comparable and listing.price_amount < min_price:
        return False
    max_price = filters.get("max_price")
    if max_price is not None and comparable and listing.price_amount > max_price:
        return False
    if filters.get("require_price") and not price_known:
        return False

    min_rooms = filters.get("min_rooms")
    if min_rooms is not None and listing.rooms is not None and listing.rooms < min_rooms:
        return False
    max_rooms = filters.get("max_rooms")
    if max_rooms is not None and listing.rooms is not None and listing.rooms > max_rooms:
        return False

    min_bedrooms = filters.get("min_bedrooms")
    if min_bedrooms is not None and listing.bedrooms is not None and listing.bedrooms < min_bedrooms:
        return False

    min_surface = filters.get("min_surface_m2")
    if min_surface is not None and listing.surface_m2 is not None and listing.surface_m2 < min_surface:
        return False

    haystack = f"{listing.title} {listing.address}".lower()
    for kw in filters.get("keywords_include", []) or []:
        if kw.lower() not in haystack:
            return False
    for kw in filters.get("keywords_exclude", []) or []:
        if kw.lower() in haystack:
            return False

    return True
