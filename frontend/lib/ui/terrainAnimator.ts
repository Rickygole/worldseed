/**
 * Terrain animation buffers and loop, outside React. The map reads `elev` / `rgb` / `hatch` when it builds
 * its layers (keyed by a tick counter); the loop writes into them in place, so a frame allocates nothing.
 *
 * Each change eases every hex from where it is to its target, staggered by distance from a ripple origin
 * (ease-out; a sinking hex settles more gently). Hatching is withheld while the terrain moves and appears when
 * it settles. Nothing is allocated per frame or per start.
 */
import { clamp, easeOutCubic } from "../format";

/** A hex that sinks settles a little more gently than one that rises (ease-out quart). */
const easeOutQuart = (t: number): number => 1 - Math.pow(1 - t, 4);
import type { Encoded } from "./lenses";

export class TerrainAnimator {
  readonly elev: Float32Array;
  readonly rgb: Float32Array;
  readonly hatch: Uint8Array;
  /**
   * How fast each hex's displayed elevation is currently changing (m per animation-frame, always >= 0). This
   * is the real instantaneous rate of the value on screen, not a decorative effect: it peaks mid-animation and
   * returns to exactly 0 once a hex settles, by construction, with no separate decay timer. A renderer can use
   * it to draw a brief brighter highlight on a column that is actively rising or sinking right now.
   */
  readonly vel: Float32Array;
  /** Start values of the running animation: allocated once and reused, so `start` allocates nothing. */
  private readonly fromE: Float32Array;
  private readonly fromC: Float32Array;
  private primed = false;
  private raf = 0;

  constructor(readonly n: number) {
    this.elev = new Float32Array(n);
    this.rgb = new Float32Array(n * 3);
    this.hatch = new Uint8Array(n);
    this.vel = new Float32Array(n);
    this.fromE = new Float32Array(n);
    this.fromC = new Float32Array(n * 3);
  }

  /**
   * Animate to `target`. `dist` is each hex's distance from the ripple origin. `onFrame` runs after each
   * frame's write, `onSettle` once at the end.
   */
  start(target: Encoded, dist: Float32Array, opts: { ms: number; stagger: number; linear: boolean }, onFrame: () => void, onSettle: () => void): void {
    this.stop();
    const n = this.n;
    if (!this.primed) {
      // First paint rises from a flat plain in the target colors.
      this.rgb.set(target.rgb);
      this.primed = true;
    }
    const fromE = this.fromE;
    const fromC = this.fromC;
    fromE.set(this.elev);
    fromC.set(this.rgb);
    let maxD = 0;
    for (let i = 0; i < n; i++) if (dist[i] > maxD) maxD = dist[i];
    this.hatch.fill(0);
    const { ms, stagger, linear } = opts;
    const t0 = performance.now();
    const step = (now: number) => {
      const tt = (now - t0) / ms;
      const e = this.elev;
      const c = this.rgb;
      const v = this.vel;
      for (let i = 0; i < n; i++) {
        const delay = maxD > 0 ? (dist[i] / maxD) * stagger : 0;
        const local = clamp((tt - delay) / (1 - stagger), 0, 1);
        const sinking = target.elev[i] < fromE[i];
        const p = linear ? local : sinking ? easeOutQuart(local) : easeOutCubic(local);
        const prevE = e[i];
        e[i] = fromE[i] + (target.elev[i] - fromE[i]) * p;
        v[i] = Math.abs(e[i] - prevE);
        const k = i * 3;
        c[k] = fromC[k] + (target.rgb[k] - fromC[k]) * p;
        c[k + 1] = fromC[k + 1] + (target.rgb[k + 1] - fromC[k + 1]) * p;
        c[k + 2] = fromC[k + 2] + (target.rgb[k + 2] - fromC[k + 2]) * p;
      }
      if (tt < 1) {
        onFrame();
        this.raf = requestAnimationFrame(step);
      } else {
        this.raf = 0;
        this.hatch.set(target.hatch);
        v.fill(0);
        onFrame();
        onSettle();
      }
    };
    this.raf = requestAnimationFrame(step);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
