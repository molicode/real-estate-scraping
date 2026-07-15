"""Refresca SOLO el consumo de ScraperAPI en data/proxy_status.json.

El endpoint /account de ScraperAPI NO consume créditos, así que podemos
consultarlo seguido (varias veces al día) sin gastar el cupo. Esto mantiene
el número de la web casi al día con el dashboard real de ScraperAPI, sin
tener que correr el scraper completo.

Corré con:
    SCRAPERAPI_KEY=... python scripts/refresh_usage.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scraper import proxy as proxy_mod  # noqa: E402


def main() -> int:
    key = os.environ.get("SCRAPERAPI_KEY", "").strip()
    status = proxy_mod.build_status(key)
    proxy_mod.save_status(status)
    used = status.get("request_count")
    limit = status.get("request_limit")
    if used is not None and limit:
        print(f"ScraperAPI: {used}/{limit} usados · medido {status.get('checked_at')}")
    elif not key:
        print("Sin SCRAPERAPI_KEY: nada que refrescar.")
    else:
        print("No se pudo consultar la cuenta de ScraperAPI (fail-open).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
