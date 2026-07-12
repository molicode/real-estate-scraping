"""Enriquecimiento de detalle: galería completa + identidad verificada."""

from scraper.main import enrich_details, enrich_favorites, refresh_media
from scraper.models import Listing
from scraper.sites.mercadolibre import MercadoLibreScraper


def test_parse_detail_lee_jsonld_precio_y_titulo():
    s = MercadoLibreScraper()
    html = (
        '<script type="application/ld+json">'
        '{"@type":"Product","name":"PH en alquiler en Nunez 3 amb",'
        '"image":["https://http2.mlstatic.com/D_a.webp"],'
        '"offers":{"price":"850000","priceCurrency":"ARS"}}</script>'
    )
    d = s.parse_detail(html)
    assert d["title"] == "PH en alquiler en Nunez 3 amb"
    assert d["price_amount"] == 850000.0
    assert d["price_currency"] == "ARS"
    assert d["images"] == ["https://http2.mlstatic.com/D_a.webp"]


def test_enrich_favorites_completa_desde_el_detalle(monkeypatch, tmp_path):
    import scraper.main as main

    class _Fake:
        site = "mercadolibre"
        detail_supported = True
        proxy_fallback = True
        def __init__(self):
            self.calls = 0
        def fetch(self, url):
            self.calls += 1
            return "<html>ok</html>"
        def parse_detail(self, html):
            return {"title": "PH lindo", "price_amount": 999.0,
                    "price_currency": "ARS", "images": ["i1", "i2"], "verified": True}

    fake = _Fake()
    monkeypatch.setattr(main, "get_scraper", lambda site: fake)
    # favoritos: uno sin datos (se enriquece) y uno ya completo (se saltea)
    monkeypatch.setattr(main, "load_favorites", lambda: {
        "mercadolibre:MLA1": {"id": "mercadolibre:MLA1", "site": "mercadolibre",
                              "url": "https://x/1", "operation": "alquiler", "saved_at": "t"},
        "mercadolibre:MLA2": {"id": "mercadolibre:MLA2", "site": "mercadolibre",
                              "url": "https://x/2", "saved_at": "t"},
    })
    stored = {
        "mercadolibre:MLA2": {"id": "mercadolibre:MLA2", "site": "mercadolibre",
                              "price_amount": 100.0, "images": ["ya"]},
    }
    enrich_favorites(stored, cap=20, proxy_exhausted=False)

    assert fake.calls == 1  # solo el incompleto
    e = stored["mercadolibre:MLA1"]
    assert e["price_amount"] == 999.0 and e["price_currency"] == "ARS"
    assert e["images"] == ["i1", "i2"] and e["image"] == "i1"
    assert e["title"] == "PH lindo" and e["verified"] is True
    assert e["operation"] == "alquiler"  # dato base del favorito conservado
    assert e.get("first_seen")            # se le pone fecha
    # el ya-completo no se tocó
    assert stored["mercadolibre:MLA2"]["images"] == ["ya"]


def test_enrich_favorites_salta_sin_creditos(monkeypatch):
    import scraper.main as main
    called = {"n": 0}
    class _F:
        site = "mercadolibre"; detail_supported = True; proxy_fallback = True
        def fetch(self, url): called["n"] += 1; return "x"
        def parse_detail(self, html): return {}
    monkeypatch.setattr(main, "get_scraper", lambda site: _F())
    monkeypatch.setattr(main, "load_favorites", lambda: {
        "mercadolibre:MLA1": {"id": "mercadolibre:MLA1", "site": "mercadolibre", "url": "u"},
    })
    stored = {}
    enrich_favorites(stored, cap=20, proxy_exhausted=True)
    assert called["n"] == 0 and not stored


def test_refresh_media_completa_fotos_de_avisos_existentes():
    # Un aviso ya guardado con una sola foto; se re-scrapea con la galería
    # completa (gratis, desde la página de resultados) -> se actualiza.
    stored = {
        "zonaprop:1": Listing(
            id="zonaprop:1", site="zonaprop", url="u", image="a.jpg", images=["a.jpg"]
        ).to_dict()
    }
    fresh = Listing(
        id="zonaprop:1", site="zonaprop", url="u",
        image="a.jpg", images=["a.jpg", "b.jpg", "c.jpg"], verified=True,
    )
    refresh_media(stored, [fresh])
    assert stored["zonaprop:1"]["images"] == ["a.jpg", "b.jpg", "c.jpg"]
    assert stored["zonaprop:1"]["verified"] is True

    # Si no trae MÁS fotos que las guardadas, no pisa nada.
    fresh_menos = Listing(id="zonaprop:1", site="zonaprop", url="u", images=["a.jpg"])
    refresh_media(stored, [fresh_menos])
    assert stored["zonaprop:1"]["images"] == ["a.jpg", "b.jpg", "c.jpg"]

    # Un aviso que no está en el almacén se ignora sin romper.
    refresh_media(stored, [Listing(id="zonaprop:9", site="zonaprop", url="u")])
    assert "zonaprop:9" not in stored


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


def test_enrich_details_backfill_avisos_viejos_con_una_foto(monkeypatch):
    import scraper.main as main

    class _Fake:
        site = "zonaprop"
        detail_supported = True
        proxy_fallback = True
        def __init__(self):
            self.calls = 0
        def fetch(self, url):
            self.calls += 1
            return "<html>ok</html>"
        def parse_detail(self, html):
            return {"images": ["g1", "g2", "g3"]}

    class _NoDetail:
        detail_supported = False

    fake = _Fake()
    monkeypatch.setattr(main, "get_scraper", lambda site: fake if site == "zonaprop" else _NoDetail())
    stored = {
        # una sola foto -> se backfillea
        "zonaprop:1": {"id": "zonaprop:1", "site": "zonaprop", "url": "https://z/1", "images": ["a"], "image": "a"},
        # ya tiene galería -> se saltea
        "zonaprop:2": {"id": "zonaprop:2", "site": "zonaprop", "url": "https://z/2", "images": ["a", "b", "c"]},
        # remax no soporta detalle -> se saltea aunque tenga 1 foto
        "remax:3": {"id": "remax:3", "site": "remax", "url": "https://r/3", "images": ["a"]},
    }
    main.enrich_details([], stored, cap=40, proxy_exhausted=False)
    assert fake.calls == 1  # solo el zonaprop con 1 foto
    assert stored["zonaprop:1"]["images"] == ["g1", "g2", "g3"]
    assert stored["zonaprop:2"]["images"] == ["a", "b", "c"]  # intacto
    assert stored["remax:3"]["images"] == ["a"]  # intacto


def test_enrich_details_salta_si_proxy_agotado(monkeypatch):
    import scraper.main as main

    fake = _FakeScraper("<html></html>")
    monkeypatch.setattr(main, "get_scraper", lambda site: fake)
    l = Listing(id="mercadolibre:1", site="mercadolibre", url="https://x/1")
    stored = {l.id: l.to_dict()}
    enrich_details([l], stored, cap=10, proxy_exhausted=True)
    assert fake.calls == 0  # sitio con proxy_fallback y sin créditos: no gasta
    assert l.images == []
