"""Scraper de Argenprop (www.argenprop.com).

Argenprop renderiza los resultados en el servidor: las tarjetas son
`div.listing__item` con un `a.card` que apunta al aviso.
La paginación se hace con el parámetro `pagina-N`.
"""

from __future__ import annotations

from typing import Iterable
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from ..models import Listing, make_listing_id
from ..parsing import clean_text, parse_features, parse_price
from .base import BaseScraper

BASE = "https://www.argenprop.com"


class ArgenpropScraper(BaseScraper):
    site = "argenprop"
    # Argenprop empezó a bloquear las IPs de los runners de GitHub (HTTP 403).
    # Con muchos jobs es total, así que reintentamos vía ScraperAPI cuando hay
    # key (igual que Zonaprop/MercadoLibre). Sin key, sigue intentando directo.
    proxy_fallback = True

    def page_url(self, base_url: str, page: int) -> str:
        if page <= 1:
            return base_url
        sep = "&" if "?" in base_url else "?"
        return f"{base_url}{sep}pagina-{page}"

    def parse(self, html: str) -> Iterable[Listing]:
        soup = BeautifulSoup(html, "lxml")
        cards = soup.select("div.listing__item") or soup.select("div[class*='listing-item']")
        for card in cards:
            anchor = card.select_one("a.card") or card.select_one("a[href]")
            if anchor is None or not anchor.get("href"):
                continue
            url = urljoin(BASE, anchor["href"])

            price_el = card.select_one(".card__price, [class*='price']")
            amount, currency = parse_price(price_el.get_text(" ") if price_el else "")

            title_el = card.select_one(".card__title, h2, h3")
            address_el = card.select_one(".card__address, [class*='address']")
            expenses_el = card.select_one(
                ".card__common-expenses, [class*='common-expenses']"
            )
            expenses, _ = parse_price(expenses_el.get_text(" ") if expenses_el else "")

            features_el = card.select_one(".card__main-features, ul[class*='features']")
            features = parse_features(features_el.get_text(" · ") if features_el else "")

            # Argenprop publica varias fotos por aviso en el listado
            # (carrusel con lazy-load: la primera trae src, el resto data-src)
            images: list[str] = []
            for img in card.select(".card__photos img") or card.select("img"):
                src = img.get("data-src") or img.get("src") or ""
                if src and "placeholder" not in src and src not in images:
                    images.append(src)
                if len(images) >= 5:
                    break
            image = images[0] if images else ""

            yield Listing(
                id=make_listing_id(self.site, url),
                site=self.site,
                url=url,
                title=clean_text(title_el.get_text(" ") if title_el else ""),
                price_amount=amount,
                price_currency=currency,
                expenses=expenses,
                address=clean_text(address_el.get_text(" ") if address_el else ""),
                image=image,
                images=images,
                **features,
            )
