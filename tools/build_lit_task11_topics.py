# -*- coding: utf-8 -*-
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "Литература ЕГЭ" / "Темы сочинений ЕГЭ литература (сводный список).md"
OUT = ROOT / "js" / "literature-data" / "ege-task-11-topics.json"


def slugify(title: str, used: set) -> str:
    base = re.sub(r"[^\wа-яА-ЯёЁ]+", "-", title, flags=re.U).strip("-").lower()
    base = base.replace("ё", "е") or "period"
    s = base
    i = 2
    while s in used:
        s = f"{base}-{i}"
        i += 1
    used.add(s)
    return s


def main() -> None:
    text = SRC.read_text(encoding="utf-8")
    periods = []
    cur_period = None
    cur_author = None
    used_ids: set[str] = set()

    for line in text.splitlines():
        if line.startswith("## "):
            title = line[3:].strip()
            cur_period = {"id": slugify(title, used_ids), "title": title, "authors": []}
            periods.append(cur_period)
            cur_author = None
            continue
        if line.startswith("### "):
            if not cur_period:
                continue
            cur_author = {"name": line[4:].strip(), "topics": []}
            cur_period["authors"].append(cur_author)
            continue
        m = re.match(r"^(\d+)\.\s+(.+)$", line)
        if m and cur_author is not None:
            cur_author["topics"].append({"n": int(m.group(1)), "text": m.group(2).strip()})

    for p in periods:
        p["authors"] = [a for a in p["authors"] if a["topics"]]
        p["count"] = sum(len(a["topics"]) for a in p["authors"])
    periods = [p for p in periods if p["authors"]]

    total = sum(p["count"] for p in periods)
    data = {
        "title": "Темы сочинений ЕГЭ по литературе (задание 11)",
        "task": 11,
        "total": total,
        "periods": periods,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} topics={total} periods={len(periods)}")
    for p in periods:
        print(f"  {p['id']}: {p['count']} topics, {len(p['authors'])} authors")


if __name__ == "__main__":
    main()
