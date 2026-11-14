"""
Колектор для CERT-UA (Урядова команда реагування на кіберінциденти).

Живе джерело: https://cert.gov.ua/api/articles/rss (~9 свіжих записів —
сайт публікує лише RSS, інших публічних API немає).

Історичний бекфіл: web.archive.org зберігає щомісячні снапшоти того ж RSS
з 2022 року (CDX API). Об'єднання снапшотів дає сотні унікальних записів,
яких живий RSS уже не містить. Див. scripts/backfill_cert_ua.py.
"""
import hashlib
import logging
import re
import time
from datetime import datetime
from email.utils import parsedate_to_datetime

import feedparser
import requests

from app.collectors.base import BaseCollector
from app.models.threat import Region, Severity, Threat, ThreatType

logger = logging.getLogger(__name__)

CERT_UA_RSS_URL = "https://cert.gov.ua/api/articles/rss"
_CDX_URL = "https://web.archive.org/cdx/search/cdx"
_ARCHIVE_WAYBACK = "https://web.archive.org/web/{ts}/{url}"
_UA = {"User-Agent": "Mozilla/5.0 (compatible; ua-cyber-dashboard/1.0)"}

# Проста евристика: якщо в заголовку/тексті трапляються такі слова —
# вважаємо severity вищим. Це замінюється на AI-класифікацію на Етапі 5.
CRITICAL_MARKERS = re.compile(r"критич|ransomware|шифрувальник|0-?day|zero-?day", re.I)
HIGH_MARKERS = re.compile(r"apt|шкідлив|malware|фішинг|phishing", re.I)


class CertUACollector(BaseCollector):
    source_name = "CERT-UA"

    def _guess_severity(self, text: str) -> Severity:
        if CRITICAL_MARKERS.search(text):
            return Severity.critical
        if HIGH_MARKERS.search(text):
            return Severity.high
        return Severity.medium

    def _entry_to_threat(self, entry) -> Threat:
        link = entry.get("link", "")
        external_id = link or hashlib.sha1(
            entry.get("title", "").encode()
        ).hexdigest()

        summary = entry.get("summary", "") or entry.get("description", "")
        full_text = f"{entry.get('title', '')} {summary}"

        published = entry.get("published") or entry.get("updated")
        try:
            published_dt = parsedate_to_datetime(published) if published else datetime.utcnow()
        except (TypeError, ValueError):
            published_dt = datetime.utcnow()

        # CERT-UA часто вказує ID виду CERT-UA#9688 у тексті — витягуємо як tag
        cert_id_match = re.search(r"CERT-UA#\d+", full_text)

        return Threat(
            external_id=external_id,
            title=entry.get("title", "Без заголовка"),
            source=self.source_name,
            type=ThreatType.advisory,
            severity=self._guess_severity(full_text),
            country=["Ukraine"],
            region=Region.ua,
            published=published_dt,
            summary=re.sub("<[^<]+?>", "", summary)[:1000],
            tags=[cert_id_match.group(0)] if cert_id_match else [],
            url=link or None,
        )

    def fetch(self) -> list[Threat]:
        try:
            feed = feedparser.parse(CERT_UA_RSS_URL)
        except Exception as e:
            logger.error("CERT-UA fetch failed: %s", e)
            return []

        if feed.bozo and not feed.entries:
            logger.error("CERT-UA feed parse error: %s", feed.bozo_exception)
            return []

        return [self._entry_to_threat(e) for e in feed.entries]

    def fetch_archive(self, max_snapshots: int = 100) -> list[Threat]:
        """Історичний бекфіл із архівних снапшотів RSS (web.archive.org).

        CDX повертає список збережених копій фіда; кожна копія містить
        ~9-20 записів на момент знімка. Дублікати між снапшотами та з БД
        відсіює bulk_upsert за external_id.
        """
        try:
            resp = requests.get(
                _CDX_URL,
                params={
                    "url": "cert.gov.ua/api/articles/rss",
                    "output": "json",
                    "fl": "timestamp,statuscode",
                    "collapse": "timestamp:6",
                    "filter": "statuscode:200",
                    "limit": str(max_snapshots + 10),
                },
                timeout=60,
                headers=_UA,
            )
            resp.raise_for_status()
            rows = resp.json()
        except Exception as e:
            logger.error("CERT-UA archive CDX failed: %s", e)
            return []

        snapshots = [r[0] for r in rows[1:] if r[1] == "200"][:max_snapshots]
        logger.info("CERT-UA archive: %d snapshots found", len(snapshots))

        seen: set[str] = set()
        threats: list[Threat] = []
        for ts in snapshots:
            snap = None
            for attempt in range(3):
                try:
                    snap = requests.get(
                        _ARCHIVE_WAYBACK.format(ts=ts, url=CERT_UA_RSS_URL),
                        timeout=60,
                        headers=_UA,
                    )
                    if snap.status_code == 200:
                        break
                except requests.RequestException as e:
                    # archive.org троттлить часті запити — пауза і ретрай
                    logger.warning(
                        "CERT-UA snapshot %s attempt %d failed: %s", ts, attempt + 1, e
                    )
                    time.sleep(3 * (attempt + 1))
                    snap = None
            if snap is None or snap.status_code != 200:
                continue
            feed = feedparser.parse(snap.content)

            for entry in feed.entries:
                link = entry.get("link", "")
                ext_id = link or entry.get("title", "")
                # Прибираємо службовий префікс архіву з лінки, якщо є
                link = re.sub(r"^https?://web\.archive\.org/web/\d+/", "", link)
                if not ext_id or ext_id in seen:
                    continue
                seen.add(ext_id)
                threats.append(self._entry_to_threat(entry))

        logger.info("CERT-UA archive: %d unique records", len(threats))
        return threats
