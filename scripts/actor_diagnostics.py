"""Діагностика: чому Gamaredon/Turla/APT28/APT29 відсутні в Sankey.

Порівнює:
  1) SQL COUNT(*) WHERE title LIKE '%alias%'        — сирі згадки в БД
  2) detect_actors(title)                            — що бачить поточний код
  3) detect_actors(title + summary + tags)           — що було б з повним скануванням
  4) build_actor_links(...)                          — фактичні лінки Sankey (365 днів)

Окремо: частка хибних спрацювань "Armageddon" поза контекстом Gamaredon.

Запуск: python -m scripts.actor_diagnostics
"""
import sys
from collections import Counter
from datetime import timedelta

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from sqlalchemy import or_

from app.actors import ACTORS, build_actor_links, detect_actors
from app.db import SessionLocal, ThreatORM, now_utc


def row_text(title: str | None, summary: str | None, tags: object) -> str:
    parts = [title or ""]
    if summary:
        parts.append(summary)
    if tags:
        if isinstance(tags, (list, tuple)):
            parts.extend(str(t) for t in tags)
        else:
            parts.append(str(tags))
    return "\n".join(parts)


def sql_title_count(db, actor: str) -> int:
    """COUNT(*) WHERE title містить будь-який alias актора (регістронезалежно)."""
    aliases = [a.strip() for a in ACTORS[actor].pattern.split("|")]
    return (
        db.query(ThreatORM)
        .filter(or_(*[ThreatORM.title.ilike(f"%{a}%") for a in aliases]))
        .count()
    )


def main() -> None:
    db = SessionLocal()
    try:
        total = db.query(ThreatORM).count()
        print(f"Усього записів у БД: {total}")

        rows = (
            db.query(
                ThreatORM.title,
                ThreatORM.summary,
                ThreatORM.tags,
                ThreatORM.country,
                ThreatORM.published,
            )
            .all()
        )

        # ── 1. Сирі SQL-згадки по alias у title ──────────────────────────
        print("\n=== 1. SQL COUNT(*) по alias у title (вся база) ===")
        for actor in ACTORS:
            print(f"  {actor:15} -> {sql_title_count(db, actor)}")

        # ── 2. detect_actors(title) vs (title+summary+tags) ─────────────
        print("\n=== 2. Детекція: title-only vs title+summary+tags (вся база) ===")
        title_only_counter: Counter[str] = Counter()
        full_counter: Counter[str] = Counter()
        armageddon_hits: list[str] = []

        import re as _re

        arm_re = _re.compile(r"\bArmageddon\b", _re.IGNORECASE)
        other_gam = [
            a.strip()
            for a in ACTORS["Gamaredon"].pattern.split("|")
            if a.strip().lower() != "armageddon"
        ]
        other_re = _re.compile(
            "|".join(_re.escape(a) for a in other_gam), _re.IGNORECASE
        )

        for title, summary, tags, _country, _pub in rows:
            for actor in detect_actors(title):
                title_only_counter[actor] += 1
            text = row_text(title, summary, tags)
            for actor in detect_actors(text):
                full_counter[actor] += 1
            t = title or ""
            if arm_re.search(t) and not other_re.search(t):
                armageddon_hits.append(t[:90])

        all_actors = sorted(set(title_only_counter) | set(full_counter))
        print(f"  {'актор':15} {'title':>6} {'full':>6}")
        for actor in all_actors:
            mark = "  <- зникає при title-only" if full_counter[actor] > title_only_counter[actor] else ""
            print(f"  {actor:15} {title_only_counter[actor]:>6} {full_counter[actor]:>6}{mark}")
        print(
            f"  {'РАЗОМ згадок':15} {sum(title_only_counter.values()):>6} "
            f"{sum(full_counter.values()):>6}"
        )

        # ── 3. Фактичні Sankey-лінки (як у /stats: 365 днів, title+country) ──
        print("\n=== 3. build_actor_links як у /stats (published >= now-365d) ===")
        recent_rows = (
            db.query(ThreatORM.title, ThreatORM.country)
            .filter(ThreatORM.published >= now_utc() - timedelta(days=365))
            .all()
        )
        links = build_actor_links(recent_rows)
        link_per_actor: Counter[str] = Counter()
        for l in links:
            link_per_actor[l["actor"]] += l["count"]
        for actor in sorted(link_per_actor, key=lambda a: -link_per_actor[a]):
            print(f"  {actor:15} links={link_per_actor[actor]}")
        print(f"  РАЗОМ лінків: {sum(link_per_actor.values())}")

        # ── 4. Втрати Gamaredon ─────────────────────────────────────────
        print("\n=== 4. Втрати Gamaredon ===")
        gam_full = full_counter.get("Gamaredon", 0)
        gam_title = title_only_counter.get("Gamaredon", 0)
        gam_links = link_per_actor.get("Gamaredon", 0)
        print(f"  згадок у title:              {gam_title}")
        print(f"  згадок у title+summary+tags: {gam_full}")
        print(f"  лінків у Sankey (365d):      {gam_links}")
        if gam_full:
            lost = gam_full - gam_links
            print(f"  втрачено:                    {lost} ({lost / gam_full * 100:.0f}%)")

        # ── 5. Хибні спрацювання Armageddon ─────────────────────────────
        print("\n=== 5. 'Armageddon' поза контекстом інших alias Gamaredon ===")
        print(
            f"  title з 'Armageddon' без Gamaredon/Shuckworm/'Primitive Bear': "
            f"{len(armageddon_hits)}"
        )
        for t in armageddon_hits[:10]:
            print(f"    - {t!r}")

        # ── 6. Критерій приймання: SQL vs детекція для 4 груп ───────────
        print("\n=== 6. Критерій: SQL ILIKE vs детекція ===")
        for actor in ("Gamaredon", "Turla", "APT28", "APT29"):
            print(
                f"  {actor:10} SQL(title)={sql_title_count(db, actor):>3}  "
                f"detect(title)={title_only_counter.get(actor, 0):>3}  "
                f"detect(full)={full_counter.get(actor, 0):>3}  "
                f"sankey_links={link_per_actor.get(actor, 0):>3}"
            )
    finally:
        db.close()


if __name__ == "__main__":
    main()
