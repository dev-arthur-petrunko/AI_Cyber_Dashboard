"""
Експеримент 4: оцінка детекторів аномалій на MAWILab.

Датасет: MAWILab - еталонні мітки аномалій у трафіку WIDE/MAWI
(samplepoint F, щоденний транзитний лінк WIDE).
Операцію MAWILab припинено у грудні 2024 - архів 2006-2024.

Мітки: anomalous / suspicious / notice (3 класи).
Таксономія: DoS, DDoS, port scan, network scan, alpha flow, HTTP та ін.
Формат CSV: anomalyID, srcIP, srcPort, dstIP, dstPort, taxonomy,
             heuristic, distance, nbDetectors, label.

Кроки:
  1. Завантаження CSV-міток за кілька днів (2022-2024).
  2. Аналіз розподілу міток за типами аномалій.
  3. Оцінка детектора за кількістю репортерів (nbDetectors) як baseline.
  4. Аналіз DDoS-подібних аномалій окремо.
  5. Результат у ml/artifacts/mawilab_anomaly_metrics.json.

Джерело: http://www.fukuda-lab.org/mawilab/
Ліцензія: Академічне використання, обов'язкове посилання:
  Fontugne et al., "MAWILab: Combining diverse anomaly detectors
  for automated anomaly labeling and performance benchmarking",
  ACM CoNEXT 2010.

Запуск: python ml/04_mawilab_anomaly.py
"""
from __future__ import annotations

import csv
import io
import json
import os
import urllib.request
from collections import Counter

import numpy as np
from sklearn.metrics import f1_score, precision_score, recall_score

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data", "mawilab")
ARTIFACTS_DIR = os.path.join(BASE_DIR, "artifacts")

BASE_URL = "http://mawi.wide.ad.jp/mawi/ditl"
ALT_URL = "http://www.fukuda-lab.org/mawilab/data"

SAMPLE_DAYS = [
    ("2024", "20240115"), ("2024", "20240215"), ("2024", "20240315"),
    ("2024", "20240415"), ("2024", "20240515"), ("2024", "20240615"),
    ("2024", "20240715"), ("2024", "20240815"), ("2024", "20240915"),
    ("2024", "20241015"), ("2024", "20241115"), ("2024", "20241215"),
    ("2023", "20230115"), ("2023", "20230415"), ("2023", "20230715"),
    ("2023", "20231015"),
    ("2022", "20220115"), ("2022", "20220615"), ("2022", "20221215"),
]

DOS_PREFIXES = ("DoS", "distributed_dos", "ptpDoS", "sptpDoS", "DDoS", "rflat")


def _fmt_date(date: str) -> str:
    return f"{date[:4]}-{date[4:6]}-{date[6:]}"


def download_csv(year: str, date: str) -> str | None:
    os.makedirs(DATA_DIR, exist_ok=True)
    out_path = os.path.join(DATA_DIR, f"{date}.csv")
    if os.path.exists(out_path) and os.path.getsize(out_path) > 100:
        return out_path

    urls = [
        f"{BASE_URL}/{year}/{_fmt_date(date)}.csv",
        f"{ALT_URL}/{year}/{date}.csv",
    ]
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "UA-Cyber-Dashboard-ML/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
            with open(out_path, "wb") as f:
                f.write(data)
            return out_path
        except Exception:
            continue
    return None


def load_all_labels() -> list[dict]:
    all_records: list[dict] = []
    downloaded, failed = 0, 0

    for year, date in SAMPLE_DAYS:
        path = download_csv(year, date)
        if path is None:
            failed += 1
            continue
        downloaded += 1
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            reader = csv.DictReader(io.StringIO(content))
            for row in reader:
                row["_date"] = date
                all_records.append(row)
        except Exception:
            continue

    print(f"[data] Завантажено {downloaded} файлів (невдало: {failed})")
    print(f"[data] Всього записів: {len(all_records)}")
    return all_records


def is_dos_taxonomy(taxonomy: str) -> bool:
    t = taxonomy.strip().lower()
    return any(t.startswith(p.lower()) for p in DOS_PREFIXES)


def main() -> None:
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)

    records = load_all_labels()
    if not records:
        print("[error] Немає даних для аналізу")
        return

    # --- Аналіз розподілу міток ---
    label_counts = Counter(r.get("label", "unknown").strip().lower() for r in records)
    taxonomy_counts = Counter(r.get("taxonomy", "unknown").strip() for r in records)

    print("\n=== РОЗПОДІЛ МІТОК ===")
    for lbl, cnt in label_counts.most_common():
        print(f"  {lbl}: {cnt} ({cnt / len(records) * 100:.1f}%)")

    print(f"\n=== ТОП-15 ТАКСОНОМІЙ ===")
    for tax, cnt in taxonomy_counts.most_common(15):
        is_dos = " [DDoS]" if is_dos_taxonomy(tax) else ""
        print(f"  {tax}: {cnt}{is_dos}")

    # --- Бінарна мітка: anomalous vs не-anomalous ---
    y_true = np.array([
        1 if r.get("label", "").strip().lower() == "anomalous" else 0
        for r in records
    ])
    nb_detectors = np.array([
        int(r.get("nbDetectors", 0) or 0) for r in records
    ])

    n_anomalous = int(y_true.sum())
    n_total = len(y_true)
    print(f"\n=== ANOMALOUS vs NORMAL ===")
    print(f"  Anomalous: {n_anomalous} / {n_total} ({n_anomalous / n_total * 100:.1f}%)")

    # --- Baseline: детектор за порогом nbDetectors ---
    detector_results = []
    thresholds = [1, 2, 3, 5, 8, 10, 15, 20]

    print(f"\n=== DETECTOR (nbDetectors threshold) ===")
    for thr in thresholds:
        y_pred = (nb_detectors >= thr).astype(int)
        if y_pred.sum() == 0:
            continue
        prec = float(precision_score(y_true, y_pred, zero_division=0))
        rec = float(recall_score(y_true, y_pred, zero_division=0))
        f1 = float(f1_score(y_true, y_pred, zero_division=0))
        detector_results.append({
            "threshold": thr,
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "f1": round(f1, 4),
            "predicted_positives": int(y_pred.sum()),
        })
        print(f"  thr={thr:>2}: prec={prec:.3f} rec={rec:.3f} f1={f1:.3f} (pred={y_pred.sum()})")

    # --- DDoS-подібні аномалії ---
    dos_mask = np.array([is_dos_taxonomy(r.get("taxonomy", "")) for r in records])
    n_dos = int(dos_mask.sum())
    n_dos_anomalous = int((dos_mask & (y_true == 1)).sum())

    print(f"\n=== DDoS-ПОДІБНІ АНОМАЛІЇ ===")
    print(f"  Всього DDoS-записів: {n_dos}")
    print(f"  Anomalous DDoS: {n_dos_anomalous}")

    # Розподіл DDoS за підтипами
    dos_taxonomies = Counter()
    for r in records:
        if is_dos_taxonomy(r.get("taxonomy", "")):
            dos_taxonomies[r.get("taxonomy", "unknown").strip()] += 1
    print(f"  Підтипи:")
    for tax, cnt in dos_taxonomies.most_common():
        print(f"    {tax}: {cnt}")

    # --- Збереження результатів ---
    output = {
        "dataset": "MAWILab",
        "source": "http://www.fukuda-lab.org/mawilab/",
        "archive": "http://mawi.wide.ad.jp/mawi/",
        "license": "Academic use, citation required (Fontugne et al., ACM CoNEXT 2010)",
        "status": "Operation terminated December 2024; archive 2006-2024",
        "sample_days": len(SAMPLE_DAYS),
        "total_records": n_total,
        "label_distribution": {k: v for k, v in label_counts.items()},
        "top_taxonomies": {k: v for k, v in taxonomy_counts.most_common(20)},
        "anomalous_count": n_anomalous,
        "anomalous_pct": round(n_anomalous / n_total * 100, 2) if n_total else 0,
        "ddos_related": {
            "total": n_dos,
            "anomalous": n_dos_anomalous,
            "subtypes": dict(dos_taxonomies.most_common()),
        },
        "detector_baseline": detector_results,
    }

    out_path = os.path.join(ARTIFACTS_DIR, "mawilab_anomaly_metrics.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\nSaved -> {out_path}")


if __name__ == "__main__":
    main()
