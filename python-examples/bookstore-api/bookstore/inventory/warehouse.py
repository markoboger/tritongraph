from __future__ import annotations


class Warehouse:
    def __init__(self, location: str, capacity: int) -> None:
        self.location = location
        self.capacity = capacity
        self._inventory: dict[str, int] = {}

    def receive(self, isbn: str, quantity: int) -> None:
        self._inventory[isbn] = self._inventory.get(isbn, 0) + quantity

    def ship(self, isbn: str, quantity: int) -> bool:
        available = self._inventory.get(isbn, 0)
        if available < quantity:
            return False
        self._inventory[isbn] = available - quantity
        return True

    def stock_level(self, isbn: str) -> int:
        return self._inventory.get(isbn, 0)

    def utilization(self) -> float:
        total = sum(self._inventory.values())
        return total / self.capacity if self.capacity else 0.0
