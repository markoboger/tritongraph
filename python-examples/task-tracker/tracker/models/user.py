from __future__ import annotations


class User:
    def __init__(self, user_id: str, username: str, email: str) -> None:
        self.user_id = user_id
        self.username = username
        self.email = email
        self._active = True

    @property
    def is_active(self) -> bool:
        return self._active

    def deactivate(self) -> None:
        self._active = False

    def display_name(self) -> str:
        return self.username
