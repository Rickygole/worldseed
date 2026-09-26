"""Polite cached HTTP helpers. Everything downloaded lands in data/raw/ and is never re-fetched."""
from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import requests

from . import config


def _log(msg: str) -> None:
    print(f"[net] {msg}", flush=True)


def http_get(url: str, name: str, *, params: dict | None = None, timeout: int = 300,
             headers: dict | None = None, retries: int = 5) -> Path:
    """GET url -> data/raw/<name> (cached). Backoff on 429/5xx. Returns the cached path."""
    config.RAW.mkdir(parents=True, exist_ok=True)
    path = config.RAW / name
    if path.exists() and path.stat().st_size > 0:
        return path
    hdr = {"User-Agent": config.HTTP_UA}
    hdr.update(headers or {})
    last = None
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers=hdr, timeout=timeout, allow_redirects=True)
        except requests.RequestException as e:
            last = repr(e)
            _log(f"{name}: request error {last}; retry {attempt + 1}")
            time.sleep(5 * 2 ** attempt)
            continue
        if r.status_code == 200 and r.content:
            path.write_bytes(r.content)
            return path
        last = f"HTTP {r.status_code}"
        _log(f"{name}: {last}")
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(10 * 2 ** attempt)
            continue
        break
    raise RuntimeError(f"download failed for {url}: {last}")


def overpass(query: str, name: str, *, timeout: int = 600) -> dict:
    """POST an Overpass query, cache the JSON result. One query at a time (callers are sequential).

    overpass-api.de answers attic queries with intermittent fast 504s (a backend refusing the request; the
    same query succeeds on a later try), so 502/503/504 are retried every ~20 s. A 429 backs off 30 s x 2^n.
    After 8 failed tries the fallback mirror is used for the remaining attempts.
    """
    config.RAW.mkdir(parents=True, exist_ok=True)
    path = config.RAW / name
    if path.exists() and path.stat().st_size > 0:
        return json.loads(path.read_text())
    for attempt in range(16):
        ep = config.OVERPASS_ENDPOINTS[0 if attempt < 8 else attempt % len(config.OVERPASS_ENDPOINTS)]
        try:
            r = requests.post(ep, data={"data": query}, headers={"User-Agent": config.HTTP_UA}, timeout=timeout)
        except requests.RequestException as e:
            _log(f"overpass {name}: request error {e!r}")
            time.sleep(20)
            continue
        if r.status_code == 200:
            try:
                js = r.json()
            except ValueError:
                _log(f"overpass {name}: non-JSON 200: {r.text[:200]!r}")
                time.sleep(20)
                continue
            if "runtime error" in js.get("remark", ""):
                _log(f"overpass {name}: remark {js['remark'][:200]}")
                time.sleep(30)
                continue
            path.write_text(json.dumps(js))
            _log(f"overpass {name}: {len(js.get('elements', []))} elements from {ep} (attempt {attempt + 1})")
            return js
        _log(f"overpass {name}: HTTP {r.status_code} from {ep} (attempt {attempt + 1})")
        if r.status_code == 429:
            time.sleep(30 * 2 ** min(attempt, 4))
        elif r.status_code in (502, 503, 504):
            time.sleep(20)
        else:
            r.raise_for_status()
    raise RuntimeError(f"Overpass failed after retries for {name}")


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
