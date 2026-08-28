"""Общая выгрузка банка ЕГЭ в data/ege/."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "ege"


def dump_task(n: int, items: list[dict]) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    if len(items) != 40:
        raise SystemExit(f"task {n}: ожидалось 40, получено {len(items)}")
    for it in items:
        if isinstance(it.get("answer"), int):
            it["answer"] = str(it["answer"])
        if isinstance(it.get("answers"), list):
            it["answers"] = [str(x) for x in it["answers"]]
    ids = [it["id"] for it in items]
    if len(set(ids)) != 40:
        raise SystemExit(f"task {n}: повтор id")
    path = OUT / f"task-{n:02d}.json"
    path.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {path.name}: {len(items)}")
