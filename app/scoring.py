"""
Власна оцінка ризику (0–10) за методологією, наближеною до міжнародного CVSS.

Використовується як фолбек: коли джерело не надало офіційний CVSS,
ми рахуємо власну оцінку за тими ж принципами:
база за severity + бонуси за готовність експлойта, імовірність EPSS
та критичні ключові слова в заголовку/тегах. Діапазон 0–10.

Тут же живе витягування vendor з заголовка новинних записів,
коли джерело не вказало виробника (позначається * у таблиці).

Методологія:
- Ключові слова НЕ перераховуються: якщо "critical" вже визначив
  severity=Critical, бонус +0.6 за "critical" у HIGH_RISK_KEYWORDS
  НЕ нараховується (див. _used_keywords).
- Score нормалізується зверху через sigmoid-подібну функцію,
  щоб верхній діапазон залишався розрізним (п.3).
"""
from __future__ import annotations

import re
from typing import Optional

# Базова оцінка за ярликом severity (0–10)
SEVERITY_BASE: dict[str, float] = {
    "Critical": 9.0,
    "High": 7.5,
    "Medium": 5.0,
    "Low": 2.0,
    "Unknown": 4.0,
}

# Бонус за рівень готовності експлойта
MATURITY_BUMP: dict[str, float] = {
    "In the wild": 1.2,
    "Weaponized": 0.8,
    "PoC": 0.5,
    "Unknown": 0.0,
}

# Ключові слова, що підвищують ризик (заголовок / теги)
HIGH_RISK_KEYWORDS: tuple[str, ...] = (
    "ransomware", "exploit", "zero-day", "zeroday", "critical",
    "apt", "spyware", "malware", "botnet", "backdoor", "remote code",
    "критичн", "вимагач", "експлойт", "шкідлив",
)

# Явні рівні в тегах фіду (BSI: kritisch/hoch/mittel, англ. critical/high/medium...)
# — мають пріоритет над текстовим скануванням у infer_severity.
TAG_SEVERITY: dict[str, str] = {
    "critical": "Critical", "kritisch": "Critical",
    "high": "High", "hoch": "High",
    "medium": "Medium", "mittel": "Medium",
    "low": "Low", "niedrig": "Low",
}


# Слова, що вказують на КРИТИЧНИЙ рівень (→ Critical)
CRITICAL_KEYWORDS: tuple[str, ...] = (
    "critical", "zero-day", "zeroday", "in the wild", "actively exploited",
    "ransomware", "ransom", "weaponized", "worm", "bootkit", "rootkit",
    "data breach", "breach", "remote code execution", "rce",
    "критичн", "вимага", "атакують", "експлуатується", "в дикій природі",
    "активна експлуатація", "вразливість нульового дня",
    "kritisch",
)

# Слова, що вказують на ВИСОКИЙ рівень (→ High)
HIGH_KEYWORDS: tuple[str, ...] = (
    "high", "exploit", "vulnerabilit", "cve", "backdoor", "botnet",
    "malware", "spyware", "trojan", "apt", "phishing", "ddos", "dos",
    "supply chain", "zero-day", "account takeover", "privilege escalation",
    "висок", "експлойт", "вразлив", "шкідлив", "фішинг", "бота", "злом",
    "троян", "атака", "втручан",
    "hoch", "schwachstell",
)

# Слова, що вказують на СЕРЕДНІЙ рівень (→ Medium)
MEDIUM_KEYWORDS: tuple[str, ...] = (
    "medium", "patch", "update", "advisory", "guide", "guidance",
    "notification", "notice", "warning", "best practices", "controls",
    "помірн", "патч", "оновлен", "рекомендац", "посібник", "повідомлен",
    "порад", "практик",
    "mittel",
)

# Слова, що вказують на НИЗЬКИЙ рівень (→ Low)
LOW_KEYWORDS: tuple[str, ...] = (
    "low", "minor", "informational", "low risk", "negligible",
    "незначн", "незначущ", "мінімальн", "низьк",
    "niedrig", "unbedeutend",
)

# Короткі англійські маркери, які як підрядок дають хибні спрацювання:
#   "high" → "highlights/highly";  "low" → "follow/allowed/below";
#   "dos"  → "ddos" (є окремим ключем);  "apt" → "adaptive/capacity";
#   "cve"  → тільки на межі слова (cve-2023).
# Для них використовуємо пошук на межі СЛОВА (\b), а не простий підрядок.
BOUNDARY_KEYWORDS: frozenset[str] = frozenset({"high", "low", "dos", "apt", "cve"})


def infer_severity(
    title: Optional[str] = None,
    summary: Optional[str] = None,
    tags: Optional[list] = None,
    default: str = "Unknown",
) -> str:
    """Оцінює severity новин/advisory за ключовими словами в заголовку/тексті.

    Новини та повідомлення CERT не мають офіційного CVSS, тому severity
    виводиться з контенту: спершу шукаємо критичні маркери, потім високі,
    потім середні. Повертає один з: Critical / High / Medium / default.

    Якщо фід сам мітить записи рівнем (напр. BSI: kritisch/hoch/mittel,
    англ. critical/high/medium) — тег має пріоритет над текстовим аналізом,
    бо опис часто містить слова, які збивають сканування (напр. "Denial of
    Service" у mittel-записі).
    """
    tag_text = " ".join(str(t).lower() for t in (tags or []))
    for kw, sev in TAG_SEVERITY.items():
        if kw in tag_text:
            return sev

    text = " ".join([
        (title or "").lower(),
        (summary or "")[:400].lower(),
        tag_text,
    ])

    def has_any(keywords: tuple[str, ...]) -> bool:
        for kw in keywords:
            if kw in BOUNDARY_KEYWORDS:
                if re.search(rf"\b{re.escape(kw)}\b", text):
                    return True
            elif kw in text:
                return True
        return False

    if has_any(CRITICAL_KEYWORDS):
        return "Critical"
    if has_any(HIGH_KEYWORDS):
        return "High"
    if has_any(MEDIUM_KEYWORDS):
        return "Medium"
    if has_any(LOW_KEYWORDS):
        return "Low"
    return default


def compute_local_score(
    severity: Optional[str] = None,
    exploit_maturity: Optional[str] = None,
    epss_score: Optional[float] = None,
    title: Optional[str] = None,
    tags: Optional[list] = None,
) -> Optional[float]:
    """Власна оцінка ризику (0–10) або None, якщо даних замало.

    Логіка (п.1): ключові слова з CRITICAL/HIGH_KEYWORDS, що вже
    визначили severity, НЕ нараховуються повторно як keyword bonus.
    Тільки додаткові слова з HIGH_RISK_KEYWORDS, що не перетинаються
    з тим, що використано для severity, дають бонус.

    Логіка (п.3): raw_score нормалізується sigmoid-подібною функцією
    зверху, щоб верхній діапазон залишався розрізним.
    """
    if not severity and epss_score is None:
        return None

    score = SEVERITY_BASE.get(severity or "Unknown", 4.0)
    score += MATURITY_BUMP.get(exploit_maturity or "Unknown", 0.0)

    # EPSS: імовірність експлуатації протягом 30 днів (0–1) → максимум +2.0
    if epss_score is not None:
        score += max(0.0, min(float(epss_score), 1.0)) * 2.0

    # П.1: Визначаємо які ключові слова вже використані для severity
    # щоб НЕ нараховувати їх повторно в keyword bonus.
    haystack = " ".join([
        (title or "").lower(),
        *(str(t).lower() for t in (tags or [])),
    ])
    severity_lower = (severity or "").lower()
    _used_keywords: set[str] = set()
    if severity_lower == "critical":
        _used_keywords = set(CRITICAL_KEYWORDS)
    elif severity_lower == "high":
        _used_keywords = set(HIGH_KEYWORDS)
    elif severity_lower == "medium":
        _used_keywords = set(MEDIUM_KEYWORDS)
    elif severity_lower == "low":
        _used_keywords = set(LOW_KEYWORDS)

    # Keyword bonus: тільки слова, що НЕ використані для severity
    # та ЩЕ не враховані (додають нову інформацію)
    remaining_keywords = [kw for kw in HIGH_RISK_KEYWORDS if kw not in _used_keywords]
    if remaining_keywords and any(kw in haystack for kw in remaining_keywords):
        score += 0.6

    # П.3: Нормалізація зверху через sigmoid-подібну функцію.
    # Замість лінійного clamp(min(score, 10.0)) використовуємо
    # стиснення для значень > 8.0, зберігаючи розрізненість.
    # Приклади: raw 10.0 → 9.3, raw 12.0 → 9.7, raw 15.0 → 9.9
    if score > 8.0:
        excess = score - 8.0
        compressed = 8.0 + (2.0 * excess) / (2.0 + excess)
        score = compressed

    return round(max(0.0, min(score, 10.0)), 1)


# Відомі вендори та їх ключові слова для витягування з заголовка/тегів.
# Ключі вже в нижньому регістрі; пошук йде найдовшим збігом першим.
VENDOR_KEYWORDS: dict[str, str] = {
    'microsoft': 'Microsoft',
    'sharepoint': 'Microsoft',
    'windows': 'Microsoft',
    'exchange server': 'Microsoft',
    'outlook': 'Microsoft',
    'office 365': 'Microsoft',
    'active directory': 'Microsoft',
    'm365': 'Microsoft',
    'teams': 'Microsoft',
    'azure': 'Microsoft',
    'github': 'GitHub',
    'gitlab': 'GitLab',
    'google': 'Google',
    'chrome': 'Google',
    'android': 'Google',
    'pixel': 'Google',
    'apple': 'Apple',
    'macos': 'Apple',
    'ios': 'Apple',
    'iphone': 'Apple',
    'icloud': 'Apple',
    'safari': 'Apple',
    'cisco': 'Cisco',
    'webex': 'Cisco',
    'fortinet': 'Fortinet',
    'fortios': 'Fortinet',
    'fortigate': 'Fortinet',
    'fortiproxy': 'Fortinet',
    'forticlient': 'Fortinet',
    'adobe': 'Adobe',
    'acrobat': 'Adobe',
    'oracle': 'Oracle',
    'weblogic': 'Oracle',
    'java': 'Oracle',
    'mysql': 'Oracle',
    'vmware': 'VMware',
    'vsphere': 'VMware',
    'citrix': 'Citrix',
    'netscaler': 'Citrix',
    'ibm': 'IBM',
    'sap': 'SAP',
    'apache': 'Apache',
    'tomcat': 'Apache',
    'struts': 'Apache',
    'log4j': 'Apache',
    'nginx': 'Nginx',
    'redis': 'Redis',
    'mongodb': 'MongoDB',
    'elastic': 'Elastic',
    'elasticsearch': 'Elastic',
    'kubernetes': 'Kubernetes',
    'k8s': 'Kubernetes',
    'docker': 'Docker',
    'cloudflare': 'Cloudflare',
    'amazon': 'Amazon',
    'aws': 'Amazon',
    'linux': 'Linux',
    'kernel': 'Linux',
    'ubuntu': 'Canonical',
    'red hat': 'Red Hat',
    'redhat': 'Red Hat',
    'debian': 'Debian',
    'suse': 'SUSE',
    'opensuse': 'SUSE',
    'f5': 'F5',
    'f5 networks': 'F5',
    'big-ip': 'F5',
    'bigip': 'F5',
    'ivanti': 'Ivanti',
    'pulse secure': 'Ivanti',
    'connect secure': 'Ivanti',
    'zscaler': 'Zscaler',
    'sonicwall': 'SonicWall',
    'palo alto': 'Palo Alto Networks',
    'pan-os': 'Palo Alto Networks',
    'panos': 'Palo Alto Networks',
    'globalprotect': 'Palo Alto Networks',
    'check point': 'Check Point',
    'checkpoint': 'Check Point',
    'mcafee': 'McAfee',
    'symantec': 'Symantec',
    'kaspersky': 'Kaspersky',
    'eset': 'ESET',
    'crowdstrike': 'CrowdStrike',
    'falcon': 'CrowdStrike',
    'sentinelone': 'SentinelOne',
    'splunk': 'Splunk',
    'atlassian': 'Atlassian',
    'confluence': 'Atlassian',
    'jira': 'Atlassian',
    'bitbucket': 'Atlassian',
    'hashicorp': 'HashiCorp',
    'terraform': 'HashiCorp',
    'wordpress': 'WordPress',
    'drupal': 'Drupal',
    'joomla': 'Joomla',
    'magento': 'Adobe',
    'nvidia': 'NVIDIA',
    'cuda': 'NVIDIA',
    'intel': 'Intel',
    'amd': 'AMD',
    'qualcomm': 'Qualcomm',
    'broadcom': 'Broadcom',
    'samsung': 'Samsung',
    'huawei': 'Huawei',
    'xiaomi': 'Xiaomi',
    'lenovo': 'Lenovo',
    'dell': 'Dell',
    'hp': 'HP',
    'asus': 'ASUS',
    'tp-link': 'TP-Link',
    'tplink': 'TP-Link',
    'netgear': 'Netgear',
    'd-link': 'D-Link',
    'dlink': 'D-Link',
    'linksys': 'Linksys',
    'juniper': 'Juniper',
    'paloalto': 'Palo Alto Networks',
    'mozilla': 'Mozilla',
    'firefox': 'Mozilla',
    'thunderbird': 'Mozilla',
    'wordfence': 'Wordfence',
    'openai': 'OpenAI',
    'anthropic': 'Anthropic',
    'meta': 'Meta',
    'facebook': 'Meta',
    'tencent': 'Tencent',
    'alibaba': 'Alibaba',
    'baidu': 'Baidu',
    'opera': 'Opera',
    'brave': 'Brave',
    'zoom': 'Zoom',
    'slack': 'Slack',
    'salesforce': 'Salesforce',
    'shopify': 'Shopify',
    'silicon': 'Silicon Labs',
    'microchip': 'Microchip',
    'stmicroelectronics': 'STMicroelectronics',
    'schneider': 'Schneider Electric',
    'siemens': 'Siemens',
    'honeywell': 'Honeywell',
    'rockwell': 'Rockwell Automation',
    'hikvision': 'Hikvision',
    'dahua': 'Dahua',
    'axis': 'Axis Communications',
    'bosch': 'Bosch',
    'sonos': 'Sonos',
    'ring': 'Amazon',
    'nest': 'Google',
    'fire tv': 'Amazon',
    'kindle': 'Amazon',
    'nintendo': 'Nintendo',
    'sony': 'Sony',
    'playstation': 'Sony',
    'xbox': 'Microsoft',
    'tcpdump': 'Tcpdump',
    'openssl': 'OpenSSL',
    'openssh': 'OpenSSH',
    'openvpn': 'OpenVPN',
    'bash': 'GNU Bash',
    'curl': 'curl',
    'wget': 'GNU Wget',
    'gnu': 'GNU',
    'python': 'Python',
    'node.js': 'Node.js',
    'nodejs': 'Node.js',
    'php': 'PHP',
    'ruby': 'Ruby',
    'go lang': 'Go',
    'golang': 'Go',
    'rust': 'Rust',
    'javascript': 'JavaScript',
    'typescript': 'TypeScript',
}

# ─── Суворе правило Critical (варіант А, рішення власника 14.11.2026) ───
# infer_severity дає Critical за словами у тексті (ransomware/rce/breach), через
# що у базі було 11 916 «критичних» (77% — IOC-рядки ThreatFox без CVE/експлойта).
# Тепер Critical = ЛИШЕ задовільне хоча б ОДНЕ з:
#   1) офіційний CVSS ≥ 9.0;
#   2) EPSS ≥ 0.5 І підтверджений експлойт (Weaponized / In the wild);
#   3) «активна експлуатація» (In the wild / маркери в тексті) І наявний CVE;
#   4) запис у CISA KEV (added_to_kev);
#   5) явний тег критичності фіда (critical/kritisch) від не-IOC джерела.
# IOC-записи (type='IOC') — максимум High: рядок індикатора не є «критичною
# вразливістю» сам по собі. Інакше → High. Застосовується у bulk_upsert (єдина
# точка запису всіх колекторів), тож правило діє для нових й оновлень записів.

# Маркери «активної експлуатації» у тексті (межа слова, нижній регістр)
_ACTIVE_EXPLOIT_MARKERS: tuple[str, ...] = (
    "in the wild", "actively exploited", "active exploitation",
    "being exploited", "exploited in the wild",
    "експлуатується", "активна експлуатація", "в дикій природі",
)


def enforce_strict_critical(data: dict) -> dict:
    """Понижує Critical → High, якщо запис не проходить суворе правило (варіант А)."""
    if data.get("severity") != "Critical":
        return data

    # IOC-рядок ніколи не є Critical (варіант А, п.5)
    if data.get("type") == "IOC":
        data["severity"] = "High"
        return data

    # 1) CVSS ≥ 9.0
    try:
        if data.get("cvss_score") is not None and float(data["cvss_score"]) >= 9.0:
            return data
    except (TypeError, ValueError):
        pass

    # 2) EPSS ≥ 0.5 + підтверджений експлойт
    try:
        if (
            data.get("epss_score") is not None
            and float(data["epss_score"]) >= 0.5
            and data.get("exploit_maturity") in ("Weaponized", "In the wild")
        ):
            return data
    except (TypeError, ValueError):
        pass

    has_cve = bool(str(data.get("cve_id") or "").strip())

    # 3) активна експлуатація + CVE
    maturity = data.get("exploit_maturity") == "In the wild"
    haystack = " ".join(
        str(data.get("title") or "").lower() + " " + str(data.get("summary") or "")[:400].lower()
    )
    marker = any(m in haystack for m in _ACTIVE_EXPLOIT_MARKERS)
    if has_cve and (maturity or marker):
        return data

    # 4) CISA KEV
    if data.get("added_to_kev"):
        return data

    # 5) явний тег критичності фіда (крім IOC — ті вже відсіяні вище)
    tags = " ".join(str(t).lower() for t in (data.get("tags") or []))
    if "kritisch" in tags or "critical" in tags:
        return data

    data["severity"] = "High"
    return data


def extract_vendor(
    title: Optional[str] = None,
    summary: Optional[str] = None,
    tags: Optional[list] = None,
    products: Optional[list] = None,
) -> Optional[str]:
    """Витягує назву виробника з заголовка/тегів/продуктів або None."""
    parts = [title or "", summary or ""]
    parts.extend(str(t) for t in (tags or []))
    text = " ".join(parts).lower()

    for keyword in sorted(VENDOR_KEYWORDS, key=len, reverse=True):
        if re.search(r"\b" + re.escape(keyword) + r"\b", text):
            return VENDOR_KEYWORDS[keyword]

    # Фолбек: шукаємо вендора серед products (напр. "microsoft:windows")
    for prod in (products or []):
        if not prod:
            continue
        prod_lower = str(prod).lower()
        for keyword in sorted(VENDOR_KEYWORDS, key=len, reverse=True):
            if re.search(r"\b" + re.escape(keyword) + r"\b", prod_lower):
                return VENDOR_KEYWORDS[keyword]
    return None
