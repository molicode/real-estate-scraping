from datetime import datetime, timezone
from unittest.mock import Mock

from scraper import proxy as proxy_mod
from scraper.sites.mercadolibre import MercadoLibreScraper
from scraper.sites.zonaprop import ZonapropScraper


def make_response(status=200, text="<html>ok</html>", url="https://x"):
    resp = Mock()
    resp.status_code = status
    resp.text = text
    resp.url = url
    return resp


def test_mercadolibre_detecta_bloqueo():
    scraper = MercadoLibreScraper()
    blocked = make_response(
        url="https://www.mercadolibre.com.ar/gz/account-verification?go=..."
    )
    assert scraper.is_blocked(blocked)
    blocked_by_text = make_response(text="...suspicious_traffic...")
    assert scraper.is_blocked(blocked_by_text)
    assert not scraper.is_blocked(make_response())


def test_fetch_sin_proxy_key_no_reintenta(monkeypatch):
    monkeypatch.delenv("SCRAPERAPI_KEY", raising=False)
    scraper = MercadoLibreScraper()
    scraper.session = Mock()
    scraper.session.get.return_value = make_response(
        url="https://www.mercadolibre.com.ar/gz/account-verification"
    )
    assert scraper.fetch("https://inmuebles.mercadolibre.com.ar/x") is None
    assert scraper.session.get.call_count == 1


def test_fetch_bloqueado_reintenta_via_proxy(monkeypatch):
    monkeypatch.setenv("SCRAPERAPI_KEY", "clave-test")
    scraper = MercadoLibreScraper()
    scraper.session = Mock()
    blocked = make_response(url="https://www.mercadolibre.com.ar/gz/account-verification")
    ok = make_response(text="<html>listado real</html>", url="https://api.scraperapi.com/")
    scraper.session.get.side_effect = [blocked, ok]

    assert scraper.fetch("https://inmuebles.mercadolibre.com.ar/x") == "<html>listado real</html>"
    assert scraper.session.get.call_count == 2
    proxy_call = scraper.session.get.call_args_list[1]
    assert proxy_call.args[0].startswith("https://api.scraperapi.com/?")
    assert "api_key=clave-test" in proxy_call.args[0]
    assert "mercadolibre.com.ar" in proxy_call.args[0]


def test_zonaprop_403_reintenta_via_proxy(monkeypatch):
    monkeypatch.setenv("SCRAPERAPI_KEY", "clave-test")
    scraper = ZonapropScraper()
    scraper.proxy_key = "clave-test"  # __init__ ya corrió antes del setenv en CI
    scraper.session = Mock()
    scraper.session.get.side_effect = [make_response(status=403), make_response()]
    assert scraper.fetch("https://www.zonaprop.com.ar/x.html") == "<html>ok</html>"
    assert scraper.session.get.call_count == 2


def test_pagina_vacia_reintenta_con_sesion_nueva(monkeypatch):
    from scraper.models import Search
    from scraper.sites.argenprop import ArgenpropScraper

    monkeypatch.setattr("time.sleep", lambda *_: None)
    scraper = ArgenpropScraper()
    empty = "<html><body></body></html>"
    card = (
        '<div class="listing__item"><a class="card" href="/x--1234567">'
        '<p class="card__price">$ 100.000</p></a></div>'
    )
    first_session = Mock()
    first_session.get.return_value = make_response(text=empty)
    retry_session = Mock()
    retry_session.get.return_value = make_response(text=card)
    scraper.session = first_session
    monkeypatch.setattr(scraper, "_build_session", lambda: retry_session)

    result = scraper.search(Search(name="s", url="https://www.argenprop.com/x", site="argenprop"))
    assert len(result) == 1
    assert first_session.get.call_count == 1
    assert retry_session.get.call_count == 1


def test_fetch_directo_ok_no_usa_proxy(monkeypatch):
    monkeypatch.setenv("SCRAPERAPI_KEY", "clave-test")
    scraper = MercadoLibreScraper()
    scraper.session = Mock()
    scraper.session.get.return_value = make_response()
    assert scraper.fetch("https://inmuebles.mercadolibre.com.ar/x") == "<html>ok</html>"
    assert scraper.session.get.call_count == 1


NOW = datetime(2026, 7, 10, 12, 0, tzinfo=timezone.utc)


def test_proxy_status_sin_key():
    st = proxy_mod.build_status("", now=NOW)
    assert st["key_present"] is False
    assert st["exhausted"] is False


def test_proxy_status_con_creditos(monkeypatch):
    monkeypatch.setattr(proxy_mod, "scraperapi_account",
                        lambda key, timeout=20: {"requestCount": 20, "requestLimit": 5000})
    st = proxy_mod.build_status("k", now=NOW)
    assert st["exhausted"] is False
    assert st["remaining"] == 4980
    assert st["low"] is False
    assert st["proxy_paused"] is False
    assert st["resets_at"] == "2026-08-01T00:00:00Z"  # primer día del mes siguiente


def test_proxy_status_agotado(monkeypatch):
    monkeypatch.setattr(proxy_mod, "scraperapi_account",
                        lambda key, timeout=20: {"requestCount": 5000, "requestLimit": 5000})
    st = proxy_mod.build_status("k", now=NOW)
    assert st["exhausted"] is True
    assert st["remaining"] == 0
    assert st["proxy_paused"] is True


def test_proxy_status_bajo_reserva_pausa_preventivamente(monkeypatch):
    # Quedan 50 créditos (<= reserva de 60): no está agotado, pero se pausa igual.
    monkeypatch.delenv("SCRAPERAPI_RESERVE", raising=False)
    monkeypatch.setattr(proxy_mod, "scraperapi_account",
                        lambda key, timeout=20: {"requestCount": 4950, "requestLimit": 5000})
    st = proxy_mod.build_status("k", now=NOW)
    assert st["remaining"] == 50
    assert st["exhausted"] is False      # todavía quedan
    assert st["low"] is True             # pero muy poco
    assert st["proxy_paused"] is True    # -> se pausa preventivamente
    assert st["reserve"] == 60


def test_proxy_status_reserva_configurable(monkeypatch):
    # Con reserva 200, quedando 150 ya se pausa.
    monkeypatch.setenv("SCRAPERAPI_RESERVE", "200")
    monkeypatch.setattr(proxy_mod, "scraperapi_account",
                        lambda key, timeout=20: {"requestCount": 4850, "requestLimit": 5000})
    st = proxy_mod.build_status("k", now=NOW)
    assert st["remaining"] == 150
    assert st["reserve"] == 200
    assert st["low"] is True and st["proxy_paused"] is True


def test_depends_on_free_credits_segun_motor(monkeypatch):
    from scraper.main import depends_on_free_credits
    from scraper.sites.argenprop import ArgenpropScraper
    from scraper.sites.remax import RemaxScraper

    import scraper.sites.base as base
    # Con navegador activo (producción): ML va por Playwright -> NO gasta créditos.
    monkeypatch.setattr(base, "USE_PLAYWRIGHT", True)
    assert depends_on_free_credits(MercadoLibreScraper()) is False
    # Zonaprop/Argenprop siguen por proxy -> sí gastan créditos.
    assert depends_on_free_credits(ZonapropScraper()) is True
    assert depends_on_free_credits(ArgenpropScraper()) is True
    # Remax es directo -> nunca gasta créditos.
    assert depends_on_free_credits(RemaxScraper()) is False
    # Sin navegador, ML caería al proxy -> ahí sí gastaría créditos.
    monkeypatch.setattr(base, "USE_PLAYWRIGHT", False)
    assert depends_on_free_credits(MercadoLibreScraper()) is True


def test_proxy_status_cuenta_no_disponible_no_bloquea(monkeypatch):
    # Si no se puede consultar la cuenta, NO se pausa nada (fail-open).
    monkeypatch.setattr(proxy_mod, "scraperapi_account", lambda key, timeout=20: None)
    st = proxy_mod.build_status("k", now=NOW)
    assert st["exhausted"] is False
    assert st.get("account_unavailable") is True


def test_reset_diciembre_pasa_a_enero():
    dic = datetime(2026, 12, 20, tzinfo=timezone.utc)
    assert proxy_mod._first_of_next_month(dic).strftime("%Y-%m-%d") == "2027-01-01"