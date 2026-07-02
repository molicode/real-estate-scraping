from scraper.parsing import parse_features, parse_price


def test_parse_price_ars():
    assert parse_price("$ 350.000") == (350000.0, "ARS")


def test_parse_price_usd_variants():
    assert parse_price("USD 120.000") == (120000.0, "USD")
    assert parse_price("U$S 95.000") == (95000.0, "USD")
    assert parse_price("US$ 139.000") == (139000.0, "USD")


def test_parse_price_sin_precio():
    assert parse_price("Consultar precio") == (None, None)
    assert parse_price("") == (None, None)


def test_parse_features_completo():
    feats = parse_features("48 m² tot. · 2 amb. · 1 dorm. · 1 baño")
    assert feats == {"surface_m2": 48.0, "rooms": 2, "bedrooms": 1, "bathrooms": 1}


def test_parse_features_monoambiente():
    feats = parse_features("30 m² cubie. · Monoambiente")
    assert feats["rooms"] == 1
    assert feats["surface_m2"] == 30.0
