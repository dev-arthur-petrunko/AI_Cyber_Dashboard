"""
Колектор офіційних Telegram-каналів через Telegram Bot API.

Використовується для джерел, де прямий сайт недоступний для скрапінгу
(наприклад Akamai EdgeSuite блокує СБУ/SSSCIP): бот, доданий адміністратором
до публічного каналу, отримує його публікації через getUpdates.

Налаштування (.env):
  TELEGRAM_BOT_TOKEN=...   — токен бота (створюється через @BotFather)
  TELEGRAM_CHANNELS=@...   — список каналів через кому, напр. "@sbu_gov_ua,@dsszzi"

Без TELEGRAM_BOT_TOKEN колектор мовчки пропускається (повертає []),
щоб pipeline не падав на локальних машинах без токена.
"""
import logging
import os
from datetime import datetime, timezone

import requests

from app.collectors.base import BaseCollector
from app.models.threat import Region, Severity, Threat, ThreatType
from app.scoring import infer_severity

logger = logging.getLogger(__name__)

TELEGRAM_API_URL = "https://api.telegram.org"
CHANNEL_NAMES = {
    # Канали офіційних установ. Юзернейми треба перевірити у власника каналу.
    "sbu": "СБУ (Telegram)",
    "ssscip": "SSSCIP (Telegram)",
    "cyberpolice_ua": "Кіберполіція (Telegram)",
    "cyberpartizan": "Кіберпартизани (Telegram)",
    "cert_ua": "CERT-UA (Telegram)",
    "dsns_gov": "ДСНС (Telegram)",
}


def _parse_channel_name(username: str) -> str:
    """Співставляє @username з дружньою назвою джерела."""
    cleaned = username.lstrip("@").lower()
    return CHANNEL_NAMES.get(cleaned, f"Telegram {username}")


class TelegramChannelCollector(BaseCollector):
    """Збирає останні публікації каналів через Bot API (getUpdates)."""

    source_name = "Telegram"

    def __init__(self) -> None:
        self.token = os.getenv("TELEGRAM_BOT_TOKEN")
        self.channels = [
            ch.strip()
            for ch in os.getenv("TELEGRAM_CHANNELS", "").split(",")
            if ch.strip()
        ]

    def fetch(self) -> list[Threat]:
        if not self.token:
            logger.info(
                "TELEGRAM_BOT_TOKEN не задано — колектор Telegram пропущено "
                "(для СБУ/SSSCIP задайте токен і TELEGRAM_CHANNELS у .env)"
            )
            return []
        if not self.channels:
            logger.info("TELEGRAM_CHANNELS порожній — колектор Telegram пропущено")
            return []

        threats: list[Threat] = []
        for channel in self.channels:
            threats.extend(self._fetch_channel(channel))
        return threats

    def _fetch_channel(self, channel: str) -> list[Threat]:
        # offset=-N повертає останні N апдейтів (навіть уже підтверджених),
        # тож статус «офсет» не треба зберігати між запусками.
        try:
            resp = requests.get(
                f"{TELEGRAM_API_URL}/bot{self.token}/getUpdates",
                params={"timeout": 0, "limit": 100, "offset": -100},
                timeout=15,
            )
            resp.raise_for_status()
        except requests.RequestException as e:
            logger.error("Telegram getUpdates failed (%s): %s", channel, e)
            return []

        data = resp.json()
        if not data.get("ok"):
            logger.error("Telegram API error (%s): %s", channel, data.get("description"))
            return []

        source = _parse_channel_name(channel)
        channel_threats: list[Threat] = []
        seen: set[str] = set()
        for update in data.get("result", []):
            post = update.get("channel_post") or update.get("message")
            if not post:
                continue
            chat = post.get("chat", {})
            # Пропускаємо повідомлення не з нашого каналу
            if "@" + str(chat.get("username", "")).lower() != channel.lower() and str(
                chat.get("id", "")
            ) != channel.lstrip("@"):
                continue

            message_id = post.get("message_id")
            if message_id is None or message_id in seen:
                continue
            seen.add(message_id)

            text = post.get("text") or post.get("caption") or ""
            if not text:
                continue
            # Стиснення: перший рядок — заголовок, решта — анотація
            lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
            title = (lines[0] if lines else "Публікація")[:200]
            summary = "\n".join(lines[1:])[:800]

            # Публікації Telegram мають вигляд «Телеграм без посилань» — посилання
            # на веб-версію посту (t.me/...), якщо канал публічний.
            web_url = None
            if chat.get("username"):
                web_url = f"https://t.me/{chat['username']}/{message_id}"

            published = datetime.fromtimestamp(post.get("date", 0), tz=timezone.utc).replace(tzinfo=None)

            channel_threats.append(
                Threat(
                    external_id=f"tg-{channel.lstrip('@')}-{message_id}",
                    title=title,
                    source=source,
                    type=ThreatType.news,
                    severity=infer_severity(
                        title=title,
                        summary=summary[:400] if summary else "",
                        tags=["Telegram", channel.lstrip("@")],
                        default="Unknown",
                    ),
                    region=Region.ua,
                    country=["Ukraine"],
                    published=published,
                    summary=summary,
                    url=web_url,
                    tags=["Telegram", channel.lstrip("@")],
                )
            )

        logger.info("%s: %d публікацій", source, len(channel_threats))
        return channel_threats
