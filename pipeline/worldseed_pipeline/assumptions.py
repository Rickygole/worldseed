"""assumptions.yaml -> data/snapshot/assumptions.json (contract section 2.3)."""
from __future__ import annotations

import json

import yaml

from . import config


def run() -> list[dict]:
    doc = yaml.safe_load(config.ASSUMPTIONS_YAML.read_text())
    out = []
    for a in doc["assumptions"]:
        assert a["status"] in ("assumption", "sourced"), a["id"]
        rec = {"id": a["id"], "label": a["label"], "value": a["value"], "unit": a.get("unit"),
               "status": a["status"], "source": a.get("source")}
        for k in ("min", "max"):
            if k in a:
                rec[k] = a[k]
        if a.get("note"):
            rec["note"] = " ".join(str(a["note"]).split())
        out.append(rec)
    (config.SNAP / "assumptions.json").write_text(json.dumps(out, indent=1) + "\n")
    print(f"assumptions.json: {len(out)} entries")
    return out


if __name__ == "__main__":
    run()
