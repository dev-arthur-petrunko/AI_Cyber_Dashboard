"""
Колектор IoC з VirusTotal API v3.

Джерело: https://www.virustotal.com/api/v3/
API key: https://www.virustotal.com/gui/my-apikey
Безкоштовний тариф: 4 запити/хв, 500 запитів/день
Ліцензія: VirusTotal ToS (обмежене комерційне використання)

ВАЖЛИВО (v1.5.2): попередня версія вела на неіснуючі «фіди»:
  GET /api/v3/url_comments → 404 (ендпоінта не існує)
  GET /api/v3/files?limit  → 405 (GET не підтримується)
Публічної «ленти последних файлов» у VT v3 НЕМАЄ — вона лише в
платному Intelligence. Тому колектор перероблений на офіційні
однооб'єктні ендпоінти:

  GET /api/v3/files/{sha256}  — аналіз конкретного хеша (200, перевірено)
  GET /api/v3/urls/{id}       — аналіз конкретного URL (base64 id)

Хеші/URL беремо з БД (MalwareBazaar mb-* та ThreatFox/URLhaus IOC) —
збагачуємо наявні дані реальними детекціями 70+ антивірусів.
Запитів небагато (ліміт 4/хв), 429 обробляється з пропуском.
"""
import base64
import logging
import os
import time
from datetime import datetime

import requests

from app.collectors.base import BaseCollector
from app.db import SessionLocal, ThreatORM
from app.models.threat import Region, Severity, Threat, ThreatType

logger = logging.getLogger(__name__)

VT_FILE = "https://www.virustotal.com/api/v3/files/{sha256}"
VT_URL = "https://www.virustotal.com/api/v3/urls/{url_id}"
SOURCE_NAME = "VirusTotal"
LICENSE = "VirusTotal ToS (free tier: 4 req/min)"

# Скільки IoC збагачуємо за один прохід (429 при перевищенні 4 req/min;
# між запитами — пауза нижче).
MAX_LOOKUPS = 10
REQUEST_PAUSE_SEC = 16  # 4 запити/хв → ~15s між запитами + запас

# Мапінг типів IOC, які зберігають інші колектори
FILE_SOURCES = ("MalwareBazaar",)  # external_id = mb-<sha256>
# URLhaus зберігає у ThreatORM.url САМ вредоносний URL — можна шукати в VT.
# ThreatFox НЕ потрапляє сюди навмисно: там у url лежить його сторінка-
# обгортка https://threatfox.abuse.ch/ioc/{id}/, а не сам IOC — пошук такої
# обгортки марнує ліміт 4 запити/хв і дає нісенітницю.
# PhishTank/OpenPhish лежать в окремій таблиці phishing — їх тут немає.
URL_SOURCES = ("URLhaus",)


def _determine_severity(detections: int, engines: int) -> Severity:
    """Визначає критичність за кількістю детекцій."""
    if engines <= 0:
        return Severity.unknown
    ratio = detections / engines
    if ratio >= 0.5:
        return Severity.critical
    if ratio >= 0.3:
        return Severity.high
    if ratio >= 0.1:
        return Severity.medium
    return Severity.low


def _vt_get(url: str, headers: dict, timeout: int = 20):
    """GET до VT з обробкою 429. Повертає dict-атрибути або None."""
    try:
        resp = requests.get(url, headers=headers, timeout=timeout)
    except requests.RequestException as e:
        logger.warning("VirusTotal request failed %s: %s", url, e)
        return None
    if resp.status_code == 429:
        logger.warning("VirusTotal: rate limit (429), пропускаємо")
        return None
    if resp.status_code == 404:
        return None  # об'єкта немає в базі VT — не помилка
    if resp.status_code != 200:
        logger.warning("VirusTotal HTTP %s: %s", resp.status_code, url)
        return None
    try:
        return resp.json().get("data", {}).get("attributes", {})
    except (ValueError, AttributeError) as e:
        logger.warning("VirusTotal bad payload %s: %s", url, e)
        return None


def _stats(attrs: dict) -> tuple[int, int]:
    stats = attrs.get("last_analysis_stats") or {}
    det = stats.get("malicious", 0) + stats.get("suspicious", 0)
    total = sum(stats.values()) if stats else 0
    return det, total


def _to_threat(attrs: dict, *, title_prefix: str, tags_prefix: str,
               url: str, ext_suffix: str) -> Threat | None:
    det, total = _stats(attrs)
    if det == 0:
        return None
    return Threat(
        external_id=f"vt-{ext_suffix}",
        title=f"{title_prefix}: {(attrs.get('url') or attrs.get('meaningful_name') or ext_suffix)[:80]}",
        source=SOURCE_NAME,
        type=ThreatType.ioc,
        severity=_determine_severity(det, total),
        region=Region.world,
        country=[],
        published=datetime.utcnow(),
        summary=f"Detections: {det}/{total} engines. "
                f"Type: {attrs.get('type_description', 'unknown')}",
        tags=["virustotal", tags_prefix] + list(attrs.get("tags") or [])[:3],
        url=url,
    )


class VirusTotalCollector(BaseCollector):
    source_name = SOURCE_NAME

    def fetch(self) -> list[Threat]:
        api_key = os.getenv("VIRUSTOTAL_API_KEY", "")
        if not api_key or api_key.startswith("встав"):
            logger.info("VIRUSTOTAL_API_KEY не задано — колектор пропущено")
            return []

        headers = {"x-apikey": api_key, "Accept": "application/json"}
        threats: list[Threat] = []
        db = SessionLocal()
        try:
            # 1. SHA256 MalwareBazaar → /files/{sha256}
            rows = (
                db.query(ThreatORM.external_id, ThreatORM.title)
                .filter(ThreatORM.source.in_(FILE_SOURCES))
                .order_by(ThreatORM.fetched_at.desc())
                .limit(MAX_LOOKUPS)
                .all()
            )
            for ext_id, title in rows:
                sha = ext_id.replace("mb-", "").strip()
                if len(sha) != 64:
                    continue
                attrs = _vt_get(VT_FILE.format(sha256=sha), headers)
                if attrs:
                    t = _to_threat(
                        attrs,
                        title_prefix="Malware sample",
                        tags_prefix="file",
                        url=f"https://www.virustotal.com/gui/file/{sha}",
                        ext_suffix=f"file-{sha}",
                    )
                    if t:
                        threats.append(t)
                time.sleep(REQUEST_PAUSE_SEC)

            # 2. URL з ThreatFox/URLhaus → /urls/{base64(id)}
            rows = (
                db.query(ThreatORM.external_id, ThreatORM.url, ThreatORM.source)
                .filter(
                    ThreatORM.source.in_(URL_SOURCES),
                    ThreatORM.url.isnot(None),
                    ThreatORM.url != "",
                )
                .order_by(ThreatORM.fetched_at.desc())
                .limit(MAX_LOOKUPS)
                .all()
            )
            for ext_id, url, src in rows:
                if not url or not url.startswith(("http://", "https://")):
                    continue
                vid = base64.urlsafe_b64encode(url.encode()).decode().rstrip("=")
                attrs = _vt_get(VT_URL.format(url_id=vid), headers)
                if attrs:
                    t = _to_threat(
                        attrs,
                        title_prefix="Suspicious URL",
                        tags_prefix="url",
                        url=url,
                        ext_suffix=f"url-{vid[:64]}",
                    )
                    if t:
                        threats.append(t)
                time.sleep(REQUEST_PAUSE_SEC)
        finally:
            db.close()

        logger.info("VirusTotal: %d IoC збагачено (%d запитів до VT API)",
                    len(threats), MAX_LOOKUPS * 2)
        return threats
