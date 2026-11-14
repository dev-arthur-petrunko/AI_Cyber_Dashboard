"""Bulk-запис загроз у таблицю threats (upsert по парі source+external_id)."""
from datetime import datetime

from sqlalchemy.orm import Session

from app.db import ThreatORM
from app.models.threat import Threat
from app.scoring import extract_vendor, enforce_strict_critical


def bulk_upsert(db: Session, threats: list[Threat], batch_size: int = 500) -> dict:
    """Вставляє/оновлює пачку загроз у менших батчах (batch_size) для
    зменшення навантаження на БД. Upsert по парі source+external_id.

    Велику пачку ділимо на частини, щоб не тримати одну велику транзакцію
    і не перевантажувати БД (особливо віддалену Postgres/Neon).
    """
    if not threats:
        return {"inserted": 0, "updated": 0, "skipped_duplicates": 0, "skipped_invalid": 0, "total": 0}

    # Обмеження БД захищає між запусками, а ця перевірка — відповідь одного
    # колектора. Без неї два дублікати з однієї пачки плануються на INSERT і
    # можуть зірвати всю транзакцію до перевірки унікальності PostgreSQL.
    unique_threats: dict[tuple[str, str], Threat] = {}
    skipped_duplicates = 0
    skipped_invalid = 0
    for threat in threats:
        external_id = threat.external_id.strip()
        if not external_id:
            skipped_invalid += 1
            continue

        key = (threat.source, external_id)
        if key in unique_threats:
            skipped_duplicates += 1
        unique_threats[key] = threat.model_copy(update={"external_id": external_id})

    threats = list(unique_threats.values())
    if not threats:
        return {
            "inserted": 0,
            "updated": 0,
            "skipped_duplicates": skipped_duplicates,
            "skipped_invalid": skipped_invalid,
            "total": 0,
        }

    total_inserted = 0
    total_updated = 0
    total_skipped_invalid = skipped_invalid
    total_skipped_duplicates = skipped_duplicates

    # Обробляємо меншими батчами, щоб не перевантажувати БД.
    for i in range(0, len(threats), batch_size):
        batch = threats[i : i + batch_size]

        sources = {t.source for t in batch}
        external_ids = {t.external_id for t in batch}

        # Один запит замість N: тягнемо всі потенційно наявні записи разом.
        existing_rows = (
            db.query(ThreatORM)
            .filter(
                ThreatORM.source.in_(sources),
                ThreatORM.external_id.in_(external_ids),
            )
            .all()
        )
        existing_map = {(r.source, r.external_id): r for r in existing_rows}

        # ``fetched_at`` — операційна метадані, оновлюється при кожному зборі.
        fetched_at = datetime.utcnow()
        inserted, updated = 0, 0
        for t in batch:
            key = (t.source, t.external_id)
            data = t.model_dump(exclude={"fetched_at"})
            data["fetched_at"] = fetched_at
            # Суворе правило Critical (варіант А): пониження до High,
            # якщо немає CVSS≥9 / EPSS≥0.5+експлойт / активної експлуатації+CVE
            # / KEV / явного CERT-тега; IOC — ніколи не Critical.
            data = enforce_strict_critical(data)
            if not data.get("vendor"):
                data["vendor"] = extract_vendor(
                    title=data.get("title"),
                    summary=data.get("summary"),
                    tags=data.get("tags"),
                    products=data.get("products"),
                )
            # url приходить як HttpUrl -> приводимо до рядка
            if data.get("url") is not None:
                data["url"] = str(data["url"])

            row = existing_map.get(key)
            if row:
                # published — дата публікації джерела. Якщо is_backfill=True —
                # НЕ перетираємо стару дату, інакше погодинний збір блоклістів
                # «омолодить» записи і створить фіктивний сплеск new_cve_24h.
                if t.is_backfill:
                    data["published"] = row.published
                data["is_backfill"] = bool(row.is_backfill or t.is_backfill)
                for k, v in data.items():
                    setattr(row, k, v)
                updated += 1
            else:
                db.add(ThreatORM(**data))
                inserted += 1

        db.commit()  # коміт на кожен батч
        total_inserted += inserted
        total_updated += updated

    return {
        "inserted": total_inserted,
        "updated": total_updated,
        "skipped_duplicates": total_skipped_duplicates,
        "skipped_invalid": total_skipped_invalid,
        "total": len(threats),
    }
