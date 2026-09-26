/**
 * The futures model, per-future part (contract section 2.6). These are STRESS SCENARIOS, not a traffic
 * forecast: they show how a world behaves when congestion and closures go wrong in correlated ways.
 *
 * Per future i (seed s):
 *   - draw one region-wide shock Zg, one draw per road class, one draw per corridor
 *   - per edge:   log m = ln(median[class, tod]) + sigma[class] * sigmaScale_corridor
 *                          * ( sqrt(rho) * Zg + sqrt(1 - rho) * Zspecific )
 *     where Zspecific is the corridor draw for corridor edges and the class draw otherwise. The shared
 *     shock Zg is what keeps futures from being artificially narrow: congestion moves together.
 *   - m is floored at 1 (free-flow is the fastest an edge can be)
 *   - a diversion factor multiplies tunnel corridors when the named link (Key Bridge) is closed
 *   - with probability closureProb one link from the eligible list is closed
 *   - EMS: `incidents` incident locations are sampled from hexes in proportion to population
 *
 * Common random numbers: every draw depends only on (seed, index, stream) and NEVER on the world, so the
 * same future is applied to every candidate and to the reference world. Draw counts are fixed, so adding
 * a mutation cannot shift later draws. All parameters below are labeled assumptions; override them by
 * shipping an `A-FUTURES-PARAMS` record in assumptions.json.
 */
import { z } from "zod";
import { isLinkClosed } from "./compile";
import { detExp, detLog, futureRng, STREAM } from "./prng";
import type { AssumptionRecord, CompiledWorld, Graph, Hexes, TimeOfDay } from "./contract";
import { ContractError } from "./csr";
import { NO_CORRIDOR } from "./contract";

export const FUTURES_MODEL_LABEL = "Stress scenarios, not a traffic forecast";

const TODS: TimeOfDay[] = ["am", "mid", "pm", "night"];

export interface FuturesParams {
  /** Median travel-time multiplier by time of day and road class name. */
  median: Record<TimeOfDay, Record<string, number>>;
  /** Log-sigma by road class name. */
  sigma: Record<string, number>;
  /** Share of log-variance that comes from the region-wide shock (0..1). */
  rho: number;
  diversion: { whenClosedLink: string; corridors: string[]; factor: number };
  /** Links that may be closed by a random closure. Ids missing from the snapshot are ignored. */
  closureEligible: string[];
  /** Incidents sampled per future for the EMS lens. */
  incidents: number;
}

const CLASS_NAMES = ["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "service", "link", "candidate"];

function row(v: number[]): Record<string, number> {
  return Object.fromEntries(CLASS_NAMES.map((c, i) => [c, v[i]]));
}

/** Defaults. Every number is a labeled assumption (status "assumption"), none is measured. */
export const DEFAULT_FUTURES_PARAMS: FuturesParams = {
  median: {
    //             motorway trunk primary secondary tertiary residential service link candidate
    night: row([1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]),
    mid: row([1.1, 1.12, 1.15, 1.15, 1.1, 1.05, 1.02, 1.1, 1.1]),
    am: row([1.45, 1.4, 1.35, 1.3, 1.2, 1.08, 1.03, 1.35, 1.3]),
    pm: row([1.5, 1.45, 1.4, 1.35, 1.22, 1.08, 1.03, 1.4, 1.35]),
  },
  sigma: row([0.3, 0.28, 0.25, 0.22, 0.18, 0.1, 0.08, 0.25, 0.2]),
  rho: 0.5,
  diversion: { whenClosedLink: "L-KEYBRIDGE", corridors: ["C-I895-TUNNEL", "C-I95-TUNNEL"], factor: 1.25 },
  closureEligible: ["L-HARBORTUNNEL", "L-FORTMCHENRY", "L-HANOVER", "L-BROENING"],
  incidents: 300,
};

const paramsSchema = z.object({
  median: z.record(z.enum(["am", "mid", "pm", "night"]), z.record(z.string(), z.number().positive())).optional(),
  sigma: z.record(z.string(), z.number().nonnegative()).optional(),
  rho: z.number().min(0).max(1).optional(),
  diversion: z.object({ whenClosedLink: z.string(), corridors: z.array(z.string()), factor: z.number().positive() }).optional(),
  closureEligible: z.array(z.string()).optional(),
  incidents: z.number().int().positive().optional(),
});

/**
 * Assumption ids the futures model reads from assumptions.json when present (anything absent keeps the
 * code default above). Value formats:
 *   A-FUTURES-MEDIAN-AM | -MID | -PM | -NIGHT   "motorway 1.45, trunk 1.4, ..."  (or a JSON object)
 *   A-FUTURES-SIGMA                             same format
 *   A-FUTURES-RHO                               number in [0, 1]
 *   A-DIVERSION                                 number: time multiplier on the diversion corridors
 *   A-DIVERSION-LINK                            link id whose closure triggers it (default L-KEYBRIDGE)
 *   A-DIVERSION-CORRIDORS                       "C-I895-TUNNEL, C-I95-TUNNEL"
 *   A-FUTURES-CLOSURES                          "L-HARBORTUNNEL, L-FORTMCHENRY"
 *   A-FUTURES-INCIDENTS                         positive integer
 *   A-FUTURES-PARAMS                            one JSON object with any of the keys of FuturesParams
 * A record's documented `min`/`max` are enforced: a value outside them is a ContractError.
 */
export const FUTURES_ASSUMPTION_IDS = [
  "A-FUTURES-MEDIAN-AM", "A-FUTURES-MEDIAN-MID", "A-FUTURES-MEDIAN-PM", "A-FUTURES-MEDIAN-NIGHT", "A-FUTURES-SIGMA",
  "A-FUTURES-RHO", "A-DIVERSION", "A-DIVERSION-LINK", "A-DIVERSION-CORRIDORS", "A-FUTURES-CLOSURES", "A-FUTURES-INCIDENTS", "A-FUTURES-PARAMS",
];

function bad(id: string, msg: string): never {
  throw new ContractError(`assumptions.json ${id}: ${msg}`);
}

function num(rec: AssumptionRecord): number {
  if (typeof rec.value !== "number" || !Number.isFinite(rec.value)) bad(rec.id, `value must be a finite number, got ${JSON.stringify(rec.value)}`);
  if (rec.min !== undefined && rec.value < rec.min) bad(rec.id, `value ${rec.value} is below its documented min ${rec.min}`);
  if (rec.max !== undefined && rec.value > rec.max) bad(rec.id, `value ${rec.value} is above its documented max ${rec.max}`);
  return rec.value;
}

function list(rec: AssumptionRecord): string[] {
  if (typeof rec.value !== "string") bad(rec.id, "value must be a comma-separated string");
  return (rec.value as string).split(",").map((x) => x.trim()).filter(Boolean);
}

function classTable(rec: AssumptionRecord, allowZero = false): Record<string, number> {
  let obj: unknown = rec.value;
  if (typeof obj === "string") {
    const t = obj.trim();
    if (t.startsWith("{")) obj = JSON.parse(t);
    else {
      const out: Record<string, number> = {};
      for (const part of t.split(",")) {
        const [k, v] = part.trim().split(/\s+/);
        const x = Number(v);
        if (!k || !Number.isFinite(x)) bad(rec.id, `cannot read "${part.trim()}" as "<road class> <number>"`);
        out[k] = x;
      }
      obj = out;
    }
  }
  const r = z.record(z.string(), allowZero ? z.number().nonnegative() : z.number().positive()).safeParse(obj);
  if (!r.success) bad(rec.id, "value must map road classes to positive numbers");
  return (r as { data: Record<string, number> }).data;
}

/** Merge futures parameters found in assumptions.json over the code defaults. `usedIds` lists what came from the file. */
export function resolveFuturesParams(assumptions: AssumptionRecord[]): { params: FuturesParams; fromSnapshot: boolean; usedIds: string[] } {
  const by = new Map(assumptions.map((a) => [a.id, a]));
  const used: string[] = [];
  const take = (id: string): AssumptionRecord | undefined => {
    const r = by.get(id);
    if (r) used.push(id);
    return r;
  };
  let p: FuturesParams = { ...DEFAULT_FUTURES_PARAMS, median: { ...DEFAULT_FUTURES_PARAMS.median }, diversion: { ...DEFAULT_FUTURES_PARAMS.diversion } };

  const whole = take("A-FUTURES-PARAMS");
  if (whole) {
    const raw = typeof whole.value === "string" ? JSON.parse(whole.value) : whole.value;
    const q = paramsSchema.parse(raw);
    p = {
      median: { ...p.median, ...(q.median as FuturesParams["median"] | undefined) },
      sigma: { ...p.sigma, ...q.sigma },
      rho: q.rho ?? p.rho,
      diversion: q.diversion ?? p.diversion,
      closureEligible: q.closureEligible ?? p.closureEligible,
      incidents: q.incidents ?? p.incidents,
    };
  }
  for (const t of TODS) {
    const r = take(`A-FUTURES-MEDIAN-${t.toUpperCase()}`);
    if (r) p.median[t] = { ...p.median[t], ...classTable(r) };
  }
  const sg = take("A-FUTURES-SIGMA");
  if (sg) {
    p.sigma = { ...p.sigma, ...classTable(sg, true) };
  }
  const rho = take("A-FUTURES-RHO");
  if (rho) {
    const v = num(rho);
    if (v < 0 || v > 1) bad(rho.id, "rho must be in [0, 1]");
    p.rho = v;
  }
  const div = take("A-DIVERSION");
  if (div) {
    const v = num(div);
    if (v <= 0) bad(div.id, "diversion factor must be positive");
    p.diversion = { ...p.diversion, factor: v };
  }
  const dl = take("A-DIVERSION-LINK");
  if (dl) p.diversion = { ...p.diversion, whenClosedLink: list(dl)[0] ?? p.diversion.whenClosedLink };
  const dc = take("A-DIVERSION-CORRIDORS");
  if (dc) p.diversion = { ...p.diversion, corridors: list(dc) };
  const cl = take("A-FUTURES-CLOSURES");
  if (cl) p.closureEligible = list(cl);
  const inc = take("A-FUTURES-INCIDENTS");
  if (inc) {
    const v = num(inc);
    if (!Number.isInteger(v) || v < 1) bad(inc.id, "incidents must be a positive integer");
    p.incidents = v;
  }
  return { params: p, fromSnapshot: used.length > 0, usedIds: used };
}

/** Flat, labeled list for the assumptions drawer. */
export function describeFuturesParams(fp: FuturesParams, fromSnapshot: boolean): AssumptionRecord[] {
  const status = "assumption" as const;
  const note = `${FUTURES_MODEL_LABEL}.${fromSnapshot ? "" : " Default parameters shipped with the simulator; not yet in assumptions.yaml."}`;
  const fmt = (r: Record<string, number>) => Object.entries(r).map(([k, v]) => `${k} ${v}`).join(", ");
  return [
    { id: "A-FUTURES-MODEL", label: "Futures model", value: FUTURES_MODEL_LABEL, unit: null, status, source: null, note: "Correlated lognormal congestion multipliers with a region-wide shock, common random numbers across candidates." },
    ...TODS.map((t) => ({ id: `A-FUTURES-MEDIAN-${t.toUpperCase()}`, label: `Median congestion multiplier, ${t}`, value: fmt(fp.median[t]), unit: "x free-flow time", status, source: null, note })),
    { id: "A-FUTURES-SIGMA", label: "Congestion log-sigma by road class", value: fmt(fp.sigma), unit: null, status, source: null, note },
    { id: "A-FUTURES-RHO", label: "Share of congestion variance shared region-wide", value: fp.rho, unit: null, status, source: null, note },
    { id: "A-DIVERSION", label: `Diversion load on tunnels when ${fp.diversion.whenClosedLink} is closed`, value: fp.diversion.factor, unit: "x time on " + fp.diversion.corridors.join(", "), status, source: null, note: "Assumption. Not derived from traffic counts." },
    { id: "A-FUTURES-CLOSURES", label: "Links eligible for a random closure", value: fp.closureEligible.join(", "), unit: null, status, source: null, note },
    { id: "A-FUTURES-INCIDENTS", label: "EMS incidents sampled per future", value: fp.incidents, unit: "incidents", status, source: null, note },
  ];
}

// ---- resolved (graph-bound) parameters ---------------------------------------------------------------

export interface ResolvedFutures {
  params: FuturesParams;
  nClasses: number;
  nCorr: number;
  /** ln(median) per [tod][class]. */
  mu: Record<TimeOfDay, Float64Array>;
  sigma: Float64Array;
  sqrtRho: number;
  sqrtOneMinusRho: number;
  /** Link indices (into graph.links) eligible for closure, sorted by id. */
  eligible: number[];
  diversionLink: string;
  diversionCorr: Set<number>;
  cumPop: Float64Array;
  popTotal: number;
}

export function resolveFutures(params: FuturesParams, g: Graph, hexes: Hexes): ResolvedFutures {
  const classes = g.meta.classes;
  const need = (table: Record<string, number>, what: string): Float64Array => {
    const out = new Float64Array(classes.length);
    classes.forEach((c, i) => {
      const v = table[c];
      if (v === undefined) throw new Error(`futures parameters have no ${what} for road class "${c}"`);
      out[i] = v;
    });
    return out;
  };
  const mu = {} as Record<TimeOfDay, Float64Array>;
  for (const t of TODS) {
    const med = need(params.median[t], `median (${t})`);
    mu[t] = med.map((m) => detLog(Math.max(1, m)));
  }
  const eligible = params.closureEligible
    .filter((id) => g.linkIndex.has(id))
    .sort()
    .map((id) => g.linkIndex.get(id) as number);
  const cum = new Float64Array(hexes.count);
  let s = 0;
  for (let h = 0; h < hexes.count; h++) {
    s += hexes.pop[h];
    cum[h] = s;
  }
  const dc = new Set<number>();
  for (const id of params.diversion.corridors) {
    const c = g.corridorIndex.get(id);
    if (c !== undefined) dc.add(c);
  }
  return {
    params,
    nClasses: classes.length,
    nCorr: g.meta.corridors.length,
    mu,
    sigma: need(params.sigma, "sigma"),
    sqrtRho: Math.sqrt(params.rho),
    sqrtOneMinusRho: Math.sqrt(1 - params.rho),
    eligible,
    diversionLink: params.diversion.whenClosedLink,
    diversionCorr: dc,
    cumPop: cum,
    popTotal: s,
  };
}

// ---- one future ---------------------------------------------------------------------------------------

export interface FutureSample {
  index: number;
  tod: TimeOfDay;
  zGlobal: number;
  zClass: Float64Array;
  zCorr: Float64Array;
  /** Index into graph.links of the randomly closed link, or -1. */
  closeLink: number;
  /** Per-hex incident counts (EMS), or null. */
  incidents: Float32Array | null;
}

export function newSample(rf: ResolvedFutures, hexCount: number, withIncidents: boolean): FutureSample {
  return {
    index: 0,
    tod: "am",
    zGlobal: 0,
    zClass: new Float64Array(rf.nClasses),
    zCorr: new Float64Array(rf.nCorr),
    closeLink: -1,
    incidents: withIncidents ? new Float32Array(hexCount) : null,
  };
}

/** Fill `out` with future `index`. Consumes a fixed number of draws per stream regardless of the world. */
export function drawFuture(
  rf: ResolvedFutures,
  seed: number,
  index: number,
  tod: TimeOfDay,
  closureProb: number,
  incidents: number,
  out: FutureSample,
): void {
  out.index = index;
  out.tod = tod;
  const cong = futureRng(seed, index, STREAM.congestion);
  out.zGlobal = cong.nextNormal();
  for (let c = 0; c < rf.nClasses; c++) out.zClass[c] = cong.nextNormal();
  for (let c = 0; c < rf.nCorr; c++) out.zCorr[c] = cong.nextNormal();

  const clo = futureRng(seed, index, STREAM.closure);
  const uClose = clo.nextOpen();
  const uPick = clo.nextOpen();
  out.closeLink = rf.eligible.length > 0 && uClose < closureProb ? Math.min(rf.eligible.length - 1, Math.floor(uPick * rf.eligible.length)) : -1;
  if (out.closeLink >= 0) out.closeLink = rf.eligible[out.closeLink];

  if (out.incidents) {
    out.incidents.fill(0);
    if (rf.popTotal > 0) {
      const inc = futureRng(seed, index, STREAM.incidents);
      const cum = rf.cumPop;
      for (let k = 0; k < incidents; k++) {
        const target = inc.nextOpen() * rf.popTotal;
        // first hex whose cumulative population exceeds target
        let lo = 0;
        let hi = cum.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cum[mid] > target) hi = mid;
          else lo = mid + 1;
        }
        out.incidents[lo] += 1;
      }
    }
  }
}

// ---- apply a future to a compiled world ---------------------------------------------------------------

export interface EdgeScratch {
  enabled: Uint8Array;
  mul: Float32Array;
  /** [class][corridorSlot] multiplier table, slot 0 = no corridor. */
  table: Float64Array;
}

export function newEdgeScratch(g: Graph, rf: ResolvedFutures): EdgeScratch {
  return {
    enabled: new Uint8Array(g.edgeCount),
    mul: new Float32Array(g.edgeCount),
    table: new Float64Array(rf.nClasses * (rf.nCorr + 1)),
  };
}

/**
 * Effective enabled mask and cost multiplier for (world, future). With no sample the compiled arrays are
 * returned as they are (no copy).
 */
export function prepareEdges(
  g: Graph,
  rf: ResolvedFutures,
  cw: CompiledWorld,
  sample: FutureSample | null,
  scratch: EdgeScratch,
): { enabled: Uint8Array; mul: Float32Array } {
  if (!sample) return { enabled: cw.edgeEnabled, mul: cw.edgeCostMul };

  let enabled = cw.edgeEnabled;
  if (sample.closeLink >= 0) {
    scratch.enabled.set(cw.edgeEnabled);
    for (const e of g.links[sample.closeLink].edges) scratch.enabled[e] = 0;
    enabled = scratch.enabled;
  }

  const slots = rf.nCorr + 1;
  const diversion = isLinkClosed(cw, g, rf.diversionLink);
  const mu = rf.mu[sample.tod];
  for (let c = 0; c < rf.nClasses; c++) {
    for (let j = 0; j < slots; j++) {
      const corr = j - 1;
      const scale = corr >= 0 ? cw.corridorSigmaScale[corr] : 1;
      const zSpecific = corr >= 0 ? sample.zCorr[corr] : sample.zClass[c];
      const z = rf.sqrtRho * sample.zGlobal + rf.sqrtOneMinusRho * zSpecific;
      let m = detExp(mu[c] + rf.sigma[c] * scale * z);
      if (diversion && corr >= 0 && rf.diversionCorr.has(corr)) m *= rf.params.diversion.factor;
      scratch.table[c * slots + j] = m < 1 ? 1 : m;
    }
  }
  const base = cw.edgeCostMul;
  const out = scratch.mul;
  for (let e = 0; e < g.edgeCount; e++) {
    const corr = g.edgeCorridor[e];
    out[e] = base[e] * scratch.table[g.edgeClass[e] * slots + (corr === NO_CORRIDOR ? 0 : corr + 1)];
  }
  return { enabled, mul: out };
}
