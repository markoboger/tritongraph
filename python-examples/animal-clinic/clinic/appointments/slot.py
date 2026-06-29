from __future__ import annotations


class TimeSlot:
    def __init__(self, date: str, hour: int, duration_minutes: int = 30) -> None:
        self.date = date
        self.hour = hour
        self.duration_minutes = duration_minutes
        self._booked = False

    @property
    def is_booked(self) -> bool:
        return self._booked

    def book(self) -> None:
        self._booked = True

    def release(self) -> None:
        self._booked = False

    def label(self) -> str:
        return f"{self.date} {self.hour:02d}:00 ({self.duration_minutes} min)"


def available_slots(slots: list[TimeSlot]) -> list[TimeSlot]:
    return [s for s in slots if not s.is_booked]
