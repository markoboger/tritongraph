from clinic.animals.base import Animal


class ExoticAnimal(Animal):
    def __init__(self, name: str, species: str, age: int, origin: str) -> None:
        super().__init__(name, species, age)
        self._origin = origin

    @property
    def origin(self) -> str:
        return self._origin

    def care_requirements(self) -> list[str]:
        return ["specialized diet", "controlled environment"]


class Parrot(ExoticAnimal):
    def __init__(self, name: str, age: int, origin: str, vocabulary: list[str]) -> None:
        super().__init__(name, "Psittacine", age, origin)
        self._vocabulary = vocabulary

    def sound(self) -> str:
        return "squawk"

    def speak(self) -> str:
        return self._vocabulary[0] if self._vocabulary else "..."

    def teach(self, word: str) -> None:
        self._vocabulary.append(word)
