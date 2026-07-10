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
from . import proxy as proxy_mod
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
                offset_hours=(int(raw["offset_hours"]) % 24 if raw.get("offset_hours") not in (None, "") else None),
                weekday=(int(raw["weekday"]) % 7 if raw.get("weekday") not in (None, "") else None),
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
        elapsed = (now - last).total_seconds() if last is not None else None

        # Jobs anclados a un día de la semana (ej. "todos los lunes"): solo
        # corren ese día (y a la hora de offset si la definieron). El chequeo
        # de elapsed evita re-correrlo dos veces el mismo día.
        if search.weekday is not None:
            if now.weekday() != search.weekday % 7:
                continue
            if search.offset_hours is not None and now.hour != search.offset_hours % 24:
                continue
            if last is None or elapsed >= search.every_hours * 3600 - 600:
                due.append(search)
            continue

        if last is None:
            # Primer arranque: si tiene desfase, espera a esa hora UTC para
            # escalonar (así no arrancan todos juntos). Una vez que corre, la
            # cadencia de every_hours mantiene el carril.
            if search.offset_hours is not None and now.hour != search.offset_hours % 24:
                logger.info(
                    "Job '%s' espera su hora de inicio (%02d:00 UTC) para escalonar",
                    search.name, search.offset_hours % 24,
                )
            else:
                due.append(search)
            continue
        if elapsed >= search.every_hours * 3600 - 600:
            due.append(search)
        else:
            logger.info(
                "Job '%s' salteado: corre cada %dh y pasaron %.0f min",
                search.name, search.every_hours, elapsed / 60,
            )
    return due


def refresh_media(stored: dict, found: list) -> None:
    """Completa fotos/verificado de avisos que YA estaban en el almacén pero se
    re-scrapearon con más info (típicamente la galería completa que antes no
    parseábamos). No cuesta nada extra: usa lo que ya vino en la corrida."""
    for listing in found:
        entry = stored.get(listing.id)
        if entry is None:
            continue
        imgs = getattr(listing, "images", None) or []
        if len(imgs) > len(entry.get("images") or []):
            entry["images"] = imgs
            if not entry.get("image"):
                entry["image"] = imgs[0]
        if getattr(listing, "verified", False) and not entry.get("verified"):
            entry["verified"] = True


def enrich_details(
    new_listings: list, stored: dict, cap: int, proxy_exhausted: bool
) -> None:
    """Completa la galería de fotos y la identidad verificada de los avisos
    NUEVOS, bajando su página de detalle. Acotado por `cap` porque cada aviso
    es un fetch extra (y vía proxy consume créditos)."""
    if cap <= 0 or not new_listings:
        return
    scrapers: dict[str, Any] = {}
    done = 0
    for listing in new_listings:
        if done >= cap:
            break
        scraper = scrapers.get(listing.site)
        if scraper is None:
            scraper = scrapers[listing.site] = get_scraper(listing.site)
        if not getattr(scraper, "detail_supported", False):
            continue
        # Sin créditos de proxy no vale la pena intentar en sitios bloqueados.
        if proxy_exhausted and getattr(scraper, "proxy_fallback", False):
            continue
        try:
            html = scraper.fetch(listing.url)
            if not html:
                continue
            data = scraper.parse_detail(html)
        except Exception:  # el detalle roto no frena la corrida
            logger.warning("No pude enriquecer el detalle de %s", listing.url)
            continue

        images = data.get("images") or []
        if images:
            listing.images = images
            if not listing.image:
                listing.image = images[0]
        if data.get("verified"):
            listing.verified = True
        # add_new ya volcó el aviso al almacén: reflejamos lo enriquecido.
        entry = stored.get(listing.id)
        if entry is not None:
            entry["images"] = listing.images
            entry["image"] = listing.image
            entry["verified"] = listing.verified
        done += 1
    if done:
        logger.info("Detalle enriquecido para %d avisos nuevos", done)


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

    # Estado del proxy de scraping (créditos de ScraperAPI). Si el cupo del
    # plan gratis se agotó, las búsquedas que dependen del proxy se pausan
    # hasta la recarga mensual (la web lo muestra con su motivo).
    proxy_status = proxy_mod.build_status(os.environ.get("SCRAPERAPI_KEY", "").strip())
    proxy_mod.save_status(proxy_status)
    proxy_exhausted = bool(proxy_status.get("exhausted"))
    resets_at = proxy_status.get("resets_at", "el mes próximo")
    if proxy_exhausted:
        logger.warning(
            "ScraperAPI sin créditos (%s/%s): se pausan las búsquedas por proxy hasta %s",
            proxy_status.get("request_count"), proxy_status.get("request_limit"), resets_at,
        )

    for search in searches:
        try:
            scraper = get_scraper(search.site)
            # Portales que bloquean el acceso directo dependen del proxy: si no
            # hay créditos, se pausan (no se gastan intentos ni se marcan como error).
            if proxy_exhausted and getattr(scraper, "proxy_fallback", False):
                logger.info("'%s' en pausa: sin créditos de ScraperAPI", search.name)
                errors.append(
                    f"{search.name} ({search.site}): en pausa — sin créditos de ScraperAPI, "
                    f"se reactiva el {resets_at[:10]}"
                )
                stats[search.name] = 0
                continue
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
        # Avisos que ya estaban pero ahora traen más fotos (ej. galería
        # completa que antes no parseábamos): actualizamos su ficha. Es gratis,
        # usa lo que ya vino en la página de resultados.
        refresh_media(stored, matching)

    # Enriquecimiento de detalle (galería completa + identidad verificada):
    # solo para avisos NUEVOS y acotado por costo, porque cada uno es un fetch
    # extra (vía proxy en sitios bloqueados = créditos de ScraperAPI).
    enrich_max = int(config.get("detail_enrich_max", 40))
    enrich_details(all_new, stored, enrich_max, proxy_exhausted)

    # Señales de riesgo: se recalculan sobre TODO el almacén (la antigüedad
    # y las medianas cambian en cada corrida). Incluye villa + delito oficial
    # por comuna (data/crime.json, mantenido por el workflow de delitos).
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
