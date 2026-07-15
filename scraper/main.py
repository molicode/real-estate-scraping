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
                weekday=_norm_weekday(raw.get("weekday")),
                filters=merged_filters,
            )
        )
    return searches


def _norm_weekday(raw) -> Optional[list[int]]:
    """Normaliza 'weekday' a una lista de días (0=lunes … 6=domingo) o None.
    Acepta un entero (un día) o una lista (varios, ej. lunes y viernes)."""
    if raw in (None, ""):
        return None
    values = raw if isinstance(raw, (list, tuple)) else [raw]
    days = sorted({int(v) % 7 for v in values if v not in (None, "")})
    return days or None


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

        # Jobs anclados a día(s) de la semana (ej. "lunes y viernes"): solo
        # corren esos días (y a la hora de offset si la definieron). El chequeo
        # de elapsed evita re-correrlo dos veces el mismo día.
        if search.weekday is not None:
            days = search.weekday if isinstance(search.weekday, (list, tuple)) else [search.weekday]
            if now.weekday() not in days:
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
    """Completa la galería de fotos y la identidad verificada bajando la página
    de detalle. Primero los avisos NUEVOS y, con lo que quede del cupo, un
    backfill de los avisos ya guardados que todavía tienen una sola foto (así
    los viejos también se completan de a poco). Acotado por `cap` porque cada
    aviso es un fetch extra (vía proxy consume créditos de ScraperAPI)."""
    if cap <= 0:
        return
    scrapers: dict[str, Any] = {}

    def scraper_for(site: str):
        s = scrapers.get(site)
        if s is None:
            s = scrapers[site] = get_scraper(site)
        return s

    def usable(scraper) -> bool:
        if not getattr(scraper, "detail_supported", False):
            return False
        # Solo enriquecemos galería con motor GRATIS: navegador (MercadoLibre) o
        # requests. NO gastamos proxy en galerías — Zonaprop se limita a la
        # búsqueda de lunes y viernes; no queremos que el backfill diario le
        # pegue por ScraperAPI. (Los favoritos sí se enriquecen aparte, acotado.)
        needs_proxy = getattr(scraper, "proxy_fallback", False) and not getattr(scraper, "browser_engine", False)
        if needs_proxy:
            return False
        return not (proxy_exhausted and getattr(scraper, "proxy_fallback", False))

    done = 0

    # 1) Avisos nuevos: galería + identidad verificada (+ lo que traiga detalle).
    for listing in new_listings or []:
        if done >= cap:
            break
        scraper = scraper_for(listing.site)
        if not usable(scraper):
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
        entry = stored.get(listing.id)
        if entry is not None:
            entry["images"] = listing.images
            entry["image"] = listing.image
            entry["verified"] = listing.verified
        done += 1
    new_done = done

    # 2) Backfill de avisos ya guardados con una sola foto (una vez por aviso:
    #    cuando ya tienen galería, se saltean). Solo sitios con detalle soportado.
    for entry in stored.values():
        if done >= cap:
            break
        if len(entry.get("images") or []) > 1:
            continue
        site, url = entry.get("site"), entry.get("url")
        if not site or not url:
            continue
        scraper = scraper_for(site)
        if not usable(scraper):
            continue
        try:
            html = scraper.fetch(url)
            if not html:
                continue
            data = scraper.parse_detail(html)
        except Exception:
            continue
        images = data.get("images") or []
        if images:
            entry["images"] = images
            if not entry.get("image"):
                entry["image"] = images[0]
        if data.get("verified"):
            entry["verified"] = True
        if images or data.get("verified"):
            done += 1

    if done:
        logger.info(
            "Detalle enriquecido: %d avisos nuevos + %d de backfill", new_done, done - new_done
        )


FAVORITES_FILE = ROOT / "data" / "favorites.json"


def load_favorites() -> dict:
    try:
        with FAVORITES_FILE.open(encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def enrich_favorites(stored: dict, cap: int, proxy_exhausted: bool) -> None:
    """Completa los favoritos (data/favorites.json) bajando la página de cada
    aviso. Sirve para avisos puntuales que el usuario guardó a mano y que la
    búsqueda no trae (ej. mal categorizados o bloqueados). Se hace una sola vez
    por aviso (los que ya tienen precio+fotos se saltean) y está acotado."""
    if cap <= 0:
        return
    favorites = load_favorites()
    if not favorites:
        return
    scrapers: dict[str, Any] = {}
    done = 0
    for fid, fav in favorites.items():
        if done >= cap:
            break
        if not isinstance(fav, dict):
            continue
        entry = stored.get(fid)
        # Ya está completo (precio y al menos una foto): nada que hacer.
        if entry and entry.get("price_amount") is not None and (entry.get("images") or entry.get("image")):
            continue
        site = fav.get("site")
        url = fav.get("url")
        if not site or not url:
            continue
        scraper = scrapers.get(site)
        if scraper is None:
            scraper = scrapers[site] = get_scraper(site)
        if not getattr(scraper, "detail_supported", False):
            continue
        if proxy_exhausted and getattr(scraper, "proxy_fallback", False):
            continue
        try:
            html = scraper.fetch(url)
            if not html:
                continue
            detail = scraper.parse_detail(html)
        except Exception:
            logger.warning("No pude enriquecer el favorito %s", url)
            continue

        base = {k: v for k, v in fav.items() if k != "saved_at"}
        if detail.get("title"):
            base["title"] = detail["title"]
        if detail.get("price_amount") is not None:
            base["price_amount"] = detail["price_amount"]
        if detail.get("price_currency"):
            base["price_currency"] = detail["price_currency"]
        if detail.get("images"):
            base["images"] = detail["images"]
            base["image"] = detail["images"][0]
        if detail.get("verified"):
            base["verified"] = True
        merged = {**(entry or {}), **base}
        merged.setdefault("first_seen", utcnow_iso())
        stored[fid] = merged
        done += 1
    if done:
        logger.info("Favoritos enriquecidos desde su detalle: %d", done)


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
    # Favoritos guardados a mano que la búsqueda no trae: se completan bajando
    # su propia página (acotado; los ya completos se saltean).
    enrich_favorites(stored, int(config.get("fav_enrich_max", 20)), proxy_exhausted)

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
