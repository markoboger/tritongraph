from bookstore.catalog.base import DigitalAsset
from bookstore.catalog.book import Book


class EBook(Book, DigitalAsset):
    def __init__(
        self,
        title: str,
        author: str,
        isbn: str,
        price: float,
        pages: int,
        file_size_mb: float,
        format: str = "epub",
    ) -> None:
        Book.__init__(self, title, author, isbn, price, pages)
        DigitalAsset.__init__(self, file_size_mb, format)

    def is_drm_protected(self) -> bool:
        return True

    def download_url(self) -> str:
        return f"/ebooks/{self.isbn}.{self.format}"
