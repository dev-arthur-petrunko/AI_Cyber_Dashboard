"""
Вендорські Threat Intel блоги та PSIRT-адвайзори — без фільтра за Україною
(на відміну від vendor_rss.py, який лишає тільки UA-релевантне).

Блоги: Microsoft MSTIC, Mandiant/Google TAG, Check Point Research,
Unit 42 (Palo Alto), CrowdStrike, SentinelLabs, Kaspersky Securelist,
Google TAG, SANS ISC, GreyNoise Labs.

PSIRT (конкретні CVE в конкретному ПЗ): Microsoft MSRC, Cisco PSIRT,
Fortinet PSIRT, Palo Alto PSIRT, Zero Day Initiative.

Реалізовано через той самий дженерик CertRSSCollector (feedparser), що й
державні CERT. Назви джерел для Mandiant/MSTIC/CheckPoint/Unit42 свідомо
збігаються з тими, що раніше писав vendor_rss, щоб upsert по парі
(source, external_id) оновлював ті самі записи, а не створював дублікати.
"""
from app.collectors.cert_rss import CertRSSCollector, CertRSSConfig
from app.models.threat import ThreatType

news = ThreatType.news
advisory = ThreatType.advisory

VENDOR_INTEL_CONFIGS = [
    # --- Аналітичні блоги ---
    CertRSSConfig(
        source_name="Microsoft MSTIC",
        rss_url="https://www.microsoft.com/en-us/security/blog/feed/",
        type=news,
        limit=30,
    ),
    CertRSSConfig(
        source_name="Mandiant/Google TAG",
        # cloud.google.com редіректить на HTML-сторінку блогу; робочий RSS —
        # саме на старому домені cloudblog.withgoogle.com (перевірено 21.08.2026)
        rss_url="https://cloudblog.withgoogle.com/topics/threat-intelligence/rss/",
        type=news,
        limit=30,
    ),
    CertRSSConfig(
        source_name="Check Point Research",
        rss_url="https://research.checkpoint.com/feed/",
        type=news,
        limit=30,
    ),
    CertRSSConfig(
        source_name="Unit 42 (Palo Alto)",
        rss_url="https://unit42.paloaltonetworks.com/feed/",
        type=news,
        limit=30,
    ),
    CertRSSConfig(
        source_name="CrowdStrike",
        rss_url="https://www.crowdstrike.com/blog/feed/",
        type=news,
        limit=30,
    ),
    CertRSSConfig(
        source_name="SentinelLabs",
        rss_url="https://www.sentinelone.com/labs/feed/",
        type=news,
        limit=30,
    ),
    CertRSSConfig(
        source_name="Kaspersky Securelist",
        rss_url="https://securelist.com/feed/",
        type=news,
        limit=30,
    ),
    CertRSSConfig(
        source_name="Google TAG",
        rss_url="https://security.googleblog.com/feeds/posts/default",
        type=news,
        limit=30,
    ),
    # SANS ISC — живі спостереження «що сканують прямо зараз»
    CertRSSConfig(
        source_name="SANS ISC",
        rss_url="https://isc.sans.edu/rssfeed_full.xml",
        type=news,
        limit=40,
    ),
    # GreyNoise — хто реально експлуатує CVE в моменті
    CertRSSConfig(
        source_name="GreyNoise Labs",
        rss_url="https://www.greynoise.io/blog/rss.xml",
        type=news,
        limit=30,
    ),
    # --- Вендорські PSIRT (patch-адвайзори) ---
    CertRSSConfig(
        source_name="Microsoft MSRC",
        rss_url="https://api.msrc.microsoft.com/update-guide/rss",
        type=advisory,
        limit=30,
    ),
    CertRSSConfig(
        source_name="Cisco PSIRT",
        rss_url=(
            "https://sec.cloudapps.cisco.com/security/center/"
            "psirtrss20/CiscoSecurityAdvisory.xml"
        ),
        type=advisory,
        limit=40,
    ),
    CertRSSConfig(
        source_name="Fortinet PSIRT",
        rss_url="https://www.fortiguard.com/rss/ir.xml",
        type=advisory,
        limit=40,
    ),
    CertRSSConfig(
        source_name="Palo Alto PSIRT",
        rss_url="https://security.paloaltonetworks.com/rss.xml",
        type=advisory,
        limit=50,
    ),
    CertRSSConfig(
        source_name="Zero Day Initiative",
        rss_url="https://www.zerodayinitiative.com/rss/published/",
        type=advisory,
        limit=40,
    ),
]
