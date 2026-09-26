/**
 * Population-weighted metrics over the per-hex field (contract section 2.5, golden.py definitions).
 *
 * Weighted quantile q of values v with weights w: sort by (v ascending, index ascending); the answer is
 * the first v whose cumulative weight is >= q * total weight. No interpolation. Zero total weight gives
 * NaN. Unreachable hexes carry Infinity, so a quantile that lands on one is Infinity.
 *
 * `MetricsWorkspace` sorts once per call and reads every quantile, threshold share and block-group
 * median off that single ordering.
 */
import type { BlockGroup, Hexes, LensMetrics, ModelParams, WorstBlockGroup, XharborMetrics } from "./contract";

/** Reference implementation (sorts on every call). Used by tests and by one-off callers. */
export function weightedQuantile(values: ArrayLike<number>, weights: ArrayLike<number>, q: number): number {
  const n = values.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += weights[i];
  if (!(total > 0)) return NaN;
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => (values[a] < values[b] ? -1 : values[a] > values[b] ? 1 : a - b));
  const target = q * total;
  let cum = 0;
  for (let k = 0; k < n; k++) {
    cum += weights[order[k]];
    if (cum >= target) return values[order[k]];
  }
  return values[order[n - 1]];
}

/** Nearest-rank quantile of an already-sorted plain array (used across futures). */
export function quantileSortedRank(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const k = Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1));
  return sorted[k];
}

export class MetricsWorkspace {
  readonly hexes: Hexes;
  readonly bgCount: number;
  readonly popTotal: number;
  readonly zvhTotal: number;
  readonly lowWageTotal: number;
  private readonly popByBg: Float64Array;
  private readonly order: Uint32Array;
  private readonly cumBg: Float64Array;
  private readonly medBg: Float64Array;
  private readonly decided: Uint8Array;
  private readonly added: Float64Array;
  private readonly wPop: Float64Array;
  private readonly wZvh: Float64Array;
  private readonly vals: Float64Array;

  constructor(hexes: Hexes) {
    this.hexes = hexes;
    const H = hexes.count;
    let maxBg = -1;
    let pop = 0;
    let zvh = 0;
    let lw = 0;
    for (let h = 0; h < H; h++) {
      if (hexes.bg[h] > maxBg) maxBg = hexes.bg[h];
      pop += hexes.pop[h];
      zvh += hexes.zvh[h];
      lw += hexes.lowWage[h];
    }
    this.bgCount = maxBg + 1;
    this.popTotal = pop;
    this.zvhTotal = zvh;
    this.lowWageTotal = lw;
    this.popByBg = new Float64Array(this.bgCount);
    for (let h = 0; h < H; h++) this.popByBg[hexes.bg[h]] += hexes.pop[h];
    this.order = new Uint32Array(H);
    this.cumBg = new Float64Array(this.bgCount);
    this.medBg = new Float64Array(this.bgCount);
    this.decided = new Uint8Array(this.bgCount);
    this.added = new Float64Array(H);
    this.wPop = new Float64Array(H);
    this.wZvh = new Float64Array(H);
    this.vals = new Float64Array(H);
  }

  /** Sort hex indices by (value asc, index asc). */
  private sortBy(values: ArrayLike<number>): Uint32Array {
    const order = this.order;
    for (let i = 0; i < order.length; i++) order[i] = i;
    order.sort((a, b) => {
      const va = values[a];
      const vb = values[b];
      return va < vb ? -1 : va > vb ? 1 : a - b;
    });
    return order;
  }

  /** Two quantiles (q1 <= q2) of `values` under `weights`, walking `order` once. */
  private quantiles2(order: Uint32Array, values: ArrayLike<number>, weights: ArrayLike<number>, total: number, q1: number, q2: number): [number, number] {
    if (!(total > 0)) return [NaN, NaN];
    const t1 = q1 * total;
    const t2 = q2 * total;
    let cum = 0;
    let r1 = NaN;
    let have1 = false;
    for (let k = 0; k < order.length; k++) {
      const h = order[k];
      cum += weights[h];
      if (!have1 && cum >= t1) {
        r1 = values[h];
        have1 = true;
      }
      if (cum >= t2) return [r1, values[h]];
    }
    const last = values[order[order.length - 1]];
    return [have1 ? r1 : last, last];
  }

  /** Per block group weighted median of `values` (pop weights) read off `order`. Returns bg ids whose median > threshold. */
  private bgMedianAbove(order: Uint32Array, values: ArrayLike<number>, threshold: number): number[] {
    const { hexes, cumBg, medBg, decided, popByBg } = this;
    cumBg.fill(0);
    decided.fill(0);
    let remaining = 0;
    for (let b = 0; b < this.bgCount; b++) if (popByBg[b] > 0) remaining++;
    for (let k = 0; k < order.length && remaining > 0; k++) {
      const h = order[k];
      const b = hexes.bg[h];
      if (decided[b] || !(popByBg[b] > 0)) continue;
      cumBg[b] += hexes.pop[h];
      if (cumBg[b] >= 0.5 * popByBg[b]) {
        decided[b] = 1;
        medBg[b] = values[h];
        remaining--;
      }
    }
    const out: number[] = [];
    for (let b = 0; b < this.bgCount; b++) {
      if (popByBg[b] > 0 && decided[b] && medBg[b] > threshold) out.push(b);
    }
    return out;
  }

  /**
   * EMS lens metrics. `incidents` (per-hex incident counts for one future) replaces population as the
   * weight for p50/p90/pctWithin/zvhWithin/equity; zero-vehicle weight becomes incidents x zvh-per-capita.
   * Isolated block groups always use population (a structural property, not a sampling one).
   */
  ems(field: Float32Array, p: ModelParams, incidents?: Float32Array | null): LensMetrics {
    const { hexes, wPop, wZvh } = this;
    const H = hexes.count;
    const thr = p.emsThresholdS;
    let totPop = 0;
    let totZvh = 0;
    for (let h = 0; h < H; h++) {
      if (incidents) {
        const c = incidents[h];
        wPop[h] = c;
        wZvh[h] = hexes.pop[h] > 0 ? (c * hexes.zvh[h]) / hexes.pop[h] : 0;
      } else {
        wPop[h] = hexes.pop[h];
        wZvh[h] = hexes.zvh[h];
      }
      totPop += wPop[h];
      totZvh += wZvh[h];
    }
    const order = this.sortBy(field);
    const [p50, p90] = this.quantiles2(order, field, wPop, totPop, 0.5, 0.9);
    const [, p90z] = this.quantiles2(order, field, wZvh, totZvh, 0.5, 0.9);
    let inPop = 0;
    let inZvh = 0;
    let unreachable = 0;
    for (let h = 0; h < H; h++) {
      const t = field[h];
      if (t <= thr) {
        inPop += wPop[h];
        inZvh += wZvh[h];
      }
      if (!Number.isFinite(t)) unreachable++;
    }
    return {
      lens: "ems",
      p50S: p50,
      p90S: p90,
      pctWithin: totPop > 0 ? (100 * inPop) / totPop : NaN,
      zvhWithin: totZvh > 0 ? (100 * inZvh) / totZvh : NaN,
      isolatedBg: this.bgMedianAbove(order, field, thr),
      equityGapS: p90z - p90,
      unreachableHexes: unreachable,
    };
  }

  /** Quantiles qs (ascending) of `values` under `weights`, walking `order` once. Same rule as quantiles2. */
  private quantilesMany(order: Uint32Array, values: ArrayLike<number>, weights: ArrayLike<number>, total: number, qs: number[]): number[] {
    const out = new Array<number>(qs.length).fill(NaN);
    if (!(total > 0)) return out;
    const targets = qs.map((q) => q * total);
    let cum = 0;
    let next = 0;
    for (let k = 0; k < order.length && next < qs.length; k++) {
      const h = order[k];
      cum += weights[h];
      while (next < qs.length && cum >= targets[next]) out[next++] = values[h];
    }
    const last = values[order[order.length - 1]];
    for (let i = next; i < qs.length; i++) out[i] = last;
    return out;
  }

  /**
   * Access lens metrics. `baseline` is the snapshot-baseline field (or the reference world's field for a
   * future); without one, added time is zero everywhere.
   */
  access(field: Float32Array, baseline: Float32Array | null | undefined, p: ModelParams): LensMetrics {
    const { hexes, added } = this;
    const H = hexes.count;
    const pop = hexes.pop;
    for (let h = 0; h < H; h++) added[h] = baseline ? field[h] - baseline[h] : 0;

    const orderF = this.sortBy(field);
    const [p50, p90] = this.quantiles2(orderF, field, pop, this.popTotal, 0.5, 0.9);

    let okPop = 0;
    let popAdded = 0;
    let lwAdded = 0;
    for (let h = 0; h < H; h++) {
      const a = added[h];
      if (a <= p.accessAddedOkS) okPop += pop[h];
      popAdded += pop[h] * a;
      lwAdded += hexes.lowWage[h] * a;
    }
    const popMean = this.popTotal > 0 ? popAdded / this.popTotal : NaN;
    const lwMean = this.lowWageTotal > 0 ? lwAdded / this.lowWageTotal : NaN;

    const orderA = this.sortBy(added);
    const [a50, a90] = this.quantiles2(orderA, added, pop, this.popTotal, 0.5, 0.9);
    return {
      lens: "access",
      p50S: p50,
      p90S: p90,
      pctWithin: this.popTotal > 0 ? (100 * okPop) / this.popTotal : NaN,
      isolatedBg: this.bgMedianAbove(orderA, added, p.accessCutoffS),
      equityGapS: lwMean - popMean,
      lowWageAddedS: lwMean,
      popAddedS: popMean,
      addedP50S: a50,
      addedP90S: a90,
    };
  }

  /**
   * Cross-harbor lens metrics. `mean` is meanTimeS per hex (NaN = not an origin), `jobs` is jobs within 30
   * min per hex. `baseMean`/`baseJobs` are the baseline (or reference) arrays; without them loss and added
   * time are zero. Weights come from this workspace's hexes, so build it over hexes whose pop and lowWage
   * are zeroed for non-origin hexes (see `originMaskedHexes`).
   */
  xharbor(mean: Float32Array, jobs: Float32Array, baseMean: Float32Array | null, baseJobs: Float32Array | null, p: ModelParams, blockGroups?: BlockGroup[]): LensMetrics {
    const { hexes, added, vals } = this;
    const H = hexes.count;
    const pop = hexes.pop;
    const lw = hexes.lowWage;
    const loss = this.wZvh; // scratch: per-hex loss fraction
    const jobsV = this.wPop; // scratch: jobs with non-origins zeroed
    const meanV = vals;
    let noBase = 0;
    let popJobs = 0;
    let popLoss = 0;
    let lwLoss = 0;
    let popMean = 0;
    let popAdded = 0;
    let lwAdded = 0;
    let addedMax = 0;
    let first = true;
    for (let h = 0; h < H; h++) {
      const ok = !Number.isNaN(mean[h]);
      const J = ok ? jobs[h] : 0;
      const J0 = ok && baseJobs ? baseJobs[h] : J;
      jobsV[h] = J;
      meanV[h] = ok ? mean[h] : 0;
      loss[h] = J0 > 0 ? (J0 - J) / J0 : 0;
      if (ok && J0 === 0) noBase++;
      added[h] = ok && baseMean ? mean[h] - baseMean[h] : 0;
      popJobs += pop[h] * J;
      popLoss += pop[h] * loss[h];
      lwLoss += lw[h] * loss[h];
      popMean += pop[h] * meanV[h];
      popAdded += pop[h] * added[h];
      lwAdded += lw[h] * added[h];
      if (first || added[h] > addedMax) addedMax = added[h];
      first = false;
    }
    const popT = this.popTotal;
    const lwT = this.lowWageTotal;
    const m = {} as XharborMetrics;
    m.popCovered = popT;
    m.lowWageCovered = lwT;
    m.originsWithoutBaselineJobs = noBase;
    m.popMeanJobs = popJobs / popT;
    const orderJ = this.sortBy(jobsV);
    [m.jobsP10, m.jobsP50, m.jobsP90] = this.quantilesMany(orderJ, jobsV, pop, popT, [0.1, 0.5, 0.9]);
    m.popMeanLossPct = (100 * popLoss) / popT;
    m.lowWageMeanLossPct = (100 * lwLoss) / lwT;
    m.equityGapLossPct = m.lowWageMeanLossPct - m.popMeanLossPct;
    const gt = (arr: Float64Array, thr: number, w: Float32Array): number => {
      let s = 0;
      for (let h = 0; h < H; h++) if (arr[h] > thr) s += w[h];
      return s;
    };
    m.popLossGt5pct = gt(loss, 0.05, pop);
    m.lowWageLossGt5pct = gt(loss, 0.05, lw);
    m.popLossGt10pct = gt(loss, 0.1, pop);
    m.lowWageLossGt10pct = gt(loss, 0.1, lw);
    m.popLossGt25pct = gt(loss, 0.25, pop);
    m.lowWageLossGt25pct = gt(loss, 0.25, lw);
    m.popLossGt50pct = gt(loss, 0.5, pop);
    m.lowWageLossGt50pct = gt(loss, 0.5, lw);
    m.popMeanMeanTimeS = popMean / popT;
    m.popMeanAddedS = popAdded / popT;
    m.lowWageMeanAddedS = lwAdded / lwT;
    m.equityGapAddedS = m.lowWageMeanAddedS - m.popMeanAddedS;
    const orderA = this.sortBy(added);
    [m.addedP50S, m.addedP90S, m.addedP99S] = this.quantilesMany(orderA, added, pop, popT, [0.5, 0.9, 0.99]);
    m.addedMaxS = addedMax;
    let maxPop = -Infinity;
    let maxPopHex = -1;
    const populated: number[] = [];
    for (let h = 0; h < H; h++) {
      if (!(pop[h] > 0)) continue;
      populated.push(added[h]);
      if (added[h] > maxPop) {
        maxPop = added[h];
        maxPopHex = h;
      }
    }
    populated.sort((a, b) => a - b);
    m.populatedHexes = populated.length;
    m.addedMaxPopulatedS = populated.length ? maxPop : 0;
    m.addedMaxPopulatedHex = maxPopHex;
    m.addedP99PopulatedS = populated.length ? quantileSortedRank(populated, 0.99) : 0;
    m.popAddedGt60s = gt(added, 60, pop);
    m.lowWageAddedGt60s = gt(added, 60, lw);
    m.popAddedGt300s = gt(added, 300, pop);
    m.lowWageAddedGt300s = gt(added, 300, lw);
    m.byOriginShore = {};
    for (const s of [0, 1]) {
      let p0 = 0;
      let pl = 0;
      let g10 = 0;
      let g25 = 0;
      let l10 = 0;
      let pa = 0;
      let a60 = 0;
      let pj0 = 0;
      for (let h = 0; h < H; h++) {
        if (hexes.shore[h] !== s || Number.isNaN(mean[h])) continue;
        const w = pop[h];
        p0 += w;
        pl += w * loss[h];
        if (loss[h] > 0.1) {
          g10 += w;
          l10 += lw[h];
        }
        if (loss[h] > 0.25) g25 += w;
        pa += w * added[h];
        if (added[h] > 60) a60 += w;
        pj0 += w * (baseJobs ? baseJobs[h] : jobs[h]);
      }
      if (p0 > 0) {
        m.byOriginShore[String(s)] = { pop: p0, popMeanLossPct: (100 * pl) / p0, popLossGt10pct: g10, popLossGt25pct: g25, lowWageLossGt10pct: l10, popMeanAddedS: pa / p0, popAddedGt60s: a60, meanBaselineJobs: pj0 / p0 };
      }
    }
    if (blockGroups && blockGroups.length > 0) m.worst = worstBlockGroups(hexes, blockGroups, loss, added, baseJobs ?? jobs, pop);

    // Generic fields shared with the other lenses.
    const pctOk = gt(added, p.accessAddedOkS, pop);
    const orderM = this.sortBy(meanV);
    const [p50, p90] = this.quantiles2(orderM, meanV, pop, popT, 0.5, 0.9);
    return {
      lens: "xharbor",
      p50S: p50,
      p90S: p90,
      pctWithin: (100 * (popT - pctOk)) / popT,
      isolatedBg: this.bgMedianAbove(orderA, added, p.accessCutoffS),
      equityGapS: m.equityGapAddedS,
      lowWageAddedS: m.lowWageMeanAddedS,
      popAddedS: m.popMeanAddedS,
      addedP50S: m.addedP50S,
      addedP90S: m.addedP90S,
      xharbor: m,
    };
  }

}

/** Copy of `hexes` whose population and low-wage weights are zero for hexes that are not cross-harbor origins (shore 2). */
export function originMaskedHexes(hexes: Hexes): Hexes {
  const pop = new Float32Array(hexes.count);
  const lowWage = new Float32Array(hexes.count);
  for (let h = 0; h < hexes.count; h++) {
    if (hexes.shore[h] < 2) {
      pop[h] = hexes.pop[h];
      lowWage[h] = hexes.lowWage[h];
    }
  }
  return { ...hexes, pop, lowWage };
}

/**
 * Block groups with the highest mean loss / mean added time, as golden.py `worst_block_groups`: only origin
 * hexes with population, only block groups whose whole-BG population is at least 200, ties broken by geoid.
 */
export function worstBlockGroups(
  hexes: Hexes,
  blockGroups: BlockGroup[],
  loss: ArrayLike<number>,
  added: ArrayLike<number>,
  baseJobs: ArrayLike<number>,
  pop: ArrayLike<number>,
  top = 10,
): { byLossPct: WorstBlockGroup[]; byAddedS: WorstBlockGroup[] } {
  const rows: WorstBlockGroup[] = [];
  for (const b of blockGroups) {
    if (b.pop < 200) continue;
    let p = 0;
    let l = 0;
    let a = 0;
    let j = 0;
    for (const h of b.hexes) {
      const w = pop[h];
      if (!(w > 0)) continue; // non-origin hexes carry zero weight
      p += w;
      l += w * loss[h];
      a += w * added[h];
      j += w * baseJobs[h];
    }
    if (!(p > 0)) continue;
    rows.push({ bg: b.i, geoid: b.geoid, county: b.county, pop: b.pop, meanLossPct: (100 * l) / p, meanAddedS: a / p, meanBaselineJobs: j / p });
  }
  const cmp = (key: "meanLossPct" | "meanAddedS") => (x: WorstBlockGroup, y: WorstBlockGroup) =>
    y[key] - x[key] || ((x.geoid ?? "") < (y.geoid ?? "") ? -1 : 1);
  return {
    byLossPct: rows.slice().sort(cmp("meanLossPct")).slice(0, top),
    byAddedS: rows.slice().sort(cmp("meanAddedS")).slice(0, top),
  };
}
