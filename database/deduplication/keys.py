"""Референсные утилиты построения ключей дедупликации.

Этот файл не используется текущим кодом напрямую (логика живет в app/storage/bulk.py).
Он зафиксирован как справочный для будущих изменений и для понимания
правил ключей дедупликации.
"""

import hashlib
from typing import Optional


def primary_key(source: str, external_id: str) -> tuple[str, str]:
    """Первичный ключ дедупликации: пара (source, external_id).

    Соответствует UniqueConstraint('source', 'external_id') в ThreatORM.
    """
    return (source.strip(), external_id.strip())


def content_hash(
    title: Optional[str] = None,
    url: Optional[str] = None,
    cve_id: Optional[str] = None,
) -> Optional[str]:
    """SHA-256 хеш нормализованного контента для меж-источниковой дедупликации.

    Используется как дополнительный сигнал, НЕ как первичный ключ.
    Нормализация: lower-case,trim, убраны лишние пробелы.
    """
    parts = []
    if title:
        parts.append(f"title:{title.strip().lower()}")
    if url:
        parts.append(f"url:{url.strip().lower()}")
    if cve_id:
        parts.append(f"cve:{cve_id.strip().upper()}")
    if not parts:
        return None
    payload = "|".join(parts).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def is_valid_external_id(external_id: Optional[str]) -> bool:
    """Проверка, что external_id пригоден для записи (не пустой)."""
    return bool(external_id and external_id.strip())
