# -*- coding: utf-8 -*-
"""Parse РЕШУ ОГЭ type-2 PDF text into trainer JSON with visual basis markup."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "tools" / "_basis_raw.txt"
OUT = ROOT / "js" / "trainers-data" / "trenazher-osnova-leksikon.json"
OUT_DATA = ROOT / "data" / "trainers" / "trenazher-osnova-leksikon.json"

TASK_SPLIT = re.compile(r"(?m)^(\d+)\.\s+Тип\s+2\s+№\s+(\d+)")
ANSWER_RE = re.compile(r"О\s*т\s*в\s*е\s*т\s*:\s*([0-9]+)", re.I)


def clean_text(text: str) -> str:
    text = text.replace("\u00ad", "").replace("\u202f", " ").replace("\xa0", " ")
    # join hyphenated line breaks: при-\nвыкли -> привыкли
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)
    text = text.replace("\n", " ")
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


def split_tasks(text: str) -> list[dict]:
    matches = list(TASK_SPLIT.finditer(text))
    tasks = []
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        tasks.append({"n": int(m.group(1)), "fipi": m.group(2), "raw": text[m.start() : end]})
    return tasks


def extract_sentences(block: str) -> list[str]:
    # Cut before instruction
    head = re.split(r"Укажите варианты ответов", block, maxsplit=1)[0]
    # Normalize OCR quirks: (З)→(3), bare 1) at line start → (1)
    head = re.sub(r"\(З\)", "(3)", head)
    head = re.sub(r"(?m)^(\d+)\)\s+", r"(\1) ", head)
    parts = re.split(r"\(\d+\)\s*", head)
    sents = []
    for p in parts[1:]:
        p = clean_text(p)
        p = re.sub(r"\s+", " ", p).strip(" \n\t")
        if p:
            sents.append(p)
    return sents[:5]


def extract_options(block: str) -> list[dict]:
    m = re.search(r"Укажите варианты ответов[\s\S]*?(?=Пояснение)", block)
    section = m.group(0) if m else block
    section = clean_text(section)
    opts = []
    for om in re.finditer(
        r"([1-5])\)\s*(.+?)\s*\(предложение\s*(\d+)\)",
        section,
        flags=re.I,
    ):
        label = clean_text(om.group(2))
        label = re.sub(r"\s+", " ", label).strip(" .")
        label = label.replace("(не) ", "не ").replace("(и) ", "и ")
        label = re.sub(r"\s*—\s*\(это\)\s*", " — ", label)
        opts.append({"id": om.group(1), "label": label, "sentence": int(om.group(3))})
    seen = set()
    uniq = []
    for o in opts:
        if o["id"] in seen:
            continue
        seen.add(o["id"])
        uniq.append(o)
        if len(uniq) == 5:
            break
    return uniq


def extract_answer(block: str) -> list[str]:
    m = ANSWER_RE.search(block)
    if not m:
        return []
    return list(m.group(1))


def extract_explanation(block: str) -> str:
    m = re.search(r"Пояснение\.(.*?)(?:О\s*т\s*в\s*е\s*т\s*:)", block, flags=re.S | re.I)
    if not m:
        return ""
    text = clean_text(m.group(1))
    text = re.sub(r"\s+", " ", text).strip()
    # Soft trim for UI
    if len(text) > 1400:
        text = text[:1390].rsplit(" ", 1)[0] + "…"
    return text


def extract_why_wrong(block: str, option_id: str) -> str:
    """Pull a short note for incorrect option if present as (N)..."""
    m = re.search(r"Неверно определена основа в вариантах:(.*?)(?:О\s*т\s*в\s*е\s*т\s*:)", block, flags=re.S | re.I)
    if not m:
        return ""
    section = clean_text(m.group(1))
    # Find (N) ... until next (N) or end
    pattern = rf"\({option_id}\)(.*?)(?=\(\d\)|$)"
    om = re.search(pattern, section, flags=re.S)
    if not om:
        return ""
    note = re.sub(r"\s+", " ", om.group(1)).strip(" —–-")
    if len(note) > 320:
        note = note[:310].rsplit(" ", 1)[0] + "…"
    return note


VERB_RE = re.compile(
    r"(ётся|ется|ится|атся|ятся|ётся|ют|ут|ёт|ет|ит|ат|ят|"
    r"ал|ала|али|лся|лась|лись|ён|ена|ены|ан|ана|аны|"
    r"ил|ила|или|ул|ула|ули|ось|ась)\b|"
    r"\b(есть|был|была|было|были|будет|стать|стал|стала|стали|является|называл\w*|начал\w*|"
    r"может|могли|мог|смог\w*|нужен|нужна|нужно|нужны|нельзя|можно|относится|относ\w*)\w*",
    re.I,
)


def normalize_label(label: str) -> str:
    # "не было (бы)" → "не было бы"; "язык — (это) особенность" → keep dash words
    label = re.sub(r"\(\s*бы\s*\)", "бы", label)
    label = re.sub(r"\(\s*это\s*\)", "это", label)
    label = re.sub(r"[()]", "", label)
    return re.sub(r"\s+", " ", label).strip()


def has_verbish(label: str) -> bool:
    return bool(VERB_RE.search(label))


def infer_null_copula(label: str) -> bool:
    """Null copula = nominal predicate without finite verb (often with dash)."""
    if "—" in label or "–" in label:
        return True
    if has_verbish(label):
        return False
    words = re.findall(r"[А-Яа-яЁё\-]+", label)
    return len(words) >= 2


def tokenize_sentence(s: str) -> list[str]:
    return [t for t in re.findall(r"[А-Яа-яЁёA-Za-z0-9\-]+|[—–]|[^\sА-Яа-яЁёA-Za-z0-9\-]", s) if t.strip()]


def find_span(words: list[str], phrase: str) -> list[int]:
    phrase = normalize_label(phrase.replace("—", " ").replace("–", " "))
    phrase_words = re.findall(r"[А-Яа-яЁёA-Za-z0-9\-]+", phrase)
    if not phrase_words:
        return []
    low = [w.lower().replace("ё", "е") for w in words]
    pw = [w.lower().replace("ё", "е") for w in phrase_words]
    for i in range(0, len(low) - len(pw) + 1):
        if low[i : i + len(pw)] == pw:
            return list(range(i, i + len(pw)))
    # Allow one intervening particle between tokens (не было бы)
    if len(pw) >= 2:
        for start in range(len(low)):
            idxs = []
            pos = start
            ok = True
            for k, target in enumerate(pw):
                if pos >= len(low):
                    ok = False
                    break
                if low[pos] == target:
                    idxs.append(pos)
                    pos += 1
                elif k > 0 and pos + 1 < len(low) and low[pos + 1] == target:
                    pos += 1
                    idxs.append(pos)
                    pos += 1
                else:
                    ok = False
                    break
            if ok and len(idxs) == len(pw):
                return idxs
    return []


def split_basis_parts(label: str) -> tuple[str, str]:
    label = normalize_label(label)
    if "—" in label:
        a, b = label.split("—", 1)
        return a.strip(), b.strip()
    if "–" in label:
        a, b = label.split("–", 1)
        return a.strip(), b.strip()
    words = label.split()
    if len(words) <= 1:
        return "", label  # one-word basis → treat as predicate (or whole later)
    # Inverted: verb/predicate first
    first = words[0].lower()
    if first in {"есть", "имелись", "имеется", "существует", "существовал", "нужен", "нужна", "нужно", "нужны"}:
        if len(words) >= 2:
            return " ".join(words[1:]), words[0]
        return "", label
    # Default: subject = first token(s), predicate = rest
    # Multiword subject rare in options; keep first word as subject
    return words[0], " ".join(words[1:])


def describe_subject(text: str) -> str:
    if not text:
        return "нет (односоставное предложение)"
    t = text.lower()
    if re.fullmatch(r"(я|ты|он|она|оно|мы|вы|они)", t):
        return f"«{text}» — личное местоимение"
    if " " in text:
        return f"«{text}» — словосочетание в роли подлежащего"
    return f"«{text}» — существительное или местоимение в именительном падеже"


def describe_predicate(text: str, null_copula: bool) -> str:
    if null_copula and text:
        return f"«{text}» — именная часть сказуемого; связка нулевая (вместо «есть»)"
    if null_copula and not text:
        return "нулевая связка + именная часть"
    if not text:
        return "—"
    parts = text.lower().split()
    if parts and parts[0] in {"был", "была", "было", "были", "будет", "есть", "стал", "стала", "стали", "является"}:
        return f"«{text}» — составное именное сказуемое"
    if parts and parts[0] in {"начал", "начала", "начали", "хочет", "может", "могли", "мог", "смог", "смогла", "смогли"}:
        return f"«{text}» — составное глагольное сказуемое"
    if parts and parts[0] in {"нужен", "нужна", "нужно", "нужны"}:
        return f"«{text}» — составное именное (краткое прилагательное)"
    return f"«{text}» — глагольное сказуемое"


def build_visual(option: dict, sentences: list[str]) -> dict | None:
    si = option["sentence"] - 1
    if si < 0 or si >= len(sentences):
        return None
    sent = sentences[si]
    words = tokenize_sentence(sent)
    label = normalize_label(option["label"])
    subj, pred = split_basis_parts(label)
    subj_idx = find_span(words, subj) if subj else []
    pred_idx = find_span(words, pred) if pred else []
    if not subj_idx and not pred_idx:
        whole = find_span(words, label.replace("—", " ").replace("–", " "))
        if whole:
            if len(whole) == 1:
                pred_idx = whole
            else:
                subj_idx = [whole[0]]
                pred_idx = whole[1:]
    # One-word bases like «компас» / «неясно»: mark as predicate or subject by type
    if not subj_idx and not pred_idx:
        return None
    show_null = infer_null_copula(label) and bool(subj_idx) and bool(pred_idx) and not has_verbish(label)
    # Also null if dash in label even if pred not found as separate — place after subject
    if "—" in option["label"] or "–" in option["label"]:
        if subj_idx and not has_verbish(label):
            show_null = True
    null_after = None
    if show_null and subj_idx:
        null_after = subj_idx[-1]
        # Prefer position at dash token if present between subj and pred
        for i in range(subj_idx[-1] + 1, (pred_idx[0] if pred_idx else len(words))):
            if words[i] in {"—", "–", "-"}:
                null_after = i - 1  # marker after subject; dash stays
                break
    return {
        "sentenceIndex": si,
        "words": words,
        "subject": subj_idx,
        "predicate": pred_idx,
        "nullCopulaAfter": null_after,
        "subjectText": subj,
        "predicateText": pred,
        "nullCopula": show_null,
        "subjectHow": describe_subject(subj),
        "predicateHow": describe_predicate(pred, show_null),
    }


def main():
    raw = RAW.read_text(encoding="utf-8")
    tasks = split_tasks(raw)
    exercises = []
    skipped = []
    for t in tasks:
        sents = extract_sentences(t["raw"])
        opts = extract_options(t["raw"])
        ans = set(extract_answer(t["raw"]))
        expl = extract_explanation(t["raw"])
        if len(sents) < 3 or len(opts) < 5 or not ans:
            skipped.append({"n": t["n"], "s": len(sents), "o": len(opts), "a": list(ans)})
            continue
        options = []
        for o in opts:
            correct = o["id"] in ans
            item = {
                "id": o["id"],
                "label": o["label"],
                "sentence": o["sentence"],
                "correct": correct,
            }
            if correct:
                vis = build_visual(o, sents)
                if vis:
                    item["visual"] = vis
            else:
                why = extract_why_wrong(t["raw"], o["id"])
                if why:
                    item["whyWrong"] = why
            options.append(item)
        text_parts = [f"({i}) {s}" for i, s in enumerate(sents, 1)]
        exercises.append(
            {
                "id": f"oge2-{t['n']:03d}",
                "fipi": t["fipi"],
                "type": "syntax.basis",
                "text": " ".join(text_parts),
                "sentences": sents,
                "options": options,
                "answer": "".join(sorted(ans, key=int)),
                "comment": expl,
            }
        )

    payload = {
        "slug": "trenazher-osnova-leksikon",
        "name": "Грамматическая основа предложения",
        "description": "Задание 2 ОГЭ: выберите все варианты, где основа указана верно. После проверки подлежащее, сказуемое и нулевая связка будут показаны в предложении.",
        "type": "syntax.basis",
        "category": "syntax",
        "count": len(exercises),
        "exercises": exercises,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT_DATA.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(payload, ensure_ascii=False, indent=2)
    OUT.write_text(data, encoding="utf-8")
    OUT_DATA.write_text(data, encoding="utf-8")
    (ROOT / "tools" / "_basis_parse_report.json").write_text(
        json.dumps(
            {"parsed": len(exercises), "skipped": skipped, "sample": exercises[0] if exercises else None},
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"OK parsed={len(exercises)} skipped={len(skipped)}")


if __name__ == "__main__":
    main()
