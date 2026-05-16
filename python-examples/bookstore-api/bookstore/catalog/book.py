from bookstore.catalog.base import Item


class Book(Item):
    def __init__(self, title: str, author: str, isbn: str, price: float, pages: int) -> None:
        super().__init__(title, price)
        self.author = author
        self.isbn = isbn
        self.pages = pages

    def reading_time_hours(self) -> float:
        words_per_page = 250
        words_per_minute = 200
        return (self.pages * words_per_page) / (words_per_minute * 60)

    def citation(self) -> str:
        return f"{self.author}. {self.title}. ISBN {self.isbn}."
