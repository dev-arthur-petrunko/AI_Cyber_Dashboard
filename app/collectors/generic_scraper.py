"""
У СБУ, НКЦК, кіберполіції і Держспецзв'язку (cip.gov.ua) немає стабільного
публічного RSS або API — тільки HTML-сторінки з новинами. Це єдиний
робочий варіант їх підключити, але він КРИХКИЙ: якщо сайт змінить верстку,
селектори перестануть працювати і колектор доведеться поправити.

Використання: створити екземпляр з конфігом (див. registry.py нижче) і
перевірити/поправити CSS-селектори під актуальну верстку сайту — я не зміг
протестувати їх вживу (ці домени недоступні з пісочниці), тож
вважай їх чернеткою, а не готовим рішенням.
"""
import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime

import requests
from bs4 import BeautifulSoup

from app.collectors.base import BaseCollector
from app.models.threat import Region, Severity, Threat, ThreatType
from app.scoring import infer_severity

logger = logging.getLogger(__name__)


@dataclass
class ScraperConfig:
    source_name: str
    list_url: str
    item_selector: str       # CSS-селектор однієї новини в списку
    title_selector: str      # CSS-селектор заголовка всередині item_selector
    link_selector: str = ""  # якщо пусто — беремо href із самого item_selector або title
    link_attr: str = "href"
    base_url: str = ""       # для відносних посилань


class GenericHTMLCollector(BaseCollector):
    """Дженерик-колектор: один клас, багато конфігів (див. registry.py)."""

    def __init__(self, config: ScraperConfig):
        self.config = config
        self.source_name = config.source_name

    def fetch(self) -> list[Threat]:
        try:
            resp = requests.get(
                self.config.list_url,
                timeout=30,
                headers={"User-Agent": "Mozilla/5.0 (compatible; UA-Cyber-Dashboard/0.1)"},
            )
            resp.raise_for_status()
        except requests.RequestException as e:
            logger.error("%s scrape failed: %s", self.source_name, e)
            return []

        soup = BeautifulSoup(resp.text, "html.parser")
        items = soup.select(self.config.item_selector)
        if not items:
            logger.warning(
                "%s: селектор '%s' не знайшов жодної новини — верстка змінилася, "
                "перевір конфіг у registry.py",
                self.source_name,
                self.config.item_selector,
            )

        threats = []
        for item in items[:30]:
            title_el = item.select_one(self.config.title_selector)
            if not title_el and item.name == "a" and item.get_text(strip=True):
                title_el = item  # заголовок = текст самого посилання
            if not title_el:
                continue
            title = title_el.get_text(strip=True)
            if not title:
                continue

            link_el = (
                item.select_one(self.config.link_selector)
                if self.config.link_selector
                else (item if item.name == "a" else title_el)
            )
            href = link_el.get(self.config.link_attr, "") if link_el else ""
            if href and self.config.base_url and not href.startswith("http"):
                href = self.config.base_url.rstrip("/") + "/" + href.lstrip("/")

            external_id = href or hashlib.sha1(title.encode()).hexdigest()

            threats.append(
                Threat(
                    external_id=external_id,
                    title=title,
                    source=self.source_name,
                    type=ThreatType.advisory,
                    severity=infer_severity(title=title, default="Unknown"),
                    country=["Ukraine"],
                    region=Region.ua,
                    published=datetime.utcnow(),  # список не дає точну дату — уточнюється за посиланням
                    summary="",
                    url=href or None,
                )
            )
        return threats
