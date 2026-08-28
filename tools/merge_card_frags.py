# -*- coding: utf-8 -*-
"""Сборка фрагментов карточек в data/orthography.json и data/punctuation.json."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TOOLS = ROOT / "tools"


def load_frag(name):
    p = TOOLS / name
    if not p.exists():
        raise SystemExit(f"нет фрагмента {p}")
    data = json.loads(p.read_text(encoding="utf-8"))
    if isinstance(data, dict) and "chapters" in data:
        return data["chapters"]
    if isinstance(data, list):
        return data
    raise SystemExit(f"непонятный формат {name}")


def wrap(section_id, title, lead, chapters):
    return {
        "id": section_id,
        "title": title,
        "status": "ready",
        "lead": lead,
        "chapters": chapters,
    }


def counts(chapters):
    rules = sum(len(ch.get("rules") or []) for ch in chapters)
    blocks = sum(len(r.get("theory") or []) for ch in chapters for r in ch.get("rules") or [])
    return rules, blocks


def main():
    ortho_ch = load_frag("frag_ortho_1_26.json") + load_frag("frag_ortho_27_end.json")
    punct_ch = load_frag("frag_punct_1_36.json") + load_frag("frag_punct_37_72.json")
    ortho = wrap(
        "orthography",
        "Орфография",
        "Правописание по справочнику студии: каждый параграф — полная карточка со всеми пунктами, примечаниями и исключениями.",
        ortho_ch,
    )
    punct = wrap(
        "punctuation",
        "Пунктуация",
        "Знаки препинания по главам XX–XXXVI: все условия постановки и отсутствия знака — отдельными пунктами на карточке.",
        punct_ch,
    )
    (DATA / "orthography.json").write_text(json.dumps(ortho, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (DATA / "punctuation.json").write_text(json.dumps(punct, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    or_, ob = counts(ortho_ch)
    pr, pb = counts(punct_ch)
    print(f"orthography rules={or_} blocks={ob}")
    print(f"punctuation rules={pr} blocks={pb}")


if __name__ == "__main__":
    main()
