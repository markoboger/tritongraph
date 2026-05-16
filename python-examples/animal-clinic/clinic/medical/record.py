from __future__ import annotations

from clinic.animals.base import Animal


class Diagnosis:
    def __init__(self, code: str, description: str, severity: str) -> None:
        self.code = code
        self.description = description
        self.severity = severity

    def summary(self) -> str:
        return f"[{self.code}] {self.description} ({self.severity})"


class MedicalRecord:
    def __init__(self, animal: Animal) -> None:
        self._animal = animal
        self._diagnoses: list[Diagnosis] = []
        self._notes: list[str] = []

    @property
    def animal(self) -> Animal:
        return self._animal

    def add_diagnosis(self, diagnosis: Diagnosis) -> None:
        self._diagnoses.append(diagnosis)

    def add_note(self, note: str) -> None:
        self._notes.append(note)

    def all_diagnoses(self) -> list[Diagnosis]:
        return list(self._diagnoses)

    def latest_diagnosis(self) -> Diagnosis | None:
        return self._diagnoses[-1] if self._diagnoses else None
