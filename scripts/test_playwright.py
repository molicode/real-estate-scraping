"""Prueba empírica: ¿se puede scrapear con Playwright (navegador real) SIN
ScraperAPI, desde donde corra esto (ej. GitHub Actions)?

Baja 1 página de cada portal con el motor Playwright y reporta cuántos avisos
salieron. No guarda nada: es solo un diagnóstico. Corré con:
    USE_PLAYWRIGHT=1 SCRAPERAPI_KEY= python scripts/test_playwright.py
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Forzar navegador y NADA de proxy, para ver qué logra Playwright solo.
os.environ["USE_PLAYWRIGHT"] = "1"
os.environ["SCRAPERAPI_KEY"] = ""

from scraper import browser  # noqa: E402
from scraper.models import Search  # noqa: E402
from scraper.sites import get_scraper  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

TESTS = [
    ("argenprop", "https://www.argenprop.com/departamentos/alquiler/caballito"),
    ("zonaprop", "https://www.zonaprop.com.ar/departamentos-alquiler-caballito.html"),
    ("mercadolibre", "https://inmuebles.mercadolibre.com.ar/departamentos/alquiler/capital-federal/caballito/"),
    ("remax", "https://www.remax.com.ar/listings/rent?page=0&pageSize=24&sort=-createdAt&in:operationId=2"),
]


def main() -> int:
    print("=" * 60)
    print("PRUEBA PLAYWRIGHT SIN SCRAPERAPI")
    print("=" * 60)
    results = {}
    for site, url in TESTS:
        scraper = get_scraper(site)
        search = Search(name=f"test-{site}", url=url, site=site, max_pages=1)
        try:
            listings = scraper.search(search)
            n = len(listings)
            results[site] = n
            sample = listings[0].title[:50] if listings else "—"
            print(f"\n>>> {site.upper():13} {n:3} avisos   ej: {sample}")
        except Exception as exc:  # noqa: BLE001
            results[site] = f"ERROR: {exc}"
            print(f"\n>>> {site.upper():13} ERROR: {exc}")
    browser.shutdown()

    print("\n" + "=" * 60)
    print("RESUMEN (¿anduvo sin ScraperAPI desde esta IP?)")
    for site, n in results.items():
        ok = isinstance(n, int) and n > 0
        print(f"  {'✅' if ok else '❌'} {site:13} {n}")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
