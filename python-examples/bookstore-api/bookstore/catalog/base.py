from __future__ import annotations


class Item:
    def __init__(self, title: str, price: float) -> None:
        self.title = title
        self.price = price

    def display_price(self) -> str:
        return f"${self.price:.2f}"

    def is_available(self) -> bool:
        return True


class DigitalAsset:
    def __init__(self, file_size_mb: float, format: str) -> None:
        self.file_size_mb = file_size_mb
        self.format = format

    def download_url(self) -> str:
        return f"/assets/{self.format}"

    def is_drm_protected(self) -> bool:
        return False
