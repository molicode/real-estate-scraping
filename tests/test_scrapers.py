from pathlib import Path

from scraper.sites.argenprop import ArgenpropScraper
from scraper.sites.mercadolibre import MercadoLibreScraper
from scraper.sites.zonaprop import ZonapropScraper

FIXTURES = Path(__file__).parent / "fixtures"


def read_fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_argenprop_parse():
    listings = list(ArgenpropScraper().parse(read_fixture("argenprop.html")))
    assert len(listings) == 2
    first = listings[0]
    assert first.id == "argenprop:13712456"
    assert first.url.startswith("https://www.argenprop.com/")
    assert first.price_amount == 750000.0
    assert first.price_currency == "ARS"
    assert first.expenses == 90000.0
    assert first.rooms == 2
    assert first.surface_m2 == 45.0
    assert "Palermo" in first.address
    second = listings[1]
    assert second.price_currency == "USD"
    assert second.rooms == 1  # monoambiente


def test_argenprop_pagination():
    scraper = ArgenpropScraper()
    url = "https://www.argenprop.com/departamentos/alquiler/palermo"
    assert scraper.page_url(url, 1) == url
    assert scraper.page_url(url, 2) == url + "?pagina-2"
    assert scraper.page_url(url + "?orden-masnuevos", 3) == url + "?orden-masnuevos&pagina-3"


def test_zonaprop_parse():
    listings = list(ZonapropScraper().parse(read_fixture("zonaprop.html")))
    assert len(listings) == 2
    first = listings[0]
    assert first.id == "zonaprop:54321099"
    assert first.url == (
        "https://www.zonaprop.com.ar/propiedades/clasificado/"
        "alclapin-departamento-2-ambientes-palermo-54321099.html"
    )
    assert first.price_amount == 820000.0
    assert first.price_currency == "ARS"
    assert first.rooms == 2
    assert listings[1].price_currency == "USD"
    assert listings[1].bedrooms == 2


def test_zonaprop_pagination():
    scraper = ZonapropScraper()
    url = "https://www.zonaprop.com.ar/departamentos-alquiler-palermo.html"
    assert scraper.page_url(url, 1) == url
    assert (
        scraper.page_url(url, 2)
        == "https://www.zonaprop.com.ar/departamentos-alquiler-palermo-pagina-2.html"
    )


def test_mercadolibre_parse():
    listings = list(MercadoLibreScraper().parse(read_fixture("mercadolibre.html")))
    assert len(listings) == 2
    first = listings[0]
    assert first.id == "mercadolibre:MLA1462223344"
    assert "#" not in first.url
    assert first.price_amount == 139000.0
    assert first.price_currency == "USD"
    assert first.bedrooms == 2
    assert first.surface_m2 == 62.0
    second = listings[1]
    assert second.price_currency == "ARS"
    assert second.rooms == 1


def test_mercadolibre_pagination():
    scraper = MercadoLibreScraper()
    url = "https://inmuebles.mercadolibre.com.ar/departamentos/venta/caballito/"
    assert scraper.page_url(url, 1) == url
    assert (
        scraper.page_url(url, 2)
        == "https://inmuebles.mercadolibre.com.ar/departamentos/venta/caballito_Desde_49"
    )
