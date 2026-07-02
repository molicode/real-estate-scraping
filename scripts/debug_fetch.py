"""Herramienta de diagnóstico: descarga una página con el scraper del sitio
y describe su estructura en la salida (para ajustar parsers cuando un portal
cambia su HTML). Se ejecuta desde el workflow debug-fetch.yml.

Uso: python scripts/debug_fetch.py <url> <site>
"""

import sys
from collections import Counter

from bs4 import BeautifulSoup

from scraper.sites import get_scraper

CANDIDATE_SELECTORS = [
    "li.ui-search-layout__item",
    "ol.ui-search-layout",
    "div.ui-search-result__wrapper",
    "div.ui-search-result",
    ".poly-card",
    ".poly-component__title",
    ".poly-attributes-list",
    ".andes-money-amount__fraction",
    "div.listing__item",
    "div[data-qa='posting PROPERTY']",
    "script[type='application/ld+json']",
]

FIRST_ITEM_SELECTORS = [
    "li.ui-search-layout__item",
    "div.ui-search-result__wrapper",
    ".poly-card",
    "div.listing__item",
]


def main() -> int:
    url, site = sys.argv[1], sys.argv[2]
    scraper = get_scraper(site)
    page_url = scraper.page_url(url, 1)
    print(f"URL final: {page_url}")

    resp = scraper.session.get(page_url, timeout=30)
    print(f"HTTP {resp.status_code} · {len(resp.text)} bytes · final: {resp.url}")
    with open("debug_page.html", "w", encoding="utf-8") as fh:
        fh.write(resp.text)

    html = resp.text
    lower = html.lower()
    for marker in ("captcha", "robot", "are you a human", "access denied", "cloudflare"):
        if marker in lower:
            print(f"⚠️ posible bloqueo: la página contiene '{marker}'")

    soup = BeautifulSoup(html, "lxml")
    title = soup.title.get_text(strip=True) if soup.title else "(sin title)"
    print(f"title: {title[:150]}")

    print("\n--- conteo de selectores candidatos ---")
    for sel in CANDIDATE_SELECTORS:
        print(f"{sel}: {len(soup.select(sel))}")

    classes = Counter(
        c for el in soup.find_all(class_=True) for c in el.get("class", [])
    )
    print("\n--- 40 clases CSS más frecuentes ---")
    for name, count in classes.most_common(40):
        print(f"{count:5d}  {name}")

    for sel in FIRST_ITEM_SELECTORS:
        el = soup.select_one(sel)
        if el:
            print(f"\n--- primer elemento '{sel}' (recortado a 5000 chars) ---")
            print(str(el)[:5000])
            break
    else:
        print("\n--- ningún selector de item conocido matcheó; primeros 3000 chars del body ---")
        body = soup.body
        print(str(body)[:3000] if body else html[:3000])

    items = list(scraper.parse(html))
    print(f"\n--- el parser actual de '{site}' extrae: {len(items)} avisos ---")
    for item in items[:3]:
        print(f"  {item.price_currency} {item.price_amount} · {item.title[:60]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
