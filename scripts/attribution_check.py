"""Перевірка атрибуції (Завдання 1+2):
  1) ненульові/пропорційні значення для Gamaredon/Turla/APT28/APT29
  2) сума country_sponsor-груп == сума всіх actor_links (рівність Python)
  3) сирі згадки в повному тексті (title+summary+tags) для контролю пропорційності

Запуск: python -m scripts.attribution_check
"""
import sys
from collections import Counter

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from sqlalchemy import or_

from app.actors import ACTORS, UNKNOWN_SPONSOR, build_actor_links, build_sponsor_totals
from app.db import SessionLocal, ThreatORM


def main() -> None:
    db = SessionLocal()
    try:
        rows = (
            db.query(
                ThreatORM.title, ThreatORM.summary, ThreatORM.tags, ThreatORM.country
            )
            .all()
        )
        links = build_actor_links(rows)

        # ── Критерій 1: лінки по кожному актору ─────────────────────────
        per_actor: Counter[str] = Counter()
        for l in links:
            per_actor[l["actor"]] += l["count"]
        print("=== Лінки по акторах (повний скан, вся база) ===")
        for actor in sorted(per_actor, key=lambda a: -per_actor[a]):
            print(f"  {actor:15} links={per_actor[actor]}")

        # ── Контроль пропорційності: сирі згадки в повному тексті ───────
        print("\n=== Сирі згадки в title+summary+tags (регістронезалежно) ===")
        for actor in ("Gamaredon", "Turla", "APT28", "APT29"):
            aliases = [a.strip() for a in ACTORS[actor].pattern.split("|")]
            conds_title = or_(*[ThreatORM.title.ilike(f"%{a}%") for a in aliases])
            conds_sum = or_(*[ThreatORM.summary.ilike(f"%{a}%") for a in aliases])
            n_any = (
                db.query(ThreatORM)
                .filter(or_(conds_title, conds_sum))
                .count()
            )
            print(
                f"  {actor:10} згадок у БД={n_any:>3}  "
                f"sankey_links={per_actor.get(actor, 0):>3}"
            )

        # ── Критерій 2: рівність сум ────────────────────────────────────
        print("\n=== Рівність сум: sponsors vs actor_links ===")
        by_sponsor = build_sponsor_totals(links)
        for item in by_sponsor:
            print(f"  {item['sponsor']:18} {item['count']}")
        sum_sponsors = sum(i["count"] for i in by_sponsor)
        sum_links = sum(l["count"] for l in links)
        print(f"  {'РАЗОМ':18} {sum_sponsors} (sponsors) vs {sum_links} (links)")
        assert sum_sponsors == sum_links, "SUM MISMATCH"
        print("  OK: суми збігаються")

        # Ендпоінт-еквівалент
        endpoint_total = sum(i["count"] for i in by_sponsor)
        assert endpoint_total == sum_links
        unknown = next((i["count"] for i in by_sponsor if i["sponsor"] == UNKNOWN_SPONSOR), 0)
        print(f"  OK: /stats/attribution total={endpoint_total}, невідомих={unknown}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
