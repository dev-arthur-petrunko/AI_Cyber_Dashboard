"""
Каталог ML-датасетів DDoS-аналітики (для навчання/оцінки детекторів).

Каталог НЕ завантажує багатогігабайтні архіви (PCAP/CSV) у БД — це
еталонний список датасетів з метаданими: ліцензія, тип, актуальність,
посилання, лічильник записів. Кожен запуск pipeline:
  1) перевіряє доступність сторінок (best-effort, паралельно),
  2) додає новий знімок у dataset_snapshots (last_checked + payload).

Ліцензії перевірено 16.08.2026:
- CAIDA "DDoS Attack 2007" — публічне завантаження без запиту з серпня 2025;
- CIC-DDoS2019 / CICEV2023 (UNB) — вільне розповсюдження з цитуванням;
- BCCC-cPacket-Cloud-DDoS-2024 — відкритий академічний (MDPI);
- AISED (Zenodo) — Creative Commons Attribution;
- MAWILab — академічне використання з обов'язковим посиланням;
  збір міток припинено у грудні 2024 (архів 2006–2024), тож "оновлюється
  щодня" у публікаціях вже неактуально — вказано чесно.
"""
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

from app.db import SessionLocal, now_utc
from app.models.dataset_snapshot import DatasetSnapshotORM

logger = logging.getLogger(__name__)

TIMEOUT = 8

# Еталонний каталог датасетів. name співпадає з картками у data/sources_status.json
# (секція ml_datasets), щоб /sources коректно рахував лічильники.
DATASETS = [
    {
        "dataset_name": "CAIDA DDoS Attack 2007",
        "category": "ddos_ml",
        "license": "Публічне завантаження (з серпня 2025 — без попереднього запиту)",
        "source_url": "https://www.caida.org/catalog/datasets/ddos-20070804_dataset/",
        "docs_url": "https://www.caida.org/catalog/datasets/ddos-20070804_dataset/",
        "freshness": "Історичний (2007), еталонний",
        "record_count": None,
        "payload": {
            "type": "PCAP: ~1 год анонімізованого трафіку реальної DDoS-атаки",
            "usage": "Еталон для оцінки детекторів, аналіз реальних атак",
        },
    },
    {
        "dataset_name": "CIC-DDoS2019 / CICEV2023 (UNB)",
        "category": "ddos_ml",
        "license": "Вільне розповсюдження з цитуванням",
        "source_url": "https://www.unb.ca/cic/datasets/ddos-2019.html",
        "docs_url": "https://www.unb.ca/cic/datasets/electric-vehicle-ddos-2023.html",
        "freshness": "2019 (UNB продовжує випускати нові датасети IoT/IIoT)",
        "record_count": None,
        "payload": {
            "type": "Розмічені PCAP + CSV (80+ флоу-фіч, CICFlowMeter-V3); CICEV2023 — DDoS на EV-зарядки",
            "usage": "Класифікація DDoS за сімействами, навчання детекторів",
        },
    },
    {
        "dataset_name": "BCCC-cPacket-Cloud-DDoS-2024",
        "category": "ddos_ml",
        "license": "Відкритий академічний (MDPI)",
        "source_url": "https://www.yorku.ca/research/bccc/ucs-technical/cybersecurity-datasets-cds/",
        "docs_url": "https://www.mdpi.com/2078-2489/15/4/195",
        "freshness": "2024, актуальний",
        "record_count": None,
        "payload": {
            "type": "Розмічені флоу (26 міток, 300+ фіч, NTLFlowLyzer), хмарна інфраструктура",
            "usage": "8+ сценаріїв легальної активності, 17 сценаріїв атак",
        },
    },
    {
        "dataset_name": "AISED (Zenodo)",
        "category": "ddos_ml",
        "license": "Creative Commons Attribution",
        "source_url": "https://zenodo.org/records/14681803",
        "docs_url": "https://doi.org/10.5281/zenodo.14681803",
        "freshness": "2025",
        "record_count": 52318,
        "payload": {
            "type": "CSV, очищений для ML (52 318 записів, 79 фіч, збалансовані класи)",
            "usage": "Готовий до навчання без попередньої обробки",
        },
    },
    {
        "dataset_name": "MAWILab",
        "category": "ddos_ml",
        "license": "Академічне використання, обов'язкове посилання",
        "source_url": "http://www.fukuda-lab.org/mawilab/",
        "docs_url": "https://mawi.wide.ad.jp/",
        "freshness": "Архів 2006–2024 (збір міток припинено у грудні 2024)",
        "record_count": None,
        "payload": {
            "type": "Мітки аномалій (включно з DDoS) у трафіку MAWI (admd/CSV)",
            "usage": "Еталонні мітки для оцінки методів виявлення аномалій",
        },
    },
]


def _check_url(url: str) -> dict:
    """Best-effort перевірка доступності сторінки датасета. Ніколи не кидає винятки."""
    try:
        resp = requests.get(
            url,
            timeout=TIMEOUT,
            allow_redirects=True,
            headers={"User-Agent": "MyThreatIntel/1.0 (dataset catalog availability check)"},
        )
        return {"available": resp.status_code < 500, "http_status": resp.status_code}
    except Exception as e:  # noqa: BLE001 — каталог не повинен падати
        return {"available": False, "error": str(e)[:200]}


def build_snapshots() -> list[DatasetSnapshotORM]:
    """Створює знімки каталогу з перевіркою доступності сторінок (паралельно)."""
    with ThreadPoolExecutor(max_workers=len(DATASETS)) as pool:
        futures = {pool.submit(_check_url, d["source_url"]): d for d in DATASETS}
        checks: dict[str, dict] = {}
        for future in as_completed(futures):
            ds = futures[future]
            try:
                checks[ds["dataset_name"]] = future.result()
            except Exception as e:  # noqa: BLE001
                checks[ds["dataset_name"]] = {"available": False, "error": str(e)[:200]}

    now = now_utc()
    snapshots: list[DatasetSnapshotORM] = []
    for ds in DATASETS:
        payload = dict(ds["payload"])
        payload.update({"check": checks.get(ds["dataset_name"], {"available": False})})
        snapshots.append(
            DatasetSnapshotORM(
                dataset_name=ds["dataset_name"],
                category=ds["category"],
                license=ds["license"],
                source_url=ds["source_url"],
                docs_url=ds["docs_url"],
                freshness=ds["freshness"],
                record_count=ds["record_count"],
                last_checked=now,
                payload=payload,
            )
        )
    logger.info("Dataset catalog: зібрано %d датасетів", len(snapshots))
    return snapshots


def collect_datasets(db=None) -> int:
    """Точка входу для pipeline. Повертає кількість збережених знімків."""
    owned = db is None
    session = db or SessionLocal()
    try:
        snapshots = build_snapshots()
        if not snapshots:
            return 0
        session.add_all(snapshots)
        session.commit()
        return len(snapshots)
    except Exception:  # noqa: BLE001 — один збій не має зупинити pipeline
        session.rollback()
        logger.exception("Dataset catalog save failed")
        return 0
    finally:
        if owned:
            session.close()
