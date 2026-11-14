"""
Слой БД. За замовчуванням — SQLite (data/threats.db), без зовнішніх залежностей.
Для продакшену достатньо поміняти DATABASE_URL у .env на postgresql://...
"""
import os
from datetime import datetime, timezone

from sqlalchemy import (Boolean, Column, DateTime, Float, Integer, String, Text,
                        JSON, UniqueConstraint, create_engine)
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL") or "sqlite:///./data/threats.db"

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
# Воркер Render може лишатися активним, коли Neon закриває неактивне з'єднання.
# Перевірка перед повторним використанням усуває періодичні 500 після простою
# та дозволяє SQLAlchemy автоматично перепідключитися.
engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
    pool_recycle=300,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def now_utc() -> datetime:
    """Наївний UTC-now (аналог datetime.utcnow, без DeprecationWarning у 3.12+)."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class CollectorStateORM(Base):
    """Стан збирання за джерелом: остання fetched_at для інкрементального запуску."""
    __tablename__ = "collector_states"

    source = Column(String, primary_key=True)
    last_fetched_at = Column(DateTime, nullable=True, default=None)
    updated_at = Column(DateTime, default=now_utc)


class ThreatORM(Base):
    __tablename__ = "threats"

    id = Column(Integer, primary_key=True)
    external_id = Column(String, index=True, nullable=False)
    source = Column(String, index=True)

    title = Column(String, nullable=False)
    type = Column(String, index=True)
    severity = Column(String, index=True)

    country = Column(JSON, default=list)
    region = Column(String, default="World", index=True)
    vendor = Column(String, nullable=True)
    products = Column(JSON, default=list)

    cvss_score = Column(Float, nullable=True)
    epss_score = Column(Float, nullable=True)
    exploit_maturity = Column(String, default="Unknown", index=True)

    published = Column(DateTime, index=True)
    fetched_at = Column(DateTime, default=now_utc)
    # True — технічний імпорт без реальної дати джерела (published = fallback
    # now()); виключається з метрик «свіжості» (new_cve_24h), щоб bulk-backfill
    # нового джерела не виглядав як добовий сплеск загроз.
    is_backfill = Column(Boolean, default=False, index=True)

    tags = Column(JSON, default=list)
    summary = Column(Text, default="")
    url = Column(String, nullable=True)

    cve_id = Column(String, nullable=True, index=True)
    poc_published = Column(DateTime, nullable=True)
    added_to_kev = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("source", "external_id", name="uq_source_external_id"),
    )


def init_db():
    os.makedirs("data", exist_ok=True)
    Base.metadata.create_all(bind=engine)


def get_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def get_last_fetched(db: Session, source: str):
    """Отримати останню fetched_at для джерела (або None, якщо ще не zbіралось)."""
    row = db.query(CollectorStateORM).filter(CollectorStateORM.source == source).first()
    return row.last_fetched_at if row else None


def update_last_fetched(db: Session, source: str, fetched_at):
    """Оновити останню fetched_at для джерела."""
    row = db.query(CollectorStateORM).filter(CollectorStateORM.source == source).first()
    if row:
        row.last_fetched_at = fetched_at
        row.updated_at = now_utc()
    else:
        db.add(CollectorStateORM(source=source, last_fetched_at=fetched_at, updated_at=now_utc()))
    db.commit()


# Реєстрація додаткових ORM-моделей у Base.metadata (для create_all та Alembic).
# Імпорт тут, а не нагорі, щоб уникнути циклічного імпорту.
from app.models.ddos_snapshot import DdosSnapshotORM  # noqa: E402,F401
from app.models.dataset_snapshot import DatasetSnapshotORM  # noqa: E402,F401
from app.db import CollectorStateORM  # noqa: E402,F401
