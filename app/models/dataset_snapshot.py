"""
ORM-модель каталогу ML-датасетів DDoS-аналітики.

Каталог НЕ завантажує багатогігабайтні архіви (PCAP/CSV) у БД — це
еталонний список датасетів для ML/аналізу з метаданими: ліцензія, тип,
актуальність, посилання, лічильник записів (якщо відомий). Кожен запуск
pipeline додає новий рядок (знімок) — історія last_checked зберігається.
"""
from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, Index, Integer, String

from app.db import Base, now_utc


class DatasetSnapshotORM(Base):
    __tablename__ = "dataset_snapshots"

    id = Column(Integer, primary_key=True)
    dataset_name = Column(String, nullable=False)
    category = Column(String, nullable=False, default="ddos_ml")
    license = Column(String, nullable=False)
    source_url = Column(String, nullable=False)
    docs_url = Column(String, nullable=True)
    freshness = Column(String, nullable=True)
    record_count = Column(Integer, nullable=True)
    last_checked = Column(DateTime, default=now_utc, nullable=False)
    payload = Column(JSON, nullable=False, default=dict)
    captured_at = Column(DateTime, default=now_utc, nullable=False)

    __table_args__ = (
        Index("ix_dataset_snapshots_name", "dataset_name"),
        Index("ix_dataset_snapshots_captured_at", "captured_at"),
    )


def parse_captured_at(value: datetime | str | None) -> datetime:
    """ISO-рядок або datetime -> наївний UTC datetime для API-відповідей."""
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    return now_utc()
