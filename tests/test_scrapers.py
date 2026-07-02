from pathlib import Path

from scraper.sites.argenprop import ArgenpropScraper
from scraper.sites.mercadolibre import MercadoLibreScraper
from scraper.sites.remax import RemaxScraper
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


def test_remax_parse():
    listings = list(RemaxScraper().parse(read_fixture("remax.json")))
    assert len(listings) == 2
    first = listings[0]
    assert first.id == "remax:ab12cd34-5678-90ef-1234-567890abcdef"
    assert first.url == (
        "https://www.remax.com.ar/listings/"
        "depto-2-ambientes-palermo-hollywood-123456789-22"
    )
    assert first.price_amount == 210000.0
    assert first.price_currency == "USD"
    assert first.expenses == 180000.0
    assert first.rooms == 2
    assert first.bedrooms == 1
    assert first.surface_m2 == 58.0
    assert first.image.startswith("https://")
    second = listings[1]
    assert second.price_currency == "ARS"
    assert second.bedrooms == 3
    assert second.image == "https://cdn.example.com/foto-completa.jpg"


def test_remax_page_url_convierte_a_api():
    scraper = RemaxScraper()
    url = (
        "https://www.remax.com.ar/listings/rent"
        "?page=0&pageSize=24&sort=-createdAt&in:operationId=2"
    )
    page1 = scraper.page_url(url, 1)
    assert page1.startswith("https://api-ar.redremax.com/remaxweb-ar/api/listings/findAll?")
    assert "page=0" in page1
    assert "pageSize=24" in page1
    assert "operationId" in page1
    page3 = scraper.page_url(url, 3)
    assert "page=2" in page3
    # Si la URL no trae pageSize, se agrega uno por defecto
    assert "pageSize=24" in scraper.page_url("https://www.remax.com.ar/listings/buy", 1)


def test_remax_parse_json_invalido_no_explota():
    assert list(RemaxScraper().parse("<html>not json</html>")) == []
    assert list(RemaxScraper().parse('{"data": {"data": null}}')) == []


def test_mercadolibre_pagination():
    scraper = MercadoLibreScraper()
    url = "https://inmuebles.mercadolibre.com.ar/departamentos/venta/caballito/"
    assert scraper.page_url(url, 1) == url
    assert (
        scraper.page_url(url, 2)
        == "https://inmuebles.mercadolibre.com.ar/departamentos/venta/caballito_Desde_49"
    )
