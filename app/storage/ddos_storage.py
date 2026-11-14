"""
Збереження DDoS-снепшотів Cloudflare Radar у таблицю ddos_snapshots.

Без upsert-дедуплікації (за вимогою замовника): кожен запуск pipeline
створює новий часовий зріз, щоб можна було порівнювати «зараз» vs «минулого
тижня». Старі зрізи підчищаються опційно, щоб таблиця не розросталася.
"""
import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models.ddos_snapshot import DdosSnapshotORM

logger = logging.getLogger(__name__)

MAX_AGE_DAYS = 14  # скільки тримати зрізи (включно з «минулим тижнем»)


def save_snapshot(
    db: Session,
    scope: str,
    metric_type: str,
    payload: dict,
    source: str = "Cloudflare Radar",
    license_: str = "CC BY-NC 4.0",
) -> DdosSnapshotORM | None:
    """Додає новий зріз і повертає його. Невідомі значення — None."""
    from app.models.ddos_snapshot import VALID_METRIC_TYPES, VALID_SCOPES

    if scope not in VALID_SCOPES:
        logger.error("Невідомий scope=%r, пропуск", scope)
        return None
    if metric_type not in VALID_METRIC_TYPES:
        logger.error("Невідомий metric_type=%r, пропуск", metric_type)
        return None

    snapshot = DdosSnapshotORM(
        captured_at=datetime.utcnow(),
        scope=scope,
        metric_type=metric_type,
        payload=payload,
        source=source,
        license=license_,
    )
    db.add(snapshot)
    db.commit()
    return snapshot


def save_snapshots(db: Session, snapshots: list[DdosSnapshotORM]) -> int:
    """Масово додає зрізи за один commit."""
    if not snapshots:
        return 0
    db.add_all(snapshots)
    db.commit()
    return len(snapshots)


def clean_old_snapshots(db: Session, max_age_days: int = MAX_AGE_DAYS) -> int:
    """Видаляє зрізи старіші за max_age_days. Повертає кількість видалених."""
    cutoff = datetime.utcnow() - timedelta(days=max_age_days)
    deleted = (
        db.query(DdosSnapshotORM)
        .filter(DdosSnapshotORM.captured_at < cutoff)
        .delete(synchronize_session=False)
    )
    if deleted:
        db.commit()
        logger.info("DDoS: видалено %d застарілих зрізів", deleted)
    return deleted
