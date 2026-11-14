"""
Колектор даних Shodan — відкриті хости, вразливі сервіси, C2-інфраструктура.

Джерело: https://api.shodan.io/
API key: https://account.shodan.io/
Безкоштовний тариф: 1 запит/сек, 100 запитів/місяць
Ліцензія: Shodan ToS

Шукає вразливі сервіси та підозрілу інфраструктуру
(SSH brute, open RDP, дешертою C2-сервіси).
"""
import logging
import os
import time

import requests

from app.collectors.base import BaseCollector
from app.models.threat import Region, Severity, Threat, ThreatType
from app.geoip import country_for_value, iso2_to_name

logger = logging.getLogger(__name__)

SOURCE_NAME = "Shodan"
LICENSE = "Shodan ToS (free tier: 100 req/month)"

# Типи сервісів, які можуть бути ознакою атаки/інфекції
SUSPICIOUS_PORTS = {
    22: "SSH (possibly brute-force)",
    3389: "RDP (remote desktop)",
    4444: "Metasploit handler",
    5555: "Android debug / backdoor",
    6666: "Common C2 port",
    8080: "HTTP proxy (often abused)",
    8443: "HTTPS alt (often abused)",
    9001: "Tor ORPort",
    1080: "SOCKS proxy",
    3128: "HTTP proxy",
    5900: "VNC",
    6379: "Redis (often exposed)",
    27017: "MongoDB (often exposed)",
    11211: "Memcached (often exposed)",
    5432: "PostgreSQL (exposed)",
    3306: "MySQL (exposed)",
}


class ShodanCollector(BaseCollector):
    source_name = SOURCE_NAME

    def fetch(self) -> list[Threat]:
        api_key = os.getenv("SHODAN_API_KEY", "")
        if not api_key:
            logger.info("SHODAN_API_KEY не задано — колектор пропущено")
            return []

        headers = {"Accept": "application/json"}
        threats: list[Threat] = []

        # Обмежуємо 1 запитом/день (free tier: 100/міс, 1 запит/сек)
        # 1 запит/день = 30/міс = 30% ліміту — безпечний запас
        queries = [
            "port:4444 country:UA",
            "port:6666 country:UA",
            "port:5555 country:UA",
        ]

        for query in queries[:1]:  # 1 запит на запуск (1/день = 30/міс)
            try:
                resp = requests.get(
                    "https://api.shodan.io/shodan/host/search",
                    params={"key": api_key, "query": query, "limit": 20},
                    headers=headers,
                    timeout=20,
                )
                if resp.status_code == 429:
                    logger.warning("Shodan: rate limit (429), пропускаємо решту запитів")
                    break
                if resp.status_code != 200:
                    logger.warning("Shodan: HTTP %s для query '%s'", resp.status_code, query)
                    continue

                matches = resp.json().get("matches", [])
                for match in matches:
                    ip = match.get("ip_str", "")
                    port = match.get("port", 0)
                    org = match.get("org", "")
                    product = match.get("product", "")
                    hostnames = match.get("hostnames", [])
                    country_code = match.get("location", {}).get("country_code", "")

                    service_desc = SUSPICIOUS_PORTS.get(port, f"Port {port}")
                    severity = Severity.medium if port in (4444, 6666, 5555) else Severity.low

                    country = []
                    if country_code:
                        name = iso2_to_name(country_code)
                        if name:
                            country = [name]

                    threats.append(Threat(
                        external_id=f"shodan-{ip}-{port}",
                        title=f"Exposed service: {ip}:{port} ({service_desc})",
                        source=SOURCE_NAME,
                        type=ThreatType.ioc,
                        severity=severity,
                        region=Region.world,
                        country=country,
                        summary=f"Org: {org}. Product: {product}. Hostnames: {', '.join(hostnames[:3])}. Query: {query}",
                        tags=["shodan", "exposed-service", str(port)],
                    ))

                time.sleep(1.5)  # Rate limit: 1 req/sec
            except Exception as e:
                logger.error("Shodan query '%s': %s", query, e)

        logger.info("Shodan: %d записів", len(threats))
        return threats
