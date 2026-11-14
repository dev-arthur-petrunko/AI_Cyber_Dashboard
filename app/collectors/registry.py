"""
Конфіги для GenericHTMLCollector. ВАЖЛИВО: селектори нижче — чернетка,
я не зміг відкрити ці сайти з пісочниці (немає доступу до домену),
тому перевір їх у браузері (DevTools → Inspect на картці новини)
перед тим як покладатися на дані з них.

Як перевірити/поправити:
1. Відкрий list_url у браузері
2. DevTools → виділи одну картку новини → подивися її CSS-клас → item_selector
3. Усередині неї знайди заголовок → title_selector
4. Знайди посилання (зазвичай сама картка — <a>, або є <a> усередині) → link_selector
"""
from app.collectors.generic_scraper import ScraperConfig

# Робочий URL знайдено: /articles/ (не /news/ — там 404)
CYBERPOLICE_UA = ScraperConfig(
    source_name="Кіберполіція України",
    list_url="https://cyberpolice.gov.ua/articles/",
    item_selector="article, .news-item, .post, a[href*='/news/'], a[href*='/article/']",
    title_selector="h2, h3, .title",
    link_selector="a",
    base_url="https://cyberpolice.gov.ua",
)

# cip.gov.ua тепер збирається окремим Playwright-колектором у
# app/collectors/ssscip_ua.py (звичайний requests не обходить захист).

# НКЦК при РНБО і СБУ тепер збираються окремими скраперами:
#   app/collectors/rnbo_ua.py
#   app/collectors/ssu_ua.py

ALL_SCRAPER_CONFIGS = [CYBERPOLICE_UA]
