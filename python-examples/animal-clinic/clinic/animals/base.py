from __future__ import annotations


class Animal:
    def __init__(self, name: str, species: str, age: int) -> None:
        self._name = name
        self._species = species
        self._age = age

    @property
    def name(self) -> str:
        return self._name

    @property
    def species(self) -> str:
        return self._species

    @property
    def age(self) -> int:
        return self._age

    @staticmethod
    def is_adult(age: int) -> bool:
        return age >= 1

    def describe(self) -> str:
        return f"{self._name} ({self._species}), age {self._age}"

    def sound(self) -> str:
        return "..."
