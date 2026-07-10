from scraper.filters import matches
from scraper.models import Listing
from scraper.storage import add_new, prune_old


def make_listing(**kwargs) -> Listing:
    base = dict(
        id="test:1",
        site="test",
        url="https://example.com/1",
        title="Depto 2 ambientes",
        price_amount=500000.0,
        price_currency="ARS",
        rooms=2,
        surface_m2=45.0,
        address="Palermo, CABA",
    )
    base.update(kwargs)
    return Listing(**base)


def test_sin_filtros_pasa():
    assert matches(make_listing(), {})


def test_max_price():
    assert matches(make_listing(), {"max_price": 600000})
    assert not matches(make_listing(), {"max_price": 400000})


def test_moneda_distinta_no_compara_precio():
    usd = make_listing(price_currency="USD", price_amount=1000.0)
    # Se exige ARS: un aviso en USD queda excluido.
    assert not matches(usd, {"currency": "ARS", "max_price": 600000})
    # Sin exigir moneda, el precio en USD no se compara contra un tope
    # pensado en pesos... pero sí contra el número crudo.
    assert matches(make_listing(price_amount=None), {"max_price": 400000})


def test_require_price():
    assert not matches(make_listing(price_amount=None), {"require_price": True})


def test_rooms_y_superficie():
    assert not matches(make_listing(rooms=1), {"min_rooms": 2})
    assert matches(make_listing(rooms=None), {"min_rooms": 2})  # desconocido pasa
    assert not matches(make_listing(surface_m2=30.0), {"min_surface_m2": 40})


def test_min_bathrooms():
    assert matches(make_listing(bathrooms=2), {"min_bathrooms": 2})
    assert not matches(make_listing(bathrooms=1), {"min_bathrooms": 2})
    assert matches(make_listing(bathrooms=None), {"min_bathrooms": 2})  # desconocido pasa


def test_keywords():
    assert matches(make_listing(), {"keywords_include": ["palermo"]})
    assert not matches(make_listing(), {"keywords_exclude": ["palermo"]})
    assert not matches(
        make_listing(title="Alquiler temporario"), {"keywords_exclude": ["temporario"]}
    )


def test_keywords_include_es_cualquiera():
    # Alcanza con que aparezca UNA de las palabras (OR), no todas.
    l = make_listing(title="PH 4 ambientes con patio", address="Caballito, CABA")
    assert matches(l, {"keywords_include": ["patio", "toilette"]})   # tiene "patio"
    assert matches(l, {"keywords_include": ["caballito"]})           # en la dirección
    assert not matches(l, {"keywords_include": ["toilette", "pileta"]})  # ninguna aparece


def test_keywords_exclude_por_palabra_corta_y_sin_acento():
    # "comercial" atrapa "apto comercial", "local comercial", etc.
    for titulo in ["Apto comercial", "Local comercial 50m", "Depto comercial"]:
        assert not matches(make_listing(title=titulo), {"keywords_exclude": ["comercial"]})
    # Y NO descarta un depto común (no dice "comercial").
    assert matches(make_listing(title="Depto 3 amb luminoso"), {"keywords_exclude": ["comercial"]})

    # El match ignora acentos en ambos sentidos: "construcción" atrapa
    # "construccion" y viceversa.
    assert not matches(
        make_listing(title="Vendo en construccion, entrega 2027"),
        {"keywords_exclude": ["construcción"]},
    )
    assert not matches(
        make_listing(title="En construcción, apto pozo"),
        {"keywords_exclude": ["construccion"]},
    )
    # Y el include también ignora acentos.
    assert matches(make_listing(title="Cochera con baulera"), {"keywords_include": ["baulera"]})


def test_add_new_dedup():
    stored = {}
    first_batch = [make_listing(id="a:1"), make_listing(id="a:2")]
    new = add_new(stored, first_batch)
    assert len(new) == 2
    assert all(l.first_seen for l in new)
    second_batch = [make_listing(id="a:2"), make_listing(id="a:3")]
    new = add_new(stored, second_batch)
    assert [l.id for l in new] == ["a:3"]
    assert set(stored) == {"a:1", "a:2", "a:3"}


def test_prune_old():
    stored = {
        "viejo": {"first_seen": "2020-01-01T00:00:00Z"},
        "nuevo": {"first_seen": "2099-01-01T00:00:00Z"},
        "sin_fecha": {},
    }
    kept = prune_old(stored, retention_days=30)
    assert "viejo" not in kept
    assert "nuevo" in kept
    assert "sin_fecha" in kept  # ante la duda no se borra
    assert prune_old(stored, retention_days=0) == stored
