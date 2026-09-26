"""Polite Overpass client with on-disk cache and backoff."""
import hashlib, json, os, time
import requests

RAW = "/Users/rickygole/worldseed/data/raw"
ENDPOINTS = ["https://overpass-api.de/api/interpreter",
             "https://overpass.private.coffee/api/interpreter"]
UA = "worldseed-feasibility-spike/0.1 (hackathon prototype)"

def query(q, name, timeout=300):
    os.makedirs(RAW, exist_ok=True)
    path = os.path.join(RAW, name)
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    for attempt in range(6):
        ep = ENDPOINTS[attempt % len(ENDPOINTS)] if attempt >= 3 else ENDPOINTS[0]
        try:
            r = requests.post(ep, data={"data": q}, headers={"User-Agent": UA}, timeout=timeout)
        except requests.RequestException as e:
            print("request error", ep, e); time.sleep(10 * 2 ** attempt); continue
        if r.status_code == 200:
            try:
                js = r.json()
            except ValueError:
                print("non-json 200:", r.text[:300]); time.sleep(10); continue
            with open(path, "w") as f:
                json.dump(js, f)
            return js
        print("HTTP", r.status_code, ep, r.text[:200].replace("\n", " "))
        if r.status_code in (429, 504, 502, 503):
            time.sleep(15 * 2 ** attempt); continue
        r.raise_for_status()
    raise RuntimeError("Overpass failed after retries")
