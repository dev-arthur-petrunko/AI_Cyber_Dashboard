"""
API-ендпоінти DDoS-статистики (Cloudflare Radar).

Читають тільки ЗБЕРЕЖЕНІ зрізи з ddos_snapshots — без live-запитів до
Cloudflare. Відповіді кешуються на 1 годину (cachetools.TTLCache), щоб
повторні GET не смикали БД.
"""
import logging
from datetime import datetime, timezone

from cachetools import TTLCache, cached
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db import get_session
from app.models.ddos_snapshot import DdosSnapshotORM, VALID_METRIC_TYPES, VALID_SCOPES
from app.models.threat import Region

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ddos-stats", tags=["ddos"])

# Кеш на 1 годину (завдання B6). Ключ — (ендпоінт, scope, layer).
_cache = TTLCache(maxsize=128, ttl=3600)


def _normalize_scope(scope: str | None) -> str:
    """'World'/'world'/'UA'/'ua' -> 'global'|'UA'; None -> 'global'."""
    if scope is None:
        return "global"
    if scope.upper() in ("UA", "UKRAINE", "УКРАЇНА"):
        return "UA"
    if scope.upper() in ("WORLD", "GLOBAL", "ВСІ", "ВЕСЬ СВІТ"):
        return "global"
    raise HTTPException(status_code=400, detail=f"Невідомий scope: {scope}")


def _latest_snapshot(db: Session, scope: str, metric_type: str) -> DdosSnapshotORM:
    snapshot = (
        db.query(DdosSnapshotORM)
        .filter(DdosSnapshotORM.scope == scope, DdosSnapshotORM.metric_type == metric_type)
        .order_by(DdosSnapshotORM.captured_at.desc())
        .first()
    )
    if snapshot is None:
        raise HTTPException(
            status_code=404,
            detail=f"Немає даних Cloudflare Radar для {scope}/{metric_type}. "
            "Запустіть python -m app.pipeline",
        )
    return snapshot


def _public(snapshot: DdosSnapshotORM) -> dict:
    return {
        "scope": snapshot.scope,
        "metric_type": snapshot.metric_type,
        "captured_at": snapshot.captured_at.replace(tzinfo=timezone.utc).isoformat(),
        "source": snapshot.source,
        "license": snapshot.license,
        "view": snapshot.payload.get("view", {}),
    }


@cached(_cache)
def _cached_latest(db: Session, scope: str, layer: str) -> dict:
    """Збирає всі 4 метрики шару одним запитом під ключем кешу."""
    snapshots = (
        db.query(DdosSnapshotORM)
        .filter(
            DdosSnapshotORM.scope == scope,
            DdosSnapshotORM.metric_type.like(f"{layer}_%"),
        )
        .order_by(DdosSnapshotORM.captured_at.desc())
        .all()
    )

    # Найсвіжіший зріз для кожної метрики шару
    latest_by_metric: dict[str, DdosSnapshotORM] = {}
    for snap in snapshots:
        latest_by_metric.setdefault(snap.metric_type, snap)

    missing = [m for m in VALID_METRIC_TYPES if m.startswith(layer) and m not in latest_by_metric]
    return {
        "layer": layer,
        "metrics": {
            mt.replace(f"{layer}_", ""): _public(snap)
            for mt, snap in sorted(latest_by_metric.items())
        },
        "missing": missing,
    }


@router.get("")
def get_ddos_stats(
    scope: str | None = Query(default="global", description="global|UA (або World/Україна)"),
    db: Session = Depends(get_session),
):
    """Уся статистика за шаром: summary, timeseries, top_targets, top_origins."""
    norm_scope = _normalize_scope(scope)
    return {
        "region": norm_scope,
        "layer3": _cached_latest(db, norm_scope, "layer3"),
        "layer7": _cached_latest(db, norm_scope, "layer7"),
    }


def _single_metric(
    metric: str,
    scope: str | None,
    layer: str,
    db: Session,
) -> dict:
    norm_scope = _normalize_scope(scope)
    metric_type = f"{layer}_{metric}"
    if metric_type not in VALID_METRIC_TYPES:
        raise HTTPException(status_code=400, detail=f"Невідома метрика: {metric_type}")
    return _public(_latest_snapshot(db, norm_scope, metric_type))


@router.get("/timeseries")
def get_ddos_timeseries(
    scope: str | None = Query(default="global"),
    layer: str = Query(default="layer7", pattern="^(layer3|layer7)$"),
    db: Session = Depends(get_session),
):
    """Часовий ряд обсягу атак (точки для графіка на дашборді)."""
    return _single_metric("timeseries", scope, layer, db)


@router.get("/top-targets")
def get_ddos_top_targets(
    scope: str | None = Query(default="global"),
    layer: str = Query(default="layer7", pattern="^(layer3|layer7)$"),
    db: Session = Depends(get_session),
):
    """Топ країн-цілей DDoS."""
    return _single_metric("top_targets", scope, layer, db)


@router.get("/top-origins")
def get_ddos_top_origins(
    scope: str | None = Query(default="global"),
    layer: str = Query(default="layer7", pattern="^(layer3|layer7)$"),
    db: Session = Depends(get_session),
):
    """Топ країн-джерел DDoS."""
    return _single_metric("top_origins", scope, layer, db)


def infer_ddos_region() -> str:
    """Для карток джерел: країна за замовчуванням."""
    return Region.world
