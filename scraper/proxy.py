"""Estado del proxy de scraping (ScraperAPI).

El plan gratuito de ScraperAPI tiene un tope mensual de requests. Cuando se
agota, los portales que dependen del proxy (los que bloquean el acceso
directo desde GitHub, hoy Zonaprop y MercadoLibre) no se pueden scrapear
hasta que el cupo se recargue el mes siguiente.

Este módulo consulta el uso de la cuenta (endpoint /account, que NO gasta
créditos) y deja el estado en data/proxy_status.json para que:
  - el scraper saltee esas búsquedas mientras no haya créditos (sin gastar
    intentos ni reportar falsos "bloqueos"), y
  - la web muestre esos jobs "en pausa" explicando por qué y hasta cuándo.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import requests

ACCOUNT_ENDPOINT = "https://api.scraperapi.com/account"
PROXY_STATUS_FILE = Path(__file__).resolve().parent.parent / "data" / "proxy_status.json"

# Margen de reserva: cuando quedan estos créditos (o menos), pausamos
# preventivamente los portales que dependen del proxy, ANTES de agotarlos del
# todo. Así una última corrida no se queda a medias y no se pasa del cupo.
# Configurable con SCRAPERAPI_RESERVE (default 60 ~ una corrida de proxy).
DEFAULT_RESERVE = 60


def _reserve() -> int:
    raw = os.environ.get("SCRAPERAPI_RESERVE", "").strip()
    if raw.isdigit():
        return int(raw)
    return DEFAULT_RESERVE


def scraperapi_account(key: str, timeout: int = 20) -> Optional[dict[str, Any]]:
    """Uso de la cuenta de ScraperAPI. No consume créditos. None si falla."""
    if not key:
        return None
    try:
        resp = requests.get(ACCOUNT_ENDPOINT, params={"api_key": key}, timeout=timeout)
        if resp.status_code == 200:
            data = resp.json()
            return data if isinstance(data, dict) else None
    except (requests.RequestException, ValueError):
        pass
    return None


def _first_of_next_month(now: datetime) -> datetime:
    year = now.year + (1 if now.month == 12 else 0)
    month = 1 if now.month == 12 else now.month + 1
    return datetime(year, month, 1, tzinfo=timezone.utc)


def build_status(key: str, now: Optional[datetime] = None) -> dict[str, Any]:
    """Arma el estado del proxy consultando la cuenta (si hay key)."""
    now = now or datetime.now(timezone.utc)
    status: dict[str, Any] = {
        "key_present": bool(key),
        "checked_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "exhausted": False,
    }
    if not key:
        return status

    acct = scraperapi_account(key)
    if not acct:
        # No pudimos consultar: no bloqueamos nada (fail-open), pero lo dejamos anotado.
        status["account_unavailable"] = True
        return status

    count = acct.get("requestCount")
    limit = acct.get("requestLimit")
    reserve = _reserve()
    status["request_count"] = count
    status["request_limit"] = limit
    status["reserve"] = reserve
    if isinstance(count, (int, float)) and isinstance(limit, (int, float)) and limit > 0:
        remaining = max(0, int(limit) - int(count))
        status["remaining"] = remaining
        status["exhausted"] = int(count) >= int(limit)
        # "Muy muy poco": quedan <= reserva -> pausamos preventivamente.
        status["low"] = remaining <= reserve
    # Señal única para el scraper/web: ¿hay que pausar los portales por proxy?
    status["proxy_paused"] = bool(status.get("exhausted") or status.get("low"))
    # El cupo del plan gratis se recarga por mes calendario.
    status["resets_at"] = _first_of_next_month(now).strftime("%Y-%m-%dT%H:%M:%SZ")
    return status


def save_status(status: dict[str, Any], path: Optional[Path] = None) -> None:
    path = path or PROXY_STATUS_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(status, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
