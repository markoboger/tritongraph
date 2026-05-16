from __future__ import annotations

from tracker.models.project import Project
from tracker.models.user import User


class Task:
    def __init__(self, task_id: str, title: str, project: Project) -> None:
        self.task_id = task_id
        self.title = title
        self.project = project
        self._assignee: User | None = None
        self._status = "open"

    @property
    def status(self) -> str:
        return self._status

    @property
    def assignee(self) -> User | None:
        return self._assignee

    def assign(self, user: User) -> None:
        self._assignee = user

    def close(self) -> None:
        self._status = "closed"

    def reopen(self) -> None:
        self._status = "open"


class SubTask(Task):
    def __init__(self, task_id: str, title: str, project: Project, parent: Task) -> None:
        super().__init__(task_id, title, project)
        self.parent = parent

    def is_blocking(self) -> bool:
        return self.status == "open"
