"""
Точка входу для збору даних. Запускається за розкладом
(GitHub Actions cron, див. .github/workflows/collect.yml) або вручну:

    python -m app.pipeline
"""
import logging

from dotenv import load_dotenv

load_dotenv()
from app.collectors.alienvault_otx import AlienVaultOTXCollector
from app.collectors.blocklists import (
    ETCompromisedCollector,
    FeodoTrackerCollector,
    SpamhausDropCollector,
    SSLBLCollector,
)
from app.collectors.cert_rss import CERT_RSS_CONFIGS, CertRSSCollector
from app.collectors.cert_ua import CertUACollector
from app.collectors.cloudflare_radar import collect as collect_ddos
from app.collectors.ddos_news import get_ddos_news_collectors
from app.collectors.curated import CuratedCollector
from app.collectors.cisa_kev import CISAKEVCollector
from app.collectors.circl_misp import CirclMispCollector
from app.collectors.datasets import collect_datasets
from app.collectors.exploitdb import ExploitDBCollector
from app.collectors.generic_scraper import GenericHTMLCollector
from app.collectors.github_poc import GitHubOrgsCollector, GitHubPoCCollector
from app.collectors.github_advisories import GitHubAdvisoriesCollector
from app.collectors.malwarebazaar import MalwareBazaarCollector
from app.collectors.ncsc_uk import NCSCCollector
from app.collectors.news import NewsCollector
from app.collectors.nvd import NVDCollector
from app.collectors.registry import ALL_SCRAPER_CONFIGS
from app.collectors.rnbo_ua import RNBOCollector
from app.collectors.singcert_sg import SingCERTCollector
from app.collectors.ssscip_ua import SSSCIPCollector
from app.collectors.ssu_ua import SSUCollector
from app.collectors.telegram_channel import TelegramChannelCollector
from app.collectors.threatfox import ThreatFoxCollector
from app.collectors.urlhaus import URLhausCollector
from app.collectors.vendor_intel import VENDOR_INTEL_CONFIGS
from app.collectors.vendor_rss import VendorRSSCollector
from app.collectors.phishtank import PhishTankCollector
from app.collectors.openphish import OpenPhishCollector
from app.collectors.phishstats import PhishStatsCollector
from app.collectors.mitre_attack import MITREAttackCollector
from app.collectors.misp_galaxy import MISPGalaxyCollector
from app.collectors.hibp import HIBPCollector
from app.collectors.virustotal import VirusTotalCollector
from app.collectors.shodan_collector import ShodanCollector
from app.collectors.ofac_sdn import OFACSDNCollector
from app.db import SessionLocal, init_db, now_utc, get_last_fetched, update_last_fetched
from app.enrichment import enrich_epss
from app.notifications import notify_n8n
from app.storage import bulk_upsert
from app.storage.phishing_storage import bulk_upsert_phishing

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("pipeline")

COLLECTORS = [
    # Кураторські записи (ручні посилання)
    CuratedCollector(),
    # Україна
    CertUACollector(),
    *(GenericHTMLCollector(cfg) for cfg in ALL_SCRAPER_CONFIGS),
    RNBOCollector(),
    SSUCollector(),
    SSSCIPCollector(),
    VendorRSSCollector(),
    MalwareBazaarCollector(),
    AlienVaultOTXCollector(),
    # Світ — вразливості та експлойти
    NVDCollector(lookback_hours=48),
    CISAKEVCollector(),
    GitHubPoCCollector(lookback_days=7),
    GitHubAdvisoriesCollector(lookback_days=7),
    # Дзеркало CSV Exploit-DB на gitlab відстає від live-бази на ~місяць,
    # тому вікно 60 днів, а не 7 — інакше колектор завжди повертає 0.
    ExploitDBCollector(lookback_days=60),
    # Світ — новини та IOC
    NewsCollector(),
    NCSCCollector(),
    # DDoS-новини (звіти атак від Cloudflare: DDoS/Attacks/Botnet теги)
    *(get_ddos_news_collectors()),
    # Міжнародні державні CERT (RSS без ключів): CCCS Canada, CERT-EU, CERT Polska
    *(CertRSSCollector(cfg) for cfg in CERT_RSS_CONFIGS),
    # Вендорські TI-блоги та PSIRT без фільтра за Україною
    *(CertRSSCollector(cfg) for cfg in VENDOR_INTEL_CONFIGS),
    ThreatFoxCollector(),
    URLhausCollector(),
    # Блок-лісти та IoC-фіди без ключів: Feodo, SSLBL, Spamhaus DROP,
    # ET compromised-ips + CIRCL MISP OSINT feed (CERT Люксембургу)
    FeodoTrackerCollector(),
    SSLBLCollector(),
    SpamhausDropCollector(),
    ETCompromisedCollector(),
    CirclMispCollector(),
    # ДержСЦЗ / ЦУЗ Сінгапур (HTML-скрапінг) та CERT-Bund GitHub
    SingCERTCollector(),
    GitHubOrgsCollector(),
    # Офіційні Telegram-канали (СБУ/SSSCIP) — без токена пропускається
    TelegramChannelCollector(),
    # APT-атрибуція
    MITREAttackCollector(),
    MISPGalaxyCollector(),
    # Санкції Мінфіну США (OFAC SDN)
    OFACSDNCollector(),
    # Витоки даних
    HIBPCollector(),
    # IoC з API
    VirusTotalCollector(),
    ShodanCollector(),
]


def run():
    init_db()
    db = SessionLocal()
    run_start = now_utc()
    summary = {}
    try:
        for collector in COLLECTORS:
            logger.info("Running collector: %s", collector.source_name)
            try:
                threats = collector.fetch()
            except Exception as e:
                logger.exception("Collector %s crashed: %s", collector.source_name, e)
                summary[collector.source_name] = {"error": str(e)}
                continue

            try:
                # upsert сам оновлює існуючі записи, тому фільтрація по даті
                # не потрібна — це гарантує, що оновлення старих записів
                # (наприклад, пересчёт CVSS у NVD, додавання у CISA KEV)
                # не будуть втрачені.
                result = bulk_upsert(db, threats, batch_size=500)
                # Оновлюємо стан збирання для інкрементного запуску наступного разу.
                update_last_fetched(db, collector.source_name, run_start)
            except Exception as e:
                # Після помилки транзакції SQLAlchemy Session непридатна до
                # rollback. Продовжуємо збір з інших джерел, щоб один запис
                # із помилкою не зупинив увесь pipeline.
                db.rollback()
                logger.exception("Storage for %s crashed: %s", collector.source_name, e)
                summary[collector.source_name] = {"error": f"storage: {e}"}
                continue
            summary[collector.source_name] = result
            logger.info("%s: %s", collector.source_name, result)

        logger.info("Enriching with EPSS scores...")
        try:
            epss_updated = enrich_epss(db)
            summary["epss_enrichment"] = {"updated": epss_updated}
        except Exception as e:
            logger.exception("EPSS enrichment crashed: %s", e)
            summary["epss_enrichment"] = {"error": str(e)}

        # DDoS-статистика Cloudflare Radar (окрема таблиця, без threats).
        # Толерантно: без токена або при недоступності API просто пропускаємо.
        logger.info("Collecting Cloudflare Radar DDoS stats...")
        try:
            ddos_saved = collect_ddos(db)
            summary["ddos_snapshots"] = {"saved": ddos_saved}
        except Exception as e:
            logger.exception("Cloudflare Radar collection crashed: %s", e)
            summary["ddos_snapshots"] = {"error": str(e)}

        # Фішинг (окрема таблиця phishing_urls)
        phishing_collectors = [
            PhishTankCollector(),
            OpenPhishCollector(),
            PhishStatsCollector(),
        ]
        for collector in phishing_collectors:
            logger.info("Running phishing collector: %s", collector.source_name)
            try:
                phishing_records = collector.fetch()
                result = bulk_upsert_phishing(db, phishing_records)
                summary[f"phishing_{collector.source_name}"] = result
                logger.info("%s: %s", collector.source_name, result)
            except Exception as e:
                logger.exception("Phishing collector %s crashed: %s", collector.source_name, e)
                summary[f"phishing_{collector.source_name}"] = {"error": str(e)}

        # Каталог ML-датасетів DDoS (окрема таблиця, без threats): метадані
        # + перевірка доступності сторінок. Теж толерантно.
        logger.info("Collecting dataset catalog (DDoS ML datasets)...")
        try:
            datasets_saved = collect_datasets(db)
            summary["datasets_catalog"] = {"saved": datasets_saved}
        except Exception as e:
            logger.exception("Dataset catalog collection crashed: %s", e)
            summary["datasets_catalog"] = {"error": str(e)}

        notify_n8n(db, run_start, summary)
    finally:
        db.close()

    logger.info("Pipeline finished: %s", summary)
    return summary


if __name__ == "__main__":
    run()
