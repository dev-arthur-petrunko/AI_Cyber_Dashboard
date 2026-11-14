"""
Колектор MITRE ATT&CK Groups (GitHub CTI repository).

Джерело: https://github.com/mitre/cti
Формат: STIX 2.1 JSON (intrusion-set)
Оновлення: git pull (regулярно)
Ліцензія: Apache 2.0

Завантажує JSON з intrusion-set та конвертує в Threat записи
для бази загроз (для трекеру груп-акторів).
"""
import logging

import requests

from app.collectors.base import BaseCollector
from app.models.threat import Region, Severity, Threat, ThreatType
from app.db import now_utc

logger = logging.getLogger(__name__)

MITRE_ATTACK_URL = (
    "https://raw.githubusercontent.com/mitre/cti/master/"
    "enterprise-attack/enterprise-attack.json"
)
SOURCE_NAME = "MITRE ATT&CK"
LICENSE = "Apache 2.0 (MITRE Corporation)"


class MITREAttackCollector(BaseCollector):
    source_name = SOURCE_NAME

    def fetch(self) -> list[Threat]:
        try:
            resp = requests.get(MITRE_ATTACK_URL, timeout=60)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            logger.error("MITRE ATT&CK: %s", e)
            return []

        threats: list[Threat] = []
        objects = data.get("objects", [])
        for obj in objects:
            if obj.get("type") != "intrusion-set":
                continue

            name = obj.get("name", "")
            ext_refs = obj.get("external_references", [])
            external_id = ""
            url = ""
            for ref in ext_refs:
                if ref.get("source_name") == "mitre-attack":
                    external_id = ref.get("external_id", "")
                    url = ref.get("url", "")
                    break

            if not name:
                continue

            # Країни з aliases або labels
            country = []
            aliases = obj.get("aliases", [])
            description = obj.get("description", "")[:300]

            # Позначення країн
            country_keywords = {
                "russia": "Russia", "iran": "Iran", "china": "China",
                "north korea": "DPRK", "dprk": "DPRK",
                "україна": "Ukraine", "ukraine": "Ukraine",
                "pakistan": "Pakistan", "india": "India",
                "belarus": "Belarus", "syria": "Syria",
                "united states": "USA", "united kingdom": "United Kingdom",
                "turkey": "Turkey", "vietnam": "Vietnam",
            }
            desc_lower = (name + " " + description).lower()
            for kw, cn in country_keywords.items():
                if kw in desc_lower:
                    country.append(cn)

            tags = ["mitre-attack", "apt"] + [a.lower() for a in aliases[:3]]

            threats.append(Threat(
                external_id=f"mitre-{external_id or name[:64]}",
                title=f"{name} ({external_id})" if external_id else name,
                source=SOURCE_NAME,
                type=ThreatType.advisory,
                severity=Severity.high,
                region=Region.world,
                country=list(set(country)),
                summary=description,
                tags=tags,
                url=url,
                published=now_utc(),
            ))

        logger.info("MITRE ATT&CK: %d intrusion-set", len(threats))
        return threats
