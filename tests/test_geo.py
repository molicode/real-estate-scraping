from scraper import geo


def test_barrio_a_comuna():
    assert geo.find_comuna("Thames 800, Palermo") == 14
    assert geo.find_comuna("Av. Cabildo 2000, Belgrano") == 13
    assert geo.find_comuna("Lima 100, Constitución") == 1
    assert geo.find_comuna("Directorio 3500, Parque Chacabuco") == 7


def test_comuna_explicita():
    assert geo.find_comuna("Depto en Comuna 8") == 8
    assert geo.find_comuna("dirección sin barrio conocido") is None


def test_barrio_mas_largo_gana():
    # "parque chacabuco" no debe confundirse con otro barrio corto
    assert geo.find_barrio("hermoso en Parque Chacabuco") == "parque chacabuco"


def test_villa_por_numero():
    assert geo.is_villa("Depto cerca de Villa 31, Retiro")
    assert geo.is_villa("Bajo Flores villa 1-11-14")
    assert geo.is_villa("Villa 21-24, Barracas")


def test_villa_por_nombre():
    assert geo.is_villa("Rodrigo Bueno, Costanera Sur")
    assert geo.is_villa("Barrio Zavaleta")


def test_barrios_con_nombre_no_son_villa():
    # Estos barrios se llaman "Villa X" pero NO son asentamientos
    for legit in ["Villa Urquiza", "Villa Crespo", "Villa Devoto", "Villa del Parque", "Villa Luro"]:
        assert geo.is_villa(legit) is None, legit
