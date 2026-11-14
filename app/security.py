"""Захист чутливих (дорогих / керуючих) ендпоїнтів.

Публічний дашборд читає дані через GET-ендпоїнти без авторизації.
Натомість пару POST-ендпоїнтів, що примусово запускають платний AI
(Groq), захищаємо спільним адмін-ключем. Ключ задається змінною
середовища ADMIN_API_KEY; якщо він не заданий — ендпоїнти вимкнені.

Порівняння ключа відбувається завжди в константний час (secrets.compare_digest),
щоб уникнути timing-атак на перебір.
"""
from __future__ import annotations

import os
import secrets
import threading
import time
from collections import defaultdict
from ipaddress import ip_address
from typing import Callable

from fastapi import Header, HTTPException, status
from starlette.requests import Request
from starlette.responses import JSONResponse


def require_admin(x_admin_key: str | None = Header(default=None)) -> None:
    """FastAPI-залежність: пропускає запит лише з валідним адмін-ключем."""
    expected = os.getenv("ADMIN_API_KEY", "").strip()
    if not expected:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin endpoints are disabled (ADMIN_API_KEY is not set)",
        )
    provided = (x_admin_key or "").strip()
    if not provided or not secrets.compare_digest(provided, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing admin key",
        )


class _MemoryRateLimiter:
    """Простий in-memory ковзний віконний лімітер (по IP).

    Не замінює повноцінний захист (nginx limit_req / Cloudflare WAF),
    але блокує очевидні флуди публічних GET-ендпоїнтів без зовнішніх
    залежностей. Індивідуальні адреси виключаються з лімітування.
    """

    def __init__(self, limit: int, window: float) -> None:
        self.limit = limit
        self.window = window
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = threading.Lock()
        self._private: set[str] = set()

    def configure_trusted(self, trusted: str) -> None:
        self._private = {t.strip() for t in trusted.split(",") if t.strip()}

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            stamp = self._hits[key]
            cutoff = now - self.window
            stamp[:] = [t for t in stamp if t > cutoff]
            if len(stamp) >= self.limit:
                return False
            stamp.append(now)
            return True


_rate_limiter = _MemoryRateLimiter(limit=600, window=60.0)


def rate_limit_middleware(fallback_ip: str = "unknown"):
    """ASGI-мідлвара: 429, якщо IP перевищив ліміт. Параметри ліміту —
    env RATE_LIMIT_PER_MIN і довірені IP у RATE_LIMIT_TRUSTED (без ліміту)."""
    limit = int(os.getenv("RATE_LIMIT_PER_MIN", "600").strip() or "600")
    _rate_limiter.limit = limit
    _rate_limiter.configure_trusted(os.getenv("RATE_LIMIT_TRUSTED", ""))

    async def middleware(request: Request, call_next: Callable):
        client = request.client
        host = client.host if client else fallback_ip
        try:
            if ip_address(host).is_private:
                host = "private"
        except ValueError:
            host = fallback_ip
        if host not in _rate_limiter._private and not _rate_limiter.allow(host):
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests — rate limit exceeded"},
            )
        return await call_next(request)

    return middleware

