from bookstore.catalog.base import DigitalAsset
from bookstore.catalog.book import Book


class AudioBook(Book, DigitalAsset):
    def __init__(
        self,
        title: str,
        author: str,
        narrator: str,
        isbn: str,
        price: float,
        pages: int,
        duration_minutes: int,
        file_size_mb: float,
    ) -> None:
        Book.__init__(self, title, author, isbn, price, pages)
        DigitalAsset.__init__(self, file_size_mb, "mp3")
        self.narrator = narrator
        self.duration_minutes = duration_minutes

    def listening_speed_ratio(self) -> float:
        reading_hours = self.reading_time_hours()
        return (self.duration_minutes / 60) / reading_hours if reading_hours else 1.0

    def download_url(self) -> str:
        return f"/audiobooks/{self.isbn}.mp3"
