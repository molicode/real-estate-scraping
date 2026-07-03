import json
from pathlib import Path

import pytest

from scraper.main import build_searches, load_config

ROOT = Path(__file__).resolve().parent.parent


def test_jobs_json_del_repo_es_valido():
    config = load_config(ROOT / "jobs.json")
    searches = build_searches(config)
    # Los ejemplos vienen pausados: no debe scrapearse nada hasta que el
    # usuario active jobs desde la web.
    assert searches == []


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
