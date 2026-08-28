# -*- coding: utf-8 -*-
import json
from pathlib import Path

d = json.loads(Path("tools/handbook_index.json").read_text(encoding="utf-8"))
lines = [
    f"# inventory",
    f"ortho {d['orthography_rules']} rules / {d['orthography_points']} pts",
    f"punct {d['punctuation_rules']} rules / {d['punctuation_points']} pts",
]
for r in d["orthography"]:
    lines.append(f"O {r['n']:02d} pts={r['point_count']:02d} {r['title']}")
lines.append("---")
for r in d["punctuation"]:
    lines.append(f"P {r['n']:02d} pts={r['point_count']:02d} {r['title']}")
Path("tools/inventory.md").write_text("\n".join(lines), encoding="utf-8")
print("ok", d["orthography_rules"], d["punctuation_rules"])
