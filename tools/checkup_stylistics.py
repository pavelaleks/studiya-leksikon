# -*- coding: utf-8 -*-
"""Чекап карточек стилистики и связанных заданий."""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARK = re.compile(r"\{([^{}|]+)(?:\|([prseoxz]))?\}")
OK_TYPES = set("prseoxz")


def walk_strings(obj, path=""):
    if isinstance(obj, str):
        yield path, obj
    elif isinstance(obj, dict):
        for k, v in obj.items():
            yield from walk_strings(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk_strings(v, f"{path}[{i}]")


def leftover_braces(text):
    stripped = MARK.sub("", text)
    return "{" in stripped or "}" in stripped


def main():
    errors = []
    warns = []
    stil = json.loads((ROOT / "data" / "stylistics.json").read_text(encoding="utf-8"))
    exercises = json.loads((ROOT / "data" / "exercises.json").read_text(encoding="utf-8"))

    if stil.get("status") != "ready":
        errors.append("status должен быть ready")

    rules = []
    for ch in stil["chapters"]:
        for r in ch["rules"]:
            rules.append((ch, r))

    if len(rules) != 75:
        errors.append(f"ожидали 75 карточек, получили {len(rules)}")

    paras = [r["rosenthal"]["paragraph"] for _, r in rules]
    if paras != list(range(139, 214)):
        errors.append(f"параграфы не подряд 139–213: {paras[:3]}…{paras[-3:]}")

    ids = [r["id"] for _, r in rules]
    slugs = [r["slug"] for _, r in rules]
    if len(ids) != len(set(ids)):
        errors.append("повторяются id")
    if len(slugs) != len(set(slugs)):
        errors.append("повторяются slug")

    for ch, r in rules:
        if not r.get("summary"):
            errors.append(f"{r['id']}: нет summary")
        if not r.get("theory"):
            errors.append(f"{r['id']}: нет theory")
        has_ex = any(block.get("examples") or block.get("table") for block in r.get("theory") or [])
        if not has_ex:
            errors.append(f"{r['id']}: нет примеров и таблицы")
        for block in r.get("theory") or []:
            table = block.get("table")
            if table:
                n = len(table.get("headers") or [])
                for i, row in enumerate(table.get("rows") or []):
                    if len(row) != n:
                        errors.append(f"{r['id']}: таблица ряд {i} длины {len(row)} ≠ {n}")

    for path, text in walk_strings(stil):
        if leftover_braces(text):
            errors.append(f"лишние скобки в {path}: {text[:80]}")
        for m in MARK.finditer(text):
            kind = m.group(2)
            if kind and kind not in OK_TYPES:
                errors.append(f"плохой тип разметки {kind} в {path}")

    rule_ids = {r["id"] for _, r in rules}
    stil_ex = [ex for ex in exercises if ex.get("section") == "stylistics"]
    if len(stil_ex) < 8:
        errors.append(f"мало заданий стилистики: {len(stil_ex)}")
    for ex in stil_ex:
        refs = [ex.get("ruleId")] + list(ex.get("ruleIds") or [])
        for rid in refs:
            if rid and rid not in rule_ids:
                errors.append(f"задание {ex['id']} ссылается на нет {rid}")
        if ex["type"] == "choice":
            for i, item in enumerate(ex.get("items") or []):
                if item["answer"] < 0 or item["answer"] >= len(item["choices"]):
                    errors.append(f"{ex['id']} вопрос {i}: answer вне диапазона")
                if len(set(item["choices"])) != len(item["choices"]):
                    warns.append(f"{ex['id']} вопрос {i}: одинаковые варианты")
        if ex["type"] in ("copy", "insert"):
            gaps = re.findall(r"\{\{(.*?)\}\}", ex.get("template") or "")
            if not gaps:
                errors.append(f"{ex['id']}: нет пропусков")

    # Нормы, которые нельзя перепутать в карточках
    blob = json.dumps(stil, ensure_ascii=False)
    if "{{о}}зарилось" in blob or "{о}зарилось" in blob:
        errors.append("пропуск/выделение в приставке озариться")
    checks = [
        ("согласно приказу", "дательный согласно"),
        ("класть", "класть как норма"),
        ("сумею победить", "описательная форма победить"),
        ("две девушки", "не двое девушек как норма"),
        ("такси", "такси в карточках"),
    ]
    for needle, label in checks:
        if needle not in blob:
            warns.append(f"в карточках не найдено ожидание: {label} ({needle})")

    # Задания: единственный верный ответ там, где обещали
    for ex in stil_ex:
        if ex["id"] == "ex-stil-word-choice":
            item = ex["items"][0]
            if "надеть куртку" not in item["choices"][item["answer"]]:
                errors.append("тест одеть/надеть: не тот ответ")
        if ex["id"] == "ex-stil-gerund":
            if ex["items"][0]["answer"] != 1:
                errors.append("тест деепричастия: ожидался второй вариант")

    print(f"карточек: {len(rules)}; заданий стилистики: {len(stil_ex)}")
    for w in warns:
        print("WARN:", w)
    if errors:
        print("ERRORS:")
        for e in errors:
            print(" -", e)
        sys.exit(1)
    print("OK")


if __name__ == "__main__":
    main()
