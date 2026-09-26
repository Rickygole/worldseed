// Prototype TypeScript-equivalent benchmark: multi-source Dijkstra over the CSR graph exported by sim.py.
// Run: node bench.mjs   (V8, same engine family as Chrome; not a real browser/mobile measurement)
import { readFileSync } from "node:fs";
const D = new URL("./out/", import.meta.url).pathname;
const rd = (f, T) => { const b = readFileSync(D + f); return new T(b.buffer, b.byteOffset, b.byteLength / T.BYTES_PER_ELEMENT); };
const indptr = rd("js_indptr.bin", Int32Array), indices = rd("js_indices.bin", Int32Array), w0 = rd("js_weights.bin", Float32Array);
const sources = rd("js_sources.bin", Int32Array), kbSlots = rd("js_kb_slots.bin", Int32Array);
const meta = JSON.parse(readFileSync(D + "js_meta.json"));
const N = indptr.length - 1;
const dist = new Float64Array(N);
// binary heap with lazy deletion
const cap = indices.length + sources.length + 8;
const hk = new Float64Array(cap), hv = new Int32Array(cap);
function dijkstra(w) {
  dist.fill(Infinity); let n = 0;
  const push = (k, v) => { let i = n++; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= k) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = k; hv[i] = v; };
  for (const s of sources) { dist[s] = 0; push(0, s); }
  while (n > 0) {
    const k = hk[0], u = hv[0]; n--;
    if (n > 0) { const lk = hk[n], lv = hv[n]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && hk[c + 1] < hk[c]) c++; if (hk[c] >= lk) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; } hk[i] = lk; hv[i] = lv; }
    if (k > dist[u]) continue;
    for (let e = indptr[u]; e < indptr[u + 1]; e++) { const v = indices[e], nd = k + w[e]; if (nd < dist[v]) { dist[v] = nd; push(nd, v); } }
  }
}
const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
function time(f, n = 20) { const t = []; for (let i = 0; i < n; i++) { const s = performance.now(); f(); t.push(performance.now() - s); } return med(t); }
for (let i = 0; i < 20; i++) dijkstra(w0); // warm-up JIT
const wr = new Float32Array(w0); for (const s of kbSlots) wr[s] = Infinity;
console.log(`nodes ${N} edges ${indices.length} sources ${sources.length}`);
console.log("baseline median ms", time(() => dijkstra(w0)).toFixed(3));
dijkstra(w0); let sum = 0; for (let i = 0; i < N; i++) sum += 1 + dist[i] / 60;
console.log("check: sum of (1 + t/60) over nodes JS", sum.toFixed(3), "python", meta.ref_baseline_sum_min.toFixed(3));
console.log("bridge-removed median ms", time(() => dijkstra(wr)).toFixed(3));
// Monte Carlo 200 futures, lognormal sigma .25 per edge
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const wm = new Float32Array(w0.length);
let s0 = performance.now();
for (let f = 0; f < 200; f++) { for (let e = 0; e < w0.length; e++) wm[e] = w0[e] * Math.exp(0.25 * gauss()); dijkstra(wm); }
console.log("200-future MC (one scenario, incl. multiplier generation) total ms", (performance.now() - s0).toFixed(1));
s0 = performance.now();
for (let f = 0; f < 200; f++) { for (let e = 0; e < w0.length; e++) wm[e] = w0[e] * Math.exp(0.25 * gauss()); dijkstra(wm); for (const s of kbSlots) wm[s] = Infinity; dijkstra(wm); }
console.log("200-future MC paired (with + without bridge) total ms", (performance.now() - s0).toFixed(1));
