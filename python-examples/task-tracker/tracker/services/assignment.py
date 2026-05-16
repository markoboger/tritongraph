from tracker.models.task import Task
from tracker.models.user import User


def assign_task(task: Task, user: User) -> bool:
    if not task.project.is_member(user):
        return False
    task.assign(user)
    return True


def unassign_task(task: Task) -> None:
    task.assign(None)  # type: ignore[arg-type]
