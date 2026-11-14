"""
Геолокація IoC-інфраструктури (C2, шкідливі хости).

Мапа має судити ПРО АТАКУ, а не про розташування організації-джерела.
Тому для IoC (ThreatFox/URLhaus) визначаємо реальну країну:
  - якщо IoC — IP-адреса → геолокація напряму
  - якщо IoC — домен/URL → DNS-резолв у IP → геолокація

Сервіс: ip-api.com (безкоштовний, без ключа, HTTP). Batch — до 100 IP
за запит, ліміт ~15 запитів/хв на безкоштовному тарифі.
Результати кешуємо у data/geo_cache.json, щоб не резолвити повторно.
"""
import json
import logging
import os
import socket
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

logger = logging.getLogger(__name__)

GEO_API_BATCH = "http://ip-api.com/batch"
CACHE_PATH = Path(__file__).resolve().parent.parent / "data" / "geo_cache.json"

_cache: dict[str, str] | None = None  # ip -> country (ISO2)
_domain_cache: dict[str, str | None] = {}  # domain -> ip (або None, якщо не резолвиться)
_last_request = 0.0


def _load_cache() -> dict[str, str]:
    global _cache
    if _cache is None:
        try:
            if CACHE_PATH.exists():
                _cache = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
            else:
                _cache = {}
        except (OSError, ValueError):
            _cache = {}
    return _cache


def _save_cache() -> None:
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(json.dumps(_cache, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def _throttle() -> None:
    """Не частіше 2 batch-запитів на 8 секунд (межа ~15/хв)."""
    global _last_request
    elapsed = time.monotonic() - _last_request
    if elapsed < 4.0:
        time.sleep(4.0 - elapsed)
    _last_request = time.monotonic()


def resolve_domain(domain: str) -> str | None:
    """Резолв домену в IP (з кешем на рівні процесу)."""
    domain = domain.strip().lower().rstrip(".")
    if not domain or "." not in domain:
        return None
    if domain in _domain_cache:
        return _domain_cache[domain]
    try:
        ip = socket.gethostbyname(domain)
        _domain_cache[domain] = ip
        return ip
    except (socket.gaierror, OSError):
        _domain_cache[domain] = None
        return None


def country_for_ip(ip: str) -> str | None:
    """Геолокація IP → ISO2-код країни (з кешем на диску)."""
    cache = _load_cache()
    if ip in cache:
        return cache[ip] or None

    _throttle()
    try:
        resp = requests.post(
            GEO_API_BATCH,
            json=[ip],
            timeout=15,
            headers={"User-Agent": "ua-cyber-dashboard/0.1"},
        )
        data = resp.json()
        if isinstance(data, list) and data:
            rec = data[0]
            country = rec.get("countryCode") if rec.get("status") == "success" else None
        else:
            country = None
    except (requests.RequestException, ValueError, KeyError):
        country = None

    cache[ip] = country or ""
    _save_cache()
    return country or None


def country_for_value(value: str) -> str | None:
    """
    Країна за значенням IoC: IP → геолокація; домен/URL → резолв + геолокація.
    Повертає ISO2 (напр. "DE") або None, якщо визначити неможливо.
    """
    if not value:
        return None
    value = value.strip()

    # Якщо це URL — витягуємо hostname
    if "://" in value or value.startswith("www."):
        host = urlparse("//" + value if value.startswith("www.") else value).netloc
        value = host or value

    # Чи це IP-адреса?
    parts = value.split(".")
    is_ip = (
        len(parts) == 4
        and all(p.isdigit() and 0 <= int(p) <= 255 for p in parts)
    )

    if is_ip:
        return country_for_ip(value)

    ip = resolve_domain(value)
    if ip:
        return country_for_ip(ip)
    return None


def iso2_to_name(iso2: str) -> str:
    """ISO2 → англійська назва країни (для збереження у Threat.country)."""
    return ISO2_TO_NAME.get(iso2.upper(), iso2.upper())


ISO2_TO_NAME = {
    "AD": "Andorra", "AE": "UAE", "AF": "Afghanistan", "AL": "Albania",
    "AM": "Armenia", "AR": "Argentina", "AT": "Austria", "AU": "Australia",
    "AZ": "Azerbaijan", "BA": "Bosnia and Herzegovina", "BD": "Bangladesh",
    "BE": "Belgium", "BG": "Bulgaria", "BR": "Brazil", "BY": "Belarus",
    "CA": "Canada", "CH": "Switzerland", "CL": "Chile", "CM": "Cameroon",
    "CN": "China", "CO": "Colombia", "CR": "Costa Rica", "CY": "Cyprus",
    "CZ": "Czechia", "DE": "Germany", "DK": "Denmark", "DO": "Dominican Republic",
    "DZ": "Algeria", "EC": "Ecuador", "EE": "Estonia", "EG": "Egypt",
    "ES": "Spain", "ET": "Ethiopia", "FI": "Finland", "FR": "France",
    "GB": "United Kingdom", "GE": "Georgia", "GR": "Greece", "HK": "Hong Kong",
    "HR": "Croatia", "HU": "Hungary", "ID": "Indonesia", "IE": "Ireland",
    "IL": "Israel", "IN": "India", "IQ": "Iraq", "IR": "Iran", "IS": "Iceland",
    "IT": "Italy", "JP": "Japan", "KE": "Kenya", "KG": "Kyrgyzstan",
    "KR": "South Korea", "KZ": "Kazakhstan", "LB": "Lebanon",
    "LK": "Sri Lanka", "LT": "Lithuania", "LU": "Luxembourg",
    "LV": "Latvia", "MA": "Morocco", "MD": "Moldova", "ME": "Montenegro",
    "MK": "North Macedonia", "MX": "Mexico", "MY": "Malaysia",
    "NG": "Nigeria", "NL": "Netherlands", "NO": "Norway", "NP": "Nepal",
    "NZ": "New Zealand", "OM": "Oman", "PA": "Panama", "PE": "Peru",
    "PH": "Philippines", "PK": "Pakistan", "PL": "Poland", "PR": "Puerto Rico",
    "PT": "Portugal", "PY": "Paraguay", "QA": "Qatar", "RO": "Romania",
    "RS": "Serbia", "RU": "Russia", "SA": "Saudi Arabia", "SE": "Sweden",
    "SG": "Singapore", "SI": "Slovenia", "SK": "Slovakia", "TH": "Thailand",
    "TR": "Turkey", "TW": "Taiwan", "UA": "Ukraine", "UG": "Uganda",
    "US": "USA", "UY": "Uruguay", "UZ": "Uzbekistan", "VE": "Venezuela",
    "VN": "Vietnam", "ZA": "South Africa", "ZW": "Zimbabwe",
}
