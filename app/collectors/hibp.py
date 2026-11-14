"""
Колектор витоків даних — Have I Been Pwned (HIBP) API v3.

Джерело: https://haveibeenpwned.com/api/v3/breaches
Ендпоінт: /api/v3/breaches (список усіх витоків, без ключа)
Ліцензія: безкоштовний для невеликих обсягів (1 req/1.5s без ключа)
Формат: JSON

Завантажує список останніх витоків та зберігає як загрози.
Для пошуку по email/домену потрібен API-ключ — це окрема функція.
"""
import logging
from datetime import datetime

import requests

from app.collectors.base import BaseCollector
from app.models.threat import Region, Severity, Threat, ThreatType

logger = logging.getLogger(__name__)

HIBP_BREACHES_URL = "https://haveibeenpwned.com/api/v3/breaches"
SOURCE_NAME = "HIBP"
LICENSE = "Have I Been Pwned (free tier with rate limits)"


class HIBPCollector(BaseCollector):
    source_name = SOURCE_NAME

    def fetch(self) -> list[Threat]:
        try:
            resp = requests.get(
                HIBP_BREACHES_URL,
                timeout=30,
                headers={
                    "User-Agent": "UA-Cyber-Dashboard/1.0",
                    "hibp-api-key": "",  # без ключа — обмежений rate limit
                },
            )
            resp.raise_for_status()
            breaches = resp.json()
        except requests.HTTPError as e:
            status = getattr(getattr(e, "response", None), "status_code", "?")
            if status == 401:
                logger.warning("HIBP: потрібен API-ключ для повного доступу")
            else:
                logger.error("HIBP: HTTP %s", status)
            return []
        except Exception as e:
            logger.error("HIBP: %s", e)
            return []

        threats: list[Threat] = []
        for breach in breaches:
            name = breach.get("Name", "")
            title = breach.get("Title", name)
            domain = breach.get("Domain", "")
            description = breach.get("Description", "")[:300]
            pwn_count = breach.get("PwnCount", 0)
            data_classes = breach.get("DataClasses", [])
            breach_date = breach.get("BreachDate", "")

            try:
                published = datetime.strptime(breach_date, "%Y-%m-%d")
            except (TypeError, ValueError):
                published = None

            # Визначення критичності за кількістю витоків
            if pwn_count > 100_000_000:
                severity = Severity.critical
            elif pwn_count > 10_000_000:
                severity = Severity.high
            elif pwn_count > 1_000_000:
                severity = Severity.medium
            else:
                severity = Severity.low

            threats.append(Threat(
                external_id=f"hibp-{name}",
                title=f"Breach: {title} ({pwn_count:,} accounts)",
                source=SOURCE_NAME,
                type=ThreatType.advisory,
                severity=severity,
                region=Region.world,
                country=[],
                summary=f"{description}\nData classes: {', '.join(data_classes)}\nDomain: {domain}",
                tags=["hibp", "breach", "data-leak"] + [c.lower() for c in data_classes[:5]],
                url=f"https://haveibeenpwned.com/Account/{name}" if domain else None,
                published=published,
            ))

        logger.info("HIBP: %d breaches", len(threats))
        return threats
