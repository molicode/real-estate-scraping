"""Motor de scraping con navegador real (Playwright), alternativa a
requests/ScraperAPI. Se activa con USE_PLAYWRIGHT=1.

Renderiza JS y se comporta como un navegador de verdad, así que ayuda con los
sitios que bloquean por "no sos un browser". OJO: NO cambia la IP — desde una
IP de datacenter (ej. GitHub Actions) los sitios que bloquean por reputación
de IP (Cloudflare/DataDome de Zonaprop, verificación de MercadoLibre) pueden
seguir bloqueando. Para eso hace falta correrlo desde una IP residencial.

Se importa de forma perezosa (solo cuando USE_PLAYWRIGHT está activo) para no
obligar a instalar Playwright en la corrida normal.
"""

from __future__ import annotations

import logging
import random
from typing import Optional

logger = logging.getLogger(__name__)

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
]

_pw = None
_browser = None


def _get_browser():
    global _pw, _browser
    if _browser is None:
        from playwright.sync_api import sync_playwright

        _pw = sync_playwright().start()
        _browser = _pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
            ],
        )
    return _browser


def fetch_html(url: str, timeout: int = 45, wait_ms: int = 2000):
    """Abre `url` en Chromium y devuelve (html, url_final), o None si falló.
    `wait_ms` da un margen para que corran los challenges/JS del sitio."""
    try:
        browser = _get_browser()
    except Exception as exc:  # Playwright/Chromium no instalado
        logger.warning("Playwright no disponible: %s", exc)
        return None
    ctx = None
    try:
        ctx = browser.new_context(
            user_agent=random.choice(USER_AGENTS),
            viewport={"width": 1366, "height": 900},
            locale="es-AR",
            timezone_id="America/Argentina/Buenos_Aires",
        )
        page = ctx.new_page()
        page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
        page.wait_for_timeout(wait_ms)
        return page.content(), page.url
    except Exception as exc:
        logger.warning("Playwright falló en %s: %s", url, exc)
        return None
    finally:
        if ctx is not None:
            try:
                ctx.close()
            except Exception:
                pass


def shutdown() -> None:
    global _pw, _browser
    try:
        if _browser is not None:
            _browser.close()
    except Exception:
        pass
    try:
        if _pw is not None:
            _pw.stop()
    except Exception:
        pass
    _browser = None
    _pw = None
