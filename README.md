# 🏠 Real Estate Scraping Argentina

Scraper de portales inmobiliarios argentinos que corre **cada 1 hora, todos los días** en GitHub Actions. Busca propiedades en alquiler o venta según los criterios que definas, guarda el histórico en el repo y (opcionalmente) te avisa por Telegram cuando aparecen avisos nuevos.

## Portales soportados

| Portal | Sitio | Notas |
|---|---|---|
| Argenprop | `argenprop.com` | HTML server-side, el más estable para scrapear |
| Zonaprop | `zonaprop.com.ar` | Protegido por Cloudflare; se usa `cloudscraper`, puede bloquear IPs de GitHub |
| MercadoLibre Inmuebles | `inmuebles.mercadolibre.com.ar` | HTML server-side |

## Cómo funciona

1. El workflow [`scraper.yml`](.github/workflows/scraper.yml) corre con cron `0 * * * *` (cada hora, UTC).
2. Lee las búsquedas de [`config.yaml`](config.yaml), scrapea cada portal y aplica tus filtros.
3. Compara contra `data/listings.json` (el "ya visto"), agrega los avisos nuevos y commitea el archivo al repo.
4. Si configuraste Telegram, te envía un mensaje con los avisos nuevos. Siempre deja un resumen en el *job summary* de la corrida.

## Configurar tus búsquedas

Editá `config.yaml`. Para cada búsqueda:

1. Entrá al portal y aplicá los filtros con la interfaz del sitio (zona, operación, precio, ambientes…).
2. Copiá la URL de resultados y pegala en `url` — el sitio se detecta solo por el dominio.
3. Opcionalmente afiná con filtros post-scraping:

```yaml
searches:
  - name: "Alquiler 2 amb Palermo"
    url: "https://www.argenprop.com/departamentos/alquiler/palermo"
    max_pages: 2
    filters:
      currency: ARS          # exige la moneda
      max_price: 900000      # tope de precio
      min_rooms: 2           # ambientes mínimos
      min_surface_m2: 40     # superficie mínima
      keywords_exclude: ["temporario"]
```

Filtros disponibles: `currency`, `min_price`, `max_price`, `require_price`, `min_rooms`, `max_rooms`, `min_bedrooms`, `min_surface_m2`, `keywords_include`, `keywords_exclude`. Los campos que el aviso no publica (ej. sin precio) no se descartan salvo que uses `require_price: true`.

## Notificaciones por Telegram (opcional)

1. Creá un bot con [@BotFather](https://t.me/BotFather) y copiá el token.
2. Escribile un mensaje a tu bot y obtené tu chat id con `https://api.telegram.org/bot<TOKEN>/getUpdates`.
3. En el repo: **Settings → Secrets and variables → Actions** y agregá:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`

Sin estos secrets el scraper funciona igual; solo omite la notificación.

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
