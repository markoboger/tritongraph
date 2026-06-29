from tracker.events.base import BaseEvent
from tracker.models.project import Project
from tracker.models.user import User


class UserJoined(BaseEvent):
    def __init__(self, actor_id: str, user: User, project: Project) -> None:
        super().__init__(actor_id)
        self.user = user
        self.project = project
        project.add_member(user)

    def serialize(self) -> dict[str, str]:
        base = super().serialize()
        base["user_id"] = self.user.user_id
        base["project_id"] = self.project.project_id
        return base
