# Реестр таблиц базы угроз

Карта соответствий: таблица БД → ORM-модель → Pydantic-схема → слой хранения → роутер API.

## Таблица threats

| Компонент | Путь / класс |
|-----------|--------------|
| Таблица | `threats` |
| ORM-модель | `app/db.py:33` — `ThreatORM` |
| Pydantic-схема | `app/models/threat.py:43` — `Threat` |
| JSON-схема | `базаданных/schemas/threat_schema.json` |
| Слой хранения | `app/storage/bulk.py:10` — `bulk_upsert()` |
| Роутер API | `app/main.py:129` — `GET /threats`, `GET /threats/{id}`, `GET /threats/{id}/explain` |
| Дедупликация | Upsert по `(source, external_id)` + `UniqueConstraint("source", "external_id")` |
| Статус | Активна, используется всеми 18+ коллекторами через `app/pipeline.py` |

## Таблица phishing_urls

| Компонент | Путь / класс |
|-----------|--------------|
| Таблица | `phishing_urls` |
| ORM-модель | `app/models/phishing.py:14` — `PhishingURLORM` |
| Pydantic-схема | нет (ORM напрямую) |
| JSON-схема | `базаданных/schemas/phishing_schema.json` |
| Слой хранения | `app/storage/phishing_storage.py:7` — `bulk_upsert_phishing()` |
| Роутер API | `app/routers/phishing.py` |
| Дедупликация | Upsert по `(source, external_id)` |
| Статус | Активна, собирается PhishTank/OpenPhish/PhishStats |

## Таблица ddos_snapshots

| Компонент | Путь / класс |
|-----------|--------------|
| Таблица | `ddos_snapshots` |
| ORM-модель | `app/models/ddos_snapshot.py:31` — `DdosSnapshotORM` |
| Pydantic-схема | нет (ORM напрямую) |
| JSON-схема | `базаданных/schemas/ddos_schema.json` |
| Слой хранения | `app/storage/ddos_storage.py:20` — `save_snapshot()`, `save_snapshots()` |
| Роутер API | `app/routers/ddos.py` |
| Дедупликация | Нет — каждый запуск pipeline добавляет новый срез (время captured_at) |
| Статус | Активна, Cloudflare Radar |

## Таблица dataset_snapshots

| Компонент | Путь / класс |
|-----------|--------------|
| Таблица | `dataset_snapshots` |
| ORM-модель | `app/models/dataset_snapshot.py:16` — `DatasetSnapshotORM` |
| Pydantic-схема | нет (ORM напрямую) |
| JSON-схема | `базаданных/schemas/dataset_schema.json` |
| Слой хранения | `app/collectors/datasets.py` — `collect_datasets()` |
| Роутер API | `app/routers/datasets.py` |
| Дедупликация | Нет — каждый запуск добавляет новый срез (время captured_at) |
| Статус | Активна, каталог ML-датасетов |

## Связь с миграциями

| Миграция | Описание | Таблица |
|----------|----------|---------|
| `0001_ddos_snapshots` | Создание таблицы DDoS-срезов | `ddos_snapshots` |
| `0002_dataset_snapshots` | Создание таблицы каталога датасетов | `dataset_snapshots` |
| `0003_threat_is_backfill` | Добавление колонки `is_backfill` + индекс | `threats` |

Инструмент миграции: Alembic (`migrations/env.py`, `alembic.ini`). `target_metadata` берётся из `app.db.Base`, которая регистрирует `ThreatORM`, `DdosSnapshotORM`, `DatasetSnapshotORM`.

## Доступ к данным через API

| Эндпоинт | Таблица | Описание |
|----------|---------|----------|
| `GET /threats` | `threats` | Пагитированный фид угроз с фильтрами |
| `GET /threats/{id}` | `threats` | Одна угроза с объяснением |
| `GET /stats` | `threats` + `ddos_snapshots` | Глобальные агрегаты |
| `GET /stats/attribution` | `threats` | Актор → спонсор |
| `GET /stats/sponsor-infrastructure` | `threats` | Спонсор × страна хостинга |
| `GET /sources` | `threats` + `phishing_urls` + `ddos_snapshots` + `dataset_snapshots` | Статус источников |
| `GET /ddos-stats` | `ddos_snapshots` | DDoS-статистика |
| `GET /phishing/stats` | `phishing_urls` | Статистика фишинга |

## Принцип разделения

- **Угрозы** (`threats`) — единая нормализованная модель для всех типов (CVE/advisory/news/exploit/IOC).
- **Фишинг** (`phishing_urls`) — отдельная таблица из-за специфики (URL, бренд, верификация, гео).
- **DDoS** (`ddos_snapshots`) — временные срезы, без upsert, для истории и сравнения.
- **Каталог датасетов** (`dataset_snapshots`) — снимки метаданных ML-датасетов, без upsert.

## Файл .env

Не удалять, не менять значения ключей. Можно только добавлять комментарии при необходимости.
