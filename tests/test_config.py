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
