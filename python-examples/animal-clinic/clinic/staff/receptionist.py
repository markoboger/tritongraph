from clinic.appointments.slot import TimeSlot, available_slots


class Receptionist:
    def __init__(self, name: str) -> None:
        self.name = name
        self._slots: list[TimeSlot] = []

    def add_slot(self, slot: TimeSlot) -> None:
        self._slots.append(slot)

    def list_available(self) -> list[TimeSlot]:
        return available_slots(self._slots)

    def greet(self) -> str:
        return f"Welcome! I'm {self.name}, how can I help you today?"
