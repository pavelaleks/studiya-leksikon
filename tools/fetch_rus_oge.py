# -*- coding: utf-8 -*-
"""Скачивает задания 1–13 ОГЭ по русскому языку с rus-oge.sdamgia.ru.

База для тренажёров студии «Лексикон»: тексты, вопросы, ответы и пояснения.
Запуск из корня репозитория:

    python tools/fetch_rus_oge.py
    python tools/fetch_rus_oge.py --parse-only
"""

from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import http.client
import json
import re
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from pathlib import Path

from bs4 import BeautifulSoup, Comment, Tag

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "tools" / "_sdamgia_cache_oge"
BASE = "https://rus-oge.sdamgia.ru"
UA = "LexikonStudio/1.0 (russian oge bank; educational; +https://pavelaleks.github.io/studiya-leksikon/)"

WORKERS = 4
PAUSE = 0.4

KEEP_CLASS = {
    "left_margin",
    "rus_single",
    "rus_double",
    "rus_dashed",
    "rus_wave",
    "rus_dotteddash",
    "rus_notes",
    "rus_example",
    "prefix",
    "wrap_flex_table",
    "wrap_flex_table_col",
    "col_name",
    "col_content",
    "sup_cont",
    "sup_word",
    "mark",
}

UI_IMG = ("briefcase", "collapse", "expand", "exclamation", "chain", "printer", "document-pdf")

_net_lock = threading.Lock()
_media_lock = threading.Lock()
_rules_lock = threading.Lock()
_last_request = 0.0
_media_map: dict[str, str] = {}
_rules_acc: dict[int, dict] = {}
MEDIA = ROOT / "js" / "oge-data" / "media"


def log(msg: str) -> None:
    print(msg, flush=True)


def fix_entities(value: str, *, keep_markup_entities: bool = False) -> str:
    if not value or "&" not in value:
        return value
    value = re.sub(r"&nbsp;?", " ", value, flags=re.I)
    if keep_markup_entities:
        return value
    return html_lib.unescape(value)


def norm_text(value: str) -> str:
    value = fix_entities(value or "")
    value = (
        value.replace("\u00ad", "")
        .replace("\xa0", " ")
        .replace("\u202f", " ")
        .replace("\u200b", "")
        .replace("\ufeff", "")
        .replace("\u2060", "")
    )
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r" *\n *", "\n", value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip()


def norm_word(value: str) -> str:
    value = norm_text(value).lower().replace("ё", "е")
    value = value.replace("«", "").replace("»", "").replace('"', "")
    value = value.replace("–", "-").replace("—", "-")
    value = re.sub(r"\s+", "", value)
    return value.strip(".,;:")


def abs_url(href: str) -> str:
    if not href:
        return ""
    if href.startswith("//"):
        return "https:" + href
    if href.startswith("/"):
        return BASE + href
    if href.startswith("http"):
        return href
    return BASE + "/" + href


def fetch(url: str, cache_name: str | None = None) -> str:
    path = CACHE / cache_name if cache_name else None
    if path and path.exists() and path.stat().st_size > 200:
        return path.read_text(encoding="utf-8")

    global _last_request
    delay = 1.2
    last_error = "неизвестная ошибка"
    for attempt in range(5):
        with _net_lock:
            wait = PAUSE - (time.time() - _last_request)
            if wait > 0:
                time.sleep(wait)
            _last_request = time.time()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html"})
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read()
            text = raw.decode("utf-8", errors="replace")
            if cache_name != "catalog.html" and "prob_maindiv" not in text and "ни одного" not in text.lower():
                raise OSError("пустой или чужой ответ")
            if path:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
            return text
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as exc:
            last_error = str(exc)
            log(f"  повтор {attempt + 1}: {url} ({last_error[:140]})")
            time.sleep(delay)
            delay = min(delay * 2, 20)
    raise RuntimeError(f"Не удалось скачать {url}: {last_error}")


def sniff_ext(data: bytes) -> str:
    if data.startswith(b"\x89PNG"):
        return ".png"
    if data.startswith(b"\xff\xd8"):
        return ".jpg"
    if data.startswith(b"GIF"):
        return ".gif"
    if data.startswith(b"RIFF") and b"WEBP" in data[:16]:
        return ".webp"
    if data.startswith(b"%PDF"):
        return ".pdf"
    if data.startswith(b"<svg") or b"<svg" in data[:200]:
        return ".svg"
    return ""


def download_media(src: str) -> str:
    url = abs_url(src)
    with _media_lock:
        cached = _media_map.get(url)
    if cached:
        return cached
    digest = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16]
    if MEDIA.exists():
        ready = next((path for path in MEDIA.glob(digest + ".*") if path.stat().st_size > 0), None)
        if ready:
            rel = f"media/{ready.name}"
            with _media_lock:
                _media_map[url] = rel
            return rel
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=40) as resp:
        data = resp.read()
    ext = sniff_ext(data)
    if not ext:
        ext = Path(url.split("?", 1)[0]).suffix.lower()
    if ext not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}:
        raise OSError("не изображение")
    name = digest + ext
    dest = MEDIA / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    rel = f"media/{name}"
    with _media_lock:
        _media_map[url] = rel
    return rel


def parse_catalog(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    main = soup.select_one("div.cat_main")
    if not main:
        raise RuntimeError("На странице каталога нет div.cat_main")
    groups = []
    for block in main.find_all("div", class_="cat_category", recursive=False):
        wrap = block.find("div", class_="cat_children", recursive=False)
        title_el = block.find("b", class_="cat_name", recursive=False)
        if not wrap or not title_el:
            continue
        num_el = title_el.find("span", class_="pcat_num")
        raw_num = norm_text(num_el.get_text()) if num_el else ""
        digits = re.sub(r"\D", "", raw_num)
        task = int(digits) if digits else None
        if task not in range(1, 14):
            continue
        for theory in title_el.find_all("span", class_="theory"):
            theory.extract()
        if num_el:
            num_el.extract()
        title = norm_text(title_el.get_text(" ", strip=True)).strip(" .")
        title = re.sub(r"^(?:Т\s*)?\d+\s*\.\s*", "", title).strip(" .")
        topics = []
        for child in wrap.find_all("div", class_="cat_category", recursive=False):
            link = child.find("a", class_="cat_name")
            count_el = child.find("div", class_="cat_count")
            if not link or not child.get("data-id"):
                continue
            count = int(re.sub(r"\D", "", norm_text(count_el.get_text())) or "0") if count_el else 0
            topics.append(
                {
                    "id": int(child["data-id"]),
                    "title": norm_text(link.get_text(" ", strip=True)),
                    "count": count,
                }
            )
        groups.append({"task": task, "title": title, "topics": topics})
    found = {g["task"] for g in groups}
    missing = [n for n in range(1, 14) if n not in found]
    if missing:
        raise RuntimeError(f"В каталоге нет заданий: {missing}")
    groups.sort(key=lambda g: g["task"])
    return groups


def strip_soft_hyphens(node: Tag) -> None:
    for text in list(node.find_all(string=True)):
        cleaned = (
            str(text)
            .replace("\u00ad", "")
            .replace("\u200b", "")
            .replace("\ufeff", "")
            .replace("\u2060", "")
            .replace("\xa0", " ")
            .replace("\u202f", " ")
        )
        cleaned = re.sub(r" {2,}", " ", cleaned)
        if cleaned != text:
            text.replace_with(cleaned)


def is_ui_img(el: Tag) -> bool:
    classes = " ".join(el.get("class") or [])
    src = (el.get("src") or "").lower()
    alt = (el.get("alt") or "").lower()
    if any(flag in classes for flag in ("briefcase", "nodraw", "tex")):
        return True
    return any(token in src or token in alt for token in UI_IMG)


def clean_fragment(node: Tag | None) -> str:
    if node is None:
        return ""
    root = BeautifulSoup(str(node), "lxml")
    box = root.body if root.body else root
    for bad in box.select("script, style"):
        bad.decompose()
    for comment in box.find_all(string=lambda t: isinstance(t, Comment)):
        comment.extract()
    for img in list(box.find_all("img")):
        if is_ui_img(img):
            img.decompose()
    strip_soft_hyphens(box)
    box_html = str(box)
    box_html = re.sub(
        r"(?is)<b>\s*Пояснение\s*\.?\s*</b>",
        "",
        box_html,
        count=1,
    )
    root = BeautifulSoup(box_html, "lxml")
    box = root.body if root.body else root
    for font in list(box.find_all("font")):
        color = (font.get("color") or "").strip()
        font.name = "span"
        font.attrs = {}
        if re.fullmatch(r"#?[0-9A-Za-z]{3,8}", color):
            font["class"] = ["mark"]
            font["style"] = f"color:{color}"
    for el in list(box.find_all(True)):
        if not isinstance(el, Tag):
            continue
        if el.name == "img":
            src = el.get("src") or ""
            if not src:
                el.decompose()
                continue
            try:
                el["src"] = download_media(src)
            except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException):
                el["src"] = abs_url(src)
            el.attrs = {k: el.attrs[k] for k in ("src", "alt") if k in el.attrs}
            continue
        keep: dict[str, str] = {}
        classes = [c for c in (el.get("class") or []) if c in KEEP_CLASS]
        if classes:
            keep["class"] = " ".join(classes)
        if el.name in {"td", "th"}:
            for key in ("colspan", "rowspan"):
                if el.get(key):
                    keep[key] = el[key]
        if el.name == "a" and el.get("href"):
            href = el["href"]
            if href.startswith("javascript:"):
                el.unwrap()
                continue
            href = abs_url(href)
            if href.startswith("http"):
                keep["href"] = href
                keep["target"] = "_blank"
                keep["rel"] = "noopener"
        if el.get("style") and str(el.get("style")).startswith("color:"):
            keep["style"] = el["style"]
        el.attrs = keep
    for table in list(box.find_all("table")):
        if not norm_text(table.get_text(" ", strip=True)):
            table.decompose()
    html = box.decode_contents()
    html = re.sub(r"(?:<p\b[^>]*>\s*</p>\s*)+", "", html)
    html = re.sub(r"\n{3,}", "\n\n", html)
    return fix_entities(html.strip(), keep_markup_entities=True)


def plain_from_html(html: str) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "lxml")
    for br in soup.find_all("br"):
        br.replace_with("\n")
    for cell in soup.find_all(["td", "th"]):
        cell.append(" ")
    for block in soup.find_all(["p", "div", "tr", "li", "h1", "h2", "h3", "h4"]):
        block.insert_before("\n")
    return norm_text(soup.get_text(""))


def read_info(block: Tag | None) -> dict:
    info = {
        "sources": [],
        "actuality": None,
        "difficulty": None,
        "ruleId": None,
        "ruleTitle": None,
        "ruleUrl": None,
        "ruleHtml": None,
        "fipi": [],
        "rubric": None,
    }
    if not block:
        return info
    for child in block.find_all(recursive=False):
        if not isinstance(child, Tag):
            continue
        label = norm_text(child.get_text(" ", strip=True))
        if label.startswith("Источник"):
            for link in child.find_all("a"):
                href = link.get("href") or ""
                title = norm_text(link.get_text(" ", strip=True))
                if not title:
                    continue
                match = re.search(r"id=(\d+)", href)
                info["sources"].append(
                    {
                        "title": title,
                        "url": abs_url(href) if href.startswith("/") or href.startswith("http") else None,
                        "testId": int(match.group(1)) if match else None,
                    }
                )
        elif label.startswith("Актуальность"):
            info["actuality"] = re.sub(r"^Актуальность:\s*", "", label) or None
        elif label.startswith("Сложность"):
            info["difficulty"] = re.sub(r"^Сложность:\s*", "", label) or None
        elif label.startswith("Правило"):
            bold = child.find("span")
            title = norm_text(bold.get_text(" ", strip=True)) if bold else label
            title = re.sub(r"^Правило:\s*", "", title)
            info["ruleTitle"] = title or None
            handbook = child.find("a", href=re.compile(r"handbook\?id=\d+"))
            if handbook and handbook.get("href"):
                found = re.search(r"id=(\d+)", handbook["href"])
                if found:
                    info["ruleId"] = int(found.group(1))
                    info["ruleUrl"] = abs_url(f"/handbook?id={info['ruleId']}")
            hidden = None
            for div in child.find_all("div"):
                style = (div.get("style") or "").replace(" ", "")
                if "display:none" in style and div.find(class_="pbody"):
                    hidden = div.find(class_="pbody")
                    break
            if hidden is not None:
                info["ruleHtml"] = clean_fragment(hidden)
            remember_rule(info)
        elif label.startswith("Раздел кодификатора"):
            links = [norm_text(a.get_text(" ", strip=True)) for a in child.find_all("a")]
            info["fipi"] = [x for x in links if x]
            if not info["fipi"]:
                tail = re.sub(r"^Раздел кодификатора ФИПИ:\s*", "", label)
                if tail:
                    info["fipi"] = [tail]
        elif label and not info["rubric"]:
            info["rubric"] = label
    return info


def remember_rule(info: dict) -> None:
    rule_id = info.get("ruleId")
    rule_html = info.get("ruleHtml")
    if not rule_id or not rule_html:
        return
    with _rules_lock:
        prev = _rules_acc.get(rule_id)
        if prev and len(prev["html"]) >= len(rule_html):
            return
        _rules_acc[rule_id] = {
            "id": rule_id,
            "title": info.get("ruleTitle"),
            "url": info.get("ruleUrl"),
            "html": rule_html,
            "text": plain_from_html(rule_html),
        }


def extract_answer(prob: Tag) -> str:
    box = prob.select_one(".prob_answer")
    if box:
        cells = [c for c in box.find_all("div", recursive=False)]
        if len(cells) >= 2:
            raw = norm_text(cells[-1].get_text(" ", strip=True))
            raw = raw.strip(" .")
            if raw and raw.lower() not in {"нет", "см. решение", "смотри решение"}:
                return raw
    ans = prob.select_one(".answer")
    if ans:
        raw = norm_text(ans.get_text(" ", strip=True))
        raw = re.sub(r"^Ответ:\s*", "", raw, flags=re.I).strip(" .")
        if raw and raw.lower() not in {"нет", "см. решение"}:
            return raw
    return ""


def split_alts(answer: str) -> list[str]:
    parts = [norm_text(p).strip(" .") for p in re.split(r"\s*\|\s*", answer)]
    return [p for p in parts if p]


def sentence_span(question: str) -> tuple[int, int] | None:
    match = re.search(r"предложени\w+[^\d]{0,12}(\d+)\s*[—–\-−]\s*(\d+)", question, flags=re.I)
    if not match:
        return None
    lo, hi = int(match.group(1)), int(match.group(2))
    if lo > hi or hi > 80 or hi - lo > 40:
        return None
    return lo, hi


def split_numbers(digits: str, lo: int, hi: int) -> list[int] | None:
    allowed = {str(n) for n in range(lo, hi + 1)}
    ways: list[tuple[int, ...]] = []

    def walk(index: int, acc: tuple[int, ...]) -> None:
        if len(ways) > 1:
            return
        if index == len(digits):
            ways.append(acc)
            return
        for length in (1, 2, 3):
            piece = digits[index : index + length]
            if piece in allowed:
                walk(index + length, acc + (int(piece),))

    walk(0, ())
    if len(ways) == 1:
        return list(ways[0])
    return None


def numbers_from_solution(solution: str) -> list[int] | None:
    matches = list(re.finditer(r"Ответ:\s*([0-9][0-9,;\s]*)", solution or ""))
    if not matches:
        return None
    tail = matches[-1].group(1).strip()
    if not re.search(r"[\s,;]", tail):
        return None
    nums = [int(x) for x in re.findall(r"\d+", tail)]
    return nums or None


def refine_answer(question: str, answer: str, solution: str, kind: dict) -> dict:
    kind = dict(kind)
    if kind["answerMode"] == "digits-any" and kind["answerNorm"]:
        kind["answerNumbers"] = [int(ch) for ch in kind["answerNorm"]]
        return kind
    if kind["answerMode"] != "numbers":
        kind["answerNumbers"] = None
        return kind
    parts = split_alts(answer)
    parsed = numbers_from_solution(solution)
    if parsed:
        joined = "".join(str(n) for n in parsed)
        if joined in parts:
            nums = sorted(set(parsed))
            kind["answerNumbers"] = nums
            kind["answerNorm"] = ",".join(str(n) for n in nums)
            return kind
    span = sentence_span(question)
    splits = []
    if span and parts:
        for part in parts:
            got = split_numbers(part, *span)
            if not got:
                splits = []
                break
            splits.append(sorted(set(got)))
    if splits and all(item == splits[0] for item in splits):
        kind["answerNumbers"] = splits[0]
        kind["answerNorm"] = ",".join(str(n) for n in splits[0])
        return kind
    mentioned = numbers_mentioned(solution, parts[0] if parts else "")
    if mentioned:
        kind["answerNumbers"] = mentioned
        kind["answerNorm"] = ",".join(str(n) for n in mentioned)
        return kind
    kind["answerNumbers"] = None
    return kind


def numbers_mentioned(solution: str, answer: str) -> list[int] | None:
    if not solution or not answer or "Ответ:" not in solution:
        return None
    head = solution.rsplit("Ответ:", 1)[0][-600:]
    nums = []
    for raw in re.findall(r"\d+", head):
        value = int(raw)
        if 1 <= value <= 40 and (not nums or nums[-1] != value):
            nums.append(value)
    if "".join(str(n) for n in nums) != answer:
        return None
    return sorted(set(nums))


def classify_answer(task: int, question: str, answer: str) -> dict:
    question_l = question.lower()
    if task in {1, 13} or (not answer and ("сочинен" in question_l[:800] or "изложен" in question_l[:800])):
        return {"answerKind": "essay", "answerMode": "essay", "answerNorm": None, "answerAlts": []}
    if not answer:
        return {"answerKind": "open", "answerMode": "open", "answerNorm": None, "answerAlts": []}
    parts = split_alts(answer)
    if parts and all(re.fullmatch(r"\d+", p) for p in parts):
        fixed = (
            task == 4
            or "каждой позиции" in question_l
            or "второго столбца" in question_l
            or "установите соответствие" in question_l
        )
        has_zero = any("0" in p for p in parts)
        if fixed and not has_zero:
            primary = parts[0]
            alts = parts[1:] if len(parts) > 1 else []
            return {
                "answerKind": "sequence",
                "answerMode": "digits-fixed",
                "answerNorm": primary,
                "answerAlts": alts,
            }
        if has_zero:
            return {
                "answerKind": "digits",
                "answerMode": "numbers",
                "answerNorm": parts[0],
                "answerAlts": parts[1:] if len(parts) > 1 else [],
            }
        canon = "".join(sorted(parts[0]))
        return {
            "answerKind": "digits",
            "answerMode": "digits-any",
            "answerNorm": canon,
            "answerAlts": [p for p in parts if p != canon],
        }
    norms = []
    for part in parts:
        item = norm_word(part)
        if item and item not in norms:
            norms.append(item)
    return {
        "answerKind": "short",
        "answerMode": "word",
        "answerNorm": norms[0] if norms else None,
        "answerAlts": norms[1:],
    }


def question_node(prob: Tag) -> Tag | None:
    for node in prob.select("div.pbody"):
        if not (node.get("id") or "").startswith("body"):
            continue
        if node.find_parent(class_="probtext") or node.find_parent(class_="solution"):
            continue
        if node.find_parent(class_="align-left"):
            continue
        return node
    return None


def parse_problem(prob: Tag, placement: dict) -> dict | None:
    link = prob.select_one(".prob_nums a[href*='problem?id=']")
    if not link:
        return None
    pid = int(re.search(r"id=(\d+)", link["href"]).group(1))
    type_label = norm_text(prob.select_one(".prob_nums").get_text(" ", strip=True))
    type_match = re.search(r"Тип\s+(\d+)", type_label)
    info = read_info(prob.select_one(".align-left"))
    passage_node = prob.select_one(".probtext")
    passage_id = None
    passage_html = ""
    if passage_node:
        passage_id = passage_node.get("data-text_id") or None
        inner = passage_node.select_one(".pbody") or passage_node
        passage_html = clean_fragment(inner)
    qnode = question_node(prob)
    question_html = clean_fragment(qnode)
    solution_html = clean_fragment(prob.select_one(".solution"))
    answer = extract_answer(prob)
    question_text = plain_from_html(question_html)
    kind = refine_answer(
        question_text,
        answer,
        plain_from_html(solution_html),
        classify_answer(placement["task"], question_text, answer),
    )
    if passage_html and not passage_id:
        passage_id = "h" + hashlib.sha1(norm_text(plain_from_html(passage_html)).encode("utf-8")).hexdigest()[:12]
    return {
        "id": pid,
        "url": f"{BASE}/problem?id={pid}",
        "typeLabel": type_match.group(1) if type_match else None,
        "task": placement["task"],
        "taskTitle": placement["taskTitle"],
        "topicId": placement["topicId"],
        "topic": placement["topic"],
        "rubric": info["rubric"],
        "fipi": info["fipi"],
        "sources": info["sources"],
        "actuality": info["actuality"],
        "difficulty": info["difficulty"],
        "ruleId": info["ruleId"],
        "ruleTitle": info["ruleTitle"],
        "ruleUrl": info["ruleUrl"],
        "passageId": passage_id if passage_html else None,
        "passageHtml": passage_html or None,
        "passageText": plain_from_html(passage_html) or None,
        "questionHtml": question_html,
        "questionText": question_text,
        "answer": answer or None,
        "answerNorm": kind["answerNorm"],
        "answerNumbers": kind["answerNumbers"],
        "answerAlts": kind["answerAlts"],
        "answerKind": kind["answerKind"],
        "answerMode": kind["answerMode"],
        "solutionHtml": solution_html or None,
        "solutionText": plain_from_html(solution_html) or None,
    }


def parse_category(html: str, placement: dict) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    problems = []
    for prob in soup.select("div.prob_maindiv"):
        item = parse_problem(prob, placement)
        if item:
            problems.append(item)
    return problems


def card(problem: dict, file_name: str) -> dict:
    question = problem["questionText"] or ""
    return {
        "id": problem["id"],
        "url": problem["url"],
        "file": file_name,
        "task": problem["task"],
        "taskTitle": problem["taskTitle"],
        "topicId": problem["topicId"],
        "topic": problem["topic"],
        "answerKind": problem["answerKind"],
        "answerMode": problem["answerMode"],
        "answer": problem["answer"],
        "answerNorm": problem["answerNorm"],
        "answerNumbers": problem["answerNumbers"],
        "passageId": problem["passageId"],
        "hasPassage": bool(problem["passageId"]),
        "hasSolution": bool(problem["solutionText"]),
        "actuality": problem["actuality"],
        "difficulty": problem["difficulty"],
        "ruleId": problem["ruleId"],
        "ruleTitle": problem["ruleTitle"],
        "fipi": problem["fipi"],
        "testIds": [s["testId"] for s in problem["sources"] if s.get("testId")],
        "sources": [s["title"] for s in problem["sources"]],
        "question": question if len(question) <= 280 else question[:277].rstrip() + "…",
    }


def public_problem(problem: dict) -> dict:
    data = dict(problem)
    data.pop("passageHtml", None)
    data.pop("passageText", None)
    return data


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_lists(out: Path, by_file: dict) -> None:
    """Короткие списки для страницы задания: без текстов, ответов и пояснений."""
    for key, bucket in by_file.items():
        slim = {
            "id": bucket["id"],
            "task": bucket["task"],
            "title": bucket["title"],
            "count": bucket.get("count", len(bucket.get("problems") or [])),
            "problems": [
                {
                    "id": problem["id"],
                    "topicId": problem.get("topicId"),
                    "topic": problem.get("topic"),
                    "questionText": problem.get("questionText") or "",
                    "answerKind": problem.get("answerKind"),
                    "answerMode": problem.get("answerMode"),
                }
                for problem in bucket.get("problems") or []
            ],
        }
        path = out / "bank" / f"{key}.list.json"
        path.write_text(json.dumps(slim, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")


def site_problem(problem: dict) -> dict:
    """Карточка для сайта: без дубля пояснения простым текстом и без общего текста."""
    sources = []
    for source in problem.get("sources") or []:
        title = (source or {}).get("title")
        if title:
            sources.append({"title": title})
    card = {
        "id": problem["id"],
        "task": problem["task"],
        "answerMode": problem.get("answerMode"),
        "answerKind": problem.get("answerKind"),
        "passageId": problem.get("passageId") or None,
        "sources": sources,
        "questionHtml": problem.get("questionHtml") or "",
        "answer": problem.get("answer"),
        "answerNorm": problem.get("answerNorm"),
        "answerNumbers": problem.get("answerNumbers") or None,
        "answerAlts": problem.get("answerAlts") or None,
        "solutionHtml": problem.get("solutionHtml") or None,
    }
    if card["answerMode"] == "essay" or card["answerKind"] == "essay":
        card["questionText"] = problem.get("questionText") or ""
    return {key: value for key, value in card.items() if value not in (None, "", [])}


def write_cards(out: Path, by_file: dict) -> None:
    """Отдельный файл на задание и на общий текст. Страница не качает весь номер."""
    problems_root = out / "problems"
    passages_root = out / "passages"
    if problems_root.exists():
        shutil.rmtree(problems_root)
    if passages_root.exists():
        shutil.rmtree(passages_root)
    seen: dict[str, str] = {}
    written = 0
    for key, bucket in by_file.items():
        task = int(bucket["task"])
        folder = problems_root / f"{task:02d}"
        folder.mkdir(parents=True, exist_ok=True)
        ids = []
        for problem in bucket.get("problems") or []:
            ids.append(problem["id"])
            card = site_problem(problem)
            (folder / f"{problem['id']}.json").write_text(
                json.dumps(card, ensure_ascii=False, separators=(",", ":")) + "\n",
                encoding="utf-8",
            )
            written += 1
            passage_id = problem.get("passageId")
            if not passage_id:
                continue
            passage = (bucket.get("passages") or {}).get(str(passage_id)) or (bucket.get("passages") or {}).get(passage_id)
            if not passage:
                continue
            html = passage.get("html") or ""
            prev = seen.get(str(passage_id))
            if prev is not None and prev != html:
                raise SystemExit(f"разный текст у одного passageId {passage_id}")
            seen[str(passage_id)] = html
        (out / "bank" / f"{key}.order.json").write_text(
            json.dumps(ids, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
    passages_root.mkdir(parents=True, exist_ok=True)
    for passage_id, html in seen.items():
        (passages_root / f"{passage_id}.json").write_text(
            json.dumps({"id": passage_id, "html": html}, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
    log(f"Карточки: {written}, тексты: {len(seen)}")


def write_cards_from_saved(out: Path) -> None:
    by_file = {}
    for path in sorted((out / "bank").glob("oge-??.json")):
        bucket = json.loads(path.read_text(encoding="utf-8"))
        by_file[bucket["id"]] = bucket
    if len(by_file) != 27:
        raise SystemExit(f"ожидались 27 файлов номеров, найдено {len(by_file)}")
    write_cards(out, by_file)


def placement_for(group: dict, topic: dict) -> dict:
    return {
        "task": group["task"],
        "taskTitle": group["title"],
        "topicId": topic["id"],
        "topic": topic["title"],
    }


def build(parse_only: bool, out: Path, only_topics: set[int] | None) -> None:
    global MEDIA
    MEDIA = out / "media"
    _rules_acc.clear()
    _media_map.clear()
    CACHE.mkdir(parents=True, exist_ok=True)
    catalog_path = CACHE / "catalog.html"
    if parse_only and catalog_path.exists():
        catalog_html = catalog_path.read_text(encoding="utf-8")
    else:
        catalog_html = fetch(f"{BASE}/prob_catalog", "catalog.html")
    groups = parse_catalog(catalog_html)
    jobs = []
    for group in groups:
        for topic in group["topics"]:
            if topic["count"] <= 0:
                continue
            if only_topics and topic["id"] not in only_topics:
                continue
            jobs.append((group, topic))
    log(f"Каталог: заданий 1–13, тем к скачиванию {len(jobs)}")

    def load_topic(item):
        group, topic = item
        name = f"cat-{topic['id']}.html"
        url = f"{BASE}/test?filter=all&category_id={topic['id']}&print=true"
        if parse_only and (CACHE / name).exists():
            html = (CACHE / name).read_text(encoding="utf-8")
        else:
            html = fetch(url, name)
        problems = parse_category(html, placement_for(group, topic))
        if problems and len(problems) < topic["count"] and not parse_only:
            cached = CACHE / name
            if cached.exists():
                cached.unlink()
            html = fetch(url, name)
            problems = parse_category(html, placement_for(group, topic))
        return topic["id"], topic["count"], problems

    parsed: dict[int, tuple] = {}
    errors = []
    if parse_only:
        for item in jobs:
            try:
                topic_id, expected, problems = load_topic(item)
                parsed[topic_id] = (expected, problems)
                log(f"  тема {topic_id}: {len(problems)}/{expected}")
            except Exception as exc:
                errors.append({"topicId": item[1]["id"], "error": str(exc)})
                log(f"  ! тема {item[1]['id']}: {exc}")
    else:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(load_topic, item): item for item in jobs}
            done = 0
            for fut in as_completed(futures):
                item = futures[fut]
                done += 1
                try:
                    topic_id, expected, problems = fut.result()
                    parsed[topic_id] = (expected, problems)
                    log(f"  [{done}/{len(jobs)}] тема {topic_id}: {len(problems)}/{expected}")
                except Exception as exc:
                    errors.append({"topicId": item[1]["id"], "title": item[1]["title"], "error": str(exc)})
                    log(f"  [{done}/{len(jobs)}] ! тема {item[1]['id']}: {exc}")

    by_file: dict[str, dict] = {}
    seen: dict[int, str] = {}
    mismatches = []
    duplicates = 0
    for group in groups:
        key = f"oge-{group['task']:02d}"
        bucket = by_file.setdefault(
            key,
            {
                "id": key,
                "task": group["task"],
                "title": group["title"],
                "topics": group["topics"],
                "passages": {},
                "problems": [],
            },
        )
        for topic in group["topics"]:
            if topic["id"] not in parsed:
                continue
            expected, problems = parsed[topic["id"]]
            if len(problems) != expected:
                mismatches.append(
                    {
                        "topicId": topic["id"],
                        "title": topic["title"],
                        "task": group["task"],
                        "expected": expected,
                        "got": len(problems),
                    }
                )
            for problem in problems:
                if problem["id"] in seen:
                    duplicates += 1
                    continue
                seen[problem["id"]] = key
                if problem["passageId"] and problem["passageHtml"]:
                    current = bucket["passages"].get(problem["passageId"])
                    if not current or len(problem["passageHtml"]) > len(current["html"]) + 40:
                        bucket["passages"][problem["passageId"]] = {
                            "id": problem["passageId"],
                            "html": problem["passageHtml"],
                            "text": problem["passageText"],
                        }
                bucket["problems"].append(public_problem(problem))

    bank_dir = out / "bank"
    rules_dir = out / "rules"
    if bank_dir.exists() and not only_topics:
        for old in bank_dir.glob("*.json"):
            old.unlink()
    if rules_dir.exists() and not only_topics:
        for old in rules_dir.glob("*.json"):
            old.unlink()

    index = []
    files_meta = []
    text_links: dict[str, dict] = {}
    variants: dict[str, dict] = {}
    for group in groups:
        key = f"oge-{group['task']:02d}"
        bucket = by_file[key]
        bucket["problems"].sort(key=lambda p: (p["topicId"], p["id"]))
        bucket["count"] = len(bucket["problems"])
        bucket["passageCount"] = len(bucket["passages"])
        name = f"bank/{key}.json"
        write_json(out / "bank" / f"{key}.json", bucket)
        files_meta.append(
            {
                "file": name,
                "id": key,
                "task": bucket["task"],
                "title": bucket["title"],
                "count": bucket["count"],
                "passageCount": bucket["passageCount"],
                "topics": bucket["topics"],
            }
        )
        for problem in bucket["problems"]:
            index.append(card(problem, name))
            if problem.get("passageId"):
                slot = text_links.setdefault(
                    problem["passageId"],
                    {"id": problem["passageId"], "file": name, "problems": []},
                )
                slot["problems"].append({"id": problem["id"], "task": problem["task"], "file": name})
            for source in problem.get("sources") or []:
                test_id = source.get("testId")
                if not test_id:
                    continue
                var = variants.setdefault(
                    str(test_id),
                    {"testId": test_id, "title": source.get("title"), "url": source.get("url"), "problems": []},
                )
                var["problems"].append({"id": problem["id"], "task": problem["task"], "file": name})

    index.sort(key=lambda c: (c["task"], c["topicId"], c["id"]))
    for slot in text_links.values():
        slot["problems"].sort(key=lambda p: (p["task"], p["id"]))
        slot["tasks"] = sorted({p["task"] for p in slot["problems"]})
    for var in variants.values():
        var["problems"].sort(key=lambda p: (p["task"], p["id"]))
        var["tasks"] = sorted({p["task"] for p in var["problems"]})

    for rule in _rules_acc.values():
        write_json(out / "rules" / f"{rule['id']}.json", rule)

    modes: dict[str, int] = {}
    kinds: dict[str, int] = {}
    with_solution = with_answer = with_passage = without_question = 0
    weird = []
    for item in index:
        modes[item["answerMode"]] = modes.get(item["answerMode"], 0) + 1
        kinds[item["answerKind"]] = kinds.get(item["answerKind"], 0) + 1
        with_solution += int(item["hasSolution"])
        with_answer += int(bool(item["answer"]))
        with_passage += int(item["hasPassage"])
        if not item["question"]:
            without_question += 1
        answer = item["answer"] or ""
        if item["answerMode"] == "numbers" and not item.get("answerNumbers"):
            if len(weird) < 40:
                weird.append({"id": item["id"], "task": item["task"], "answer": answer, "note": "не разобран"})
        elif answer and re.search(r"\d", answer) and re.search(r"[A-Za-zА-Яа-яЁё]", answer):
            if len(weird) < 40:
                weird.append({"id": item["id"], "task": item["task"], "answer": answer})

    shared_texts = sum(1 for slot in text_links.values() if len(slot["tasks"]) > 1)
    full_variants = sum(1 for var in variants.values() if set(var["tasks"]) >= set(range(1, 14)))

    manifest = {
        "schema": 1,
        "exam": "ОГЭ",
        "subject": "русский язык",
        "tasks": list(range(1, 14)),
        "fetchedAt": date.today().isoformat(),
        "source": {
            "site": BASE + "/",
            "catalog": BASE + "/prob_catalog",
            "name": "Решу ОГЭ",
            "note": "Задания и пояснения собраны с rus-oge.sdamgia.ru для учебной базы студии «Лексикон». При размещении на сайте указывайте источник.",
        },
        "howToUse": {
            "index": "index.json — карточки без полных текстов: фильтр по номеру задания, теме, типу ответа, источнику, актуальности.",
            "bank": "bank/oge-01.json … oge-13.json — полная локальная база номера. Сайт её не качает: карточка лежит в problems/NN/id.json, общий текст — в passages/id.json, порядок для «следующее» — в bank/oge-NN.order.json.",
            "links": "links.json — какие задания делят один текст и какие входят в один вариант (testId источника).",
            "rules": "rules/{id}.json — справочная статья к заданию. В карточке это ruleId и ruleUrl.",
            "check": "answerMode=word: сравнивать answerNorm без пробелов, ё и е равны, годятся answerAlts. digits-any: цифры в любом порядке, эталон — answerNumbers или отсортированный answerNorm. digits-fixed: порядок цифр важен (соответствие, например задание 4). numbers: номера предложений, в том числе двузначные; если разобраны, они в answerNumbers, порядок не важен. essay и open: развёрнутый ответ (изложение 1, сочинение 13), ориентир в solutionHtml.",
        },
        "answerModes": {
            "word": "слово или несколько допустимых слов",
            "digits-any": "номера, порядок не важен",
            "digits-fixed": "последовательность цифр, порядок важен",
            "numbers": "номера предложений, среди которых есть двузначные",
            "essay": "сочинение",
            "open": "развёрнутый ответ без краткого ключа",
        },
        "counts": {
            "problems": len(index),
            "withSolution": with_solution,
            "withAnswer": with_answer,
            "withPassage": with_passage,
            "withoutQuestion": without_question,
            "texts": len(text_links),
            "sharedTexts": shared_texts,
            "variants": len(variants),
            "fullVariants": full_variants,
            "rules": len(_rules_acc),
            "duplicatesSkipped": duplicates,
            "byAnswerMode": modes,
            "byAnswerKind": kinds,
        },
        "files": files_meta,
        "mismatches": mismatches,
        "errors": errors,
        "weirdAnswers": weird,
    }
    write_json(out / "manifest.json", manifest)
    write_json(out / "index.json", {"schema": 1, "count": len(index), "problems": index})
    write_json(
        out / "links.json",
        {
            "schema": 1,
            "texts": text_links,
            "variants": variants,
        },
    )
    write_lists(out, by_file)
    write_cards(out, by_file)
    log(
        "Готово: заданий {n}, с пояснением {s}, с ответом {a}, текстов {t} (общих для нескольких номеров {st}), вариантов {v}, правил {r}, расхождений {m}, повторов {d}, ошибок {e}".format(
            n=len(index),
            s=with_solution,
            a=with_answer,
            t=len(text_links),
            st=shared_texts,
            v=len(variants),
            r=len(_rules_acc),
            m=len(mismatches),
            d=duplicates,
            e=len(errors),
        )
    )
    for row in mismatches:
        log(f"  ! тема {row['topicId']} задание {row['task']}: сайт {row['expected']}, скачано {row['got']}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--parse-only", action="store_true", help="не ходить в сеть, если страница уже в кэше")
    parser.add_argument("--out", default=str(ROOT / "js" / "oge-data"), help="каталог базы")
    parser.add_argument("--topics", default="", help="только эти id тем, через запятую")
    parser.add_argument("--cards-only", action="store_true", help="только разложить уже скачанную базу на карточки")
    args = parser.parse_args()
    out = Path(args.out)
    if args.cards_only:
        sys.stdout.reconfigure(encoding="utf-8")
        write_cards_from_saved(out)
        return
    only = {int(x) for x in args.topics.split(",") if x.strip()} or None
    build(args.parse_only, out, only)


if __name__ == "__main__":
    main()
