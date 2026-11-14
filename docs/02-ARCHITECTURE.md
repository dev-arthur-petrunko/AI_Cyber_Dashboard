# 02 · АРХИТЕКТУРА — CYBER SENTINEL

> Полное описание системы: backend, сбор данных, схема БД, API, фронтенд-оболочка и агент.
> (Третий файл — `03-RUNBOOK.md`: запуск, конфигурация, диагностика.)

---

## 1. Общая схема

```
┌─────────────────────────────────────────────────────────────┐
│              FRONTEND  Next.js 14 :3001                     │
│  TopNav + AdminShell · 8 страниц · ч/б дизайн · агент      │
└──────────────────────────┬──────────────────────────────────┘
                           │ fetch + CORS allow-list
┌──────────────────────────▼──────────────────────────────────┐
│              BACKEND  FastAPI :8010  (app/)                 │
│  main.py — роуты ddos/datasets/ai/phishing + middleware     │
│  scheduler.py — фон: раз в час child-process app.pipeline   │
│  ai_analysis.py — 5 AI-видов + ретрай каждые 15 мин          │
└──────────────────────────┬──────────────────────────────────┘
                           │ SQLAlchemy
┌──────────────────────────▼──────────────────────────────────┐
│   SQLite data/threats.db: threats · collector_states ·      │
│   ddos_snapshots · dataset_snapshots · phishing_urls        │
└─────────────────────────────────────────────────────────────┘
```

Принцип отказоустойчивости: каждый коллектор в try/except — упавший источник логируется и
пропускается, пайплайн не падает.

---

## 2. Стек

| Слой | Технологии |
|---|---|
| API | FastAPI, SQLAlchemy, python-dotenv |
| БД | SQLite (`data/threats.db`); любой `DATABASE_URL` (PostgreSQL/Neon) |
| Сбор | requests, RSS/HTML/XML/JSON-скраперы, ~40 коллекторов |
| AI | Groq API (`GROQ_API_KEY`) |
| Frontend | Next.js 14.2.5, React 18, TypeScript 5.5, Tailwind 3.4 |
| Графика | recharts 2.12, react-svg-worldmap, d3-geo, topojson-client |
| Шрифты | Google Fonts: Inter + JetBrains Mono |

---

## 3. Структура каталогов

```
├── .env               # ключи (git-ignored, НИКОГДА не пушить)
├── .env.example       # шаблон без значений (единственное, что попадает в git)
├── data/              # threats.db + sources_status.json + curated_threats.json
├── docs/              # ровно 3 файла: 01-DESIGN · 02-ARCHITECTURE · 03-RUNBOOK (+ screenshots/)
├── app/               # FastAPI backend
│   ├── main.py        # точка входа, роуты /threats /stats /sources ...
│   ├── scheduler.py   # тик 300 с, интервал от конца прогона
│   ├── pipeline.py    # оркестратор ~40 коллекторов
│   ├── db.py          # engine (pool_pre_ping), ThreatORM, CollectorStateORM
│   ├── models/        # threat, ddos_snapshot, dataset_snapshot, phishing
│   ├── collectors/    # NVD, CISA KEV, CERT-UA, OFAC, ThreatFox, VT, Cloudflare ...
│   ├── routers/       # ddos, datasets, ai_analysis, phishing
│   ├── storage/       # bulk_upsert, phishing_storage
│   ├── scoring.py     # infer_severity(), compute_local_score(), CRITICAL_KEYWORDS
│   └── enrichment.py, explanation.py, attribution_cache.py, timeline.py, security.py
├── frontend/
│   ├── app/           # страницы: /, /ai, /ddos, /phishing, /records, /sources, /updates, /support
│   ├── components/    # TopNav, AdminShell, StatCard, ThreatTable, DdosMap, ThreatMap,
│   │                  # ActorSankey, SponsorChart, VendorChart, ParticleField, ai/, agent/
│   ├── components/agent/  # Agent, AgentProvider, agentMachine, useAgentMood,
│   │                      # AgentLinkLayer, AgentRoamer
│   └── lib/           # api, types, i18n, dates(parseApiDate), color, countries, worldGeo
├── database/          # документация схем БД (справочник)
├── migrations/        # Alembic
└── README.md          # витрина для GitHub (не «докс-файл проекта»)
```

---

## 4. Планировщик (`app/scheduler.py`)

Daemon-поток внутри uvicorn; запускает `python -m app.pipeline` **дочерним процессом**
(GIL не блокирует API, логи пипетятся). Интервал `COLLECT_INTERVAL_HOURS` (default **1**),
тик **300 с**; `next_due` пересчитывается **после** прогона → параллельных запусков нет.
Выключение: `ENABLE_COLLECT_SCHEDULER=0`. Первый запуск — через интервал после старта.

---

## 5. Пайплайн (`app/pipeline.py`)

1. `init_db()` → 2. цикл по `COLLECTORS` (~40): `fetch()` → `bulk_upsert(batch=500)` →
   `update_last_fetched()` (инкремент); ошибка → rollback + лог, **продолжаем**;
3. `enrich_epss`; 4. Cloudflare Radar DDoS; 5. фишинг (PhishTank/OpenPhish/PhishStats);
6. каталог ML-датасетов; 7. `notify_n8n` (webhook в Telegram, если задан).

Группы коллекторов: Украина (CERT-UA, RNBO, SSU, SSSCIP, Кіберполіція, Telegram),
уязвимости (NVD, CISA KEV, GitHub PoC/Advisories, Exploit-DB), IOC (ThreatFox, URLhaus,
MalwareBazaar, VirusTotal, OTX, blocklists), CERT/новини (NCSC, CCCS/CERT-EU/Polska, vendor RSS),
APT (MITRE ATT&CK, MISP Galaxy), санкции (OFAC SDN XML), утечки (HIBP), Shodan, Cloudflare.

---

## 6. Схема БД

### `threats` (ThreatORM)
`id PK · external_id · source · title · type(feed|IOC) · severity · country(JSON) ·
region(UA|World) · vendor · products(JSON) · cvss_score · epss_score ·
exploit_maturity(PoC|Weaponized|In the wild|Unknown) · published · fetched_at ·
is_backfill · tags(JSON) · summary · url · cve_id · poc_published · added_to_kev`
— `UNIQUE(source, external_id)`.

### Прочие
`collector_states(source PK, last_fetched_at)` · `ddos_snapshots(scope, metric_type, payload, captured_at)` ·
`dataset_snapshots(dataset_name, record_count)` · `phishing_urls(source, url, verified, ...)`.

Даты — naive UTC (`now_utc()`); engine: `pool_pre_ping=True`, `pool_recycle=300`.

---

## 7. API

| Роут | Описание |
|---|---|
| `GET /health` | `{"status":"ok"}` |
| `GET /threats` | фильтры: source, severity, region, type, days, category(feed/ioc), search, sort, vendor, exploit_maturity, date_from/to, has_cve, actor, offset/limit |
| `GET /threats/{id}` · `/threats/{id}/explain` | запись + объяснение/рекомендации |
| `GET /timeline/{cve_id}` · `/threat-actors` · `/vendors` | таймлайн, MITRE-группы, топ вендоров |
| `GET /stats` | critical, active, new_24h, ua_alerts, EPSS-risk, breakdown'ы, by_country/actor/sponsor, ddos origins/targets, total, last_update |
| `GET /stats/attribution` · `/stats/sponsor-infrastructure` | актор→спонсор, спонсор→инфраструктура |
| `GET /sources` | счётчики источников из БД + `last_fetched` |
| `ddos_router` `/ddos-stats*` | снапшоты Cloudflare Radar |
| `ai_router` `/ai/{kind}` · `/ai/status` | digest/ddos/ioc/vendor/ukraine + статус |
| `phishing_router` `/phishing/*` | статистика, список, AI-примеры |

Swagger/OpenAPI **выключены** (`ENABLE_API_DOCS=1` включает). CORS — allow-list из `CORS_ORIGINS`.
Rate limit — `security.rate_limit_middleware`. Только GET/POST.

---

## 8. AI-аналіз (`routers/ai_analysis.py`)

`REQUIRED_KINDS = digest, ddos, ioc, vendor, ukraine`; генерация разбита на `_generate_kind()`;
недостающие повторяет `_retry_missing_scheduler` каждые **`AI_RETRY_MINUTES`=15**, пока не
появятся в кеше (иначе `/ai/*` → 503). IOC берутся отдельным `_get_iocs_from_db()` (топ-500).

---

## 9. Фронтенд-оболочка

`layout.tsx` → `LanguageProvider → AgentProvider → AdminShell(TopNav) → page`.
Фон: cyber-grid + ParticleField (см. `01-DESIGN.md` §7).
Страница: PageHeader (h1) → контент `max-w-1600` → футер-полоска.
Агент: `Agent` (логотип) + `AgentRoamer` (гастролёр); сцена ноутбука — `AgentLinkLayer`.
Эмоции: `useAgentMood(signals)` → `moodFromSignals()` с приоритетом из ТЗ.

---

## 10. Метрика Critical: как она считается сейчас и что предлагается

### 10.1 Сейчас (`app/scoring.py → infer_severity`)
Severity = тег фида (`TAG_SEVERITY`) либо `CRITICAL_KEYWORDS` по заголовку/описанию/тегам:
`critical, zero-day, in the wild, actively exploited, ransomware, breach, rce, worm,
rootkit, критичн, вимага, атакують, експлуатується, kritisch, …`

### 10.2 Свежая разбивка БД (14.11.2026, всего 34 179)

| Срез | Кол-во |
|---|---|
| **Critical всего** | **11 916** (35% базы — реально перебор) |
| из них IOC-записи (`type='IOC'`) | **9 224** (почти всё — ThreatFox: 9 219) |
| без CVE и без эксплойта (`Unknown`) | 9 857 |
| с `exploit_maturity ∈ {Weaponized, In the wild}` | 1 799 |
| с EPSS ≥ 0.5 | 911 |
| с CVE | 2 055 |
| с CVSS ≥ 9.0 | 238 |
| backfill | 0 |

**Вывод:** ~77% Critical — это IOC-строки ThreatFox, у которых в описании слово
«ransomware/rce/breach», и новости без CVE/эксплойта. Настояще критичные — единицы тысяч.

### 10.3 Предлагаемые критерии (решение за владельцем, backend НЕ менялся)

**Вариант A (рекомендую):** `Critical =` любой из:
1. `cvss_score >= 9.0`; или
2. `epss_score >= 0.5` **и** `exploit_maturity ∈ {Weaponized, In the wild}`; или
3. запись содержит признак активной эксплуатации (`in the wild` / `actively exploited`)
   **и** имеет CVE; или
4. явный тег критичности от доверенного CERT-источника (CISA KEV, CERT-UA `kritisch`).
   IOC-записям (`type='IOC'`) максимум **High**, если нет подтверждённого обогащения.
   **Ожидание: ~1 800–2 500 Critical вместо 11 916.**

**Вариант B (мягкий):** оставить `severity` как есть, но на дашборде показывать
«Critical (EM/EPSS)» = срез 1 799, а полный список — во вкладке Записи с фильтром.

**Вариант C (без правок):** только добавить подпись-подсказку к окну Critical.

---

## 11. Аудит сайта (14.11.2026) — найдено и исправлено

| # | Проблема | Статус |
|---|---|---|
| 1 | `page.tsx`: дубль мусора в конце файла → `Syntax Error`, `/` = 500 | ✅ исправлено |
| 2 | `page.tsx`: `useRef` не импортирован → `ReferenceError` | ✅ исправлено |
| 3 | DDoS-подсказка `0.920317%` | ✅ `.toFixed(2)` → `0.92%` |
| 4 | Ось Y «0.25%» обрезалась | ✅ `YAxis width 34→44` |
| 5 | «Країни-цілі» на английском при украинском UI | ✅ `countryName()` + `t.map.countries` |
| 6 | Окно AI-аналіз не было уменьшено (предыдущая правка не применилась) | ✅ переписано: компактная колонка, `h-full` вровень с левыми окнами, превью 2 строки, теги 9px |
| 7 | Глаза «слипались» при hover | ✅ на hover сценки отключены, дуги открыты |
| 8 | Движения рывками | ✅ пружина K=0.1/D=0.82, моргание ~300 мс |
| 9 | Не было ноутбука/кабеля | ✅ `laptop` + `AgentLinkLayer` + сцена 45–90 с |
| 10 | Не было роумера | ✅ `AgentRoamer` подключён, прячется на время сцены |
| 11 | `.env` мог утечь | ✅ `.gitignore` покрывает `.env`, `.env.local`, `data/*.db`, `*.tsbuildinfo`; проверено `git check-ignore` + grep staged |

Известные ограничения: внешние таймауты коллекторов (ACSC/OTX/EG-CERT/CERTFA) — фолбэки,
не баги; `Shodan` ключ в `.env` проверялся ранее (код `censys_…` удалён владельцем).

---

## 12. Текущее состояние (проверено)

`tsc --noEmit` = 0 · все 8 страниц = 200 · консоль dev без ошибок · backend `/health`=ok ·
планировщик: каждый час, тик 300 с · БД: 34 179 записей.
