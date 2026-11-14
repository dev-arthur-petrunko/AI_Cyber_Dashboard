"""
Єдина модель даних для всіх джерел загроз.
Будь-який колектор (NVD, CISA KEV, CERT-UA, ...) зобов'язаний перетворювати
сирі дані джерела на об'єкт Threat перед збереженням у БД.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, HttpUrl


class Severity(str, Enum):
    critical = "Critical"
    high = "High"
    medium = "Medium"
    low = "Low"
    unknown = "Unknown"


class ThreatType(str, Enum):
    cve = "CVE"
    advisory = "Advisory"
    news = "News"
    exploit = "Exploit"
    ioc = "IOC"


class Region(str, Enum):
    ua = "UA"
    world = "World"


class ExploitMaturity(str, Enum):
    poc = "PoC"          # є публічний proof-of-concept
    weaponized = "Weaponized"   # є готовий робочий експлойт
    in_the_wild = "In the wild"  # зафіксована реальна експлуатація (KEV)
    unknown = "Unknown"


class Threat(BaseModel):
    # Стабільний ключ для дедуплікації (наприклад "CVE-2024-12345" або hash(url))
    external_id: str = Field(..., description="Унікальний ID у зовнішньому джерелі")

    title: str
    source: str  # "NVD" | "CISA KEV" | "CERT-UA" | "GitHub" | "BleepingComputer" ...
    type: ThreatType
    severity: Severity = Severity.unknown

    country: list[str] = Field(default_factory=list)
    region: Region = Region.world  # для перемикача «Україна / Світ» на дашборді
    vendor: Optional[str] = None
    products: list[str] = Field(default_factory=list)

    # Глибина ризику (Етап 5+): числові метрики замість лише Severity-ярлика
    cvss_score: Optional[float] = None
    epss_score: Optional[float] = None  # ймовірність експлуатації в наст. 30 днів (0-1)
    exploit_maturity: ExploitMaturity = ExploitMaturity.unknown

    published: datetime
    fetched_at: datetime = Field(default_factory=datetime.utcnow)
    # Технічний імпорт без реальної дати джерела (published підставлено як
    # now()). Виключається з new_cve_24h — див. app/storage/bulk.py.
    is_backfill: bool = False

    tags: list[str] = Field(default_factory=list)
    summary: str = ""
    url: Optional[str] = None

    # Поля для майбутнього "Cyber Timeline" (Етап далі за планом)
    cve_id: Optional[str] = None
    poc_published: Optional[datetime] = None
    added_to_kev: Optional[datetime] = None

    class Config:
        use_enum_values = True
