from __future__ import annotations

from clinic.animals.base import Animal
from clinic.appointments.slot import TimeSlot
from clinic.medical.record import MedicalRecord


class Booking:
    def __init__(self, animal: Animal, slot: TimeSlot, reason: str) -> None:
        self._animal = animal
        self._slot = slot
        self._reason = reason
        self._record: MedicalRecord | None = None
        slot.book()

    @property
    def animal(self) -> Animal:
        return self._animal

    @property
    def slot(self) -> TimeSlot:
        return self._slot

    def attach_record(self, record: MedicalRecord) -> None:
        self._record = record

    def cancel(self) -> None:
        self._slot.release()

    def summary(self) -> str:
        return f"{self._animal.name} @ {self._slot.label()} — {self._reason}"
