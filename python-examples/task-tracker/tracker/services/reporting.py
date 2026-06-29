from __future__ import annotations

from tracker.models.project import Project
from tracker.models.task import Task


def generate_report(project: Project, tasks: list[Task]) -> dict[str, int]:
    project_tasks = [t for t in tasks if t.project.project_id == project.project_id]
    return {
        "total": len(project_tasks),
        "open": sum(1 for t in project_tasks if t.status == "open"),
        "closed": sum(1 for t in project_tasks if t.status == "closed"),
    }


def export_csv(tasks: list[Task]) -> str:
    lines = ["task_id,title,status,assignee"]
    for t in tasks:
        assignee = t.assignee.username if t.assignee else ""
        lines.append(f"{t.task_id},{t.title},{t.status},{assignee}")
    return "\n".join(lines)
