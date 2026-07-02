"""Helpers de parseo compartidos entre los scrapers de cada sitio."""

from __future__ import annotations

import re
from typing import Optional


def parse_price(text: str) -> tuple[Optional[float], Optional[str]]:
    """Extrae (monto, moneda) de textos como '$ 350.000', 'USD 120.000',
    'U$S 95.000 ', '350.000 pesos'. Devuelve (None, None) si no hay precio
    (ej. 'Consultar precio')."""
    if not text:
        return None, None
    text = text.strip()
    currency = None
    if re.search(r"(USD|U\$S|US\$|u\$s|dólar)", text, re.IGNORECASE):
        currency = "USD"
    elif re.search(r"(\$|ARS|peso)", text, re.IGNORECASE):
        currency = "ARS"

    m = re.search(r"(\d{1,3}(?:[.,]\d{3})+|\d+)", text)
    if not m:
        return None, None
    raw = m.group(1)
    # Formato argentino: el punto es separador de miles ("350.000").
    amount = float(raw.replace(".", "").replace(",", ""))
    return amount, currency


def parse_int(text: str) -> Optional[int]:
    m = re.search(r"\d+", text or "")
    return int(m.group(0)) if m else None


def parse_features(text: str) -> dict:
    """Extrae ambientes, dormitorios, baños y superficie de un texto de
    características tipo '50 m² · 2 amb. · 1 dorm. · 1 baño'."""
    out: dict = {}
    if not text:
        return out
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*m²", text)
    if m:
        out["surface_m2"] = float(m.group(1).replace(".", "").replace(",", "."))
    m = re.search(r"(\d+)\s*amb", text, re.IGNORECASE)
    if m:
        out["rooms"] = int(m.group(1))
    m = re.search(r"(\d+)\s*dorm", text, re.IGNORECASE)
    if m:
        out["bedrooms"] = int(m.group(1))
    m = re.search(r"(\d+)\s*bañ", text, re.IGNORECASE)
    if m:
        out["bathrooms"] = int(m.group(1))
    if re.search(r"monoambiente", text, re.IGNORECASE):
        out.setdefault("rooms", 1)
    return out


def clean_text(text: Optional[str]) -> str:
    return re.sub(r"\s+", " ", text or "").strip()
