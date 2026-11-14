"""
Експеримент 3: профілювання реальної DDoS-атаки (CAIDA "DDoS Attack 2007").

Дані: ~1 година анонімізованого трафіку реальної атаки 04.08.2007
(publicdata.caida.org/datasets/security/ddos-20070804/). Сплити по 5 хв,
pcap.gz, пейлоад видалено, адреси анонімізовано (CryptoPAn).

ВАЖЛИВО (чесне застереження): у трейсі НЕМАЄ "нормального" фону —
лишили лише атаку та відповіді жертви. Тому це НЕ тест детектора,
а профілювання реальної атаки: bursty-структура, раптовий спалах,
частота пакетів, ентропія джерел, частка SYN. Висновок про те, що
synthetic-бенчмарки (AISED/CIC) завищені порівняно з реальністю,
будується на контрасті цих профілів.

Режим "quick" (за замовчуванням): тихі файли початку атаки (малі,
~5 МБ) + перший піковий файл (перехід до атаки). Кожен файл парситься
з обмеженням MAX_PACKETS.

Кроки:
  1. Скачування файлів (перевірка за розміром, md5 не передбачено CAIDA).
  2. Парсинг pcap (dpkt) -> посекундні агрегати:
     pps, bps, унікальні src, середній розмір пакета, частка SYN,
     ентропія джерел (Shannon).
  3. Аномалії: z-score по pps + Isolation Forest по векторах секунд.
  4. Результат у ml/artifacts/caida_profile.json.

Запуск: python ml/03_caida_attack_profile.py
"""
from __future__ import annotations

import gzip
import json
import math
import os
import urllib.request

import dpkt
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data", "caida")
ARTIFACTS_DIR = os.path.join(BASE_DIR, "artifacts")
BASE_URL = "https://publicdata.caida.org/datasets/security/ddos-20070804/"

SMALL_FILE_LIMIT = 20 * 1024 * 1024  # "тихі" файли — до 20 МБ
PEAK_MIN_SIZE = 300 * 1024 * 1024    # пікові — від 300 МБ (беремо перший)
MAX_PACKETS = 4_000_000              # ліміт пакетів на файл (для швидкого запуску)


def list_traces() -> list[tuple[str, int]]:
    """Список (filename, size) з каталогу CAIDA."""
    req = urllib.request.Request(BASE_URL, headers={"User-Agent": "Mozilla/5.0"})
    html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")
    import re

    gzs = sorted(re.findall(r'href="([^"]+\.pcap\.gz)"', html))
    out: list[tuple[str, int]] = []
    for g in gzs:
        r = urllib.request.urlopen(
            urllib.request.Request(BASE_URL + g, method="HEAD"), timeout=30
        )
        out.append((g, int(r.headers.get("Content-Length", 0))))
    return out


def ensure_file(name: str, size: int) -> str:
    """Скачує файл, якщо його ще немає з очікуваним розміром."""
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, name)
    if not os.path.exists(path) or os.path.getsize(path) != size:
        print(f"  [download] {name} ({size / 1e6:.1f} MB)")
        urllib.request.urlretrieve(BASE_URL + name, path)
    return path


def parse_pcap(path: str) -> list[dict]:
    """
    Парсинг одного pcap.gz -> посекундні агрегати.
    Трейс CAIDA 2007 — raw IPv4 (linktype RAW); IPv6 ігноруємо.
    """
    per_sec: dict[int, dict] = {}
    src_counts: dict[int, dict] = {}
    total_packets = 0

    with gzip.open(path, "rb") as f:
        try:
            reader = dpkt.pcap.Reader(f)
        except Exception as e:
            print(f"  [warn] cannot open {path}: {e}")
            return []
        for ts, buf in reader:
            total_packets += 1
            if total_packets > MAX_PACKETS:
                break
            sec = int(ts)
            try:
                if buf[0] >> 4 != 4:
                    continue
                ip = dpkt.ip.IP(buf)
                if ip.p == dpkt.ip.IP_PROTO_TCP:
                    flags = getattr(ip.data, "flags", 0)
                    syn = bool(flags & dpkt.tcp.TH_SYN) and not (flags & dpkt.tcp.TH_ACK)
                else:
                    syn = False
                iplen = int(ip.len) if ip.len else len(buf)
                src = ip.src
            except Exception:
                continue

            agg = per_sec.setdefault(
                sec,
                {"packets": 0, "bytes": 0, "syn": 0},
            )
            agg["packets"] += 1
            agg["bytes"] += iplen
            agg["syn"] += 1 if syn else 0
            counts = src_counts.setdefault(sec, {})
            counts[src] = counts.get(src, 0) + 1

    rows: list[dict] = []
    for sec in sorted(per_sec):
        a = per_sec[sec]
        counts = src_counts.get(sec, {})
        n = a["packets"]
        ent = -sum((c / n) * math.log2(c / n) for c in counts.values()) if n else 0.0
        rows.append(
            {
                "ts": sec,
                "packets": a["packets"],
                "bytes": a["bytes"],
                "unique_src": len(counts),
                "avg_size": round(a["bytes"] / n, 2) if n else 0.0,
                "syn_frac": round(a["syn"] / n, 4) if n else 0.0,
                "src_entropy": round(ent, 4),
            }
        )
    print(
        f"  [parsed] {os.path.basename(path)}: {total_packets} pkts read, "
        f"{len(rows)} seconds"
    )
    return rows


def score_anomalies(rows: list[dict]) -> list[dict]:
    """z-score по pps + Isolation Forest по вектору секунд."""
    base = sorted(rows, key=lambda r: r["ts"])
    if len(base) < 10:
        for r in base:
            r["z_pps"] = 0.0
            r["iso_score"] = 0.0
            r["anomaly"] = False
        return base

    pps = np.array([r["packets"] for r in base], dtype=float)
    mean, std = pps.mean(), pps.std()
    z = (pps - mean) / std if std > 0 else np.zeros_like(pps)

    feats = np.array(
        [
            [r["packets"], r["unique_src"], r["avg_size"], r["syn_frac"], r["src_entropy"]]
            for r in base
        ],
        dtype=float,
    )
    model = IsolationForest(
        n_estimators=200, contamination="auto", random_state=42, n_jobs=-1
    ).fit(StandardScaler().fit_transform(feats))
    iso = model.score_samples(StandardScaler().fit_transform(feats))

    for r, zz, sc in zip(base, z, iso):
        r["z_pps"] = round(float(zz), 3)
        r["iso_score"] = round(float(sc), 3)
        r["anomaly"] = bool(zz > 3.0 or sc < np.percentile(iso, 10))
    return base


def main() -> None:
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)
    traces = list_traces()
    print(f"[traces] {len(traces)} files, total {sum(s for _, s in traces) / 1e6:.0f} MB")

    small = [(n, s) for n, s in traces if 0 < s < SMALL_FILE_LIMIT]
    peak = next((n, s) for n, s in traces if s >= PEAK_MIN_SIZE)
    selected = small + [peak]
    print(f"[select] {len(small)} quiet file(s) + peak {peak[0]} ({peak[1] / 1e6:.0f} MB)")

    all_rows: list[dict] = []
    for name, size in selected:
        path = ensure_file(name, size)
        all_rows.extend(parse_pcap(path))

    profiled = score_anomalies(all_rows)
    profiled.sort(key=lambda r: r["ts"])

    ts = np.array([r["ts"] for r in profiled])
    pk = np.array([r["packets"] for r in profiled])
    peak_i = int(pk.argmax())

    top = sorted(profiled, key=lambda r: r["packets"], reverse=True)[:10]
    anomalies = [r for r in profiled if r["anomaly"]]

    output = {
        "dataset": "CAIDA DDoS Attack 2007",
        "source": "https://www.caida.org/catalog/datasets/ddos-20070804_dataset/",
        "license": "CAIDA Acceptable Use Agreement (публічне завантаження з 08/2025)",
        "caveat": "Трейс містить ТІЛЬКИ трафік атаки + відповіді жертви. Це профіль атаки, а не тест-бенчмарк детектора.",
        "profile": {
            "seconds": len(profiled),
            "start_ts": int(ts.min()),
            "end_ts": int(ts.max()),
            "peak_second": int(ts[peak_i]),
            "peak_packets_per_sec": int(pk[peak_i]),
            "peak_bps": int(profiled[peak_i]["bytes"] * 8),
            "max_unique_src_per_sec": int(max(r["unique_src"] for r in profiled)),
            "top_seconds": [
                {
                    "ts": r["ts"],
                    "packets": r["packets"],
                    "pps_k": round(r["packets"] / 1000, 1),
                    "unique_src": r["unique_src"],
                    "syn_frac": r["syn_frac"],
                    "z_pps": r["z_pps"],
                }
                for r in top
            ],
            "anomalous_seconds": len(anomalies),
        },
    }
    out_path = os.path.join(ARTIFACTS_DIR, "caida_profile.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print("\n=== PROFILE ===")
    print(f"seconds: {len(profiled)}  ({ts.min()} .. {ts.max()})")
    print(f"peak: second {ts[peak_i]}, {pk[peak_i]} pkt/s, "
          f"{profiled[peak_i]['bytes'] * 8} bit/s")
    print("top seconds:")
    for r in top:
        print(
            f"  ts={r['ts']} pps={r['packets']:>8} "
            f"srcs={r['unique_src']:>4} syn={r['syn_frac']:.2f} "
            f"z={r['z_pps']:+.1f} iso={'*' if r['anomaly'] else ' '}"
        )
    print(f"anomalous seconds (z>3 or iso<10pct): {len(anomalies)}")
    print(f"\nSaved -> {out_path}")


if __name__ == "__main__":
    main()
