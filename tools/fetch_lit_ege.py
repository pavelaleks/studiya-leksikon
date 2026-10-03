# -*- coding: utf-8 -*-
"""Скачивает каталог ЕГЭ по литературе с lit-ege.sdamgia.ru и собирает базу для тренажёров.

Запуск из корня репозитория:
    python tools/fetch_lit_ege.py
Повторный разбор уже скачанных страниц:
    python tools/fetch_lit_ege.py --parse-only
"""

from __future__ import annotations

import argparse
import hashlib
import html as html_lib
import http.client
import json
import re
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
OUT = ROOT / "js" / "literature-data"
CACHE = ROOT / "tools" / "_sdamgia_cache"
MEDIA = OUT / "media"
BASE = "https://lit-ege.sdamgia.ru"
UA = "LexikonStudio/1.0 (literature bank; educational; +https://pavelaleks.github.io/studiya-leksikon/)"

WORKERS = 3
PAUSE = 0.35

_net_lock = threading.Lock()
_media_lock = threading.Lock()
_last_request = 0.0
_media_map: dict[str, str] = {}


def log(msg: str) -> None:
    print(msg, flush=True)


def fix_entities(value: str, *, keep_markup_entities: bool = False) -> str:
    """Чинит &nbsp без ';' и обычные HTML-сущности. В HTML &lt;/&gt; не трогаем."""
    if not value or "&" not in value:
        return value
    value = re.sub(r"&nbsp;?", " ", value, flags=re.I)
    if keep_markup_entities:
        return value
    return html_lib.unescape(value)


def norm_text(value: str) -> str:
    value = fix_entities(value)
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


def answer_norm(value: str) -> str:
    value = norm_text(value).lower().replace("ё", "е")
    value = value.replace("«", '"').replace("»", '"').replace("–", "-").replace("—", "-")
    value = re.sub(r"\s+", " ", value).strip(" .;:")
    return value


def fetch(url: str, cache_name: str | None = None) -> str:
    path = CACHE / cache_name if cache_name else None
    if path and path.exists() and path.stat().st_size > 0:
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
            with urllib.request.urlopen(req, timeout=90) as resp:
                raw = resp.read()
            text = raw.decode("utf-8", errors="replace")
            if "prob_maindiv" not in text and "cat_main" not in text and cache_name != "catalog.html":
                raise OSError("пустой или чужой ответ")
            if path:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
            return text
        except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException) as exc:
            last_error = str(exc)
            log(f"  повтор {attempt + 1}: {url} ({last_error[:120]})")
            time.sleep(delay)
            delay = min(delay * 2, 20)
    raise RuntimeError(f"Не удалось скачать {url}: {last_error}")


def download_media(src: str) -> str:
    if src.startswith("//"):
        url = "https:" + src
    elif src.startswith("/"):
        url = BASE + src
    elif src.startswith("http"):
        url = src
    else:
        url = BASE + "/" + src
    with _media_lock:
        if url in _media_map:
            return _media_map[url]
    ext = Path(url.split("?", 1)[0]).suffix.lower()
    if ext not in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"}:
        ext = ".img"
    name = hashlib.sha1(url.encode("utf-8")).hexdigest()[:16] + ext
    dest = MEDIA / name
    if not dest.exists() or dest.stat().st_size == 0:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as resp:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(resp.read())
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
        task = int(norm_text(num_el.get_text())) if num_el else None
        if num_el:
            num_el.extract()
        title = norm_text(title_el.get_text(" ", strip=True)).lstrip(". ").strip()
        topics = []
        for child in wrap.find_all("div", class_="cat_category", recursive=False):
            link = child.find("a", class_="cat_name")
            count_el = child.find("div", class_="cat_count")
            if not link or not child.get("data-id"):
                continue
            topics.append(
                {
                    "id": int(child["data-id"]),
                    "title": norm_text(link.get_text(" ", strip=True)),
                    "count": int(norm_text(count_el.get_text())) if count_el else 0,
                }
            )
        kind = "ege" if task else "extra"
        legacy = None
        if kind == "extra":
            codes = re.findall(r"\b(?:Д\d+|B\d+|C\d+)\b", title)
            legacy = codes or None
        groups.append(
            {
                "kind": kind,
                "task": task,
                "title": title,
                "legacy": legacy,
                "topics": topics,
            }
        )
    if not any(g["kind"] == "ege" for g in groups):
        raise RuntimeError("В каталоге не нашлись задания 1–11")
    return groups


INSTRUCTION = re.compile(
    r"^прочитайте привед[её]нн\w+ ниже .+ и выполните задани",
    re.I,
)


def strip_soft_hyphens(node: Tag) -> None:
    for text in list(node.find_all(string=True)):
        cleaned = (
            text.replace("\u00ad", "")
            .replace("\u200b", "")
            .replace("\ufeff", "")
            .replace("\u2060", "")
            .replace("\xa0", " ")
            .replace("\u202f", " ")
        )
        cleaned = re.sub(r" {2,}", " ", cleaned)
        if cleaned != text:
            text.replace_with(cleaned)


def is_blank_grid(table: Tag) -> bool:
    cells = [norm_text(td.get_text(" ", strip=True)) for td in table.find_all(["td", "th"])]
    filled = [c for c in cells if c]
    if not filled:
        return True
    return set(filled) <= {"А", "Б", "В", "Г", "Д", "Е", "A", "B", "C"} and len(filled) <= 6


def clean_fragment(node: Tag | None) -> str:
    if node is None:
        return ""
    root = BeautifulSoup(str(node), "lxml")
    box = root.body if root.body else root
    for bad in box.select("script, style, img.briefcase"):
        bad.decompose()
    for comment in box.find_all(string=lambda t: isinstance(t, Comment)):
        comment.extract()
    for paragraph in list(box.find_all("p")):
        if INSTRUCTION.match(norm_text(paragraph.get_text(" ", strip=True))):
            paragraph.decompose()
    for table in list(box.find_all("table")):
        if is_blank_grid(table):
            table.decompose()
    strip_soft_hyphens(box)
    for el in list(box.find_all(True)):
        if not isinstance(el, Tag):
            continue
        if el.name == "img":
            src = el.get("src") or ""
            alt = el.get("alt") or ""
            if "ast" in alt.lower() or not src or "briefcase" in src or src.endswith("document-pdf-text.png"):
                if "ast" in alt.lower():
                    el.replace_with("***")
                else:
                    el.decompose()
                continue
            try:
                el["src"] = download_media(src)
            except (urllib.error.URLError, TimeoutError, OSError):
                el["src"] = src if src.startswith("http") else BASE + src
            el.attrs = {k: el.attrs[k] for k in ("src", "alt") if k in el.attrs}
            continue
        align_right = el.get("align") == "right" or "text-align:right" in (el.get("style") or "").replace(" ", "")
        keep = {}
        if el.name in {"td", "th"}:
            for key in ("colspan", "rowspan"):
                if el.get(key):
                    keep[key] = el[key]
        if el.name == "a" and el.get("href"):
            href = el["href"]
            if href.startswith("/"):
                href = BASE + href
            if href.startswith("http"):
                keep["href"] = href
                keep["target"] = "_blank"
                keep["rel"] = "noopener"
        if align_right:
            keep["class"] = "lit-right"
        el.attrs = keep
    html = box.decode_contents()
    html = re.sub(r"\n{3,}", "\n\n", html)
    html = re.sub(r"(?:<p>\s*</p>\s*)+", "", html)
    html = re.sub(r"(?is)(<p>\s*)<b>\s*Пояснение\.?\s*</b>\s*", r"\1", html, count=1)
    html = re.sub(r"(?:<p>\s*</p>\s*)+", "", html)
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


def looks_like_name(value: str | None) -> bool:
    if not value or len(value) > 60 or re.search(r"\d|«|»", value):
        return False
    low = value.lower()
    if any(word in low for word in ("литератур", "проза", "поэз", "войн", "век", "роман", "стих", "пьес")):
        return False
    parts = [p for p in value.replace(".", " ").split() if p]
    return 1 <= len(parts) <= 6 and any(p[:1].isupper() for p in parts)


def parse_attribution(line: str) -> tuple[str | None, str | None]:
    text = norm_text(line or "")
    if not text:
        return None, None
    text = re.sub(r"^[\s(]+|[)\s]+$", "", text)
    # Сначала год: иначе «По, 1829 (перевод …)» после split оставляет «По (»
    text = re.sub(r",?\s*\d{4}\s*[–—-]\s*\d{4}", "", text)
    text = re.sub(r",?\s*\d{4}\b", "", text)
    text = re.sub(r"\([^)]*(?:перевод|пер\.)[^)]*\)", "", text, flags=re.I)
    text = re.split(r"\(?\s*,?\s*(?:перевод|пер\.)\b", text, maxsplit=1, flags=re.I)[0]
    work = None
    match = re.search(r"[«\"]([^»\"]+)[»\"]", text)
    if match and text.count("«") + text.count('"') == 1:
        work = match.group(1).strip()
        text = f"{text[: match.start()]} {text[match.end() :]}"
    author = norm_text(text).strip(" ,;.(]")
    if not looks_like_name(author):
        author = None
    return author, work


def source_from_passage(html: str) -> dict:
    soup = BeautifulSoup(html or "", "lxml")
    node = soup.select_one(".lit-right")
    line = norm_text(node.get_text(" ", strip=True)) if node else ""
    author, work = parse_attribution(line)
    return {"sourceLine": line or None, "author": author, "work": work}


def split_fipi(items: list[str]) -> tuple[str | None, str | None]:
    if len(items) != 1:
        return None, None
    body = re.sub(r"^\d+(?:\.\d+)*\.?\s*", "", items[0]).strip(" ,;")
    index = 0
    author = None
    rest = body
    while index < len(body):
        if body[index] != ".":
            index += 1
            continue
        prev = body[:index].rstrip().split()[-1] if body[:index].strip() else ""
        if len(prev) == 1 and prev[:1].isupper():
            index += 1
            continue
        author = body[:index].strip()
        rest = body[index + 1 :].strip()
        break
    else:
        author = body.strip()
        rest = ""
    work = None
    if rest and rest.count("«") == 1:
        found = re.search(r"«([^»]+)»", rest)
        if found:
            work = found.group(1).strip()
    if not looks_like_name(author):
        author = None
    return author, work


def read_info(block: Tag | None) -> dict:
    info = {"fipi": [], "fipi2024": [], "source": None, "sourceUrl": None, "rubric": None}
    if not block:
        return info
    for child in block.find_all(recursive=False):
        if not isinstance(child, Tag):
            continue
        text = norm_text(child.get_text(" ", strip=True))
        links = [norm_text(a.get_text(" ", strip=True)) for a in child.find_all("a")]
        links = [x for x in links if x]
        if text.startswith("Раздел кодификатора ФИПИ (2024"):
            info["fipi2024"] = links or ([re.sub(r"^Раздел кодификатора ФИПИ \(2024 г\.\):\s*", "", text)] if text else [])
        elif text.startswith("Раздел кодификатора ФИПИ"):
            info["fipi"] = links
        elif text.startswith("Источник"):
            link = child.find("a")
            if link:
                info["source"] = norm_text(link.get_text(" ", strip=True)) or None
                href = link.get("href") or ""
                info["sourceUrl"] = (BASE + href) if href.startswith("/") else (href or None)
            else:
                info["source"] = re.sub(r"^Источник:\s*", "", text) or None
        elif text:
            info["rubric"] = text
    info["fipi"] = [x for x in info["fipi"] if x]
    info["fipi2024"] = [x.rstrip(" ,;") for x in info["fipi2024"] if x]
    return info


def extract_answer(prob: Tag) -> str:
    box = prob.select_one(".prob_answer")
    if box:
        cells = [c for c in box.find_all("div", recursive=False)]
        if len(cells) >= 2:
            raw = norm_text(cells[-1].get_text(" ", strip=True))
            if raw and raw.lower() not in {"нет", "см. решение"}:
                return raw
    ans = prob.select_one(".answer")
    if ans:
        raw = norm_text(ans.get_text(" ", strip=True))
        raw = re.sub(r"^Ответ:\s*", "", raw, flags=re.I).strip()
        if raw:
            return raw
    sol = prob.select_one(".solution")
    if sol:
        text = norm_text(sol.get_text("\n", strip=True))
        match = re.search(r"Ответ:\s*(.+)$", text, flags=re.I)
        if match:
            tail = match.group(1).strip()
            if 0 < len(tail) <= 120:
                return tail
    return ""


def answer_kind(task: int | None, title: str, question: str, answer: str) -> str:
    blob = f"{title} {question[:500]}".lower()
    if task == 11 or "сочинен" in blob and ("тем" in blob[:400] or "объём" in blob or "объем" in blob):
        return "essay"
    digits = re.sub(r"\s+", "", answer)
    if answer and re.fullmatch(r"[\d\s]+", answer) and len(digits) >= 2:
        return "match"
    if answer and len(answer) <= 100 and "\n" not in answer:
        return "short"
    return "open"


def answer_alts(answer: str) -> list[str]:
    if not answer or not re.search(r"[|/]", answer):
        return []
    parts = [norm_text(p) for p in re.split(r"\s*[|/]\s*", answer)]
    parts = [p for p in parts if p]
    if len(parts) < 2 or any(len(p) > 60 for p in parts):
        return []
    return parts


def parse_problem(prob: Tag, placement: dict) -> dict | None:
    link = prob.select_one(".prob_nums a[href*='problem?id=']")
    if not link:
        return None
    pid = int(re.search(r"id=(\d+)", link["href"]).group(1))
    type_label = norm_text(prob.select_one(".prob_nums").get_text(" ", strip=True))
    type_match = re.search(r"Тип\s+(.+?)\s*№", type_label)
    info = read_info(prob.select_one(".align-left"))
    question_node = prob.select_one("div.pbody[id^='body']")
    passage_node = prob.select_one(".probtext")
    passage_id = None
    passage_html = ""
    if passage_node:
        passage_id = passage_node.get("data-text_id") or None
        inner = passage_node.select_one(".pbody") or passage_node
        passage_html = clean_fragment(inner)
    question_html = clean_fragment(question_node)
    if not question_html and passage_html:
        question_html = passage_html
        passage_html = ""
        passage_id = None
    solution_node = prob.select_one(".solution")
    solution_html = clean_fragment(solution_node)
    answer = extract_answer(prob)
    question_text = plain_from_html(question_html)
    kind = answer_kind(placement["task"], placement["topic"], question_text, answer)
    passage_meta = source_from_passage(passage_html)
    author, work = passage_meta["author"], passage_meta["work"]
    if kind != "essay" and (not author or not work):
        guessed_author, guessed_work = split_fipi(info["fipi2024"] or info["fipi"])
        author = author or guessed_author
        work = work or guessed_work
    if kind == "essay":
        author = None
        work = None
    if passage_html and not passage_id:
        passage_id = "h" + hashlib.sha1(norm_text(plain_from_html(passage_html)).encode("utf-8")).hexdigest()[:12]
    alts = answer_alts(answer)
    return {
        "id": pid,
        "url": f"{BASE}/problem?id={pid}",
        "typeLabel": type_match.group(1).strip() if type_match else None,
        "task": placement["task"],
        "taskTitle": placement["taskTitle"],
        "topicId": placement["topicId"],
        "topic": placement["topic"],
        "kind": placement["kind"],
        "legacy": placement["legacy"],
        "rubric": info["rubric"],
        "fipi": info["fipi"],
        "fipi2024": info["fipi2024"],
        "source": info["source"],
        "sourceUrl": info["sourceUrl"],
        "author": author,
        "work": work,
        "passageId": passage_id if passage_html else None,
        "passageAuthor": passage_meta["author"],
        "passageWork": passage_meta["work"],
        "passageHtml": passage_html or None,
        "passageText": plain_from_html(passage_html) or None,
        "passageSource": passage_meta["sourceLine"],
        "questionHtml": question_html,
        "questionText": question_text,
        "answer": answer or None,
        "answerNorm": answer_norm(answer) if answer else None,
        "answerAlts": [answer_norm(a) for a in alts] if alts else [],
        "answerKind": kind,
        "solutionHtml": solution_html or None,
        "solutionText": plain_from_html(solution_html) or None,
    }


def placement_for(group: dict, topic: dict) -> dict:
    return {
        "kind": group["kind"],
        "task": group["task"],
        "taskTitle": group["title"],
        "topicId": topic["id"],
        "topic": topic["title"],
        "legacy": group["legacy"],
    }


def parse_category(html: str, placement: dict) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    problems = []
    for prob in soup.select("div.prob_maindiv"):
        item = parse_problem(prob, placement)
        if item:
            problems.append(item)
    return problems


def file_key(group: dict, extra_index: int) -> str:
    if group["kind"] == "ege":
        return f"ege-{group['task']:02d}"
    return f"extra-{extra_index:02d}"


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
        "kind": problem["kind"],
        "legacy": problem["legacy"],
        "answerKind": problem["answerKind"],
        "answer": problem["answer"],
        "answerNorm": problem["answerNorm"],
        "author": problem["author"],
        "work": problem["work"],
        "fipi": problem["fipi"],
        "fipi2024": problem["fipi2024"],
        "source": problem["source"],
        "hasPassage": bool(problem["passageId"]),
        "hasSolution": bool(problem["solutionText"]),
        "question": question if len(question) <= 280 else question[:277].rstrip() + "…",
    }


def public_problem(problem: dict) -> dict:
    data = dict(problem)
    data.pop("passageHtml", None)
    data.pop("passageText", None)
    data.pop("passageSource", None)
    data.pop("passageAuthor", None)
    data.pop("passageWork", None)
    return data


def write_json(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build(parse_only: bool) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    catalog_html = fetch(f"{BASE}/prob_catalog", "catalog.html") if not parse_only else (CACHE / "catalog.html").read_text(encoding="utf-8")
    if parse_only and not (CACHE / "catalog.html").exists():
        catalog_html = fetch(f"{BASE}/prob_catalog", "catalog.html")
    groups = parse_catalog(catalog_html)
    jobs = []
    extra_i = 0
    group_files = []
    for group in groups:
        if group["kind"] == "extra":
            extra_i += 1
        key = file_key(group, extra_i)
        group_files.append((group, key))
        for topic in group["topics"]:
            jobs.append((group, topic, key))

    log(f"Каталог: групп {len(groups)}, тем {len(jobs)}")

    def load_topic(item):
        group, topic, key = item
        name = f"cat-{topic['id']}.html"
        if parse_only and (CACHE / name).exists():
            html = (CACHE / name).read_text(encoding="utf-8")
        else:
            url = f"{BASE}/test?filter=all&category_id={topic['id']}&print=true"
            html = fetch(url, name)
        problems = parse_category(html, placement_for(group, topic))
        return topic["id"], topic["count"], len(problems), problems, key

    parsed: dict[int, tuple] = {}
    if parse_only:
        for item in jobs:
            topic_id, expected, got, problems, key = load_topic(item)
            parsed[topic_id] = (expected, got, problems, key)
            log(f"  тема {topic_id}: {got}/{expected}")
    else:
        with ThreadPoolExecutor(max_workers=WORKERS) as pool:
            futures = {pool.submit(load_topic, item): item for item in jobs}
            done = 0
            for fut in as_completed(futures):
                topic_id, expected, got, problems, key = fut.result()
                parsed[topic_id] = (expected, got, problems, key)
                done += 1
                log(f"  [{done}/{len(jobs)}] тема {topic_id}: {got}/{expected}")

    by_file: dict[str, dict] = {}
    seen_ids: dict[int, str] = {}
    mismatches = []
    duplicates = 0
    for group, key in group_files:
        bucket = by_file.setdefault(
            key,
            {
                "id": key,
                "kind": group["kind"],
                "task": group["task"],
                "title": group["title"],
                "legacy": group["legacy"],
                "topics": group["topics"],
                "passages": {},
                "problems": [],
            },
        )
        for topic in group["topics"]:
            expected, got, problems, _key = parsed[topic["id"]]
            if got != expected:
                mismatches.append({"topicId": topic["id"], "title": topic["title"], "expected": expected, "got": got})
            for problem in problems:
                if problem["id"] in seen_ids:
                    duplicates += 1
                    continue
                seen_ids[problem["id"]] = key
                if problem["passageId"] and problem["passageHtml"]:
                    bucket["passages"].setdefault(
                        problem["passageId"],
                        {
                            "id": problem["passageId"],
                            "html": problem["passageHtml"],
                            "text": problem["passageText"],
                            "sourceLine": problem["passageSource"],
                            "author": problem["passageAuthor"],
                            "work": problem["passageWork"],
                        },
                    )
                bucket["problems"].append(public_problem(problem))

    bank_dir = OUT / "bank"
    if bank_dir.exists():
        for old in bank_dir.glob("*.json"):
            old.unlink()

    index = []
    files_meta = []
    for key, bucket in by_file.items():
        bucket["problems"].sort(key=lambda p: (p["topicId"], p["id"]))
        bucket["count"] = len(bucket["problems"])
        bucket["passageCount"] = len(bucket["passages"])
        name = f"bank/{key}.json"
        write_json(OUT / "bank" / f"{key}.json", bucket)
        files_meta.append(
            {
                "file": name,
                "id": key,
                "kind": bucket["kind"],
                "task": bucket["task"],
                "title": bucket["title"],
                "legacy": bucket["legacy"],
                "count": bucket["count"],
                "topics": [{"id": t["id"], "title": t["title"], "count": t["count"]} for t in bucket["topics"]],
            }
        )
        for problem in bucket["problems"]:
            index.append(card(problem, name))
    index.sort(key=lambda c: ((c["task"] or 99), c["topicId"], c["id"]))

    kind_counts: dict[str, int] = {}
    with_solution = 0
    with_answer = 0
    with_passage = 0
    for item in index:
        kind_counts[item["answerKind"]] = kind_counts.get(item["answerKind"], 0) + 1
        with_solution += int(item["hasSolution"])
        with_answer += int(bool(item["answer"]))
        with_passage += int(item["hasPassage"])

    manifest = {
        "schema": 1,
        "exam": "ЕГЭ",
        "subject": "литература",
        "fetchedAt": date.today().isoformat(),
        "source": {
            "site": BASE + "/",
            "catalog": BASE + "/prob_catalog",
            "name": "Решу ЕГЭ",
            "note": "Задания и пояснения собраны с lit-ege.sdamgia.ru для учебной базы студии «Лексикон». При размещении на сайте указывайте источник.",
        },
        "howToUse": {
            "index": "index.json — карточки всех заданий без полных текстов: фильтр по номеру, теме, автору, типу ответа.",
            "bank": "bank/ege-01.json … ege-11.json — полные тексты действующего экзамена. bank/extra-NN.json — дополнительные задания прежнего формата.",
            "passage": "В файле банка passages[passageId] — общий фрагмент произведения. В задании passageId ссылается на него, вопрос лежит в questionHtml.",
            "check": "answerKind=short и match можно проверять по answerNorm (и answerAlts). open и essay — развёрнутый ответ, ориентир в solutionHtml.",
        },
        "answerKinds": {
            "short": "краткий словесный ответ",
            "match": "последовательность цифр, соответствие",
            "open": "развёрнутый ответ",
            "essay": "сочинение",
        },
        "counts": {
            "problems": len(index),
            "ege": sum(1 for x in index if x["kind"] == "ege"),
            "extra": sum(1 for x in index if x["kind"] == "extra"),
            "withSolution": with_solution,
            "withAnswer": with_answer,
            "withPassage": with_passage,
            "duplicatesSkipped": duplicates,
            "byAnswerKind": kind_counts,
        },
        "files": files_meta,
        "mismatches": mismatches,
    }
    write_json(OUT / "manifest.json", manifest)
    write_json(OUT / "index.json", {"schema": 1, "count": len(index), "problems": index})
    log(
        "Готово: заданий {n}, с пояснением {s}, с ответом {a}, расхождений с каталогом {m}, повторов {d}".format(
            n=len(index),
            s=with_solution,
            a=with_answer,
            m=len(mismatches),
            d=duplicates,
        )
    )
    for row in mismatches:
        log(f"  ! тема {row['topicId']} {row['title']}: сайт {row['expected']}, скачано {row['got']}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--parse-only", action="store_true", help="не ходить в сеть, если страница уже в кэше")
    args = parser.parse_args()
    build(args.parse_only)


if __name__ == "__main__":
    main()
