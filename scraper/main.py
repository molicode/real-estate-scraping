"""Punto de entrada: `python -m scraper.main [ruta-a-config.yaml]`."""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

import yaml

from . import filters as listing_filters
from .models import Search
from .notify import send_telegram, write_github_summary
from .sites import detect_site, get_scraper
from .storage import add_new, load_listings, prune_old, save_listings

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
logger = logging.getLogger("scraper")

ROOT = Path(__file__).resolve().parent.parent
# jobs.json es la fuente canónica (lo edita la web de administración);
# config.yaml queda como alternativa manual. YAML es superset de JSON,
# así que ambos se leen con yaml.safe_load.
JOBS_FILE = ROOT / "jobs.json"
LEGACY_CONFIG = ROOT / "config.yaml"


def default_config_path() -> Path:
    return JOBS_FILE if JOBS_FILE.exists() else LEGACY_CONFIG


def load_config(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as fh:
        config = yaml.safe_load(fh) or {}
    if not isinstance(config.get("searches"), list):
        raise SystemExit(f"{path.name} debe definir una lista 'searches'")
    return config


def build_searches(config: dict[str, Any]) -> list[Search]:
    defaults = config.get("defaults") or {}
    searches = []
    for i, raw in enumerate(config["searches"], start=1):
        if raw.get("enabled") is False:
            continue
        url = (raw.get("url") or "").strip()
        if not url:
            raise SystemExit(f"La búsqueda #{i} no tiene 'url'")
        site = raw.get("site") or detect_site(url)
        if not site:
            raise SystemExit(
                f"No pude deducir el sitio de la URL '{url}'; agregá 'site:' a la búsqueda"
            )
        merged_filters = {**(defaults.get("filters") or {}), **(raw.get("filters") or {})}
        searches.append(
            Search(
                name=raw.get("name") or f"busqueda-{i}",
                url=url,
                site=site,
                max_pages=int(raw.get("max_pages", defaults.get("max_pages", 1))),
                filters=merged_filters,
            )
        )
    return searches


def main() -> int:
    config_path = Path(sys.argv[1]) if len(sys.argv) > 1 else default_config_path()
    config = load_config(config_path)
    searches = build_searches(config)
    if not searches:
        logger.info("No hay jobs activos en %s; nada para scrapear", config_path.name)
        write_github_summary([], {}, ["No hay jobs activos: creá o activá jobs desde la web de administración"])
        return 0
    retention_days = int(config.get("retention_days", 60))

    stored = load_listings()
    stored = prune_old(stored, retention_days)

    stats: dict[str, int] = {}
    errors: list[str] = []
    all_new = []

    for search in searches:
        try:
            scraper = get_scraper(search.site)
            found = scraper.search(search)
        except Exception as exc:  # una búsqueda rota no frena las demás
            logger.exception("Falló la búsqueda '%s'", search.name)
            errors.append(f"{search.name} ({search.site}): {exc}")
            stats[search.name] = 0
            continue

        if not found:
            errors.append(
                f"{search.name} ({search.site}): 0 avisos — posible bloqueo o cambio de HTML"
            )

        matching = [l for l in found if listing_filters.matches(l, search.filters)]
        stats[search.name] = len(matching)
        all_new.extend(add_new(stored, matching))

    save_listings(stored)
    logger.info(
        "Fin: %d avisos nuevos, %d en total, %d errores",
        len(all_new),
        len(stored),
        len(errors),
    )

    if all_new:
        send_telegram(all_new)
    write_github_summary(all_new, stats, errors)

    # Salimos con 0 aunque haya errores parciales: el workflow igual debe
    # commitear lo que sí se pudo scrapear.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
