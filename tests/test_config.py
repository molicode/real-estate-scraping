import json
from pathlib import Path

import pytest

from scraper.main import build_searches, load_config

ROOT = Path(__file__).resolve().parent.parent


def test_jobs_json_del_repo_es_valido():
    # El archivo del repo lo edita el usuario desde la web: acá solo se
    # valida que parsea y que cada búsqueda construye sin errores.
    config = load_config(ROOT / "jobs.json")
    searches = build_searches(config, only_job=None)
    all_names = [s.get("name") for s in config["searches"]]
    assert len(all_names) == len(set(all_names)), "nombres de jobs duplicados"
    for search in searches:
        assert search.url.startswith("https://")
        assert search.site in {"argenprop", "zonaprop", "mercadolibre", "remax"}


def test_enabled_false_se_saltea(tmp_path):
    config_file = tmp_path / "jobs.json"
    config_file.write_text(json.dumps({
        "searches": [
            {"name": "activo", "url": "https://www.argenprop.com/x"},
            {"name": "explicito", "url": "https://www.argenprop.com/y", "enabled": True},
            {"name": "pausado", "url": "https://www.argenprop.com/z", "enabled": False},
        ]
    }))
    searches = build_searches(load_config(config_file))
    assert [s.name for s in searches] == ["activo", "explicito"]


def test_sin_lista_searches_falla(tmp_path):
    config_file = tmp_path / "jobs.json"
    config_file.write_text(json.dumps({"retention_days": 10}))
    with pytest.raises(SystemExit):
        load_config(config_file)


def test_operation_fluye_del_job_al_aviso(tmp_path):
    config_file = tmp_path / "jobs.json"
    config_file.write_text(json.dumps({
        "searches": [
            {"name": "a", "url": "https://www.argenprop.com/x", "operation": "Venta"},
            {"name": "b", "url": "https://www.argenprop.com/y"},
        ]
    }))
    searches = build_searches(load_config(config_file))
    assert searches[0].operation == "venta"  # normalizado a minúsculas
    assert searches[1].operation == ""

    # base.search() copia la operación a cada aviso
    from unittest.mock import patch
    from scraper.models import Listing
    from scraper.sites.argenprop import ArgenpropScraper

    scraper = ArgenpropScraper()
    fake = Listing(id="argenprop:1", site="argenprop", url="https://x")
    with patch.object(scraper, "fetch", return_value="<html></html>"), \
         patch.object(scraper, "parse", return_value=iter([fake])):
        (result,) = scraper.search(searches[0])
    assert result.operation == "venta"
    assert result.search_name == "a"


def test_only_job_corre_aunque_este_pausado(tmp_path):
    config_file = tmp_path / "jobs.json"
    config_file.write_text(json.dumps({
        "searches": [
            {"name": "activo", "url": "https://www.argenprop.com/x"},
            {"name": "detenido", "url": "https://www.argenprop.com/y", "enabled": False},
        ]
    }))
    config = load_config(config_file)
    # ejecución puntual: solo ese job, aunque esté detenido
    searches = build_searches(config, only_job="detenido")
    assert [s.name for s in searches] == ["detenido"]
    # nombre inexistente -> vacío (el main lo reporta en el summary)
    assert build_searches(config, only_job="no-existe") == []
    # sin only_job, el detenido sigue excluido
    assert [s.name for s in build_searches(config)] == ["activo"]


def test_filter_due_respeta_frecuencia():
    from datetime import datetime, timezone
    from scraper.main import filter_due
    from scraper.models import Search

    now = datetime(2026, 7, 3, 12, 0, tzinfo=timezone.utc)
    searches = [
        Search(name="cada-hora", url="u", every_hours=1),
        Search(name="cada-6", url="u", every_hours=6),
        Search(name="nunca-corrio", url="u", every_hours=24),
    ]
    history = [
        {"finished_at": "2026-07-03T11:05:00Z", "jobs": {"cada-hora": 3}},
        {"finished_at": "2026-07-03T08:00:00Z", "jobs": {"cada-6": 2}},
    ]
    due = [s.name for s in filter_due(searches, history, now)]
    # cada-hora: pasaron 55 min (>= 60 - 10 de tolerancia) -> corre
    assert "cada-hora" in due
    # cada-6: pasaron 4 h de 6 -> se saltea
    assert "cada-6" not in due
    # sin historial -> corre siempre
    assert "nunca-corrio" in due


def test_filter_due_escalona_con_offset():
    from datetime import datetime, timezone
    from scraper.main import filter_due
    from scraper.models import Search

    # 3 jobs diarios sin historial, con desfases distintos. A las 14 UTC solo
    # debería arrancar el que tiene offset 14; los otros esperan su hora.
    now = datetime(2026, 7, 3, 14, 0, tzinfo=timezone.utc)
    searches = [
        Search(name="lane-0", url="u", every_hours=24, offset_hours=0),
        Search(name="lane-14", url="u", every_hours=24, offset_hours=14),
        Search(name="lane-15", url="u", every_hours=24, offset_hours=15),
        Search(name="sin-offset", url="u", every_hours=24),  # arranca enseguida
    ]
    due = [s.name for s in filter_due(searches, [], now)]
    assert due == ["lane-14", "sin-offset"]


def test_filter_due_weekly_solo_el_dia():
    from datetime import datetime, timezone
    from scraper.main import filter_due
    from scraper.models import Search

    # Job semanal anclado al lunes 09:00 UTC. Solo corre el lunes a esa hora.
    s = [Search(name="lunes", url="u", every_hours=168, weekday=0, offset_hours=9)]
    lunes_9 = datetime(2026, 7, 6, 9, 0, tzinfo=timezone.utc)   # 2026-07-06 es lunes
    lunes_10 = datetime(2026, 7, 6, 10, 0, tzinfo=timezone.utc)
    martes_9 = datetime(2026, 7, 7, 9, 0, tzinfo=timezone.utc)
    assert [x.name for x in filter_due(s, [], lunes_9)] == ["lunes"]
    assert filter_due(s, [], lunes_10) == []   # lunes pero otra hora
    assert filter_due(s, [], martes_9) == []   # hora correcta pero otro día
    # ya corrió este lunes -> no se repite; recién el lunes siguiente
    hist = [{"finished_at": "2026-07-06T09:02:00Z", "jobs": {"lunes": 5}}]
    prox_lunes = datetime(2026, 7, 13, 9, 0, tzinfo=timezone.utc)
    assert filter_due(s, hist, lunes_9) == []
    assert [x.name for x in filter_due(s, hist, prox_lunes)] == ["lunes"]


def test_build_searches_lee_offset_hours():
    config = {"searches": [
        {"name": "a", "url": "https://www.argenprop.com/x", "site": "argenprop", "offset_hours": 27},
        {"name": "b", "url": "https://www.argenprop.com/y", "site": "argenprop"},
    ]}
    s = {x.name: x for x in build_searches(config)}
    assert s["a"].offset_hours == 3   # 27 % 24
    assert s["b"].offset_hours is None


def test_run_history_se_appendea_y_se_recorta(tmp_path):
    from scraper import storage

    path = tmp_path / "run_history.json"
    for i in range(storage.RUN_HISTORY_LIMIT + 10):
        storage.append_run_history({"finished_at": f"t{i}", "new": i}, path=path)
    history = json.loads(path.read_text())
    assert len(history) == storage.RUN_HISTORY_LIMIT
    assert history[-1]["new"] == storage.RUN_HISTORY_LIMIT + 9  # el último quedó
    # archivo corrupto no explota
    path.write_text("{no es json")
    storage.append_run_history({"finished_at": "x"}, path=path)
    assert len(json.loads(path.read_text())) == 1


def test_defaults_y_filtros_se_mezclan(tmp_path):
    config_file = tmp_path / "jobs.json"
    config_file.write_text(json.dumps({
        "defaults": {"max_pages": 3, "filters": {"currency": "ARS", "max_price": 1}},
        "searches": [
            {"name": "a", "url": "https://www.argenprop.com/x",
             "filters": {"max_price": 900000}},
        ]
    }))
    (search,) = build_searches(load_config(config_file))
    assert search.max_pages == 3
    assert search.filters == {"currency": "ARS", "max_price": 900000}
