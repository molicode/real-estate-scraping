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

import json
import logging
import re
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
    # Cloudflare suele devolver 403 a los runners de GitHub: con el secret
    # SCRAPERAPI_KEY configurado se reintenta vía proxy.
    proxy_fallback = True
    # La grilla de resultados solo trae 1 foto por aviso; la galería completa
    # está en la página de detalle (se enriquece acotado, como MercadoLibre).
    detail_supported = True

    def parse_detail(self, html: str) -> dict:
        """Galería completa desde el detalle del aviso: primero los datos
        estructurados (JSON-LD `image`), si no las <img> del CDN de fotos."""
        images: list[str] = []
        seen: set[str] = set()
        for m in re.finditer(
            r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
            html, re.DOTALL | re.IGNORECASE,
        ):
            try:
                obj = json.loads(m.group(1).strip())
            except ValueError:
                continue
            for o in (obj if isinstance(obj, list) else [obj]):
                if not isinstance(o, dict) or not o.get("image"):
                    continue
                imgs = o["image"] if isinstance(o["image"], list) else [o["image"]]
                for u in imgs:
                    if isinstance(u, str) and u.startswith("http") and u not in seen:
                        seen.add(u)
                        images.append(u)
        if len(images) <= 1:
            soup = BeautifulSoup(html, "lxml")
            for im in soup.select("img"):
                src = im.get("data-src") or im.get("src") or ""
                low = src.lower()
                if not src.startswith("http") or ("naventcdn" not in low and "zonapropcdn" not in low):
                    continue
                if any(bad in low for bad in ("logo", ".svg", "sprite", "/icon")):
                    continue
                if src not in seen:
                    seen.add(src)
                    images.append(src)
        return {"images": images[:40]}

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

            # La tarjeta trae toda la galería del carrusel (flickity): cada foto
            # queda en data-flickity-lazyload (o data-src/src). Las juntamos
            # todas (gratis, sin bajar el detalle). No filtramos por CDN porque
            # Zonaprop sirve las fotos desde naventcdn/otros dominios; en cambio
            # descartamos logos, íconos y placeholders.
            gallery = card.select_one(
                "[data-qa='POSTING_CARD_GALLERY'], .flickity-slider, .postingCardGallery"
            ) or card
            images: list[str] = []
            seen: set[str] = set()
            for im in gallery.select("img"):
                src = im.get("data-flickity-lazyload") or im.get("data-src") or im.get("src") or ""
                if not src.startswith("http"):
                    continue
                low = src.lower()
                if any(bad in low for bad in ("placeholder", "logo", ".svg", "sprite", "/icon")):
                    continue
                if src not in seen:
                    seen.add(src)
                    images.append(src)
                if len(images) >= 20:
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
                address=clean_text(location_el.get_text(" ") if location_el else ""),
                image=image,
                images=images,
                **features,
            )
