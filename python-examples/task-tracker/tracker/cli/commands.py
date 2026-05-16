from __future__ import annotations

from tracker.models.project import Project
from tracker.models.task import Task


def create_task(title: str, project: Project, task_id: str | None = None) -> Task:
    tid = task_id or f"task-{len(title)}"
    return Task(tid, title, project)


def list_tasks(tasks: list[Task], project: Project | None = None) -> list[Task]:
    if project is None:
        return list(tasks)
    return [t for t in tasks if t.project.project_id == project.project_id]


def close_task(task: Task) -> bool:
    if task.status == "closed":
        return False
    task.close()
    return True
