"""Одноразовий ремонт метрик v1.6.1 (задачі 1.1 і 1.2) з інваріантами.

1.1 New 24h: позначити технічні імпорти блоклістів як is_backfill=1
    (Spamhaus DROP, ET Compromised IPs — джерела без дати на запис).
1.2 PhishTank: verified_online.csv містить лише верифіковані URL,
    колонка verified='yes' -> 'verified' (шкала дашборда).

Запуск: python -m scripts.fix_new24h_verified_metrics
"""
import io
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from sqlalchemy import func

from app.db import SessionLocal, ThreatORM
from app.models.phishing import PhishingURLORM

BACKFILL_SOURCES = ("Spamhaus DROP", "ET Compromised IPs")
VERIFIED_IN = ("verified", "community", "auto")


def new24h(db) -> int:
    """Стара семантика метрики (без виключення backfill) — для порівняння ДО."""
    day_ago = func.datetime("now", "-1 day")
    return (
        db.query(ThreatORM)
        .filter(ThreatORM.published >= day_ago)
        .count()
    )


def new24h_v161(db) -> int:
    """Нова семантика /stats (v1.6.1): published >= now-24h AND NOT is_backfill."""
    day_ago = func.datetime("now", "-1 day")
    return (
        db.query(ThreatORM)
        .filter(ThreatORM.published >= day_ago,
                ThreatORM.is_backfill == False)  # noqa: E712
        .count()
    )


def spamhaus_in_new24h(db) -> int:
    day_ago = func.datetime("now", "-1 day")
    return (
        db.query(ThreatORM)
        .filter(ThreatORM.source == "Spamhaus DROP",
                ThreatORM.published >= day_ago,
                ThreatORM.is_backfill == False)  # noqa: E712
        .count()
    )


def verified_count(db) -> int:
    return (
        db.query(PhishingURLORM)
        .filter(PhishingURLORM.verified.in_(VERIFIED_IN))
        .count()
    )


def main() -> None:
    db = SessionLocal()
    try:
        # ── ДО ──────────────────────────────────────────────────────
        before_total = new24h(db)
        day_ago = func.datetime("now", "-1 day")
        before_spamhaus = (
            db.query(ThreatORM)
            .filter(ThreatORM.source == "Spamhaus DROP",
                    ThreatORM.published >= day_ago)
            .count()
        )
        before_verified = verified_count(db)
        phishtank_yes = (
            db.query(PhishingURLORM)
            .filter(PhishingURLORM.source == "PhishTank",
                    PhishingURLORM.verified == "yes")
            .count()
        )
        print(f"ДО:   new_24h={before_total} (Spamhaus DROP={before_spamhaus}, "
              f"{round(100 * before_spamhaus / max(before_total, 1))}%); "
              f"verified={before_verified}; PhishTank 'yes'={phishtank_yes}")

        anomaly_ratio = before_spamhaus / max(before_total, 1)
        print(f"      інваріант спотворення: spamhaus/new24h = "
              f"{anomaly_ratio:.2f} (>0.9 => backfill-спотворення підтверджено)")

        # ── РЕМОНТ ──────────────────────────────────────────────────
        n1 = (
            db.query(ThreatORM)
            .filter(ThreatORM.source.in_(BACKFILL_SOURCES),
                    ThreatORM.is_backfill == False)  # noqa: E712
            .update({ThreatORM.is_backfill: True},
                    synchronize_session=False)
        )
        n2 = (
            db.query(PhishingURLORM)
            .filter(PhishingURLORM.source == "PhishTank",
                    PhishingURLORM.verified == "yes")
            .update({PhishingURLORM.verified: "verified"},
                    synchronize_session=False)
        )
        db.commit()
        print(f"РЕМОНТ: threats.is_backfill=1 → {n1} рядків; "
              f"phishing verified yes→verified → {n2} рядків")

        # ── ПІСЛЯ ───────────────────────────────────────────────────
        after_total = new24h_v161(db)
        after_spamhaus = spamhaus_in_new24h(db)
        backfill_flagged = (
            db.query(ThreatORM)
            .filter(ThreatORM.is_backfill == True)  # noqa: E712
            .count()
        )
        after_verified = verified_count(db)
        total_urls = db.query(PhishingURLORM).count()
        print(f"ПІСЛЯ: new_24h={after_total} (було {before_total}); "
              f"Spamhaus у New24h: {after_spamhaus}; "
              f"is_backfill=1: {backfill_flagged} рядків; "
              f"verified={after_verified} із total_urls={total_urls}")

        ok = True
        # New24h впав на рівні Spamhaus-пачки і Spamhaus більше не в вікні.
        if not (after_total < before_total and after_spamhaus == 0):
            print("FAIL: New24h не очищено від backfill-джерела")
            ok = False
        # «Перевірено» = всі верифіковані джерела (OpenPhish auto +
        # PhishStats community + PhishTank verified).
        expected_verified = before_verified + phishtank_yes
        if after_verified != expected_verified or after_verified != total_urls:
            print(f"FAIL: verified={after_verified}, очікувалось "
                  f"{expected_verified} (= усім {total_urls})")
            ok = False
        print("RESULT:", "PASS" if ok else "FAIL")
        sys.exit(0 if ok else 1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
