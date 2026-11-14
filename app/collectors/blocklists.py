"""
Блок-лісти та IoC-фіди без API-ключів:
  - abuse.ch Feodo Tracker — активні C2-сервери Dridex/Emotet/TrickBot/QakBot/
    BazarLoader: https://feodotracker.abuse.ch/downloads/ipblocklist.csv
  - abuse.ch SSLBL (SSL Blacklist) — шкідливі SSL-сертифікати та JA3-відбитки
    ботнет-C2: https://sslbl.abuse.ch/blacklist/sslblacklist.csv
  - Spamhaus DROP — мережі, задіяні у спамі/ботнетах/DDoS:
    https://www.spamhaus.org/drop/drop.txt
    (EDROP з 2025 злитий у DROP — окремий edrop.txt більше не ведеться,
    файл містить лише повідомлення про злиття)
  - Emerging Threats (Proofpoint) compromised-ips — скомпрометовані хости:
    https://rules.emergingthreats.net/blockrules/compromised-ips.txt

Ліцензії: abuse.ch — CC0; Spamhaus — безкоштовно для некомерційного/
мережевого використання; ET blocklists — відкриті дані.
"""
import csv
import logging
from datetime import datetime
from io import StringIO

import requests

from app.collectors.base import BaseCollector
from app.geoip import country_for_value, iso2_to_name
from app.http_utils import hard_timeout_get
from app.models.threat import Severity, Threat, ThreatType

logger = logging.getLogger(__name__)

UA = {"User-Agent": "CyberSentinel/1.6 (+threat-intelligence dashboard)"}

FEODO_URL = "https://feodotracker.abuse.ch/downloads/ipblocklist.csv"
SSLBL_URL = "https://sslbl.abuse.ch/blacklist/sslblacklist.csv"
SPAMHAUS_DROP_URL = "https://www.spamhaus.org/drop/drop.txt"
ET_COMPROMISED_URL = "https://rules.emergingthreats.net/blockrules/compromised-ips.txt"

SSLB_LIMIT = 400


def _get_text(url: str) -> str | None:
    """Завантажує текст фіду з гарантією hard timeout. None — мережева помилка."""
    try:
        resp = hard_timeout_get(url, headers=UA, timeout=30, hard_timeout=45)
        resp.raise_for_status()
        return resp.text
    except requests.RequestException as e:
        logger.error("Blocklist fetch failed for %s: HTTP %s", url.split("/")[2], getattr(
            getattr(e, "response", None), "status_code", str(e)[:80]
        ))
        return None


def _csv_rows(text: str) -> list[dict]:
    """Рядки CSV як словники. Заголовок у abuse.ch-файлах прокоментований '#'
    і може містити BOM/лапки — чистимо перший незакоментований рядок."""
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.startswith("#")]
    if not lines:
        return []
    first = lines[0].lstrip("#\ufeff").strip()
    if not first.lower().startswith(("first_seen", '"first_seen')):
        return []
    lines[0] = first
    return list(csv.DictReader(lines))


def _parse_abusech_date(value: str | None) -> datetime | None:
    """abuse.ch-формат "2026-08-21 07:33:12 UTC" -> naive UTC; None якщо дати нема."""
    raw = (value or "").replace(" UTC", "").strip()
    try:
        return datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def _geo_for_ip(ip: str) -> list[str]:
    if not ip:
        return []
    iso = country_for_value(ip)
    return [iso2_to_name(iso)] if iso else []


class FeodoTrackerCollector(BaseCollector):
    """Активні C2-сервери банківських троянців (abuse.ch Feodo Tracker)."""

    source_name = "Feodo Tracker"

    def fetch(self) -> list[Threat]:
        text = _get_text(FEODO_URL)
        if not text:
            return []

        threats = []
        for row in _csv_rows(text):
            ip = (row.get("dst_ip") or "").strip()
            port = (row.get("dst_port") or "").strip()
            malware = (row.get("malware") or "unknown").strip()
            domain = (row.get("c2_domain") or "").strip()
            if not ip:
                continue

            endpoint = f"{ip}:{port}" if port else ip
            first_seen_dt = _parse_abusech_date(row.get("first_seen_utc"))
            threats.append(
                Threat(
                    external_id=f"feodo-{endpoint}",
                    title=f"C2 {malware}: {endpoint}" + (f" ({domain})" if domain else ""),
                    source=self.source_name,
                    type=ThreatType.ioc,
                    severity=Severity.high,
                    country=_geo_for_ip(ip),
                    published=first_seen_dt or datetime.utcnow(),
                    is_backfill=first_seen_dt is None,
                    summary=(
                        f"Активний C2-сервер {malware}. Порт {port or '?'}. "
                        f"Домен: {domain or '—'}. Джерело: abuse.ch Feodo Tracker."
                    ),
                    tags=["feodo-tracker", malware.lower(), "c2"],
                )
            )

        logger.info("Feodo Tracker: %d C2 endpoints", len(threats))
        return threats


class SSLBLCollector(BaseCollector):
    """Шкідливі SSL-сертифікати / ботнет-C2 (abuse.ch SSLBL).

    Формат файлу БЕЗ заголовка: first_seen_utc,sha1_fingerprint,reason
    (наприклад "2026-08-21 08:57:04,de75...,PureLogsStealer C&C").
    """

    source_name = "SSLBL"

    def fetch(self) -> list[Threat]:
        text = _get_text(SSLBL_URL)
        if not text:
            return []

        threats = []
        for line in text.splitlines()[: SSLB_LIMIT + 40]:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            # reason може містити кому? Ні, але ріжемо maxsplit=2 на всяк випадок
            parts = line.split(",", 2)
            if len(parts) < 3:
                continue
            first_seen, sha1, reason = (p.strip() for p in parts)
            if sha1.lower().startswith("first_seen") or len(sha1) != 40:
                continue

            first_seen_dt = _parse_abusech_date(first_seen)
            threats.append(
                Threat(
                    external_id=f"sslbl-{sha1.lower()}",
                    title=f"Malicious SSL certificate {sha1[:16]}… ({reason})",
                    source=self.source_name,
                    type=ThreatType.ioc,
                    severity=Severity.high,
                    published=first_seen_dt or datetime.utcnow(),
                    is_backfill=first_seen_dt is None,
                    summary=(
                        f"SHA1-відбиток SSL-сертифіката, пов'язаного з ботнет-C2 "
                        f"({reason}). Джерело: abuse.ch SSLBL."
                    ),
                    tags=["sslbl", "ssl", "ja3", "c2"],
                )
            )
            if len(threats) >= SSLB_LIMIT:
                break

        logger.info("SSLBL: %d certificates", len(threats))
        return threats


class SpamhausDropCollector(BaseCollector):
    """Spamhaus DROP — мережі, задіяні у спамі/ботнетах/DDoS.
    EDROP з 2025 включено до DROP, тому читаємо тільки drop.txt."""

    source_name = "Spamhaus DROP"

    def fetch(self) -> list[Threat]:
        text = _get_text(SPAMHAUS_DROP_URL)
        if not text:
            return []

        threats = []
        for line in text.splitlines():
            line = line.strip()
            if not line or line.startswith(";") or line.startswith("#"):
                continue
            parts = [p.strip() for p in line.split(";")]
            cidr = parts[0]
            sbl = parts[1] if len(parts) > 1 else ""
            if "/" not in cidr:
                continue

            threats.append(
                Threat(
                    external_id=f"spamhaus-drop-{cidr}",
                    title=f"Spamhaus DROP network {cidr}" + (f" ({sbl})" if sbl else ""),
                    source=self.source_name,
                    type=ThreatType.ioc,
                    severity=Severity.high,
                    # У drop.txt нема дати на запис: published = now() лише як
                    # display-fallback, тому позначаємо технічний імпорт.
                    published=datetime.utcnow(),
                    is_backfill=True,
                    summary=(
                        f"Мережа {cidr} у списку Spamhaus DROP (спам/ботнети/DDoS-інфраструктура). "
                        f"Рекомендовано блокувати вхідний/вихідний трафік. "
                        + (f"SBL-запис: {sbl}. " if sbl else "")
                        + "EDROP з 2025 злитий у цей список."
                    ),
                    tags=["spamhaus", "drop", "blocklist"],
                    url=f"https://www.spamhaus.org/sbl/query/{sbl}" if sbl else None,
                )
            )

        logger.info("Spamhaus DROP: %d networks", len(threats))
        return threats


class ETCompromisedCollector(BaseCollector):
    """Emerging Threats (Proofpoint) — список скомпрометованих IP."""

    source_name = "ET Compromised IPs"

    def fetch(self) -> list[Threat]:
        text = _get_text(ET_COMPROMISED_URL)
        if not text:
            return []

        threats = []
        seen: set[str] = set()
        for line in text.splitlines():
            ip = line.strip()
            if not ip or ip.startswith("#") or ip in seen:
                continue
            seen.add(ip)

            threats.append(
                Threat(
                    external_id=f"et-comp-{ip}",
                    title=f"Compromised IP: {ip}",
                    source=self.source_name,
                    type=ThreatType.ioc,
                    severity=Severity.medium,
                    country=_geo_for_ip(ip),
                    # У compromised-ips.txt нема дати на запис (тільки шапка
                    # "# generated") — технічний імпорт.
                    published=datetime.utcnow(),
                    is_backfill=True,
                    summary=(
                        f"IP {ip} у списку скомпрометованих хостів Emerging Threats "
                        f"(Proofpoint). Джерело: blockrules/compromised-ips."
                    ),
                    tags=["emerging-threats", "compromised", "blocklist"],
                )
            )

        logger.info("ET Compromised: %d IPs", len(threats))
        return threats
