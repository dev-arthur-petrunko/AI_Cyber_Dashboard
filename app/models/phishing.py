"""
ORM-модель для фішингових URL (PhishTank, OpenPhish, PhishStats).

Окрема таблиця threats: фішинг — це окрема категорія IoC,
яка потребує специфічної обробки (перевірка URL, бренди, гео).
"""
from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, Index, Integer, String, Text

from app.db import Base, now_utc


class PhishingURLORM(Base):
    __tablename__ = "phishing_urls"

    id = Column(Integer, primary_key=True)
    external_id = Column(String, index=True, nullable=False)
    source = Column(String, index=True, nullable=False)

    url = Column(Text, nullable=False)
    target_brand = Column(String, nullable=True, index=True)
    host = Column(String, nullable=True)
    domain = Column(String, nullable=True, index=True)

    verified = Column(String, default="unverified")
    status = Column(String, default="online", index=True)

    target_country = Column(JSON, default=list)
    tags = Column(JSON, default=list)

    first_seen = Column(DateTime, default=now_utc)
    last_seen = Column(DateTime, default=now_utc)
    fetched_at = Column(DateTime, default=now_utc)

    __table_args__ = (
        Index("ix_phishing_domain_brand", "domain", "target_brand"),
        Index("ix_phishing_source_fetched", "source", "fetched_at"),
    )
