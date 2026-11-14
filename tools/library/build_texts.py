"""Сборка библиотеки: тексты из Викитеки (общественное достояние) → js/library-data.

python3 tools/library/build_texts.py [id ...]

Выгрузка идёт через ws-export (EPUB), кэш — tools/library/_cache (в git не попадает).
На выходе:
  js/library-data/catalog.json        — каталог (без текстов) с оглавлениями;
  js/library-data/texts/<id>-<n>.json  — части текста (по ~250 КБ), список глав {t, h}.
"""
import json, os, re, sys, time, zipfile, urllib.parse, urllib.request
from bs4 import BeautifulSoup, NavigableString, Tag

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from catalog import PERIODS, W  # noqa: E402

CACHE = os.path.join(HERE, "_cache")
OUT = os.path.join(SITE, "js", "library-data")
UA = {"User-Agent": "LeksikonStudyBot/1.0 (educational site, low volume)"}
PART_LIMIT = 250_000

ALLOWED = {"p", "br", "i", "em", "b", "strong", "sup", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "div", "span", "small", "hr", "dl", "dd"}


def fetch(url, path, tries=5):
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return path
    for i in range(tries):
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600).read()
            if len(data) < 1000:
                raise RuntimeError("short response")
            with open(path, "wb") as f:
                f.write(data)
            return path
        except Exception as e:  # сеть Викитеки иногда рвёт соединение
            print("   retry", i + 1, e, file=sys.stderr)
            time.sleep(5 + 10 * i)
    raise RuntimeError("cannot fetch " + url)


def epub_for(page):
    os.makedirs(CACHE, exist_ok=True)
    name = re.sub(r"[^\w]+", "_", page)[:120] + ".epub"
    url = "https://ws-export.wmcloud.org/?format=epub-3&fonts=&lang=ru&page=" + urllib.parse.quote(page)
    return fetch(url, os.path.join(CACHE, name))


def spine(epub):
    """[(файл, подпись в оглавлении, html)] в порядке чтения."""
    z = zipfile.ZipFile(epub)
    opf = BeautifulSoup(z.read("OPS/content.opf"), "xml")
    ncx = BeautifulSoup(z.read("OPS/toc.ncx"), "xml")
    labels = {}
    for np in ncx.find_all("navPoint"):
        src = np.find("content")["src"].split("#")[0]
        labels.setdefault(src, np.find("navLabel").get_text().strip())
    items = {i["id"]: i["href"] for i in opf.find_all("item")}
    out = []
    for ref in opf.find_all("itemref"):
        href = items.get(ref["idref"], "")
        if not href.endswith(".xhtml") or href in ("title.xhtml", "about.xhtml", "nav.xhtml") or any(o[0] == href for o in out):
            continue
        out.append((href, labels.get(href, ""), z.read("OPS/" + href).decode("utf-8")))
    return out


SKIP_FILE = re.compile(r"(Versia_\d|_DO_|_DO\.xhtml|__DO\b)")
SKIP_TITLE = re.compile(r"(\(ДО\)|/ДО$|/ДО/|Версия \d)")


def text_len(el):
    return len(re.sub(r"\s+", " ", el.get_text(" ")).strip())


def clean_node(node, notes, noteids):
    """Оставляет простую разметку; сноски Викитеки → <sup class="fn">."""
    for bad in node.select("style, script, link, meta, #headertemplate, .ws-noexport, .noprint, .navbox, .mw-cite-backlink, img, figure"):
        bad.decompose()
    for sup in node.select("sup.mw-ref, sup.reference"):
        a = sup.find("a")
        target = (a.get("href") or "").split("#")[-1] if a else ""
        if target in noteids:
            n = noteids[target]
            new = BeautifulSoup(f'<sup class="fn" data-n="{n}">{n}</sup>', "html.parser").sup
            sup.replace_with(new)
        else:
            sup.decompose()
    for el in node.select('[role=heading]'):
        lvl = el.get("aria-level") or "3"
        el.name = "h" + (lvl if lvl in "123456" else "3")
        el.attrs = {}
    for el in list(node.find_all(True)):
        if el.parent is None:
            continue
        name = el.name
        cls = " ".join(el.get("class") or [])
        style = (el.get("style") or "").replace(" ", "").lower()
        if name in ("center",) or "text-align:center" in style:
            el.name = "p" if name != "div" or not el.find(["p", "div"]) else "div"
            el.attrs = {"class": "c"}
            continue
        if "align-right" in cls or "text-align:right" in style:
            el.name = "p" if not el.find(["p", "div"]) else "div"
            el.attrs = {"class": "r"}
            continue
        if name == "div" and ("poem" in cls):
            el.attrs = {"class": "poem"}
            continue
        if name == "sup" and "fn" in cls:
            continue
        if name == "span":
            if "razr" in cls:
                el.attrs = {"class": "sp"}
            else:
                el.unwrap()
            continue
        if name in ("h1", "h2", "h3", "h4", "h5", "h6"):
            el.attrs = {}
            continue
        if name == "a":
            el.unwrap()
            continue
        if name in ("table", "tbody", "thead", "tr", "td", "th", "section", "ul", "ol", "li", "dl", "dd", "dt", "font", "big", "u", "s", "abbr", "cite", "q"):
            if name in ("td", "li", "dd", "tr"):
                el.name = "p"
                el.attrs = {}
            else:
                el.unwrap()
            continue
        if name not in ALLOWED:
            el.unwrap()
            continue
        keep = {}
        if name in ("div", "span") and el.get("class") in (["poem"], ["c"], ["r"], ["sp"]):
            keep["class"] = el.get("class")
        el.attrs = keep
    # пустые абзацы
    for p in node.find_all("p"):
        if not p.get_text(strip=True) and not p.find("br"):
            p.decompose()
    return node


def harvest_notes(soup):
    notes, ids = [], {}
    for li in soup.select("li[id^=cite_note]"):
        txt = li.select_one(".mw-reference-text") or li
        for b in txt.select(".mw-cite-backlink"):
            b.decompose()
        t = re.sub(r"\s+", " ", txt.get_text(" ")).strip()
        if t:
            notes.append(t)
            ids[li["id"]] = len(notes)
    for ol in soup.select("ol.references, .references-small, .mw-references-wrap"):
        ol.decompose()
    for hr in soup.select("hr"):
        hr.decompose()
    return notes, ids


META = re.compile(r"^(Книга:|Издательство|Источник|Дата создания|Опубл|Библиотека|Сканы|Собрание сочинений|Полное собрание)", re.I)
EDITION = re.compile(r"(Собрание сочинений|Сочинения в \d|Издательство|ГИХЛ|Гослитиздат|Художественная литература|Academia|М\.:|Л\.:|М\.—Л\.|Санкт-Петербург\.|\bТом \w+\b.*\d{4})")


def tidy(h):
    prev = None
    while prev != h:
        prev = h
        h = re.sub(r"<(div|span|p|i|b|em|strong)>\s*</\1>", "", h)
        h = re.sub(r"<p>(\s|<br/>)*</p>", "", h)
        h = re.sub(r"^(\s|<br/>)+", "", h)
        h = re.sub(r"(<br/>\s*){3,}", "<br/><br/>", h)
    return h.strip()


def drop_meta(chapter):
    soup = BeautifulSoup(chapter["h"], "html.parser")
    for p in soup.find_all(["p", "div"], recursive=False)[:8]:
        t = p.get_text(" ").strip()
        if META.match(t) or (EDITION.search(t) and len(t) < 200):
            p.decompose()
    chapter["h"] = tidy(str(soup))
    chapter["len"] = len(soup.get_text())
    return chapter


GROUP_RE = re.compile(r"^(ЧАСТЬ|Часть|ТОМ|Том|КНИГА|Книга|ДЕЙСТВИЕ|Действие|АКТ|Акт|ЭПИЛОГ|Эпилог)\b")
ROMAN = re.compile(r"^[IVXLCDM]+[.,]?$")


def nice_title(t):
    t = re.sub(r"\s+", " ", t).strip().strip("*").strip()
    t = re.sub(r"\s*\d+$", "", t) if re.search(r"[А-Яа-я]\d+$", t) else t  # «ГОРЕ ОТ УМА1» — номер сноски
    letters = re.sub(r"[^А-Яа-яЁё]", "", t)
    if letters and letters.upper() == letters and len(letters) > 2:
        words = []
        for wd in t.split(" "):
            words.append(wd if ROMAN.match(wd) else wd.lower())
        t = " ".join(words)
        t = re.sub(r"(^|[.!?]\s+)([а-яё])", lambda m: m.group(1) + m.group(2).upper(), t)
    return t.rstrip(".") if not t.endswith("..") else t


def parse_file(html, note_base):
    soup = BeautifulSoup(html, "html.parser")
    title = soup.title.get_text().strip() if soup.title else ""
    body = soup.body or soup
    notes, ids = harvest_notes(body)
    ids = {k: v + note_base for k, v in ids.items()}
    clean_node(body, notes, ids)
    items = []

    def flat(el):
        for ch in list(el.children):
            if isinstance(ch, NavigableString):
                if ch.strip():
                    items.append(("B", f"<p>{ch.strip()}</p>"))
                continue
            if not isinstance(ch, Tag):
                continue
            if ch.name in ("h1", "h2", "h3", "h4", "h5", "h6"):
                txt = re.sub(r"\s+", " ", ch.get_text(" ")).strip()
                if txt and txt not in ("Примечания", "ПРИМЕЧАНИЯ", "Комментарии"):
                    items.append(("H", 2 * int(ch.name[1]) - (1 if GROUP_RE.match(txt) else 0), txt))
                continue
            if ch.name in ("div", "section", "dl", "dd", "blockquote", "span") and ch.find(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6"]) and ch.get("class") != ["poem"]:
                flat(ch)
                continue
            items.append(("B", str(ch)))

    flat(body)
    return title, notes, items


def build_work(work):
    join = work.get("join")
    roots = work["ws"] if isinstance(work["ws"], list) else [work["ws"]]
    stream, notes = [], []
    for ri, root in enumerate(roots):
        files = spine(epub_for(root))
        multi = len(files) > 1
        container = None
        base = re.sub(r"\s*\(.*?\)\s*$", "", root.split("/")[0])
        if len(roots) > 1 and not join and base.lower() != work["title"].lower():
            stream.append(("H", 1, base))
        group = None
        for fi, (href, label, html) in enumerate(files):
            if ("Версия" not in root and SKIP_FILE.search(href)) or SKIP_TITLE.search(label):
                continue
            title, fnotes, items = parse_file(html, len(notes))
            body_len = sum(len(BeautifulSoup(it[1], "html.parser").get_text()) for it in items if it[0] == "B")
            if multi and fi == 0:
                continue  # корневая страница — оглавление
            notes += fnotes
            m = re.search(r"__(Cast_|Tom)_?([IVXLC\d]+)_", href)
            g = ("Часть " if m and m.group(1).startswith("Cast") else "Том ") + m.group(2) if m else ("Эпилог" if "_Epilog" in href else None)
            for key, name in work.get("groups") or []:
                if key in href:
                    g = name
            if g and g != group and not GROUP_RE.match(label):
                group = g
                container = g
                stream.append(("H", 2, g))
            if join:
                stream.append(("H", 2, root.split("/")[-1]))
            elif multi:
                if body_len < 1500 and fi + 1 < len(files) and GROUP_RE.match(label):
                    container = label
                    stream.append(("H", 2, label))
                    continue
                stream.append(("H", 3 if container else 2, label))
            for it in items:
                stream.append(("H", 10 + it[1], it[2]) if it[0] == "H" else it)
    # уровень разбиения: самый крупный, при котором глава в среднем ≤ 60 тыс. знаков
    def tlen(h):
        return len(BeautifulSoup(h, "html.parser").get_text())
    sizes = [tlen(it[1]) if it[0] == "B" else 0 for it in stream]
    total = sum(sizes)
    levels = sorted({it[1] for it in stream if it[0] == "H"})
    split = None
    for L in levels:
        cnt = sum(1 for it in stream if it[0] == "H" and it[1] <= L) + 1
        if cnt >= 2 and total / cnt <= 35000:
            split = L
            break
    if split is None and levels:
        split = levels[-1]
    chapters, stack = [], {}
    cur = {"t": "", "b": [], "len": 0}
    for it, size in zip(stream, sizes):
        if it[0] == "H" and not re.sub(r"[-*—–\s.]", "", it[2]):
            cur["b"].append('<p class="c">* * *</p>')
            continue
        if it[0] == "H" and split is not None and it[1] <= split:
            if cur["b"]:
                chapters.append(cur)
            stack = {k: v for k, v in stack.items() if k < it[1]}
            stack[it[1]] = nice_title(it[2])
            parts = [v for k, v in sorted(stack.items()) if v and v.lower() != work["title"].lower()]
            cur = {"t": " · ".join(parts), "b": [], "len": 0}
        elif it[0] == "H":
            cur["b"].append(f"<h4>{nice_title(it[2])}</h4>")
        else:
            cur["b"].append(it[1])
            cur["len"] += size
    if cur["b"]:
        chapters.append(cur)
    out = []
    for ch in chapters:
        h = "".join(ch["b"])
        used = sorted({int(n) for n in re.findall(r'data-n="(\d+)"', h)})
        c = drop_meta({"t": ch["t"], "h": h, "notes": [[n, notes[n - 1]] for n in used if 0 < n <= len(notes)], "len": ch["len"]})
        if c["len"] < 40:
            continue
        out.append(c)
    merged = []
    for c in out:
        if merged and merged[-1].get("tiny"):
            prev = merged.pop()
            c["h"] = prev["h"] + c["h"]
            c["notes"] = prev["notes"] + c["notes"]
            c["len"] += prev["len"]
        if c["len"] < 400 and not re.search(r"(?i)действующие лица", c["h"]):
            c["tiny"] = True
        merged.append(c)
    if len(merged) > 1 and merged[-1].get("tiny"):
        last = merged.pop()
        merged[-1]["h"] += last["h"]
        merged[-1]["notes"] += last["notes"]
    out = merged
    for c in out:
        c.pop("tiny", None)
    for i, c in enumerate(out):
        c["t"] = (work.get("rename") or {}).get(c["t"], c["t"])
        if not c["t"] and re.search(r"(?i)действующие лица", c["h"][:3000]):
            c["t"] = "Действующие лица"
        if not c["t"]:
            c["t"] = work["title"] if len(out) == 1 else ("Начало" if i == 0 else f"Часть {i + 1}")
    return out


def write_parts(work, chapters):
    os.makedirs(os.path.join(OUT, "texts"), exist_ok=True)
    for f in os.listdir(os.path.join(OUT, "texts")):
        if f.startswith(work["id"] + "-") and re.match(re.escape(work["id"]) + r"-\d+\.json$", f):
            os.remove(os.path.join(OUT, "texts", f))
    parts, cur, size = [], [], 0
    for c in chapters:
        item = {"t": c["t"], "h": c["h"]}
        if c["notes"]:
            item["n"] = c["notes"]
        s = len(json.dumps(item, ensure_ascii=False).encode())
        if cur and size + s > PART_LIMIT:
            parts.append(cur)
            cur, size = [], 0
        cur.append(item)
        size += s
    if cur:
        parts.append(cur)
    toc = []
    for pi, part in enumerate(parts):
        with open(os.path.join(OUT, "texts", f"{work['id']}-{pi + 1}.json"), "w", encoding="utf-8") as f:
            json.dump(part, f, ensure_ascii=False, separators=(",", ":"))
        for ci, item in enumerate(part):
            toc.append({"t": item["t"], "p": pi + 1, "i": ci})
    return toc, sum(c["len"] for c in chapters)


def wiki_check(titles):
    """Проверяет статьи Википедии, разворачивает перенаправления."""
    out = {}
    titles = list(titles)
    for i in range(0, len(titles), 40):
        chunk = titles[i:i + 40]
        u = "https://ru.wikipedia.org/w/api.php?" + urllib.parse.urlencode(
            {"action": "query", "titles": "|".join(chunk), "redirects": 1, "format": "json"})
        for k in range(5):
            try:
                d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60))
                break
            except Exception:
                time.sleep(3 + 5 * k)
        q = d["query"]
        alias = {}
        for n in q.get("normalized", []):
            alias[n["from"]] = n["to"]
        red = {r["from"]: r["to"] for r in q.get("redirects", [])}
        pages = {p["title"]: p for p in q["pages"].values()}
        for t in chunk:
            x = alias.get(t, t)
            x = red.get(x, x)
            p = pages.get(x)
            out[t] = x if p and "missing" not in p and "invalid" not in p else None
    return out


def main(only):
    old = {}
    cat_path = os.path.join(OUT, "catalog.json")
    if os.path.exists(cat_path):
        old = {w["id"]: w for w in json.load(open(cat_path))["works"]}
    wiki = wiki_check({w["wiki"] for w in W if w["wiki"]})
    works = []
    for work in W:
        item = {k: v for k, v in work.items() if k not in ("ws", "join", "groups", "rename") and v not in (None, False, "")}
        if work["wiki"]:
            if not wiki.get(work["wiki"]):
                print("!! нет статьи в Википедии:", work["wiki"])
                item.pop("wiki", None)
            else:
                item["wiki"] = wiki[work["wiki"]]
        if work["ws"]:
            roots = work["ws"] if isinstance(work["ws"], list) else [work["ws"]]
            item["src"] = ["https://ru.wikisource.org/wiki/" + urllib.parse.quote(r.replace(" ", "_")) for r in roots]
            if only and work["id"] not in only and work["id"] in old and old[work["id"]].get("toc"):
                item["toc"] = old[work["id"]]["toc"]
                item["chars"] = old[work["id"]].get("chars", 0)
            else:
                print("==", work["id"], roots[0])
                chapters = build_work(work)
                item["toc"], item["chars"] = write_parts(work, chapters)
                print(f"   {len(chapters)} глав, {item['chars'] // 1000} тыс. знаков")
        works.append(item)
    os.makedirs(OUT, exist_ok=True)
    with open(cat_path, "w", encoding="utf-8") as f:
        json.dump({"periods": [{"id": a, "title": b} for a, b in PERIODS], "works": works}, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(set(sys.argv[1:]))
