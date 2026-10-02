# -*- coding: utf-8 -*-
"""Собирает словарь литературоведческих терминов из web + PDF."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "tools" / "_termin_web.txt"
PDF = ROOT / "tools" / "_termin_pdf.txt"
OUT_MD = ROOT / "Литература ЕГЭ" / "Словарь литературоведческих терминов.md"
OUT_JSON = ROOT / "js" / "literature-data" / "terms.json"


def clean(s: str) -> str:
    s = (
        s.replace("\u00a0", " ")
        .replace("\u202f", " ")
        .replace("\xad", "")
        .replace("\ufeff", "")
        .replace("\r", "")
    )
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r" *\n *", "\n", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()


def norm_key(term: str) -> str:
    t = term.lower().replace("ё", "е")
    t = re.sub(r"\([^)]*\)", " ", t)
    t = re.sub(r"[«»\"“”'`()\[\].,:;!?/\\-]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def slugify(term: str, used: set[str]) -> str:
    base = re.sub(r"[^\wа-яА-ЯёЁ]+", "-", term, flags=re.U).strip("-").lower().replace("ё", "е")
    base = base or "term"
    s = base
    i = 2
    while s in used:
        s = f"{base}-{i}"
        i += 1
    used.add(s)
    return s


def letter_of(term: str) -> str:
    for ch in term:
        up = ch.upper().replace("Ё", "Е")
        if "А" <= up <= "Я":
            return up
        if "A" <= up <= "Z":
            return "#"
    return "#"


def split_term_def(chunk: str) -> tuple[str, str] | None:
    depth = 0
    for i, ch in enumerate(chunk):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif depth == 0 and ch in "–—" and i > 0 and i + 1 < len(chunk):
            if chunk[i - 1] == " " and chunk[i + 1] == " ":
                term = clean(chunk[:i])
                definition = clean(chunk[i + 1 :])
                if term and definition:
                    return term, definition
    return None


def looks_like_term(term: str) -> bool:
    if not (2 <= len(term) <= 90):
        return False
    low = term.lower()
    if low.startswith(("если ", "знание ", "работа ", "проще ", "многие ", "это ", "характеристика ")):
        return False
    if term.count(" ") > 10:
        return False
    if not re.search(r"[А-ЯЁA-Za-zа-яё]", term):
        return False
    return True


def slice_section(text: str, starts: list[str], ends: list[str]) -> str:
    text = clean(text)
    start = 0
    for marker in starts:
        i = text.lower().find(marker.lower())
        if i >= 0:
            start = i + len(marker)
            break
    end = len(text)
    for marker in ends:
        i = text.find(marker, start)
        if i >= 0:
            end = min(end, i)
    return text[start:end].strip()


def parse_web(text: str) -> list[tuple[str, str]]:
    body = slice_section(
        text,
        ["включенные в кодификатор", "включённые в кодификатор"],
        ["Работа со списком", "БЕСПЛАТНЫЕ УРОКИ"],
    )
    terms = []
    for chunk in re.split(r"\n\s*\n+", body):
        lines = [clean(ln) for ln in chunk.split("\n") if clean(ln)]
        if not lines:
            continue
        pair = None
        for ln in lines:
            cand = split_term_def(ln)
            if cand and looks_like_term(polish_term(cand[0])):
                pair = cand
                break
        if not pair:
            pair = split_term_def(clean(" ".join(lines)))
        if not pair:
            continue
        term, definition = pair
        term = polish_term(term)
        if looks_like_term(term):
            terms.append((term, definition))
    return terms


def parse_pdf(text: str) -> list[tuple[str, str]]:
    body = slice_section(text, ["кодификатор ЕГЭ 2025", "кодификатор ЕГЭ"], [])
    lines = [ln.strip() for ln in body.splitlines()]
    paras: list[str] = []
    buf: list[str] = []
    for ln in lines:
        if not ln:
            if buf:
                paras.append(" ".join(buf))
                buf = []
            continue
        new_term = bool(re.match(r'^[А-ЯЁA-Z«"].{0,80}[–—]', ln))
        if buf and new_term:
            paras.append(" ".join(buf))
            buf = [ln]
        else:
            buf.append(ln)
    if buf:
        paras.append(" ".join(buf))

    terms = []
    for para in paras:
        para = clean(para)
        pair = split_term_def(para)
        if not pair:
            continue
        term, definition = pair
        term = polish_term(term)
        if looks_like_term(term):
            terms.append((term, definition))
    return terms


CATEGORIES = [
    (
        "история-и-процесс",
        "Историко-литературный процесс",
        (
            "историко",
            "контекст",
            "традиц",
            "новатор",
            "направление",
            "течение",
            "метод",
            "реализм",
            "романтизм",
            "классицизм",
            "сентиментализм",
            "модернизм",
            "символизм",
            "акмеизм",
            "футуризм",
            "имажинизм",
            "постмодерн",
            "натурализм",
            "критический реализм",
            "социалистический",
            "культурно",
            "массовая литература",
            "сетевая",
            "беллетрист",
            "фольклор",
            "миф",
            "критика",
            "историзм",
            "народность",
            "вечные темы",
            "вечные образы",
        ),
    ),
    (
        "роды-и-жанры",
        "Роды и жанры",
        (
            "род литературы",
            "литературный род",
            "жанр",
            "эпос",
            "лирика",
            "драма",
            "роман",
            "повесть",
            "рассказ",
            "новелла",
            "очерк",
            "поэма",
            "баллада",
            "ода",
            "элегия",
            "послание",
            "эпиграмма",
            "сонет",
            "комедия",
            "трагедия",
            "басня",
            "сказка",
            "былина",
            "притча",
            "трагикомедия",
            "водевиль",
            "мелодрама",
            "лиро-эпос",
            "лироэпич",
            "песня",
            "сказ",
        ),
    ),
    (
        "композиция-и-сюжет",
        "Композиция и сюжет",
        (
            "композиц",
            "сюжет",
            "фабул",
            "экспозиц",
            "завязк",
            "развитие действия",
            "кульминац",
            "развязк",
            "эпилог",
            "пролог",
            "конфликт",
            "коллиз",
            "хронотоп",
            "пейзаж",
            "интерьер",
            "портрет",
            "диалог",
            "монолог",
            "ремарка",
            "ретроспекц",
            "кольцев",
            "обрамлен",
            "вставн",
            "внесюжет",
            "перипети",
            "отступлен",
            "заглавие",
            "эпиграф",
        ),
    ),
    (
        "герой-и-образ",
        "Герой и образ",
        (
            "герой",
            "персонаж",
            "образ",
            "характер",
            "тип",
            "антигерой",
            "прототип",
            "система образов",
            "лирический герой",
            "повествовател",
            "рассказчик",
            "автор",
            "двойник",
            "речевая характеристика",
        ),
    ),
    (
        "тропы-и-фигуры",
        "Тропы и фигуры речи",
        (
            "троп",
            "фигур",
            "метафор",
            "эпитет",
            "сравнен",
            "олицетворен",
            "метоними",
            "синекдох",
            "гипербол",
            "литот",
            "ирония",
            "сарказм",
            "гротеск",
            "аллегори",
            "символ",
            "оксюморон",
            "перифраз",
            "антитез",
            "инверси",
            "анафор",
            "эпифор",
            "повтор",
            "параллелизм",
            "градац",
            "рефрен",
            "риторическ",
            "многосоюзие",
            "бессоюзие",
            "парцелляц",
            "эллипсис",
            "аллитерац",
            "ассонанс",
            "звукопис",
            "каламбур",
            "аллюзия",
            "реминисценц",
            "интертекст",
            "изобразительно-выразительн",
        ),
    ),
    (
        "стих-и-стилистика",
        "Стихосложение и стиль",
        (
            "стих",
            "строф",
            "стопа",
            "метр",
            "размер",
            "ямб",
            "хорей",
            "дактил",
            "амфибрах",
            "анапест",
            "дольник",
            "тактовик",
            "акцентн",
            "верлибр",
            "белый стих",
            "свободный стих",
            "рифм",
            "клаузул",
            "цезур",
            "пиррих",
            "спондей",
            "силлаб",
            "тоническ",
            "стиль",
            "стилизац",
            "язык художествен",
            "поэтик",
            "ритм",
        ),
    ),
]


def categorize(term: str, definition: str) -> tuple[str, str]:
    blob = f"{term} {definition}".lower().replace("ё", "е")
    for cat_id, title, keys in CATEGORIES:
        if any(k in blob for k in keys):
            return cat_id, title
    return "общее", "Общие понятия"


def polish_term(term: str) -> str:
    term = clean(term)
    term = re.sub(r"\s+", " ", term)
    if ". " in term:
        head, tail = term.split(". ", 1)
        head, tail = head.strip(), tail.strip()
        if len(head) >= 8 and ("»" in head or head.startswith(("«", '"', "“")) or len(head) > 42):
            term = head
        elif looks_like_term(tail) and len(tail) <= 60:
            term = tail
    term = re.sub(r"\s+в литературе\.?$", "", term, flags=re.I)
    if re.match(r"^[А-ЯЁа-яё].*»", term) and "«" not in term:
        term = "«" + term
    term = term.strip(' "“”')
    if ":" in term and len(term) > 42:
        left = term.split(":", 1)[0].strip()
        if 3 <= len(left) <= 55:
            term = left
    # Prefer bare lemma over long etymology title
    m = re.match(r"^(.{2,40}?)\s*\([^)]{3,}\)\s*$", term)
    if m and looks_like_term(m.group(1).strip()):
        term = m.group(1).strip()
    return term.strip(" .;:")


def merge(web: list[tuple[str, str]], pdf: list[tuple[str, str]]) -> list[dict]:
    by_key: dict[str, dict] = {}
    order: list[str] = []
    used_ids: set[str] = set()

    def add(term: str, definition: str, source: str) -> None:
        term = polish_term(term)
        definition = clean(definition)
        key = norm_key(term)
        if not key or not definition:
            return
        if key in by_key:
            old = by_key[key]
            if source not in old["sources"]:
                old["sources"].append(source)
            if len(term) < len(old["term"]):
                old["term"] = term
                old["letter"] = letter_of(term)
            if source == "pdf" and len(old["definition"]) > 450 and len(definition) < len(old["definition"]):
                old["definition"] = definition
            return
        cat_id, cat_title = categorize(term, definition)
        by_key[key] = {
            "id": slugify(term, used_ids),
            "term": term,
            "definition": definition,
            "letter": letter_of(term),
            "category": cat_id,
            "categoryTitle": cat_title,
            "sources": [source],
        }
        order.append(key)

    for term, definition in web:
        add(term, definition, "literatura100")
    for term, definition in pdf:
        add(term, definition, "pdf")

    items = [by_key[k] for k in order]
    items.sort(key=lambda x: (x["letter"] == "#", x["letter"], norm_key(x["term"])))
    for item in items:
        item.pop("preferred", None)
    return items


def to_md(items: list[dict]) -> str:
    lines = [
        "# Словарь литературоведческих терминов",
        "",
        f"Всего терминов: **{len(items)}**.",
        "",
        "Источники: [literatura100.ru/termin](https://www.literatura100.ru/termin); недостающие позиции дополнены из словаря терминов кодификатора ЕГЭ (PDF).",
        "",
    ]
    current = None
    for item in items:
        if item["letter"] != current:
            current = item["letter"]
            lines += ["", f"## {current}", ""]
        lines += [f"### {item['term']}", "", item["definition"], ""]
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    web = parse_web(WEB.read_text(encoding="utf-8"))
    pdf = parse_pdf(PDF.read_text(encoding="utf-8"))
    items = merge(web, pdf)
    pdf_only = [x for x in items if x["sources"] == ["pdf"]]
    OUT_MD.parent.mkdir(parents=True, exist_ok=True)
    OUT_MD.write_text(to_md(items), encoding="utf-8")
    payload = {
        "title": "Словарь литературоведческих терминов",
        "count": len(items),
        "sources": [
            {"id": "literatura100", "name": "literatura100.ru", "url": "https://www.literatura100.ru/termin"},
            {"id": "pdf", "name": "Словарь терминов кодификатора ЕГЭ (PDF)"},
        ],
        "categories": [{"id": c[0], "title": c[1]} for c in CATEGORIES]
        + [{"id": "общее", "title": "Общие понятия"}],
        "letters": sorted({i["letter"] for i in items if i["letter"] != "#"})
        + (["#"] if any(i["letter"] == "#" for i in items) else []),
        "terms": items,
    }
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"web={len(web)} pdf={len(pdf)} merged={len(items)} pdf_only={len(pdf_only)}")
    for t in pdf_only[:25]:
        print(f"  + {t['term']}")
    print(f"wrote {OUT_MD.relative_to(ROOT)}")
    print(f"wrote {OUT_JSON.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
