"""
CIRCL MISP OSINT feed — відкритий агрегований фід державного CERT Люксембургу
(CIRCL). Без реєстрації та ключів: https://www.circl.lu/doc/misp/feed-osint/

Формат: manifest.json (uuid -> метадані події) + окремі {uuid}.json з повною
подією MISP (Event.info, Event.Attribute[] тощо).
"""
import logging
from datetime import datetime

import requests

from app.collectors.base import BaseCollector
from app.http_utils import hard_timeout_get
from app.models.threat import Severity, Threat, ThreatType
from app.scoring import infer_severity

logger = logging.getLogger(__name__)

UA = {"User-Agent": "CyberSentinel/1.6 (+threat-intelligence dashboard)"}

FEED_URL = "https://www.circl.lu/doc/misp/feed-osint/"
EVENT_LIMIT = 20  # стільки найсвіжіших подій тягнемо за один запуск


class CirclMispCollector(BaseCollector):
    """Останні OSINT-події CIRCL (агрегат MISP-фіду CERT Люксембургу)."""

    source_name = "CIRCL OSINT"

    def fetch(self) -> list[Threat]:
        try:
            resp = hard_timeout_get(FEED_URL + "manifest.json", headers=UA, timeout=30, hard_timeout=45)
            resp.raise_for_status()
            manifest = resp.json()
        except (requests.RequestException, ValueError) as e:
            logger.error("CIRCL manifest fetch failed: %s", str(e)[:120])
            return []

        if not isinstance(manifest, dict) or not manifest:
            logger.error("CIRCL manifest: неочікуваний формат (%s)", type(manifest).__name__)
            return []

        # Найсвіжіші події спочатку (timestamp — unix epoch як рядок/число)
        def _ts(item):
            try:
                return int(item[1].get("timestamp") or 0)
            except (TypeError, ValueError):
                return 0

        latest = sorted(manifest.items(), key=_ts, reverse=True)[:EVENT_LIMIT]

        threats: list[Threat] = []
        for uuid, meta in latest:
            event = self._fetch_event(uuid)
            info = (event.get("info") or meta.get("info") or f"MISP event {uuid}").strip()

            attributes = event.get("Attribute") or []
            type_counts: dict[str, int] = {}
            for attr in attributes:
                t = attr.get("type")
                if t:
                    type_counts[t] = type_counts.get(t, 0) + 1
            top_types = sorted(type_counts.items(), key=lambda kv: kv[1], reverse=True)[:5]

            published = datetime.utcnow()
            raw_ts = event.get("publish_timestamp") or meta.get("timestamp")
            try:
                published = datetime.utcfromtimestamp(int(raw_ts))
            except (TypeError, ValueError, OSError):
                pass

            threat_level = str(event.get("threat_level_id", ""))
            default_severity = {"1": Severity.critical, "2": Severity.high}.get(
                threat_level, Severity.medium
            )

            summary_parts = [info]
            if top_types:
                stats = ", ".join(f"{t}: {n}" for t, n in top_types)
                summary_parts.append(f"Атрибути ({len(attributes)}): {stats}")
            orgc = (event.get("Orgc") or {}).get("name") or (meta.get("Orgc") or {}).get("name")
            if orgc:
                summary_parts.append(f"Джерело події: {orgc}")

            threats.append(
                Threat(
                    external_id=f"circl-{uuid}",
                    title=info[:200],
                    source=self.source_name,
                    type=ThreatType.advisory,
                    severity=infer_severity(
                        title=info,
                        summary=" ".join(summary_parts)[:400],
                        default=default_severity,
                    ),
                    published=published,
                    summary=" | ".join(summary_parts)[:800],
                    tags=["misp", "osint", "circl"],
                    url=None,  # події фіду не мають публічних URL
                )
            )

        logger.info("CIRCL OSINT: %d events", len(threats))
        return threats

    def _fetch_event(self, uuid: str) -> dict:
        """Завантажує тіло події; при помилці повертає {} — подія все одно
        збережеться з метаданими manifest."""
        try:
            resp = hard_timeout_get(
                FEED_URL + f"{uuid}.json", headers=UA, timeout=20, hard_timeout=35
            )
            resp.raise_for_status()
            payload = resp.json()
            return payload.get("Event") or {}
        except (requests.RequestException, ValueError):
            return {}
