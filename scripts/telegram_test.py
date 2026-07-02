"""Envía un mensaje de prueba a Telegram para verificar los secrets.

Se ejecuta desde el workflow del scraper con el input `telegram_test`.
Sale con código 1 si falla, así el run queda en rojo y es fácil de notar.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scraper.models import Listing
from scraper.notify import send_telegram


def main() -> int:
    test_listing = Listing(
        id="test:1",
        site="prueba",
        url="https://github.com/molicode/real-estate-scraping",
        title="🔔 Mensaje de prueba del scraper de propiedades",
        address="Si ves esto, Telegram quedó configurado correctamente ✅",
    )
    if send_telegram([test_listing]):
        print("✅ Mensaje de prueba enviado")
        return 0
    print(
        "❌ No se pudo enviar. Revisá que los secrets TELEGRAM_BOT_TOKEN y "
        "TELEGRAM_CHAT_ID estén definidos y sean correctos, y que le hayas "
        "escrito al menos un mensaje al bot."
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
