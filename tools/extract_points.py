# -*- coding: utf-8 -*-
"""Полный разбор пунктов справочника во внутренний JSON (не в git)."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "tools" / "spravochnik_utf8.txt"
PARA = re.compile(r"^§\s+(\d+)\.\s+(.+)$", re.M)
RAZDEL = re.compile(r"^РАЗДЕЛ\s+(\d+)\.?\s*(.+)$", re.M)


def load_bodies():
    text = SRC.read_text(encoding="utf-8")
    rest = text.split("\nОРФОГРАФИЯ\n")[-1]
    ortho, punct_more = rest.split("\nПУНКТУАЦИЯ\n", 1)
    m = re.search(r"\nРАЗДЕЛ 1\. ЗНАКИ ПРЕПИНАНИЯ", punct_more)
    punct = punct_more[m.start() :] if m else punct_more
    return ortho, punct


def split_points(body: str):
    lines = body.splitlines()
    chunks = []
    buf = []
    current = None
    item_re = re.compile(r"^(\d+)\.\s+(.*)$")
    note_re = re.compile(r"^Примечани[ея]\.?\s*(.*)$", re.I)
    excl_re = re.compile(r"^Исключени[ея]:?\s*(.*)$", re.I)

    def flush():
        nonlocal current
        text = "\n".join(buf).strip()
        if current:
            chunks.append({**current, "text": re.sub(r"[ \t]+", " ", text)})
        elif text:
            chunks.append({"kind": "lead", "num": None, "text": re.sub(r"[ \t]+", " ", text)})
        buf.clear()
        current = None

    for line in lines:
        s = line.strip()
        if not s:
            if buf:
                buf.append("")
            continue
        m = item_re.match(s)
        if m:
            n = int(m.group(1))
            if 1 <= n <= 40:
                flush()
                current = {"kind": "item", "num": n}
                buf.append(m.group(2))
                continue
        if note_re.match(s):
            flush()
            current = {"kind": "note", "num": None}
            buf.append(note_re.match(s).group(1) or s)
            continue
        if excl_re.match(s):
            flush()
            current = {"kind": "exception", "num": None}
            buf.append(excl_re.match(s).group(1) or s)
            continue
        buf.append(s)
    flush()
    return chunks


def parse_part(text, part):
    positions = [(m.start(), int(m.group(1)), m.group(2).strip()) for m in RAZDEL.finditer(text)]
    matches = list(PARA.finditer(text))
    rules = []
    for i, m in enumerate(matches):
        start, end = m.end(), matches[i + 1].start() if i + 1 < len(matches) else len(text)
        rnum, rtitle = None, "без раздела"
        for pos, num, title in positions:
            if pos < m.start():
                rnum, rtitle = num, title
            else:
                break
        body = text[start:end].strip()
        rules.append(
            {
                "part": part,
                "section_num": rnum,
                "section_title": rtitle,
                "n": int(m.group(1)),
                "title": m.group(2).strip(),
                "points": split_points(body),
            }
        )
    return rules


def extra_sections(ortho_text):
    extras = []
    specs = [
        (r"РАЗДЕЛ 4\. РАЗДЕЛИТЕЛЬНЫЕ Ъ И Ь", r"РАЗДЕЛ 5", 4, "Разделительные ъ и ь"),
        (r"РАЗДЕЛ 15\. ПРАВОПИСАНИЕ ПРЕДЛОГОВ", r"РАЗДЕЛ 16", 15, "Правописание предлогов"),
        (r"РАЗДЕЛ 16\. ПРАВОПИСАНИЕ СОЮЗОВ", r"РАЗДЕЛ 17", 16, "Правописание союзов"),
        (r"РАЗДЕЛ 18\. ПРАВОПИСАНИЕ МЕЖДОМЕТИИ", r"РАЗДЕЛ 19", 18, "Междометия и звукоподражания"),
        (r"РАЗДЕЛ 19\. ПРАВОПИСАНИЕ НЕКОТОРЫХ ИНОСТРАННЫХ СЛОВ", r"ПУНКТУАЦИЯ|\Z", 19, "Некоторые иностранные слова"),
    ]
    for start_pat, end_pat, num, title in specs:
        sm = re.search(start_pat, ortho_text)
        if not sm:
            continue
        em = re.search(end_pat, ortho_text[sm.end() :])
        body = ortho_text[sm.end() : sm.end() + (em.start() if em else 4000)].strip()
        extras.append(
            {
                "part": "orthography",
                "section_num": num,
                "section_title": title,
                "n": f"r{num}",
                "title": title,
                "points": split_points(body),
            }
        )
    return extras


def main():
    ortho, punct = load_bodies()
    data = {
        "orthography": parse_part(ortho, "orthography") + extra_sections(ortho),
        "punctuation": parse_part(punct, "punctuation"),
    }
    out = ROOT / "tools" / "handbook_points.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", out, "ortho", len(data["orthography"]), "punct", len(data["punctuation"]))


if __name__ == "__main__":
    main()
