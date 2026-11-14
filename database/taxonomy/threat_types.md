# Классификация типов угроз

Соответствует `ThreatType` в `app/models/threat.py`.

| Тип | Код | Назначение | Примеры |
|-----|-----|------------|---------|
| CVE | `CVE` | Уязвимость, зафиксированная в NVD/CISA KEV | CVE-2024-12345 |
| Advisory | `Advisory` | Рекомендация/предупреждение CERT-Центра | CERT-UA, CISA advisory |
| News | `News` | Новостная запись о киберсобытии | BleepingComputer, CNN |
| Exploit | `Exploit` | Публикация эксплойта / PoC | GitHub PoC, Exploit-DB |
| IOC | `IOC` | Индикатор компрометации (IP, домен, хеш) | ThreatFox, URLhaus, Abuse.ch |

## Порядок применения

1. Колектор нормализует сырые данные в `Threat` (Pydantic).
2. Поле `type` определяется на основе источника и структуры записи.
3. Если тип неясен — используется `IOC` для индикаторов, иначе `News`.

## Связь с severity

Тип угрозы не должен диктовать severity. Severity вычисляется отдельно (CVSS, EPSS, контекст эксплуатации) — см. `severity.md`.
