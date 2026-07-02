"""Persistencia de avisos vistos en data/listings.json.

El archivo se commitea al repo desde el workflow, así cada corrida
recuerda qué avisos ya vio y solo notifica los nuevos.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .models import Listing

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
LISTINGS_FILE = DATA_DIR / "listings.json"


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_listings(path: Path | None = None) -> dict[str, dict[str, Any]]:
    path = path or LISTINGS_FILE
    if not path.exists():
        return {}
    try:
        with path.open(encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def save_listings(listings: dict[str, dict[str, Any]], path: Path | None = None) -> None:
    path = path or LISTINGS_FILE
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(listings, fh, ensure_ascii=False, indent=2, sort_keys=True)
        fh.write("\n")


def prune_old(
    listings: dict[str, dict[str, Any]], retention_days: int
) -> dict[str, dict[str, Any]]:
    """Elimina avisos vistos por primera vez hace más de `retention_days`
    días, para que el archivo no crezca sin límite. Si un aviso podado
    sigue publicado, se volverá a notificar: es un compromiso aceptable."""
    if retention_days <= 0:
        return listings
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    kept = {}
    for key, item in listings.items():
        try:
            first_seen = datetime.strptime(
                item.get("first_seen", ""), "%Y-%m-%dT%H:%M:%SZ"
            ).replace(tzinfo=timezone.utc)
        except ValueError:
            kept[key] = item
            continue
        if first_seen >= cutoff:
            kept[key] = item
    return kept


def add_new(
    listings: dict[str, dict[str, Any]], found: list[Listing]
) -> list[Listing]:
    """Agrega al almacén los avisos que no estaban y los devuelve."""
    new: list[Listing] = []
    now = utcnow_iso()
    for listing in found:
        if listing.id in listings:
            continue
        listing.first_seen = now
        listings[listing.id] = listing.to_dict()
        new.append(listing)
    return new
