from __future__ import annotations

from clinic.medical.record import MedicalRecord
from clinic.medical.treatment import Treatment


class Vet:
    def __init__(self, name: str, license_id: str) -> None:
        self.name = name
        self.license_id = license_id

    def examine(self, record: MedicalRecord) -> str:
        return f"Dr. {self.name} examined {record.animal.name}"

    def prescribe(self, treatment: Treatment, record: MedicalRecord) -> None:
        treatment.apply_to(record)

    def sign_record(self, record: MedicalRecord) -> None:
        record.add_note(f"Signed by Dr. {self.name} ({self.license_id})")


class Specialist(Vet):
    def __init__(self, name: str, license_id: str, specialty: str) -> None:
        super().__init__(name, license_id)
        self.specialty = specialty

    def consult(self, record: MedicalRecord) -> str:
        return f"Dr. {self.name} ({self.specialty}) consulted on {record.animal.name}"
