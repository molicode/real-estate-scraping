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
sys.path.insert(0, str(ROOT))
from scraper import geo  # noqa: E402  (normalización de barrios y barrio->comuna)

OUT_CRIME = ROOT / "data" / "crime.json"
OUT_GEO = ROOT / "data" / "comunas.geojson"
OUT_GEO_BARRIOS = ROOT / "data" / "barrios.geojson"

# Años a agregar (del más reciente hacia atrás). Se prueban varias URLs;
# los años que todavía no publicó la Ciudad se saltean solos.
YEARS = [2025, 2024, 2023, 2022]
CSV_URL_TEMPLATES = [
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/ministerio-de-justicia-y-seguridad/delitos/delitos_{year}.csv",
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/ministerio-de-justicia-y-seguridad/delitos/delitos-{year}.csv",
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/seguridad/delitos/delitos_{year}.csv",
]
GEO_URLS = [
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/ministerio-de-educacion/comunas/comunas.geojson",
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/ministerio-de-espacio-publico-e-higiene-urbana/comunas/comunas.geojson",
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/secretaria-de-innovacion-y-transformacion-digital/comunas/comunas.geojson",
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/jefatura-de-gabinete/comunas/comunas.geojson",
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/comunas/comunas.geojson",
]
BARRIO_GEO_URLS = [
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/ministerio-de-educacion/barrios/barrios.geojson",
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/secretaria-de-innovacion-y-transformacion-digital/barrios/barrios.geojson",
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/barrios/barrios.geojson",
    "https://cdn.buenosaires.gob.ar/datosabiertos/datasets/jefatura-de-gabinete/barrios/barrios.geojson",
]

# Población por comuna (censo 2022, aprox.) para normalizar por habitante.
POBLACION = {
    1: 246_000, 2: 157_000, 3: 172_000, 4: 240_000, 5: 190_000,
    6: 176_000, 7: 245_000, 8: 222_000, 9: 175_000, 10: 174_000,
    11: 195_000, 12: 215_000, 13: 245_000, 14: 226_000, 15: 188_000,
}

# Nombres de columna posibles según el año del dataset.
COMUNA_COLS = ["comuna", "comuna_id", "id_comuna"]
BARRIO_COLS = ["barrio", "barrios", "nombre_barrio"]
TYPE_COLS = ["tipo", "tipo_delito", "delito"]
COUNT_COLS = ["cantidad", "cant", "total"]

session = requests.Session()
session.headers["User-Agent"] = "real-estate-scraping/crime-builder"


def fetch(url: str, verbose: bool = False) -> bytes | None:
    try:
        r = session.get(url, timeout=90)
        if verbose:
            print(f"  [{r.status_code}] {url}")
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
    """Devuelve dict con agregados por comuna y por barrio."""
    text = raw.decode("utf-8-sig", errors="replace")
    # El GCBA usa a veces ';' como separador.
    sample = text[:2000]
    delim = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delim)
    ccol = _col(reader.fieldnames, COMUNA_COLS)
    bcol = _col(reader.fieldnames, BARRIO_COLS)
    tcol = _col(reader.fieldnames, TYPE_COLS)
    qcol = _col(reader.fieldnames, COUNT_COLS)
    if not ccol:
        print(f"  columnas: {reader.fieldnames} — sin columna de comuna, salteo")
        return None

    out = {
        "c_total": defaultdict(int),
        "c_type": defaultdict(lambda: defaultdict(int)),
        "b_total": defaultdict(int),
        "b_type": defaultdict(lambda: defaultdict(int)),
    }
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
        tipo = (row.get(tcol) or "Otros").strip().title() if tcol else "Otros"
        out["c_total"][comuna] += qty
        out["c_type"][comuna][tipo] += qty
        if bcol:
            barrio = geo.normalize(row.get(bcol) or "")
            if barrio and barrio in geo.BARRIO_COMUNA:
                out["b_total"][barrio] += qty
                out["b_type"][barrio][tipo] += qty
    return out


def _tercile_level(value: float, sorted_vals: list[float]) -> str:
    n = len(sorted_vals)
    if n < 3:
        return "medio"
    t1 = sorted_vals[n // 3]
    t2 = sorted_vals[2 * n // 3]
    if value >= t2:
        return "alto"
    if value >= t1:
        return "medio"
    return "bajo"


def build_crime() -> dict:
    c_total: dict[int, int] = defaultdict(int)
    c_type: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    c_year: dict[int, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    b_total: dict[str, int] = defaultdict(int)
    b_type: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    years_used = []
    has_barrio = False

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
        agg = parse_csv(raw)
        if not agg or not agg["c_total"]:
            continue
        years_used.append(year)
        for c, n in agg["c_total"].items():
            c_total[c] += n
            c_year[c][year] += n
        for c, d in agg["c_type"].items():
            for tipo, n in d.items():
                c_type[c][tipo] += n
        for b, n in agg["b_total"].items():
            has_barrio = True
            b_total[b] += n
        for b, d in agg["b_type"].items():
            for tipo, n in d.items():
                b_type[b][tipo] += n

    if not c_total:
        raise SystemExit("No se pudo descargar/parsear ningún dataset de delitos")

    years_used = sorted(years_used)

    # Comunas: por 100.000 habitantes, nivel por terciles
    per100k = {c: c_total[c] / POBLACION.get(c, 200_000) * 100_000 for c in c_total}
    p_sorted = sorted(per100k.values())
    comunas = {}
    for c in sorted(c_total):
        top = sorted(c_type[c].items(), key=lambda kv: -kv[1])[:6]
        pop = POBLACION.get(c, 200_000)
        # serie por año de delitos/100k (para la tendencia y la proyección)
        by_year = {
            str(y): round(c_year[c].get(y, 0) / pop * 100_000)
            for y in years_used
            if c_year[c].get(y)
        }
        comunas[str(c)] = {
            "total": c_total[c],
            "per100k": round(per100k[c]),
            "level": _tercile_level(per100k[c], p_sorted),
            "by_type": dict(top),
            "by_year": by_year,
        }

    # Barrios: total de delitos, nivel por terciles (igual que el mapa oficial,
    # que colorea por cantidad de delitos por zona).
    barrios = {}
    if has_barrio:
        b_sorted = sorted(b_total.values())
        for b in sorted(b_total):
            top = sorted(b_type[b].items(), key=lambda kv: -kv[1])[:6]
            barrios[b] = {
                "comuna": geo.BARRIO_COMUNA.get(b),
                "total": b_total[b],
                "level": _tercile_level(b_total[b], b_sorted),
                "by_type": dict(top),
            }
    print(f"  barrios agregados: {len(barrios)}")

    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "GCBA datos abiertos — Mapa del Delito",
        "years": years_used,
        "comunas": comunas,
        "barrios": barrios,
    }


def build_comunas_geojson():
    for url in GEO_URLS:
        raw = fetch(url, verbose=True)
        if not raw:
            continue
        try:
            gj = json.loads(raw)
        except json.JSONDecodeError:
            continue
        feats = []
        for f in gj.get("features", []):
            props = f.get("properties", {})
            comuna = props.get("comunas") or props.get("COMUNAS") or props.get("comuna") or props.get("id")
            try:
                comuna = int(float(str(comuna).strip()))
            except (ValueError, TypeError):
                continue
            feats.append({"type": "Feature", "properties": {"comuna": comuna}, "geometry": f.get("geometry")})
        if feats:
            OUT_GEO.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
            print(f"  comunas.geojson: {len(feats)} comunas")
            return True
    print("  comunas.geojson: no disponible")
    return False


def build_barrios_geojson():
    for url in BARRIO_GEO_URLS:
        raw = fetch(url, verbose=True)
        if not raw:
            continue
        try:
            gj = json.loads(raw)
        except json.JSONDecodeError:
            continue
        feats = []
        for f in gj.get("features", []):
            props = f.get("properties", {})
            name = props.get("barrio") or props.get("BARRIO") or props.get("nombre") or props.get("NOMBRE")
            if not name:
                continue
            feats.append({
                "type": "Feature",
                "properties": {"barrio": geo.normalize(str(name))},
                "geometry": f.get("geometry"),
            })
        if feats:
            OUT_GEO_BARRIOS.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
            print(f"  barrios.geojson: {len(feats)} barrios")
            return True
    print("  barrios.geojson: no disponible")
    return False


def main() -> int:
    print("Construyendo base de delitos por comuna…")
    crime = build_crime()
    OUT_CRIME.parent.mkdir(parents=True, exist_ok=True)
    OUT_CRIME.write_text(json.dumps(crime, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    niveles = {c: v["level"] for c, v in crime["comunas"].items()}
    print(f"  crime.json: años {crime['years']}, niveles por comuna {niveles}")
    build_comunas_geojson()
    build_barrios_geojson()
    return 0


if __name__ == "__main__":
    sys.exit(main())
