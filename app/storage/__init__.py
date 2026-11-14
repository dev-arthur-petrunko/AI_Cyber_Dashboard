"""Пакет зберігання даних: bulk-записи загроз (bulk.py) та DDoS-зрізи (ddos_storage.py)."""

from app.storage.bulk import bulk_upsert

__all__ = ["bulk_upsert"]
