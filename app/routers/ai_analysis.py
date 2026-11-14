"""
AI Analysis — автоматична генерація 5 аналізів при старті бекенду.
Оновлюється автоматично щодня о 09:00 (KYIV/EET).
Кешує результат в пам'яті. Не потребує зовнішніх API-викликів з фронтенду.
"""
import os
import re
import json
import logging
import threading
import time
from datetime import datetime, timezone, timedelta
from typing import Any

import requests
from fastapi import APIRouter, Depends, HTTPException

from app.security import require_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ai", tags=["ai"])

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "openai/gpt-oss-120b"

# ─── Кеш результатів ──────────────────────────────────────────────
_cache: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()
_last_refresh: str = ""  # ISO timestamp of last successful generation
DAILY_HOUR_KYIV = 9  # Оновлювати о 09:00 за київським часом (UTC+2/+3)

SYSTEM_PROMPT = (
    "Ти — аналітик кібербезпеки для Cyber Sentinel. "
    "Аналізуєш глобальний ландшафт кіберзагроз. "
    "Аналізуй географію загроз: країни-джерела атак, країни-цілі, розташування "
    "шкідливої інфраструктури. Відповідай стисло, конкретно, "
    "українською мовою. Використовуй markdown для форматування: "
    "заголовки, списки, жирний текст для ключових даних. "
    "СУВОРО не використовуй HTML-теги (<ul>, <li>, <ol>, <div>, <span> тощо). "
    "Тільки чистий markdown: # заголовки, - списки, **жирний**, 1. нумеровані списки, "
    "> цитати, --- горизонтальні лінії, | таблиці. "
    "Не використовуй емодзі. Пиши професійно, але зрозуміло для SOC-інженера."
)

# Мови, на які аналізи перекладаються на льоту ("uk" — оригінал, не перекладається)
TRANSLATION_LANGS = {
    "en": "English",
    "pl": "Polish",
    "fr": "French",
    "de": "German",
}

TRANSLATE_SYSTEM = (
    "You are a professional translator of cybersecurity analytical reports. "
    "Translate the user's markdown text into {target}. "
    "Preserve the markdown structure exactly: headings #/##/###, lists with -, "
    "numbered lists 1., **bold**, tables with |, quotes >, horizontal rules ---. "
    "Do not add new information and do not omit any data. "
    "Keep organization names (CERT-UA, SBU, UAC-XXXX), CVE identifiers, IP addresses, "
    "domains and file hashes untranslated. "
    "Reply with the translation ONLY - no introductions, no explanations."
)

# Ключі перекладів, що генеруються прямо зараз (захист від дубль-запитів)
_translating: set[str] = set()
_translating_lock = threading.Lock()
# Останні помилки перекладів (для діагностики через /ai/status)
_translation_errors: dict[str, str] = {}

UKRAINE_FOCUS_PROMPT = (
    "ФОКУС АНАЛІЗУ: Україна. Це окремий щоденний зріз загроз саме для "
    "українського сегмента (державні CERT-UA/СБУ/RNBO/SSSCIP джерела, "
    "UAC-* кластери, відомі групи: Gamaredon, Sandworm/APT44, APT28, "
    "Turla, Ghostwriter). Аналізуй загрози українським державним і "
    "критичним інфраструктурним об'єктам."
)


def _sanitize_markdown(text: str) -> str:
    """Очищує AI-відповідь від HTML-тегів, конвертує їх у чистий markdown."""

    def _ul_to_list(m: re.Match) -> str:
        inner = m.group(1)
        items = re.findall(r"<li>(.*?)</li>", inner, re.DOTALL)
        return "\n".join(f"- {re.sub(r'<[^>]+>', '', item).strip()}" for item in items)

    def _ol_to_list(m: re.Match) -> str:
        inner = m.group(1)
        items = re.findall(r"<li>(.*?)</li>", inner, re.DOTALL)
        return "\n".join(
            f"{i+1}. {re.sub(r'<[^>]+>', '', item).strip()}"
            for i, item in enumerate(items)
        )

    text = re.sub(r"<ul>(.*?)</ul>", _ul_to_list, text, flags=re.DOTALL)
    text = re.sub(r"<ol>(.*?)</ol>", _ol_to_list, text, flags=re.DOTALL)
    text = re.sub(r"<li>(.*?)</li>", r"- \1", text, flags=re.DOTALL)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _groq_chat(
    messages: list[dict[str, str]],
    max_tokens: int = 2048,
    system: str | None = None,
    extra_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    api_key = os.getenv("GROQ_API_KEY", "")
    if not api_key or api_key.startswith("встав"):
        raise RuntimeError("GROQ_API_KEY не налаштований")

    all_msgs = [{"role": "system", "content": system or SYSTEM_PROMPT}] + messages
    payload: dict[str, Any] = {
        "model": GROQ_MODEL, "messages": all_msgs, "max_tokens": max_tokens, "temperature": 0.3,
    }
    if extra_payload:
        payload.update(extra_payload)
    last_err = None
    for attempt in range(3):
        try:
            res = requests.post(
                GROQ_API_URL,
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
                timeout=90,
            )
            if res.status_code == 429:
                wait = min(10 * (attempt + 1), 30)
                logger.warning("AI: rate limit 429, retry %d/%d after %ds", attempt + 1, 3, wait)
                time.sleep(wait)
                last_err = RuntimeError(f"429 rate limit")
                continue
            res.raise_for_status()
            data = res.json()
            choice = data["choices"][0]
            usage = data.get("usage", {})
            analysis_text = _sanitize_markdown(choice["message"]["content"])
            return {
                "analysis": analysis_text,
                "tokens": {"prompt": usage.get("prompt_tokens", 0), "completion": usage.get("completion_tokens", 0), "total": usage.get("total_tokens", 0)},
                "model": "GPT-OSS 120B (Groq)",
                "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            }
        except requests.Timeout:
            wait = min(5 * (attempt + 1), 15)
            logger.warning("AI: timeout, retry %d/%d after %ds", attempt + 1, 3, wait)
            time.sleep(wait)
            last_err = RuntimeError("timeout")
        except requests.HTTPError as e:
            if hasattr(e, 'response') and e.response is not None and e.response.status_code == 429:
                wait = min(10 * (attempt + 1), 30)
                logger.warning("AI: rate limit 429, retry %d/%d after %ds", attempt + 1, 3, wait)
                time.sleep(wait)
                last_err = e
                continue
            raise
    raise RuntimeError(f"AI: 3 failed attempts, last: {last_err}")


def _get_threats_from_db() -> list[dict[str, Any]]:
    from app.db import get_session, ThreatORM
    from sqlalchemy import desc

    session = next(get_session())
    try:
        rows = session.query(ThreatORM).order_by(desc(ThreatORM.published)).limit(500).all()
        return [
            {
                "title": r.title,
                "severity": r.severity,
                "source": r.source,
                "cve_id": r.cve_id,
                "vendor": r.vendor,
                "exploit_maturity": r.exploit_maturity,
                "published": str(r.published) if r.published else "",
                "products": r.products or [],
                "summary": r.summary or "",
                "type": r.type or "",
                "country": r.country or [],
                "tags": r.tags or [],
            }
            for r in rows
        ]
    finally:
        session.close()


def _get_iocs_from_db(limit: int = 20) -> list[dict[str, Any]]:
    """Окремий запит для IOC-аналізу.

    Не можна фільтрувати їх із загального топ-500 за published: MISP Galaxy
    щогодини пише 1118 Advisory із published=now(), вони витісняють усі IOC
    (14089 шт.) з топ-500 — через що /ai/ioc роками «не знаходив дані».
    """
    from app.db import get_session, ThreatORM

    session = next(get_session())
    try:
        rows = (
            session.query(ThreatORM)
            .filter(ThreatORM.type == "IOC")
            .order_by(ThreatORM.fetched_at.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "title": r.title,
                "severity": r.severity,
                "source": r.source,
                "summary": r.summary or "",
                "type": r.type or "",
                "country": r.country or [],
                "tags": r.tags or [],
                "url": r.url or "",
            }
            for r in rows
        ]
    finally:
        session.close()


def _get_vendor_threats_from_db() -> list[dict[str, Any]]:
    from app.db import get_session, ThreatORM
    from sqlalchemy import desc

    session = next(get_session())
    try:
        rows = (
            session.query(ThreatORM)
            .filter(ThreatORM.vendor.isnot(None), ThreatORM.vendor != "")
            .order_by(desc(ThreatORM.published))
            .limit(200)
            .all()
        )
        return [
            {
                "title": r.title,
                "severity": r.severity,
                "source": r.source,
                "cve_id": r.cve_id,
                "vendor": r.vendor,
                "exploit_maturity": r.exploit_maturity,
                "published": str(r.published) if r.published else "",
                "products": r.products or [],
                "summary": r.summary or "",
                "type": r.type or "",
                "tags": r.tags or [],
            }
            for r in rows
        ]
    finally:
        session.close()


def _get_ddos_from_db() -> dict[str, Any]:
    from app.db import get_session
    from app.models.ddos_snapshot import DdosSnapshotORM

    session = next(get_session())
    try:
        row = session.query(DdosSnapshotORM).order_by(DdosSnapshotORM.captured_at.desc()).first()
        if not row:
            return {}
        return json.loads(row.payload) if isinstance(row.payload, str) else row.payload
    except Exception:
        return {}
    finally:
        session.close()


# ─── Промпти для кожного аналізу ──────────────────────────────────

_UA_SOURCES = {"CERT-UA", "RNBO", "СБУ", "SSU", "SSSCIP", "ДержСЦЗ", "Держспецзв'язку"}
_UA_TEXT_MARKERS = (
    "україн", "ukraine", "ukrainian", "uac-", "київ", "kyiv",
    "gamaredon", "sandworm", "armageddon",
)


def _filter_ukraine_threats(threats: list[dict]) -> list[dict]:
    """Записи, релевантні українському сегменту: країна Ukraine,
    державні UA-джерела, теги UAC-*, або маркери в title/summary."""
    result = []
    for t in threats:
        countries = t.get("country") or []
        tags = [str(x) for x in (t.get("tags") or [])]
        text = f"{t.get('title', '')} {t.get('summary', '')}".lower()
        if (
            "Ukraine" in countries
            or t.get("source") in _UA_SOURCES
            or any(tag.upper().startswith("UAC-") for tag in tags)
            or any(marker in text for marker in _UA_TEXT_MARKERS)
        ):
            result.append(t)
    return result


def _build_ukraine_prompt(uathreats: list[dict]) -> str:
    items = "\n".join(
        f"{i+1}. [{t['severity']}] {t['title']} | {t['source']} | "
        f"CVE: {t.get('cve_id') or '—'} | Vendor: {t.get('vendor') or '—'} | "
        f"Теги: {', '.join(t.get('tags', [])[:4]) or '—'}"
        for i, t in enumerate(uathreats[:30])
    )

    sources_all: dict[str, int] = {}
    uac_clusters: dict[str, int] = {}
    for t in uathreats:
        s = t.get("source", "—")
        sources_all[s] = sources_all.get(s, 0) + 1
        for tag in t.get("tags", []):
            tag_u = str(tag).upper()
            if tag_u.startswith("UAC-"):
                uac_clusters[tag_u] = uac_clusters.get(tag_u, 0) + 1
    top_sources = sorted(sources_all.items(), key=lambda x: -x[1])[:10]
    sources_block = "\n".join(f"  {s}: {n}" for s, n in top_sources)
    top_uac = sorted(uac_clusters.items(), key=lambda x: -x[1])[:10]
    uac_block = (
        "\n".join(f"  {c}: {n} згадок" for c, n in top_uac)
        if top_uac
        else "  (UAC-кластери не згадані в останніх записах)"
    )

    return (
        f"{UKRAINE_FOCUS_PROMPT}\n\n"
        f"Дані: {len(uathreats)} записів, релевантних Україні.\n\n"
        f"Записи за джерелами:\n{sources_block}\n\n"
        f"Активність UAC-кластерів (CERT-UA таксономія):\n{uac_block}\n\n"
        f"Останні записи:\n\n{items}\n\n"
        "Зроби стислий щоденний аналіз загроз для України:\n"
        "1. **ТОП-5 загроз для України** — що найнебезпечніше саме зараз\n"
        "2. **Активність APT/UAC-груп** — які кластери активні, чи є нові кампанії\n"
        "3. **Цілі та сектор** — державні органи, критична інфраструктура, логістика\n"
        "4. **Пріоритетні дії** — конкретні кроки для українського SOC/CSIRT\n"
        "5. **Геополітичний контекст** — зв'язок кампаній з подіями війни"
    )

def _build_digest_prompt(threats: list[dict]) -> str:
    items = "\n".join(
        f"{i+1}. [{t['severity']}] {t['title']} | {t['source']} | CVE: {t.get('cve_id') or '—'} | "
        f"Vendor: {t.get('vendor') or '—'} | Status: {t['exploit_maturity']} | "
        f"Країни: {', '.join(t.get('country', [])[:3]) or '—'}"
        for i, t in enumerate(threats[:30])
    )

    countries_all = {}
    for t in threats:
        for c in t.get("country", []):
            countries_all[c] = countries_all.get(c, 0) + 1
    top_countries = sorted(countries_all.items(), key=lambda x: -x[1])[:15]
    geo_block = "\n".join(f"  {c}: {n} загроз" for c, n in top_countries) if top_countries else "  (геодані відсутні)"

    sources_all = {}
    for t in threats:
        s = t.get("source", "—")
        sources_all[s] = sources_all.get(s, 0) + 1
    top_sources = sorted(sources_all.items(), key=lambda x: -x[1])[:10]
    sources_block = "\n".join(f"  {s}: {n}" for s, n in top_sources)

    return (
        f"Дані: {len(threats)} загроз з бази.\n\n"
        f"Загрози за країнами:\n{geo_block}\n\n"
        f"Загрози за джерелами:\n{sources_block}\n\n"
        f"Топ-30 загроз:\n\n{items}\n\n"
        "Зроби стислий глобальний дайджест:\n"
        "1. **ТОП-5 найважливіших загроз** — чому саме вони найнебезпечніші\n"
        "2. **Географія загроз** — які країни найбільше атакуються, де шкідлива інфраструктура\n"
        "3. **Загальний тренд** — що відбувається на світовому ландшафті загроз\n"
        "4. **Пріоритетні дії** — що робити SOC-команді зараз\n"
        "5. **Геополітичний контекст** — зв'язок з поточними подіями у світі"
    )


def _build_ddos_prompt(ddos: dict) -> str:
    parts = [f"Регіон: {ddos.get('region', 'global')}"]
    if ddos.get("top_targets"):
        parts.append("Топ країн-цілей DDoS:\n" + "\n".join(
            f"  {i+1}. {t['country']}: {t['value']}%" for i, t in enumerate(ddos["top_targets"][:15])
        ))
    if ddos.get("top_origins"):
        parts.append("Топ країн-джерел атак (звідки атакують):\n" + "\n".join(
            f"  {i+1}. {t['country']}: {t['value']}%" for i, t in enumerate(ddos["top_origins"][:15])
        ))
    if ddos.get("vectors"):
        parts.append("Вектори атак:\n" + "\n".join(
            f"  {i+1}. {v['name']}: {v['value']}%" for i, v in enumerate(ddos["vectors"][:10])
        ))
    if ddos.get("timeseries"):
        ts = ddos["timeseries"]
        if isinstance(ts, list) and len(ts) > 0:
            vals = [t.get("value", 0) for t in ts if isinstance(t, dict)]
            if vals:
                parts.append(f"Динаміка за період: мін={min(vals)}, макс={max(vals)}, середнє={sum(vals)/len(vals):.1f}")
    return (
        "Глобальний аналіз DDoS-трафіку (дані Cloudflare Radar):\n\n" + "\n".join(parts) + "\n\n"
        "Зроби аналіз:\n"
        "1. **Картина атак** — що відбувається, основні вектори, глобальні тренди\n"
        "2. **Географія** — хто атакує (джерела), хто цілі, які регіони під тиском\n"
        "3. **Хто атакує** — ймовірні джерела (ботнети, державні актори, хактивісти)\n"
        "4. **Протоколи** — які протоколи/порти використовуються\n"
        "5. **Захист** — конкретні рекомендації для захисту інфраструктури"
    )


def _build_ioc_prompt(iocs: list[dict]) -> str:
    items = "\n".join(
        f"{i+1}. [{ioc['severity']}] {ioc['title'][:80]} | Source: {ioc.get('source', '—')} | "
        f"Tags: {', '.join(ioc.get('tags', [])[:3])} | "
        f"Країни: {', '.join(ioc.get('country', [])[:3]) or '—'} | "
        f"Summary: {ioc.get('summary', '')[:100]}"
        for i, ioc in enumerate(iocs[:20])
    )

    countries_all = {}
    for t in iocs:
        for c in t.get("country", []):
            countries_all[c] = countries_all.get(c, 0) + 1
    top_countries = sorted(countries_all.items(), key=lambda x: -x[1])[:10]
    geo_block = "\n".join(f"  {c}: {n}" for c, n in top_countries) if top_countries else "  (геодані відсутні)"

    return (
        f"Аналіз IOC ({len(iocs)} індикаторів):\n\n"
        f"Географія IOC:\n{geo_block}\n\n"
        f"Деталі:\n\n{items}\n\n"
        "Зроби аналіз:\n"
        "1. **Хто за атакою** — APT-групи або хакерські колективи\n"
        "2. **Географія** — звідки походять IOC, які країни цілі\n"
        "3. **Техніка** — TTPs (MITRE ATT&CK)\n"
        "4. **Зв'язки** — з відомими кампаніями\n"
        "5. **Рекомендовані сигнатури** — для IDS/IPS (Suricata/Snort)\n"
        "6. **Контрзаходи** — що робити в мережі"
    )


def _build_vendor_prompt(vendor: str, threats: list[dict]) -> str:
    items = "\n".join(
        f"{i+1}. [{t['severity']}] {t['title']} | CVE: {t.get('cve_id') or '—'} | "
        f"Status: {t['exploit_maturity']} | Країни: {', '.join(t.get('country', [])[:3]) or '—'}"
        for i, t in enumerate(threats[:15])
    )

    countries_all = {}
    for t in threats:
        for c in t.get("country", []):
            countries_all[c] = countries_all.get(c, 0) + 1
    top_countries = sorted(countries_all.items(), key=lambda x: -x[1])[:10]
    geo_block = "\n".join(f"  {c}: {n}" for c, n in top_countries) if top_countries else "  (геодані відсутні)"

    return (
        f"Аналіз постачальника: {vendor}\n"
        f"Кількість вразливостей: {len(threats)}\n\n"
        f"Географія вразливостей:\n{geo_block}\n\n"
        f"Деталі:\n\n{items}\n\n"
        "Зроби аналіз:\n"
        "1. **Оцінка ризику** — наскільки критична ситуація\n"
        "2. **Географія поширення** — які країни/сектори під загрозою\n"
        "3. **Пріоритет патчування** — що ставити першим\n"
        "4. **Мітігарінг** — тимчасові заходи\n"
        "5. **Альтернативи** — чи варто мігрувати"
    )


# ─── Генерація аналізів ───────────────────────────────────────────

REQUIRED_KINDS = ("digest", "ddos", "ioc", "vendor", "ukraine")

# Повторна спроба для видів, які НЕ закешувалися (Groq 429 / таймаут).
# Дефолт 15 хв; 0 — вимкнути. .env не редагується — лише читання з дефолтом.
try:
    _RETRY_MIN = max(1, int(os.getenv("AI_RETRY_MINUTES", "15") or "15"))
except ValueError:
    _RETRY_MIN = 15


def _generate_kind(kind: str, threats: list[dict[str, Any]]) -> None:
    """Генерує ОДИН аналіз і кладе його в кеш.

    Помилка окремого виду (429 rate limit, таймаут) не зупиняє решту:
    недостаючий вид підхопить _retry_missing_scheduler(). Раніше падіння
    одного виду (напр. ioc при 429 Groq) лишало /ai/ioc у 503 до наступного
    09:00 Kyiv чи до перезапуску сервера.
    """
    try:
        if kind == "digest":
            result = _groq_chat([{"role": "user", "content": _build_digest_prompt(threats)}])
            with _lock:
                _cache["digest"] = result
        elif kind == "ddos":
            ddos = _get_ddos_from_db()
            if not ddos:
                logger.warning("AI: дані DDoS у базі відсутні — %s пропущено", kind)
                return
            result = _groq_chat([{"role": "user", "content": _build_ddos_prompt(ddos)}])
            with _lock:
                _cache["ddos"] = result
        elif kind == "ioc":
            iocs = _get_iocs_from_db()
            if not iocs:
                logger.warning("AI: IOC у базі відсутні — %s пропущено", kind)
                return
            result = _groq_chat([{"role": "user", "content": _build_ioc_prompt(iocs)}])
            with _lock:
                _cache["ioc"] = result
        elif kind == "vendor":
            vendor_threats_all = _get_vendor_threats_from_db()
            if not vendor_threats_all:
                logger.warning("AI: даних про вендорів немає — %s пропущено", kind)
                return
            vendor_counts: dict[str, int] = {}
            for t in vendor_threats_all:
                v = t.get("vendor")
                if v:
                    vendor_counts[v] = vendor_counts.get(v, 0) + 1
            if not vendor_counts:
                logger.warning("AI: вендори не визначені — %s пропущено", kind)
                return
            top_vendor = max(vendor_counts, key=vendor_counts.get)  # type: ignore
            vendor_threats = [t for t in vendor_threats_all if t.get("vendor") == top_vendor][:15]
            result = _groq_chat([{"role": "user", "content": _build_vendor_prompt(top_vendor, vendor_threats)}])
            with _lock:
                _cache["vendor"] = result
                _cache["vendor"]["vendor_name"] = top_vendor
        elif kind == "ukraine":
            uathreats = _filter_ukraine_threats(threats)
            if not uathreats:
                logger.warning("AI: українські загрози не знайдені — %s пропущено", kind)
                return
            result = _groq_chat([{"role": "user", "content": _build_ukraine_prompt(uathreats)}])
            with _lock:
                _cache["ukraine"] = result
        else:
            return
        logger.info("AI: %s готовий (%d токенів)", kind, result["tokens"]["total"])
    except Exception as e:
        logger.error("AI: помилка %s: %s", kind, e)
    finally:
        time.sleep(3)  # rate-limit protection — і після 429 теж


def _drop_translations(kinds) -> None:
    """Скидає закешовані переклади вказаних видів — вони перегенеруються на льоту."""
    with _lock:
        for k in [k for k in _cache if any(k.startswith(f"{kind}:") for kind in kinds)]:
            del _cache[k]


def _missing_kinds() -> list[str]:
    with _lock:
        return [k for k in REQUIRED_KINDS if k not in _cache]


def generate_all_analyses():
    """Генерує всі AI-аналізи з даних бази та кешує їх."""
    global _last_refresh
    logger.info("AI: початок генерації аналізів...")
    threats = _get_threats_from_db()
    if not threats:
        logger.warning("AI: загрози не знайдені в базі")
        return
    for kind in REQUIRED_KINDS:
        _generate_kind(kind, threats)
    logger.info("AI: генерація завершена. Закешовано: %s", list(_cache.keys()))
    _drop_translations(REQUIRED_KINDS)
    _last_refresh = time.strftime("%Y-%m-%dT%H:%M:%S")


def _retry_missing_scheduler():
    """Фон: якщо після 429/таймаута якийсь із 5 аналізів не закешувався —
    повторює САМЕ його (а не всі), доки не з'явиться в кеші."""
    global _last_refresh
    logger.info("AI: ретрай-планувальник запущений (кожні %d хв для %s)",
                _RETRY_MIN, ", ".join(_missing_kinds()) or "нічого")
    while True:
        time.sleep(_RETRY_MIN * 60)
        missing = _missing_kinds()
        if not missing:
            continue
        logger.warning("AI: не згенеровано [%s] — повторна спроба", ", ".join(missing))
        threats = _get_threats_from_db()
        if not threats:
            continue
        done = []
        for kind in missing:
            _generate_kind(kind, threats)
            with _lock:
                ok = kind in _cache
            if ok:
                done.append(kind)
        if done:
            logger.info("AI: після ретраю закешовано: %s", ", ".join(done))
            _drop_translations(done)
            _last_refresh = time.strftime("%Y-%m-%dT%H:%M:%S")


def _kyiv_now() -> datetime:
    """Поточний час у київському часовому поясі (EET/EEST)."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Europe/Kyiv"))
    except (ImportError, Exception):
        # Fallback: Python < 3.9 або відсутній tzdata — UTC+2 (EET) взимку,
        # UTC+3 (EEST) літом (останній неділя березня — перша неділя жовтня).
        utc = datetime.now(timezone.utc)
        month = utc.month
        if month == 3 or month == 10:
            # Остання неділя березня/жовтня — переходу відбуваються о 03:00 UTC
            day_of_month = utc.day
            weekday = utc.weekday()  # Monday = 0
            days_until_sunday = (6 - weekday) % 7
            last_sunday = day_of_month + days_until_sunday
            if utc.day < last_sunday - 6:
                return utc + timedelta(hours=2)
            elif utc.day > last_sunday:
                return utc + timedelta(hours=3)
            return utc + timedelta(hours=2)
        elif 4 <= month <= 9:
            return utc + timedelta(hours=3)  # EEST
        else:
            return utc + timedelta(hours=2)  # EET


def _daily_scheduler():
    """Фоновий потік: генерує аналіз щодня о 09:00 київського часу."""
    logger.info("AI: щоденний планувальник запущений (оновлення о %d:00 KYIV)", DAILY_HOUR_KYIV)
    while True:
        now = _kyiv_now()
        # Рахуємо час до наступного 09:00
        target = now.replace(hour=DAILY_HOUR_KYIV, minute=0, second=0, microsecond=0)
        if now >= target:
            target += timedelta(days=1)
        wait_seconds = (target - now).total_seconds()
        logger.info("AI: наступне оновлення через %.0f сек (%s)", wait_seconds, target.strftime("%Y-%m-%d %H:%M KYIV"))
        time.sleep(wait_seconds)
        # Генеруємо
        logger.info("AI: запуск запланованої генерації о 09:00 KYIV")
        try:
            generate_all_analyses()
        except Exception as e:
            logger.error("AI: помилка планованої генерації: %s", e)


def start_background_generation():
    """Запускає генерацію при старті + щоденний планувальник + ретрай недостаючих."""
    # Перша генерація одразу
    thread = threading.Thread(target=generate_all_analyses, daemon=True)
    thread.start()
    # Щоденний планувальник
    scheduler = threading.Thread(target=_daily_scheduler, daemon=True)
    scheduler.start()
    # Ретрай видів, що впали через 429/таймаут (інакше /ai/ioc у 503 до 09:00)
    retry = threading.Thread(target=_retry_missing_scheduler, daemon=True)
    retry.start()


# ─── Ендпоїнти ────────────────────────────────────────────────────

def _translate_kind(kind: str, lang: str) -> None:
    """Перекладає закешований аналіз мовою lang і кладе результат у кеш."""
    key = f"{kind}:{lang}"
    try:
        with _lock:
            base = _cache.get(kind)
        if not base:
            return
        result = _groq_chat(
            [{"role": "user", "content": base["analysis"]}],
            max_tokens=4096,
            system=TRANSLATE_SYSTEM.format(target=TRANSLATION_LANGS[lang]),
            # reasoning моделі (gpt-oss) можуть з'їсти весь ліміт на роздуми —
            # для перекладу досить низького effort
            extra_payload={"reasoning_effort": "low"},
        )
        if not result.get("analysis"):
            raise RuntimeError("порожня відповідь від моделі")
        translated = dict(result)
        if "vendor_name" in base:
            translated["vendor_name"] = base["vendor_name"]
        with _lock:
            _cache[key] = translated
        logger.info("AI: %s готовий (%d токенів)", key, result["tokens"]["total"])
    except Exception as e:
        logger.error("AI: помилка перекладу %s: %s", key, e)
        with _translating_lock:
            _translation_errors[key] = str(e)[:300]
    finally:
        with _translating_lock:
            _translating.discard(key)


def _start_translation(kind: str, lang: str) -> None:
    """Запускає фоновий переклад (один потік на пару kind:lang)."""
    key = f"{kind}:{lang}"
    with _translating_lock:
        if key in _translating:
            return
        _translating.add(key)
    threading.Thread(target=_translate_kind, args=(kind, lang), daemon=True).start()


def _get_analysis(kind: str, lang: str, pending_detail: str) -> dict[str, Any]:
    """Віддає аналіз мовою lang; за промахом запускає фоновий переклад базової версії."""
    lang = (lang or "uk").lower()
    cache_key = f"{kind}:{lang}" if lang in TRANSLATION_LANGS else kind
    with _lock:
        data = _cache.get(cache_key)
    if data:
        return data
    if lang in TRANSLATION_LANGS:
        with _lock:
            base = _cache.get(kind)
        if base:
            _start_translation(kind, lang)
            raise HTTPException(
                status_code=503,
                detail={"status": "generating", "kind": kind, "lang": lang},
            )
    raise HTTPException(status_code=503, detail=pending_detail)


@router.get("/digest")
def get_digest(lang: str = "uk"):
    return _get_analysis("digest", lang, "AI-аналіз ще генерується...")


@router.get("/ddos")
def get_ddos_analysis(lang: str = "uk"):
    return _get_analysis("ddos", lang, "AI-аналіз DDoS ще генерується...")


@router.get("/ioc")
def get_ioc_analysis(lang: str = "uk"):
    return _get_analysis("ioc", lang, "AI-аналіз IOC ще генерується...")


@router.get("/vendor")
def get_vendor_analysis(lang: str = "uk"):
    return _get_analysis("vendor", lang, "AI-аналіз вендора ще генерується...")


@router.get("/ukraine")
def get_ukraine_analysis(lang: str = "uk"):
    return _get_analysis("ukraine", lang, "AI-аналіз України ще генерується...")


@router.get("/status")
def get_status():
    with _lock:
        cached = list(_cache.keys())
    now = _kyiv_now()
    target = now.replace(hour=DAILY_HOUR_KYIV, minute=0, second=0, microsecond=0)
    if now >= target:
        target += timedelta(days=1)
    next_refresh_h = (target - now).total_seconds() / 3600
    return {
        "cached": cached,
        "count": len(cached),
        "last_refresh": _last_refresh,
        "next_refresh_hour": DAILY_HOUR_KYIV,
        "next_refresh_in_hours": round(next_refresh_h, 1),
        "timezone": "Europe/Kyiv (UTC+2/+3)",
        "translating": sorted(_translating),
        "translation_errors": dict(_translation_errors),
    }


@router.post("/refresh", dependencies=[Depends(require_admin)])
def refresh_analyses():
    """Примусове оновлення всіх аналізів (лише з адмін-ключем)."""
    generate_all_analyses()
    return {"status": "ok", "cached": list(_cache.keys())}
