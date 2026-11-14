"""
Експеримент 1: базлайнові класифікатори на AISED (Cloud DDoS).

Датасет: 52 318 записів x 79 фіч, бінарна розмітка BENIGN/DDOS (CC BY 4.0,
Zenodo 14681803). "Готовий до ML без препроцесингу" — перевіряємо це та
фіксуємо baseline для подальших моделей.

Кроки:
  1. Завантаження CSV (якщо немає) + перевірка md5.
  2. Очищення: дублікати, константні фічі.
  3. Стратифікований train/test split (80/20).
  4. Базлайни: Logistic Regression (з масштабуванням) та Random Forest.
  5. Метрики: accuracy / precision / recall / F1 / ROC-AUC + confusion matrix.
  6. Результат у ml/artifacts/aised_metrics.json.

Запуск: python ml/01_aised_baseline.py
"""
from __future__ import annotations

import hashlib
import json
import os
import urllib.request

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
ARTIFACTS_DIR = os.path.join(BASE_DIR, "artifacts")
CSV_PATH = os.path.join(DATA_DIR, "aised.csv")
URL = (
    "https://zenodo.org/api/records/14681803/files/"
    "AIS%20Dataset%20on%20Cloud%20DDoS%20Attacks.csv/content"
)
EXPECTED_MD5 = "054d8bd6a77af9be7bdb1d648dc24b6e"
EXPECTED_SIZE = 15_488_132


def ensure_dataset() -> str:
    """Завантажує датасет, якщо його немає або він не збігається за розміром/md5."""
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(CSV_PATH) or os.path.getsize(CSV_PATH) != EXPECTED_SIZE:
        print(f"[download] {URL}")
        urllib.request.urlretrieve(URL, CSV_PATH)
    digest = hashlib.md5(open(CSV_PATH, "rb").read()).hexdigest()
    assert digest == EXPECTED_MD5, f"md5 mismatch: {digest}"
    return CSV_PATH


def load_data(path: str) -> tuple[np.ndarray, np.ndarray, list[str], dict]:
    """Читає CSV, чистить і повертає X, y, імена фіч та зведення."""
    df = pd.read_csv(path)

    before = len(df)
    df = df.drop_duplicates()
    print(f"[clean] rows: {before} -> {len(df)} (dupes removed: {before - len(df)})")

    summary = {
        "rows": int(len(df)),
        "cols_total": int(df.shape[1]),
        "label_counts": df["label"].value_counts(dropna=False).to_dict(),
        "nulls": int(df.isna().sum().sum()),
    }

    y = (df["label"].str.strip().str.upper() == "DDOS").astype(int).to_numpy()
    X = df.drop(columns=["label"])

    # Константні фічі марні для будь-якої моделі.
    constant = [c for c in X.columns if X[c].nunique() <= 1]
    if constant:
        print(f"[clean] dropping {len(constant)} constant features")
        X = X.drop(columns=constant)

    feature_names = list(X.columns)
    X = X.to_numpy(dtype=np.float64)
    X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
    summary["features"] = int(X.shape[1])
    return X, y, feature_names, summary


def evaluate(name: str, y_true: np.ndarray, y_pred: np.ndarray, y_prob: np.ndarray) -> dict:
    tn, fp, fn, tp = confusion_matrix(y_true, y_pred).ravel()
    return {
        "model": name,
        "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
        "precision": round(float(precision_score(y_true, y_pred)), 4),
        "recall": round(float(recall_score(y_true, y_pred)), 4),
        "f1": round(float(f1_score(y_true, y_pred)), 4),
        "roc_auc": round(float(roc_auc_score(y_true, y_prob)), 4),
        "confusion_matrix": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }


def main() -> None:
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)

    path = ensure_dataset()
    X, y, feature_names, summary = load_data(path)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    print(f"[split] train={X_train.shape[0]} test={X_test.shape[0]}")

    results: list[dict] = []

    # Базлайн 1: логістична регресія (потребує стандартизації).
    lr = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000))
    lr.fit(X_train, y_train)
    y_prob_lr = lr.predict_proba(X_test)[:, 1]
    results.append(evaluate("logistic_regression", y_test, (y_prob_lr >= 0.5).astype(int), y_prob_lr))
    print("[done] logistic_regression")

    # Базлайн 2: Random Forest (без масштабування).
    rf = RandomForestClassifier(
        n_estimators=300, max_depth=28, min_samples_leaf=2, n_jobs=-1, random_state=42
    )
    rf.fit(X_train, y_train)
    y_prob_rf = rf.predict_proba(X_test)[:, 1]
    results.append(evaluate("random_forest", y_test, (y_prob_rf >= 0.5).astype(int), y_prob_rf))
    print("[done] random_forest")

    output = {
        "dataset": "AISED",
        "source": "https://zenodo.org/records/14681803",
        "license": "CC BY 4.0",
        "split": "train_test 80/20 stratified, seed=42",
        "summary": summary,
        "models": results,
    }
    out_path = os.path.join(ARTIFACTS_DIR, "aised_metrics.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print("\n=== RESULTS ===")
    for r in results:
        print(
            f"{r['model']:>20}: acc={r['accuracy']:.4f} prec={r['precision']:.4f} "
            f"rec={r['recall']:.4f} f1={r['f1']:.4f} roc_auc={r['roc_auc']:.4f} "
            f"cm={r['confusion_matrix']}"
        )
    print(f"\nSaved -> {out_path}")


if __name__ == "__main__":
    main()
