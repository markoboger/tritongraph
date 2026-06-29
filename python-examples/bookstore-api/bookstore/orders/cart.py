from __future__ import annotations

from bookstore.catalog.base import Item
from bookstore.inventory.stock import Stock


class Cart:
    def __init__(self, customer_id: str, stock: Stock) -> None:
        self.customer_id = customer_id
        self._stock = stock
        self._items: list[tuple[Item, int]] = []

    def add(self, item: Item, quantity: int = 1) -> bool:
        if not self._stock.is_in_stock(getattr(item, "isbn", "")):
            return False
        self._items.append((item, quantity))
        return True

    def remove(self, title: str) -> None:
        self._items = [(i, q) for i, q in self._items if i.title != title]

    def total(self) -> float:
        return sum(item.price * qty for item, qty in self._items)

    def item_count(self) -> int:
        return sum(qty for _, qty in self._items)

    def clear(self) -> None:
        self._items = []
