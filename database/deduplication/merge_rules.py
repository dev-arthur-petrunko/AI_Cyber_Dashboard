"""Референсные правила слияния (мерж) при upsert существующей записи угрозы.

Этот файл не используется текущим кодом напрямую (логика живет в app/storage/bulk.py).
Он зафиксирован как справочный для понимания и будущих изменений.
"""

from typing import Any


def merge_record(existing: dict[str, Any], new: dict[str, Any]) -> dict[str, Any]:
    """Слить новую запись в существующую с правилами protection.

    Возвращает новый словарь с объединенными полями.
    """
    merged = dict(existing)

    # Всегда обновляемые поля
    updatable = {
        "title", "type", "severity", "country", "region", "vendor",
        "products", "cvss_score", "epss_score", "exploit_maturity",
        "tags", "summary", "url", "cve_id", "poc_published", "added_to_kev",
    }
    for field in updatable:
        if new.get(field) is not None:
            merged[field] = new[field]

    # fetched_at — всегда текущее время импорта
    if new.get("fetched_at") is not None:
        merged["fetched_at"] = new["fetched_at"]

    # published — не перезаписывать при backfill
    new_is_backfill = bool(new.get("is_backfill"))
    old_is_backfill = bool(existing.get("is_backfill"))
    if new_is_backfill:
        # Сохраняем старую published, чтобы не омолодить запись
        merged["published"] = existing.get("published")
    elif new.get("published") is not None:
        merged["published"] = new["published"]

    # is_backfill — True, если хотя бы одна сторона backfill
    merged["is_backfill"] = new_is_backfill or old_is_backfill

    return merged
