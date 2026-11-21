# -*- coding: utf-8 -*-
"""Скачивает каталог ОГЭ по литературе с lit-oge.sdamgia.ru (задания 1–5).

Разбор тот же, что у ЕГЭ (tools/fetch_lit_ege.py), меняются только адрес, кэш и папка банка.
Запуск из корня репозитория:
    python tools/fetch_lit_oge.py            # скачать и разобрать
    python tools/fetch_lit_oge.py --parse-only
Затем: python tools/build_lit_lists.py --oge  (лёгкие *.list.json).
Банк с ответами (js/literature-oge-data/bank, index.json) в git не попадает.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_lit_ege as core  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
core.BASE = "https://lit-oge.sdamgia.ru"
core.OUT = ROOT / "js" / "literature-oge-data"
core.CACHE = ROOT / "tools" / "_sdamgia_cache_litoge"
core.MEDIA = core.OUT / "media"

_answer_kind = core.answer_kind


def oge_answer_kind(task, title, question, answer):
    # В ОГЭ по литературе все задания письменные: 1–4 — развёрнутый ответ, 5 — сочинение.
    if task == 5:
        return "essay"
    if task in (1, 2, 3, 4):
        return "open"
    return _answer_kind(task, title, question, answer)


core.answer_kind = oge_answer_kind
core.file_key = lambda group, extra_index: f"oge-{group['task']:02d}" if group["kind"] == "ege" else f"extra-{extra_index:02d}"


def patch_manifest() -> None:
    import json

    path = core.OUT / "manifest.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["exam"] = "ОГЭ"
    data["source"].update(
        {
            "site": core.BASE + "/",
            "catalog": core.BASE + "/prob_catalog",
            "name": "Решу ОГЭ",
            "note": "Задания и пояснения собраны с lit-oge.sdamgia.ru для учебной базы студии «Лексикон». При размещении на сайте указывайте источник.",
        }
    )
    data["howToUse"]["bank"] = "bank/oge-01.json … oge-05.json — задания 1–5 ОГЭ (источник в базе — oge-lit)."
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--parse-only", action="store_true")
    args = parser.parse_args()
    core.build(args.parse_only)
    patch_manifest()


if __name__ == "__main__":
    main()
