"""
Колектор державних CERT по RSS. Один клас — багато конфігів,
за аналогією з GenericHTMLCollector (див. registry.py).

Перевірені робочі фіди (перевірено 16.08.2026):
  - CCCS Canada alerts:  https://www.cyber.gc.ca/api/cccs/atom/v1/get?feed=alerts_advisories&lang=en
  - CCCS Canada news:    https://www.cyber.gc.ca/api/cccs/atom/v1/get?feed=news_events_guidance&lang=en
  - CERT-EU Threat Intel: https://cert.europa.eu/publications/threat-intelligence-rss
  - CERT-EU Advisories:  https://cert.europa.eu/publications/security-advisories-rss
  - CERT Polska (NASK):  https://cert.pl/en/rss.xml
  - JPCERT/CC (JP):      https://www.jpcert.or.jp/english/rss/jpcert-en.rdf
  - NCSC-NL (NL):        https://advisories.ncsc.nl/rss/advisories
  - NCSC-FI (FI):        https://www.kyberturvallisuuskeskus.fi/feed/rss/en
  - CERT.br (BR):        https://www.cert.br/rss/certbr-rss.xml
  - CERT.hr (HR):        https://www.cert.hr/feed/
  - NUKIB (CZ):          https://nukib.gov.cz/rss.xml
  - DKCERT (DK):         https://www.cert.dk/news/rss
  - CERT-EE (EE):        https://www.ria.ee/et/news-feed/all/feed
  - EG-CERT (EG):        https://www.egcert.eg/feed/ (валідний RSS, записів поки мало)
  - AusCERT (AU):        https://portal.auscert.org.au/rss/bulletins/
  - BSI/CERT-Bund (DE):  https://wid.cert-bund.de/content/public/securityAdvisory/rss
                        (250 записів у фіді; у тексті НЕМАЄ CVE-ID — лише посилання на
                        WID-SEC-сторінку, з якої CVE можна витягнути окремим кроком збагачення)
  - ACSC (AU):           https://www.cyber.gov.au/rss/alerts | /rss/advisories | /rss/news
                        (за незалежними даними Akamai стабільно блокує датацентрові IP —
                        з цієї мережі фіди повертають 0 записів; рішення те саме, що
                        для SSSCIP/СБУ — резидентний проксі. Конфіги лишені, щоб
                        колектор спробував, якщо мережа/IP зміняться)
  - Cisco Talos (US):    https://blog.talosintelligence.com/rss/
                        (та сама стрічка, що у vendor_rss, але БЕЗ фільтра по Україні —
                        колектор збирає всі технічні звіти Talos, щоб картка була активною)
  - CERT-FR (FR):        https://cert.ssi.gouv.fr/avis/feed/ | /alerte/feed/
  - CERT-SE (SE):        https://cert.se/feed/ (Atom; rss.xml не існує — 404)
  - CISA Advisories (US): https://www.cisa.gov/cybersecurity-advisories/all.xml
                        (повна стрічка advisories, ОКРЕМА від CISA KEV JSON,
                        який тягне cisa_kev.py)

Низькопріоритетні/недоступні з поточної мережі (не включені в конфіги):
  - CERT-IL (IL): gov.il віддає 403 ботам — потребує інший User-Agent/проксі
  - INCIBE-CERT (ES): таймаут з цієї мережі, але фід живий (за даними користувача)
  - CSIRT Italia: антибот-захист
  - cert.ir (IR): блокує автоматичний доступ (robots.txt)

Повний список живих фідів: https://github.com/pulsedive/certrss
"""
import hashlib
import logging
from dataclasses import dataclass, field
from datetime import datetime
from email.utils import parsedate_to_datetime

import feedparser
import requests

from app.collectors.base import BaseCollector
from app.models.threat import Severity, Threat, ThreatType
from app.scoring import infer_severity

logger = logging.getLogger(__name__)


@dataclass
class CertRSSConfig:
    source_name: str
    rss_url: str
    severity: Severity = Severity.medium
    type: ThreatType = ThreatType.advisory
    country: list[str] = field(default_factory=list)
    limit: int = 50
    verify_ssl: bool = True
    timeout: int = 30
    user_agent: str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ua-cyber-dashboard/1.0"


class CertRSSCollector(BaseCollector):
    """Дженерик-колектор для державних CERT по RSS (feedparser)."""

    def __init__(self, config: CertRSSConfig):
        self.config = config
        self.source_name = config.source_name

    def fetch(self) -> list[Threat]:
        # feedparser тягне фід через urllib, який на Windows не знає системних
        # сертифікатів (SSL CERTIFICATE_VERIFY_FAILED). Тому качаємо контент
        # через requests (certifi), а парсимо feedparser'ом.
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                resp = requests.get(
                    self.config.rss_url,
                    headers={"User-Agent": self.config.user_agent},
                    timeout=self.config.timeout,
                    verify=self.config.verify_ssl,
                )
                resp.raise_for_status()
                break
            except (requests.RequestException, ValueError) as e:
                last_error = e
                logger.warning(
                    "%s fetch attempt %d failed: %s",
                    self.config.source_name,
                    attempt + 1,
                    e,
                )
                continue
        else:
            logger.error(
                "%s fetch failed (all attempts): %s",
                self.config.source_name,
                last_error,
            )
            return []

        feed = feedparser.parse(resp.content)

        if feed.bozo and not feed.entries:
            logger.error("%s feed parse error: %s", self.source_name, feed.bozo_exception)
            return []

        threats = []
        for entry in feed.entries[: self.config.limit]:
            link = entry.get("link", "")
            external_id = link or hashlib.sha1(entry.get("title", "").encode()).hexdigest()

            published = entry.get("published") or entry.get("updated")
            try:
                published_dt = (
                    parsedate_to_datetime(published) if published else datetime.utcnow()
                )
            except (TypeError, ValueError):
                published_dt = datetime.utcnow()

            severity = self.config.severity
            if self.config.type == ThreatType.news or self.config.type == ThreatType.advisory:
                severity = infer_severity(
                    title=entry.get("title", ""),
                    summary=entry.get("summary", ""),
                    tags=[t["term"] for t in entry.get("tags", [])][:5],
                    default=self.config.severity,
                )

            threats.append(
                Threat(
                    external_id=external_id,
                    title=entry.get("title", "Untitled"),
                    source=self.source_name,
                    type=self.config.type,
                    severity=severity,
                    country=self.config.country,
                    published=published_dt,
                    summary=entry.get("summary", "")[:800],
                    url=link or None,
                    tags=[t["term"] for t in entry.get("tags", [])][:5],
                )
            )
        return threats


# Конфіги для державних CERT (усі фіди без ключів)
CERT_RSS_CONFIGS = [
    CertRSSConfig(
        source_name="CCCS Canada",
        rss_url="https://www.cyber.gc.ca/api/cccs/atom/v1/get?feed=alerts_advisories&lang=en",
        country=["Canada"],
    ),
    CertRSSConfig(
        source_name="CCCS Canada News",
        rss_url="https://www.cyber.gc.ca/api/cccs/atom/v1/get?feed=news_events_guidance&lang=en",
        country=["Canada"],
        type=ThreatType.news,
    ),
    CertRSSConfig(
        source_name="CERT-EU Threat Intel",
        rss_url="https://cert.europa.eu/publications/threat-intelligence-rss",
    ),
    CertRSSConfig(
        source_name="CERT-EU Advisories",
        rss_url="https://cert.europa.eu/publications/security-advisories-rss",
    ),
    CertRSSConfig(
        source_name="BSI / CERT-Bund",
        rss_url="https://wid.cert-bund.de/content/public/securityAdvisory/rss",
        country=["Germany"],
    ),
    CertRSSConfig(
        source_name="CERT Polska",
        rss_url="https://cert.pl/en/rss.xml",
        country=["Poland"],
    ),
    CertRSSConfig(
        source_name="JPCERT/CC",
        rss_url="https://www.jpcert.or.jp/english/rss/jpcert-en.rdf",
        country=["Japan"],
    ),
    CertRSSConfig(
        source_name="NCSC-NL Advisories",
        rss_url="https://advisories.ncsc.nl/rss/advisories",
        country=["Netherlands"],
    ),
    CertRSSConfig(
        source_name="NCSC-FI",
        rss_url="https://www.kyberturvallisuuskeskus.fi/feed/rss/en",
        country=["Finland"],
    ),
    CertRSSConfig(
        source_name="CERT.br",
        rss_url="https://www.cert.br/rss/certbr-rss.xml",
        country=["Brazil"],
    ),
    CertRSSConfig(
        source_name="CERT.hr",
        rss_url="https://www.cert.hr/feed/",
        country=["Croatia"],
    ),
    CertRSSConfig(
        source_name="NUKIB",
        rss_url="https://nukib.gov.cz/rss.xml",
        country=["Czechia"],
    ),
    CertRSSConfig(
        source_name="DKCERT",
        rss_url="https://www.cert.dk/news/rss",
        country=["Denmark"],
    ),
    CertRSSConfig(
        source_name="CERT-EE",
        rss_url="https://www.ria.ee/et/news-feed/all/feed",
        country=["Estonia"],
    ),
    CertRSSConfig(
        source_name="EG-CERT",
        rss_url="https://www.egcert.eg/feed/",
        country=["Egypt"],
        verify_ssl=False,  # битий chain у egcert.eg; контент публічний, але 0 записів
    ),
    CertRSSConfig(
        source_name="AusCERT",
        rss_url="https://portal.auscert.org.au/rss/bulletins/",
        country=["Australia"],
        limit=30,
    ),
    CertRSSConfig(
        source_name="ACSC Alerts",
        rss_url="https://www.cyber.gov.au/rss/alerts",
        country=["Australia"],
        # 15s: cyber.gov.au часто не відповідає (2×60s крали ~2 хв на фід,
        # тобто ~4 хв кожного проходу пайплайну лише на ці два джерела).
        timeout=15,
        user_agent="MyThreatIntel/1.0 (+https://ua-cyber-dashboard.example; contact: CERT-UA partner program)",
    ),
    CertRSSConfig(
        source_name="ACSC Advisories",
        rss_url="https://www.cyber.gov.au/rss/advisories",
        country=["Australia"],
        timeout=15,
        user_agent="MyThreatIntel/1.0 (+https://ua-cyber-dashboard.example; contact: CERT-UA partner program)",
    ),
    CertRSSConfig(
        source_name="Cisco Talos Intelligence",
        rss_url="https://blog.talosintelligence.com/rss/",
        country=["United States"],
        type=ThreatType.news,
        limit=50,
    ),
    CertRSSConfig(
        source_name="CERT-FR Avis",
        rss_url="https://cert.ssi.gouv.fr/avis/feed/",
        country=["France"],
    ),
    CertRSSConfig(
        source_name="CERT-FR Alertes",
        rss_url="https://cert.ssi.gouv.fr/alerte/feed/",
        country=["France"],
        severity=Severity.high,  # alertes — термінові попередження ANSSI
    ),
    CertRSSConfig(
        source_name="CERT-SE",
        rss_url="https://cert.se/feed/",
        country=["Sweden"],
    ),
    CertRSSConfig(
        source_name="CISA Advisories",
        rss_url="https://www.cisa.gov/cybersecurity-advisories/all.xml",
        country=["United States"],
        limit=50,
    ),
]
