# -*- coding: utf-8 -*-
"""Разбор справочника на § и нумерованные пункты. Исходный текст не публикуем."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "tools" / "spravochnik_utf8.txt"


def load_body():
    text = SRC.read_text(encoding="utf-8")
    # Тело орфографии — после оглавления, от второго «ОРФОГРАФИЯ»
    parts = text.split("\nОРФОГРАФИЯ\n")
    if len(parts) < 2:
        raise SystemExit("не найден раздел ОРФОГРАФИЯ")
    rest = parts[-1]
    if "\nПУНКТУАЦИЯ\n" not in rest:
        raise SystemExit("не найден раздел ПУНКТУАЦИЯ")
    ortho, punct_and_more = rest.split("\nПУНКТУАЦИЯ\n", 1)
    # предисловие пунктуации до первого РАЗДЕЛ 1 знаков
    m = re.search(r"\nРАЗДЕЛ 1\. ЗНАКИ ПРЕПИНАНИЯ", punct_and_more)
    punct = punct_and_more[m.start() :] if m else punct_and_more
    return ortho, punct


PARA = re.compile(r"^§\s+(\d+)\.\s+(.+)$", re.M)
RAZDEL = re.compile(r"^РАЗДЕЛ\s+(\d+)\.?\s*(.+)$", re.M)


def split_points(body: str):
    """Нумерованные пункты 1. 2. и примечания."""
    lines = body.splitlines()
    chunks = []
    buf = []
    current = None

    def flush():
        if current is None and not buf:
            return
        text = "\n".join(buf).strip()
        if current:
            chunks.append({**current, "text": text})
        elif text:
            chunks.append({"kind": "lead", "num": None, "text": text})
        buf.clear()

    item_re = re.compile(r"^(\d+)\.\s+(.*)$")
    note_re = re.compile(r"^Примечани[ея]\.?\s*(.*)$", re.I)
    excl_re = re.compile(r"^Исключени[ея]:?\s*(.*)$", re.I)

    for line in lines:
        s = line.strip()
        if not s:
            if buf:
                buf.append("")
            continue
        m = item_re.match(s)
        if m and (current is None or current.get("kind") in ("item", "lead", "note", "exception") or True):
            # новая нумерация верхнего уровня, если строка начинается с N. и N разумный
            n = int(m.group(1))
            if n <= 40 and (not buf or current is not None or n == 1):
                flush()
                current = {"kind": "item", "num": n}
                buf.append(m.group(2))
                continue
        if note_re.match(s):
            flush()
            current = {"kind": "note", "num": None}
            rest = note_re.match(s).group(1)
            buf.append(rest or s)
            continue
        if excl_re.match(s):
            flush()
            current = {"kind": "exception", "num": None}
            rest = excl_re.match(s).group(1)
            buf.append(rest or s)
            continue
        buf.append(s)
    flush()
    return chunks


def parse_part(text: str, part: str):
    razdels = []
    current_r = {"num": None, "title": "без раздела", "start": 0}
    positions = [(m.start(), m.group(1), m.group(2).strip()) for m in RAZDEL.finditer(text)]
    rules = []
    # split by §
    matches = list(PARA.finditer(text))
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        # раздел: последний РАЗДЕЛ перед этим §
        rtitle = "без раздела"
        rnum = None
        for pos, num, title in positions:
            if pos < m.start():
                rnum, rtitle = int(num), title
            else:
                break
        body = text[start:end].strip()
        points = split_points(body)
        rules.append(
            {
                "part": part,
                "section_num": rnum,
                "section_title": rtitle,
                "n": int(m.group(1)),
                "title": m.group(2).strip(),
                "point_count": len(points),
                "kinds": [p["kind"] for p in points],
                "chars": len(body),
                "points": [
                    {
                        "kind": p["kind"],
                        "num": p["num"],
                        "chars": len(p["text"]),
                        "head": re.sub(r"\s+", " ", p["text"])[:180],
                    }
                    for p in points
                ],
            }
        )
    return rules


def main():
    ortho, punct = load_body()
    o_rules = parse_part(ortho, "orthography")
    p_rules = parse_part(punct, "punctuation")
    index = {
        "orthography_rules": len(o_rules),
        "punctuation_rules": len(p_rules),
        "orthography_points": sum(r["point_count"] for r in o_rules),
        "punctuation_points": sum(r["point_count"] for r in p_rules),
        "orthography": o_rules,
        "punctuation": p_rules,
    }
    out = ROOT / "tools" / "handbook_index.json"
    out.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"орфография §={index['orthography_rules']} пунктов={index['orthography_points']}; "
        f"пунктуация §={index['punctuation_rules']} пунктов={index['punctuation_points']}"
    )
    for r in o_rules:
        print(f"O §{r['n']:2d} ({r['point_count']:2d} п.) {r['title']}")
    print("---")
    for r in p_rules:
        print(f"P §{r['n']:2d} ({r['point_count']:2d} п.) {r['title']}")


if __name__ == "__main__":
    main()
