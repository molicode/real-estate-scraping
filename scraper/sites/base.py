"""Scraper base: sesión HTTP, paginación y deduplicación por página."""

from __future__ import annotations

import logging
import os
import random
import time
from typing import Iterable, Optional
from urllib.parse import urlencode

import requests

from ..models import Listing, Search

logger = logging.getLogger(__name__)

# Proxy de scraping opcional (ScraperAPI): se activa definiendo el secret
# SCRAPERAPI_KEY. Solo se usa como reintento cuando el sitio bloquea el
# acceso directo, para no gastar créditos de más.
SCRAPERAPI_ENDPOINT = "https://api.scraperapi.com/"

# Motor de navegador real (Playwright) como alternativa al proxy. Se activa con
# USE_PLAYWRIGHT=1 (pensado para correr desde una IP residencial, sin ScraperAPI).
USE_PLAYWRIGHT = os.environ.get("USE_PLAYWRIGHT", "").strip().lower() in ("1", "true", "yes")

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
    proxy_timeout = 70  # ScraperAPI recomienda timeouts largos
    delay_range = (1.0, 3.0)  # pausa entre páginas para no golpear al sitio
    proxy_fallback = False  # sitios que bloquean IPs de datacenter
    detail_supported = False  # si sabe enriquecer un aviso desde su detalle
    # Motor por portal: solo los que lo declaran usan el navegador (Playwright)
    # cuando USE_PLAYWRIGHT está activo. El resto sigue con requests(+proxy).
    # Empíricamente: MercadoLibre pasa su anti-bot con navegador real desde la
    # IP de GitHub (sin ScraperAPI); Zonaprop no (DataDome), así que ese queda
    # con proxy; Argenprop/Remax andan con requests.
    browser_engine = False

    def __init__(self, session: Optional[requests.Session] = None):
        self.session = session or self._build_session()
        self.proxy_key = os.environ.get("SCRAPERAPI_KEY", "").strip()

    def _build_session(self) -> requests.Session:
        session = requests.Session()
        session.headers.update(DEFAULT_HEADERS)
        session.headers["User-Agent"] = random.choice(USER_AGENTS)
        return session

    def is_blocked(self, resp: requests.Response) -> bool:
        """Detecta respuestas 200 que en realidad son páginas de bloqueo
        (captcha, verificación anti-bots). Cada sitio define sus marcas."""
        return False

    def _proxy_url(self, url: str) -> str:
        return f"{SCRAPERAPI_ENDPOINT}?{urlencode({'api_key': self.proxy_key, 'url': url})}"

    def _get(self, url: str, timeout: Optional[int] = None) -> Optional[str]:
        try:
            resp = self.session.get(url, timeout=timeout or self.request_timeout)
            if resp.status_code != 200:
                logger.warning("%s devolvió HTTP %s para %s", self.site, resp.status_code, url)
                return None
            if self.is_blocked(resp):
                logger.warning("%s bloqueó el acceso directo (página anti-bots) para %s", self.site, url)
                return None
            return resp.text
        except requests.RequestException as exc:
            logger.warning("Error de red en %s (%s): %s", self.site, url, exc)
            return None

    def _browser_get(self, url: str) -> Optional[str]:
        """Baja el HTML con un navegador real (Playwright). Reutiliza is_blocked
        pasándole un objeto con los mismos atributos que una Response."""
        from .. import browser as browser_engine  # import perezoso

        result = browser_engine.fetch_html(url, timeout=self.proxy_timeout)
        if not result:
            return None
        html, final_url = result

        class _Resp:  # shim para reusar la lógica de bloqueo de cada sitio
            pass

        resp = _Resp()
        resp.url = final_url
        resp.text = html
        resp.status_code = 200
        if self.is_blocked(resp):
            logger.warning("%s: el navegador también fue bloqueado en %s", self.site, url)
            return None
        return html

    def fetch(self, url: str) -> Optional[str]:
        # Portales que rinden con navegador real (ej. MercadoLibre): Playwright
        # en vez de proxy, así no gastan créditos de ScraperAPI.
        if USE_PLAYWRIGHT and self.browser_engine:
            return self._browser_get(url)
        text = self._get(url)
        if text is None and self.proxy_fallback and self.proxy_key:
            logger.info("%s: reintentando vía proxy de scraping", self.site)
            text = self._get(self._proxy_url(url), timeout=self.proxy_timeout)
        return text

    def page_url(self, base_url: str, page: int) -> str:
        raise NotImplementedError

    def parse(self, html: str) -> Iterable[Listing]:
        raise NotImplementedError

    def parse_detail(self, html: str) -> dict:
        """Extrae datos extra de la página de detalle de un aviso (galería
        completa, identidad verificada, etc.). Por defecto no hace nada."""
        return {}

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
            if not page_listings and page == 1:
                # Algunos portales sirven páginas vacías de forma
                # intermitente (según User-Agent o rate-limiting):
                # un reintento con sesión nueva suele alcanzar.
                logger.info("%s: página 1 sin avisos; reintento con sesión nueva", self.site)
                time.sleep(random.uniform(2.0, 4.0))
                self.session = self._build_session()
                html = self.fetch(url)
                page_listings = list(self.parse(html)) if html else []
            new = [l for l in page_listings if l.id not in seen_ids]
            if not new:
                # Página vacía o repetida (fin de resultados / paginación
                # que no avanza): cortamos.
                break
            for listing in new:
                listing.search_name = search.name
                listing.operation = search.operation
                seen_ids.add(listing.id)
            results.extend(new)
            if page < search.max_pages:
                time.sleep(random.uniform(*self.delay_range))
        logger.info("%s [%s]: %d avisos", self.site, search.name, len(results))
        return results
