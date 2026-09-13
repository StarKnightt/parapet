/**
 * Static axis-aligned box world. Every roof slab, parapet, AC unit and pipe the player can
 * touch is one AABB here — the same numbers that build the visible geometry, so collision
 * and visuals cannot drift.
 *
 * Broadphase is a uniform XZ grid (rooftops are wide and flat; Y is unbounded per cell).
 * Movement is resolved per axis (move-and-slide), which is the boring, robust choice for a
 * box world: no penetration solver, no jitter, and ledge/wall probes are plain overlap tests.
 */

export type Surface = "concrete" | "metal" | "gravel" | "glass" | "wood" | "paint";
export type Vec3 = [number, number, number];

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

export interface Collider extends Aabb {
  id: number;
  surface: Surface;
  tag?: string;
  /** Internal query de-duplication stamp. */
  _stamp: number;
}

const CELL = 8;
const EPS = 0.002;
/** Max distance moved per sub-step along one axis (thin beams are 0.3 m). */
const MAX_STEP = 0.12;

const cellKey = (ix: number, iz: number): number => ((ix + 0x8000) << 16) | ((iz + 0x8000) & 0xffff);

export class CollisionWorld {
  private readonly cells = new Map<number, Collider[]>();
  private readonly all: Collider[] = [];
  private stamp = 1;
  private nextId = 1;

  get count(): number {
    return this.all.length;
  }

  add(min: Vec3, max: Vec3, surface: Surface = "concrete", tag?: string): Collider {
    const c: Collider = { id: this.nextId++, min: [...min], max: [...max], surface, tag, _stamp: 0 };
    // Normalise in case a builder passed a negative size.
    for (let i = 0; i < 3; i++) {
      if (c.min[i] > c.max[i]) {
        const t = c.min[i];
        c.min[i] = c.max[i];
        c.max[i] = t;
      }
    }
    this.all.push(c);
    const x0 = Math.floor(c.min[0] / CELL);
    const x1 = Math.floor(c.max[0] / CELL);
    const z0 = Math.floor(c.min[2] / CELL);
    const z1 = Math.floor(c.max[2] / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = cellKey(ix, iz);
        let bucket = this.cells.get(k);
        if (!bucket) {
          bucket = [];
          this.cells.set(k, bucket);
        }
        bucket.push(c);
      }
    }
    return c;
  }

  /** All colliders overlapping `box` (strict overlap on every axis). */
  query(box: Aabb, out: Collider[]): Collider[] {
    out.length = 0;
    const s = ++this.stamp;
    const x0 = Math.floor(box.min[0] / CELL);
    const x1 = Math.floor(box.max[0] / CELL);
    const z0 = Math.floor(box.min[2] / CELL);
    const z1 = Math.floor(box.max[2] / CELL);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const bucket = this.cells.get(cellKey(ix, iz));
        if (!bucket) continue;
        for (const c of bucket) {
          if (c._stamp === s) continue;
          c._stamp = s;
          if (
            box.min[0] < c.max[0] && box.max[0] > c.min[0] &&
            box.min[1] < c.max[1] && box.max[1] > c.min[1] &&
            box.min[2] < c.max[2] && box.max[2] > c.min[2]
          ) {
            out.push(c);
          }
        }
      }
    }
    return out;
  }

  private readonly scratch: Collider[] = [];

  overlapsAny(box: Aabb): Collider | null {
    const hits = this.query(box, this.scratch);
    return hits.length ? hits[0] : null;
  }

  /**
   * Translate `box` along `axis` by `delta`, stopping flush against the first blocker.
   * Returns the blocking collider or null. Mutates `box`.
   */
  moveAxis(box: Aabb, axis: 0 | 1 | 2, delta: number): Collider | null {
    if (delta === 0) return null;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / MAX_STEP));
    const step = delta / steps;
    const size = box.max[axis] - box.min[axis];
    const probe: Aabb = { min: [0, 0, 0], max: [0, 0, 0] };
    for (let i = 0; i < steps; i++) {
      box.min[axis] += step;
      box.max[axis] += step;
      // Shrink the other two axes by a hair so face-contact never reads as overlap.
      for (let a = 0; a < 3; a++) {
        const shrink = a === axis ? 0 : 1e-4;
        probe.min[a] = box.min[a] + shrink;
        probe.max[a] = box.max[a] - shrink;
      }
      const hits = this.query(probe, this.scratch);
      if (hits.length === 0) continue;
      let blocker: Collider = hits[0];
      if (step > 0) {
        let limit = Infinity;
        for (const c of hits) if (c.min[axis] < limit) { limit = c.min[axis]; blocker = c; }
        box.max[axis] = limit - EPS;
        box.min[axis] = box.max[axis] - size;
      } else {
        let limit = -Infinity;
        for (const c of hits) if (c.max[axis] > limit) { limit = c.max[axis]; blocker = c; }
        box.min[axis] = limit + EPS;
        box.max[axis] = box.min[axis] + size;
      }
      return blocker;
    }
    return null;
  }

  /**
   * Highest surface directly under `box` within `maxDist` below its feet.
   * Used for ground probing when velocity is zero and for ledge-top checks.
   */
  probeDown(box: Aabb, maxDist: number): { y: number; collider: Collider } | null {
    const probe: Aabb = {
      min: [box.min[0] + 1e-4, box.min[1] - maxDist, box.min[2] + 1e-4],
      max: [box.max[0] - 1e-4, box.min[1] + 1e-4, box.max[2] - 1e-4],
    };
    const hits = this.query(probe, this.scratch);
    let best: Collider | null = null;
    let bestY = -Infinity;
    for (const c of hits) {
      if (c.max[1] <= box.min[1] + 1e-3 && c.max[1] > bestY) {
        bestY = c.max[1];
        best = c;
      }
    }
    return best ? { y: bestY, collider: best } : null;
  }
}
