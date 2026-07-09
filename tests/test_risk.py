from datetime import datetime, timedelta, timezone

from scraper import risk


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


NOW = datetime(2026, 7, 3, 12, 0, tzinfo=timezone.utc)


def make(id, **kw):
    base = dict(
        price_amount=500000.0, price_currency="ARS", operation="alquiler",
        rooms=2, title="Depto", images=["a.jpg", "b.jpg"], first_seen=iso(NOW),
    )
    base.update(kw)
    return {"id": id, **base}


def flag_types(item):
    return {f["type"] for f in item["flags"]}


def test_stale_flag():
    old = make("1", first_seen=iso(NOW - timedelta(days=50)))
    very_old = make("2", first_seen=iso(NOW - timedelta(days=95)))
    fresh = make("3", first_seen=iso(NOW - timedelta(days=3)))
    store = {"1": old, "2": very_old, "3": fresh}
    risk.compute_all(store, now=NOW)
    assert "stale" in flag_types(old)
    assert next(f for f in old["flags"] if f["type"] == "stale")["level"] == "med"
    assert next(f for f in very_old["flags"] if f["type"] == "stale")["level"] == "high"
    assert "stale" not in flag_types(fresh)


def test_price_low_needs_enough_comparables():
    # 6 avisos comparables (mismo grupo) para que la mediana sea confiable
    store = {str(i): make(str(i), price_amount=500000.0) for i in range(6)}
    store["cheap"] = make("cheap", price_amount=200000.0)  # muy por debajo
    risk.compute_all(store, now=NOW)
    assert "price_low" in flag_types(store["cheap"])
    assert "price_low" not in flag_types(store["0"])


def test_price_low_ignora_grupos_chicos():
    store = {"a": make("a", price_amount=500000.0), "cheap": make("cheap", price_amount=50000.0)}
    risk.compute_all(store, now=NOW)
    assert "price_low" not in flag_types(store["cheap"])  # grupo < min_group


def test_risk_words_en_titulo():
    item = make("1", title="Hermoso depto, dueño en el exterior, seña por transferencia")
    store = {"1": item}
    risk.compute_all(store, now=NOW)
    assert "risk_words" in flag_types(item)


def test_no_price_y_few_photos():
    item = make("1", price_amount=None, images=[], title="x")
    store = {"1": item}
    risk.compute_all(store, now=NOW)
    assert "no_price" in flag_types(item)
    assert "few_photos" in flag_types(item)


def test_summarize_solo_altas():
    item = make("1", first_seen=iso(NOW - timedelta(days=95)))
    risk.compute_all({"1": item}, now=NOW)
    assert "días" in risk.summarize(item)
    clean = make("2")
    risk.compute_all({"2": clean, **{str(i): make(str(i)) for i in range(6)}}, now=NOW)
    assert risk.summarize(clean) == ""
