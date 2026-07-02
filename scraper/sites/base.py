"""Scraper base: sesión HTTP, paginación y deduplicación por página."""

from __future__ import annotations

import logging
import random
import time
from typing import Iterable, Optional

import requests

from ..models import Listing, Search

logger = logging.getLogger(__name__)

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
]

DEFAULT_HEADERS = {
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8",
    "Accept-Language": "es-AR,es;q=0.9,en;q=0.5",
    "Cache-Control": "no-cache",
}


class BaseScraper:
    site = "base"
    request_timeout = 30
    delay_range = (1.0, 3.0)  # pausa entre páginas para no golpear al sitio

    def __init__(self, session: Optional[requests.Session] = None):
        self.session = session or self._build_session()

    def _build_session(self) -> requests.Session:
        session = requests.Session()
        session.headers.update(DEFAULT_HEADERS)
        session.headers["User-Agent"] = random.choice(USER_AGENTS)
        return session

    def fetch(self, url: str) -> Optional[str]:
        try:
            resp = self.session.get(url, timeout=self.request_timeout)
            if resp.status_code != 200:
                logger.warning("%s devolvió HTTP %s para %s", self.site, resp.status_code, url)
                return None
            return resp.text
        except requests.RequestException as exc:
            logger.warning("Error de red en %s (%s): %s", self.site, url, exc)
            return None

    def page_url(self, base_url: str, page: int) -> str:
        raise NotImplementedError

    def parse(self, html: str) -> Iterable[Listing]:
        raise NotImplementedError

    def search(self, search: Search) -> list[Listing]:
        """Recorre las páginas de la búsqueda y devuelve los avisos parseados."""
        results: list[Listing] = []
        seen_ids: set[str] = set()
        for page in range(1, max(1, search.max_pages) + 1):
            url = self.page_url(search.url, page)
            html = self.fetch(url)
            if html is None:
                break
            page_listings = list(self.parse(html))
            new = [l for l in page_listings if l.id not in seen_ids]
            if not new:
                # Página vacía o repetida (fin de resultados / paginación
                # que no avanza): cortamos.
                break
            for listing in new:
                listing.search_name = search.name
                seen_ids.add(listing.id)
            results.extend(new)
            if page < search.max_pages:
                time.sleep(random.uniform(*self.delay_range))
        logger.info("%s [%s]: %d avisos", self.site, search.name, len(results))
        return results
