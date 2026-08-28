# -*- coding: utf-8 -*-
"""Сверка: у каждой карточки не меньше пунктов, чем в разборе справочника."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def genuine_points(points):
    """Parser sometimes glues the next РАЗДЕЛ onto the last paragraph of a §."""
    out = []
    for p in points or []:
        text = p.get("text") or ""
        if "РАЗДЕЛ" in text:
            before = text.split("РАЗДЕЛ", 1)[0].strip()
            if before:
                q = dict(p)
                q["text"] = before
                out.append(q)
            break
        out.append(p)
    return out


def rules_from_section(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    out = {}
    for ch in data["chapters"]:
        for r in ch.get("rules") or []:
            out[r["id"]] = r
    return out


def main():
    points = json.loads((ROOT / "tools" / "handbook_points.json").read_text(encoding="utf-8"))
    ortho = rules_from_section(ROOT / "data" / "orthography.json")
    punct = rules_from_section(ROOT / "data" / "punctuation.json")
    errors = []
    warns = []

    def check(src_list, site_map, prefix):
        for src in src_list:
            n = src["n"]
            if isinstance(n, int):
                rid = f"{prefix}-{n:02d}"
            else:
                rid = {"r4": "ortho-razd-4", "r15": "ortho-razd-15", "r16": "ortho-razd-16", "r18": "ortho-razd-18", "r19": "ortho-razd-19"}.get(str(n))
            if not rid or rid not in site_map:
                errors.append(f"нет карточки для {src['part']} {n} «{src['title']}» (ждали {rid})")
                continue
            card = site_map[rid]
            need = len(genuine_points(src.get("points") or []))
            got = len(card.get("theory") or [])
            if got < need:
                errors.append(f"{rid}: блоков {got} < пунктов источника {need} ({src['title']})")
            elif got > need + 3:
                warns.append(f"{rid}: блоков {got} заметно больше пунктов {need}")
            if not (card.get("summary") or "").strip():
                errors.append(f"{rid}: пустой summary")

    check(points["orthography"], ortho, "ortho")
    check(points["punctuation"], punct, "punct")

    print(f"site ortho {len(ortho)} punct {len(punct)}")
    for w in warns:
        print("WARN", w)
    if errors:
        print("ERRORS", len(errors))
        for e in errors[:40]:
            print(" -", e)
        if len(errors) > 40:
            print(f" ... и ещё {len(errors)-40}")
        sys.exit(1)
    print("OK coverage")


if __name__ == "__main__":
    main()
