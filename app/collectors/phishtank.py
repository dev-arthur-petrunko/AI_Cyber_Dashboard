"""
Колектор фішингових URL із PhishTank (публічний CSV dump).

PhishTank — community-driven база фішингових URL.
Безкоштовний доступ: https://data.phishtank.com/data/online-valid.csv
Rate limit нижчий без API-ключа, але достатній для щоденного оновлення.
Атрибуція: "Data provided by PhishTank" обов'язкова.
"""
import csv
import io
import logging
from datetime import datetime
from urllib.parse import urlparse

import requests

from app.collectors.base import BaseCollector
from app.geoip import country_for_value, iso2_to_name
from app.models.phishing import PhishingURLORM

logger = logging.getLogger(__name__)

PHISHTANK_CSV_URL = "https://data.phishtank.com/data/online-valid.csv"
SOURCE_NAME = "PhishTank"
LICENSE = "Data provided by PhishTank (free redistribution with attribution)"

# Бренди, які найчастіше імітують у фішингу
KNOWN_BRANDS = {
    "paypal": "PayPal", "apple": "Apple", "microsoft": "Microsoft",
    "google": "Google", "amazon": "Amazon", "facebook": "Facebook",
    "netflix": "Netflix", "instagram": "Instagram", "whatsapp": "WhatsApp",
    "linkedin": "LinkedIn", "dropbox": "Dropbox", "dhl": "DHL",
    "fedex": "FedEx", "ups": "UPS", "usps": "USPS",
    "chase": "Chase", "wellsfargo": "Wells Fargo", "bankofamerica": "Bank of America",
    "citibank": "Citibank", "hsbc": "HSBC", "barclays": "Barclays",
    "twitter": "Twitter", "telegram": "Telegram", "tiktok": "TikTok",
    "adobe": "Adobe", "slack": "Slack", "zoom": "Zoom",
    "ropot": "ROPOТ", "privatbank": "PrivatBank", "monobank": "Monobank",
    "oschadbank": "Ощадбанк", "ukrsibbank": "Укрсиббанк",
    "ukrposhta": "Укрпошта", "nova_poshta": "Нова Пошта",
}


def _detect_brand(url: str, host: str) -> str | None:
    """Визначає бренд за URL або хостом."""
    combined = (url + " " + host).lower()
    for key, name in KNOWN_BRANDS.items():
        if key in combined:
            return name
    return None


class PhishTankCollector(BaseCollector):
    source_name = SOURCE_NAME

    def fetch(self) -> list[PhishingURLORM]:
        # PhishTank щодня публікує повний verified_online.csv (~10+ МБ),
        # відсортований від найсвіжіх записів. Ми беремо лише перші 500,
        # тому качаємо файл потоково й обриваємо з'єднання одразу, як
        # набрали достатньо рядків (раніше resp.text намагався завантажити
        # весь дамп і колектор зависав на хвилини).
        records: list[PhishingURLORM] = []
        try:
            with requests.get(
                PHISHTANK_CSV_URL,
                timeout=(10, 30),
                stream=True,
                headers={"User-Agent": "Cyber-Sentinel/1.0 (phishing-monitor)"},
            ) as resp:
                resp.raise_for_status()
                buf = ""
                for chunk in resp.iter_content(chunk_size=65536):
                    if not chunk:
                        continue
                    buf += chunk.decode("utf-8", errors="replace")
                    # Парсимо лише завершені рядки (хвіст без \n може бути
                    # обрізаний посередині запису — відкладаємо до наступного
                    # чанка).
                    parse_buf = buf if buf.endswith("\n") else buf[: buf.rfind("\n") + 1]
                    rows = list(csv.DictReader(io.StringIO(parse_buf)))
                    if self._parse_rows(rows, records):
                        break
        except requests.RequestException as e:
            status = getattr(getattr(e, "response", None), "status_code", "?")
            logger.error("PhishTank: HTTP %s — %s", status, type(e).__name__)
            return []
        except Exception as e:
            logger.error("PhishTank: %s", e)
            return []

        logger.info("PhishTank: %d фішингових URL", len(records))
        return records

    MAX_RECORDS = 500

    def _parse_rows(self, rows: list[dict], records: list[PhishingURLORM]) -> bool:
        """Перебудовує records з переданих рядків; True — ліміт досягнуто."""
        records.clear()
        for row in rows:
            url = row.get("url", "").strip()
            if not url:
                continue

            parsed = urlparse(url)
            host = parsed.netloc or ""
            domain = host.split(":")[0]

            brand = _detect_brand(url, host)

            # Геолокація за доменом
            country = []
            if domain:
                iso = country_for_value(domain)
                if iso:
                    country = [iso2_to_name(iso)]

            # Дата виявлення (у дампі — submission_time / verification_time)
            phish_date = row.get("submission_time") or row.get("verification_time") or row.get("phish_date") or ""
            try:
                first_seen = datetime.strptime(phish_date[:10], "%Y-%m-%d")
            except (TypeError, ValueError):
                first_seen = None

            verified = row.get("verified", "").strip().lower()
            # verified_online.csv містить ТІЛЬКИ верифіковані URL; колонка
            # verified зберігає "yes"/"no". Мапимо на шкалу дашборда
            # ('verified'|'community'|'auto'), інакше 500 записів не потрапляли
            # б у лічильник «Перевірено».
            if verified == "yes":
                verified = "verified"
            status = row.get("online", row.get("status", "online")).strip().lower()

            records.append(PhishingURLORM(
                external_id=f"phishtank-{row.get('phish_id', url[:64])}",
                source=SOURCE_NAME,
                url=url,
                target_brand=brand,
                host=host,
                domain=domain,
                verified=verified,
                status=status,
                target_country=country,
                tags=["phishtank", brand.lower()] if brand else ["phishtank"],
                first_seen=first_seen,
                last_seen=first_seen,
            ))

            if len(records) >= self.MAX_RECORDS:
                return True
        return False
