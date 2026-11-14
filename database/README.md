# Database Folder

This folder contains **rules, schemas, taxonomy, examples and registry** for storing threat records in the Cyber Sentinel project.

The physical database remains in `data/threats.db` (SQLite by default, switchable to PostgreSQL via `DATABASE_URL` in `.env`) and is NOT copied here. This directory contains only schemas, strategies, rules, examples and reference materials — everything that lets you understand how threat records enter the DB and how duplicate protection works.

## Structure

| Path | Purpose |
|------|---------|
| `schemas/` | JSON schemas of normalized threat records (threats, phishing, DDoS, datasets) |
| `taxonomy/` | Classification of threat types, severity levels, regions (UA/World) |
| `deduplication/` | Deduplication strategy, keys, merge rules |
| `config/` | Machine-readable rules (db_rules, source mapping) |
| `indexes/` | Index documentation and recommendations |
| `examples/` | Example records and dedup case studies |
| `registry/` | Table → model → storage → router mapping |
| `database_documentation.md` | Full documentation of database changes |
| `project_architecture.md` | Full project documentation (site, tabs, architecture, data flow) |

## Code Integration

- `app/db.py` — DB initialization, `ThreatORM`, `SessionLocal`, `init_db()`
- `app/models/threat.py` — Pydantic `Threat` model (single contract for all collectors)
- `app/storage/bulk.py` — bulk upsert of threats with deduplication by `(source, external_id)`
- `app/storage/phishing_storage.py` — upsert of phishing URLs
- `app/storage/ddos_storage.py` — DDoS snapshots (no upsert, time series)
- `app/collectors/base.py` — `BaseCollector` interface with `fetch() -> list[Threat]`
- `app/pipeline.py` — orchestration entry point: runs all collectors, bulk upsert, enrichment, migrations
- `app/main.py` — FastAPI, endpoints `/threats`, `/stats`, `/sources` etc.

## Deduplication Principles

1. **Primary dedup key**: pair `(source, external_id)`.
2. **DB level**: `UniqueConstraint("source", "external_id", name="uq_source_external_id")` on table `threats` — protection from race conditions and parallel inserts.
3. **App level**: in `bulk_upsert`, duplicates within a single batch are filtered before writing; existing records are updated, not duplicated.
4. **Metric protection**: when `is_backfill=True`, the `published` field of an existing record is NOT overwritten, so technical imports don't create fake spikes in `new_cve_24h`.
5. **Domain separation**: threats (`threats`), phishing (`phishing_urls`), DDoS snapshots (`ddos_snapshots`), dataset catalog (`dataset_snapshots`) live in separate tables, each with its own dedup logic.

The `.env` file must NOT be deleted or have its key values changed. Only comments may be added if needed.