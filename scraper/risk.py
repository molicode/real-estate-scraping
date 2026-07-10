"""Señales de riesgo automáticas sobre los avisos guardados.

Son HEURÍSTICAS, no veredictos: marcan avisos para mirar con más cuidado.
Todas se calculan con datos que ya tenemos (nada externo, nada inventado):

- stale        : hace mucho que vemos el aviso y sigue publicado
                 (patrón típico de la publicación "eterna" del estafador).
- price_low    : precio muy por debajo del promedio de su tipo/moneda
                 (el "demasiado bueno para ser verdad", anzuelo de seña).
- risk_words   : el título contiene frases asociadas a estafas.
- no_price     : no publica precio.
- few_photos   : una sola foto o ninguna.

Las señales que dependen del criterio del usuario (zona insegura, reseñas
propias) NO se calculan acá: viven en la web sobre archivos que el usuario
mantiene, porque no hay una fuente objetiva para inventarlas.
"""

from __future__ import annotations

import json
import re
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import geo

CRIME_FILE = Path(__file__).resolve().parent.parent / "data" / "crime.json"

_CRIME_LEVEL_FLAG = {
    "alto": ("high", "inseguridad alta"),
    "medio": ("med", "inseguridad media"),
    "bajo": ("low", "inseguridad baja"),
}

# Frases (no palabras sueltas) para minimizar falsos positivos. "seña" sola
# es normal en una operación; lo sospechoso es pedir plata sin ver.
DEFAULT_RISK_KEYWORDS = [
    "sin visita",
    "no requiere visita",
    "no se visita",
    "dueño en el exterior",
    "dueña en el exterior",
    "fuera del país",
    "seña por transferencia",
    "reserva por transferencia",
    "western union",
    "envío de dinero",
    "deposito para reservar",
    "depósito para reservar",
    "anticipo por transferencia",
]

DEFAULTS = {
    "stale_days": 45,        # a partir de acá se marca "publicada hace mucho"
    "price_low_ratio": 0.6,  # < 60% de la mediana del grupo = sospechoso
    "min_group": 5,          # mínimo de avisos comparables para confiar en la mediana
    "keywords": DEFAULT_RISK_KEYWORDS,
}


def _parse_dt(value: str):
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return None


def _group_key(item: dict[str, Any]) -> tuple:
    return (
        item.get("operation") or "",
        item.get("price_currency") or "",
        item.get("rooms") or 0,
    )


def load_crime(path: Path | None = None) -> dict[str, Any]:
    path = path or CRIME_FILE
    try:
        with (path).open(encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            return {}
        return {"comunas": data.get("comunas", {}), "barrios": data.get("barrios", {})}
    except (OSError, json.JSONDecodeError):
        return {}


def _location_flags(item: dict[str, Any], crime: dict[str, Any]) -> list[dict[str, str]]:
    """Señales de ubicación: villa (heurística) y nivel de delito oficial
    (por barrio si se puede, si no por comuna)."""
    text = f"{item.get('address', '')} {item.get('search_name', '')} {item.get('url', '')}"
    flags: list[dict[str, str]] = []

    villa = geo.is_villa(text)
    if villa:
        flags.append({
            "type": "villa", "level": "high",
            "label": f"Zona de villa/asentamiento ({villa}) — inseguridad alta",
        })

    comunas = (crime or {}).get("comunas", {})
    barrios = (crime or {}).get("barrios", {})

    barrio = geo.find_barrio(text)
    binfo = barrios.get(barrio) if barrio else None
    if binfo and binfo.get("level") in _CRIME_LEVEL_FLAG:
        lvl, txt = _CRIME_LEVEL_FLAG[binfo["level"]]
        flags.append({
            "type": "crime", "level": lvl,
            "label": f"{barrio.title()}: {txt} según datos oficiales",
        })
        return flags

    comuna = geo.find_comuna(text)
    cinfo = comunas.get(str(comuna)) if comuna is not None else None
    if cinfo and cinfo.get("level") in _CRIME_LEVEL_FLAG:
        lvl, txt = _CRIME_LEVEL_FLAG[cinfo["level"]]
        per = cinfo.get("per100k")
        extra = f" ({round(per):,} delitos/100k hab)".replace(",", ".") if per else ""
        flags.append({
            "type": "crime", "level": lvl,
            "label": f"Comuna {comuna}: {txt} según datos oficiales{extra}",
        })
    return flags


def compute_all(
    listings: dict[str, dict[str, Any]],
    config: dict[str, Any] | None = None,
    now: datetime | None = None,
    crime: dict[str, Any] | None = None,
) -> None:
    """Calcula y asigna `flags` a cada aviso del almacén (in place).

    Se recalcula sobre TODO el almacén en cada corrida porque la antigüedad
    y las medianas cambian con el tiempo.
    """
    cfg = {**DEFAULTS, **(config or {})}
    now = now or datetime.now(timezone.utc)
    keywords = [k.lower() for k in (cfg.get("keywords") or [])]
    crime = load_crime() if crime is None else crime

    # Medianas de precio por grupo (operación + moneda + ambientes)
    groups: dict[tuple, list[float]] = {}
    for item in listings.values():
        price = item.get("price_amount")
        if isinstance(price, (int, float)) and price > 0:
            groups.setdefault(_group_key(item), []).append(float(price))
    medians = {
        key: statistics.median(vals)
        for key, vals in groups.items()
        if len(vals) >= cfg["min_group"]
    }

    for item in listings.values():
        flags: list[dict[str, str]] = []

        # 1) Antigüedad desde el primer avistaje
        first_seen = _parse_dt(item.get("first_seen", ""))
        if first_seen:
            days = int((now - first_seen).total_seconds() // 86400)
            if days >= cfg["stale_days"] * 2:
                flags.append({
                    "type": "stale", "level": "high",
                    "label": f"La vemos hace {days} días y sigue publicada",
                })
            elif days >= cfg["stale_days"]:
                flags.append({
                    "type": "stale", "level": "med",
                    "label": f"Publicada hace al menos {days} días",
                })

        # 2) Precio sospechosamente bajo para su grupo
        price = item.get("price_amount")
        median = medians.get(_group_key(item))
        if median and isinstance(price, (int, float)) and price > 0:
            if price < median * cfg["price_low_ratio"]:
                pct = round(100 * (1 - price / median))
                flags.append({
                    "type": "price_low", "level": "high",
                    "label": f"Precio {pct}% por debajo del promedio del tipo — verificá que no sea un anzuelo",
                })

        # 3) Frases de riesgo en el título
        title = (item.get("title") or "").lower()
        hit = next((k for k in keywords if k in title), None)
        if hit:
            flags.append({
                "type": "risk_words", "level": "high",
                "label": f'Frase de alerta en el aviso: "{hit}"',
            })

        # 4) Aviso débil
        if item.get("price_amount") is None:
            flags.append({"type": "no_price", "level": "info", "label": "Sin precio publicado"})
        images = item.get("images") or ([item["image"]] if item.get("image") else [])
        if len(images) <= 1:
            flags.append({"type": "few_photos", "level": "low", "label": "Una sola foto o sin fotos"})

        # 5) Ubicación: villa + nivel de delito oficial por comuna
        flags.extend(_location_flags(item, crime))

        item["flags"] = flags


def summarize(item: dict[str, Any]) -> str:
    """Texto corto de las señales de un aviso (para Telegram / resumen)."""
    flags = item.get("flags") or []
    high = [f for f in flags if f["level"] == "high"]
    if not high:
        return ""
    return " · ".join(f["label"] for f in high)
