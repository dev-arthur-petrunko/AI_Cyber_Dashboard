# Документація: Проєкт Cyber Sentinel (сайт, вкладки, архітектура, потік даних)

## 1. Опис проєкту

**Cyber Sentinel** (раніше UA Cyber Threat Dashboard, v1.6.1) — глобальна платформа киберрозвідувальної інформації з українським фокусом. Агрегує 18+ відкритих джерел загроз (NVD, CISA KEV, CERT-UA, MISP Galaxy, MITRE ATT&CK, Cloudflare Radar, OpenPhish, PhishTank, ThreatFox тощо), нормалізує їх у єдину модель загроз, збагачує (EPSS, CVSS, геолокація,severity, атрибуція APT) та подає через реального часу дашборд, REST API та п'ять щоденних AI-аналізів.

Мова інтерфейсу: 5 мов (Українська, Англійська, Польська, Французька, Німецька).

## 2. Архітектура

```
Колектори (18+ відкритих джерел)
        ↓
Нормалізатор → єдина модель загроз (Threat)
        ↓
Зберігання (bulk upsert, дедуплікація по source+external_id)
        ↓
Збагачення (EPSS, GeoIP, витяг вендорів, атрибуція акторів)
        ↓
SQLite / PostgreSQL  ──→  FastAPI (:8010)
                              │
              /stats /threats /ai/* /ddos-stats /phishing/*
                              │
              ┌───────────────┴───────────────┐
              ↓                               ↓
      Next.js 14 дашборд               Groq GPT-OSS 120B
      (5 мов, SSR i18n)               (5 щоденних аналізів)
```

### 2.1 Бекенд (FastAPI, Python)

- `app/main.py` — FastAPI додаток, всі роутери, middleware (CORS, rate limit), ендпоінти API
- `app/db.py` — SQLAlchemy сесія, ORM-моделі (`ThreatORM`, `CollectorStateORM`, тощо), ініціалізація БД
- `app/models/threat.py` — Pydantic-модель `Threat` (єдиний контракт всіх колекторів)
- `app/pipeline.py` — точка входу збору даних: запуск усіх колекторів, upsert, обogaчення EPSS, DDoS, фішинг, каталог датасетів
- `app/storage/bulk.py` — масовий upsert загроз з батчуванням (`batch_size=500`)
- `app/storage/phishing_storage.py` — upsert фішингових URL
- `app/storage/ddos_storage.py` — збереження DDoS-зрізів (без upsert, часові зрізи)
- `app/collectors/` — 18+ колекторів джерел даних (кожен реалізує `BaseCollector.fetch()`)
- `app/routers/` — API роутери (`ai_analysis`, `ddos`, `datasets`, `phishing`)
- `app/scoring.py` — обчислення `local_score`, витяг вендорів
- `app/actors.py` — атрибуція акторів → держава-спонсор
- `app/enrichment.py` — обogaчення EPSS-балами
- `app/notifications.py` — сповіщення n8n після завершення pipeline

### 2.2 Фронтенд (Next.js 14)

- Папка `frontend/` — дашборд на Next.js 14, Tailwind CSS, 5 мов (i18n)
- Порт `3001` (за замовчуванням)
- взаємодіє з бекендом через REST API

### 2.3 База даних

- За замовчуванням SQLite (`data/threats.db`), можливо перемикання на PostgreSQL через `DATABASE_URL` у `.env`
- Таблиці: `threats`, `phishing_urls`, `ddos_snapshots`, `dataset_snapshots`, `collector_states`
- Міграції: Alembic (`migrations/`, поточний head `0003_threat_is_backfill`)

## 3. Вкладки дашборду та їх призначення

| Вкладка | Екран | Що показує | Ефект |
|---------|-------|------------|-------|
| 1. Mission Control | `01-dashboard.png` | П'ять KPI-картки (критичні загрози, активні експлойти, нові CVE за 24г, українські алерти, EPSS-ризик), таймлайн активності, світова карта, Сан키-трекер акторів, панель спонсорів | Загальна картина: що відбувається, хто за дійде, де ударяє, що робити |
| 2. DDoS Planet | `02-ddos-planet.png` | 3D-планета (ортографічна проекція), дуги атак з країни походження до країни ціль, частинки, пульсинг гарячих точок, топ країн-цілей/походження, тренд атак 30 днів | Візуалізація DDoS-атак у реальному часі (Cloudflare Radar) |
| 3. AI Analysis | `03-ai-general.png` | П'ять щоденних аналізів (Стратегічний дайджест, DDoS, IOC, Вендор, Україна),генеровані Groq GPT-OSS 120B о 09:00 Kyiv | Аналітичні висновки, тренди, рекомендації |
| 4. Ukraine AI Focus | `04-ai-ukraine.png` | Щоденний звіт лише з українських записів (CERT-UA, RNBO, SSU, SSSCIP, UAC-*), п'ять розділів (активні кампанії, кластери акторів, секторний ризик, злочинна інфраструктура, рекомендації) | Спеціалізована аналітика для України |
| 5. Phishing Desk | `05-phishing.png` | Фішингові URL (OpenPhish, PhishTank, PhishStats), аналітика брендів, цільових країн, топ-доменів, лічильник верифікованих записів | Моніторинг фішингових атак |
| 6. Records Database | `06-records.png` | Повнотекстовий пошук (350 мс дебаунс) у всіх загрозах, фільтри (джерело, вендор, зрілості експлойту, дати, CVE, актор), сортування, експорт | База записів про загрози |
| 7. Attribution Engine | `07-attribution.png` | Мапінг груп APT → держава-спонсор (Росія, Китай, КНДР, Іран, Білорусь), Санкі-діаграма, інфраструктура спонсорів × країна хостингу | Атрибуція атак до держав |
| 8. Sources Transparency | `08-sources.png` | Список усіх колекторів, ліцензія, актуальність, кількість записів, статус (активне/планується) | Прозорість джерел даних |

## 4. API ендпоінти

| Ендпоінт | Метод | Призначення |
|----------|-------|-------------|
| `/` | GET | Список ендпоінтів |
| `/health` | GET | Статус сервісу |
| `/threats` | GET | Пагований фід загроз з фільтрами (джерело,severity,тип,регіон,дати,CVE,вендор,актор, пошук) |
| `/threats/{id}` | GET | Одна загроза з поясненням та рекомендаціями |
| `/threats/{id}/explain` | GET | Пояснення загрози |
| `/stats` | GET | Глобальні агрегати (критичні, нові за 24г, українські алерти, EPSS-ризик, топ вендорів, джерели, країни, актори, спонсори) |
| `/stats/attribution` | GET | Актори → держава-спонсор |
| `/stats/sponsor-infrastructure` | GET | Спонсор × країна хостингу інфраструктури |
| `/sources` | GET | Статус джерел (кількість записів у БД) |
| `/vendors` | GET | Топ вендорів |
| `/ddos-stats` | GET | DDoS-статистика Cloudflare Radar |
| `/phishing/stats` | GET | Статистика фішингу |
| `/datasets` | GET | Каталог ML-датасетів |
| `/threat-actors` | GET | Пошук груп MITRE ATT&CK |
| `/ai/{digest|ddos|ioc|vendor|ukraine}` | GET | Щоденний AI-аналіз |
| `/ai/status` | GET | Готовність кешу аналізів |
| `/ai/refresh` | POST | Форсове перегенерування аналізів |
| `/timeline/{cve_id}` | GET | Таймлайн вразливості CVE |

## 5. Потік даних (від джерела до сайту)

1. **Збір (pipeline):** `app/pipeline.py` запускає кожен колектор (`fetch()`), який повертає список нормалізованих об'єктів `Threat`.
2. **Нормалізація:** Кожен колектор перетворює сирі дані свого джерела на єдину модель `Threat` (Pydantic), включаючи `external_id`, `source`, `type`, `severity`, `published`, `cvss_score`, `epss_score`, `exploit_maturity`, `tags`, `summary`, `url`.
3. **Зберігання (bulk upsert):** `bulk_upsert` у `app/storage/bulk.py` записує записи у таблицю `threats` з дедуплікацією по `(source, external_id)`, батчами по 500 записів. Існуючі оновлюються, нові вставляються.
4. **Збагачення:** `enrich_epss` додає EPSS-бали; `scoring` обчислює `local_score`; `actors` атрибутує групи до держав-спонсорів.
5. **DDoS та фішинг:** окремі таблиці `ddos_snapshots` та `phishing_urls` зі власною логікою збереження.
6. **API:** FastAPI надає дані через ендпоінти (`/threats`, `/stats`, `/sources` тощо).
7. **Фронтенд:** Next.js 14 забирає дані з API і відображає на вкладках дашборду.

## 6. Розподіл даних на сайті

- **Загрози (`threats`)** — таблиця Mission Control, Records Database, Attribution Engine, частина AI Analysis (загрози як джерело даних).
- **Фішинг (`phishing_urls`)** — таблиця Phishing Desk.
- **DDoS (`ddos_snapshots`)** — таблиця DDoS Planet, частина `/stats` (походження/цілі атак).
- **Каталог датасетів (`dataset_snapshots`)** — метадані ML-датасетів для аналітики.
- **Стан збирання (`collector_states`)** — внутрішній, для інкрементного збору (не відображається на сайті).

## 7. Deduplication Protection

Three levels of protection against duplicate records (consistent across all documentation):

1. **DB level**: `UniqueConstraint("source", "external_id", name="uq_source_external_id")` on table `threats` — protects against race conditions and parallel inserts.
2. **App level (batch)**: in `bulk_upsert`, duplicates within a single batch are filtered before writing.
3. **App level (upsert)**: existing records are updated, not duplicated — "update + insert" semantics.

Additional: `content_hash` (SHA-256) is an auxiliary signal for cross-source deduplication (not a primary key). Backfill protection: `published` is not overwritten when `is_backfill=True`.

## 8. Файл `.env`

Містить конфігурацію (DATABASE_URL, ключі API для джерел, GROQ_API_KEY, CLOUDFLARE_RADAR_API_TOKEN тощо). Не видаляється, не змінюється значень ключів.
