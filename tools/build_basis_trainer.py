# -*- coding: utf-8 -*-
"""Parse РЕШУ ОГЭ type-2 PDF text into trainer JSON with visual basis markup."""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "tools" / "_basis_raw.txt"
OUT = ROOT / "js" / "trainers-data" / "trenazher-osnova-leksikon.json"
OUT_DATA = ROOT / "data" / "trainers" / "trenazher-osnova-leksikon.json"

TASK_SPLIT = re.compile(r"(?m)^(\d+)\.\s+Тип\s+2\s+№\s+(\d+)")
ANSWER_RE = re.compile(r"О\s*т\s*в\s*е\s*т\s*:\s*([0-9]+)", re.I)

# Nouns that end like past verbs (…ал) — not finite verbs
NOUN_L_END = re.compile(
    r"(иал|уал|еал|иалл|еталл|урнал|окзал|анал|ундак|оциал|ентиал|енциал)$"
)

# Past without -л: возник, исчез, вырос…
PAST_NO_L = re.compile(
    r"^(воз)?ник(ла|ло|ли)?$|^исчез(ла|ло|ли)?$|^исчезал(а|о|и)?$|"
    r"^(вы|за|под)?рос(ла|ло|ли)?$|^(с)?пас(ла|ло|ли)?$|^(при|у|по)?нес(ла|ло|ли)?$|"
    r"^(по)?мог(ла|ло|ли)?$|^мог(ла|ло|ли)?$|^(с|за|под)?лег(ла|ло|ли)?$|^(с|за|под)?жег(ла|ло|ли)?$"
)


def clean_text(text: str) -> str:
    text = text.replace("\u00ad", "").replace("\u202f", " ").replace("\xa0", " ")
    text = text.replace("\u2060", "").replace("\ufeff", "")
    # Remove combining stress marks so «о́рган» stays one token
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = unicodedata.normalize("NFC", text)
    # PDF often inserts Latin accented letters into Cyrillic words (полóг)
    for lat, cyr in {
        "á": "а",
        "à": "а",
        "ó": "о",
        "ò": "о",
        "é": "е",
        "è": "е",
        "ý": "у",
        "ú": "у",
        "ù": "у",
        "í": "и",
        "ì": "и",
        "Á": "А",
        "Ó": "О",
        "É": "Е",
        "Ý": "У",
        "Ú": "У",
        "Í": "И",
    }.items():
        text = text.replace(lat, cyr)
    # OCR: «Звуки» → «3вуки»
    text = re.sub(r"(^|[\s(])3(?=[А-Яа-яЁё])", r"\1З", text)
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
    head = re.split(r"Укажите варианты ответов", block, maxsplit=1)[0]
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
    if len(text) > 1400:
        text = text[:1390].rsplit(" ", 1)[0] + "…"
    return text


def extract_why_wrong(block: str, option_id: str) -> str:
    m = re.search(
        r"Неверно определена основа в вариантах:(.*?)(?:О\s*т\s*в\s*е\s*т\s*:)",
        block,
        flags=re.S | re.I,
    )
    if not m:
        return ""
    section = clean_text(m.group(1))
    pattern = rf"\({option_id}\)(.*?)(?=\(\d\)|$)"
    om = re.search(pattern, section, flags=re.S)
    if not om:
        return ""
    note = re.sub(r"\s+", " ", om.group(1)).strip(" —–-")
    if len(note) > 320:
        note = note[:310].rsplit(" ", 1)[0] + "…"
    return note


def normalize_label(label: str) -> str:
    label = "".join(ch for ch in unicodedata.normalize("NFD", label) if unicodedata.category(ch) != "Mn")
    label = unicodedata.normalize("NFC", label)
    label = re.sub(r"\(\s*бы\s*\)", "бы", label)
    label = re.sub(r"\(\s*это\s*\)", "это", label)
    label = re.sub(r"\(\s*(как|так и|или)\s*\)", " ", label, flags=re.I)
    label = re.sub(r"[()]", "", label)
    return re.sub(r"\s+", " ", label).strip(" ,;")


def is_short_nominal(tok: str) -> bool:
    return is_short_nominal_strict(tok)


def is_finite_verb(tok: str, allow_nominal: bool = True) -> bool:
    """True for finite verbs / infinitives — not nouns like «потенциал»."""
    t = _norm_tok(tok)
    if not t or t in {"не", "бы", "ли", "же", "и", "а", "но", "да"}:
        return False
    # Modals / copulas first — before short-nominal endings (-но)
    if t in {
        "есть",
        "был",
        "была",
        "было",
        "были",
        "будет",
        "будут",
        "буду",
        "стать",
        "стал",
        "стала",
        "стало",
        "стали",
        "является",
        "являются",
        "имеется",
        "имеются",
        "имелись",
        "существует",
        "существуют",
        "существовал",
        "существовала",
        "происходит",
        "происходят",
        "произошло",
        "произошла",
        "произошли",
        "можно",
        "нельзя",
        "нет",
    }:
        return True
    if allow_nominal and is_short_nominal_strict(t):
        return False
    if re.search(
        r"(юсь|ешься|ется|ётся|емся|етесь|утся|ются|ишься|ится|имся|итесь|атся|ятся|"
        r"лся|лась|лось|лись)$",
        t,
    ):
        return True
    if len(t) >= 4 and re.search(r"(ешь|ет|ёт|ем|ете|ут|ют|ишь|ит|им|ите|ат|ят)$", t):
        return True
    # imperative: only unambiguous endings (NOT bare -ь/-и — nouns: шерсть, кости)
    if t.endswith(("йте", "ьте", "ите")) and len(t) >= 5:
        return True
    # Infinitive: -ть/-чь, but NOT nouns on -сть (шерсть) or -ти (скорости)
    if t.endswith("чь") and len(t) >= 3:
        return True
    if t.endswith("ть") and not t.endswith("сть") and len(t) >= 4:
        return True
    if t in {
        "нести", "вести", "везти", "ползти", "расти", "трясти", "цвести",
        "обрести", "принести", "унести", "донести", "пронести", "отнести",
        "привести", "увести", "довести", "провести", "отвести", "перевести",
        "привезти", "уплыть",
    }:
        return True
    # past with -л; exclude nouns that look alike (тело, дело, потенциал)
    if re.search(r"[аеиоуыяюэ]л(а|о|и)?$", t) or re.search(r"(ил|ыл|ел|ол|ул|ял)(а|о|и)?$", t):
        if NOUN_L_END.search(t):
            return False
        if len(t) >= 8 and t.endswith("ал"):
            return False
        if t in {
            "тело",
            "дело",
            "село",
            "мыло",
            "сало",
            "горло",
            "стекло",
            "кресло",
            "число",
            "начало",
            "зеркало",
            "облако",
            "молоко",
            "крыло",
            "ремесло",
            "весло",
        }:
            return False
        return True
    if PAST_NO_L.match(t):
        return True
    # смогла / исчезла / везла: согласный + л + окончание
    if len(t) >= 5 and re.search(r"[бвгджзклмнпрстфхцчшщ]л(а|о|и)?$", t):
        if t not in {"метла", "свекла", "игла"}:
            return True
    return False


def is_short_nominal_strict(t: str) -> bool:
    """Краткие прилагательные/причастия и формы в роли именной части (не существительные)."""
    t = _norm_tok(t)
    if len(t) < 3:
        return False
    # глаголы / причастия на -л…
    if re.search(r"(л|ла|ло|ли|лся|лась|лось|лись)$", t):
        return False
    if re.search(r"(ется|ётся|ится|утся|ются|атся|ятся|ет|ёт|ут|ют|ит|ат|ят|ешь|ишь)$", t):
        return False
    # типичные краткие и полные формы в сказуемом
    if re.search(r"(ен|ён|ан|ян|он|на|но|ны|то|та|ты|ая|ое|ые|ие|ий|ый|ой)$", t):
        return True
    # сравнительная степень: важнее, лучше, выше
    if len(t) >= 4 and re.search(r"(ее|ей|ше|же)$", t):
        return True
    # короткие краткие типа малы, стара, полог, высок — без суффиксов существительных
    if len(t) <= 6 and re.search(r"(а|о|ы|и|ек|ок|ог|ог)$", t):
        if re.search(r"(ки|ики|ники|чики|ства|ения|ение|ость|тель|ция|ции)$", t):
            return False
        if t.endswith(("ки", "хи", "ги", "цы")):
            return False
        return True
    return False


def has_finite_verb(text: str) -> bool:
    return any(is_finite_verb(tok) for tok in phrase_tokens(text))


def has_verbish(label: str) -> bool:
    """Backward-compatible alias: finite verb somewhere in the phrase."""
    return has_finite_verb(label)


def is_nominal_predicate(pred: str) -> bool:
    toks = [t for t in phrase_tokens(pred) if t not in {"не", "бы"}]
    if not toks:
        return False
    if any(is_finite_verb(t) for t in toks):
        return False
    # all content tokens look nominal (adj/participle/noun)
    return True


def should_show_null_copula(option_label: str, subj: str, pred: str) -> bool:
    """∅ only for nominal predicates without an expressed copula/verb."""
    if not pred and not ("—" in option_label or "–" in option_label):
        return False
    if "—" in option_label or "–" in option_label:
        # X — Y : null copula if Y is not a finite verb
        return not has_finite_verb(pred) if pred else True
    if not pred:
        return False
    if has_finite_verb(pred):
        return False
    # краткое прилагательное / причастие / существительное в роли сказуемого
    return is_nominal_predicate(pred)


def tokenize_sentence(s: str) -> list[str]:
    return [
        t
        for t in re.findall(r"[А-Яа-яЁёA-Za-z0-9\-]+|[—–]|[^\sА-Яа-яЁёA-Za-z0-9\-]", s)
        if t.strip()
    ]


def _strip_accents(w: str) -> str:
    w = w.replace("ё", "е").replace("Ё", "Е")
    parts = []
    for ch in unicodedata.normalize("NFD", w):
        if unicodedata.category(ch) != "Mn":
            parts.append(ch)
    return "".join(parts)


def _norm_tok(w: str) -> str:
    w = w.replace("\u2060", "").replace("\ufeff", "")
    return _strip_accents(w).lower()


def phrase_tokens(phrase: str) -> list[str]:
    phrase = normalize_label(phrase.replace("—", " ").replace("–", " "))
    phrase = re.sub(r"\b(как|так)\b", " ", phrase, flags=re.I)
    return [_norm_tok(w) for w in re.findall(r"[А-Яа-яЁёA-Za-z0-9\-]+", phrase)]


def _uniq_spans(spans: list[list[int]]) -> list[list[int]]:
    uniq = []
    seen = set()
    for span in spans:
        key = tuple(span)
        if key not in seen:
            seen.add(key)
            uniq.append(span)
    return uniq


def find_all_spans(words: list[str], phrase: str) -> list[list[int]]:
    pw = phrase_tokens(phrase)
    if not pw:
        return []
    pw_core = [t for t in pw if t != "и"] or pw
    low = [_norm_tok(w) for w in words]
    found: list[list[int]] = []
    n, m = len(low), len(pw)

    for i in range(0, n - m + 1):
        if low[i : i + m] == pw:
            found.append(list(range(i, i + m)))
    if found:
        return found

    if m >= 2:
        for start_i in range(n):
            idxs: list[int] = []
            pos = start_i
            ok = True
            for k, target in enumerate(pw):
                if pos >= n:
                    ok = False
                    break
                if low[pos] == target:
                    idxs.append(pos)
                    pos += 1
                elif k > 0 and pos + 1 < n and low[pos + 1] == target:
                    pos += 1
                    idxs.append(pos)
                    pos += 1
                else:
                    ok = False
                    break
            if ok and len(idxs) == m:
                found.append(idxs)
    if found:
        return _uniq_spans(found)

    max_span = 18 if len(pw_core) <= 3 else 28
    for start_i in range(n):
        if low[start_i] != pw_core[0]:
            continue
        idxs = [start_i]
        pos = start_i + 1
        ok = True
        for target in pw_core[1:]:
            hit = None
            for j in range(pos, min(n, idxs[0] + max_span)):
                if low[j] == target:
                    hit = j
                    break
            if hit is None:
                ok = False
                break
            idxs.append(hit)
            pos = hit + 1
        if ok and idxs[-1] - idxs[0] <= max_span:
            found.append(idxs)
    return _uniq_spans(found)


def find_span(words: list[str], phrase: str) -> list[int]:
    spans = find_all_spans(words, phrase)
    return spans[0] if spans else []


def pair_basis_spans(
    words: list[str],
    subj: str,
    pred: str,
    label: str,
) -> tuple[list[int], list[int]]:
    """Bind subject + predicate as one basis, not first independent hits."""
    label_flat = normalize_label(label.replace("—", " ").replace("–", " "))
    whole = find_all_spans(words, label_flat)
    if whole and (whole[0][-1] - whole[0][0] <= max(12, len(phrase_tokens(label_flat)) + 8)):
        sw = phrase_tokens(subj) if subj else []
        pw = phrase_tokens(pred) if pred else []
        span = whole[0]
        if sw and pw:
            window = words[span[0] : span[-1] + 1]
            local_s = find_all_spans(window, subj)
            local_p = find_all_spans(window, pred)
            if local_s and local_p:
                return (
                    [span[0] + i for i in local_s[0]],
                    [span[0] + i for i in local_p[0]],
                )
        if len(span) == 1:
            return ([], span) if not subj else (span, [])
        if not pred:
            return span, []
        if not subj:
            return [], span

    subj_spans = find_all_spans(words, subj) if subj else []
    pred_spans = find_all_spans(words, pred) if pred else []

    if subj and pred:
        sw = phrase_tokens(subj)
        pw = [t for t in phrase_tokens(pred) if t != "и"] or phrase_tokens(pred)
        low = [_norm_tok(w) for w in words]
        candidates: list[tuple[int, list[int], list[int]]] = []

        def find_seq_from(start: int, toks: list[str], limit: int = 28):
            if not toks or start >= len(low) or low[start] != toks[0]:
                return None
            idxs = [start]
            pos = start + 1
            for target in toks[1:]:
                hit = None
                for j in range(pos, min(len(low), idxs[0] + limit)):
                    if low[j] == target:
                        hit = j
                        break
                if hit is None:
                    return None
                idxs.append(hit)
                pos = hit + 1
            return idxs

        for s_start in range(len(low)):
            ss = find_seq_from(s_start, sw)
            if not ss:
                continue
            after = ss[-1] + 1
            for p_start in range(after, min(len(low), after + 28)):
                ps = find_seq_from(p_start, pw, limit=20)
                if ps:
                    gap = ps[0] - ss[-1] - 1
                    candidates.append((gap, ss, ps))
                    break

        for p_start in range(len(low)):
            ps = find_seq_from(p_start, pw)
            if not ps:
                continue
            after = ps[-1] + 1
            for s_start in range(after, min(len(low), after + 28)):
                ss = find_seq_from(s_start, sw, limit=12)
                if ss:
                    gap = ss[0] - ps[-1] - 1
                    candidates.append((gap + 35, ss, ps))
                    break

        if candidates:
            candidates.sort(key=lambda x: (x[0], x[1][0]))
            best_gap = candidates[0][0]
            same = [c for c in candidates if c[0] == best_gap]
            same.sort(key=lambda x: -max(x[1][0], x[2][0]))
            _, ss, ps = same[0]
            return ss, ps

    if subj_spans and not pred_spans:
        return subj_spans[0], []
    if pred_spans and not subj_spans:
        return [], pred_spans[0]
    if not subj_spans and not pred_spans:
        return [], []

    first = phrase_tokens(label_flat)[:1]
    inverted = bool(first) and first[0] in {
        "есть",
        "имелись",
        "имеется",
        "существует",
        "существовал",
        "нужен",
        "нужна",
        "нужно",
        "нужны",
        "можно",
        "нельзя",
        "был",
        "была",
        "было",
        "были",
        "происходит",
        "происходило",
    }

    best = None
    best_score = 10**9
    for ss in subj_spans:
        for ps in pred_spans:
            s0, s1 = ss[0], ss[-1]
            p0, p1 = ps[0], ps[-1]
            if s1 < p0:
                gap = p0 - s1 - 1
                order_ok = not inverted
            elif p1 < s0:
                gap = s0 - p1 - 1
                order_ok = inverted
            else:
                gap = 50
                order_ok = False
            score = gap + (0 if order_ok else 100) + (0 if gap <= 18 else 40)
            score -= max(s0, p0) * 0.001
            if score < best_score:
                best_score = score
                best = (ss, ps)
    if best:
        return best[0], best[1]
    return subj_spans[0], pred_spans[0]


def split_basis_parts(label: str) -> tuple[str, str]:
    label = normalize_label(label)
    label = re.sub(r"^(наиболее|самый|самая|самое|самые|очень)\s+", "", label, flags=re.I)
    if "—" in label:
        a, b = label.split("—", 1)
        return a.strip(), b.strip()
    if "–" in label:
        a, b = label.split("–", 1)
        return a.strip(), b.strip()
    words = label.split()
    if len(words) <= 1:
        return "", label

    first = words[0].lower().replace("ё", "е")
    if first in {
        "был",
        "была",
        "было",
        "были",
        "будет",
        "стать",
        "стал",
        "стала",
        "стали",
        "является",
    } and len(words) >= 2:
        if words[-1][:1].isupper() and words[-1].lower() not in {w.lower() for w in words[:-1]}:
            return words[-1], " ".join(words[:-1])
        # «были подвешены колокольчики»
        if len(words) >= 3 and not is_finite_verb(words[-1]) and not is_short_nominal_strict(words[-1]):
            return words[-1], " ".join(words[:-1])
        return "", label

    # можно / нельзя + infinitive — whole predicate, no subject
    if first in {"можно", "нельзя"}:
        return "", label

    if first in {
        "есть",
        "имелись",
        "имеется",
        "имеются",
        "существует",
        "существовал",
        "нужен",
        "нужна",
        "нужно",
        "нужны",
        "происходит",
        "происходило",
        "произошло",
        "произошла",
        "произошли",
    }:
        if len(words) >= 2:
            return " ".join(words[1:]), words[0]
        return "", label

    if re.match(r"^[А-ЯA-Z]\.?[А-ЯA-Z]\.?$", words[0]) and len(words) >= 3:
        return " ".join(words[:2]), " ".join(words[2:])

    # «А. С. Пушкин мог написать» / «А. С. Пушкин отметил»
    initials = []
    i = 0
    while i < len(words) and re.fullmatch(r"[А-ЯA-Z]\.?", words[i]):
        initials.append(words[i])
        i += 1
    if initials and i < len(words) and re.fullmatch(r"[А-Яа-яЁё\-]+", words[i]) and words[i][0].isupper():
        name = initials + [words[i]]
        rest = words[i + 1 :]
        if rest:
            return " ".join(name), " ".join(rest)
        return " ".join(name), ""

    # Verb / clear nominal predicative first: «подешевел он», «непривлекателен человек»
    if len(words) >= 2 and _is_predicative_first(words[0]):
        rest = " ".join(words[1:])
        if not has_finite_verb(rest) or (len(words) == 2 and not is_finite_verb(words[1])):
            return rest, words[0]

    return words[0], " ".join(words[1:])


def _is_predicative_first(tok: str) -> bool:
    """First token looks like predicate that can precede subject (непривлекателен человек)."""
    if is_finite_verb(tok):
        return True
    t = _norm_tok(tok)
    if t in {"я", "ты", "он", "она", "оно", "мы", "вы", "они", "это", "то"}:
        return False
    if len(t) < 5:
        return False
    # Strong short forms only — NOT bare -то/-ло (тело, дело) and NOT -ты (предметы)
    return bool(re.search(r"(ен|ён|ан|ян|он|на|но|ны|ее|ей|ше|же)$", t))


def classify_predicate_tokens(pred_tokens: list[str], null_copula: bool) -> str:
    """School-friendly label from the actual highlighted words."""
    toks = [t for t in pred_tokens if _norm_tok(t) not in {"не", "бы", "ли", "же"}]
    if not toks:
        return "нулевая связка + именная часть" if null_copula else "—"
    shown = " ".join(pred_tokens)
    norms = [_norm_tok(t) for t in toks]
    first = norms[0]

    if first in {"можно", "нельзя"}:
        return f"«{shown}» — сказуемое односоставного предложения (можно / нельзя)"

    # Copula + nominal
    if first in {"был", "была", "было", "были", "будет", "есть", "стал", "стала", "стали", "является", "являются"}:
        return f"«{shown}» — составное именное сказуемое"

    if first in {"начал", "начала", "начали", "хочет", "может", "могли", "мог", "смог", "смогла", "смогли"}:
        return f"«{shown}» — составное глагольное сказуемое"

    if first in {"нужен", "нужна", "нужно", "нужны"} or any(
        re.search(r"(ен|ён|ан|ян|он|на|но|ны)$", n) and not is_finite_verb(n, allow_nominal=False)
        for n in norms
    ):
        # краткое прилагательное / краткое причастие
        last = norms[-1]
        if re.search(r"(ен|ён|ан|ян|он)$", last) and not last.endswith(("енен",)):
            # огромен / заключён / нужен — distinguish participle-like vs adj is hard; both are ИМЕННЫЕ
            kind = "краткая форма (прилагательное или причастие)"
        elif re.search(r"(на|но|ны|та|то|ты)$", last):
            kind = "краткая форма"
        else:
            kind = "именная часть"
        if null_copula or not any(is_finite_verb(n) for n in norms):
            return f"«{shown}» — именное сказуемое: {kind}; связка нулевая (вместо «есть»)"
        return f"«{shown}» — именное сказуемое: {kind}"

    # Full adjectives / short forms used predicatively
    if not any(is_finite_verb(n) for n in norms) and (
        any(is_short_nominal_strict(n) for n in norms)
        or any(re.search(r"(ен|ён|ан|ян|он|на|но|ны|ая|ое|ые|ие)$", n) for n in norms)
    ):
        return f"«{shown}» — именное сказуемое; связка нулевая (вместо «есть»)"

    if any(is_finite_verb(n) for n in norms):
        if " и " in f" {shown.lower()} " or len([n for n in norms if is_finite_verb(n)]) > 1:
            return f"«{shown}» — однородные глагольные сказуемые"
        return f"«{shown}» — глагольное сказуемое"

    if null_copula:
        return f"«{shown}» — именное сказуемое; связка нулевая (вместо «есть»)"
    return f"«{shown}» — именное сказуемое"


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
    """Fallback when token list unavailable."""
    return classify_predicate_tokens(text.split(), null_copula)


def build_visual(option: dict, sentences: list[str]) -> dict | None:
    si = option["sentence"] - 1
    if si < 0 or si >= len(sentences):
        return None
    sent = sentences[si]
    words = tokenize_sentence(sent)
    label = normalize_label(option["label"])
    subj, pred = split_basis_parts(label)
    subj_idx, pred_idx = pair_basis_spans(words, subj, pred, label)
    if not subj_idx and not pred_idx:
        return None
    # Recompute null from the WORDS actually highlighted as predicate
    pred_words = [words[i] for i in pred_idx] if pred_idx else []
    pred_for_null = " ".join(pred_words) if pred_words else pred
    show_null = should_show_null_copula(option["label"], subj, pred_for_null) and bool(pred_idx or subj_idx)
    # Never mark null if any highlighted predicate token is a finite verb
    if pred_words and any(is_finite_verb(w) for w in pred_words):
        show_null = False
    # Always mark null for short adj/participle predicates without finite verb
    if pred_words and not any(is_finite_verb(w) for w in pred_words):
        if any(is_short_nominal_strict(w) or re.search(r"(ен|ён|ан|ян|он|на|но|ны)$", _norm_tok(w)) for w in pred_words):
            show_null = True
        if "—" in option["label"] or "–" in option["label"]:
            show_null = True

    null_after = None
    if show_null and subj_idx and pred_idx and subj_idx[-1] < pred_idx[0]:
        null_after = subj_idx[-1]
        for i in range(subj_idx[-1] + 1, pred_idx[0]):
            if words[i] in {"—", "–", "-"}:
                null_after = i - 1
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
        "predicateHow": classify_predicate_tokens(pred_words or pred.split(), show_null),
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
