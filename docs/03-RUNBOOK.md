# 03 · RUNBOOK — запуск, конфигурация, обслуживание

> Практический файл: как поднять, где ключи, как проверять и чинить.
> Сопутствующие: `01-DESIGN.md` (дизайн), `02-ARCHITECTURE.md` (архитектура + аудит).

---

## 1. Требования

Python 3.11+ (`.venv`), Node.js 18+, SQLite из коробки, доступ в интернет коллекторам.

---

## 2. Запуск

```powershell
# Backend (порт 8010)
cd "D:\ПРОЕКТ AI\ЛИЧНЫЕ НАРАБОТКИ\AI Cyber Security"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8010

# Frontend (порт 3001, отдельный терминал)
cd frontend
npm.cmd run dev -- -p 3001
```

Проверка: `http://127.0.0.1:8010/health` → `{"status":"ok"}`; `http://localhost:3001` → 200.

Ручной прогон сбора: `.\.venv\Scripts\python.exe -m app.pipeline`

> Если порт занят — значит экземпляр уже запущен (Windows отдаёт `WinError 10048`).
> Новый процесс при этом корректно завершается, работает старый.

---

## 3. Конфигурация (`.env`)

**Правило: `.env` НЕ трогать и НЕ пушить — 17+ ключей остаются на месте.**
В git попадает только шаблон `.env.example` (без значений). Проверка:

```powershell
git check-ignore -v .env            # должен указать .gitignore
git diff --cached --name-only | findstr "^\.env$"   # пусто
```

Ключевые переменные:

| Переменная | Default | Назначение |
|---|---|---|
| `DATABASE_URL` | `sqlite:///./data/threats.db` | любой SQLAlchemy URL |
| `ENABLE_COLLECT_SCHEDULER` | `1` | часовой сбор данных |
| `COLLECT_INTERVAL_HOURS` | `1` | период обновления БД |
| `AI_RETRY_MINUTES` | `15` | ретраи недостающих AI-анализов |
| `ATTRIB_CACHE_TTL_SEC` | `300` | TTL кеша атрибуции |
| `ENABLE_API_DOCS` | выкл | включить `/docs` + OpenAPI |
| `CORS_ORIGINS` | localhost:3000/3001 | allow-list фронта |
| `N8N_WEBHOOK_URL` | пусто | сводка в Telegram после прогона |

API-ключи: NVD, GitHub, abuse.ch, OTX, Cloudflare Radar, Groq, Telegram,
Google Safe Browsing, HIBP, VirusTotal, IntelX, Shodan, Censys.

---

## 4. Правила обслуживания

1. **Не запускать `next build` при живом `next dev`** (ломает `.next`).
2. `.env` не трогать, не коммитить (см. §3).
3. **Git/GitHub**: пуш только `pres` → `github.com/dev-arthur-petrunko/AI_Cyber_Dashboard`,
   от имени `arthurpetrunko@gmail.com` (git user: `dev-arthur-petrunko <arthurpetrunko@gmail.com>`).
   `.env`, `data/*.db`, `node_modules`, `.next`, `.venv` — в git не идут.
4. Даты — только через `parseApiDate` (`frontend/lib/dates.ts`).
5. Новые UI-тексты — во все 5 языков в `frontend/lib/i18n.ts`.
6. Документация — **ровно 3 файла** в `docs/` (+ `README.md` как витрина GitHub).
7. Удаление файлов — сначала grep по репозиторию, потом удаление.
8. Бэкенд и логика данных не меняются без отдельного подтверждения
   (критерии Critical — см. `02-ARCHITECTURE.md` §10, решение за владельцем).

---

## 5. Диагностика

| Симптом | Что делать |
|---|---|
| Фронт пуст | жив ли backend (`/health`), CORS |
| `/ai/*` = 503 | ретраи AI в логе, `GROQ_API_KEY`, `AI_RETRY_MINUTES` |
| Данные не обновляются | логи `scheduler:` / `pipeline|`, `ENABLE_COLLECT_SCHEDULER=1` |
| 401 от API-источника | ключ в `.env`, квоты free tier |
| Сдвиг времени −2 ч | дата не через `parseApiDate` |
| `WinError 10048` | порт занят работающим экземпляром — это норма |
| Сломался `.next` | остановить dev, удалить `.next`, пересобрать |
| Синтаксическая ошибка страницы | `npx tsc --noEmit` покажет файл:строку |

Типовая проверка перед сдачей:

```powershell
cd frontend && npx tsc --noEmit          # должно быть 0 ошибок
# 8 страниц → 200, в консоли dev нет ⨯ и ошибок
```

---

## 6. Проверенные факты (14.11.2026)

- `tsc --noEmit` = 0; все 8 маршрутов = 200; консоль dev чистая.
- Backend `/health` = ok; планировщик: каждый час, tick 300 с.
- БД: 34 179 записей; Critical = 11 916 (см. анализ и предложения в `02` §10).
- Секреты: `.env` ignored и не staged; значения ключей в staged-файлах отсутствуют.
- Скриншоты README: `docs/screenshots/01-dashboard.png`, `02-ai.png`, `03-ddos.png`.

---

## 7. Резервная копия

```powershell
robocopy "D:\ПРОЕКТ AI\ЛИЧНЫЕ НАРАБОТКИ\AI Cyber Security" "D:\ПРОЕКТ AI\ЛИЧНЫЕ НАРАБОТКИ\copy_project" /E /XD node_modules .next .venv __pycache__
```

`copy_project` — страховка ПЕРЕД крупными этапами; содержит `.env` и рабочую копию проекта.
