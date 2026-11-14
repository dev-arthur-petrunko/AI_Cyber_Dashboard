from abc import ABC, abstractmethod

from app.models.threat import Threat


class BaseCollector(ABC):
    """Кожне джерело даних реалізує цей інтерфейс.
    Це те, що робить архітектуру розширюваною: щоб додати нове
    джерело, не потрібно чіпати нічого, крім одного нового файлу."""

    source_name: str = "unknown"

    @abstractmethod
    def fetch(self) -> list[Threat]:
        """Повертає список нормалізованих Threat-об'єктів."""
        raise NotImplementedError
