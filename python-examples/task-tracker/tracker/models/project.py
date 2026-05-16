from __future__ import annotations

from tracker.models.user import User


class Project:
    def __init__(self, project_id: str, name: str, owner: User) -> None:
        self.project_id = project_id
        self.name = name
        self.owner = owner
        self._members: list[User] = [owner]

    def add_member(self, user: User) -> None:
        if user not in self._members:
            self._members.append(user)

    def remove_member(self, user: User) -> None:
        self._members = [m for m in self._members if m.user_id != user.user_id]

    def members(self) -> list[User]:
        return list(self._members)

    def is_member(self, user: User) -> bool:
        return any(m.user_id == user.user_id for m in self._members)
