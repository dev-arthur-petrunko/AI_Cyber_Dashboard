"""
Колектор MISP Galaxy Threat Actor clusters.

Джерело: https://github.com/MISP/misp-galaxy
Файл: clusters/threat-actor.json
Формат: JSON (MISP Galaxy cluster format)
Оновлення: git pull / raw.githubusercontent.com
Ліцензія: Apache 2.0

Містить структуровані дані про APT-групи зі зв'язками,
псевдонімами та країнами походження.
"""
import logging

import requests

from app.collectors.base import BaseCollector
from app.models.threat import Region, Severity, Threat, ThreatType
from app.db import now_utc

logger = logging.getLogger(__name__)

MISP_GALAXY_URL = (
    "https://raw.githubusercontent.com/MISP/misp-galaxy/main/"
    "clusters/threat-actor.json"
)
SOURCE_NAME = "MISP Galaxy"
LICENSE = "Apache 2.0 (MISP Project)"


class MISPGalaxyCollector(BaseCollector):
    source_name = SOURCE_NAME

    def fetch(self) -> list[Threat]:
        try:
            resp = requests.get(MISP_GALAXY_URL, timeout=30)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.error("MISP Galaxy: %s", e)
            return []

        threats: list[Threat] = []
        values = data.get("values", [])
        for entry in values:
            name = entry.get("value", "")
            description = entry.get("description", "")[:300]
            meta = entry.get("meta", {})

            if not name:
                continue

            # Країни з meta
            country = []
            for field in ("country", "attribution"):
                vals = meta.get(field, [])
                if isinstance(vals, str):
                    vals = [vals]
                country.extend(vals)

            # Псевдоніми
            synonyms = meta.get("synonyms", [])
            if isinstance(synonyms, str):
                synonyms = [synonyms]

            external_id = entry.get("uuid", name[:64])
            url = f"https://github.com/MISP/misp-galaxy/blob/main/clusters/threat-actor.json#cluster-{name.lower().replace(' ', '-')}"

            threats.append(Threat(
                external_id=f"misp-galaxy-{external_id}",
                title=f"APT: {name}" + (f" ({', '.join(synonyms[:2])})" if synonyms else ""),
                source=SOURCE_NAME,
                type=ThreatType.advisory,
                severity=Severity.high,
                region=Region.world,
                country=list(set(country)),
                summary=description or f"MISP Galaxy threat actor: {name}",
                tags=["misp-galaxy", "apt"] + [s.lower() for s in synonyms[:3]],
                url=url,
                published=now_utc(),
            ))

        logger.info("MISP Galaxy: %d threat actors", len(threats))
        return threats
