"""Registro de scrapers por sitio."""

from __future__ import annotations

from urllib.parse import urlsplit

from .argenprop import ArgenpropScraper
from .base import BaseScraper
from .mercadolibre import MercadoLibreScraper
from .remax import RemaxScraper
from .zonaprop import ZonapropScraper

SCRAPERS: dict[str, type[BaseScraper]] = {
    "argenprop": ArgenpropScraper,
    "zonaprop": ZonapropScraper,
    "mercadolibre": MercadoLibreScraper,
    "remax": RemaxScraper,
}


def detect_site(url: str) -> str | None:
    """Deduce el sitio a partir del dominio de la URL de búsqueda."""
    host = urlsplit(url).netloc.lower()
    if "argenprop" in host:
        return "argenprop"
    if "zonaprop" in host:
        return "zonaprop"
    if "mercadolibre" in host or "mercadolibre" in url:
        return "mercadolibre"
    if "remax" in host:
        return "remax"
    return None


def get_scraper(site: str) -> BaseScraper:
    try:
        return SCRAPERS[site]()
    except KeyError:
        raise ValueError(
            f"Sitio '{site}' no soportado. Disponibles: {', '.join(SCRAPERS)}"
        ) from None
