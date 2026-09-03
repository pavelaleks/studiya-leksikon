"""Шифрует банк заданий для публичного репозитория.

В git уходит только data/bank.enc. Расшифровка — локально (файл .leksikon-bank-key)
и на GitHub Actions (секрет LEKSIKON_BANK_KEY).
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEY_FILE = ROOT / ".leksikon-bank-key"
ENC = ROOT / "data" / "bank.enc"
TAR = ROOT / "data" / "bank.tar.gz"

MEMBERS = [
    "data/ege",
    "data/exercises.json",
    "tools/build_ege_04_08.py",
    "tools/build_ege_09_15.py",
    "tools/build_ege_16_21.py",
    "tools/build_ege_22.py",
    "tools/build_ege_22_26.py",
    "tools/sanitize_ege_bank.py",
    "tools/check_ege_bank.py",
    "tools/ege_dump.py",
    "tools/ege_texts.py",
]


def openssl_bin() -> str:
    found = shutil.which("openssl")
    if found:
        return found
    git_ssl = Path(r"C:\Program Files\Git\usr\bin\openssl.exe")
    if git_ssl.exists():
        return str(git_ssl)
    raise SystemExit("нужен OpenSSL (на Windows обычно ставится вместе с Git)")


def load_key() -> str:
    key = os.environ.get("LEKSIKON_BANK_KEY", "").strip()
    if key:
        return key
    if KEY_FILE.exists():
        return KEY_FILE.read_text(encoding="utf-8").strip()
    raise SystemExit(
        "Нет ключа. Положите его в .leksikon-bank-key или в переменную LEKSIKON_BANK_KEY."
    )


def run_openssl(args: list[str], key: str) -> None:
    env = os.environ.copy()
    env["LEKSIKON_BANK_KEY"] = key
    subprocess.run([openssl_bin(), *args], check=True, env=env, cwd=ROOT)


def lock() -> None:
    missing = [m for m in MEMBERS if not (ROOT / m).exists()]
    if missing:
        raise SystemExit("нет файлов: " + ", ".join(missing))
    if TAR.exists():
        TAR.unlink()
    with tarfile.open(TAR, "w:gz") as tar:
        for rel in MEMBERS:
            tar.add(ROOT / rel, arcname=rel)
    ENC.parent.mkdir(parents=True, exist_ok=True)
    run_openssl(
        [
            "enc",
            "-aes-256-cbc",
            "-pbkdf2",
            "-iter",
            "200000",
            "-salt",
            "-in",
            str(TAR),
            "-out",
            str(ENC),
            "-pass",
            "env:LEKSIKON_BANK_KEY",
        ],
        load_key(),
    )
    TAR.unlink(missing_ok=True)
    print(f"записан {ENC.relative_to(ROOT)}")


def unlock() -> None:
    if not ENC.exists():
        raise SystemExit(f"нет {ENC.relative_to(ROOT)}")
    if TAR.exists():
        TAR.unlink()
    run_openssl(
        [
            "enc",
            "-d",
            "-aes-256-cbc",
            "-pbkdf2",
            "-iter",
            "200000",
            "-in",
            str(ENC),
            "-out",
            str(TAR),
            "-pass",
            "env:LEKSIKON_BANK_KEY",
        ],
        load_key(),
    )
    with tarfile.open(TAR, "r:gz") as tar:
        try:
            tar.extractall(ROOT, filter="data")
        except TypeError:
            tar.extractall(ROOT)
    TAR.unlink(missing_ok=True)
    print("банк заданий расшифрован")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "lock":
        lock()
    elif cmd == "unlock":
        unlock()
    else:
        raise SystemExit("usage: python tools/bank.py lock|unlock")


if __name__ == "__main__":
    main()
