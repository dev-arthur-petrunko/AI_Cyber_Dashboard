"""
Колектор OFAC SDN (Specially Designated Nationals) — санкції Мінфіну США.

Джерело: https://ofac.treasury.gov/sanctions-list-service
Формат: SDN List XML (офіційний дзеркальний експорт)
Ліцензія: Public domain (US Government)

ВАЖЛИВО (v1.5.2): старий JSON-ендпоінт
`https://www.treasury.gov/ofac/downloads/sdn.json` більше не існує (404), а
офіційний API `.../api/download/sdn.json` віддає порожній файл (0 байт) —
через це колектор постійно падав з «404 Client Error». Робочим залишається
XML-експорт (≈29 MB, 19 484 записи) — парсимо його.

Записи створюються як advisory-загрози з тегами 'sanctions', 'ofac',
щоб відображати зв'язок між APT-групами та санкційними особами.
"""
import logging
import re
import xml.etree.ElementTree as ET
from typing import Any

import requests

from app.collectors.base import BaseCollector
from app.db import now_utc
from app.models.threat import Region, Severity, Threat, ThreatType

logger = logging.getLogger(__name__)

SOURCE_NAME = "OFAC SDN"
LICENSE = "Public Domain (US Treasury)"

# SDN List XML (офіційний mirror; JSON-URL мертвий → 404/порожній)
SDN_URL = "https://sanctionslistservice.ofac.treas.gov/api/download/sdn.xml"
# Page used as a human-readable link inside created records.
SDN_PAGE = "https://ofac.treasury.gov/sanctions-list-service"

# Мапінг APT-груп -> назви, які зустрічаються в SDN list
APT_TO_SDN_ALIASES = {
    "Sandworm": ["sandworm", "voodoo bear", "fancy bear"],
    "APT28": ["apt28", "fancy bear", "sofacy", "sednit", "pawn storm"],
    "APT29": ["apt29", "cozy bear", "midnight blizzard", "the dukes"],
    # "zinc" прибрано: word-boundary ловив «IRAN ZINC MINES», «KOREA ZINC
    # INDUSTRIAL GROUP» — звичайні гірничі компанії, не APT.
    "Lazarus": ["lazarus", "hidden cobra"],
    "Kimsuky": ["kimsuky", "emerald sleet", "thallium"],
    "Gamaredon": ["gamaredon", "shuckworm", "primitive bear"],
    "Turla": ["turla", "venomous bear"],
    "Volt Typhoon": ["volt typhoon"],
    "Mustang Panda": ["mustang panda", "emissary panda"],
    "Ghostwriter": ["ghostwriter"],
    "Dark Crystal": ["dark crystal"],
    "Vermin": ["vermin"],
    "Charming Kitten": ["charming kitten", "apt35", "phosphorus", "oilrig"],
    "APT41": ["apt41", "double dragon", "winnti group"],
    "Hafnium": ["hafnium"],
    "DarkSide": ["darkside"],
    "REvil": ["revil", "sodinokibi"],
    "Conti": ["conti"],
    "TrickBot": ["trickbot"],
    "Fancy Bear": ["fancy bear", "apt28", "sofacy"],
}

# Ключові слова для пошуку в SDN entries — ЛИШЕ явно кібернетичні.
# Прибрано russia/iran/china/dprk/military/defense/intelligence: вони
# давали ~8200 хибних збігів (кожне «Міноборони» чи «ISNA» ставало
# «загрозою») — база зростала на +42% за прогін із нулем інформації.
CYBER_KEYWORDS = [
    "hacker", "cyber", "malware", "ransomware", "botnet", "espionage",
]

# Країни, пов'язані з кібер-загрозами
CYBER_COUNTRIES = {
    "russia": "Russia",
    "iran": "Iran",
    "china": "China",
    "north korea": "DPRK",
    "dprk": "DPRK",
    "кремль": "Russia",
    "moscow": "Russia",
    "tehran": "Iran",
    "pyongyang": "DPRK",
}


def _local(tag: str) -> str:
    """Ім'я тега без XML-namespace (у SDN є default namespace)."""
    return tag.rsplit("}", 1)[-1]


def _kids(node: ET.Element) -> list[ET.Element]:
    return list(node)


def _text(node: ET.Element | None) -> str:
    return (node.text or "").strip() if node is not None else ""


def _child_text(parent: ET.Element, name: str) -> str:
    for c in _kids(parent):
        if _local(c.tag) == name:
            return _text(c)
    return ""


def parse_sdn_xml(content: bytes) -> list[dict[str, Any]]:
    """Парсить SDN List XML у плоскі записи (ті самі ключі, що мав JSON).

    Повертає список dict: uid, sdn_name, sdn_type, programs, aliases,
    address, nationality, identifier — достатньо для _match_apt /
    _detect_countries / _is_cyber_relevant нижче.
    """
    root = ET.fromstring(content)
    out: list[dict[str, Any]] = []
    for entry in _kids(root):
        if _local(entry.tag) != "sdnEntry":
            continue

        rec: dict[str, Any] = {
            "uid": "",
            "sdn_name": "",
            "sdn_type": "",
            "programs": [],
            "aliases": [],
            "address": "",
            "nationality": "",
            "identifier": "",
        }
        for part in _kids(entry):
            tag = _local(part.tag)
            if tag == "uid":
                rec["uid"] = _text(part)
            elif tag in ("lastName", "firstName", "sdnName"):
                # Головна назва/ПІБ
                rec["sdn_name"] = (rec["sdn_name"] + " " + _text(part)).strip()
            elif tag == "sdnType":
                rec["sdn_type"] = _text(part)
            elif tag == "programList":
                rec["programs"] = [
                    _text(p) for p in _kids(part) if _local(p.tag) == "program" and _text(p)
                ]
            elif tag == "akaList":
                # akaList/aka{firstName,lastName,type} → рядок "First Last"
                aka_names = []
                for aka in _kids(part):
                    if _local(aka.tag) != "aka":
                        continue
                    first = _child_text(aka, "firstName")
                    last = _child_text(aka, "lastName")
                    aka_names.append(" ".join(x for x in (first, last) if x).strip())
                rec["aliases"] = [n for n in aka_names if n]
            elif tag == "addressList":
                # addressList/address{addressLine,city,country,stateProv,postalCode}
                addr_bits = []
                for addr in _kids(part):
                    if _local(addr.tag) != "address":
                        continue
                    for f in _kids(addr):
                        ft = _local(f.tag)
                        if ft in ("addressLine", "city", "country", "stateProv", "postalCode"):
                            v = _text(f)
                            if v:
                                addr_bits.append(v)
                rec["address"] = ", ".join(addr_bits)
            elif tag == "citizenshipList":
                nats = [
                    _text(c) for c in _kids(part)
                    if _local(c.tag) in ("country", "citizenship") and _text(c)
                ]
                rec["nationality"] = ", ".join(nats)
            elif tag == "idList":
                # idList/id{id_number,id_type} — використовуємо id_number
                ids = []
                for i in _kids(part):
                    if _local(i.tag) != "id":
                        continue
                    num = _child_text(i, "id_number") or _text(i)
                    if num:
                        ids.append(num)
                rec["identifier"] = ", ".join(ids)
            elif tag == "programs":
                # Рідкісний випадок: programs без programList
                rec["programs"].extend(
                    _text(p) for p in _kids(part) if _text(p)
                )

        if not rec["sdn_name"]:
            # Fallback: спробувати взяти будь-який підпис-текст
            for part in _kids(entry):
                if _local(part.tag) in ("name", "title", "sdn_name"):
                    rec["sdn_name"] = _text(part)
                    break
        if rec["sdn_name"]:
            out.append(rec)
    return out


def _match_apt(sdn_entry: dict) -> list[str]:
    """Знайти APT-групи, пов'язані із записом SDN."""
    matched = []
    # Перевіряємо: name, aliases, remarks, titles
    search_fields = []
    for field in ["sdn_name", "sdn_type", "remarks", "title"]:
        if val := sdn_entry.get(field):
            search_fields.append(str(val).lower())
    for alias_list in sdn_entry.get("aliases", []):
        if isinstance(alias_list, list):
            search_fields.extend(a.lower() for a in alias_list)
        elif isinstance(alias_list, str):
            search_fields.append(alias_list.lower())
    # SDN JSON v3.1: програми та ID
    for prog in sdn_entry.get("programs", []):
        search_fields.append(str(prog).lower())

    combined = " ".join(search_fields)
    for apt_name, patterns in APT_TO_SDN_ALIASES.items():
        for pat in patterns:
            # Word-boundary: «conti» НЕ має матчить CONTINENTE/CONTINUITY,
            # «lazarus» — тільки ціле слово. Раніше було голе `pat in combined`
            # і APT: Conti отримувала «AERO CONTINENTE S.A» (severity=High).
            if re.search(rf"(?<![\w-]){re.escape(pat)}(?![\w-])", combined):
                matched.append(apt_name)
                break
    return list(set(matched))


def _detect_countries(sdn_entry: dict) -> list[str]:
    """Визначити країни із запису SDN."""
    countries = []
    search_fields = []
    for field in ["sdn_name", "remarks", "title", "nationality",
                  "citizenship", "address", "passport", "identifier"]:
        if val := sdn_entry.get(field):
            search_fields.append(str(val).lower())
    combined = " ".join(search_fields)
    for kw, cn in CYBER_COUNTRIES.items():
        if kw in combined:
            countries.append(cn)
    return list(set(countries))


def _is_cyber_relevant(sdn_entry: dict) -> bool:
    """Чи пов'язаний запис із кібернетичними загрозами."""
    search_fields = []
    for field in ["sdn_name", "remarks", "title", "sdn_type"]:
        if val := sdn_entry.get(field):
            search_fields.append(str(val).lower())
    for kw in CYBER_KEYWORDS:
        if kw in " ".join(search_fields):
            return True
    return False


class OFACSDNCollector(BaseCollector):
    source_name = SOURCE_NAME

    def fetch(self) -> list[Threat]:
        try:
            resp = requests.get(
                SDN_URL,
                timeout=120,
                headers={"User-Agent": "cyber-sentinel/1.0 (+ofac-collector)"},
            )
            resp.raise_for_status()
            entries = parse_sdn_xml(resp.content)
        except Exception as e:
            logger.error("OFAC SDN: fetch failed: %s", e)
            return []

        logger.info("OFAC SDN: %d entries total", len(entries))

        threats: list[Threat] = []
        for entry in entries:
            name = entry.get("sdn_name", "")
            entry_type = entry.get("sdn_type", "")
            remarks = entry.get("remarks", "")
            programs = entry.get("programs", [])
            uid = str(entry.get("uid", ""))

            if not name:
                continue

            # Лише пов'язані з кібернетичними загрозами. «or bool(countries)»
            # прибрано: країна (Russia/Iran/...) сама по собі не робить запис
            # кібер-загрозою — так у базу потрапило 8273 замість ~15.
            apt_match = _match_apt(entry)
            countries = _detect_countries(entry)
            is_cyber = _is_cyber_relevant(entry) or bool(apt_match)

            if not is_cyber:
                continue

            severity = Severity.high if apt_match else Severity.medium
            tags = ["sanctions", "ofac", "sdn", entry_type.lower()] + [
                a.lower() for a in apt_match
            ] + [c.lower() for c in countries]

            # Формуємо заголовок
            title = name
            if entry_type:
                title += f" ({entry_type})"
            if apt_match:
                title += f" — APT: {', '.join(apt_match)}"

            summary = f"OFAC SDN: {name}"
            if remarks:
                summary += f"\nRemarks: {remarks[:200]}"
            if programs:
                summary += f"\nPrograms: {', '.join(str(p) for p in programs[:5])}"

            threats.append(Threat(
                external_id=f"ofac-{uid}",
                title=title,
                source=SOURCE_NAME,
                type=ThreatType.advisory,
                severity=severity,
                region=Region.world,
                country=countries if countries else ["Unknown"],
                tags=tags,
                summary=summary[:500],
                url=SDN_PAGE,
                # SDN не має дати публікації для запису — підставляємо now()
                # і позначаємо is_backfill, щоб не завищувало new_cve_24h
                # (раніше тут було published=None, що падало на валідації
                # Threat.published: datetime — баг маскувався 404 на JSON URL).
                published=now_utc(),
                is_backfill=True,
            ))

        logger.info("OFAC SDN: %d cyber-relevant entries", len(threats))
        return threats
