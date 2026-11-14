"""Стихи для заучивания: тексты из Викитеки → js/library-data/poems.json + supabase/seed_poems.sql.

python3 tools/library/build_poems.py
"""
import json, os, re, sys, time, urllib.parse, urllib.request
from bs4 import BeautifulSoup

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from poems import P, THEMES  # noqa: E402

UA = {"User-Agent": "LeksikonStudyBot/1.0 (educational site, low volume)"}
CACHE = os.path.join(HERE, "_cache", "poems")
OVERRIDE = os.path.join(HERE, "poems_override.json")  # ручные поправки: {id: "страница Викитеки"}


def api(**p):
    p.update(format="json", formatversion=2)
    u = "https://ru.wikisource.org/w/api.php?" + urllib.parse.urlencode(p)
    for i in range(6):
        try:
            return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60))
        except Exception:
            time.sleep(2 + 4 * i)
    return {"error": "network"}


def parse(title):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, re.sub(r"[^\w]+", "_", title)[:150] + ".json")
    if os.path.exists(path):
        return json.load(open(path))
    d = api(action="parse", page=title, prop="text|links", redirects=1, disablelimitreport=1)
    if d.get("error") == "network":
        return {"missing": True}
    if "error" in d:
        d = {"missing": True}
    else:
        d = {"title": d["parse"]["title"], "html": d["parse"]["text"],
             "links": [l["title"] for l in d["parse"].get("links", []) if l.get("exists")]}
    json.dump(d, open(path, "w"), ensure_ascii=False)
    return d


def poem_text(html, all_blocks=False, title=""):
    soup = BeautifulSoup(html, "html.parser")
    for bad in soup.select("sup, .reference, .references, .mw-references-wrap, style, .noprint, #headertemplate, .ws-noexport"):
        bad.decompose()
    blocks = soup.select("div.poem")
    ladder = soup.select("table.transparent[role=presentation]")
    if ladder and (not blocks or sum(len(b.get_text()) for b in blocks) < 200):
        # «лесенка» Маяковского: строка таблицы = строка стиха, таблица = строфа
        stanzas = []
        for tb in ladder:
            lines = [" ".join(td.get_text(" ").replace("\xa0", " ").strip() for td in tr.find_all("td")).strip() for tr in tb.find_all("tr")]
            lines = [re.sub(r"^\d{1,3}\s+", "", re.sub(r"\s+", " ", l)).strip() for l in lines if l.strip()]
            if lines:
                stanzas.append(lines)
        return "\n\n".join("\n".join(st) for st in stanzas), None
    if not blocks or not any(b.get_text(strip=True) for b in blocks):
        # без разметки стихов: строки — абзацы основного текста
        root = soup.select_one(".mw-parser-output") or soup
        for bad in root.select("#headertemplate, .ws-noexport, table, .header_notes, #ws-data, .mw-heading, h2, h3"):
            bad.decompose()
        ps = [p for p in root.find_all("p", recursive=False) if p.get_text(strip=True)]
        if len(ps) < 2:
            return None, None
        wrap = BeautifulSoup('<div class="poem"></div>', "html.parser")
        for p in ps:
            wrap.div.append(BeautifulSoup(str(p), "html.parser"))
        blocks = [wrap.div]
    # основной текст — первый блок не короче 4 строк (короткие перед ним — эпиграф);
    # дальше у академических изданий идут варианты и редакции — их не берём
    def nlines(b):
        return len([x for x in re.split(r"<br\s*/?>|\n", b.decode_contents()) if BeautifulSoup(x, "html.parser").get_text().strip()])
    chosen = []
    for b in blocks:
        chosen.append(b)
        if nlines(b) >= 5 and not all_blocks:
            break
    blocks = chosen
    stanzas = []
    for b in blocks:
        b = BeautifulSoup(re.sub(r"\s*\n\s*", " ", str(b)), "html.parser")
        for br in b.find_all("br"):
            br.replace_with("\n")
        for p in b.find_all("p"):
            p.insert_after("\n\n")
        txt = b.get_text()
        txt = txt.replace("\xa0", " ")
        for st in re.split(r"\n\s*\n", txt):
            lines = [re.sub(r"[ \t]+", " ", l).strip() for l in st.split("\n")]
            lines = [re.sub(r"^\d{1,3}\s+(?=[«(…—А-ЯЁA-Z‎])", "", l).replace("\u200e", "").strip() for l in lines]
            lines = [l for l in lines if l]
            if lines:
                stanzas.append(lines)
    # нумерация строк академических изданий (5, 10, 15…), правки в скобках, варианты «а) […]»
    def fix(l):
        l = l.replace("\u200e", "").strip()
        m = re.match(r"^(\d{1,3})\s+(?=\S)", l)
        if m and int(m.group(1)) % 5 == 0:
            l = l[m.end():]
        l = re.sub(r"\[([^\]\d]+)\]", r"\1", l)
        return l
    stanzas = [[fix(l) for l in st] for st in stanzas]
    stanzas = [[l for l in st if l] for st in stanzas if not re.match(r"^[а-д]\)\s*\[?", st[0] if st else "")]
    stanzas = [st for st in stanzas if st]
    if stanzas and len(stanzas[-1]) == 1 and len(stanzas[-1][0]) < 60 and re.search(r"1[789]\d\d", stanzas[-1][0]):
        date = stanzas.pop()[0]
    tt = re.sub(r"[^А-ЯЁA-Z]", "", title.upper())
    if stanzas and tt and re.sub(r"[^А-ЯЁA-Z]", "", stanzas[0][0].upper()) == tt and stanzas[0][0].upper() == stanzas[0][0]:
        stanzas[0] = stanzas[0][1:] or None
        stanzas = [st for st in stanzas if st]
    # дата под стихотворением — короткая строка с годом в конце
    date = None
    if stanzas and len(stanzas[-1]) == 1 and re.fullmatch(r"[\d<>\[\]?.,\s—–\-IVXа-яё]{2,30}", stanzas[-1][0], re.I) and re.search(r"1[789]\d\d", stanzas[-1][0]):
        date = stanzas.pop()[0]
    if stanzas and len(stanzas[-1]) == 1 and re.fullmatch(r"<\d{4}>|\[?\d{4}\]?", stanzas[-1][0]):
        date = stanzas.pop()[0]
    # номера частей («I», «1.»), «* * *» оставляем строками
    text = "\n\n".join("\n".join(st) for st in stanzas)
    return text, date


def first_words(s, n=3):
    return [w for w in re.findall(r"[а-яa-z]+", s.lower().replace("ё", "е"))][:n]


def plausible(item, text):
    m = re.search(r"«([^»]+)»", item["title"])
    if not m:
        return True
    want = first_words(m.group(1))
    lines = [l for l in text.split("\n") if l.strip()][:5]
    return any(first_words(l, len(want)) == want for l in lines)


def resolve(item):
    tried = []
    over = json.load(open(OVERRIDE)) if os.path.exists(OVERRIDE) else {}
    ov = over.get(item["id"])
    all_blocks = isinstance(ov, dict) and ov.get("all")
    cands = [ov["page"] if isinstance(ov, dict) else ov] if ov else [item["ws"]]
    surname = item["author"].split()[-1]
    for title in cands:
        d = parse(title)
        tried.append(title)
        if d.get("missing"):
            continue
        text, date = poem_text(d["html"], all_blocks, item["title"])
        if text and len(text) > 80 and (ov or plausible(item, text)):
            return d["title"], text, date
        # страница-развилка: идём по ссылкам на версии в современной орфографии
        for link in d["links"]:
            if link.startswith(title.split(" (")[0]) and "/ДО" not in link and "(ДО)" not in link:
                d2 = parse(link)
                if not d2.get("missing"):
                    text, date = poem_text(d2["html"], all_blocks, item["title"])
                    if text and len(text) > 80 and "ѣ" not in text and plausible(item, text):
                        return d2["title"], text, date
    # поиск
    q = re.sub(r"[«»…*()!?.,]", " ", item["title"]) + " " + surname
    r = api(action="query", list="search", srsearch=q, srlimit=8, srnamespace=0)
    for h in r["query"]["search"]:
        t = h["title"]
        if surname[:5] not in t or "/ДО" in t or "(ДО)" in t:
            continue
        d = parse(t)
        if d.get("missing"):
            continue
        text, date = poem_text(d["html"], False, item["title"])
        if text and len(text) > 80 and "ѣ" not in text and plausible(item, text):
            return d["title"], text, date
    return None, None, None


def main():
    out, missing = [], []
    for item in P:
        rec = {"id": item["id"], "author": item["author"], "title": item["title"], "themes": item["themes"]}
        if item["pd"]:
            src, text, date = resolve(item)
            if not text:
                missing.append(item["id"])
                print("!! не найдено:", item["id"], item["ws"])
                continue
            rec.update(text=text, src="https://ru.wikisource.org/wiki/" + urllib.parse.quote(src.replace(" ", "_")))
            if date:
                rec["date"] = date
            first = text.split("\n")[0]
            nlines = sum(1 for l in text.split("\n") if l.strip())
            print(f"   {item['id']:28} ← {src} | {first[:45]} | {nlines} стр.")
        else:
            rec["pd"] = False
        if item.get("wiki"):
            rec["wiki"] = item["wiki"]
        out.append(rec)
    path = os.path.join(SITE, "js", "library-data", "poems.json")
    json.dump({"themes": [{"id": a, "title": b} for a, b in THEMES], "poems": out}, open(path, "w"), ensure_ascii=False, indent=1)
    print("стихов:", len(out), "без текста:", missing)


if __name__ == "__main__":
    main()
