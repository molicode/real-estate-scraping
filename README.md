# 🏠 Real Estate Scraping Argentina

Scraper de portales inmobiliarios argentinos que corre **cada 1 hora, todos los días** en GitHub Actions. Busca propiedades en alquiler o venta según los criterios que definas, guarda el histórico en el repo y lo explorás desde una **web de administración** en GitHub Pages con búsqueda, señales de riesgo y un mapa de inseguridad por comuna/barrio con datos oficiales. Opcionalmente te avisa por Telegram cuando aparecen avisos nuevos.

## Portales soportados

| Portal | Sitio | Notas |
|---|---|---|
| Argenprop | `argenprop.com` | HTML server-side. Funcionaba directo, pero empezó a bloquear los runners (HTTP 403); reintenta vía `SCRAPERAPI_KEY` si está configurado |
| Zonaprop | `zonaprop.com.ar` | Cloudflare bloquea a los runners de GitHub: requiere el secret `SCRAPERAPI_KEY` |
| MercadoLibre Inmuebles | `inmuebles.mercadolibre.com.ar` | Bloquea IPs de datacenter (redirige a verificación): requiere el secret `SCRAPERAPI_KEY` |
| Remax | `remax.com.ar` | Se consume la API JSON pública del sitio (SPA sin HTML server-side) |

### Proxy de scraping (para Zonaprop y MercadoLibre)

Estos dos portales bloquean el acceso directo desde los servidores de GitHub. El scraper intenta primero directo y, si detecta el bloqueo y existe el secret `SCRAPERAPI_KEY`, reintenta a través de [ScraperAPI](https://www.scraperapi.com/) (tiene plan gratuito de ~1.000 requests/mes). Para activarlo: creá una cuenta, copiá tu API key y agregala como secret `SCRAPERAPI_KEY` en **Settings → Secrets and variables → Actions**. Sin el secret, esos portales simplemente devuelven 0 avisos (queda marcado en el job summary).

## Cómo funciona

1. Definís **jobs** (búsquedas) desde la **web de administración** (GitHub Pages) o editando [`jobs.json`](jobs.json) a mano. Cada job apunta a un portal con sus filtros.
2. El workflow [`scraper.yml`](.github/workflows/scraper.yml) corre con cron `0 * * * *` (cada hora, UTC) y ejecuta los jobs **activos**; si no hay ninguno, no scrapea nada. También podés dispararlo al instante desde la web.
3. Compara contra `data/listings.json` (el "ya visto"), agrega los avisos nuevos, calcula las **señales de riesgo** y commitea el archivo al repo.
4. Si configuraste Telegram, te envía un mensaje con los avisos nuevos. Siempre deja un resumen en el *job summary* de la corrida.

## Web de administración

La carpeta [`web/`](web/) se despliega a GitHub Pages con [`pages.yml`](.github/workflows/pages.yml). Es una app estática (vanilla JS) que consume la API de GitHub con tu token, guardado solo en tu navegador.

- **Acceso con usuario y clave**: la web está detrás de un gate; recién ahí pedís conectar con GitHub. La conexión se muestra como un semáforo (verde = conectado) desplegable.
- **Tema claro y oscuro** (arranca en claro; se recuerda tu elección).
- **Jobs** (pestaña *Jobs*): crear / editar / **pausar** / **detener** / **ejecutar ahora** / eliminar / **clonar**. El formulario está seccionado por color, con ayuda `(i)` en cada campo y combos que también aceptan texto libre. Los nombres se autogeneran como `portal_operacion_tipo_zona`. Al elegir una zona ves su **nivel de seguridad** (🔴 alto / 🟠 medio / 🟢 bajo) según datos oficiales.
- **Filtros**: precio, moneda, ambientes, dormitorios, **baños** (por tipo: toilette, en suite, etc.), superficie y keywords para incluir/excluir (con chips frecuentes a mano, como `cochera`).
- **Top 5** (pestaña *Top 5*): un ranking automático de 5 para alquilar y 5 para comprar, cada uno con un carrusel de todas sus fotos. Los criterios de ranking son configurables.
- **Me gustan** (pestaña *Me gustan*): tus avisos guardados como favoritos.
- **Buscar** (pestaña *Buscar*): filtros sobre todo el histórico guardado, miniaturas que rotan las fotos y un visor (lightbox) con zoom y anterior/siguiente.
- **Riesgo** (pestaña *Riesgo*): señales automáticas por aviso + un **mapa de inseguridad** por comuna y por barrio, coloreado por nivel, con detalle de delitos por tipo y **tendencia 2022–2025 con proyección**. Incluye un editor de zonas y notas propias.
- **Corridas** (pestaña *Corridas*): historial de ejecuciones con cuánta información trajo cada una, **paginación** ("Cargar más corridas") y **selección múltiple** para borrar varias corridas o borrar sus datos del histórico de una sola vez.

Para usarla necesitás un [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) con acceso a este repo y permisos `Contents: Read and write` + `Actions: Read and write`.

## Señales de riesgo

En cada corrida se recalculan **heurísticas** sobre los avisos guardados (nada externo, nada inventado):

- `stale` — hace mucho que vemos el aviso y sigue publicado (publicación "eterna").
- `price_low` — precio muy por debajo de la mediana de su tipo/moneda (posible anzuelo de seña).
- `risk_words` — frases asociadas a estafas en el título ("dueño en el exterior", "seña por transferencia", etc.).
- `no_price` / `few_photos` — aviso débil.
- `villa` — el texto menciona una villa/asentamiento numerado (heurística de zona insegura; los barrios "Villa Urquiza/Crespo/Devoto" **no** cuentan).
- `crime` — nivel de inseguridad **oficial** de la comuna o barrio del aviso (ver abajo).

Las señales que dependen de tu criterio (zonas, notas) las mantenés vos desde la web, porque no hay una fuente objetiva para inventarlas.

## Base de delitos (datos oficiales GCBA)

El workflow [`crime-data.yml`](.github/workflows/crime-data.yml) (mensual + manual) ejecuta [`scripts/build_crime.py`](scripts/build_crime.py), que descarga los datasets de delitos de la Ciudad de Buenos Aires (2022–2025) y construye [`data/crime.json`](data/crime.json):

- **Por comuna**: total, delitos por 100k habitantes, nivel por terciles, desglose por tipo y serie `by_year`.
- **Por barrio**: total y nivel por terciles (misma metodología que el Mapa del Delito oficial).
- Geometrías `data/comunas.geojson` y `data/barrios.geojson` para dibujar el mapa.

El scraper usa estos niveles para la señal `crime` (el barrio, más específico, prevalece sobre la comuna).

## Formato de jobs.json

```json
{
  "retention_days": 60,
  "defaults": { "max_pages": 2 },
  "searches": [
    {
      "name": "argenprop_alquiler_departamento_palermo",
      "url": "https://www.argenprop.com/departamentos/alquiler/palermo",
      "site": "argenprop",
      "enabled": true,
      "max_pages": 2,
      "filters": {
        "currency": "ARS",
        "max_price": 900000,
        "min_rooms": 2,
        "keywords_exclude": ["temporario"]
      }
    }
  ]
}
```

La `url` se copia del portal con sus filtros nativos aplicados; el `site` se detecta solo por el dominio. Filtros disponibles: `currency`, `min_price`, `max_price`, `require_price`, `min_rooms`, `max_rooms`, `min_bedrooms`, `min_bathrooms`, `min_surface_m2`, `keywords_include`, `keywords_exclude`. Los campos que el aviso no publica (ej. sin precio) no se descartan salvo que uses `require_price: true`. `retention_days` controla cuántos días se recuerdan los avisos ya vistos para que `data/listings.json` no crezca indefinidamente.

## Notificaciones por Telegram (opcional)

1. Creá un bot con [@BotFather](https://t.me/BotFather) y copiá el token.
2. Escribile un mensaje a tu bot y obtené tu chat id con `https://api.telegram.org/bot<TOKEN>/getUpdates`.
3. En el repo: **Settings → Secrets and variables → Actions** y agregá:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`

Sin estos secrets el scraper funciona igual; solo omite la notificación. Los avisos con señales de riesgo altas se marcan con ⚠️ en el mensaje.

Para probar que quedó bien configurado: **Actions → Scraper de propiedades → Run workflow** y marcá la opción *"Solo enviar un mensaje de prueba a Telegram"* — te tiene que llegar un 🔔 al chat.

## Correr localmente

```bash
pip install -r requirements.txt
python -m scraper.main            # lee jobs.json y ejecuta los jobs activos
python scripts/build_crime.py     # reconstruye data/crime.json (requiere red a GCBA)
python -m pytest tests/           # tests (parsers con fixtures HTML, riesgo, geo, filtros)
```

## Detalles a tener en cuenta

- **El cron corre sobre la rama por defecto**: el workflow programado solo se activa cuando este código está en `main`.
- GitHub puede **demorar o saltear** corridas programadas en horas pico, y **desactiva los crons tras ~60 días sin actividad** en el repo (los commits automáticos de datos ayudan a evitarlo).
- Zonaprop y MercadoLibre pueden bloquear las IPs de los runners de GitHub. Si una búsqueda devuelve 0 avisos de forma sostenida, lo vas a ver marcado en el job summary; las demás búsquedas siguen funcionando.
- Scrapeá con moderación: el scraper hace pocas páginas por búsqueda y con pausas entre requests. Respetá los términos de uso de cada portal.
