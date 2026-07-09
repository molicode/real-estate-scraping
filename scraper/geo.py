"""Geografía de CABA: barrio → comuna, detección de barrio/villa en una
dirección de texto libre. Datos estáticos y públicos (división oficial de
la Ciudad), no cambian.
"""

from __future__ import annotations

import re
import unicodedata

# Los 48 barrios de CABA agrupados en sus 15 comunas.
COMUNA_BARRIOS: dict[int, list[str]] = {
    1: ["retiro", "san nicolas", "puerto madero", "san telmo", "montserrat", "constitucion"],
    2: ["recoleta"],
    3: ["balvanera", "san cristobal"],
    4: ["la boca", "barracas", "parque patricios", "nueva pompeya"],
    5: ["almagro", "boedo"],
    6: ["caballito"],
    7: ["flores", "parque chacabuco"],
    8: ["villa soldati", "villa lugano", "villa riachuelo"],
    9: ["liniers", "mataderos", "parque avellaneda"],
    10: ["villa real", "monte castro", "versalles", "floresta", "velez sarsfield", "villa luro"],
    11: ["villa general mitre", "villa devoto", "villa del parque", "villa santa rita"],
    12: ["coghlan", "saavedra", "villa urquiza", "villa pueyrredon"],
    13: ["nunez", "belgrano", "colegiales"],
    14: ["palermo"],
    15: ["chacarita", "villa crespo", "la paternal", "villa ortuzar", "agronomia", "parque chas"],
}

# barrio normalizado -> comuna
BARRIO_COMUNA: dict[str, int] = {
    barrio: comuna for comuna, barrios in COMUNA_BARRIOS.items() for barrio in barrios
}

COMUNA_NOMBRE: dict[int, str] = {
    c: ", ".join(b.title() for b in barrios[:2]) + ("…" if len(barrios) > 2 else "")
    for c, barrios in COMUNA_BARRIOS.items()
}

# Villas y asentamientos informales de CABA (zonas de alta inseguridad).
# La pista del usuario: las villas con número en vez de nombre. Sumamos las
# que tienen nombre propio.
NAMED_VILLAS = [
    "rodrigo bueno", "zavaleta", "los piletones", "ciudad oculta",
    "fraga", "playon de chacarita", "carrillo", "cildanez",
    "barrio mugica", "padre mugica",
]
# "villa 31", "villa 1-11-14", "villa 21-24"… (villa seguida de número).
# OJO: NO matchea "Villa Urquiza"/"Villa Crespo"/etc. (tienen nombre, no número).
VILLA_NUM_RE = re.compile(r"\bvilla\s*\d", re.IGNORECASE)


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFD", text or "")
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", text.lower()).strip()


def find_barrio(text: str) -> str | None:
    """Devuelve el barrio (normalizado) que aparece en el texto, o None.
    Prioriza los nombres más largos para no confundir 'flores' con
    'parque chacabuco', etc."""
    hay = normalize(text)
    for barrio in sorted(BARRIO_COMUNA, key=len, reverse=True):
        if re.search(r"\b" + re.escape(barrio) + r"\b", hay):
            return barrio
    return None


def find_comuna(text: str) -> int | None:
    barrio = find_barrio(text)
    if barrio:
        return BARRIO_COMUNA[barrio]
    # A veces la dirección dice "Comuna 8" directamente.
    m = re.search(r"comuna\s*0?(\d{1,2})", normalize(text))
    if m:
        c = int(m.group(1))
        if 1 <= c <= 15:
            return c
    return None


def is_villa(text: str) -> str | None:
    """Si el texto refiere a una villa/asentamiento, devuelve su nombre."""
    hay = normalize(text)
    if VILLA_NUM_RE.search(hay):
        m = re.search(r"villa\s*[\d\-/ ]+", hay)
        return m.group(0).strip() if m else "villa"
    for villa in NAMED_VILLAS:
        if villa in hay:
            return villa
    return None
