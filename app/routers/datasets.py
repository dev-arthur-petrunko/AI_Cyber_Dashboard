"""
API-ендпоінти каталогу ML-датасетів DDoS-аналітики.

Читає найсвіжіший знімок кожного датасета з dataset_snapshots (без
live-запитів). Відповіді кешуються на 1 годину (cachetools.TTLCache).
"""
import logging
from datetime import timezone

from cachetools import TTLCache, cached
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_session
from app.models.dataset_snapshot import DatasetSnapshotORM

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/datasets", tags=["datasets"])

_cache = TTLCache(maxsize=16, ttl=3600)


def _public(row: DatasetSnapshotORM) -> dict:
    return {
        "name": row.dataset_name,
        "category": row.category,
        "license": row.license,
        "source_url": row.source_url,
        "docs_url": row.docs_url,
        "freshness": row.freshness,
        "record_count": row.record_count,
        "last_checked": row.last_checked.replace(tzinfo=timezone.utc).isoformat(),
        "payload": row.payload or {},
    }


@cached(_cache)
def _cached_list(db: Session) -> dict:
    """Останній знімок для кожного датасета одним запитом."""
    rows = (
        db.query(DatasetSnapshotORM)
        .order_by(DatasetSnapshotORM.captured_at.desc())
        .all()
    )
    latest: dict[str, DatasetSnapshotORM] = {}
    for row in rows:
        latest.setdefault(row.dataset_name, row)
    return {"datasets": [_public(row) for row in latest.values()]}


@router.get("")
def list_datasets(db: Session = Depends(get_session)):
    """Каталог ML-датасетів DDoS: метадані, ліцензія, свіжість, доступність."""
    return _cached_list(db)
