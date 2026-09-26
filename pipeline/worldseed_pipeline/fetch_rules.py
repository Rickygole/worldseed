"""Fetch and check the MDTA page that states the hazmat tunnel prohibition (source of A-HAZMAT-TUNNELS).

Cached in data/raw/. The build fails if the page no longer contains the statement, so the `sourced` status of the
assumption cannot silently go stale. Only the check result (URL, date, matched sentence) is kept in interim data;
no page text is written to data/snapshot/.
"""
from __future__ import annotations

import html
import json
import re

from . import config, netutil

URL = "https://mdta.maryland.gov/TunnelRestrictionsAndVehiclePermits"
FILE = "mdta_tunnel_restrictions.html"
NEEDLE = re.compile(r"prohibited from using the Fort McHenry Tunnel \(I-95\) or the Baltimore Harbor Tunnel \(I-895\)", re.I)


def run() -> dict:
    p = netutil.http_get(URL, FILE, timeout=60)
    text = p.read_text(encoding="utf-8", errors="ignore")
    text = re.sub(r"<script.*?</script>|<style.*?</style>", "", text, flags=re.S)
    text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text)))
    m = NEEDLE.search(text)
    if not m:
        raise RuntimeError(f"MDTA page {URL} no longer states the tunnel hazmat prohibition; review A-HAZMAT-TUNNELS")
    import datetime as dt
    rec = {"url": URL, "accessed": dt.datetime.fromtimestamp(p.stat().st_mtime, dt.timezone.utc).strftime("%Y-%m-%d"),
           "statementFound": True, "cites": "COMAR Title 11, Subtitle 7, Chapter 1 (11.07.01)" if "11.07.01" in text else None}
    (config.RAW / "interim").mkdir(parents=True, exist_ok=True)
    (config.RAW / "interim" / "hazmat_rule_check.json").write_text(json.dumps(rec, indent=1))
    print(f"MDTA hazmat statement found on {URL} (accessed {rec['accessed']}); cites {rec['cites']}")
    return rec


if __name__ == "__main__":
    run()
