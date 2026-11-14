"""
ORM-модель для DDoS-снепшотів Cloudflare Radar.

Окрема таблиця від threats: DDoS-статистика — часові ряди, а не загрози.
Тут НЕ рахується CVSS/EPSS/severity і не робиться upsert-дедуплікація —
кожен запуск pipeline додає новий рядок (часовий зріз).
"""
from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, Index, Integer, String

from app.db import Base, now_utc

SOURCE = "Cloudflare Radar"
LICENSE = "CC BY-NC 4.0"

# Допустимі значення для валідації при збереженні
VALID_SCOPES = ("global", "UA")
VALID_METRIC_TYPES = (
    "layer3_summary",
    "layer3_timeseries",
    "layer3_top_targets",
    "layer3_top_origins",
    "layer7_summary",
    "layer7_timeseries",
    "layer7_top_targets",
    "layer7_top_origins",
)


class DdosSnapshotORM(Base):
    __tablename__ = "ddos_snapshots"

    id = Column(Integer, primary_key=True)
    captured_at = Column(DateTime, default=now_utc, nullable=False)
    scope = Column(String, nullable=False)          # "global" | "UA"
    metric_type = Column(String, nullable=False)    # layer3_summary, layer3_timeseries, ...
    payload = Column(JSON, nullable=False, default=dict)
    source = Column(String, nullable=False, default=SOURCE)
    license = Column(String, nullable=False, default=LICENSE)

    __table_args__ = (
        Index("ix_ddos_snapshots_captured_at", "captured_at"),
        Index("ix_ddos_snapshots_scope", "scope"),
        Index("ix_ddos_snapshots_metric_type", "metric_type"),
        Index("ix_ddos_snapshots_scope_metric", "scope", "metric_type"),
    )


def parse_captured_at(value: datetime | str | None) -> datetime:
    """ISO-рядок або datetime -> наївний UTC datetime для API-відповідей."""
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    return now_utc()
