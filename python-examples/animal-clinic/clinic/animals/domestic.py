from clinic.animals.base import Animal


class Pet(Animal):
    def __init__(self, name: str, species: str, age: int, owner: str) -> None:
        super().__init__(name, species, age)
        self._owner = owner

    @property
    def owner(self) -> str:
        return self._owner

    def greet(self) -> str:
        return f"{self.name} greets {self._owner}"


class Dog(Pet):
    def sound(self) -> str:
        return "woof"

    def fetch(self, item: str) -> str:
        return f"{self.name} fetches the {item}"


class Cat(Pet):
    def sound(self) -> str:
        return "meow"

    def purr(self) -> str:
        return f"{self.name} purrs softly"
