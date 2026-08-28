"""Проверка банка ЕГЭ: 40×19 (задания 4–22), ключи, форма ответа."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1] / "data" / "ege"
VOWELS = set("аеёиоуыэюяАЕЁИОУЫЭЮЯ")


def main() -> None:
    files = sorted(ROOT.glob("task-*.json"))
    if len(files) != 19:
        raise SystemExit(f"файлов {len(files)}, нужно 19")
    ids: list[str] = []
    problems: list[str] = []
    for path in files:
        items = json.loads(path.read_text(encoding="utf-8"))
        n = int(path.stem.split("-")[1])
        if len(items) != 40:
            problems.append(f"{path.name}: {len(items)} шт.")
        for it in items:
            ids.append(it["id"])
            if it.get("egeTask") != n:
                problems.append(f"{it['id']}: egeTask")
            ans = str(it.get("answer", "")).strip()
            if not ans:
                problems.append(f"{it['id']}: пустой ключ")
            mode = it.get("answerMode")
            if mode in ("digits-any", "digits-fixed"):
                digits = "".join(ch for ch in ans if ch.isdigit())
                if digits != ans.replace(" ", ""):
                    problems.append(f"{it['id']}: в ключе не только цифры ({ans})")
                if n in (8, 22) and len(digits) != 5:
                    problems.append(f"{it['id']}: соответствие не 5 цифр ({ans})")
                if n in (8, 22) and len(set(digits)) != 5:
                    problems.append(f"{it['id']}: повтор цифр в соответствии ({ans})")
                if n == 22:
                    if len(it.get("left") or []) != 5 or len(it.get("right") or []) != 9:
                        problems.append(f"{it['id']}: форма 22 не 5+9")
            expl = str(it.get("explanation") or "")
            if re.search(r"[A-Za-z]{3,}", expl):
                problems.append(f"{it['id']}: латиница в пояснении")
            if n == 15:
                blob = " ".join(it.get("lines") or [])
                if re.search(r"(?:^|,\s)(?:ю|зеле|си|бара|воро|пря|румя)\.\.", blob):
                    problems.append(f"{it['id']}: дыра Н/НН похожа на пропуск гласной")
            if mode == "stress":
                if not any(ch in VOWELS and ch == ch.upper() and ch != ch.lower() for ch in ans):
                    problems.append(f"{it['id']}: нет заглавной гласной ({ans})")
            if it["type"] not in ("ege-short", "ege-match"):
                problems.append(f"{it['id']}: тип {it['type']}")
    if len(ids) != len(set(ids)):
        problems.append("повтор id")
    if len(ids) != 760:
        problems.append(f"всего {len(ids)}, нужно 760")
    if problems:
        print("\n".join(problems[:40]))
        raise SystemExit(f"ошибок: {len(problems)}")
    print("ok: 19 файлов, 760 заданий, ключи на месте")


if __name__ == "__main__":
    main()
