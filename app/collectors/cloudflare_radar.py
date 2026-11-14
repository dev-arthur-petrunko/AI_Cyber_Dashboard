"""
Колектор DDoS-статистики Cloudflare Radar.

Дані збираються у ПЕРЕДБАЧУВАНОМУ вигляді (запуск pipeline), а не на кожен
GET: снапшоти зберігаються у таблицю ddos_snapshots, а API-ендпоінти
читають уже збережені зрізи (вимога замовника — без live-запитів з UI).

API: Radar v4. Для кожного шару (layer3/layer7) і кожного scope
(global/UA) збираються 4 метрики:
  - summary          — розподіл типу атак (або частка «атака vs звичайний трафік»)
  - timeseries       — обсяг атак за останні 30 днів (точки для графіка)
  - top_targets      — топ країн-цілей
  - top_origins      — топ країн-джерел атак

Формат відповідей Radar v2 (усі розділи — /radar/attacks/...; legacy
/radar/ddos/... більше не існує й повертає «No route»):
  - summary      → result.summary_<name> = { мітка: відсоток-рядком }
  - timeseries   → result.serie_<name>  = { timestamps: [...], values: [...] }
  - top/target   → result.top_0 = [{ targetCountryAlpha2, targetCountryName,
                                     value: відсоток-рядком, rank }]
  - top/origin   → result.top_0 = [{ originCountryAlpha2, originCountryName,
                                     value: відсоток-рядком, rank }]
Кожен парсер нормалізує відповідь до view + зберігає сирий payload (raw)
для діагностики. Усе обгорнуто в try/except: якщо один запит упав — інші
працюють, а pipeline не падає.

Дані публікуються Cloudflare під ліцензією CC BY-NC 4.0.
"""
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from typing import Any, Callable

import requests

from app.db import SessionLocal
from app.models.ddos_snapshot import DdosSnapshotORM
from app.storage.ddos_storage import clean_old_snapshots, save_snapshots

logger = logging.getLogger(__name__)

RADAR_API_URL = "https://api.cloudflare.com/client/v4/radar"
SOFT_LICENSE = "CC BY-NC 4.0"

# Ендпоінти нового API (Radar v2, /radar/attacks/...). summary вимагає
# dimension у шляху: layer3 → vector (типи атак), layer7 → http_version.
LAYERS = {
    "layer3": {
        "summary": [
            "/attacks/layer3/summary/vector",
        ],
        "timeseries": [
            "/attacks/layer3/timeseries",
        ],
        "top_targets": [
            "/attacks/layer3/top/locations/target",
        ],
        "top_origins": [
            "/attacks/layer3/top/locations/origin",
        ],
    },
    "layer7": {
        "summary": [
            "/attacks/layer7/summary/http_version",
        ],
        "timeseries": [
            "/attacks/layer7/timeseries",
        ],
        "top_targets": [
            "/attacks/layer7/top/locations/target",
        ],
        "top_origins": [
            "/attacks/layer7/top/locations/origin",
        ],
    },
}

SCOPES = ("global", "UA")


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat() + "Z"


def _request(path: str, params: dict, token: str) -> dict | None:
    """Один запит до Radar API. Повертає json або None при будь-якій помилці."""
    try:
        resp = requests.get(
            f"{RADAR_API_URL}{path}",
            params=params,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()
    except (requests.RequestException, ValueError) as e:
        logger.warning("Radar request failed %s: %s", path, e)
        return None


def _parse_summary(raw: dict) -> dict | None:
    """Нормалізує summary (набір міток з відсотками)."""
    # Новий API: result.summary_<name> = { "SYN Flood": "42.1", ... }
    summary_0 = None
    if isinstance(raw.get("result"), dict):
        for key in raw["result"]:
            if key.startswith("summary_"):
                summary_0 = raw["result"][key]
                break
    if not isinstance(summary_0, dict):
        return None

    labels = []
    for name, value in summary_0.items():
        try:
            labels.append({"name": str(name), "value": float(value)})
        except (TypeError, ValueError):
            continue
    if labels:
        labels.sort(key=lambda x: x["value"], reverse=True)
        return {"kind": "vector", "labels": labels, "updated": _now_iso()}
    return None


def _parse_timeseries(raw: dict) -> dict | None:
    """Нормалізує timeseries до списку {date, value}."""
    # Новий API: result.serie_<name> = { timestamps: [...], values: [...] }
    # values — список рядків-відсотків або словник { "ATTACK": [...], ... }.
    serie = None
    if isinstance(raw.get("result"), dict):
        for key in raw["result"]:
            if key.startswith("serie_"):
                serie = raw["result"][key]
                break
    if not isinstance(serie, dict):
        return None

    timestamps = serie.get("timestamps")
    values = serie.get("values")
    if not isinstance(timestamps, list):
        return None

    if isinstance(values, dict):
        # Обираємо ряд значень: спочатку ATTACK, потім перший наявний список.
        value_series = None
        if "ATTACK" in values:
            value_series = values["ATTACK"]
        else:
            for v in values.values():
                if isinstance(v, list):
                    value_series = v
                    break
        if not isinstance(value_series, list):
            return None
    elif isinstance(values, list):
        value_series = values
    else:
        return None

    points = []
    for i, ts in enumerate(timestamps[: len(value_series)]):
        try:
            value = float(value_series[i])
        except (TypeError, ValueError, IndexError):
            continue
        # ISO-дата: беремо лише дату (UTC), якщо час присутній.
        date_str = str(ts)[:10]
        points.append({"date": date_str, "value": value})

    if not points:
        return None
    return {"points": points, "updated": _now_iso()}


def _parse_top(raw: dict, origin: bool) -> dict | None:
    """Нормалізує топ-локації до списку {country, code, value}."""
    top = None
    if isinstance(raw.get("result"), dict):
        for key in raw["result"]:
            if key.startswith("top_"):
                top = raw["result"][key]
                break
    if not isinstance(top, list) or not top:
        return None

    prefix = "origin" if origin else "target"
    items = []
    for entry in top:
        if not isinstance(entry, dict):
            continue
        name = (
            entry.get(f"{prefix}CountryName")
            or entry.get(f"{prefix}CountryCode")
            or entry.get("country")
            or entry.get("name")
        )
        code = (
            entry.get(f"{prefix}CountryAlpha2")
            or entry.get(f"{prefix}CountryCode")
            or entry.get("countryCode")
            or entry.get("code")
        )
        value = entry.get("value")
        try:
            value_f = float(value)
        except (TypeError, ValueError):
            continue
        if name is None:
            continue
        items.append(
            {
                "country": str(name),
                "code": str(code or ""),
                "value": value_f,
            }
        )

    if not items:
        return None
    items.sort(key=lambda x: x["value"], reverse=True)
    return {"items": items, "origin": origin, "updated": _now_iso()}


_PARSERS: dict[str, Callable[[dict], dict | None]] = {
    "summary": _parse_summary,
    "timeseries": _parse_timeseries,
    "top_targets": lambda raw: _parse_top(raw, origin=False),
    "top_origins": lambda raw: _parse_top(raw, origin=True),
}


def _fetch_metric(
    layer: str,
    metric: str,
    scope: str,
    token: str,
) -> DdosSnapshotORM | None:
    """Спроба зібрати одну метрику, з фолбеком між формами API."""
    metric_type = f"{layer}_{metric}"

    # Без параметра name Radar повертає стабільні ключі результату
    # (serie_0 / summary_0 / top_0), які розуміють парсери. limitPerGroup
    # приймають лише top-ендпоінти — для summary/timeseries він несумісний.
    params: dict[str, Any] = {}
    if metric == "timeseries":
        params.update({"dateRange": "30d", "aggInterval": "1d"})
    elif metric == "summary":
        params.update({"dateRange": "7d"})
    else:
        params.update({"dateRange": "7d", "limitPerGroup": 25})
    if scope == "UA":
        params["location"] = "UA"

    for path in LAYERS[layer][metric]:
        raw = _request(path, params, token)
        if not raw:
            continue
        view = _PARSERS[metric](raw)
        if view is None:
            continue
        return DdosSnapshotORM(
            captured_at=datetime.utcnow(),
            scope=scope,
            metric_type=metric_type,
            payload={"view": view, "raw": raw.get("result")},
            source="Cloudflare Radar",
            license=SOFT_LICENSE,
        )

    logger.warning("Radar %s/%s/%s: всі форми API не дали результату", layer, metric, scope)
    return None


def fetch_snapshots(token: str | None = None) -> list[DdosSnapshotORM]:
    """Збирає всі 16 зрізів паралельно. Ніколи не кидає винятки."""
    token = token or os.getenv("CLOUDFLARE_RADAR_API_TOKEN")
    if not token:
        logger.info(
            "CLOUDFLARE_RADAR_API_TOKEN не задано — DDoS-статистику Cloudflare Radar пропущено"
        )
        return []

    jobs = [
        (layer, metric, scope)
        for layer in LAYERS
        for metric in ("summary", "timeseries", "top_targets", "top_origins")
        for scope in SCOPES
    ]

    snapshots: list[DdosSnapshotORM] = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {
            pool.submit(_fetch_metric, layer, metric, scope, token): (layer, metric, scope)
            for layer, metric, scope in jobs
        }
        for future in as_completed(futures):
            try:
                snapshot = future.result()
            except Exception as e:  # жоден збій не має зупинити pipeline
                logger.error("Radar future failed: %s", e)
                continue
            if snapshot is not None:
                snapshots.append(snapshot)

    snapshots.sort(key=lambda s: (s.scope, s.metric_type))
    logger.info(
        "Cloudflare Radar: зібрано %d/%d зрізів",
        len(snapshots),
        len(jobs),
    )
    return snapshots


def collect(db=None) -> int:
    """Точка входу для pipeline. Повертає кількість збережених зрізів."""
    snapshots = fetch_snapshots()
    if not snapshots:
        return 0

    owned = db is not None
    session = db or SessionLocal()
    try:
        saved = save_snapshots(session, snapshots)
        clean_old_snapshots(session)
        return saved
    finally:
        if not owned:
            session.close()
