from __future__ import annotations

from tracker.models.task import Task
from tracker.models.user import User


class NotificationService:
    def __init__(self) -> None:
        self._log: list[str] = []

    def send(self, user: User, message: str) -> None:
        self._log.append(f"→ {user.email}: {message}")

    def notify_assignment(self, user: User, task: Task) -> None:
        self.send(user, f"You have been assigned to: {task.title}")

    def history(self) -> list[str]:
        return list(self._log)


def notify(service: NotificationService, user: User, message: str) -> None:
    service.send(user, message)
