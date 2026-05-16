from __future__ import annotations


class Label:
    def __init__(self, name: str, color: str) -> None:
        self.name = name
        self.color = color

    def css_class(self) -> str:
        return f"label-{self.name.lower().replace(' ', '-')}"

    def display(self) -> str:
        return f"[{self.name}]"
