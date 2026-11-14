"""
requests.get(timeout=X) не захищає від сервера, який «капає» дані
дрібними порціями повільніше ніж X секунд між порціями — таймаут не спрацьовує,
а запит може тягнутися скільки завгодно. Ця функція гарантує реальну
верхню межу на весь запит цілком через окремий потік.

Використовуй замість requests.get(...) у будь-якому колекторі:
    from app.http_utils import hard_timeout_get
    resp = hard_timeout_get(url, params=params, headers=headers, hard_timeout=35)
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError

import requests

logger = logging.getLogger(__name__)


def hard_timeout_get(url: str, hard_timeout: float = 35, **kwargs) -> requests.Response:
    """Як requests.get, але з гарантованою верхньою межею часу.
    Кидає requests.Timeout, якщо не вклалися — ловити так само, як звичайний
    requests.exceptions.Timeout / RequestException."""

    def _do_request():
        return requests.get(url, **kwargs)

    pool = ThreadPoolExecutor(max_workers=1)
    try:
        future = pool.submit(_do_request)
        return future.result(timeout=hard_timeout)
    except FutureTimeoutError:
        raise requests.exceptions.Timeout(
            f"hard_timeout_get: {url} not completed within {hard_timeout}s"
        )
    finally:
        pool.shutdown(wait=False)
