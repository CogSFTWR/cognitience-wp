#!/usr/bin/env python3
"""
Cognitience WP — pyspellchecker integration for Python plugins.

Requires: pip install pyspellchecker

Usage:
  python python/spellcheck.py "Ths is a tset with Cognitience."
  python python/spellcheck.py --add-word Cognitience "Cognitience is valid now."
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Iterable

try:
    from spellchecker import SpellChecker
except ImportError:
    print(
        "pyspellchecker is not installed. Run: pip install pyspellchecker",
        file=sys.stderr,
    )
    sys.exit(1)


class CognitienceSpellChecker:
    """Thin wrapper around pyspellchecker for plugin / CLI use."""

    def __init__(self, language: str = "en") -> None:
        self._spell = SpellChecker(language=language)

    def add_word(self, word: str) -> None:
        self._spell.word_frequency.load_words([word.lower()])

    def add_words(self, words: Iterable[str]) -> None:
        self._spell.word_frequency.load_words([w.lower() for w in words if w])

    def is_correct(self, word: str) -> bool:
        return word.lower() in self._spell

    def correction(self, word: str) -> str | None:
        return self._spell.correction(word)

    def candidates(self, word: str) -> list[str]:
        return list(self._spell.candidates(word))

    def unknown(self, words: Iterable[str]) -> list[str]:
        return list(self._spell.unknown(words))

    def check_text(self, text: str) -> list[dict]:
        import re

        errors: list[dict] = []
        for match in re.finditer(r"[a-zA-Z]+(?:'[a-zA-Z]+)?", text):
            word = match.group(0)
            if len(word) <= 1:
                continue
            if word == word.upper() and len(word) > 1:
                continue
            if not self.is_correct(word):
                errors.append(
                    {
                        "word": word,
                        "start": match.start(),
                        "end": match.end(),
                        "suggestions": self.candidates(word)[:5],
                        "correction": self.correction(word),
                    }
                )
        return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Cognitience WP pyspellchecker CLI")
    parser.add_argument("text", nargs="?", default="", help="Text to check")
    parser.add_argument("--add-word", action="append", default=[], metavar="WORD")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    args = parser.parse_args()

    checker = CognitienceSpellChecker()
    for word in args.add_word:
        checker.add_word(word)

    if args.text:
        errors = checker.check_text(args.text)
        if args.json:
            print(json.dumps(errors, indent=2))
        else:
            if errors:
                for err in errors:
                    sugg = ", ".join(err["suggestions"][:3]) or "(none)"
                    print(f"{err['word']}: suggestions={sugg}")
            else:
                print("No spelling errors found.")
    else:
        demo = checker.check_text("Ths is a tset of speling.")
        print(f"pyspellchecker import ok")
        print(f"correction(speling)={checker.correction('speling')}")
        print(f"candidates: {checker.candidates('speling')[:3]}")
        print(f"unknown: {checker.unknown(['thsi', 'is', 'a', 'tset'])}")
        print(f"check_text demo: {len(demo)} error(s)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())