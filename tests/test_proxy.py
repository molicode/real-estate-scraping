from unittest.mock import Mock

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