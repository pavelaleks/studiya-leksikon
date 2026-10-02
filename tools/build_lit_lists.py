# -*- coding: utf-8 -*-
"""Собирает лёгкие *.list.json для списков заданий (без фрагментов и пояснений)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / "js" / "literature-data" / "bank"

LIST_KEYS = (
    "id",
    "topicId",
    "topic",
    "author",
    "work",
    "questionText",
    "typeLabel",
    "answerKind",
)


def slim_bank(data: dict) -> dict:
    return {
        "id": data.get("id"),
        "kind": data.get("kind"),
        "task": data.get("task"),
        "title": data.get("title"),
        "count": len(data.get("problems") or []),
        "problems": [
            {k: p.get(k) for k in LIST_KEYS if p.get(k) is not None}
            for p in (data.get("problems") or [])
        ],
    }


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    files = sorted(BANK.glob("*.json"))
    files = [p for p in files if not p.name.endswith(".list.json")]
    total_full = 0
    total_list = 0
    for path in files:
        data = json.loads(path.read_text(encoding="utf-8"))
        slim = slim_bank(data)
        out = path.with_name(path.stem + ".list.json")
        raw = json.dumps(slim, ensure_ascii=False, separators=(",", ":")) + "\n"
        out.write_text(raw, encoding="utf-8")
        full_sz = path.stat().st_size
        list_sz = out.stat().st_size
        total_full += full_sz
        total_list += list_sz
        print(f"{path.name}: {full_sz/1024:.0f} KB → {out.name} {list_sz/1024:.0f} KB")
    print(f"banks {total_full/1024/1024:.1f} MB → lists {total_list/1024/1024:.1f} MB")


if __name__ == "__main__":
    main()
