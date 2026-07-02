# 🏠 Real Estate Scraping Argentina

Scraper de portales inmobiliarios argentinos que corre **cada 1 hora, todos los días** en GitHub Actions. Busca propiedades en alquiler o venta según los criterios que definas, guarda el histórico en el repo y (opcionalmente) te avisa por Telegram cuando aparecen avisos nuevos.

## Portales soportados

| Portal | Sitio | Notas |
|---|---|---|
| Argenprop | `argenprop.com` | HTML server-side, funciona directo desde GitHub Actions |
| Zonaprop | `zonaprop.com.ar` | Cloudflare bloquea a los runners de GitHub: requiere el secret `SCRAPERAPI_KEY` |
| MercadoLibre Inmuebles | `inmuebles.mercadolibre.com.ar` | Bloquea IPs de datacenter (redirige a verificación): requiere el secret `SCRAPERAPI_KEY` |
| Remax | `remax.com.ar` | Se consume la API JSON pública del sitio (SPA sin HTML server-side) |

### Proxy de scraping (para Zonaprop y MercadoLibre)

Estos dos portales bloquean el acceso directo desde los servidores de GitHub. El scraper intenta primero directo y, si detecta el bloqueo y existe el secret `SCRAPERAPI_KEY`, reintenta a través de [ScraperAPI](https://www.scraperapi.com/) (tiene plan gratuito de ~1.000 requests/mes). Para activarlo: creá una cuenta, copiá tu API key y agregala como secret `SCRAPERAPI_KEY` en **Settings → Secrets and variables → Actions**. Sin el secret, esos portales simplemente devuelven 0 avisos (queda marcado en el job summary).

## Cómo funciona

1. Definís **jobs** (búsquedas) desde la **web de administración** (GitHub Pages) o editando [`jobs.json`](jobs.json) a mano. Cada job apunta a un portal con sus filtros.
2. El workflow [`scraper.yml`](.github/workflows/scraper.yml) corre con cron `0 * * * *` (cada hora, UTC) y ejecuta los jobs **activos**; si no hay ninguno, no scrapea nada. También podés dispararlo al instante desde la web.
3. Compara contra `data/listings.json` (el "ya visto"), agrega los avisos nuevos y commitea el archivo al repo.
4. Si configuraste Telegram, te envía un mensaje con los avisos nuevos. Siempre deja un resumen en el *job summary* de la corrida.

## Web de administración

La carpeta [`web/`](web/) se despliega a GitHub Pages con [`pages.yml`](.github/workflows/pages.yml). Desde ahí podés:

- **Crear/editar/pausar/eliminar jobs** por portal, con los filtros comunes (precio, moneda, ambientes, dormitorios, superficie, keywords) y ayuda específica por sitio para armar la URL.
- **Guardar**: commitea `jobs.json` en `main` vía la API de GitHub.
- **Ejecutar ahora**: dispara el workflow del scraper sin esperar al cron.
- **Ver resultados** (`data/listings.json`) y el **historial de corridas**.

Para usarla necesitás un [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) con acceso a este repo y permisos `Contents: Read and write` + `Actions: Read and write`. Se guarda solo en tu navegador.

## Formato de jobs.json

```json
{
  "retention_days": 60,
  "defaults": { "max_pages": 2 },
  "searches": [
    {
      "name": "Alquiler 2 amb Palermo",
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

La `url` se copia del portal con sus filtros nativos aplicados; el `site` se detecta solo por el dominio. Filtros disponibles: `currency`, `min_price`, `max_price`, `require_price`, `min_rooms`, `max_rooms`, `min_bedrooms`, `min_surface_m2`, `keywords_include`, `keywords_exclude`. Los campos que el aviso no publica (ej. sin precio) no se descartan salvo que uses `require_price: true`.

## Notificaciones por Telegram (opcional)

1. Creá un bot con [@BotFather](https://t.me/BotFather) y copiá el token.
2. Escribile un mensaje a tu bot y obtené tu chat id con `https://api.telegram.org/bot<TOKEN>/getUpdates`.
3. En el repo: **Settings → Secrets and variables → Actions** y agregá:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`

Sin estos secrets el scraper funciona igual; solo omite la notificación.

Para probar que quedó bien configurado: **Actions → Scraper de propiedades → Run workflow** y marcá la opción *"Solo enviar un mensaje de prueba a Telegram"* — te tiene que llegar un 🔔 al chat.

## Correr localmente

```bash
pip install -r requirements.txt
python -m scraper.main            # usa config.yaml
python -m pytest tests/           # tests (parsers con fixtures HTML)
```

## Detalles a tener en cuenta

- **El cron corre sobre la rama por defecto**: el workflow programado solo se activa cuando este código está en `main`.
- GitHub puede **demorar o saltear** corridas programadas en horas pico, y **desactiva los crons tras ~60 días sin actividad** en el repo (los commits automáticos de datos ayudan a evitarlo).
- Zonaprop puede bloquear las IPs de los runners de GitHub. Si una búsqueda devuelve 0 avisos de forma sostenida, lo vas a ver marcado en el job summary; las demás búsquedas siguen funcionando.
- `retention_days` en `config.yaml` controla cuántos días se recuerdan los avisos ya vistos para que `data/listings.json` no crezca indefinidamente.
- Scrapeá con moderación: el scraper hace pocas páginas por búsqueda y con pausas entre requests. Respetá los términos de uso de cada portal.
