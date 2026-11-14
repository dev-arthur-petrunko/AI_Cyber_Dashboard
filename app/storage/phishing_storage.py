"""Bulk-запис фішингових URL у таблицю phishing_urls (upsert)."""
from sqlalchemy.orm import Session

from app.models.phishing import PhishingURLORM


def bulk_upsert_phishing(db: Session, records: list[PhishingURLORM]) -> dict:
    """Вставляє/оновлює фішингові URL з дедуплікацією по (source, external_id)."""
    if not records:
        return {"inserted": 0, "updated": 0, "skipped": 0, "total": 0}

    unique: dict[tuple[str, str], PhishingURLORM] = {}
    for r in records:
        key = (r.source, r.external_id)
        if key in unique:
            continue
        unique[key] = r

    sources = {r.source for r in unique.values()}
    eids = {r.external_id for r in unique.values()}

    existing = (
        db.query(PhishingURLORM)
        .filter(PhishingURLORM.source.in_(sources), PhishingURLORM.external_id.in_(eids))
        .all()
    )
    existing_map = {(r.source, r.external_id): r for r in existing}

    inserted, updated, skipped = 0, 0, 0
    for (src, eid), new_rec in unique.items():
        old = existing_map.get((src, eid))
        if old:
            old.url = new_rec.url
            old.target_brand = new_rec.target_brand
            old.host = new_rec.host
            old.domain = new_rec.domain
            old.verified = new_rec.verified
            old.status = new_rec.status
            old.target_country = new_rec.target_country
            old.tags = new_rec.tags
            old.last_seen = new_rec.fetched_at
            updated += 1
        else:
            db.add(new_rec)
            inserted += 1

    db.commit()
    return {"inserted": inserted, "updated": updated, "skipped": skipped, "total": len(unique)}
