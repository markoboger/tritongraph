from __future__ import annotations

from clinic.medical.record import Diagnosis, MedicalRecord


class Treatment:
    def __init__(self, name: str, duration_days: int, cost: float) -> None:
        self.name = name
        self.duration_days = duration_days
        self.cost = cost

    @classmethod
    def from_diagnosis(cls, diagnosis: Diagnosis, cost: float) -> Treatment:
        return cls(
            name=f"Treatment for {diagnosis.code}",
            duration_days=7,
            cost=cost,
        )

    @staticmethod
    def standard_dosage(weight_kg: float) -> float:
        return weight_kg * 0.05

    def apply_to(self, record: MedicalRecord) -> None:
        record.add_note(f"Applied: {self.name} for {self.duration_days} days")

    def estimated_cost(self) -> float:
        return self.cost
