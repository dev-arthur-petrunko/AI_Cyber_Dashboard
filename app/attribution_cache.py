"""Кеш атрибуції: один прохід по БД на всі три ендпоінти.

Проблема: /stats, /stats/attribution і /stats/sponsor-infrastructure
будували свої агрегати незалежно, і кожен прохід сканував усю таблицю
та викликав detect_actors по кожному запису. Дашборд дзвонить у всі три
одночасно — на 15 900 записів це ≈10 c CPU (а GIL в додатку ще й
нарощує чергу до ~30 c).

Рішення: app.actors.build_attribution робить ОДИН прохід і віддає всі
три агрегати; тут вони кешуються в пам'яті.

Валідність кешу — дві умови (обидві мають виконуватися):
  1) підпис БД не змінився: (COUNT(threats), MAX(fetched_at), додаткові
     лічильники у таблицях, які входять у розрахунок);
  2) вік менший за ATTRIB_CACHE_TTL_SEC (типово 300 с) — страховка, якщо
     підпис чомусь не помінявся.

Кеш спільний для потоків; обчислення під локом, щоб десять паралельних
запитів не будували атрибуцію одночасно (thundering herd).
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Callable

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.actors import build_attribution

logger = logging.getLogger(__name__)

DEFAULT_TTL_SEC = 300.0

_lock = threading.Lock()
_cache: dict[str, Any] = {}
_built_at: float = 0.0
_signature: tuple | None = None
_built_in_ms: float = 0.0


def _db_signature(db: Session) -> tuple:
    """Дешева підписка стану БД для інвалідації кешу.

    Атрибуція залежить від текстів/країн записів (таблиця threats) та від
    DDoS-знімків лише в /stats (там окремий код). Тому підписуємо саме те,
    що споживає build_attribution: кількість і «свіжість» записів.
    """
    from app.db import ThreatORM

    count = db.query(func.count(ThreatORM.id)).scalar() or 0
    last = db.query(func.max(ThreatORM.fetched_at)).scalar()
    last_pub = db.query(func.max(ThreatORM.published)).scalar()
    return (count, str(last), str(last_pub))


def get_attribution(db: Session, build_fn: Callable[[Session], dict] | None = None) -> dict:
    """Повертає закешований результат build_attribution(db).

    build_fn — injection point для тестів; за замовчуванням
    app.actors.build_attribution(db-рядків через зовнішній query).
    """
    global _cache, _built_at, _signature, _built_in_ms

    ttl = float(os.getenv("ATTRIB_CACHE_TTL_SEC", "") or DEFAULT_TTL_SEC)
    sig = _db_signature(db)
    now = time.monotonic()

    with _lock:
        if _cache and _signature == sig and (now - _built_at) < ttl:
            return _cache

        t0 = time.perf_counter()
        if build_fn is None:
            from app.db import ThreatORM

            rows = db.query(
                ThreatORM.title, ThreatORM.summary, ThreatORM.tags, ThreatORM.country
            ).all()
            result = build_attribution(rows)
        else:
            result = build_fn(db)
        _built_in_ms = (time.perf_counter() - t0) * 1000

        _cache = result
        _built_at = now
        _signature = sig
        logger.info("attribution cache rebuilt in %.0f ms", _built_in_ms)
        return _cache


def invalidate() -> None:
    """Скинути кеш (викликається після імпорту/оновлення даних)."""
    global _cache, _built_at, _signature
    with _lock:
        _cache = {}
        _built_at = 0.0
        _signature = None


def stats() -> dict[str, Any]:
    """Стан кешу для діагностики."""
    with _lock:
        age = (time.monotonic() - _built_at) if _built_at else None
        return {
            "hit": bool(_cache),
            "age_sec": round(age, 1) if age is not None else None,
            "built_in_ms": round(_built_in_ms, 1),
        }
