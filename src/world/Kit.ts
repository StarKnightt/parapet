/**
 * Box kit: the single place that turns authored numbers into (a) merged visible geometry and
 * (b) collision boxes. Anything the player can stand on or hit goes through `box()` with
 * `collide: true`, so the collision world and the visual world are always the same numbers.
 *
 * Geometry is accumulated per material and merged once in `finalize()` — the whole city is a
 * handful of draw calls.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { createRng } from "../core/math";
import type { CollisionWorld, Surface, Vec3 } from "./CollisionWorld";
import type { MaterialKey, MaterialSet } from "./materials";

export interface BoxOpts {
  mat?: MaterialKey;
  /** Multiplies the material/texture colour (hex). */
  tint?: number;
  collide?: boolean;
  surface?: Surface;
  tag?: string;
  /** Casts shadows. Far skyline turns this off. */
  shadow?: boolean;
}

export type Edge = "n" | "s" | "e" | "w";

export interface BuildingOpts {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
  /** Ground level of the mass (default 0). */
  base?: number;
  tint?: number;
  roofTint?: number;
  /** Parapet height per edge; `0` = none, default 1.0. */
  parapet?: Partial<Record<Edge, number>>;
  /** Edges that get the ochre take-off / landing lip (low, painted). */
  accent?: Edge[];
  windows?: boolean;
  collide?: boolean;
  shadow?: boolean;
  tag?: string;
}

const PALETTE = [0xb9b5ae, 0xaaa79f, 0xc3beb5, 0x9f9c97, 0xb1ada8, 0xbcb5aa];
const ROOF_TINT = 0x8a8782;
const PARAPET_TINT = 0xd2cec6;
const PARAPET_T = 0.3;
const LIP_H = 0.35;
const PAINT_T = 0.05;

export class Kit {
  private readonly buckets = new Map<string, THREE.BufferGeometry[]>();
  private readonly rng = createRng(1234);
  private readonly color = new THREE.Color();
  private readonly meshes: THREE.Mesh[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly world: CollisionWorld,
    private readonly mats: MaterialSet,
  ) {}

  pickTint(i: number): number {
    return PALETTE[i % PALETTE.length];
  }

  /** Axis-aligned box from min to max corners. */
  box(min: Vec3, max: Vec3, opts: BoxOpts = {}): void {
    const mat = opts.mat ?? "concrete";
    const w = max[0] - min[0];
    const h = max[1] - min[1];
    const d = max[2] - min[2];
    if (w <= 0 || h <= 0 || d <= 0) return;
    const geo = new THREE.BoxGeometry(w, h, d);
    geo.translate(min[0] + w / 2, min[1] + h / 2, min[2] + d / 2);

    // Per-face UV scaling so the concrete tiles at a constant world size.
    const tile = this.mats.concreteTile;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    const ox = this.rng();
    const oy = this.rng();
    for (let f = 0; f < 6; f++) {
      const [du, dv] = dims[f];
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, (uv.getX(i) * du) / tile + ox, (uv.getY(i) * dv) / tile + oy);
      }
    }

    this.color.set(opts.tint ?? 0xffffff);
    const colors = new Float32Array(24 * 3);
    for (let i = 0; i < 24; i++) {
      colors[i * 3] = this.color.r;
      colors[i * 3 + 1] = this.color.g;
      colors[i * 3 + 2] = this.color.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    const key = `${mat}:${opts.shadow === false ? "far" : "near"}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    bucket.push(geo);

    if (opts.collide !== false) {
      this.world.add(min, max, opts.surface ?? (mat === "metal" ? "metal" : mat === "paint" ? "paint" : "concrete"), opts.tag);
    }
  }

  /** Convenience: centre-x, base-y, centre-z with size. */
  boxAt(cx: number, y0: number, cz: number, w: number, h: number, d: number, opts: BoxOpts = {}): void {
    this.box([cx - w / 2, y0, cz - d / 2], [cx + w / 2, y0 + h, cz + d / 2], opts);
  }

  /**
   * A building mass whose roof is a walkable surface at exactly `top`. Parapets sit on the
   * roof; accent edges are low painted lips that read as "jump here".
   */
  building(o: BuildingOpts): void {
    const base = o.base ?? 0;
    const tint = o.tint ?? this.pickTint(Math.floor(this.rng() * PALETTE.length));
    const collide = o.collide ?? true;
    const shadow = o.shadow ?? true;
    const common: BoxOpts = { collide, shadow, tag: o.tag };

    // Mass up to just under the roof slab, then a darker roof slab whose top is `top`.
    const slab = 0.06;
    this.box([o.x0, base, o.z0], [o.x1, o.top - slab, o.z1], { ...common, tint });
    this.box([o.x0, o.top - slab, o.z0], [o.x1, o.top, o.z1], { ...common, tint: o.roofTint ?? ROOF_TINT, surface: "concrete" });

    // Parapets.
    const heights: Record<Edge, number> = { n: 1.0, s: 1.0, e: 1.0, w: 1.0, ...(o.parapet ?? {}) };
    const accent = new Set(o.accent ?? []);
    for (const edge of ["n", "s", "e", "w"] as Edge[]) {
      const isAccent = accent.has(edge);
      const h = isAccent ? LIP_H : heights[edge];
      if (h <= 0) continue;
      const t = PARAPET_T;
      let min: Vec3;
      let max: Vec3;
      if (edge === "n") { min = [o.x0, o.top, o.z0]; max = [o.x1, o.top + h, o.z0 + t]; }
      else if (edge === "s") { min = [o.x0, o.top, o.z1 - t]; max = [o.x1, o.top + h, o.z1]; }
      else if (edge === "e") { min = [o.x1 - t, o.top, o.z0]; max = [o.x1, o.top + h, o.z1]; }
      else { min = [o.x0, o.top, o.z0]; max = [o.x0 + t, o.top + h, o.z1]; }
      if (isAccent) {
        this.box(min, [max[0], max[1] - PAINT_T, max[2]], { ...common, tint: PARAPET_TINT });
        this.box([min[0], max[1] - PAINT_T, min[2]], max, { ...common, mat: "paint", surface: "paint" });
      } else {
        this.box(min, max, { ...common, tint: PARAPET_TINT });
      }
    }

    // Window bands: dark glass strips, slightly proud of the facade. Not collidable.
    if (o.windows !== false) {
      const p = 0.025;
      const bandH = 1.6;
      const inset = 0.8;
      for (let y = base + 3.0; y + bandH < o.top - 2.4; y += 3.6) {
        const g: BoxOpts = { mat: "glass", collide: false, shadow: false };
        this.box([o.x1, y, o.z0 + inset], [o.x1 + p, y + bandH, o.z1 - inset], g);
        this.box([o.x0 - p, y, o.z0 + inset], [o.x0, y + bandH, o.z1 - inset], g);
        this.box([o.x0 + inset, y, o.z1], [o.x1 - inset, y + bandH, o.z1 + p], g);
        this.box([o.x0 + inset, y, o.z0 - p], [o.x1 - inset, y + bandH, o.z0], g);
      }
    }
  }

  /** Rooftop AC unit: metal cabinet with a lighter top grille frame. Collidable. */
  acUnit(cx: number, y0: number, cz: number, w: number, h: number, d: number, tag?: string): void {
    this.boxAt(cx, y0, cz, w, h, d, { mat: "metal", tint: 0xb9bcbf, tag });
    this.boxAt(cx, y0 + h, cz, w * 0.8, 0.08, d * 0.8, { mat: "dark", collide: false });
  }

  /** Horizontal pipe rack: N pipes on posts. `clearance` is roof→bottom of lowest pipe. */
  pipeRack(x: number, y0: number, z0: number, z1: number, clearance: number, pipes = 3): void {
    const dia = 0.32;
    const postT = 0.24;
    const total = clearance + pipes * (dia + 0.1) + 0.2;
    const n = Math.max(2, Math.round((z1 - z0) / 6) + 1);
    for (let i = 0; i < n; i++) {
      const z = z0 + ((z1 - z0) * i) / (n - 1);
      const zc = Math.min(Math.max(z, z0 + postT / 2), z1 - postT / 2);
      this.boxAt(x, y0, zc, postT, total, postT, { mat: "metal", tint: 0x5c5f63 });
    }
    for (let p = 0; p < pipes; p++) {
      const y = y0 + clearance + p * (dia + 0.1);
      this.box([x - dia / 2, y, z0], [x + dia / 2, y + dia, z1], { mat: "metal", tint: p === 1 ? 0x8a8d90 : 0x6a6d70 });
    }
    // Top rail tying the posts.
    this.box([x - postT / 2, y0 + total - 0.12, z0], [x + postT / 2, y0 + total, z1], { mat: "metal", tint: 0x5c5f63 });
  }

  /** Low concrete vent box / plant plinth (vault target). */
  ventBox(x0: number, x1: number, y0: number, z0: number, z1: number, h: number): void {
    this.box([x0, y0, z0], [x1, y0 + h, z1], { tint: 0xa6a29b });
    // Louvre strip on the long faces.
    this.box([x0 - 0.02, y0 + h * 0.35, z0 + 0.3], [x0, y0 + h * 0.8, z1 - 0.3], { mat: "dark", collide: false, shadow: false });
    this.box([x1, y0 + h * 0.35, z0 + 0.3], [x1 + 0.02, y0 + h * 0.8, z1 - 0.3], { mat: "dark", collide: false, shadow: false });
  }

  finalize(): THREE.Mesh[] {
    for (const [key, geos] of this.buckets) {
      const [matKey, range] = key.split(":") as [MaterialKey, string];
      const merged = mergeGeometries(geos, false);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, this.mats[matKey]);
      mesh.castShadow = range === "near";
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.name = key;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }
    this.buckets.clear();
    return this.meshes;
  }
}
