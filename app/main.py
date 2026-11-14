import json
import os
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv()

# Логування рівня INFO для фонових сервісів сервера (планувальник збору,
# кеш атрибуції). Без basicConfig root-логер мовчить на INFO (лише WARNING),
# і старт планувальника було б не видно в консолі uvicorn.
import logging  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

from fastapi import Depends, FastAPI, HTTPException, Query  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import String, case, cast, func, or_
from sqlalchemy.orm import Session

from app.db import CollectorStateORM, ThreatORM, get_session, init_db, now_utc
from app.timeline import build_timeline
from app.attack import search_groups
from app.explanation import generate_explanation
from app.scoring import compute_local_score, extract_vendor
from app.actors import (
    ACTORS,
)
from app.attribution_cache import get_attribution as get_attrib_cached
from app.models.threat import Threat
from app.models.ddos_snapshot import DdosSnapshotORM
from app.models.dataset_snapshot import DatasetSnapshotORM
from app.routers.ddos import router as ddos_router
from app.routers.datasets import router as datasets_router
from app.routers.ai_analysis import router as ai_router, start_background_generation
from app.routers.phishing import router as phishing_router, start_phishing_ai
from app.scheduler import start_collection_scheduler
from app.security import rate_limit_middleware

# Схеми OpenAPI (Swagger /docs) вимкнені за замовчуванням — публічний API
# не розкриває своїх ендпоїнтів. Увімкнути для налагодження: ENABLE_API_DOCS=1
_ENABLE_DOCS = os.getenv("ENABLE_API_DOCS", "").strip() == "1"

app = FastAPI(
    title="Cyber Sentinel API",
    description="Агрегатор загроз кібербезпеки — глобальний моніторинг з українським фокусом",
    version="0.1.0",
    docs_url="/docs" if _ENABLE_DOCS else None,
    redoc_url="/redoc" if _ENABLE_DOCS else None,
    openapi_url="/openapi.json" if _ENABLE_DOCS else None,
)

app.include_router(ddos_router)
app.include_router(datasets_router)
app.include_router(ai_router)
app.include_router(phishing_router)

# CORS: дозволяємо лише фронтенд-домени. За замовчуванням — локальна розробка;
# у проді передати CORS_ORIGINS (через кому), напр.
# CORS_ORIGINS="https://cybersentinel.example.com"
_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:3001,http://localhost:3000,http://127.0.0.1:3001,http://127.0.0.1:3000",
    ).split(",")
    if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Admin-Key"],
)

app.middleware("http")(rate_limit_middleware())


@app.on_event("startup")
def on_startup():
    init_db()
    start_background_generation()
    start_phishing_ai()
    start_collection_scheduler()


@app.get("/")
def root():
    return {
        "service": "Cyber Sentinel API",
        "docs": "/docs",
        "endpoints": ["/health", "/stats", "/sources", "/threats", "/threats/{id}", "/ddos-stats"],
    }


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/threat-actors")
def list_threat_actors(
    search: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=100),
):
    """Групи MITRE ATT&CK, їхні псевдоніми та відомі техніки."""
    try:
        return {"items": search_groups(search, limit)}
    except Exception as error:
        return {"items": [], "error": f"MITRE ATT&CK недоступний: {error}"}


def _actor_search_conditions(actor: str) -> list:
    """SQL-умови для пошуку згадок актора (назва + усі аліаси) у тексті.

    "APT28" матчує також Fancy Bear/Sofacy/UAC-0001 тощо; динамічні
    номери CERT-UA (UAC-XXXX) шукаються як є. Жодного збігу — порожній
    список (фільтр ігнорується, а не повертає 0 записів).
    """
    compiled = ACTORS.get(actor)
    if compiled is not None:
        tokens = [tok for tok in compiled.pattern.split("|") if tok]
    elif re.fullmatch(r"UAC-\d+[A-Za-z]?", actor.strip(), re.IGNORECASE):
        tokens = [actor.strip()]
    else:
        return []
    fields = (ThreatORM.title, ThreatORM.summary, cast(ThreatORM.tags, String))
    return [f.ilike(f"%{tok}%") for tok in tokens for f in fields]


@app.get("/threats")
def list_threats(
    db: Session = Depends(get_session),
    source: Optional[str] = None,
    severity: Optional[str] = None,
    region: Optional[str] = Query(default=None, description="UA | World"),
    type: Optional[str] = None,
    days: int = Query(default=30, le=1095),
    limit: int = Query(default=50, le=200),
    offset: int = 0,
    category: Optional[str] = Query(
        default=None,
        description="feed — новини/CVE/advisory без IOC; ioc — тільки індикатори",
    ),
    search: Optional[str] = Query(
        default=None,
        description="Повнотекстовий пошук по title, summary, source, cve_id, vendor та tags",
    ),
    sort: Optional[str] = Query(
        default=None,
        description="Сортування: published (за замовч.), severity",
    ),
    vendor: Optional[str] = Query(default=None, description="Точна назва вендора"),
    exploit_maturity: Optional[str] = Query(
        default=None,
        description="Weaponized | In the wild | PoC | Unknown",
    ),
    date_from: Optional[str] = Query(default=None, description="YYYY-MM-DD UTC (включно)"),
    date_to: Optional[str] = Query(default=None, description="YYYY-MM-DD UTC (включно)"),
    has_cve: bool = Query(default=False, description="Лише записи зі структурованим CVE-ID"),
    actor: Optional[str] = Query(
        default=None,
        description="Група-актор: ключ у ACTORS (напр. Gamaredon) або UAC-XXXX",
    ),
):
    q = db.query(ThreatORM).filter(
        ThreatORM.published >= now_utc() - timedelta(days=days)
    )
    if severity:
        q = q.filter(ThreatORM.severity == severity)
    if region:
        q = q.filter(ThreatORM.region == region)
    if type:
        q = q.filter(ThreatORM.type == type)
    if category == "feed":
        q = q.filter(ThreatORM.type != "IOC")
    elif category == "ioc":
        q = q.filter(ThreatORM.type == "IOC")
    if search:
        needle = f"%{search.strip()}%"
        q = q.filter(
            or_(
                ThreatORM.title.ilike(needle),
                ThreatORM.summary.ilike(needle),
                ThreatORM.source.ilike(needle),
                ThreatORM.cve_id.ilike(needle),
                ThreatORM.vendor.ilike(needle),
                cast(ThreatORM.tags, String).ilike(needle),
            )
        )
    if vendor:
        q = q.filter(ThreatORM.vendor == vendor)
    # source приймає і список через кому (мультивибір у UI)
    if source:
        names = [s.strip() for s in source.split(",") if s.strip()]
        if len(names) == 1:
            q = q.filter(ThreatORM.source == names[0])
        elif names:
            q = q.filter(ThreatORM.source.in_(names))
    if exploit_maturity:
        q = q.filter(ThreatORM.exploit_maturity == exploit_maturity)
    if date_from:
        try:
            q = q.filter(ThreatORM.published >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            # date_to включний: < наступний день 00:00
            q = q.filter(
                ThreatORM.published
                < datetime.fromisoformat(date_to) + timedelta(days=1)
            )
        except ValueError:
            pass
    if has_cve:
        q = q.filter(ThreatORM.cve_id.isnot(None), ThreatORM.cve_id != "")
    if actor:
        conds = _actor_search_conditions(actor)
        if conds:
            q = q.filter(or_(*conds))

    total = q.count()

    if sort == "severity":
        sev_order = case(
            (ThreatORM.severity == "Critical", 0),
            (ThreatORM.severity == "High", 1),
            (ThreatORM.severity == "Medium", 2),
            (ThreatORM.severity == "Low", 3),
            else_=4,
        )
        rows = q.order_by(sev_order, ThreatORM.published.desc()).offset(offset).limit(limit).all()
    else:
        rows = q.order_by(ThreatORM.published.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [_serialize(r) for r in rows],
    }


@app.get("/timeline/{cve_id}")
def get_timeline(cve_id: str, db: Session = Depends(get_session)):
    return build_timeline(db, cve_id)


@app.get("/threats/{threat_id}")
def get_threat(threat_id: int, db: Session = Depends(get_session)):
    row = db.query(ThreatORM).filter(ThreatORM.id == threat_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    data = _serialize(row)
    # Генеруємо пояснення та рекомендації
    threat_model = Threat(
        external_id=row.external_id or "",
        title=row.title,
        source=row.source,
        type=row.type,
        severity=row.severity,
        summary=row.summary,
        cve_id=row.cve_id,
        cvss_score=row.cvss_score,
        epss_score=row.epss_score,
        exploit_maturity=row.exploit_maturity,
        url=row.url,
        published=row.published or now_utc(),
    )
    data["explanation"] = generate_explanation(threat_model)
    return data


@app.get("/threats/{threat_id}/explain")
def explain_threat(threat_id: int, db: Session = Depends(get_session)):
    """Get explanation and recommendations for a specific threat."""
    row = db.query(ThreatORM).filter(ThreatORM.id == threat_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    threat_model = Threat(
        external_id=row.external_id or "",
        title=row.title,
        source=row.source,
        type=row.type,
        severity=row.severity,
        summary=row.summary,
        cve_id=row.cve_id,
        cvss_score=row.cvss_score,
        epss_score=row.epss_score,
        exploit_maturity=row.exploit_maturity,
        url=row.url,
        published=row.published or now_utc(),
    )
    return generate_explanation(threat_model)


@app.get("/stats")
def stats(db: Session = Depends(get_session), days: int = Query(default=365, le=365)):
    """Глобальна статистика (сайт більше не має регіональних режимів).

    ВАЖЛИВО: усі агрегати (total, critical, вендори, джерела, severity,
    by_country, by_actor) рахуються по ОДНІЙ множині записів — уся БД
    в межах вікна `days`. Раніше параметр region фільтрував базові
    метрики (region == "World" відкидав 269 UA-записів), тоді як
    by_country/by_actor завжди були глобальними — звідси десинхрон
    панелей (Canada=192 «понад» ліміт регіону). Тепер розбіжність
    неможлива за побудовою: сума top_vendors / by_source /
    severity_breakdown завжди дорівнює total_threats.
    Параметр region з API-сумісності приймається, але ігнорується.
    """
    last_24h = now_utc() - timedelta(hours=24)

    base = db.query(ThreatORM).filter(
        ThreatORM.published >= now_utc() - timedelta(days=days)
    )

    total = base.count()
    critical = base.filter(ThreatORM.severity == "Critical").count()
    # is_backfill виключаємо: технічний імпорт блоклістів (published = fallback
    # now() при імпорті) не є «новими загрозами за добу».
    new_24h = base.filter(
        ThreatORM.published >= last_24h,
        ThreatORM.is_backfill == False,  # noqa: E712 — SQL-фільтр
    ).count()
    active_exploits = base.filter(
        ThreatORM.exploit_maturity.in_(["Weaponized", "In the wild"])
    ).count()
    # Окрема метрика: кількість українських алертів (CERT-UA, RNBO тощо)
    # у межах того самого часового вікна. Завжди ≤ total.
    ua_alerts = base.filter(ThreatORM.region == "UA").count()
    high_epss = base.filter(ThreatORM.epss_score >= 0.5).count()

    # Глобально ризик рахуємо за EPSS; якщо EPSS ще не заповнений
    # (свіже наповнення БД) — fallback на High/Critical severity.
    if total > 0 and high_epss == 0:
        high_severity = base.filter(
            ThreatORM.severity.in_(["Critical", "High"])
        ).count()
        risk_value = high_severity
        risk_label = "High/Critical"
    else:
        risk_value = high_epss
        risk_label = "EPSS risk"

    # Топ вендорів — включаючи "Інше / не визначено" для решти записів.
    top_vendors = (
        base.filter(ThreatORM.vendor.isnot(None))
        .with_entities(ThreatORM.vendor, func.count(ThreatORM.id).label("count"))
        .group_by(ThreatORM.vendor)
        .order_by(func.count(ThreatORM.id).desc())
        .limit(8)
        .all()
    )
    top_vendors = list(top_vendors)
    # «Інше» = усе, що не потрапило в топ-8: записи без розпізнаного вендора
    # ПЛЮС вендори з 9-го місця й далі. Тоді сума топ-8 + «Інше» = total
    # (раніше хвостові вендори випадали з графіка і сума не збігалася).
    other_count = total - sum(c for _, c in top_vendors)
    if other_count > 0:
        top_vendors.append(("Інше / не визначено", other_count))

    by_source = (
        base.with_entities(ThreatORM.source, func.count(ThreatORM.id).label("count"))
        .group_by(ThreatORM.source)
        .order_by(func.count(ThreatORM.id).desc())
        .all()
    )

    severity_breakdown = [
        {
            "severity": s,
            "count": c,
            "pct": round(c / total * 100, 1) if total else 0.0,
        }
        for s, c in base.with_entities(
            ThreatORM.severity, func.count(ThreatORM.id).label("count")
        )
        .group_by(ThreatORM.severity)
        .all()
    ]

    exploit_breakdown = [
        {
            "maturity": m,
            "count": c,
            "pct": round(c / total * 100, 1) if total else 0.0,
        }
        for m, c in base.with_entities(
            ThreatORM.exploit_maturity, func.count(ThreatORM.id).label("count")
        )
        .group_by(ThreatORM.exploit_maturity)
        .all()
    ]

    # Країни — за даними про загрозу (геолокація IoC, країна-ціль),
    # а не за розташуванням організації-джерела. Агрегація в Python,
    # бо country — JSON-список.
    # ВАЖЛИВО: by_country використовує ВСІ записи (без фільтра region),
    # бо мапа завжди показує глобальну географію загроз.
    COUNTRY_KEYWORDS = {
        "ukraine": "Ukraine", "russia": "Russia", "iran": "Iran",
        "china": "China", "dprk": "DPRK", "north korea": "DPRK",
        "pakistan": "Pakistan", "india": "India", "belarus": "Belarus",
        "united states": "USA", "united kingdom": "United Kingdom",
        "germany": "Germany", "france": "France", "poland": "Poland",
        "israel": "Israel", "turkey": "Turkey", "japan": "Japan",
        "south korea": "South Korea", "canada": "Canada",
        "australia": "Australia", "brazil": "Brazil",
        "vietnam": "Vietnam", "syria": "Syria",
    }
    # ISO2 → повна назва (для MISP Galaxy та інших джерел з кодами)
    ISO2_TO_NAME = {
        "UA": "Ukraine", "RU": "Russia", "IR": "Iran", "CN": "China",
        "KP": "DPRK", "PK": "Pakistan", "IN": "India", "BY": "Belarus",
        "US": "USA", "GB": "United Kingdom", "DE": "Germany",
        "FR": "France", "PL": "Poland", "IL": "Israel", "TR": "Turkey",
        "JP": "Japan", "KR": "South Korea", "CA": "Canada",
        "AU": "Australia", "BR": "Brazil", "VN": "Vietnam", "SY": "Syria",
        "LB": "Lebanon", "NG": "Nigeria", "ID": "Indonesia",
        "TW": "Taiwan", "TH": "Thailand", "PH": "Philippines",
        "MY": "Malaysia", "KZ": "Kazakhstan", "IQ": "Iraq",
        "EG": "Egypt", "ZA": "South Africa", "KE": "Kenya",
        "MA": "Morocco", "TN": "Tunisia", "AE": "UAE",
        "SA": "Saudi Arabia", "RO": "Romania", "CZ": "Czechia",
        "IT": "Italy", "ES": "Spain", "NL": "Netherlands",
        "SE": "Sweden", "NO": "Norway", "FI": "Finland",
        "DK": "Denmark", "AT": "Austria", "CH": "Switzerland",
        "IE": "Ireland", "PT": "Portugal", "GR": "Greece",
        "HU": "Hungary", "BG": "Bulgaria", "HR": "Croatia",
        "SK": "Slovakia", "SI": "Slovenia", "LT": "Lithuania",
        "LV": "Latvia", "EE": "Estonia", "MD": "Moldova",
        "GE": "Georgia", "AM": "Armenia", "AZ": "Azerbaijan",
        "CU": "Cuba", "VE": "Venezuela", "LY": "Libya",
        "DZ": "Algeria", "SD": "Sudan", "ET": "Ethiopia",
        "MM": "Myanmar", "BD": "Bangladesh", "NP": "Nepal",
        "LK": "Sri Lanka",         "AF": "Afghanistan", "PS": "Palestine",
    }
    country_counter: dict[str, int] = {}
    rows = db.query(
        ThreatORM.country, ThreatORM.tags, ThreatORM.summary
    ).all()
    for (countries, tags, summary) in rows:
        found = set()
        # 1. З явного поля country (нормалізуємо ISO2 → назва)
        if countries:
            for name in countries:
                stripped = (name or "").strip()
                if not stripped:
                    continue
                if stripped in ISO2_TO_NAME:
                    found.add(ISO2_TO_NAME[stripped])
                elif len(stripped) <= 2 and stripped.upper() in ISO2_TO_NAME:
                    found.add(ISO2_TO_NAME[stripped.upper()])
                else:
                    # Повна назва може співпадати з алясом (напр. "United States"
                    # vs "USA", "North Korea" vs "DPRK") — нормалізуємо через
                    # COUNTRY_KEYWORDS, щоб одна країна не дублювалась у by_country.
                    norm = COUNTRY_KEYWORDS.get(stripped.lower())
                    found.add(norm if norm else stripped)
        # 2. З тегів
        if tags and not found:
            tags_lower = " ".join(str(t).lower() for t in tags)
            for kw, cn in COUNTRY_KEYWORDS.items():
                if kw in tags_lower:
                    found.add(cn)
        # 3. З summary (перші 300 символів)
        if summary and not found:
            s_lower = summary[:300].lower()
            for kw, cn in COUNTRY_KEYWORDS.items():
                if kw in s_lower:
                    found.add(cn)
        for name in found:
            country_counter[name] = country_counter.get(name, 0) + 1
    by_country = [
        {"country": name, "count": count}
        for name, count in sorted(country_counter.items(), key=lambda x: -x[1])
    ]

    # Відомі групи-актори: згадки у title+summary+tags, зв'язок до країн-цілей.
    # БЕЗ фільтра region (як і by_country): атрибуція акторів — глобальна
    # метрика; раніше region-фільтр (типово World) викидав усі UA-записи,
    # через що Gamaredon повністю зникав із Sankey.
    # Один спільний кешований прохід на всі три attribution-ендпоінти:
    # до оптимізації тут було 2 окремі сканування всієї БД (≈8 с CPU).
    attrib = get_attrib_cached(db)
    by_actor = attrib["actor_links"]

    # DDoS attack origins + targets з Cloudflare Radar для мапи
    ddos_origins: list[dict] = []
    ddos_targets: list[dict] = []
    try:
        ddos_rows = (
            db.query(DdosSnapshotORM)
            .filter(
                DdosSnapshotORM.scope == "global",
                DdosSnapshotORM.metric_type.in_([
                    "layer3_top_origins", "layer7_top_origins",
                    "layer3_top_targets", "layer7_top_targets",
                ])
            )
            .order_by(DdosSnapshotORM.captured_at.desc())
            .all()
        )
        seen_metrics: set[str] = set()
        for snap in ddos_rows:
            mt = snap.metric_type
            if mt in seen_metrics:
                continue
            seen_metrics.add(mt)
            payload = snap.payload if isinstance(snap.payload, dict) else json.loads(snap.payload)
            view = payload.get("view", {})
            items = view.get("items", [])
            layer = mt.split("_")[0]
            is_origin = "origins" in mt
            store = ddos_origins if is_origin else ddos_targets
            for item in items:
                code = item.get("code", "")
                country = item.get("country", "")
                value = float(item.get("value", 0))
                store.append({"country": country, "code": code, "value": value, "layer": layer})
    except Exception:
        pass

    last_update = db.query(func.max(ThreatORM.fetched_at)).scalar()

    return {
        "critical_threats": critical,
        "active_exploits": active_exploits,
        "new_cve_24h": new_24h,
        "ua_alerts": ua_alerts,
        "high_epss_risk": risk_value,
        "risk_label": risk_label,
        "top_vendors": [{"vendor": v, "count": c} for v, c in top_vendors],
        "by_source": [{"source": s, "count": c} for s, c in by_source],
        "by_country": by_country,
        "ddos_origins": ddos_origins,
        "ddos_targets": ddos_targets,
        "by_actor": by_actor,
        "by_sponsor": attrib["by_sponsor"],
        "severity_breakdown": severity_breakdown,
        "exploit_breakdown": exploit_breakdown,
        "total_threats": total,
        "last_update": last_update,
    }


@app.get("/stats/attribution")
def stats_attribution(db: Session = Depends(get_session)):
    """Універсальна атрибуція «actor → держава-спонсор».

    Плоска структура {country_sponsor: total_count}: для кожного детектованого
    актора беремо його attributed-country і підсумовуємо кількість зв'язків
    незалежно від країн-цілей. Сума всіх груп завжди дорівнює сумі всіх
    actor_links (невідомі актори — у кошику «Невідома держава»).
    """
    attrib = get_attrib_cached(db)
    by_sponsor = attrib["by_sponsor"]
    links_by_sponsor_total = sum(attrib["actor_links_by_sponsor"].values())
    return {
        "by_sponsor": by_sponsor,
        "total_records": sum(item["count"] for item in by_sponsor),
        "total_links": links_by_sponsor_total,
        "actor_links_total": sum(link["count"] for link in attrib["actor_links"]),
    }


@app.get("/stats/sponsor-infrastructure")
def stats_sponsor_infrastructure(db: Session = Depends(get_session)):
    """Третя лінза: «де фізично хоститься інфраструктура держави X».

    Пари (спонсор, країна IoC-геолокації) по записах, де детектовано актора
    з відомим спонсором. НЕ замінює ні by_country (географія всіх записів),
    ні /stats/attribution (атрибуція без географії). actor_links_by_sponsor
    додається для інваріанту/покриття: сума пар за спонсором <= його лінків,
    різниця — записи актора без заповненого поля country.
    """
    attrib = get_attrib_cached(db)
    pairs = attrib["infra_pairs"]
    return {
        "pairs": pairs,
        "actor_links_by_sponsor": attrib["actor_links_by_sponsor"],
        "total_records": sum(pair["count"] for pair in pairs),
    }


# Назви джерел у конфігу відрізняються від назв у БД — задаємо явні відповідності.
_SOURCE_ALIASES: dict[str, tuple[str, ...]] = {
    "ІМІ (Інститут масової інформації)": ("IMI",),
    "CERT-EU (ЄС) — Threat Intelligence": ("CERT-EU Threat Intel",),
    "CERT-EU (ЄС) — Security Advisories": ("CERT-EU Advisories",),
    "CCCS Canada (Canadian Centre for Cyber Security)": ("CCCS Canada",),
    "CCCS Canada News (Canadian Centre for Cyber Security)": ("CCCS Canada News",),
}


def _norm_source(name: str) -> str:
    """Приводить назву джерела до канонічного вигляду для порівняння."""
    return re.sub(r"[^a-zа-яіїєґ0-9]+", "", name.lower())


def _source_records(name: str, counts: dict[str, int]) -> int:
    """Кількість записів у БД для джерела з конфіга.

    Спершу шукаємо точний збіг нормалізованої назви — він має пріоритет,
    щоб не задвоювати лічильники між сусідніми картками. Якщо точного збігу
    немає (у конфігу назва ширша за назву в БД), сумуємо збіги за підрядком.
    """
    aliases = _SOURCE_ALIASES.get(name) or (name,)
    exact = 0
    for alias in aliases:
        norm_alias = _norm_source(alias)
        for db_name, count in counts.items():
            if _norm_source(db_name) == norm_alias:
                exact += count
    if exact:
        return exact

    total = 0
    for alias in aliases:
        norm_alias = _norm_source(alias)
        for db_name, count in counts.items():
            norm_db = _norm_source(db_name)
            if norm_alias in norm_db or norm_db in norm_alias:
                total += count
    return total


@app.get("/sources")
def list_sources(db: Session = Depends(get_session)):
    """Статус джерел: лічильники з БД, щоб фронтенд показував реальний стан.

    Для кожного джерела з конфіга data/sources_status.json повертаємо кількість
    записів у базі. Джерело активне, якщо лічильник більший за 0. Картки з
    прапорцем "info" (агрегатори, огляди) до розрахунку не входять. Якщо у
    картки задано "db_sources" — використовуємо саме ці назви з БД, інакше
    шукаємо збіги за назвою (з алиасами _SOURCE_ALIASES).
    """
    config_path = Path(__file__).resolve().parent.parent / "data" / "sources_status.json"
    try:
        config = json.loads(config_path.read_text("utf-8"))
    except Exception:
        return {"received": {}}

    counts = dict(
        db.query(ThreatORM.source, func.count(ThreatORM.id))
        .group_by(ThreatORM.source)
        .all()
    )

    # Для карток, що живуть в ОКРЕМІЙ таблиці (напр. ddos_snapshots),
    # лічимо за таблицею, вказаною в полі db_table.
    ddos_count = (
        db.query(func.count(DdosSnapshotORM.id))
        .filter(DdosSnapshotORM.captured_at >= now_utc() - timedelta(hours=24))
        .scalar()
    )

    from app.models.phishing import PhishingURLORM

    phishing_counts: dict[str, int] = dict(
        db.query(PhishingURLORM.source, func.count(PhishingURLORM.id))
        .group_by(PhishingURLORM.source)
        .all()
    )

    received: dict[str, int | None] = {}
    for section in config.values():
        if not isinstance(section, list):
            continue
        for item in section:
            if not isinstance(item, dict) or not item.get("name") or item.get("info"):
                continue
            table = item.get("db_table")
            if table == "ddos_snapshots":
                received[item["name"]] = ddos_count
                continue
            if table == "dataset_snapshots":
                received[item["name"]] = _dataset_records(item["name"], db)
                continue
            if table == "phishing_urls":
                received[item["name"]] = phishing_counts.get(item["name"], 0)
                continue
            override = item.get("db_sources")
            if override is not None:
                received[item["name"]] = sum(counts.get(name, 0) for name in override)
            else:
                received[item["name"]] = _source_records(item["name"], counts)

    groups: dict[str, list[str]] = {}
    for section, items in config.items():
        if not isinstance(items, list) or str(section).startswith("planned"):
            continue
        names = [
            i["name"]
            for i in items
            if isinstance(i, dict) and i.get("name") and not i.get("info")
        ]
        if names:
            groups[section] = names

    # Час останнього повного проходу колекторів (table collector_states).
    # Його показуємо в шапці дашборду поруч із лічильником джерел, щоб
    # «71 із 93» читалося разом із датою, на яку цей розрахунок актуальний.
    last_fetched = db.query(func.max(CollectorStateORM.last_fetched_at)).scalar()

    return {
        "received": received,
        "groups": groups,
        "last_fetched": last_fetched.isoformat() if last_fetched else None,
    }


@app.get("/vendors")
def list_vendors(db: Session = Depends(get_session)):
    """Довідник вендорів для фільтра «Бази записів» (top-60 за кількістю)."""
    rows = (
        db.query(ThreatORM.vendor, func.count(ThreatORM.id))
        .filter(ThreatORM.vendor.isnot(None), ThreatORM.vendor != "")
        .group_by(ThreatORM.vendor)
        .order_by(func.count(ThreatORM.id).desc())
        .limit(60)
        .all()
    )
    return [{"vendor": v, "count": c} for v, c in rows]


def _dataset_records(name: str, db: Session) -> int | None:
    """Кількість записів у датасеті з останнього знімка каталогу (None — невідомо)."""
    row = (
        db.query(DatasetSnapshotORM)
        .filter(DatasetSnapshotORM.dataset_name == name)
        .order_by(DatasetSnapshotORM.captured_at.desc())
        .first()
    )
    return row.record_count if row is not None else None


def _serialize(row: ThreatORM) -> dict:
    data = {
        "id": row.id,
        "external_id": row.external_id,
        "title": row.title,
        "source": row.source,
        "type": row.type,
        "severity": row.severity,
        "country": row.country,
        "region": row.region,
        "vendor": row.vendor,
        "products": row.products,
        "published": row.published,
        "tags": row.tags,
        "summary": row.summary,
        "url": row.url,
        "cve_id": row.cve_id,
        "cvss_score": row.cvss_score,
        "epss_score": row.epss_score,
        "exploit_maturity": row.exploit_maturity,
        "fetched_at": row.fetched_at,
    }
    data["local_score"] = compute_local_score(
        severity=row.severity,
        exploit_maturity=row.exploit_maturity,
        epss_score=row.epss_score,
        title=row.title,
        tags=row.tags,
    )
    data["vendor_local"] = extract_vendor(
        title=row.title,
        summary=row.summary,
        tags=row.tags,
        products=row.products,
    )
    return data
