"""Планувальник періодичного збору даних (python -m app.pipeline).

До цього модуля збирання ВЗАГАЛІ не запускалося автоматично: pipeline
запускався лише вручну, а посилання на cron (.github/workflows/collect.yml)
вказувало на неіснуючий файл. Тому дані могли лежати днівами.

Тепер фоновий потік у процесі uvicorn раз на COLLECT_INTERVAL_HOURS
(типово 1) запускає app.pipeline у ДОЧІРНОМУ процесі:

  * окремий процес — збір не блокує API (збір триває хвилини, а він
    крутить той самий GIL інакше б усе «замерзало»);
  * кеш атрибуції інвалідується сам: він звіряє сигнатуру БД
    (COUNT + MAX(fetched_at)), яка змінюється після кожного проходу.

Вимикається: ENABLE_COLLECT_SCHEDULER=0 (за замовчуванням увімкнено).
Інтервал: COLLECT_INTERVAL_HOURS=1.
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

logger = logging.getLogger("scheduler")

ROOT = Path(__file__).resolve().parent.parent


def _truthy(value: str, default: bool = True) -> bool:
    raw = os.getenv(value, "").strip().lower()
    if not raw:
        return default
    return raw not in {"0", "false", "no", "off"}


def _run_pipeline_once() -> bool:
    """Запускає app.pipeline у дочірньому процесі; True — якщо код 0."""
    cmd = [sys.executable, "-m", "app.pipeline"]
    logger.info("scheduler: starting pipeline: %s", " ".join(cmd))
    started = time.monotonic()
    kwargs: dict = {
        "cwd": str(ROOT),
        "stdout": subprocess.PIPE,
        "stderr": subprocess.STDOUT,
        "text": True,
        "encoding": "utf-8",
        "errors": "replace",
    }
    if os.name == "nt":
        # Не миготіти консольним вікном під час фонового збору.
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    try:
        proc = subprocess.Popen(cmd, **kwargs)
    except OSError as e:
        logger.error("scheduler: failed to start pipeline: %s", e)
        return False

    assert proc.stdout is not None
    for line in proc.stdout:
        text = line.rstrip()
        if text:
            logger.info("pipeline| %s", text)

    code = proc.wait()
    elapsed = time.monotonic() - started
    if code == 0:
        logger.info("scheduler: pipeline finished in %.0f s", elapsed)
        return True
    logger.error("scheduler: pipeline exited with code %s after %.0f s", code, elapsed)
    return False


def _loop(interval_hours: float) -> None:
    interval = max(60.0, interval_hours * 3600.0)
    # Тик дрібніший за інтервал: інакше сон стартував би РАЗОМ із запуском
    # пайплайну, і при тривалому зборі (напр. 72 хв) наступний старт
    # зсувався б на тривалість прогону — замість години виходило ~2.2 год.
    tick = min(300.0, max(15.0, interval / 12))
    # Перший запуск — через інтервал після старту сервера, а не одразу:
    # одразу відкривати би мережеві конектори паралельно зі стартом AI-аналізів.
    next_due = time.monotonic() + interval
    logger.info(
        "scheduler: collection every %.1f h (first run in %.1f h, tick %.0f s; disable via ENABLE_COLLECT_SCHEDULER=0)",
        interval_hours,
        interval / 3600.0,
        tick,
    )
    while True:
        time.sleep(tick)
        if time.monotonic() < next_due:
            continue
        try:
            _run_pipeline_once()
        except Exception as e:  # noqa: BLE001 — фоновий потік не має падати
            logger.exception("scheduler: run failed: %s", e)
        # Лічильник після ЗАВЕРШЕННЯ прогону (а не до нього), тому інтервал
        # рахується від кінця збору і паралельних запусків не буває.
        next_due = time.monotonic() + interval


def start_collection_scheduler() -> threading.Thread | None:
    """Стартує фоновий планувальник; None — якщо вимкнено."""
    if not _truthy("ENABLE_COLLECT_SCHEDULER", default=True):
        logger.info("scheduler: disabled (ENABLE_COLLECT_SCHEDULER=0)")
        return None

    raw = os.getenv("COLLECT_INTERVAL_HOURS", "").strip()
    try:
        interval = float(raw) if raw else 1.0
    except ValueError:
        logger.warning("scheduler: bad COLLECT_INTERVAL_HOURS=%r, using 1.0", raw)
        interval = 1.0

    thread = threading.Thread(
        target=_loop, args=(interval,), name="collect-scheduler", daemon=True
    )
    thread.start()
    return thread
