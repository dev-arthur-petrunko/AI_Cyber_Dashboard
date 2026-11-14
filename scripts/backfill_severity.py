"""Одноразовий бекфілл severity для протухлих записів Advisory/News.

Контекст: у v1.5.0 виправили колектори (SingCERT, NCSC UK, Generic Scraper,
ExploitDB, SSSCIP UA, Telegram Channel) — вони почали викликати
infer_severity() замість hardcoded Unknown. Але записи, які вже лежали в БД
зі старих запусків, не перерахувалися: bulk_upsert оновлює рядок лише тоді,
коли колектор знову успішно відпрацював. Цей скрипт доганяє базу без
повного запуску пайплайна.

Перераховуються ТІЛЬКИ записи type IN (Advisory, News) з severity=Unknown —
ті самі правила, що й під час збору. CVE (офіційний CVSS з NVD) та Exploit
не чіпаються.

Запуск: python -m scripts.backfill_severity
"""
import sys

from app.db import SessionLocal, ThreatORM, init_db
from app.scoring import infer_severity


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    init_db()
    db = SessionLocal()
    try:
        rows = (
            db.query(ThreatORM)
            .filter(
                ThreatORM.severity == "Unknown",
                ThreatORM.type.in_(["Advisory", "News"]),
            )
            .all()
        )
        updated = 0
        for row in rows:
            new_sev = infer_severity(
                title=row.title, summary=row.summary, tags=row.tags
            )
            if new_sev != row.severity:
                row.severity = new_sev
                updated += 1
                print(f"  {row.source}: {row.title[:60]!r} Unknown -> {new_sev}")
        db.commit()
        print(f"Перевірено: {len(rows)}, оновлено: {updated}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
