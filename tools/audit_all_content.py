# -*- coding: utf-8 -*-
"""Full audit of OGE trainers + EGE tasks. Writes tools/_audit_full_report.json."""
from __future__ import annotations

import importlib.util
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tools" / "_audit_full_report.json"

spec = importlib.util.spec_from_file_location("basis", ROOT / "tools" / "build_basis_trainer.py")
basis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(basis)


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def audit_basis() -> dict:
    data = load(ROOT / "js" / "trainers-data" / "trenazher-osnova-leksikon.json")
    issues = []
    stats = Counter()
    for ex in data["exercises"]:
        opts = ex.get("options") or []
        correct = [o for o in opts if o.get("correct")]
        answer = set(str(ex.get("answer") or ""))
        correct_ids = {str(o["id"]) for o in correct}
        if answer != correct_ids:
            issues.append(
                {
                    "sev": "high",
                    "id": ex["id"],
                    "kind": "answer_vs_flags",
                    "detail": f"answer={ex.get('answer')} flags={''.join(sorted(correct_ids))}",
                }
            )
        if len(opts) != 5:
            issues.append({"sev": "high", "id": ex["id"], "kind": "opt_count", "detail": len(opts)})
        if len(ex.get("sentences") or []) < 3:
            issues.append(
                {
                    "sev": "med",
                    "id": ex["id"],
                    "kind": "few_sentences",
                    "detail": len(ex.get("sentences") or []),
                }
            )
        for o in opts:
            if not o.get("correct"):
                continue
            stats["correct_opts"] += 1
            v = o.get("visual")
            if not v:
                issues.append(
                    {"sev": "high", "id": ex["id"], "kind": "missing_visual", "opt": o["id"], "label": o["label"]}
                )
                continue
            stats["visuals"] += 1
            words = v.get("words") or []
            s_idx = v.get("subject") or []
            p_idx = v.get("predicate") or []
            if not s_idx and not p_idx:
                issues.append(
                    {"sev": "high", "id": ex["id"], "kind": "empty_spans", "opt": o["id"], "label": o["label"]}
                )
                continue
            # indices in range
            for name, idxs in (("subject", s_idx), ("predicate", p_idx)):
                for i in idxs:
                    if i < 0 or i >= len(words):
                        issues.append(
                            {
                                "sev": "high",
                                "id": ex["id"],
                                "kind": "bad_index",
                                "opt": o["id"],
                                "detail": f"{name}={i} len={len(words)}",
                            }
                        )
            s_toks = [words[i] for i in s_idx]
            p_toks = [words[i] for i in p_idx]
            how = v.get("predicateHow") or ""
            null = bool(v.get("nullCopula"))
            has_fin = any(basis.is_finite_verb(t) for t in p_toks)
            # verb + null (except copula)
            if null and has_fin and not any(
                basis._norm_tok(t) in {"был", "была", "было", "были", "есть", "стал", "стала", "стали", "является"}
                for t in p_toks
            ):
                issues.append(
                    {
                        "sev": "high",
                        "id": ex["id"],
                        "kind": "verb_with_null",
                        "opt": o["id"],
                        "label": o["label"],
                        "pred": p_toks,
                        "how": how,
                    }
                )
                stats["verb_with_null"] += 1
            # short form called verbal
            if "глагольн" in how and p_toks and not has_fin:
                issues.append(
                    {
                        "sev": "high",
                        "id": ex["id"],
                        "kind": "nominal_called_verb",
                        "opt": o["id"],
                        "label": o["label"],
                        "pred": p_toks,
                        "how": how,
                    }
                )
                stats["nominal_called_verb"] += 1
            # short adj/part without null
            if (
                p_toks
                and not has_fin
                and any(
                    re.search(r"(ен|ён|ан|ян|он|на|но|ны)$", basis._norm_tok(t))
                    or basis.is_short_nominal_strict(t)
                    for t in p_toks
                )
                and not null
                and "—" not in o["label"]
            ):
                # может быть ок для односоставных без подлежащего; пометим medium
                issues.append(
                    {
                        "sev": "med",
                        "id": ex["id"],
                        "kind": "nominal_without_null",
                        "opt": o["id"],
                        "label": o["label"],
                        "pred": p_toks,
                        "how": how,
                    }
                )
            # subject/predicate text vs highlights (compare token sets, not raw strings)
            subj_expect = basis.phrase_tokens(v.get("subjectText") or "")
            pred_expect = [t for t in basis.phrase_tokens(v.get("predicateText") or "") if t != "и"]
            s_norms = [basis._norm_tok(x) for x in s_toks]
            p_norms = [basis._norm_tok(x) for x in p_toks]
            if subj_expect and s_norms and sorted(subj_expect) != sorted(s_norms):
                # allow missing dots in initials: а с пушкин vs ас пушкин
                if not set(subj_expect).issubset(set(s_norms)) and not set(s_norms).issubset(set(subj_expect)):
                    issues.append(
                        {
                            "sev": "high",
                            "id": ex["id"],
                            "kind": "subj_text_mismatch",
                            "opt": o["id"],
                            "label": o["label"],
                            "highlighted": s_toks,
                            "subjectText": v.get("subjectText"),
                        }
                    )
            if pred_expect and p_norms and not set(pred_expect).issubset(set(p_norms)):
                issues.append(
                    {
                        "sev": "med",
                        "id": ex["id"],
                        "kind": "pred_text_mismatch",
                        "opt": o["id"],
                        "label": o["label"],
                        "highlighted": p_toks,
                        "predicateText": v.get("predicateText"),
                    }
                )
            # null marker points outside / after wrong token
            na = v.get("nullCopulaAfter")
            if null and na is not None:
                if na < 0 or na >= len(words):
                    issues.append(
                        {
                            "sev": "high",
                            "id": ex["id"],
                            "kind": "bad_null_after",
                            "opt": o["id"],
                            "detail": na,
                        }
                    )
                elif s_idx and p_idx and not (min(s_idx) <= na < max(p_idx + s_idx)):
                    # soft check
                    pass
            if null:
                stats["nulls"] += 1
            if has_fin:
                stats["verbal_preds"] += 1
            elif p_toks:
                stats["nominal_preds"] += 1

    high = [i for i in issues if i["sev"] == "high"]
    med = [i for i in issues if i["sev"] == "med"]
    return {
        "exercises": data["count"],
        "stats": dict(stats),
        "high": len(high),
        "med": len(med),
        "issues_high": high[:80],
        "issues_med": med[:40],
        "kinds": dict(Counter(i["kind"] for i in issues)),
    }


def audit_nn() -> dict:
    data = load(ROOT / "js" / "trainers-data" / "trenazher-n-nn-leksikon.json")
    issues = []
    for i, ex in enumerate(data.get("exercises") or []):
        eid = f"nn-{i+1:03d}"
        ans = (ex.get("answer") or "").lower().replace("ё", "е")
        if ans not in {"н", "нн"}:
            issues.append({"sev": "high", "id": eid, "kind": "bad_answer", "detail": ex.get("answer")})
        phrase = ex.get("phrase") or ""
        if "___" not in phrase:
            issues.append({"sev": "high", "id": eid, "kind": "no_gap", "phrase": phrase})
        word = ex.get("word") or ""
        if not word:
            issues.append({"sev": "med", "id": eid, "kind": "no_word"})
        # answer consistency with word: count н/нн in suffix near gap roughly
        if word and ans in {"н", "нн"}:
            # normalize: ветреный should have one н between е and ы roughly
            low = word.lower().replace("ё", "е")
            if ans == "нн" and "нн" not in low and not re.search(r"нн", low):
                # soft: some words like «стеклянный»
                if "нн" not in low:
                    issues.append(
                        {"sev": "med", "id": eid, "kind": "answer_vs_word", "answer": ans, "word": word}
                    )
            if ans == "н" and "нн" in low:
                # could be wrong data
                issues.append(
                    {"sev": "med", "id": eid, "kind": "single_n_but_word_has_nn", "answer": ans, "word": word}
                )
        if not (ex.get("comment") or "").strip():
            issues.append({"sev": "low", "id": eid, "kind": "no_comment", "word": word})
    return {
        "count": data.get("count") or len(data.get("exercises") or []),
        "high": sum(1 for i in issues if i["sev"] == "high"),
        "med": sum(1 for i in issues if i["sev"] == "med"),
        "kinds": dict(Counter(i["kind"] for i in issues)),
        "issues_high": [i for i in issues if i["sev"] == "high"][:40],
        "issues_med": [i for i in issues if i["sev"] == "med"][:40],
    }


def audit_oborotov() -> dict:
    data = load(ROOT / "js" / "trainers-data" / "trenazher-oborotov-leksikon.json")
    issues = []
    for i, ex in enumerate(data.get("exercises") or []):
        eid = f"ob-{i+1:03d}"
        words = ex.get("words") or []
        commas = ex.get("commas") or []
        if not words:
            issues.append({"sev": "high", "id": eid, "kind": "no_words"})
            continue
        for c in commas:
            if not isinstance(c, int) or c < 0 or c >= len(words):
                issues.append({"sev": "high", "id": eid, "kind": "bad_comma_idx", "detail": c, "len": len(words)})
        phrase = ex.get("phrase") or ""
        if phrase:
            # phrase words should appear as contiguous subsequence
            pw = phrase.split()
            joined = " ".join(words)
            if " ".join(pw) not in joined and phrase not in joined:
                # try casefold
                if " ".join(pw).lower() not in joined.lower():
                    issues.append(
                        {
                            "sev": "med",
                            "id": eid,
                            "kind": "phrase_not_in_words",
                            "phrase": phrase,
                            "sentence": joined,
                        }
                    )
        ptype = ex.get("phraseType") or ""
        if ptype not in {"participle", "gerund", ""}:
            issues.append({"sev": "low", "id": eid, "kind": "odd_phrase_type", "detail": ptype})
        # typically обороты need commas; empty may be intentional for "не обособляется"
        if not commas and "не" not in (ex.get("comment") or "").lower():
            issues.append({"sev": "low", "id": eid, "kind": "no_commas", "sentence": " ".join(words)})
    return {
        "count": data.get("count") or len(data.get("exercises") or []),
        "high": sum(1 for i in issues if i["sev"] == "high"),
        "med": sum(1 for i in issues if i["sev"] == "med"),
        "kinds": dict(Counter(i["kind"] for i in issues)),
        "issues_high": [i for i in issues if i["sev"] == "high"][:40],
        "issues_med": [i for i in issues if i["sev"] == "med"][:40],
    }


def audit_ege() -> dict:
    issues = []
    by_task = {}
    required = {"id", "egeTask", "type", "answer"}
    for n in range(4, 23):
        if n == 23:
            continue
        path = ROOT / "data" / "ege" / f"task-{n:02d}.json"
        if not path.exists():
            issues.append({"sev": "high", "id": f"task-{n}", "kind": "missing_file"})
            continue
        items = load(path)
        by_task[n] = len(items)
        seen_ids = set()
        for ex in items:
            eid = ex.get("id") or "?"
            if eid in seen_ids:
                issues.append({"sev": "high", "id": eid, "kind": "dup_id", "task": n})
            seen_ids.add(eid)
            for k in required:
                if k not in ex or ex[k] in (None, ""):
                    issues.append({"sev": "high", "id": eid, "kind": "missing_field", "field": k, "task": n})
            if ex.get("egeTask") != n:
                issues.append(
                    {
                        "sev": "high",
                        "id": eid,
                        "kind": "egeTask_mismatch",
                        "task": n,
                        "egeTask": ex.get("egeTask"),
                    }
                )
            ans = ex.get("answer")
            if isinstance(ans, str) and not ans.strip():
                issues.append({"sev": "high", "id": eid, "kind": "empty_answer", "task": n})
            if isinstance(ans, list) and not ans:
                issues.append({"sev": "high", "id": eid, "kind": "empty_answer_list", "task": n})
            # instruction / stimulus emptiness
            if not (ex.get("instruction") or "").strip() and not (ex.get("stimulus") or "").strip():
                if not (ex.get("text") or "").strip() and not (ex.get("lines") or []):
                    issues.append({"sev": "med", "id": eid, "kind": "no_prompt", "task": n})
            # lines expected only when this format uses them
            has_prompt = bool(
                (ex.get("lines") or [])
                or (ex.get("text") or "").strip()
                or (ex.get("stimulus") or "").strip()
                or (ex.get("left") or [])
                or (ex.get("right") or [])
            )
            if not has_prompt:
                issues.append({"sev": "med", "id": eid, "kind": "no_prompt", "task": n})
            # stress answers (task 4)
            if n == 4 and ex.get("answerMode") == "stress":
                a = str(ans or "")
                if a and not re.search(r"[АЕЁИОУЫЭЮЯ]", a):
                    issues.append(
                        {
                            "sev": "med",
                            "id": eid,
                            "kind": "stress_no_caps",
                            "answer": a,
                            "task": n,
                        }
                    )
            # explanation missing
            if not (ex.get("explanation") or ex.get("comment") or "").strip():
                issues.append({"sev": "low", "id": eid, "kind": "no_explanation", "task": n})
            # glued OCR-ish text
            blob = " ".join(
                str(ex.get(k) or "")
                for k in ("instruction", "text", "stimulus", "explanation")
            )
            if re.search(r"[а-яё]{25,}", blob.lower()):
                # long token may be missing spaces
                issues.append(
                    {
                        "sev": "low",
                        "id": eid,
                        "kind": "possible_glued_text",
                        "task": n,
                    }
                )
            if "\u00ad" in blob or "\u2060" in blob:
                issues.append({"sev": "med", "id": eid, "kind": "soft_hyphen_or_wj", "task": n})

    # expected 40 per task currently
    uneven = {k: v for k, v in by_task.items() if v != 40}
    return {
        "tasks": by_task,
        "total": sum(by_task.values()),
        "uneven_counts": uneven,
        "high": sum(1 for i in issues if i["sev"] == "high"),
        "med": sum(1 for i in issues if i["sev"] == "med"),
        "low": sum(1 for i in issues if i["sev"] == "low"),
        "kinds": dict(Counter(i["kind"] for i in issues)),
        "issues_high": [i for i in issues if i["sev"] == "high"][:60],
        "issues_med": [i for i in issues if i["sev"] == "med"][:60],
        "by_task_high": dict(
            Counter(i.get("task") for i in issues if i["sev"] == "high" and "task" in i)
        ),
    }


def main():
    report = {
        "basis": audit_basis(),
        "nn": audit_nn(),
        "oborotov": audit_oborotov(),
        "ege": audit_ege(),
    }
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    # console summary
    print("=== BASIS ===")
    b = report["basis"]
    print(f"exercises={b['exercises']} high={b['high']} med={b['med']} kinds={b['kinds']}")
    for i in b["issues_high"][:15]:
        print(" H", i.get("kind"), i.get("id"), i.get("label") or i.get("detail") or i.get("opt"))
    print("=== NN ===")
    n = report["nn"]
    print(f"count={n['count']} high={n['high']} med={n['med']} kinds={n['kinds']}")
    for i in n["issues_high"][:10]:
        print(" H", i)
    print("=== OBOROTOV ===")
    o = report["oborotov"]
    print(f"count={o['count']} high={o['high']} med={o['med']} kinds={o['kinds']}")
    for i in o["issues_high"][:10]:
        print(" H", i)
    print("=== EGE ===")
    e = report["ege"]
    print(f"total={e['total']} high={e['high']} med={e['med']} low={e['low']} kinds={e['kinds']}")
    print("uneven", e["uneven_counts"])
    for i in e["issues_high"][:20]:
        print(" H", i)
    print("wrote", OUT)


if __name__ == "__main__":
    main()
