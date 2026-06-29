from tracker.events.base import BaseEvent
from tracker.models.task import Task


class TaskCreated(BaseEvent):
    def __init__(self, actor_id: str, task: Task) -> None:
        super().__init__(actor_id)
        self.task = task

    def serialize(self) -> dict[str, str]:
        base = super().serialize()
        base["task_id"] = self.task.task_id
        return base


class TaskCompleted(BaseEvent):
    def __init__(self, actor_id: str, task: Task) -> None:
        super().__init__(actor_id)
        self.task = task
        task.close()

    def serialize(self) -> dict[str, str]:
        base = super().serialize()
        base["task_id"] = self.task.task_id
        base["status"] = "closed"
        return base
