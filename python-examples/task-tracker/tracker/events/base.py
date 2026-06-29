from __future__ import annotations

import uuid


class BaseEvent:
    def __init__(self, actor_id: str) -> None:
        self.event_id = str(uuid.uuid4())
        self.actor_id = actor_id

    def event_type(self) -> str:
        return self.__class__.__name__

    def serialize(self) -> dict[str, str]:
        return {
            "event_id": self.event_id,
            "actor_id": self.actor_id,
            "type": self.event_type(),
        }
