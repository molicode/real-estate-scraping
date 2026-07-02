"""Scraper de MercadoLibre Inmuebles (inmuebles.mercadolibre.com.ar).

Los resultados vienen server-side en tarjetas `li.ui-search-layout__item`
(componentes "poly-card"). El precio usa el componente andes-money-amount
y los atributos (dormitorios, m²) van en `ul.poly-attributes-list`.

Paginación por offset: se agrega `_Desde_49`, `_Desde_97`, ... al path
(48 resultados por página).
"""

from __future__ import annotations

import re
from typing import Iterable
from urllib.parse import urlsplit, urlunsplit

from bs4 import BeautifulSoup

from ..models import Listing, make_listing_id
from ..parsing import clean_text, parse_features, parse_price
from .base import BaseScraper

PAGE_SIZE = 48


class MercadoLibreScraper(BaseScraper):
    site = "mercadolibre"
    # MercadoLibre redirige a las IPs de datacenter (como los runners de
    # GitHub) a una página de "verificación de cuenta": hace falta proxy.
    proxy_fallback = True

    def is_blocked(self, resp) -> bool:
        return (
            "/gz/account-verification" in (resp.url or "")
            or "suspicious_traffic" in resp.text
        )

    def page_url(self, base_url: str, page: int) -> str:
        if page <= 1:
            return base_url
        offset = (page - 1) * PAGE_SIZE + 1
        parts = urlsplit(base_url)
        path = parts.path.rstrip("/")
        # Si la URL ya trae filtros con _ (ej. _PriceRange_...), el _Desde_
        # se agrega igual al final del path.
        path = f"{path}_Desde_{offset}"
        return urlunsplit((parts.scheme, parts.netloc, path, parts.query, ""))

    def parse(self, html: str) -> Iterable[Listing]:
        soup = BeautifulSoup(html, "lxml")
        cards = soup.select("li.ui-search-layout__item")
        for card in cards:
            anchor = card.select_one(
                "a.poly-component__title, h3 a[href], a.ui-search-link[href]"
            )
            if anchor is None or not anchor.get("href"):
                continue
            url = anchor["href"].split("#")[0]

            price_el = card.select_one(".poly-price__current .andes-money-amount, .andes-money-amount")
            amount, currency = None, None
            if price_el:
                symbol = price_el.select_one(".andes-money-amount__currency-symbol")
                fraction = price_el.select_one(".andes-money-amount__fraction")
                text = f"{symbol.get_text() if symbol else ''} {fraction.get_text() if fraction else price_el.get_text(' ')}"
                amount, currency = parse_price(text)
                if currency == "ARS" and symbol and "US" in symbol.get_text():
                    currency = "USD"

            title_el = card.select_one(".poly-component__title, h3, h2")
            address_el = card.select_one(".poly-component__location")

            attrs_el = card.select_one("ul.poly-attributes-list, .poly-component__attributes-list")
            features = parse_features(attrs_el.get_text(" · ") if attrs_el else "")
            # MercadoLibre suele mostrar "X dormitorios" pero no ambientes;
            # también acepta "X ambientes" según la categoría.
            if "rooms" not in features and attrs_el:
                m = re.search(r"(\d+)\s*ambiente", attrs_el.get_text(" "), re.IGNORECASE)
                if m:
                    features["rooms"] = int(m.group(1))

            img_el = card.select_one("img[data-src], img[src]")
            image = (img_el.get("data-src") or img_el.get("src") or "") if img_el else ""

            yield Listing(
                id=make_listing_id(self.site, url),
                site=self.site,
                url=url,
                title=clean_text(title_el.get_text(" ") if title_el else ""),
                price_amount=amount,
                price_currency=currency,
                address=clean_text(address_el.get_text(" ") if address_el else ""),
                image=image,
                **features,
            )
