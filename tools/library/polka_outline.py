"""Конспект статьи «Полки» для составления вопросов: вопрос раздела, номер блока, начало ответа.

python3 tools/library/polka_outline.py 509 515 ...  → печатает конспект (статьи кэшируются в _cache/polka)
"""
import html as H, os, re, sys, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "_cache", "polka")
UA = {"User-Agent": "Mozilla/5.0 (LeksikonStudyBot/1.0; educational)"}


def article(n):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{n}.html")
    if not os.path.exists(path):
        for i in range(5):
            try:
                data = urllib.request.urlopen(urllib.request.Request(f"https://polka.academy/articles/{n}", headers=UA), timeout=60).read()
                open(path, "wb").write(data)
                break
            except Exception:
                time.sleep(3 + 5 * i)
    return open(path, encoding="utf-8").read()


def text(s):
    s = re.sub(r'<span class="note">.*?</span>\s*</span>', "", s, flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", H.unescape(s)).strip()


def outline(n, size=420):
    s = article(n)
    out = []
    for m in re.finditer(r'data-index="(\d+)"><div class="VTxLd"><div class="_32kHv"><div class="_3j3bx _3oeB-">(.*?)</div><div class="_3j3bx D_7F2">(.*?)</div></div>', s, re.S):
        out.append((m.group(1), text(m.group(2)), text(m.group(3))[:size]))
    return out


if __name__ == "__main__":
    size = 420
    for n in sys.argv[1:]:
        print(f"######## {n}")
        for block, q, a in outline(n, size):
            print(f"[{block}] {q}\n    {a}")
