from __future__ import annotations

from bookstore.inventory.stock import Stock
from bookstore.orders.cart import Cart


class Order:
    def __init__(self, order_id: str, cart: Cart) -> None:
        self.order_id = order_id
        self._cart = cart
        self._status = "pending"

    @property
    def status(self) -> str:
        return self._status

    def confirm(self) -> None:
        self._status = "confirmed"

    def cancel(self) -> None:
        self._status = "cancelled"

    def total(self) -> float:
        return self._cart.total()


def process_order(order: Order, stock: Stock) -> bool:
    if order.status != "pending":
        return False
    order.confirm()
    return True
