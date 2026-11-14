"""
Колектор публічних PoC-репозиторіїв на GitHub для останніх CVE.
Використовує GitHub Code/Repo Search API (без токена: 10 запитів/хв,
з GITHUB_TOKEN у .env — 30/хв).

Стратегія: шукаємо репозиторії, де в назві/описі згадується CVE-ID
за останні N днів. Якщо репозиторій з'явився раніше, ніж за кілька
днів після публікації CVE — це готовий експлойт, а не просто аналіз.
"""
import logging
import os
import re
from datetime import datetime, timedelta, timezone

import requests

from app.collectors.base import BaseCollector
from app.models.threat import ExploitMaturity, Severity, Threat, ThreatType

logger = logging.getLogger(__name__)

GITHUB_SEARCH_URL = "https://api.github.com/search/repositories"
GITHUB_ORG_REPOS_URL = "https://api.github.com/orgs/{org}/repos"
CVE_PATTERN = re.compile(r"CVE-\d{4}-\d{4,7}", re.I)

# Організації, чиї публічні репозиторії треба відстежувати.
# Зараз тільки CERT-Bund (інструменти та open data німецького CERT).
GITHUB_ORGS = ["CERT-Bund"]


class GitHubPoCCollector(BaseCollector):
    source_name = "GitHub"

    def __init__(self, lookback_days: int = 7, max_results: int = 50):
        self.lookback_days = lookback_days
        self.max_results = max_results
        self.token = os.getenv("GITHUB_TOKEN")

    def fetch(self) -> list[Threat]:
        since = (datetime.now(timezone.utc) - timedelta(days=self.lookback_days)).strftime(
            "%Y-%m-%d"
        )
        # шукаємо репозиторії з CVE в назві, створені нещодавно —
        # характерний патерн для PoC-репозиторіїв
        query = f"CVE-20 in:name created:>={since}"
        headers = {"Accept": "application/vnd.github+json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        try:
            resp = requests.get(
                GITHUB_SEARCH_URL,
                params={
                    "q": query,
                    "sort": "updated",
                    "order": "desc",
                    "per_page": self.max_results,
                },
                headers=headers,
                timeout=30,
            )
            resp.raise_for_status()
        except requests.RequestException as e:
            logger.error("GitHub PoC fetch failed: %s", e)
            return []

        data = resp.json()
        threats = []
        for repo in data.get("items", []):
            match = CVE_PATTERN.search(repo.get("name", "") + " " + (repo.get("description") or ""))
            if not match:
                continue
            cve_id = match.group(0).upper()

            threats.append(
                Threat(
                    external_id=f"gh-{repo['id']}",
                    cve_id=cve_id,
                    title=f"PoC: {repo['name']}",
                    source=self.source_name,
                    type=ThreatType.exploit,
                    severity=Severity.unknown,  # реальна severity береться з NVD по cve_id
                    exploit_maturity=ExploitMaturity.poc,
                    published=repo.get("created_at"),
                    summary=(repo.get("description") or "")[:500],
                    tags=["poc", cve_id],
                    url=repo.get("html_url"),
                )
            )
        return threats


class GitHubOrgsCollector(BaseCollector):
    """Списує нещодавно оновлені публічні репозиторії організацій.

    Використовується для організацій-партнерів (CERT-Bund тощо), які не
    публікують RSS/advisory-стрічку, але викладають інструменти та open data
    на GitHub. Репозиторії не є «загрозами» в класичному сенсі — вони
    зберігаються як advisory-записи з посиланням на джерело.
    """

    source_name = "CERT-Bund GitHub"

    def __init__(self, orgs: list[str] | None = None, lookback_days: int = 180):
        self.orgs = orgs or GITHUB_ORGS
        self.lookback_days = lookback_days
        self.token = os.getenv("GITHUB_TOKEN")

    def fetch(self) -> list[Threat]:
        if not self.orgs:
            return []
        cutoff = datetime.now(timezone.utc) - timedelta(days=self.lookback_days)
        headers = {"Accept": "application/vnd.github+json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        threats: list[Threat] = []
        for org in self.orgs:
            try:
                resp = requests.get(
                    GITHUB_ORG_REPOS_URL.format(org=org),
                    params={"sort": "updated", "direction": "desc", "per_page": 30},
                    headers=headers,
                    timeout=30,
                )
                resp.raise_for_status()
            except requests.RequestException as e:
                logger.error("GitHub org %s fetch failed: %s", org, e)
                continue

            for repo in resp.json():
                updated_raw = repo.get("updated_at") or repo.get("pushed_at")
                try:
                    updated = (
                        datetime.fromisoformat(updated_raw.replace("Z", "+00:00"))
                        if updated_raw
                        else datetime.now(timezone.utc)
                    )
                except ValueError:
                    continue
                if updated < cutoff:
                    continue

                threats.append(
                    Threat(
                        external_id=repo.get("html_url") or f"gh-{org}-{repo.get('id')}",
                        title=f"{org}: {repo.get('name', '')}",
                        source=self.source_name,
                        type=ThreatType.advisory,
                        severity=Severity.unknown,
                        country=["Germany"],
                        published=repo.get("created_at"),
                        summary=(repo.get("description") or f"Репозиторій організації {org}")[:800],
                        tags=[org],
                        url=repo.get("html_url"),
                    )
                )

        logger.info("%s: %d репозиторіїв", self.source_name, len(threats))
        return threats
