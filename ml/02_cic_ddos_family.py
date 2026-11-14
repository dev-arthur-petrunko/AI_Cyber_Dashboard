"""
Експеримент 2: класифікація сімейств DDoS за CIC-DDoS2019.

Датасет: CIC-DDoS2019 (UNB Canadian Institute for Cybersecurity).
Розмічені флоу (80+ фіч CICFlowMeter-V3) з мітками за сімействами атак:
BENIGN, LDAP, MSSQL, NetBIOS, NTP, DNS, SNMP, Syn, UDP, UDP-lag,
Portmap, WebDDoS, TFTP та ін. Мультикласова класифікація.

Джерело: https://www.unb.ca/cic/datasets/ddos-2019.html
Дзеркало: https://data.mendeley.com/datasets/ssnc74xm6r/1 (CC BY 4.0)
Цитування: Sharafaldin et al., "Developing Realistic DDoS Attack Dataset
and Taxonomy", IEEE CCST 2019.

Кроки:
  1. Завантаження CSV з Mendeley (якщо немає).
  2. Очищення: NaN/Inf, константні фічі, дублікати.
  3. Стратифікований train/test split (80/20).
  4. Моделі: Random Forest, Gradient Boosting.
  5. Метрики per-class та загальні: accuracy, F1-weighted, F1-macro.
  6. Результат у ml/artifacts/cic_ddos_family_metrics.json.

Запуск: python ml/02_cic_ddos_family.py
"""
from __future__ import annotations

import json
import os
import urllib.request

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    f1_score,
)
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
ARTIFACTS_DIR = os.path.join(BASE_DIR, "artifacts")
CSV_PATH = os.path.join(DATA_DIR, "cic_ddos2019.csv")

# Mendeley mirror (CC BY 4.0) — UNB сторінка вимагає форму
MENDELEY_URL = (
    "https://data.mendeley.com/public-files/datasets/ssnc74xm6r/"
    "files/f52e4123-a298-44a0-a458-5c6f004b7513/file_downloaded"
)

# Підмножина датасету для швидкого запуску ( повний ~30 GB).
# Якщо CSV > 2 GB, беремо MAX_ROWS перших рядків.
MAX_ROWS = 2_000_000


def ensure_dataset() -> str:
    """Завантажує CSV, якщо його немає. Для великих файлів — попередження."""
    os.makedirs(DATA_DIR, exist_ok=True)
    if os.path.exists(CSV_PATH):
        size_mb = os.path.getsize(CSV_PATH) / (1024 * 1024)
        print(f"[data] CSV вже є: {size_mb:.0f} MB")
        return CSV_PATH

    print(f"[download] {MENDELEY_URL}")
    print("[download] Завантаження може зайняти кілька хвилин...")
    try:
        urllib.request.urlretrieve(MENDELEY_URL, CSV_PATH)
    except Exception as e:
        print(f"[error] Завантаження не вдалося: {e}")
        print("[info] Завантажте CSV вручну з https://data.mendeley.com/datasets/ssnc74xm6r/1")
        print(f"[info] та покладіть у {CSV_PATH}")
        raise SystemExit(1)

    size_mb = os.path.getsize(CSV_PATH) / (1024 * 1024)
    print(f"[download] Готово: {size_mb:.0f} MB")
    return CSV_PATH


def load_data(path: str) -> tuple[np.ndarray, np.ndarray, list[str], dict]:
    """Читає CSV, чистить і повертає X, y, імена фіч, зведення."""
    print("[load] Читання CSV...")
    df = pd.read_csv(path, nrows=MAX_ROWS, low_memory=False)
    print(f"[load] Завантажено {len(df)} рядків, {df.shape[1]} колонок")

    before = len(df)
    df = df.drop_duplicates()
    print(f"[clean] Дублікати: {before} -> {len(df)} (видалено {before - len(df)})")

    # Визначаємо колонку з міткою (LABEL або Label)
    label_col = None
    for col in ("LABEL", "Label", "label"):
        if col in df.columns:
            label_col = col
            break
    if label_col is None:
        # Беремо останню колонку як мітку (стандарт CIC)
        label_col = df.columns[-1]
        print(f"[warn] Колонка мітки не знайдена, використовуємо '{label_col}'")

    # Зображення міток
    df[label_col] = df[label_col].astype(str).str.strip()
    label_counts = df[label_col].value_counts()
    print(f"[data] Класи ({len(label_counts)}):")
    for lbl, cnt in label_counts.head(15).items():
        print(f"  {lbl}: {cnt}")
    if len(label_counts) > 15:
        print(f"  ... та ще {len(label_counts) - 15} класів")

    summary = {
        "rows": int(len(df)),
        "cols_total": int(df.shape[1]),
        "num_classes": int(len(label_counts)),
        "label_counts": {str(k): int(v) for k, v in label_counts.items()},
        "nulls": int(df.isna().sum().sum()),
    }

    # Кодуємо мітки в числа
    le = LabelEncoder()
    y = le.fit_transform(df[label_col].values)
    class_names = list(le.classes_)

    # Видаляємо некласифіковані фічі
    drop_cols = [label_col]
    for col in ("Flow ID", "Src IP", "Dst IP", "Timestamp"):
        if col in df.columns:
            drop_cols.append(col)
    X = df.drop(columns=[c for c in drop_cols if c in df.columns], errors="ignore")

    # Константні та нечислові фічі
    numeric_cols = X.select_dtypes(include=[np.number]).columns.tolist()
    X = X[numeric_cols]

    constant = [c for c in X.columns if X[c].nunique() <= 1]
    if constant:
        print(f"[clean] Видалено {len(constant)} константних фіч")
        X = X.drop(columns=constant)

    feature_names = list(X.columns)
    X = X.to_numpy(dtype=np.float64)
    X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
    summary["features"] = int(X.shape[1])
    summary["class_names"] = class_names

    print(f"[data] Підсумок: {X.shape[0]} рядків, {X.shape[1]} фіч, {len(class_names)} класів")
    return X, y, feature_names, summary


def main() -> None:
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)

    path = ensure_dataset()
    X, y, feature_names, summary = load_data(path)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"[split] train={X_train.shape[0]} test={X_test.shape[0]}")

    results: list[dict] = []

    # Модель 1: Random Forest
    print("[train] Random Forest...")
    rf = RandomForestClassifier(
        n_estimators=200, max_depth=24, min_samples_leaf=2,
        n_jobs=-1, random_state=42, class_weight="balanced",
    )
    rf.fit(X_train, y_train)
    y_pred_rf = rf.predict(X_test)
    rf_report = classification_report(y_test, y_pred_rf, target_names=summary["class_names"], zero_division=0, output_dict=True)
    results.append({
        "model": "random_forest",
        "accuracy": round(float(accuracy_score(y_test, y_pred_rf)), 4),
        "f1_weighted": round(float(f1_score(y_test, y_pred_rf, average="weighted", zero_division=0)), 4),
        "f1_macro": round(float(f1_score(y_test, y_pred_rf, average="macro", zero_division=0)), 4),
        "per_class": {
            lbl: {"precision": round(metrics["precision"], 4), "recall": round(metrics["recall"], 4), "f1": round(metrics["f1-score"], 4), "support": int(metrics["support"])}
            for lbl, metrics in rf_report.items()
            if lbl in summary["class_names"]
        },
    })
    print("[done] random_forest")

    # Модель 2: Gradient Boosting
    print("[train] Gradient Boosting...")
    gb = GradientBoostingClassifier(
        n_estimators=150, max_depth=6, learning_rate=0.1, random_state=42
    )
    gb.fit(X_train, y_train)
    y_pred_gb = gb.predict(X_test)
    gb_report = classification_report(y_test, y_pred_gb, target_names=summary["class_names"], zero_division=0, output_dict=True)
    results.append({
        "model": "gradient_boosting",
        "accuracy": round(float(accuracy_score(y_test, y_pred_gb)), 4),
        "f1_weighted": round(float(f1_score(y_test, y_pred_gb, average="weighted", zero_division=0)), 4),
        "f1_macro": round(float(f1_score(y_test, y_pred_gb, average="macro", zero_division=0)), 4),
        "per_class": {
            lbl: {"precision": round(metrics["precision"], 4), "recall": round(metrics["recall"], 4), "f1": round(metrics["f1-score"], 4), "support": int(metrics["support"])}
            for lbl, metrics in gb_report.items()
            if lbl in summary["class_names"]
        },
    })
    print("[done] gradient_boosting")

    # Топ-10 фічів за важливістю (RF)
    feature_importance = sorted(
        zip(feature_names, rf.feature_importances_),
        key=lambda x: x[1], reverse=True,
    )[:10]

    output = {
        "dataset": "CIC-DDoS2019",
        "source": "https://www.unb.ca/cic/datasets/ddos-2019.html",
        "mirror": "https://data.mendeley.com/datasets/ssnc74xm6r/1",
        "license": "Free redistribution with citation (UNB CIC)",
        "citation": "Sharafaldin et al., IEEE CCST 2019",
        "split": "train_test 80/20 stratified, seed=42",
        "summary": {k: v for k, v in summary.items() if k != "class_names"},
        "class_names": summary["class_names"],
        "models": results,
        "top_features": [{"name": n, "importance": round(float(v), 4)} for n, v in feature_importance],
    }
    out_path = os.path.join(ARTIFACTS_DIR, "cic_ddos_family_metrics.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print("\n=== RESULTS ===")
    for r in results:
        print(
            f"  {r['model']:>20}: acc={r['accuracy']:.4f} "
            f"f1_w={r['f1_weighted']:.4f} f1_m={r['f1_macro']:.4f}"
        )
    print(f"\n=== TOP FEATURES (RF) ===")
    for name, imp in feature_importance:
        print(f"  {name}: {imp:.4f}")
    print(f"\nSaved -> {out_path}")


if __name__ == "__main__":
    main()
