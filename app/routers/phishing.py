"""
Роутер фішингу: статистика, список загроз, AI-приклади листів.

Ендпоїнти:
  GET /phishing/stats    — статистика фішингу (за брендами, країнами, джерелами)
  GET /phishing/threats  — список фішингових URL (з пагінацією, фільтрами)
  GET /phishing/examples — AI-згенеровані приклади фішингових листів (для навчання)
"""
import logging
import os
import time
import threading
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Any

import requests
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc

from app.db import SessionLocal, now_utc
from app.models.phishing import PhishingURLORM
from app.security import require_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/phishing", tags=["phishing"])

# ─── Кеш AI-прикладів ────────────────────────────────────────────
_examples_cache: dict[str, Any] = {}
_examples_lock = threading.Lock()
GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "openai/gpt-oss-120b"
EXAMPLES_HOUR_KYIV = 10  # Оновлення о 10:00 за Києвом

EXAMPLES_SYSTEM_PROMPT = (
    "Ти — експерт з кібербезпеки, який створює освітні матеріали для навчання "
    "співробітників розпізнаванню фішингу. Створюй реалістичні, але безпечні "
    "приклади фішингових листів та повідомлень. Кожен приклад повинен бути "
    "помічений як 'ОСВІТНІЙ МАТЕРІАЛ / EDUCATIONAL EXAMPLE'. "
    "Не використовуй реальні шкідливі URL. Використовуй домен example.com. "
    "Пиши українською мовою з деякими англійськими термінами."
)


def _get_phishing_from_db() -> list[dict[str, Any]]:
    """Отримує останні фішингові URL з бази."""
    session = SessionLocal()
    try:
        rows = (
            session.query(PhishingURLORM)
            .order_by(desc(PhishingURLORM.fetched_at))
            .limit(500)
            .all()
        )
        return [
            {
                "url": r.url,
                "target_brand": r.target_brand or "Невідомий бренд",
                "domain": r.domain or "",
                "verified": r.verified,
                "status": r.status,
                "target_country": r.target_country or [],
                "source": r.source,
                "first_seen": str(r.first_seen) if r.first_seen else "",
            }
            for r in rows
        ]
    finally:
        session.close()


def _build_examples_prompt() -> str:
    """Будує промпт для генерації прикладів фішингових листів."""
    return (
        "Створи 6 освітніх прикладів фішингових повідомлень для навчання "
        "співробітників. Різні сценарії:\n\n"
        "1. Фішинговий лист від 'банк' (крадіжка карткових даних)\n"
        "2. Фішингове повідомлення від 'IT-відділу' (крадіжка паролю)\n"
        "3. SMS-фішинг (smishing) від 'поштового сервісу'\n"
        "4. Фішинговий лист від 'податкової' (терміновий платіж)\n"
        "5. Фішинг через LinkedIn (ділова пропозиція)\n"
        "6. Vishing-сценарій (телефонний дзвінок від 'техпідтримки')\n\n"
        "Для кожного прикладу надай:\n"
        "- **Тема/Заголовок** — що побачить жертва\n"
        "- **Тіло повідомлення** — текст листа/повідомлення\n"
        "- **Червоні прапорці** — ознаки фішингу (3-5 ознак)\n"
        "- **Рекомендація** — як правильно відреагувати\n\n"
        "Формат: markdown. Кожен приклад — окремий блок з заголовком."
    )


def _groq_chat_for_examples(messages: list[dict[str, str]]) -> str | None:
    """Викликає Groq API для генерації прикладів."""
    api_key = os.getenv("GROQ_API_KEY", "")
    if not api_key or api_key.startswith("встав"):
        logger.warning("Phishing: GROQ_API_KEY не налаштований")
        return None

    all_msgs = [{"role": "system", "content": EXAMPLES_SYSTEM_PROMPT}] + messages
    for attempt in range(3):
        try:
            res = requests.post(
                GROQ_API_URL,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": GROQ_MODEL, "messages": all_msgs, "max_tokens": 4096, "temperature": 0.7},
                timeout=90,
            )
            if res.status_code == 429:
                wait = min(15 * (attempt + 1), 45)
                logger.warning("Phishing AI: rate limit 429, retry %d/%d after %ds", attempt + 1, 3, wait)
                time.sleep(wait)
                continue
            res.raise_for_status()
            data = res.json()
            return data["choices"][0]["message"]["content"]
        except requests.Timeout:
            time.sleep(5 * (attempt + 1))
        except Exception as e:
            logger.error("Phishing AI: %s", e)
            return None
    return None


def _generate_examples():
    """Генерує приклади фішингових листів через AI."""
    logger.info("Phishing: генерація освітніх прикладів...")
    text = _groq_chat_for_examples([{"role": "user", "content": _build_examples_prompt()}])
    if text:
        with _examples_lock:
            _examples_cache["examples"] = {
                "content": text,
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "model": "GPT-OSS 120B (Groq)",
                "purpose": "educational",
            }
        logger.info("Phishing: приклади згенеровані")
    else:
        logger.error("Phishing: не вдалося згенерувати приклади")


def _examples_scheduler():
    """Фоновий потік: оновлює приклади о 10:00 KYIV."""
    logger.info("Phishing: планувальник прикладів запущений (оновлення о %d:00 KYIV)", EXAMPLES_HOUR_KYIV)
    while True:
        try:
            from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
            now = datetime.now(ZoneInfo("Europe/Kyiv"))
        except (ImportError, ZoneInfoNotFoundError):
            now = datetime.now(timezone.utc) + timedelta(hours=2)
        target = now.replace(hour=EXAMPLES_HOUR_KYIV, minute=0, second=0, microsecond=0)
        if now >= target:
            target += timedelta(days=1)
        wait = (target - now).total_seconds()
        logger.info("Phishing: наступна генерація через %.0f сек", wait)
        time.sleep(wait)
        try:
            _generate_examples()
        except Exception as e:
            logger.error("Phishing scheduler: %s", e)


def start_phishing_ai():
    """Запускає генерацію прикладів + планувальник."""
    thread = threading.Thread(target=_generate_examples, daemon=True)
    thread.start()
    scheduler = threading.Thread(target=_examples_scheduler, daemon=True)
    scheduler.start()


# ─── Ендпоїнти ────────────────────────────────────────────────────

@router.get("/stats")
def get_phishing_stats():
    """Статистика фішингу: за брендами, країнами, джерелами."""
    session = SessionLocal()
    try:
        rows = session.query(PhishingURLORM).all()
        if not rows:
            return {"total": 0, "by_brand": {}, "by_source": {}, "by_country": {}}

        by_brand: Counter[str] = Counter()
        by_source: Counter[str] = Counter()
        by_country: Counter[str] = Counter()
        by_domain: Counter[str] = Counter()
        verified_count = 0

        for r in rows:
            brand = r.target_brand or "Невідомий бренд"
            by_brand[brand] += 1
            by_source[r.source] += 1
            for c in (r.target_country or []):
                by_country[c] += 1
            if r.domain:
                by_domain[r.domain] += 1
            if r.verified in ("verified", "community", "auto"):
                verified_count += 1

        return {
            "total": len(rows),
            "verified": verified_count,
            "by_brand": dict(by_brand.most_common(20)),
            "by_source": dict(by_source.most_common()),
            "by_country": dict(by_country.most_common(15)),
            "top_domains": dict(by_domain.most_common(15)),
        }
    finally:
        session.close()


@router.get("/threats")
def get_phishing_threats(
    source: str | None = Query(None),
    brand: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    """Список фішингових URL з фільтрами."""
    session = SessionLocal()
    try:
        q = session.query(PhishingURLORM)
        if source:
            q = q.filter(PhishingURLORM.source == source)
        if brand:
            q = q.filter(PhishingURLORM.target_brand == brand)

        total = q.count()
        rows = (
            q.order_by(desc(PhishingURLORM.fetched_at))
            .offset(offset)
            .limit(limit)
            .all()
        )

        threats = [
            {
                "id": r.id,
                "external_id": r.external_id,
                "source": r.source,
                "url": r.url[:120] + "..." if len(r.url) > 120 else r.url,
                "full_url": r.url,
                "target_brand": r.target_brand,
                "domain": r.domain,
                "host": r.host,
                "verified": r.verified,
                "status": r.status,
                "target_country": r.target_country,
                "tags": r.tags,
                "first_seen": str(r.first_seen) if r.first_seen else None,
                "last_seen": str(r.last_seen) if r.last_seen else None,
            }
            for r in rows
        ]

        return {"total": total, "count": len(threats), "offset": offset, "threats": threats}
    finally:
        session.close()


@router.get("/examples")
def get_phishing_examples():
    """AI-згенеровані приклади фішингових листів для навчання."""
    with _examples_lock:
        data = _examples_cache.get("examples")
    if not data:
        raise HTTPException(status_code=503, detail="AI-приклади ще генеруються...")
    return data


@router.get("/examples/status")
def get_examples_status():
    """Статус генерації прикладів."""
    with _examples_lock:
        data = _examples_cache.get("examples")
    if not data:
        return {"status": "generating", "cached": False}
    return {
        "status": "ready",
        "cached": True,
        "generated_at": data.get("generated_at", ""),
        "next_refresh_hour": EXAMPLES_HOUR_KYIV,
        "timezone": "Europe/Kyiv",
    }


@router.post("/examples/refresh", dependencies=[Depends(require_admin)])
def refresh_examples():
    """Примусове оновлення прикладів (лише з адмін-ключем)."""
    _generate_examples()
    return {"status": "ok"}
