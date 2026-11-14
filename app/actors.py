"""Детекція відомих груп-акторів у заголовках та зв'язок до країн-цілей.

Групи шукаються за назвами та псевдонімами у title + summary + tags.
Країна-ціль береться з поля country запису (геолокація IoC, країна-ціль).
Кожен актор має атрибутовану державу-спонсора (ACTOR_SPONSOR) — це дає
універсальну агрегацію «скільки задокументованих атак від імені держави X»
незалежно від того, кого атакували.
"""
import json
import re
from collections import Counter

from app.geoip import iso2_to_name

ACTORS: dict[str, re.Pattern[str]] = {
    name: re.compile(rx, re.IGNORECASE)
    for name, rx in {
        "Gamaredon": r"Gamaredon|Shuckworm|Primitive Bear|Armageddon",
        "Sandworm": r"Sandworm|Voodoo Bear",
        # «Snake» прибрано: матчить SnakeKeylogger (товарний кейлогер, не Turla).
        "Turla": r"Turla|Venomous Bear|Uroburos",
        # UAC-0001 — так CERT-UA називає кластер, відомий як APT28 / Fancy Bear:
        # один і той самий актор, тому не показуємо його окремим вузлом.
        "APT28": r"APT28|Fancy Bear|Sofacy|Sednit|Pawn Storm|UAC-0001",
        "APT29": r"APT29|Cozy Bear|Midnight Blizzard|The Dukes",
        "Lazarus": r"Lazarus|Hidden Cobra",
        "Kimsuky": r"Kimsuky|Emerald Sleet|Thallium",
        "Volt Typhoon": r"Volt Typhoon",
        "Mustang Panda": r"Mustang Panda|Emissary Panda",
        # UAC-0057 (CERT-UA) пов'язаний із Ghostwriter — аліас, не окрема група.
        "Ghostwriter": r"Ghostwriter|UAC-0057",
        "Dark Crystal": r"Dark Crystal",
        # UAC-0020 — так CERT-UA називає Vermin.
        "Vermin": r"Vermin|UAC-0020",
        # ── Розширення: універсальна атрибуція по всьому світу ──────────
        "Berserk Bear": r"Berserk Bear",
        "Star Blizzard": r"Star Blizzard|COLDRIVER",
        "APT33": r"APT33|Refined Kitten",
        "APT34": r"APT34|OilRig",
        "APT35": r"APT35|Charming Kitten",
        "APT37": r"APT37",
        "APT40": r"APT40",
        "APT41": r"APT41|Double Dragon",
        "Andariel": r"Andariel",
        "Winnti": r"Winnti",
        "UAC-0099": r"UAC-0099",
        "UAC-0145": r"UAC-0145",
        "UAC-0190": r"UAC-0190",
        "UAC-0239": r"UAC-0239",
        "UAC-0241": r"UAC-0241",
        "UAC-0244": r"UAC-0244",
        "UAC-0247": r"UAC-0247",
        "UAC-0252": r"UAC-0252",
        "UAC-0255": r"UAC-0255",
    }.items()
}

# UAC-номери, які є аліасами відомих груп у шаблонах вище.
# Вони НЕ повинні додаватись окремими вузлами (інакше подвійний підрахунок).
ALIAS_UAC_IDS: set[str] = {
    match.group(0).upper()
    for pattern in ACTORS.values()
    for match in re.finditer(r"UAC-\d+[A-Za-z]?", pattern.pattern)
}


def detect_actors(title: str | None) -> list[str]:
    """Повертає назви груп, знайдені у заголовку.

    Прискорення на великих обсягах (було ~4.8 c на 15 898 записів):
      1) prefilter — ОДИН прогін master-regex по рядку; записи без згадок
         акторів (це майже вся база) відсіюються одразу, без 31 перевірок;
      2) для рядків-кандидатів — ОДИН finditer + мапа alias→canon
         замість 31 окремого pattern.search.

    Семантика не змінюється: канонічне ім'я для альяса однозначне
    (перевірено: жоден альяс не належить двом акторам), порядок результатів —
    порядок словника ACTORS, як і раніше.
    """
    if not title:
        return []
    if not (_MASTER.search(title) or _UAC.search(title)):
        return []
    matched = {
        _ALIAS_TO_CANON[m.group(0).lower()]
        for m in _MASTER.finditer(title)
    }
    found = [canon for canon in _SEEN_CANON_ORDER if canon in matched]
    # UAC-* номери поза явним списком — детект як окремі групи.
    # Виключаємо ті, що є аліасами відомих груп (UAC-0001→APT28 тощо).
    found.extend(
        sorted(
            {
                match.group(0).upper()
                for match in _UAC.finditer(title)
            }
            - {name for name in found if name.startswith("UAC-")}
            - ALIAS_UAC_IDS
        )
    )
    return found


# Один зібраний regex для всіх альясів + мапа «альяс (lower) → канонічна назва».
# Побудова після ACTORS/ALIAS_UAC_IDS (див. вище).
_ALIAS_TO_CANON = {
    alt.strip().lower(): canon for canon, _pattern in ACTORS.items() for alt in _pattern.pattern.split("|")
}
_MASTER = re.compile("|".join(f"(?:{_pattern.pattern})" for _pattern in ACTORS.values()), re.IGNORECASE)
_UAC = re.compile(r"\bUAC-\d+[A-Za-z]?\b")
# Зберігаємо порядок ACTORS, щоб порядок результатів не змінювався.
_SEEN_CANON_ORDER = tuple(ACTORS)


# Відомі країни-цілі для груп. Використовується як фолбек, коли запис
# (зазвичай новина) не несе поле country: новини про Gamaredon/Sandworm/APT28
# не мають геолокації, але їхні реальні цілі відомі з відкритих звітів.
# Замість континентів («Europe»/«Asia») вказуємо конкретні країни,
# щоб Sankey показував країни, а не континент.
ACTOR_TARGETS: dict[str, list[str]] = {
    "Gamaredon": ["Ukraine"],
    "Sandworm": ["Ukraine", "Poland", "Germany", "France", "USA"],
    "Turla": ["Ukraine", "Germany", "France", "Italy", "USA"],
    "APT28": ["Ukraine", "Germany", "Poland", "Czechia", "USA"],
    "APT29": ["USA", "United Kingdom", "Germany", "Ukraine"],
    "Lazarus": ["USA", "South Korea", "Japan", "Hong Kong", "India"],
    "Kimsuky": ["South Korea", "USA", "Japan"],
    "Volt Typhoon": ["USA", "Australia", "Japan", "United Kingdom"],
    "Mustang Panda": ["Vietnam", "Philippines", "Mongolia", "Myanmar"],
    "Ghostwriter": ["Poland", "Ukraine", "Lithuania", "Latvia"],
    "Dark Crystal": ["Ukraine"],
    "Vermin": ["Ukraine"],
    # Розширення (універсальна атрибуція)
    "Berserk Bear": ["USA", "Germany", "United Kingdom", "Ukraine"],
    "Star Blizzard": ["United Kingdom", "USA", "Poland", "Ukraine"],
    "APT33": ["USA", "Saudi Arabia", "South Korea"],
    "APT34": ["Middle East", "United Arab Emirates", "Saudi Arabia"],
    "APT35": ["USA", "Israel", "United Kingdom"],
    "APT37": ["South Korea", "Japan", "USA"],
    "APT40": ["Australia", "USA", "Southeast Asia"],
    "APT41": ["USA", "United Kingdom", "Hong Kong"],
    "Andariel": ["South Korea", "USA"],
    "Winnti": ["Japan", "South Korea", "USA"],
}

# Українські групи (CERT-UA таксономія) працюють проти України за визначенням
UAC_TARGET = ["Ukraine"]

# Держава-спонсор актора (публічні атрибуції: CERT-UA, NIST, vendor reports).
# Універсальна система «actor → country-sponsor», застосовна до будь-якої
# держави, а не лише до одного конфлікту. Актори поза словником (динамічні
# UAC-*) потрапляють у кошик UNKNOWN_SPONSOR, щоб суми завжди сходились.
ACTOR_SPONSOR: dict[str, str] = {
    # Росія
    "Gamaredon": "Russia",
    "Sandworm": "Russia",
    "Turla": "Russia",
    "APT28": "Russia",
    "APT29": "Russia",
    "Berserk Bear": "Russia",
    "Star Blizzard": "Russia",
    "Vermin": "Russia",
    "Dark Crystal": "Russia",
    # Північна Корея
    "Lazarus": "North Korea",
    "Kimsuky": "North Korea",
    "APT37": "North Korea",
    "Andariel": "North Korea",
    # Китай
    "Volt Typhoon": "China",
    "Mustang Panda": "China",
    "APT40": "China",
    "APT41": "China",
    "Winnti": "China",
    # Іран
    "APT33": "Iran",
    "APT34": "Iran",
    "APT35": "Iran",
    # Білорусь
    "Ghostwriter": "Belarus",
    # CERT-UA UAC-* актори з публічними атрибуціями (Russia)
    "UAC-0063": "Russia",
    "UAC-0100": "Russia",
    "UAC-0106": "Russia",
    "UAC-0109": "Russia",
    "UAC-0118": "Russia",
    "UAC-0145": "Russia",
    "UAC-0190": "Russia",
    "UAC-0194": "Russia",
}

UNKNOWN_SPONSOR = "Невідома держава"


def sponsor_for(actor: str) -> str:
    """Держава-спонсор або 'Невідома держава' для динамічних UAC-*."""
    return ACTOR_SPONSOR.get(actor, UNKNOWN_SPONSOR)


def _to_list(value: object) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(item) for item in value]
    try:
        parsed = json.loads(value)
        return [str(item) for item in parsed] if isinstance(parsed, list) else []
    except (TypeError, ValueError):
        return [str(value)]


def _targets_for(actor: str, country: object) -> list[str]:
    """Країни для зв'язку: реальні з запису, а інакше — відомі цілі групи."""
    real = _to_list(country)
    if real:
        return real
    if actor.startswith("UAC-"):
        return UAC_TARGET
    return ACTOR_TARGETS.get(actor, [])


def build_actor_links(rows: list[tuple]) -> list[dict]:
    """Повертає [{actor, sponsor, country, count, is_fallback}].

    rows — кортежі двох форматів:
      (title, country)                  — скан лише заголовка (стара поведінка);
      (title, summary, tags, country)   — повний скан тексту запису.

    Повний скан підвищує покриття: багато згадок акторів (напр. Sandworm)
    живуть у summary/tags, а не в заголовку.

    is_fallback=True якщо країна взята з ACTOR_TARGETS (типові цілі групи),
    а НЕ з поля country запису — для візуального розрізнення пунктиром.
    """
    counter: Counter[tuple[str, str]] = Counter()
    fallback_counter: Counter[tuple[str, str]] = Counter()
    for row in rows:
        if len(row) == 4:
            title, summary, tags, country = row
            text = " ".join(
                [title or "", summary or "", *(str(t) for t in (tags or []))]
            )
        else:
            title, country = row
            text = title or ""
        for actor in detect_actors(text):
            real = _to_list(country)
            targets = _targets_for(actor, country)
            is_fb = not real and bool(targets)
            for cn in targets:
                counter[(actor, cn)] += 1
                if is_fb:
                    fallback_counter[(actor, cn)] += 1

    return [
        {
            "actor": actor,
            "sponsor": sponsor_for(actor),
            "country": country,
            "count": count,
            "is_fallback": fallback_counter[(actor, country)] == count,
        }
        for (actor, country), count in sorted(counter.items(), key=lambda x: -x[1])
    ]


def build_sponsor_totals(links: list[dict]) -> list[dict]:
    """Агрегація лінків Sankey за державою-спонсором: {sponsor, count}.

    Сума всіх sponsor-груп завжди дорівнює сумі всіх actor_links,
    бо кожен лінк потрапляє рівно в один кошик (невідомі актори —
    у UNKNOWN_SPONSOR).
    """
    counter: Counter[str] = Counter()
    for link in links:
        counter[link["sponsor"]] += link["count"]
    return [
        {"sponsor": sponsor, "count": count}
        for sponsor, count in sorted(counter.items(), key=lambda x: -x[1])
    ]


def build_sponsor_record_counts(rows: list[tuple]) -> list[dict]:
    """Атрибуція «держава-спонсор → кількість УНІКАЛЬНИХ записів».

    Відрізняється від build_sponsor_totals (що підсумовує лінки
    «актор × країна-ціль») тим, що кожен запис дає +1 рівно один раз
    на державу-спонсора, НЕ множуючись на кількість країн-цілей
    (fallback) чи на кількість акторів однієї держави в тексті.

    Це те, що показує картка «Атаки за країною-спонсором»: скільки
    ДОКУМЕНТОВАНИХ записів можна атрибутувати кожній державі.
    Запис, у якому згадано акторів кількох держав, зараховується
    кожній з них по разу — сума по групах може перевищувати
    кількість записів, тому у спідлайні це пояснюється.

    rows — кортежі (title, summary, tags, country) або (title, country).
    """
    counter: Counter[str] = Counter()
    for row in rows:
        if len(row) == 4:
            title, summary, tags, _country = row
            text = " ".join(
                [title or "", summary or "", *(str(t) for t in (tags or []))]
            )
        else:
            title, _country = row
            text = title or ""
        actors = detect_actors(text)
        if not actors:
            continue
        sponsors = {sponsor_for(a) for a in actors}
        for sponsor in sponsors:
            counter[sponsor] += 1
    return [
        {"sponsor": sponsor, "count": count}
        for sponsor, count in sorted(counter.items(), key=lambda x: -x[1])
    ]


def _norm_infra_countries(raw: object) -> list[str]:
    """Нормалізація поля country запису для лінзи інфраструктури.

    Та сама геолокація IoC, що йде у by_country: ISO2-коди розгортаються
    в повні назви (MISP Galaxy тощо), значення колекторів уже повні назви.
    """
    out: list[str] = []
    for v in _to_list(raw):
        name = str(v).strip()
        if not name:
            continue
        if len(name) == 2 and name.isalpha():
            name = iso2_to_name(name.upper())
        out.append(name)
    return out


def build_sponsor_infrastructure(rows: list[tuple]) -> list[dict]:
    """Третя лінза: пари (спонсор, країна IoC-геолокації) — «де фізично
    хоститься інфраструктура груп, атрибутованих державі X».

    Відрізняється від by_country (географія ВСІХ записів без атрибуції)
    і від by_sponsor (атрибуція БЕЗ географії); жодну з них не замінює.
    Кожен запис додає +1 у пару (sponsor, infra_country) рівно один раз
    на спонсора, навіть якщо в ньому згадано кілька акторів однієї
    держави. Актори без відомого спонсора (динамічні UAC-*) не враховуються.

    Інваріант: сума пар за спонсором S <= actor_links(S) з /stats/attribution,
    бо пара виникає лише коли поле country заповнене — а тоді
    build_actor_links гарантово створює лінк із реальною (не fallback) країною.
    Різниця = лінки цього спонсора на записах без заповненого поля country.
    """
    counter: Counter[tuple[str, str]] = Counter()
    for row in rows:
        if len(row) == 4:
            title, summary, tags, country = row
            text = " ".join(
                [title or "", summary or "", *(str(t) for t in (tags or []))]
            )
        else:
            title, country = row
            text = title or ""
        actors = detect_actors(text)
        if not actors:
            continue
        sponsors = {sponsor_for(a) for a in actors}
        sponsors.discard(UNKNOWN_SPONSOR)
        if not sponsors:
            continue
        infra = _norm_infra_countries(country)
        if not infra:
            continue
        for sponsor in sponsors:
            for cn in infra:
                counter[(sponsor, cn)] += 1

    return [
        {"sponsor": sponsor, "country": cn, "count": count}
        for (sponsor, cn), count in sorted(
            counter.items(), key=lambda kv: (-kv[1], kv[0])
        )
    ]


def build_attribution(rows: list[tuple]) -> dict:
    """Всі три агрегати атрибуції З ОДНОГО проходу по rows.

    Раніше /stats, /stats/attribution і /stats/sponsor-infrastructure
    кожен будували свої лінки/бакети, а кожен із них проходив по всій БД
    і викликав detect_actors — разом до 6 прогонів детекції (≈10 c на 15 900
    записів). Тепер: один прохід, три незалежні лічильники.

    Повертає:
      actor_links  — як build_actor_links
      by_sponsor   — як build_sponsor_record_counts (унікальні записи/спонсор)
      infra_pairs  — як build_sponsor_infrastructure (спонсор × країна IoC)
      actor_links_by_sponsor — як build_sponsor_totals(actor_links)

    Результати БІТЕ-В-БІТ дорівнюють роздільним викликам (перевірено
    scripts/attribution_check.py: Σby_sponsor == Σlinks).
    """
    links: Counter[tuple[str, str]] = Counter()
    fallback_links: Counter[tuple[str, str]] = Counter()
    sponsor_records: Counter[str] = Counter()
    infra: Counter[tuple[str, str]] = Counter()

    for row in rows:
        if len(row) == 4:
            title, summary, tags, country = row
            text = " ".join(
                [title or "", summary or "", *(str(t) for t in (tags or []))]
            )
        else:
            title, country = row
            text = title or ""

        actors = detect_actors(text)
        if not actors:
            continue

        real = _to_list(country)
        # 1) лінки «актор × країна» (з фолбеком типових цілей)
        targets_cache: dict[str, list[str]] = {}
        for actor in actors:
            if actor in targets_cache:
                targets = targets_cache[actor]
            else:
                targets = _targets_for(actor, country)
                targets_cache[actor] = targets
            is_fb = not real and bool(targets)
            for cn in targets:
                links[(actor, cn)] += 1
                if is_fb:
                    fallback_links[(actor, cn)] += 1

        # 2) унікальні записи за спонсором (невідомі — у свій бакет)
        for sponsor in {sponsor_for(a) for a in actors}:
            sponsor_records[sponsor] += 1

        # 3) пари «спонсор × країна IoC» (невідомі спонсори не враховуються)
        sponsors_known = {sponsor_for(a) for a in actors}
        sponsors_known.discard(UNKNOWN_SPONSOR)
        if sponsors_known:
            infra_countries = _norm_infra_countries(country)
            if infra_countries:
                for sponsor in sponsors_known:
                    for cn in infra_countries:
                        infra[(sponsor, cn)] += 1

    actor_links = [
        {
            "actor": actor,
            "sponsor": sponsor_for(actor),
            "country": country,
            "count": count,
            "is_fallback": fallback_links[(actor, country)] == count,
        }
        for (actor, country), count in sorted(links.items(), key=lambda x: -x[1])
    ]

    by_sponsor = [
        {"sponsor": sponsor, "count": count}
        for sponsor, count in sorted(sponsor_records.items(), key=lambda x: -x[1])
    ]

    infra_pairs = [
        {"sponsor": sponsor, "country": cn, "count": count}
        for (sponsor, cn), count in sorted(infra.items(), key=lambda kv: (-kv[1], kv[0]))
    ]

    links_by_sponsor: Counter[str] = Counter()
    for link in actor_links:
        links_by_sponsor[link["sponsor"]] += link["count"]
    actor_links_by_sponsor = dict(links_by_sponsor)

    return {
        "actor_links": actor_links,
        "by_sponsor": by_sponsor,
        "infra_pairs": infra_pairs,
        "actor_links_by_sponsor": actor_links_by_sponsor,
    }
