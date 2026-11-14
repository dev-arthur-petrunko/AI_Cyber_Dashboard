"""
Колектор SingCERT (CSA Singapore). Сайт csa.gov.sg переїхав на нову
структуру (Isomer CMS / Next.js), старий RSS (csa.gov.sg/Content/RSS-Feed)
мертвий — 404. Тому працюємо HTML-скрапером за тим самим патерном,
що й GenericHTMLCollector для кіберполіції (registry.py).

Структура сторінок (перевірено 16.08.2026):
  - https://www.csa.gov.sg/alerts-and-advisories/alerts/        — попередження
  - https://www.csa.gov.sg/alerts-and-advisories/bulletins/     — бюлетені (PDF)
Кожен елемент списку — це <a>, усередині <h3><span class="line-clamp-3">.
Заголовок надійніше брати з атрибута title у span (у бюлетенів після тексту
йде SVG-іконка). Алерти — відносні посилання /alerts-and-advisories/alerts/...,
бюлетені — зовнішні PDF на isomer-user-content.by.gov.sg.

Увага: сервер рендерить лише 10 елементів на сторінку, пагінація — на JS.
Скрапер збирає першу сторінку кожної стрічки.
"""
import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime

import requests
from bs4 import BeautifulSoup

from app.collectors.base import BaseCollector
from app.models.threat import Severity, Threat, ThreatType
from app.scoring import infer_severity

logger = logging.getLogger(__name__)

BASE_URL = "https://www.csa.gov.sg"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"

ALERTS_URL = f"{BASE_URL}/alerts-and-advisories/alerts/"
BULLETINS_URL = f"{BASE_URL}/alerts-and-advisories/bulletins/"


@dataclass
class _Page:
    source_name: str
    url: str
    item_selector: str
    title_selector: str
    limit: int = 30


_PAGES = [
    _Page(
        source_name="SingCERT",
        url=ALERTS_URL,
        item_selector='div.flex.w-full.flex-col.gap-0 a[href*="/alerts-and-advisories/alerts/"]',
        title_selector="h3 span.line-clamp-3",
    ),
    _Page(
        source_name="SingCERT Bulletins",
        url=BULLETINS_URL,
        item_selector='div.flex.w-full.flex-col.gap-0 a[href*="isomer-user-content"]',
        title_selector="h3 span.line-clamp-3",
        limit=20,
    ),
]


class SingCERTCollector(BaseCollector):
    """Збирає попередження та бюлетені CSA Singapore (HTML-скрапінг)."""

    source_name = "SingCERT"

    def fetch(self) -> list[Threat]:
        threats: list[Threat] = []
        for page in _PAGES:
            threats.extend(self._fetch_page(page))
        return threats

    def _fetch_page(self, page: _Page) -> list[Threat]:
        try:
            resp = requests.get(page.url, headers={"User-Agent": USER_AGENT}, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as e:
            logger.error("%s: не вдалося завантажити %s: %s", page.source_name, page.url, e)
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        items = soup.select(page.item_selector)
        if not items:
            logger.warning(
                "%s: селектор '%s' не знайшов елементів — верстка змінилася, "
                "перевір конфіг у singcert_sg.py",
                page.source_name,
                page.item_selector,
            )
            return []

        page_threats: list[Threat] = []
        for item in items[: page.limit]:
            title_el = item.select_one(page.title_selector)
            if not title_el:
                continue
            title = (title_el.get("title") or title_el.get_text(" ", strip=True)).strip()
            if not title:
                continue

            href = item.get("href", "")
            if href.startswith("/"):
                href = f"{BASE_URL}{href}"

            page_threats.append(
                Threat(
                    external_id=href or hashlib.sha1(title.encode()).hexdigest(),
                    title=title,
                    source=page.source_name,
                    type=ThreatType.advisory,
                    severity=infer_severity(title=title, default="Unknown"),
                    country=["Singapore"],
                    published=datetime.utcnow(),  # список не дає точну дату в HTML
                    summary="",
                    url=href or None,
                )
            )

        logger.info("%s: %d записів", page.source_name, len(page_threats))
        return page_threats
