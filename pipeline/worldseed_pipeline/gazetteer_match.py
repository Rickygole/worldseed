"""Deterministic alias matching for gazetteer.json (reference for the TypeScript matcher).

normalize(): lower-case, replace every non-alphanumeric run with one space, trim.
match(text): normalized text is scanned for the longest alias occurring as a whole-word sequence; ties broken by
entry kind priority then id. `exact(text)` requires the whole normalized text to equal an alias.
"""
from __future__ import annotations

import re

KIND_PRIORITY = {"link": 0, "corridor": 1, "facility": 2, "road": 3, "neighborhood": 4}


def normalize(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def alias_index(entries: list[dict]) -> dict[str, dict]:
    idx: dict[str, dict] = {}
    for e in entries:
        for a in [e["name"]] + list(e.get("aliases", [])):
            idx.setdefault(normalize(a), e)
    return idx


def exact(idx: dict[str, dict], text: str):
    return idx.get(normalize(text))


def match(idx: dict[str, dict], text: str):
    t = " " + normalize(text) + " "
    best = None
    for alias, e in idx.items():
        if alias and (" " + alias + " ") in t:
            key = (-len(alias), KIND_PRIORITY[e["kind"]], e["id"])
            if best is None or key < best[0]:
                best = (key, e)
    return best[1] if best else None
