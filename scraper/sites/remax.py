"""Scraper de Remax Argentina (www.remax.com.ar).

El sitio es una SPA (Angular) que renderiza en el cliente: el HTML llega
vacío, así que en lugar de parsear HTML usamos la API JSON pública que
consume el propio frontend (api-ar.redremax.com).

La URL que el usuario copia del navegador
(https://www.remax.com.ar/listings/rent?page=0&pageSize=24&in:operationId=2&...)
ya trae todos los filtros como query params; se reenvían tal cual al
endpoint findAll de la API, ajustando solo la página (0-based).

Los nombres de campos del JSON pueden variar entre versiones de la API,
por eso el parseo es defensivo (varios nombres alternativos por campo).
"""

from __future__ import annotations

import json
from typing import Iterable, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit

from ..models import Listing, make_listing_id
from ..parsing import clean_text
from .base import BaseScraper

API_BASE = "https://api-ar.redremax.com/remaxweb-ar/api/listings/findAll"
WEB_BASE = "https://www.remax.com.ar/listings/"
CDN_BASE = "https://d1acdg20u0pmxj.cloudfront.net/"


def _first(item: dict, *keys):
    for key in keys:
        value = item.get(key)
        if value not in (None, "", []):
            return value
    return None


def _as_float(value) -> Optional[float]:
    try:
        result = float(value)
        return result if result > 0 else None
    except (TypeError, ValueError):
        return None


def _as_int(value) -> Optional[int]:
    try:
        result = int(float(value))
        return result if result > 0 else None
    except (TypeError, ValueError):
        return None


class RemaxScraper(BaseScraper):
    site = "remax"

    def _build_session(self):
        session = super()._build_session()
        session.headers["Accept"] = "application/json"
        return session

    def page_url(self, base_url: str, page: int) -> str:
        """Convierte la URL del sitio en la llamada a la API, pisando el
        número de página (la API es 0-based)."""
        parts = urlsplit(base_url)
        params = [
            (k, v)
            for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if k != "page"
        ]
        params.append(("page", str(page - 1)))
        if not any(k == "pageSize" for k, _ in params):
            params.append(("pageSize", "24"))
        return f"{API_BASE}?{urlencode(params)}"

    def parse(self, payload: str) -> Iterable[Listing]:
        try:
            body = json.loads(payload)
        except json.JSONDecodeError:
            return
        data = body.get("data") or {}
        items = data.get("data") if isinstance(data, dict) else data
        if not isinstance(items, list):
            return

        for item in items:
            if not isinstance(item, dict):
                continue
            slug = _first(item, "slug", "internalId")
            url = f"{WEB_BASE}{slug}" if slug else ""
            native_id = _first(item, "id", "listingId")
            if native_id:
                listing_id = f"{self.site}:{native_id}"
            elif url:
                listing_id = make_listing_id(self.site, url)
            else:
                continue

            currency_raw = item.get("currency")
            if isinstance(currency_raw, dict):
                currency_raw = _first(currency_raw, "value", "name")
            currency = None
            if currency_raw:
                currency = "USD" if "US" in str(currency_raw).upper() else "ARS"

            photo = ""
            photos = item.get("photos")
            if isinstance(photos, list) and photos:
                first_photo = photos[0]
                value = (
                    first_photo.get("value")
                    if isinstance(first_photo, dict)
                    else str(first_photo)
                )
                if value:
                    photo = value if str(value).startswith("http") else CDN_BASE + str(value)

            yield Listing(
                id=listing_id,
                site=self.site,
                url=url,
                title=clean_text(str(_first(item, "title", "displayAddress") or "")),
                price_amount=_as_float(_first(item, "price", "priceUsd")),
                price_currency=currency,
                expenses=_as_float(_first(item, "expensesPrice", "expenses")),
                address=clean_text(str(_first(item, "displayAddress", "address") or "")),
                rooms=_as_int(_first(item, "totalRooms", "rooms")),
                bedrooms=_as_int(_first(item, "bedrooms")),
                bathrooms=_as_int(_first(item, "bathrooms")),
                surface_m2=_as_float(
                    _first(item, "dimensionTotalBuilt", "dimensionCovered", "dimension")
                ),
                image=photo,
            )
