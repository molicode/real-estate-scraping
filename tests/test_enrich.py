"""Enriquecimiento de detalle: galería completa + identidad verificada."""

from scraper.main import enrich_details
from scraper.models import Listing
from scraper.sites.mercadolibre import MercadoLibreScraper


def test_parse_detail_lee_galeria_y_verificado():
    s = MercadoLibreScraper()
    html = (
        '<html><script>x = {"pictures":['
        '{"id":"a","url":"https://http2.mlstatic.com/D_1-F.webp"},'
        '{"id":"b","url":"https://http2.mlstatic.com/D_2-F.webp?w=1"},'
        '{"id":"b","url":"https://http2.mlstatic.com/D_2-F.webp"}'  # id duplicado
        ']}</script><span>Identidad verificada</span></html>'
    )
    d = s.parse_detail(html)
    assert d["images"] == [
        "https://http2.mlstatic.com/D_1-F.webp",
        "https://http2.mlstatic.com/D_2-F.webp",  # query sacada, sin duplicar
    ]
    assert d["verified"] is True


def test_parse_detail_fallback_html_sin_estado():
    s = MercadoLibreScraper()
    html = (
        '<figure class="ui-pdp-gallery__figure">'
        '<img data-zoom="https://http2.mlstatic.com/D_a.webp" src="thumb"></figure>'
    )
    d = s.parse_detail(html)
    assert d["images"] == ["https://http2.mlstatic.com/D_a.webp"]
    assert d["verified"] is False


class _FakeScraper:
    site = "mercadolibre"
    detail_supported = True
    proxy_fallback = True

    def __init__(self, html):
        self._html = html
        self.calls = 0

    def fetch(self, url):
        self.calls += 1
        return self._html

    def parse_detail(self, html):
        return {"images": ["https://x/1.webp", "https://x/2.webp"], "verified": True}


def test_enrich_details_respeta_cap_y_actualiza_almacen(monkeypatch):
    import scraper.main as main

    fake = _FakeScraper("<html></html>")
    monkeypatch.setattr(main, "get_scraper", lambda site: fake)

    stored = {}
    new = []
    for i in range(5):
        l = Listing(id=f"mercadolibre:{i}", site="mercadolibre", url=f"https://x/{i}")
        stored[l.id] = l.to_dict()
        new.append(l)

    enrich_details(new, stored, cap=2, proxy_exhausted=False)

    # solo 2 avisos enriquecidos (cap)
    assert fake.calls == 2
    assert new[0].images == ["https://x/1.webp", "https://x/2.webp"]
    assert new[0].verified is True
    assert stored["mercadolibre:0"]["images"] == ["https://x/1.webp", "https://x/2.webp"]
    assert stored["mercadolibre:0"]["verified"] is True
    # el tercero quedó sin tocar
    assert new[2].images == []
    assert new[2].verified is False


def test_enrich_details_salta_si_proxy_agotado(monkeypatch):
    import scraper.main as main

    fake = _FakeScraper("<html></html>")
    monkeypatch.setattr(main, "get_scraper", lambda site: fake)
    l = Listing(id="mercadolibre:1", site="mercadolibre", url="https://x/1")
    stored = {l.id: l.to_dict()}
    enrich_details([l], stored, cap=10, proxy_exhausted=True)
    assert fake.calls == 0  # sitio con proxy_fallback y sin créditos: no gasta
    assert l.images == []
