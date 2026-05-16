from __future__ import annotations

from bookstore.catalog.book import Book


def search_catalog(books: list[Book], query: str) -> list[Book]:
    q = query.lower()
    return [b for b in books if q in b.title.lower() or q in b.author.lower()]
