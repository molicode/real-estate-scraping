"""Construye data/crime.json a partir del dataset oficial de delitos de la
Ciudad de Buenos Aires (datos abiertos GCBA).

Se ejecuta en GitHub Actions (allí la red está abierta). Baja los CSV de
delitos de los últimos años, agrega por comuna, calcula delitos por 100k
habitantes y asigna un nivel (bajo/medio/alto) por terciles. También baja
y simplifica el GeoJSON de comunas para el mapa de la web.

El parseo es defensivo (nombres de columna alternativos por año), igual que
los scrapers de portales: si la Ciudad cambia el formato, se ajusta acá.
"""

from __future__ import annotations

import csv
import io
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT_CRIME = ROOT / "data" / "crime.json"
OUT_GEO = ROOT / "data" / "comunas.geojson"

# Años a agregar (del más reciente hacia atrás). Se prueban varias URLs.
YEARS = [2024, 2023, 2022]
CSV_URL_TEMPLATES = [
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/ministerio-de-justicia-y-seguridad/delitos/delitos_{year}.csv",
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/ministerio-de-justicia-y-seguridad/delitos/delitos-{year}.csv",
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/seguridad/delitos/delitos_{year}.csv",
]
GEO_URLS = [
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/ministerio-de-espacio-publico-e-higiene-urbana/comunas/comunas.geojson",
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/comunas/comunas.geojson",
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/jefatura-de-gabinete/comunas/comunas.geojson",
]

# Población por comuna (censo 2022, aprox.) para normalizar por habitante.
POBLACION = {
    1: 246_000, 2: 157_000, 3: 172_000, 4: 240_000, 5: 190_000,
    6: 176_000, 7: 245_000, 8: 222_000, 9: 175_000, 10: 174_000,
    11: 195_000, 12: 215_000, 13: 245_000, 14: 226_000, 15: 188_000,
}

# Nombres de columna posibles según el año del dataset.
COMUNA_COLS = ["comuna", "comuna_id", "id_comuna"]
TYPE_COLS = ["tipo", "tipo_delito", "delito"]
COUNT_COLS = ["cantidad", "cant", "total"]

session = requests.Session()
session.headers["User-Agent"] = "real-estate-scraping/crime-builder"


def fetch(url: str) -> bytes | None:
    try:
        r = session.get(url, timeout=90)
        if r.status_code == 200 and r.content:
            return r.content
    except requests.RequestException as exc:
        print(f"  fallo {url}: {exc}")
    return None


def _col(fieldnames, options):
    lower = {f.lower().strip(): f for f in (fieldnames or [])}
    for opt in options:
        if opt in lower:
            return lower[opt]
    return None


def parse_csv(raw: bytes):
    """Devuelve (por_comuna_total, por_comuna_por_tipo)."""
    text = raw.decode("utf-8-sig", errors="replace")
    # El GCBA usa a veces ';' como separador.
    sample = text[:2000]
    delim = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)
    ccol = _col(reader.fieldnames, COMUNA_COLS)
    tcol = _col(reader.fieldnames, TYPE_COLS)
    qcol = _col(reader.fieldnames, COUNT_COLS)
    if not ccol:
        print(f"  columnas: {reader.fieldnames} — sin columna de comuna, salteo")
        return {}, {}

    totals: dict[int, int] = defaultdict(int)
    by_type: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for row in reader:
        raw_comuna = (row.get(ccol) or "").strip().replace(",", ".")
        try:
            comuna = int(float(raw_comuna))
        except ValueError:
            continue
        if not (1 <= comuna <= 15):
            continue
        qty = 1
        if qcol:
            try:
                qty = int(float((row.get(qcol) or "1").replace(",", ".")))
            except ValueError:
                qty = 1
        totals[comuna] += qty
        tipo = (row.get(tcol) or "Otros").strip().title() if tcol else "Otros"
        by_type[comuna][tipo] += qty
    return totals, by_type


def build_crime() -> dict:
    totals: dict[int, int] = defaultdict(int)
    by_type: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    years_used = []

    for year in YEARS:
        raw = None
        for tmpl in CSV_URL_TEMPLATES:
            raw = fetch(tmpl.format(year=year))
            if raw:
                print(f"  {year}: descargado ({len(raw)} bytes)")
                break
        if not raw:
            print(f"  {year}: no disponible")
            continue
        t, bt = parse_csv(raw)
        if not t:
            continue
        years_used.append(year)
        for c, n in t.items():
            totals[c] += n
        for c, d in bt.items():
            for tipo, n in d.items():
                by_type[c][tipo] += n

    if not totals:
        raise SystemExit("No se pudo descargar/parsear ningún dataset de delitos")

    per100k = {c: totals[c] / POBLACION.get(c, 200_000) * 100_000 for c in totals}
    ordered = sorted(per100k.values())
    n = len(ordered)
    t1 = ordered[n // 3] if n >= 3 else min(ordered)
    t2 = ordered[2 * n // 3] if n >= 3 else max(ordered)

    def level(v):
        if v >= t2:
            return "alto"
        if v >= t1:
            return "medio"
        return "bajo"

    comunas = {}
    for c in sorted(totals):
        top = sorted(by_type[c].items(), key=lambda kv: -kv[1])[:6]
        comunas[str(c)] = {
            "total": totals[c],
            "per100k": round(per100k[c]),
            "level": level(per100k[c]),
            "by_type": dict(top),
        }
    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "GCBA datos abiertos — Mapa del Delito",
        "years": years_used,
        "comunas": comunas,
    }


def build_geojson():
    for url in GEO_URLS:
        raw = fetch(url)
        if not raw:
            continue
        try:
            gj = json.loads(raw)
        except json.JSONDecodeError:
            continue
        # Nos quedamos solo con geometría + número de comuna (aliviana el archivo).
        feats = []
        for f in gj.get("features", []):
            props = f.get("properties", {})
            comuna = props.get("comunas") or props.get("COMUNAS") or props.get("comuna") or props.get("id")
            try:
                comuna = int(float(str(comuna).strip()))
            except (ValueError, TypeError):
                continue
            feats.append({
                "type": "Feature",
                "properties": {"comuna": comuna},
                "geometry": f.get("geometry"),
            })
        if feats:
            OUT_GEO.write_text(
                json.dumps({"type": "FeatureCollection", "features": feats}),
                encoding="utf-8",
            )
            print(f"  comunas.geojson: {len(feats)} comunas")
            return True
    print("  comunas.geojson: no disponible (el mapa usará una grilla)")
    return False


def main() -> int:
    print("Construyendo base de delitos por comuna…")
    crime = build_crime()
    OUT_CRIME.parent.mkdir(parents=True, exist_ok=True)
    OUT_CRIME.write_text(json.dumps(crime, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    niveles = {c: v["level"] for c, v in crime["comunas"].items()}
    print(f"  crime.json: años {crime['years']}, niveles por comuna {niveles}")
    build_geojson()
    return 0


if __name__ == "__main__":
    sys.exit(main())
