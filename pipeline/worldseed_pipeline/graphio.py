"""graph.bin / graph.meta.json reader and writer (contract section 2.2).

Layout: little-endian, buffers concatenated in BUFFER_ORDER, each buffer starts at an offset that is a
multiple of 8 (zero padding between), so a JS client can build typed arrays directly on the fetched
ArrayBuffer: new Float32Array(buf, offset, length).  `length` in meta is an ELEMENT count.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from . import binio, config

DTYPES = binio.DTYPES

# (name, type, count-kind)  count-kind: N nodes, E edges, N1 = N+1
BUFFER_ORDER = [
    ("nodeOsmId", "f64", "N"),
    ("edgeOsmWay", "f64", "E"),
    ("nodeLon", "f32", "N"),
    ("nodeLat", "f32", "N"),
    ("edgeFrom", "u32", "E"),
    ("edgeTo", "u32", "E"),
    ("edgeTimeS", "f32", "E"),
    ("edgeLenM", "f32", "E"),
    ("edgeCorridor", "u16", "E"),
    ("edgeClass", "u8", "E"),
    ("edgeFlags", "u8", "E"),
    ("fwdOff", "u32", "N1"),
    ("fwdEdge", "u32", "E"),
    ("revOff", "u32", "N1"),
    ("revEdge", "u32", "E"),
]


@dataclass
class Graph:
    nodeOsmId: np.ndarray
    nodeLon: np.ndarray
    nodeLat: np.ndarray
    edgeFrom: np.ndarray
    edgeTo: np.ndarray
    edgeTimeS: np.ndarray
    edgeLenM: np.ndarray
    edgeClass: np.ndarray
    edgeFlags: np.ndarray
    edgeCorridor: np.ndarray
    edgeOsmWay: np.ndarray
    fwdOff: np.ndarray
    fwdEdge: np.ndarray
    revOff: np.ndarray
    revEdge: np.ndarray
    meta: dict = field(default_factory=dict)

    @property
    def n(self) -> int:
        return len(self.nodeLon)

    @property
    def e(self) -> int:
        return len(self.edgeFrom)


def build_csr(edge_from: np.ndarray, edge_to: np.ndarray, n: int) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Forward and reverse CSR over canonical edge indices. Stable sort => deterministic."""
    fo = np.argsort(edge_from, kind="stable").astype(np.uint32)
    fwd_off = np.zeros(n + 1, dtype=np.uint32)
    np.cumsum(np.bincount(edge_from, minlength=n), out=fwd_off[1:])
    ro = np.argsort(edge_to, kind="stable").astype(np.uint32)
    rev_off = np.zeros(n + 1, dtype=np.uint32)
    np.cumsum(np.bincount(edge_to, minlength=n), out=rev_off[1:])
    return fwd_off, fo, rev_off, ro


def write_graph(g: Graph, meta: dict, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    counts = {"N": g.n, "E": g.e, "N1": g.n + 1}
    specs = []
    for name, typ, kind in BUFFER_ORDER:
        arr = getattr(g, name)
        assert len(arr) == counts[kind], (name, len(arr), counts[kind])
        specs.append((name, typ, arr))
    blob, buffers, total = binio.pack(specs)
    (out_dir / "graph.bin").write_bytes(blob)
    full = dict(meta)
    full.update({"nodeCount": g.n, "edgeCount": g.e, "buffers": buffers, "byteLength": total,
                 "littleEndian": True, "alignment": 8})
    (out_dir / "graph.meta.json").write_text(json.dumps(full, indent=1, sort_keys=False) + "\n")


def load_graph(snap: Path | None = None) -> Graph:
    snap = snap or config.SNAP
    meta = json.loads((snap / "graph.meta.json").read_text())
    raw = (snap / "graph.bin").read_bytes()
    kw = {}
    for name, typ, _ in BUFFER_ORDER:
        b = meta["buffers"][name]
        kw[name] = np.frombuffer(raw, dtype=DTYPES[typ], count=b["length"], offset=b["offset"]).copy()
    return Graph(meta=meta, **kw)
