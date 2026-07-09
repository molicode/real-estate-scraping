"""Punto de entrada: `python -m scraper.main [ruta-a-config.yaml]`."""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from . import filters as listing_filters
from . import risk
from .models import Search
from .notify import send_telegram, write_github_summary
from .sites import detect_site, get_scraper
from .storage import (
    add_new,
    append_run_history,
    load_listings,
    load_run_history,
    prune_old,
    save_listings,
    utcnow_iso,
)

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


def build_searches(config: dict[str, Any], only_job: str | None = None) -> list[Search]:
    defaults = config.get("defaults") or {}
    searches = []
    for i, raw in enumerate(config["searches"], start=1):
        name = raw.get("name") or f"busqueda-{i}"
        if only_job:
            # Ejecución puntual pedida desde la web: corre ese job aunque
            # esté detenido.
            if name != only_job:
                continue
        elif raw.get("enabled") is False:
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
                name=name,
                url=url,
                site=site,
                operation=(raw.get("operation") or "").strip().lower(),
                max_pages=int(raw.get("max_pages", defaults.get("max_pages", 1))),
                every_hours=max(1, int(raw.get("every_hours", defaults.get("every_hours", 1)))),
                filters=merged_filters,
            )
        )
    return searches


def filter_due(searches: list[Search], history: list[dict], now: datetime) -> list[Search]:
    """En corridas del cron, deja solo los jobs cuya frecuencia (every_hours)
    ya se cumplió desde su última ejecución registrada. Se usa una tolerancia
    de 10 minutos porque GitHub demora los crons de forma variable."""
    last_run: dict[str, datetime] = {}
    for entry in history:
        try:
            finished = datetime.strptime(
                entry.get("finished_at", ""), "%Y-%m-%dT%H:%M:%SZ"
            ).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        for job_name in (entry.get("jobs") or {}):
            if job_name not in last_run or finished > last_run[job_name]:
                last_run[job_name] = finished
    due = []
    for search in searches:
        last = last_run.get(search.name)
        if last is None:
            due.append(search)
            continue
        elapsed = (now - last).total_seconds()
        if elapsed >= search.every_hours * 3600 - 600:
            due.append(search)
        else:
            logger.info(
                "Job '%s' salteado: corre cada %dh y pasaron %.0f min",
                search.name, search.every_hours, elapsed / 60,
            )
    return due


def main() -> int:
    config_path = Path(sys.argv[1]) if len(sys.argv) > 1 else default_config_path()
    config = load_config(config_path)
    only_job = os.environ.get("ONLY_JOB", "").strip() or None
    searches = build_searches(config, only_job)
    if not searches:
        if only_job:
            logger.warning("El job '%s' no existe en %s", only_job, config_path.name)
            write_github_summary(
                [], {}, [f"El job '{only_job}' no existe en jobs.json (¿guardaste los cambios en la web?)"]
            )
        else:
            logger.info("No hay jobs activos en %s; nada para scrapear", config_path.name)
            write_github_summary([], {}, ["No hay jobs activos: creá o activá jobs desde la web de administración"])
        return 0
    if only_job:
        logger.info("Ejecución puntual del job '%s'", only_job)
    elif os.environ.get("GITHUB_EVENT_NAME") == "schedule":
        searches = filter_due(
            searches, load_run_history(), datetime.now(timezone.utc)
        )
        if not searches:
            logger.info("Ningún job cumplió su frecuencia todavía; nada para scrapear")
            write_github_summary([], {}, ["Ningún job estaba vencido según su frecuencia configurada"])
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

    # Señales de riesgo: se recalculan sobre TODO el almacén (la antigüedad
    # y las medianas cambian en cada corrida).
    risk.compute_all(stored, config.get("risk"))
    for listing in all_new:
        listing.flags = stored.get(listing.id, {}).get("flags", [])

    save_listings(stored)
    append_run_history({
        "finished_at": utcnow_iso(),
        "only_job": only_job,
        "jobs": stats,
        "found": sum(stats.values()),
        "new": len(all_new),
        "total_stored": len(stored),
        "errors": errors,
    })
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
