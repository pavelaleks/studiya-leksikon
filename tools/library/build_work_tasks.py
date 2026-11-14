"""Задания ЕГЭ по литературе к произведениям библиотеки: какие задания 1–5 построены на фрагменте
из какой главы, какие сочинения (задание 11) касаются произведения.

python3 tools/library/build_work_tasks.py  →  js/library-data/work-tasks.json
В файл идут только номера заданий и темы сочинений (ответов там нет).
Нужен локальный банк js/literature-data (в git не попадает).
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(os.path.dirname(HERE))
LIT = os.path.join(SITE, "js", "literature-data")
LIB = os.path.join(SITE, "js", "library-data")

# название в банке → id произведения в библиотеке
TITLE_TO_WORK = {
    "отцы и дети": "otcy", "война и мир": "voyna", "воина и мир": "voyna", "гроза": "groza", "на дне": "na-dne",
    "преступление и наказание": "prestuplenie", "тихий дон": "don", "обломов": "oblomov", "вишнёвый сад": "sad",
    "вишневый сад": "sad", "кому на руси жить хорошо": "komu", "старуха изергиль": "gorky-rasskazy",
    "человек в футляре": "chekhov", "двенадцать": "dvenadcat", "молодая гвардия": "gvardiya",
}
# как произведение называют в темах сочинений
TOPIC_TITLES = {
    "otcy": ["Отцы и дети"], "voyna": ["Война и мир"], "groza": ["Гроза"], "na-dne": ["На дне"],
    "prestuplenie": ["Преступление и наказание"], "don": ["Тихий Дон"], "oblomov": ["Обломов"],
    "sad": ["Вишнёвый сад", "Вишневый сад"], "komu": ["Кому на Руси жить хорошо"],
    "gorky-rasskazy": ["Старуха Изергиль", "Челкаш"], "chekhov": ["Человек в футляре", "Ионыч", "Студент", "Крыжовник", "О любви", "Дама с собачкой"],
    "dvenadcat": ["Двенадцать"], "gvardiya": ["Молодая гвардия"], "master": ["Мастер и Маргарита"],
    "gore": ["Горе от ума"], "onegin": ["Евгений Онегин"], "dochka": ["Капитанская дочка"],
    "geroy": ["Герой нашего времени"], "revizor": ["Ревизор"], "dushi": ["Мёртвые души", "Мертвые души"],
    "istoriya": ["История одного города"], "oblako": ["Облако в штанах"], "odin-den": ["Один день Ивана Денисовича"],
    "my": ["«Мы»"], "kotlovan": ["Котлован"], "matera": ["Прощание с Матёрой"], "nedorosl": ["Недоросль"],
    "slovo": ["Слово о полку Игореве"], "strannik": ["Очарованный странник"], "levsha": ["Левша"],
    "braslet": ["Гранатовый браслет"], "olesya": ["Олеся"], "poedinok": ["Поединок"], "bunin": ["Господин из Сан-Франциско", "Чистый понедельник", "Тёмные аллеи", "Антоновские яблоки", "Лёгкое дыхание"],
    "skazki": ["сказк"], "chernyi": ["Чёрный человек"], "rekviem": ["Реквием"], "gvardiya-belaya": ["Белая гвардия"],
    "serdce": ["Собачье сердце"], "zhivago": ["Доктор Живаго"], "terkin": ["Василий Тёркин"], "arhipelag": ["Архипелаг ГУЛАГ"],
    "stal": ["Как закалялась сталь"], "iuda": ["Иуда Искариот"], "chto-delat": ["Что делать?"],
}


def norm(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = s.lower().replace("ё", "е")
    return re.sub(r"[^а-яa-z]+", "", s)


def chapter_texts(work):
    """Нормализованный текст каждой главы произведения из библиотеки."""
    out = []
    for i, t in enumerate(work.get("toc") or []):
        part = json.load(open(os.path.join(LIB, "texts", f"{work['id']}-{t['p']}.json")))
        out.append(norm(part[t["i"]]["h"]))
    return out


def find_chapter(chapters, passage_html):
    p = norm(passage_html)
    if len(p) < 60:
        return None
    # несколько кусков из середины фрагмента: начало часто правят («(...)», сокращения)
    for start in (40, 200, 400, 20, 0):
        snip = p[start:start + 60]
        if len(snip) < 40:
            continue
        for i, ch in enumerate(chapters):
            if snip in ch:
                return i
    return None


def main():
    cat = json.load(open(os.path.join(LIB, "catalog.json")))
    works = {w["id"]: w for w in cat["works"]}
    chapters = {}
    out = {}
    for n in range(1, 6):
        bank = json.load(open(os.path.join(LIT, "bank", f"ege-{n:02d}.json")))
        passages = bank["passages"]
        for p in bank["problems"]:
            if p.get("kind") != "ege":
                continue
            wid = TITLE_TO_WORK.get(str(p.get("work") or "").strip().lower())
            if not wid or wid not in works:
                continue
            if wid not in chapters and works[wid].get("toc"):
                chapters[wid] = chapter_texts(works[wid])
            ch = None
            if wid in chapters and p.get("passageId") not in (None, "None"):
                ch = find_chapter(chapters[wid], (passages.get(str(p["passageId"])) or {}).get("html", ""))
            out.setdefault(wid, {"tasks": [], "essays": [], "topics": []})["tasks"].append([int(p["id"]), n, ch])
    # сочинения: варианты задания 11, где среди тем есть это произведение
    bank11 = json.load(open(os.path.join(LIT, "bank", "ege-11.json")))
    for p in bank11["problems"]:
        if p.get("kind") != "ege":
            continue
        q = p.get("questionText") or ""
        for wid, names in TOPIC_TITLES.items():
            if wid in works and any(name in q for name in names):
                out.setdefault(wid, {"tasks": [], "essays": [], "topics": []})["essays"].append(int(p["id"]))
    topics = json.load(open(os.path.join(LIT, "ege-task-11-topics.json")))
    for period in topics["periods"]:
        for a in period["authors"]:
            for t in a["topics"]:
                for wid, names in TOPIC_TITLES.items():
                    if wid in works and any(name in t["text"] for name in names):
                        lst = out.setdefault(wid, {"tasks": [], "essays": [], "topics": []})["topics"]
                        if t["text"] not in lst:
                            lst.append(t["text"])
    for v in out.values():
        v["tasks"].sort(key=lambda x: (x[1], x[2] if x[2] is not None else 9999, x[0]))
    json.dump(out, open(os.path.join(LIB, "work-tasks.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    for wid, v in sorted(out.items(), key=lambda x: -len(x[1]["tasks"])):
        placed = sum(1 for t in v["tasks"] if t[2] is not None)
        print(f"{wid:16} заданий {len(v['tasks']):3} (к главе {placed:3}) сочинений {len(v['essays']):3} тем {len(v['topics']):3}")


if __name__ == "__main__":
    main()
