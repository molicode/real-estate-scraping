"""Modelos de datos del scraper."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass
class Listing:
    """Una propiedad publicada en un portal inmobiliario."""

    id: str
    site: str
    url: str
    title: str = ""
    price_amount: Optional[float] = None
    price_currency: Optional[str] = None
    expenses: Optional[float] = None
    address: str = ""
    rooms: Optional[int] = None  # ambientes
    bedrooms: Optional[int] = None  # dormitorios
    bathrooms: Optional[int] = None
    surface_m2: Optional[float] = None
    image: str = ""
    images: list[str] = field(default_factory=list)  # fotos extra si el portal las da
    search_name: str = ""
    operation: str = ""  # alquiler | venta (heredado del job)
    first_seen: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Listing":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in data.items() if k in known})


@dataclass
class Search:
    """Una búsqueda configurada en config.yaml."""

    name: str
    url: str
    site: str = ""
    operation: str = ""  # alquiler | venta (informativo, la URL manda)
    max_pages: int = 1
    every_hours: int = 1  # frecuencia mínima entre corridas del cron
    filters: dict[str, Any] = field(default_factory=dict)


def make_listing_id(site: str, url: str) -> str:
    """ID estable para deduplicar: el ID nativo del aviso si se puede
    extraer de la URL, si no un hash de la URL."""
    patterns = {
        "mercadolibre": r"(MLA-?\d+)",
        "zonaprop": r"-(\d{6,})\.html",
        "argenprop": r"--(\d{6,})",
    }
    pattern = patterns.get(site)
    if pattern:
        m = re.search(pattern, url)
        if m:
            return f"{site}:{m.group(1).replace('-', '')}"
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    return f"{site}:{digest}"
