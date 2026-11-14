"""Одноразовий історичний бекфіл CERT-UA з архівних снапшотів RSS.

cert.gov.ua публікує лише ~9 свіжих записів через RSS (інших публічних
API немає — перевірено: /api/articles, /api/incidents, sitemap, SPA-бандл).
web.archive.org зберігає щомісячні копії фіда з 2022 року, тому об'єднання
снапшотів відновлює історію публікацій.

Дублікати відсіює bulk_upsert за external_id — скрипт безпечний для
повторного запуску. Пайплайн (app.pipeline) продовжує використовувати
лише живий RSS; цей скрипт — разовий/періодичний догляд.

Запуск: python -m scripts.backfill_cert_ua
"""
import logging
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv

load_dotenv()

from app.collectors.cert_ua import CertUACollector
from app.db import SessionLocal, init_db
from app.storage import bulk_upsert

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("backfill_cert_ua")


def main() -> None:
    collector = CertUACollector()
    threats = collector.fetch_archive()

    if not threats:
        logger.warning("Архів не повернув записів — нічого робити.")
        return

    db = SessionLocal()
    try:
        init_db()
        result = bulk_upsert(db, threats)
        logger.info("bulk_upsert: %s", result)

        # Контроль: скільки записів CERT-UA тепер у БД та за роками
        from sqlalchemy import func

        from app.db import ThreatORM

        total = db.query(ThreatORM).filter(ThreatORM.source == "CERT-UA").count()
        by_year = (
            db.query(
                func.strftime("%Y", ThreatORM.published), func.count(ThreatORM.id)
            )
            .filter(ThreatORM.source == "CERT-UA")
            .group_by(func.strftime("%Y", ThreatORM.published))
            .all()
        )
        print(f"\nCERT-UA у БД: {total} записів")
        for year, count in sorted(by_year):
            print(f"  {year}: {count}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
