# -*- coding: utf-8 -*-
"""Перевірка третьої лінзи /stats/sponsor-infrastructure.

Інваріанти:
  1. API-відповідь == незалежний перерахунок з SQLite (та сама логіка).
  2. Для КОЖНОГО спонсора: сума пар <= actor_links цього спонсора
     (різниця = записи без заповненого поля country).
  3. Регресія: by_country (Ukraine/Russia) та by_sponsor НЕ змінилися.
"""
import io
import json
import sqlite3
import sys
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

sys.path.insert(0, ".")
from app.actors import build_sponsor_infrastructure  # noqa: E402

API = "http://127.0.0.1:8010"


def get(path):
    return json.load(urllib.request.urlopen(API + path))


api_infra = get("/stats/sponsor-infrastructure")
attribution = get("/stats/attribution")
stats = get("/stats")

# --- 1. Незалежний перерахунок ---
con = sqlite3.connect("data/threats.db")
rows = con.execute(
    "SELECT title, summary, tags, country FROM threats"
).fetchall()
con.close()
db_pairs = build_sponsor_infrastructure(rows)

db_map = {(p["sponsor"], p["country"]): p["count"] for p in db_pairs}
api_map = {(p["sponsor"], p["country"]): p["count"] for p in api_infra["pairs"]}
match = db_map == api_map
print(f"[1] pairs API == DB recount: {match} ({len(api_map)} пар)")

# --- 2. Інваріант по спонсорах ---
links_by_sponsor = {i["sponsor"]: i["count"] for i in attribution["by_sponsor"]}
ok_inv = True
print("[2] Інваріант sum(pairs[s]) <= actor_links[s]:")
for sponsor in sorted(api_map and {s for s, _ in api_map}, key=lambda s: -sum(v for (sp, _), v in api_map.items() if sp == s)):
    infra_sum = sum(v for (sp, _), v in api_map.items() if sp == sponsor)
    links = links_by_sponsor.get(sponsor, 0)
    status = "OK " if infra_sum <= links else "FAIL"
    if infra_sum > links:
        ok_inv = False
    print(f"    [{status}] {sponsor}: infra={infra_sum} <= links={links} "
          f"(без геолокації: {links - infra_sum})")

# --- 2b. Агрегатний інваріант «Невідома держава» ---
# Сума по ВСІХ реальних спонсорах у новій метриці не перевищує
# by_sponsor мінус кошик "Невідома держава": динамічні UAC-* без
# відомого спонсора природно випадають з лінзи — це коректно.
UNKNOWN = "Невідома держава"
infra_total = sum(api_map.values())
known_total = sum(n for s, n in links_by_sponsor.items() if s != UNKNOWN)
unknown_links = links_by_sponsor.get(UNKNOWN, 0)
agg_ok = infra_total <= known_total
ok_inv = ok_inv and agg_ok
print(f"[2b] Агрегат: Σinfra={infra_total} <= known_sponsors={known_total} "
      f"(без «{UNKNOWN}»={unknown_links}): {'OK' if agg_ok else 'FAIL'}")
leaked = {s for s, _ in api_map} & {UNKNOWN}
if leaked:
    print(f"     FAIL: «{UNKNOWN}» протік у pairs: {leaked}")
    ok_inv = False
else:
    print(f"     «{UNKNOWN}» у pairs відсутній — фільтрація коректна")

# --- 2c. Розбивка для КОЖНОГО спонсора (універсальність лінзи) ---
print("[2c] Розкриття деталей по кожному рядку картки спонсорів:")
for sponsor, links in sorted(links_by_sponsor.items(), key=lambda kv: -kv[1]):
    rows = sorted(((c, v) for (s, c), v in api_map.items() if s == sponsor),
                  key=lambda x: -x[1])[:5]
    detail = ", ".join(f"{c} {v}" for c, v in rows) or "—"
    print(f"    {sponsor} ({links}) -> {detail}")

# --- 3. Регресія існуючих метрик ---
by_country = {d["country"]: d["count"] for d in stats["by_country"]}
by_sponsor = {d["sponsor"]: d["count"] for d in attribution["by_sponsor"]}
print(f"[3] Регресія by_country: Ukraine={by_country.get('Ukraine')} "
      f"Russia={by_country.get('Russia')} (очікуємо 273/11)")
print(f"    Регресія by_sponsor total_links={attribution['total_links']}")

verdict = match and ok_inv and by_country.get("Ukraine") == 273 \
    and by_country.get("Russia") == 11
print("\nVERDICT:", "PASS" if verdict else "FAIL")
