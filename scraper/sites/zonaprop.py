"""Scraper de Zonaprop (www.zonaprop.com.ar).

Zonaprop está detrás de protección anti-bots (Cloudflare/DataDome), por eso
usamos `cloudscraper` en lugar de `requests`. Aun así puede bloquear
IPs de datacenter: el scraper falla de forma controlada y el resto de las
búsquedas siguen funcionando.

Las tarjetas usan atributos `data-qa`:
  - contenedor: div[data-qa="posting PROPERTY"] (con `data-to-posting` = URL)
  - precio:     [data-qa="POSTING_CARD_PRICE"]
  - ubicación:  [data-qa="POSTING_CARD_LOCATION"]
  - features:   [data-qa="POSTING_CARD_FEATURES"]

Paginación: 'lista.html' -> 'lista-pagina-2.html'.
"""

from __future__ import annotations

import logging
from typing import Iterable
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from ..models import Listing, make_listing_id
from ..parsing import clean_text, parse_features, parse_price
from .base import BaseScraper, DEFAULT_HEADERS

logger = logging.getLogger(__name__)

BASE = "https://www.zonaprop.com.ar"


class ZonapropScraper(BaseScraper):
    site = "zonaprop"

    def _build_session(self):
        try:
            import cloudscraper

            session = cloudscraper.create_scraper(
                browser={"browser": "chrome", "platform": "windows", "mobile": False}
            )
            session.headers.update(DEFAULT_HEADERS)
            return session
        except Exception as exc:  # pragma: no cover - fallback defensivo
            logger.warning("No se pudo crear cloudscraper (%s); uso requests", exc)
            return super()._build_session()

    def page_url(self, base_url: str, page: int) -> str:
        if page <= 1:
            return base_url
        if base_url.endswith(".html"):
            return f"{base_url[:-5]}-pagina-{page}.html"
        return f"{base_url.rstrip('/')}-pagina-{page}"

    def parse(self, html: str) -> Iterable[Listing]:
        soup = BeautifulSoup(html, "lxml")
        cards = soup.select("div[data-qa='posting PROPERTY']") or soup.select(
            "div[data-posting-type]"
        )
        for card in cards:
            path = card.get("data-to-posting")
            if not path:
                anchor = card.select_one("a[href*='.html']")
                path = anchor["href"] if anchor else None
            if not path:
                continue
            url = urljoin(BASE, path)

            price_el = card.select_one("[data-qa='POSTING_CARD_PRICE']")
            amount, currency = parse_price(price_el.get_text(" ") if price_el else "")

            expenses_el = card.select_one("[data-qa='expensas']")
            expenses, _ = parse_price(expenses_el.get_text(" ") if expenses_el else "")

            location_el = card.select_one("[data-qa='POSTING_CARD_LOCATION']")
            title_el = card.select_one("[data-qa='POSTING_CARD_DESCRIPTION'], h2, h3")

            features_el = card.select_one("[data-qa='POSTING_CARD_FEATURES']")
            features = parse_features(features_el.get_text(" · ") if features_el else "")

            img_el = card.select_one("img[data-flickity-lazyload], img[src]")
            image = (
                (img_el.get("data-flickity-lazyload") or img_el.get("src") or "")
                if img_el
                else ""
            )

            yield Listing(
                id=make_listing_id(self.site, url),
                site=self.site,
                url=url,
                title=clean_text(title_el.get_text(" ") if title_el else ""),
                price_amount=amount,
                price_currency=currency,
                expenses=expenses,
                address=clean_text(location_el.get_text(" ") if location_el else ""),
                image=image,
                **features,
            )
