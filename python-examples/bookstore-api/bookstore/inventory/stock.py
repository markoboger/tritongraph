from __future__ import annotations

from bookstore.inventory.warehouse import Warehouse


class Stock:
    def __init__(self) -> None:
        self._warehouses: list[Warehouse] = []

    def add_warehouse(self, warehouse: Warehouse) -> None:
        self._warehouses.append(warehouse)

    def total_stock(self, isbn: str) -> int:
        return sum(w.stock_level(isbn) for w in self._warehouses)

    def is_in_stock(self, isbn: str) -> bool:
        return self.total_stock(isbn) > 0


def restock(stock: Stock, warehouse: Warehouse, isbn: str, quantity: int) -> None:
    warehouse.receive(isbn, quantity)
