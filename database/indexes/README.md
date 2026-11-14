# Индексы таблиц базы угроз

Документируются текущие индексы (из `app/db.py`, `app/models/phishing.py`, `app/models/ddos_snapshot.py`, `app/models/dataset_snapshot.py` и миграций Alembic) и даются рекомендации под рост данных.

## Таблица threats

| Индекс | Колонки | Уникальный | Назначение |
|--------|---------|------------|------------|
| `uq_source_external_id` | (source, external_id) | Да | Первичный ключ дедупликации. Защита от дублей на уровне БД. |
| `ix_threats_source` | source | Нет | Фильтрация и группировка по источнику (`/stats/by_source`, `/sources`). |
| `ix_threats_external_id` | external_id | Нет | Поиск по внешнему ID. |
| `ix_threats_published` | published | Нет | Сортировка по дате, окно `days` в `/threats` и `/stats`. |
| `ix_threats_severity` | severity | Нет | Фильтрация по опасности, метрика `critical_threats`. |
| `ix_threats_type` | type | Нет | Фильтрация по типу (CVE/Advisory/News/Exploit/IOC). |
| `ix_threats_region` | region | Нет | Переключатель UA/World, метрика `ua_alerts`. |
| `ix_threats_exploit_maturity` | exploit_maturity | Нет | Фильтрация по зрелости эксплойта, метрика `active_exploits`. |
| `ix_threats_is_backfill` | is_backfill | Нет | Исключение технических импортов из метрик `new_cve_24h`. |
| `ix_threats_cve_id` | cve_id | Нет | Фильтр `has_cve`, поиск по CVE. |

## Таблица phishing_urls

| Индекс | Колонки | Уникальный | Назначение |
|--------|---------|------------|------------|
| `ix_phishing_domain_brand` | (domain, target_brand) | Нет | Группировка по домену и бренду на Phishing Desk. |
| `ix_phishing_source_fetched` | (source, fetched_at) | Нет | Свежесть записей по источнику. |

## Таблица ddos_snapshots

| Индекс | Колонки | Уникальный | Назначение |
|--------|---------|------------|------------|
| `ix_ddos_snapshots_captured_at` | captured_at | Нет | Сортировка срезов по времени, очистка старых (`clean_old_snapshots`). |
| `ix_ddos_snapshots_scope` | scope | Нет | Фильтрация global/UA. |
| `ix_ddos_snapshots_metric_type` | metric_type | Нет | Фильтрация по типу метрики. |
| `ix_ddos_snapshots_scope_metric` | (scope, metric_type) | Нет | Совместная фильтрация scope + metric_type. |

## Таблица dataset_snapshots

| Индекс | Колонки | Уникальный | Назначение |
|--------|---------|------------|------------|
| `ix_dataset_snapshots_name` | dataset_name | Нет | Поиск снимка по названию датасета. |
| `ix_dataset_snapshots_captured_at` | captured_at | Нет | История снимков, последний по времени. |

## Рекомендации под рост

1. **Composite-индекс для `/threats`**: частый фильтр `(published, severity)` или `(region, published)` — стоит добавить composite-индекс при росте таблицы выше 100к записей.
2. **Индекс по `content_hash`**: если будет внедрена меж-источниковая дедупликация по `content_hash`, добавить `ix_threats_content_hash`.
3. **Частичный индекс по `is_backfill = false`**: для ускорения метрик `new_cve_24h` (PostgreSQL поддерживает частичные индексы; в SQLite — через выражение).
4. **VACUUM / ANALYZE**: для SQLite периодически запускать `VACUUM` и `ANALYZE` после массовых импортов.

## Связь с кодом

- `app/db.py:33-70` — определение `ThreatORM` и `__table_args__`
- `app/models/phishing.py:36-38` — индексы `PhishingURLORM`
- `app/models/ddos_snapshot.py:42-47` — индексы `DdosSnapshotORM`
- `app/models/dataset_snapshot.py:31-34` — индексы `DatasetSnapshotORM`
- `migrations/versions/` — Alembic миграции для создания таблиц и колонок
