"""Shared little-endian typed-buffer packing (8-byte aligned buffers, element-count lengths)."""
from __future__ import annotations

import numpy as np

DTYPES = {"f32": "<f4", "f64": "<f8", "u32": "<u4", "u16": "<u2", "u8": "u1"}


def pack(specs: list[tuple[str, str, np.ndarray]]) -> tuple[bytes, dict, int]:
    """specs: [(name, type, array)] -> (blob, buffers-meta, total bytes)."""
    buffers, blobs, pos = {}, [], 0
    for name, typ, arr in specs:
        a = np.ascontiguousarray(arr).astype(DTYPES[typ], copy=False)
        pad = (-pos) % 8
        if pad:
            blobs.append(b"\0" * pad)
            pos += pad
        buffers[name] = {"offset": pos, "length": int(len(a)), "type": typ}
        b = a.tobytes()
        blobs.append(b)
        pos += len(b)
    tail = (-pos) % 8
    if tail:
        blobs.append(b"\0" * tail)
        pos += tail
    return b"".join(blobs), buffers, pos


def unpack(raw: bytes, buffers: dict) -> dict[str, np.ndarray]:
    return {n: np.frombuffer(raw, dtype=DTYPES[b["type"]], count=b["length"], offset=b["offset"]).copy()
            for n, b in buffers.items()}
