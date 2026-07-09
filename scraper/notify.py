"""Notificaciones de avisos nuevos.

Telegram es opcional: se activa definiendo los secrets TELEGRAM_BOT_TOKEN
y TELEGRAM_CHAT_ID en el repositorio. Además siempre se escribe un resumen
en el job summary de GitHub Actions (GITHUB_STEP_SUMMARY).
"""

from __future__ import annotations

import html
import logging
import os
from pathlib import Path

import requests

from .models import Listing

logger = logging.getLogger(__name__)

TELEGRAM_LIMIT = 4096


def format_price(listing: Listing) -> str:
    if listing.price_amount is None:
        return "Consultar precio"
    symbol = "USD " if listing.price_currency == "USD" else "$ "
    return f"{symbol}{listing.price_amount:,.0f}".replace(",", ".")


def format_listing_line(listing: Listing) -> str:
    parts = [format_price(listing)]
    if listing.rooms:
        parts.append(f"{listing.rooms} amb")
    if listing.surface_m2:
        parts.append(f"{listing.surface_m2:.0f} m²")
    if listing.address:
        parts.append(listing.address)
    return " · ".join(parts)


def send_telegram(new_listings: list[Listing]) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        logger.info("Telegram no configurado; salteo la notificación")
        return False
    if not new_listings:
        return False

    lines = [f"🏠 <b>{len(new_listings)} propiedades nuevas</b>", ""]
    for listing in new_listings:
        title = html.escape(listing.title or listing.address or listing.site)
        detail = html.escape(format_listing_line(listing))
        line = f"• <a href=\"{html.escape(listing.url)}\">{title}</a>\n  {detail}"
        alerts = [f["label"] for f in (listing.flags or []) if f.get("level") == "high"]
        if alerts:
            line += "\n  ⚠️ " + html.escape(" · ".join(alerts))
        lines.append(line)

    # Cortamos en mensajes de menos de 4096 caracteres.
    messages: list[str] = []
    current = ""
    for line in lines:
        candidate = f"{current}\n{line}" if current else line
        if len(candidate) > TELEGRAM_LIMIT - 100:
            messages.append(current)
            current = line
        else:
            current = candidate
    if current:
        messages.append(current)

    ok = True
    for message in messages:
        try:
            resp = requests.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={
                    "chat_id": chat_id,
                    "text": message,
                    "parse_mode": "HTML",
                    "disable_web_page_preview": True,
                },
                timeout=30,
            )
            if resp.status_code != 200:
                logger.warning("Telegram devolvió %s: %s", resp.status_code, resp.text[:200])
                ok = False
        except requests.RequestException as exc:
            logger.warning("Error enviando a Telegram: %s", exc)
            ok = False
    return ok


def write_github_summary(
    new_listings: list[Listing], stats: dict[str, int], errors: list[str]
) -> None:
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    lines = ["## 🏠 Resultado del scraping", ""]
    lines.append(f"Avisos encontrados por búsqueda:")
    lines.append("")
    lines.append("| Búsqueda | Avisos | Nuevos |")
    lines.append("|---|---|---|")
    for name, count in stats.items():
        new_count = sum(1 for l in new_listings if l.search_name == name)
        lines.append(f"| {name} | {count} | {new_count} |")
    if new_listings:
        lines.append("")
        lines.append(f"### ✨ {len(new_listings)} avisos nuevos")
        lines.append("")
        for listing in new_listings[:50]:
            lines.append(
                f"- [{listing.title or listing.address or listing.url}]({listing.url}) — "
                f"{format_listing_line(listing)}"
            )
        if len(new_listings) > 50:
            lines.append(f"- … y {len(new_listings) - 50} más (ver data/listings.json)")
    if errors:
        lines.append("")
        lines.append("### ⚠️ Errores")
        lines.append("")
        for err in errors:
            lines.append(f"- {err}")
    with Path(summary_path).open("a", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")
