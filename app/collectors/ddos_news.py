"""
Колектор новин про DDoS-атаки.

Розвиток DDoS-моніторингу: крім метрик Cloudflare Radar (таблиця ddos_snapshots)
додаємо новинний шар — пояснювальні матеріали, звіти та анонси атак від вендорів
DDoS-захисту. Це не числові зрізи, а Threat-записи типу News/Advisory, які
лягають у спільну таблицю threats, де severity обчислюється через infer_severity.

Джерела (перевірено 27.08.2026, HTTP 200, валідний feedparser, реальний RSS):
  - Cloudflare Blog — категорія DDoS:
      https://blog.cloudflare.com/tag/ddos/rss/
      (звіти DDoS Threat Report по кварталах/півріччях, Tbps-атаки, DNS-флуди,
       геополітичні кампанії — найбагатше безкоштовне новинне джерело DDoS)
  - Cloudflare Blog — категорія Attacks:
      https://blog.cloudflare.com/tag/attacks/rss/
      (рекордні атаки, HTTP/2 (ре)сет, вразливості типу Rapid Reset)
  - Cloudflare Blog — категорія Botnet:
      https://blog.cloudflare.com/tag/botnet/rss/
      (ботнет-інфраструктура, що реально генерує DDoS-трафік: Mirai/Mantis тощо)

Ці самі фіди використовують той самий механізм, що й cert_rss.py, тому
перевикористано CertRSSConfig/CertRSSCollector без дублювання коду.
Через infer_severity у фідах з тегами DDoS заголовки на кшталт «record-breaking» /
«1 Tbps» / «threat report» отримують підвищену серйозність автоматично.
"""
import logging

from app.collectors.cert_rss import CertRSSCollector, CertRSSConfig
from app.models.threat import Severity, ThreatType

logger = logging.getLogger(__name__)

# Конфіги DDoS-новин. source_name — тег картки у sources_status.json (ddos_sources).
DDOS_NEWS_CONFIGS = [
    CertRSSConfig(
        source_name="Cloudflare DDoS",
        rss_url="https://blog.cloudflare.com/tag/ddos/rss/",
        country=["United States"],
        type=ThreatType.news,
        severity=Severity.medium,
        limit=20,
    ),
    CertRSSConfig(
        source_name="Cloudflare Attacks",
        rss_url="https://blog.cloudflare.com/tag/attacks/rss/",
        country=["United States"],
        type=ThreatType.news,
        severity=Severity.medium,
        limit=20,
    ),
    CertRSSConfig(
        source_name="Cloudflare Botnet",
        rss_url="https://blog.cloudflare.com/tag/botnet/rss/",
        country=["United States"],
        type=ThreatType.news,
        severity=Severity.medium,
        limit=15,
    ),
]


def get_ddos_news_collectors() -> list[CertRSSCollector]:
    """Повертає екземпляри DDoS-новинних колекторів для pipeline."""
    return [CertRSSCollector(cfg) for cfg in DDOS_NEWS_CONFIGS]
