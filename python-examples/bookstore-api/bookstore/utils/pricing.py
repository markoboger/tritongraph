from bookstore.catalog.base import Item


def apply_discount(item: Item, percent: float) -> float:
    return item.price * (1 - percent / 100)
