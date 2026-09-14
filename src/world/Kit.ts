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
  /** Faces that get vertical ribs (default all). Leave a face off if it is wall-run. */
  ribs?: Edge[];
  collide?: boolean;
  shadow?: boolean;
  tag?: string;
}

export interface TowerOpts {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  top: number;
  base?: number;
  tint?: number;
  roofTint?: number;
  /** Number of stepped setbacks (0–2). */
  setbacks?: number;
  setbackInset?: number;
  /** Vertical ribs on these faces (default all; `false` for none). */
  ribs?: boolean | Edge[];
  ribSpacing?: number;
  windows?: "slots" | "none";
  bands?: boolean;
  cap?: boolean;
  parapet?: number;
  /** "far" skips windows and uses coarse ribs. */
  detail?: "near" | "far";
  collide?: boolean;
  shadow?: boolean;
  tag?: string;
}

const MAX_LIGHTS = 14;

const PALETTE = [0xcec5b7, 0xbfb5a6, 0xd6ccbd, 0xb3aca1, 0xc7bdb0, 0xd0c5b2];
const ROOF_TINT = 0xd4cbbd;
const PARAPET_TINT = 0xdad1c2;
const PARAPET_T = 0.3;
const LIP_H = 0.35;
const PAINT_T = 0.05;

export class Kit {
  private readonly buckets = new Map<string, THREE.BufferGeometry[]>();
  private readonly rng = createRng(1234);
  private readonly color = new THREE.Color();
  private readonly meshes: THREE.Mesh[] = [];
  readonly lights: THREE.PointLight[] = [];

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

    this.commit(geo, mat, opts.tint ?? 0xffffff, opts.shadow !== false, min[1], h);

    if (opts.collide !== false) {
      this.world.add(min, max, opts.surface ?? (mat === "metal" ? "metal" : mat === "paint" ? "paint" : "concrete"), opts.tag);
    }
  }

  /** Attach colour + aBox attributes and file the geometry under its material bucket. */
  private commit(src: THREE.BufferGeometry, mat: MaterialKey, tint: number, shadow: boolean, yBase: number, h: number): void {
    // Everything is merged later; mergeGeometries needs a uniform indexed-ness.
    let geo = src;
    if (src.index) {
      geo = src.toNonIndexed();
      src.dispose();
    }
    const n = geo.attributes.position.count;
    this.color.set(tint);
    const colors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = this.color.r;
      colors[i * 3 + 1] = this.color.g;
      colors[i * 3 + 2] = this.color.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    // Per-vertex (height fraction within this piece, piece height) for the dirt/drip shader.
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const box = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      box[i * 2] = (pos.getY(i) - yBase) / Math.max(h, 1e-3);
      box[i * 2 + 1] = h;
    }
    geo.setAttribute("aBox", new THREE.BufferAttribute(box, 2));

    const key = `${mat}:${shadow ? "near" : "far"}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = [];
      this.buckets.set(key, bucket);
    }
    bucket.push(geo);
  }

  /** Box-projected UVs in world metres (matches the per-face tiling of `box`). */
  private projectUVs(geo: THREE.BufferGeometry): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    const pos = g.attributes.position as THREE.BufferAttribute;
    const nor = g.attributes.normal as THREE.BufferAttribute;
    const n = pos.count;
    const uv = new Float32Array(n * 2);
    const tile = this.mats.concreteTile;
    for (let i = 0; i < n; i++) {
      const nx = Math.abs(nor.getX(i));
      const ny = Math.abs(nor.getY(i));
      const nz = Math.abs(nor.getZ(i));
      let u: number;
      let v: number;
      if (ny >= nx && ny >= nz) { u = pos.getX(i); v = pos.getZ(i); }
      else if (nx >= nz) { u = pos.getZ(i); v = pos.getY(i); }
      else { u = pos.getX(i); v = pos.getY(i); }
      uv[i * 2] = u / tile;
      uv[i * 2 + 1] = v / tile;
    }
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    if (g !== geo) {
      geo.copy(g);
      g.dispose();
    }
  }

  /**
   * Extrude a 2-D profile drawn in the (u, y) plane through a wall's thickness.
   * `axis` 2: the wall runs along x (u = world x), extruded from z=`from` to z=`to`.
   * `axis` 0: the wall runs along z (u = world z), extruded from x=`from` to x=`to`.
   */
  extrude(shape: THREE.Shape, axis: 0 | 2, from: number, to: number, opts: BoxOpts = {}): void {
    const depth = Math.abs(to - from);
    if (depth <= 0) return;
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 12 });
    if (axis === 2) {
      geo.translate(0, 0, Math.min(from, to));
    } else {
      geo.rotateY(-Math.PI / 2);
      geo.translate(Math.max(from, to), 0, 0);
    }
    this.projectUVs(geo);
    geo.computeBoundingBox();
    const bb = geo.boundingBox!;
    this.commit(geo, opts.mat ?? "concrete", opts.tint ?? 0xffffff, opts.shadow !== false, bb.min.y, bb.max.y - bb.min.y);
  }

  /**
   * Wedge: a box whose top (or bottom) face is sloped along one horizontal axis. Visual only.
   * `slope` names the side that is LOWER: "x+" means the top drops toward +x.
   */
  wedge(min: Vec3, max: Vec3, slope: "x+" | "x-" | "z+" | "z-", opts: BoxOpts = {}): void {
    const shape = new THREE.Shape();
    const axis: 0 | 2 = slope[0] === "x" ? 2 : 0; // profile drawn along the sloping axis
    const u0 = axis === 2 ? min[0] : min[2];
    const u1 = axis === 2 ? max[0] : max[2];
    const lowAtPlus = slope[1] === "+";
    shape.moveTo(u0, min[1]);
    shape.lineTo(u1, min[1]);
    if (lowAtPlus) shape.lineTo(u0, max[1]);
    else shape.lineTo(u1, max[1]);
    shape.closePath();
    const from = axis === 2 ? min[2] : min[0];
    const to = axis === 2 ? max[2] : max[0];
    this.extrude(shape, axis, from, to, { ...opts, collide: false });
  }

  /**
   * Battered (leaning) buttress against a facade. `face` is the direction it protrudes.
   * Base protrudes `depthBase`, top `depthTop`; spans `w` along the facade at centre `c`.
   */
  buttress(c: number, faceCoord: number, y0: number, y1: number, w: number, depthBase: number, depthTop: number, face: Edge, opts: BoxOpts = {}): void {
    const out = face === "e" || face === "s" ? 1 : -1;
    const axis: 0 | 2 = face === "e" || face === "w" ? 2 : 0; // profile in (protrusion, y) plane
    const shape = new THREE.Shape();
    shape.moveTo(faceCoord, y0);
    shape.lineTo(faceCoord + out * depthBase, y0);
    shape.lineTo(faceCoord + out * depthTop, y1);
    shape.lineTo(faceCoord, y1);
    shape.closePath();
    // extrude() draws u along x for axis 2; here u is the protrusion axis, so swap.
    const prof: 0 | 2 = axis === 2 ? 2 : 0;
    this.extrude(shape, prof, c - w / 2, c + w / 2, { ...opts, collide: false });
    // Collision: the straight core only (the lean is visual).
    if (opts.collide !== false) {
      const d = Math.min(depthBase, depthTop);
      if (d > 0.05) {
        if (axis === 2) this.world.add([Math.min(faceCoord, faceCoord + out * d), y0, c - w / 2], [Math.max(faceCoord, faceCoord + out * d), y1, c + w / 2], "concrete", opts.tag);
        else this.world.add([c - w / 2, y0, Math.min(faceCoord, faceCoord + out * d)], [c + w / 2, y1, Math.max(faceCoord, faceCoord + out * d)], "concrete", opts.tag);
      }
    }
  }

  /**
   * Wall slab with arched openings. Openings are given along the wall (`u` centre, `w`, `h`
   * to the apex). Collides as piers + a lintel above each opening.
   */
  archWall(axis: 0 | 2, u0: number, u1: number, y0: number, y1: number, from: number, to: number, openings: { u: number; w: number; h: number }[], opts: BoxOpts = {}): void {
    const shape = new THREE.Shape();
    shape.moveTo(u0, y0);
    shape.lineTo(u1, y0);
    shape.lineTo(u1, y1);
    shape.lineTo(u0, y1);
    shape.closePath();
    for (const o of openings) {
      const r = o.w / 2;
      const top = Math.min(o.h, y1 - y0 - 0.3);
      const hole = new THREE.Path();
      hole.moveTo(o.u - r, y0);
      hole.lineTo(o.u - r, y0 + top - r);
      hole.absarc(o.u, y0 + top - r, r, Math.PI, 0, true);
      hole.lineTo(o.u + r, y0);
      hole.closePath();
      shape.holes.push(hole);
    }
    this.extrude(shape, axis, from, to, opts);
    if (opts.collide === false) return;
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const seg = (a: number, b: number, ya: number, yb: number) => {
      if (b - a < 0.02 || yb - ya < 0.02) return;
      if (axis === 2) this.world.add([a, ya, lo], [b, yb, hi], "concrete", opts.tag);
      else this.world.add([lo, ya, a], [hi, yb, b], "concrete", opts.tag);
    };
    const sorted = [...openings].sort((p, q) => p.u - q.u);
    let cursor = u0;
    for (const o of sorted) {
      seg(cursor, o.u - o.w / 2, y0, y1);
      seg(o.u - o.w / 2, o.u + o.w / 2, y0 + Math.min(o.h, y1 - y0 - 0.3) - 0.25, y1);
      cursor = o.u + o.w / 2;
    }
    seg(cursor, u1, y0, y1);
  }

  /**
   * Brutalist tower: stepped masses with vertical ribs, recessed slot windows in rows, a few
   * spandrel bands and a heavy cap. Route buildings should use `building()`; this is massing.
   */
  tower(o: TowerOpts): void {
    const base = o.base ?? 0;
    const tint = o.tint ?? this.pickTint(Math.floor(this.rng() * PALETTE.length));
    const collide = o.collide ?? true;
    const shadow = o.shadow ?? true;
    const detail = o.detail ?? "near";
    const common: BoxOpts = { collide, shadow, tag: o.tag };
    const vis: BoxOpts = { collide: false, shadow: shadow && detail === "near", tag: o.tag };
    const setbacks = o.setbacks ?? 0;
    const tiers = setbacks + 1;
    const fractions = tiers === 1 ? [1] : tiers === 2 ? [0.62, 0.38] : [0.5, 0.3, 0.2];
    const H = o.top - base;
    const ribFaces = new Set<Edge>(o.ribs === false ? [] : Array.isArray(o.ribs) ? o.ribs : ["n", "s", "e", "w"]);
    // Per-tower character: rib rhythm, rib depth, setback size, blind faces, a crown.
    const spacing = o.ribSpacing ?? (detail === "near" ? 1.8 + this.rng() * 2.4 : 4.8);
    const finD = detail === "near" ? 0.7 + this.rng() * 0.5 : 0.6;
    const setbackInset = o.setbackInset ?? 1.2 + this.rng() * 2.3;
    const blind = o.windows === "none" || this.rng() < 0.3;
    const crown = this.rng() < 0.5;
    const bandEvery = 9.6 + Math.floor(this.rng() * 2) * 3.2;

    let y = base;
    for (let t = 0; t < tiers; t++) {
      const inset = t * setbackInset;
      const x0 = o.x0 + inset;
      const x1 = o.x1 - inset;
      const z0 = o.z0 + inset;
      const z1 = o.z1 - inset;
      const yTop = t === tiers - 1 ? o.top : y + H * fractions[t];
      // The top tier stops under the cap slab so the two never share a coplanar top (z-fight).
      const hasCap = t === tiers - 1 && o.cap !== false;
      this.box([x0, y, z0], [x1, hasCap ? yTop - 0.6 : yTop, z1], { ...common, tint });
      this.decorate(x0, x1, z0, z1, y, yTop, ribFaces, tint, shadow, detail, spacing, !blind, finD);
      // Spandrel bands (heavy horizontals) on tier 0.
      if (o.bands !== false && t === 0) {
        for (let by = y + bandEvery; by < yTop - 3; by += bandEvery) {
          this.box([x0 - 0.3, by, z0 - 0.3], [x1 + 0.3, by + 0.5, z1 + 0.3], { ...vis, tint });
        }
      }
      // Crown: the ribs keep going past the roof as free-standing fins.
      if (t === tiers - 1 && crown && ribFaces.size > 0 && detail === "near") {
        this.decorate(x0, x1, z0, z1, yTop - 0.6, yTop + 3.6, ribFaces, tint, shadow, detail, spacing, false, finD);
      }
      // Cap slab with overhang on the top tier.
      if (t === tiers - 1 && o.cap !== false) {
        this.box([x0 - 0.45, yTop - 0.6, z0 - 0.45], [x1 + 0.45, yTop, z1 + 0.45], { ...common, tint: o.roofTint ?? ROOF_TINT });
        const ph = o.parapet ?? 1.1;
        if (ph > 0) {
          const t2 = 0.35;
          this.box([x0 - 0.45, yTop, z0 - 0.45], [x1 + 0.45, yTop + ph, z0 - 0.45 + t2], { ...common, tint: PARAPET_TINT });
          this.box([x0 - 0.45, yTop, z1 + 0.45 - t2], [x1 + 0.45, yTop + ph, z1 + 0.45], { ...common, tint: PARAPET_TINT });
          this.box([x0 - 0.45, yTop, z0 - 0.45], [x0 - 0.45 + t2, yTop + ph, z1 + 0.45], { ...common, tint: PARAPET_TINT });
          this.box([x1 + 0.45 - t2, yTop, z0 - 0.45], [x1 + 0.45, yTop + ph, z1 + 0.45], { ...common, tint: PARAPET_TINT });
        }
      }
      y = yTop;
    }
  }

  /**
   * Doorway recess cut into a facade: a lit room behind an arched opening. The facade box
   * must already stop short here (the recess is built from its own walls).
   * `face` is the facade direction the opening looks out of; (u, y0) locate it along the face.
   */
  doorway(face: Edge, faceCoord: number, u: number, y0: number, w: number, h: number, depth: number, opts: { tint?: number; tag?: string; light?: boolean; arch?: boolean; porch?: boolean } = {}): void {
    const tint = opts.tint ?? 0x8f8b84;
    const out = face === "e" || face === "s" ? 1 : -1;
    const axis: 0 | 2 = face === "e" || face === "w" ? 0 : 2; // axis perpendicular to the face
    if (opts.porch) {
      // Porch: the room bumps OUT of the facade; its open end gets the arch. The facade is the back wall.
      const front = faceCoord + out * depth;
      this.doorwayRoom(axis, out, faceCoord, front, u, y0, w, h, tint, opts);
      return;
    }
    const inner = faceCoord - out * depth;
    this.doorwayRoom(axis, out, inner, faceCoord, u, y0, w, h, tint, opts);
  }

  /**
   * Stair-head / plant room on a roof with a lit doorway carved into one face. Unlike a solid
   * `building`, the mass is assembled around the recess so the opening is real.
   */
  stairHead(x0: number, x1: number, z0: number, z1: number, y0: number, top: number, face: Edge, u: number, opts: { tint?: number; tag?: string } = {}): void {
    const tint = opts.tint ?? 0x9c9892;
    const common: BoxOpts = { tint, tag: opts.tag };
    const w = 2.4;
    const h = 3.2;
    const depth = Math.min(4.5, (face === "e" || face === "w" ? x1 - x0 : z1 - z0) - 1.2);
    const t = 0.4;
    const W = w + 2 * t;
    const H = h + t;
    const faceCoord = face === "e" ? x1 : face === "w" ? x0 : face === "s" ? z1 : z0;
    const out = face === "e" || face === "s" ? 1 : -1;
    const inner = faceCoord - out * depth;
    // Back mass (behind the room) and the two side fills beside it, plus the fill above.
    if (face === "e" || face === "w") {
      const bx0 = out > 0 ? x0 : inner;
      const bx1 = out > 0 ? inner : x1;
      this.box([bx0, y0, z0], [bx1, top, z1], common);
      const fx0 = out > 0 ? inner : x0;
      const fx1 = out > 0 ? x1 : inner;
      this.box([fx0, y0, z0], [fx1, top, u - W / 2], common);
      this.box([fx0, y0, u + W / 2], [fx1, top, z1], common);
      this.box([fx0, y0 + H, u - W / 2], [fx1, top, u + W / 2], common);
    } else {
      const bz0 = out > 0 ? z0 : inner;
      const bz1 = out > 0 ? inner : z1;
      this.box([x0, y0, bz0], [x1, top, bz1], common);
      const fz0 = out > 0 ? inner : z0;
      const fz1 = out > 0 ? z1 : inner;
      this.box([x0, y0, fz0], [u - W / 2, top, fz1], common);
      this.box([u + W / 2, y0, fz0], [x1, top, fz1], common);
      this.box([u - W / 2, y0 + H, fz0], [u + W / 2, top, fz1], common);
    }
    this.doorway(face, faceCoord, u, y0, w, h, depth, { tint, tag: opts.tag });
    // Cap slab.
    this.box([x0 - 0.3, top, z0 - 0.3], [x1 + 0.3, top + 0.35, z1 + 0.3], { ...common, tint: ROOF_TINT });
  }

  private doorwayRoom(axis: 0 | 2, out: number, inner: number, faceCoord: number, u: number, y0: number, w: number, h: number, tint: number, opts: { tag?: string; light?: boolean; arch?: boolean }): void {
    const lo = Math.min(faceCoord, inner);
    const hi = Math.max(faceCoord, inner);
    const depth = hi - lo;
    const t = 0.4;
    const W = w + 2 * t;
    const H = h + t;
    const b = (a0: number, a1: number, yA: number, yB: number, p0: number, p1: number, o: BoxOpts) => {
      if (axis === 0) this.box([p0, yA, a0], [p1, yB, a1], o);
      else this.box([a0, yA, p0], [a1, yB, p1], o);
    };
    const common: BoxOpts = { tint, tag: opts.tag };
    // Floor, ceiling, two side walls, back wall.
    b(u - W / 2, u + W / 2, y0 - t, y0, lo, hi, common);
    b(u - W / 2, u + W / 2, y0 + h, y0 + H, lo, hi, common);
    b(u - W / 2, u - w / 2, y0, y0 + h, lo, hi, common);
    b(u + w / 2, u + W / 2, y0, y0 + h, lo, hi, common);
    // Back wall sits 2 cm proud of the mass behind it so its face never z-fights the mass face.
    const backLo = out > 0 ? inner - t : inner - 0.02;
    const backHi = out > 0 ? inner + 0.02 : inner + t;
    b(u - W / 2, u + W / 2, y0 - t, y0 + H, backLo, backHi, { tint: 0x6f6b64, tag: opts.tag });
    // Arched face slab, 3 cm proud of the facade plane (again: no coplanar faces).
    if (opts.arch !== false) {
      const faceLo = out > 0 ? faceCoord - 0.5 : faceCoord - 0.03;
      const faceHi = out > 0 ? faceCoord + 0.03 : faceCoord + 0.5;
      this.archWall(axis === 0 ? 0 : 2, u - W / 2, u + W / 2, y0, y0 + H + 0.6, faceLo, faceHi, [{ u, w: w - 0.2, h: h - 0.1 }], { tint, tag: opts.tag });
    }
    // Lamp strip on the ceiling and a warm point light just inside.
    const lampP0 = out > 0 ? inner + 0.3 : inner - 0.9;
    const lampP1 = lampP0 + 0.6;
    b(u - 0.25, u + 0.25, y0 + h - 0.06, y0 + h - 0.01, lampP0, lampP1, { mat: "lamp", collide: false, shadow: false, tint: 0xffffff });
    if (opts.light !== false && this.lights.length < MAX_LIGHTS) {
      const light = new THREE.PointLight(0xffb060, 26, depth * 3 + 8, 2);
      const pc = (lo + hi) / 2;
      if (axis === 0) light.position.set(pc, y0 + h - 0.4, u);
      else light.position.set(u, y0 + h - 0.4, pc);
      this.lights.push(light);
    }
  }

  /** Thin slab bridge between two masses along x (or z), with curbs and support ribs. */
  bridge(axis: 0 | 2, a0: number, a1: number, y: number, c: number, w: number, opts: BoxOpts = {}): void {
    const thick = 0.45;
    const tint = opts.tint ?? 0x9a968f;
    const b = (aa0: number, aa1: number, yA: number, yB: number, c0: number, c1: number, o: BoxOpts) => {
      if (axis === 0) this.box([aa0, yA, c0], [aa1, yB, c1], o);
      else this.box([c0, yA, aa0], [c1, yB, aa1], o);
    };
    b(a0, a1, y - thick, y, c - w / 2, c + w / 2, { ...opts, tint });
    // Curbs.
    b(a0, a1, y, y + 0.18, c - w / 2, c - w / 2 + 0.18, { ...opts, tint: PARAPET_TINT });
    b(a0, a1, y, y + 0.18, c + w / 2 - 0.18, c + w / 2, { ...opts, tint: PARAPET_TINT });
    // Underside ribs.
    const n = Math.max(1, Math.round((a1 - a0) / 5));
    for (let i = 0; i < n; i++) {
      const a = a0 + ((i + 0.5) * (a1 - a0)) / n;
      b(a - 0.2, a + 0.2, y - thick - 0.5, y - thick, c - w / 2 + 0.2, c + w / 2 - 0.2, { ...opts, collide: false, tint });
    }
    // Central spine.
    b(a0, a1, y - thick - 0.5, y - thick, c - 0.25, c + 0.25, { ...opts, collide: false, tint });
  }

  /**
   * Cantilevered slab off a facade with a tapered underside.
   * `face` is the facade direction, (u, w) locate it along the face, `reach` how far it sticks out.
   */
  cantilever(face: Edge, faceCoord: number, u: number, w: number, y: number, reach: number, opts: BoxOpts = {}): void {
    const out = face === "e" || face === "s" ? 1 : -1;
    const axis: 0 | 2 = face === "e" || face === "w" ? 0 : 2;
    const thick = 0.5;
    const tint = opts.tint ?? 0x9a968f;
    const p0 = Math.min(faceCoord, faceCoord + out * reach);
    const p1 = Math.max(faceCoord, faceCoord + out * reach);
    if (axis === 0) this.box([p0, y - thick, u - w / 2], [p1, y, u + w / 2], { ...opts, tint });
    else this.box([u - w / 2, y - thick, p0], [u + w / 2, y, p1], { ...opts, tint });
    // Tapered haunch under the slab (visual).
    const haunch = Math.min(1.6, reach * 0.6);
    const slope = axis === 0 ? (out > 0 ? "x+" : "x-") : out > 0 ? "z+" : "z-";
    if (axis === 0) this.wedge([p0, y - thick - haunch, u - w / 2 + 0.2], [p1, y - thick, u + w / 2 - 0.2], slope, { tint });
    else this.wedge([u - w / 2 + 0.2, y - thick - haunch, p0], [u + w / 2 - 0.2, y - thick, p1], slope, { tint });
    // Low curb at the tip.
    if (axis === 0) this.box([out > 0 ? p1 - 0.2 : p0, y, u - w / 2], [out > 0 ? p1 : p0 + 0.2, y + 0.16, u + w / 2], { ...opts, tint: PARAPET_TINT });
    else this.box([u - w / 2, y, out > 0 ? p1 - 0.2 : p0], [u + w / 2, y + 0.16, out > 0 ? p1 : p0 + 0.2], { ...opts, tint: PARAPET_TINT });
  }

  /**
   * Return ladder up a facade, for getting back onto a route roof from a lower neighbour: an
   * optional cantilevered landing at `yFrom` (so the alley becomes a flat jump), then a zig-zag
   * of bracketed ledges every 1.4 m — each a mantle from the one below — until the parapet top
   * `yTo` is within a jump-mantle. Reads as service brackets on the face; tinted like the mass.
   */
  ledgeLadder(face: Edge, faceCoord: number, u: number, yFrom: number, yTo: number, landing: boolean, opts: BoxOpts = {}): void {
    const out = face === "e" || face === "s" ? 1 : -1;
    const axis: 0 | 2 = face === "e" || face === "w" ? 0 : 2;
    const tint = opts.tint ?? 0x9a968f;
    if (landing) this.cantilever(face, faceCoord, u, 2.6, yFrom, 2.4, { ...opts, tint });
    const rise = 1.4;
    const w = 1.6;
    const depth = 0.8;
    const thick = 0.22;
    const slope = axis === 0 ? (out > 0 ? "x+" : "x-") : out > 0 ? "z+" : "z-";
    const p0 = Math.min(faceCoord, faceCoord + out * depth);
    const p1 = Math.max(faceCoord, faceCoord + out * depth);
    let y = yFrom;
    for (let k = 1; yTo - y > 2.3; k++) {
      y += rise;
      const c = u + (k % 2 ? 1 : -1) * 1.0;
      if (axis === 0) {
        this.box([p0, y - thick, c - w / 2], [p1, y, c + w / 2], { ...opts, tint });
        this.wedge([p0, y - thick - 0.5, c - w / 2 + 0.3], [p1, y - thick, c + w / 2 - 0.3], slope, { tint });
      } else {
        this.box([c - w / 2, y - thick, p0], [c + w / 2, y, p1], { ...opts, tint });
        this.wedge([c - w / 2 + 0.3, y - thick - 0.5, p0], [c + w / 2 - 0.3, y - thick, p1], slope, { tint });
      }
    }
  }

  /** Circular vent on a facade: ring + dark grille. Visual only. */
  roundVent(face: Edge, faceCoord: number, u: number, y: number, r: number, tint = 0x8f8b84): void {
    const out = face === "e" || face === "s" ? 1 : -1;
    const ring = new THREE.CylinderGeometry(r, r, 0.35, 24, 1, true);
    const grille = new THREE.CircleGeometry(r * 0.78, 24);
    if (face === "e" || face === "w") {
      ring.rotateZ(Math.PI / 2);
      ring.translate(faceCoord + out * 0.175, y, u);
      grille.rotateY(out > 0 ? Math.PI / 2 : -Math.PI / 2);
      grille.translate(faceCoord + out * 0.2, y, u);
    } else {
      ring.rotateX(Math.PI / 2);
      ring.translate(u, y, faceCoord + out * 0.175);
      grille.rotateY(out > 0 ? 0 : Math.PI);
      grille.translate(u, y, faceCoord + out * 0.2);
    }
    this.projectUVs(ring);
    this.commit(ring, "concrete", tint, true, y - r, r * 2);
    this.projectUVs(grille);
    this.commit(grille, "dark", 0xffffff, false, y - r, r * 2);
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

    // Facade: ribs + recessed slot windows (route roofs: ribs only where nobody wall-runs).
    if (o.windows !== false) {
      const ribs = new Set<Edge>(o.ribs ?? ["n", "s", "e", "w"]);
      this.decorate(o.x0, o.x1, o.z0, o.z1, base, o.top - slab, ribs, tint, shadow, "near", 2.4, true);
    }
  }

  /**
   * Ribs + slot windows on the four faces of a mass between `y` and `yTop`. Ribs protrude
   * (visual only); windows are dark slots a hair proud of the face.
   */
  private decorate(x0: number, x1: number, z0: number, z1: number, y: number, yTop: number, ribFaces: Set<Edge>, tint: number, shadow: boolean, detail: "near" | "far", spacing: number, windows: boolean, finD = detail === "near" ? 0.45 : 0.6): void {
    const vis: BoxOpts = { collide: false, shadow: shadow && detail === "near" };
    const finW = 0.5;
    const faces: { edge: Edge; a0: number; a1: number; fixed: number; axis: 0 | 2; out: number }[] = [
      { edge: "e", a0: z0, a1: z1, fixed: x1, axis: 0, out: 1 },
      { edge: "w", a0: z0, a1: z1, fixed: x0, axis: 0, out: -1 },
      { edge: "s", a0: x0, a1: x1, fixed: z1, axis: 2, out: 1 },
      { edge: "n", a0: x0, a1: x1, fixed: z0, axis: 2, out: -1 },
    ];
    const finY0 = y + 0.6;
    const finY1 = yTop - 0.5;
    for (const f of faces) {
      const len = f.a1 - f.a0;
      const count = Math.max(2, Math.floor(len / spacing));
      const step = len / count;
      const hasRibs = ribFaces.has(f.edge) && finY1 - finY0 > 2;
      const place = (a: number, w: number, y0: number, y1: number, depth: number, opts: BoxOpts) => {
        const lo = f.fixed + (f.out > 0 ? 0 : -depth);
        const hi = f.fixed + (f.out > 0 ? depth : 0);
        if (f.axis === 0) this.box([lo, y0, a - w / 2], [hi, y1, a + w / 2], opts);
        else this.box([a - w / 2, y0, lo], [a + w / 2, y1, hi], opts);
      };
      if (hasRibs) {
        for (let i = 0; i <= count; i++) {
          const a = f.a0 + i * step;
          const aa = Math.min(Math.max(a, f.a0 + finW / 2), f.a1 - finW / 2);
          place(aa, finW, finY0, finY1, finD, { ...vis, tint });
        }
      }
      if (windows && detail === "near") {
        const floor = 3.2;
        const slotW = Math.min(0.9, step - finW - 0.4);
        if (slotW < 0.3) continue;
        for (let wy = y + 2.2; wy + 1.5 < yTop - 1.2; wy += floor) {
          for (let i = 0; i < count; i++) {
            const a = f.a0 + (i + 0.5) * step;
            place(a, slotW, wy, wy + 1.5, 0.02, { mat: "dark", collide: false, shadow: false });
          }
        }
      }
    }
  }

  /** Rooftop AC unit: metal cabinet with a lighter top grille frame. Collidable. */
  acUnit(cx: number, y0: number, cz: number, w: number, h: number, d: number, tag?: string): void {
    this.boxAt(cx, y0, cz, w, h, d, { mat: "metal", tint: 0xb9bcbf, tag });
    // Top grille frame, a dark louvre band on the long face, and a kerb it sits on.
    this.boxAt(cx, y0 + h, cz, w * 0.8, 0.08, d * 0.8, { mat: "dark", collide: false });
    const louvreY0 = y0 + h * 0.3;
    const louvreY1 = y0 + h * 0.75;
    this.box([cx - w * 0.38, louvreY0, cz - d / 2 - 0.02], [cx + w * 0.38, louvreY1, cz - d / 2], { mat: "dark", collide: false, shadow: false });
    this.box([cx - w * 0.38, louvreY0, cz + d / 2], [cx + w * 0.38, louvreY1, cz + d / 2 + 0.02], { mat: "dark", collide: false, shadow: false });
    this.boxAt(cx, y0, cz, w + 0.2, 0.12, d + 0.2, { tint: 0x8c8a85, collide: false });
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
    for (const l of this.lights) this.scene.add(l);
    return this.meshes;
  }
}
