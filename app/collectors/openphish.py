"""
Колектор фішингових URL із OpenPhish (безкоштовний фід).

OpenPhish — автоматизований сервіс моніторингу фішингу.
Безкоштовний фід: https://openphish.com/feed.txt
  - Текстовий список URL (по одному на рядок)
  - Оновлюється кожні ~5 хв
  - Без API-ключа
  - Атрибуція: "Data by OpenPhish"
Ліцензія: вільне використання з посиланням на джерело.
"""
import logging
from urllib.parse import urlparse

import requests

from app.collectors.base import BaseCollector
from app.geoip import country_for_value, iso2_to_name
from app.models.phishing import PhishingURLORM

logger = logging.getLogger(__name__)

OPENPHISH_FEED_URL = "https://openphish.com/feed.txt"
SOURCE_NAME = "OpenPhish"
LICENSE = "Data by OpenPhish (free feed with attribution)"

# Бренди для визначення цілі (спільний список з phishtank.py)
KNOWN_BRANDS = {
    "paypal": "PayPal", "apple": "Apple", "microsoft": "Microsoft",
    "google": "Google", "amazon": "Amazon", "facebook": "Facebook",
    "netflix": "Netflix", "instagram": "Instagram", "whatsapp": "WhatsApp",
    "linkedin": "LinkedIn", "dropbox": "Dropbox", "dhl": "DHL",
    "fedex": "FedEx", "chase": "Chase", "wellsfargo": "Wells Fargo",
    "bankofamerica": "Bank of America", "citibank": "Citibank",
    "twitter": "Twitter", "telegram": "Telegram", "tiktok": "TikTok",
    "adobe": "Adobe", "slack": "Slack", "zoom": "Zoom",
    "ropot": "ROPOТ", "privatbank": "PrivatBank", "monobank": "Monobank",
    "oschadbank": "Ощадбанк", "ukrsibbank": "Укрсиббанк",
    "ukrposhta": "Укрпошта", "nova_poshta": "Нова Пошта",
}


def _detect_brand(url: str, host: str) -> str | None:
    combined = (url + " " + host).lower()
    for key, name in KNOWN_BRANDS.items():
        if key in combined:
            return name
    return None


class OpenPhishCollector(BaseCollector):
    source_name = SOURCE_NAME

    def fetch(self) -> list[PhishingURLORM]:
        try:
            resp = requests.get(
                OPENPHISH_FEED_URL,
                timeout=20,
                headers={"User-Agent": "Cyber-Sentinel/1.0 (phishing-monitor)"},
            )
            resp.raise_for_status()
        except requests.RequestException as e:
            status = getattr(getattr(e, "response", None), "status_code", "?")
            logger.error("OpenPhish: HTTP %s — %s", status, type(e).__name__)
            return []
        except Exception as e:
            logger.error("OpenPhish: %s", e)
            return []

        records: list[PhishingURLORM] = []
        lines = resp.text.strip().splitlines()
        for line in lines:
            url = line.strip()
            if not url or not url.startswith(("http://", "https://")):
                continue

            parsed = urlparse(url)
            host = parsed.netloc or ""
            domain = host.split(":")[0]

            brand = _detect_brand(url, host)

            country = []
            if domain:
                iso = country_for_value(domain)
                if iso:
                    country = [iso2_to_name(iso)]

            records.append(PhishingURLORM(
                external_id=f"openphish-{domain[:48]}",
                source=SOURCE_NAME,
                url=url,
                target_brand=brand,
                host=host,
                domain=domain,
                verified="auto",
                status="online",
                target_country=country,
                tags=["openphish", brand.lower()] if brand else ["openphish"],
            ))

        logger.info("OpenPhish: %d фішингових URL", len(records))
        return records
