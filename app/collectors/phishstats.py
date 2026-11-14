"""
Колектор фішингових URL із PhishStats (JSON API).

PhishStats — відкритий API з фішинговими індикаторами.
API: https://api.phishstats.info/api/phishing
Без API-ключа, є rate limit.
Ліцензія: атрибуція PhishStats.
"""
import logging
from datetime import datetime
from urllib.parse import urlparse

import requests

from app.collectors.base import BaseCollector
from app.geoip import country_for_value, iso2_to_name
from app.models.phishing import PhishingURLORM

logger = logging.getLogger(__name__)

PHISHSTATS_API_URL = "https://api.phishstats.info/api/phishing"
SOURCE_NAME = "PhishStats"
LICENSE = "PhishStats (attribution required)"

KNOWN_BRANDS = {
    "paypal": "PayPal", "apple": "Apple", "microsoft": "Microsoft",
    "google": "Google", "amazon": "Amazon", "facebook": "Facebook",
    "netflix": "Netflix", "instagram": "Instagram", "linkedin": "LinkedIn",
    "dhl": "DHL", "fedex": "FedEx", "chase": "Chase",
    "ropot": "ROPOТ", "privatbank": "PrivatBank", "monobank": "Monobank",
}


def _detect_brand(url: str, host: str) -> str | None:
    combined = (url + " " + host).lower()
    for key, name in KNOWN_BRANDS.items():
        if key in combined:
            return name
    return None


class PhishStatsCollector(BaseCollector):
    source_name = SOURCE_NAME

    def fetch(self) -> list[PhishingURLORM]:
        try:
            resp = requests.get(
                PHISHSTATS_API_URL,
                timeout=30,
                headers={"User-Agent": "UA-Cyber-Dashboard/1.0"},
            )
            resp.raise_for_status()
        except requests.RequestException as e:
            status = getattr(getattr(e, "response", None), "status_code", "?")
            logger.error("PhishStats: HTTP %s — %s", status, type(e).__name__)
            return []
        except Exception as e:
            logger.error("PhishStats: %s", e)
            return []

        records: list[PhishingURLORM] = []
        try:
            data = resp.json()
            items = data.get("data", data) if isinstance(data, dict) else data
            if not isinstance(items, list):
                items = []

            for item in items:
                if not isinstance(item, dict):
                    continue
                url = item.get("url", "").strip()
                if not url:
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

                score = item.get("phish_score", 0) or 0
                try:
                    score = float(score)
                except (TypeError, ValueError):
                    score = 0.0

                creation_date = item.get("creation_date", "")
                try:
                    first_seen = datetime.strptime(str(creation_date)[:10], "%Y-%m-%d")
                except (TypeError, ValueError):
                    first_seen = None

                records.append(PhishingURLORM(
                    external_id=f"phishstats-{item.get('id', domain[:48])}",
                    source=SOURCE_NAME,
                    url=url,
                    target_brand=brand,
                    host=host,
                    domain=domain,
                    verified="community",
                    status="online",
                    target_country=country,
                    tags=["phishstats", f"score-{int(score)}"] + ([brand.lower()] if brand else []),
                    first_seen=first_seen,
                    last_seen=first_seen,
                ))

        except Exception as e:
            logger.error("PhishStats: parse error — %s", e)
            return []

        logger.info("PhishStats: %d фішингових URL", len(records))
        return records
