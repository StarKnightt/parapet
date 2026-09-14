/**
 * Procedural materials. No image assets: concrete albedo/bump/roughness are painted on a
 * canvas at boot (grain, blotches, rain streaks) and tiled at 4 m per repeat via per-face
 * UV scaling in the kit. Colour variation per building is a vertex colour tint on one shared
 * concrete material, so the whole city is a handful of draw calls.
 *
 * Steel (`metal`) gets the same treatment at a 1.6 m tile: brushed grain, panel seams with
 * rivets, dents, grime and rust drips, tinted per prop through vertex colours. `dark` is a
 * matte louvre: a horizontal slat pattern (albedo + bump) at a 0.64 m tile.
 */
import * as THREE from "three";
import { createRng } from "../core/math";
import { patchMaterial } from "./shaderPatches";

export type MaterialKey = "concrete" | "glass" | "metal" | "paint" | "dark" | "lamp";

export interface MaterialSet {
  concrete: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  /** Warm emissive: the tungsten glow inside doorways and recesses. */
  lamp: THREE.MeshStandardMaterial;
  /** World metres covered by one concrete texture repeat. */
  concreteTile: number;
  /** World metres per sheet-metal repeat (two panel bays with seams + rivets). */
  metalTile: number;
  /** World metres per louvre-slat repeat on `dark`. */
  darkTile: number;
}

/** Texture tile size (world metres per repeat) for a material's box-projected UVs. */
export function tileFor(mats: MaterialSet, mat: MaterialKey): number {
  if (mat === "metal") return mats.metalTile;
  if (mat === "dark") return mats.darkTile;
  return mats.concreteTile;
}

function makeCanvas(size: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  return { canvas, ctx };
}

/** Wrapped soft blotch so the tile seams stay invisible. */
function blotch(ctx: CanvasRenderingContext2D, size: number, x: number, y: number, r: number, rgba: string): void {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      const g = ctx.createRadialGradient(x + ox * size, y + oy * size, 0, x + ox * size, y + oy * size, r);
      g.addColorStop(0, rgba);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x + ox * size - r, y + oy * size - r, r * 2, r * 2);
    }
  }
}

function concreteTextures(seed: number): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture } {
  const size = 512;
  const rng = createRng(seed);
  const { canvas, ctx } = makeCanvas(size);

  // Base and per-pixel grain, with a coarser aggregate speckle layered on.
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < size * size; i++) {
    // Warm, sun-bleached grey (sRGB ~190) so lit faces read bright under the low sun.
    const g = 190 + (rng() - 0.5) * 18 + (rng() - 0.5) * 8;
    d[i * 4] = g + 5;
    d[i * 4 + 1] = g + 2;
    d[i * 4 + 2] = g - 5;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Aggregate: dense fine specks (1–2 cm at a 3 m tile) plus a sparse coarse layer.
  for (let i = 0; i < 16000; i++) {
    const light = rng() < 0.42;
    const a = 0.18 + rng() * 0.34;
    ctx.fillStyle = light ? `rgba(234,226,212,${a})` : `rgba(56,50,42,${a})`;
    const s = 1.2 + rng() * rng() * 2.6;
    ctx.beginPath();
    ctx.ellipse(rng() * size, rng() * size, s, s * (0.6 + rng() * 0.6), rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 700; i++) {
    const a = 0.06 + rng() * 0.1;
    ctx.fillStyle = rng() < 0.5 ? `rgba(230,226,216,${a})` : `rgba(60,58,50,${a})`;
    const s = 6 + rng() * 12;
    ctx.beginPath();
    ctx.ellipse(rng() * size, rng() * size, s, s * (0.5 + rng() * 0.8), rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Formwork tie holes on a loose grid.
  for (let gx = 0; gx < 4; gx++) {
    for (let gy = 0; gy < 4; gy++) {
      const x = (gx + 0.5) * (size / 4) + (rng() - 0.5) * 30;
      const y = (gy + 0.5) * (size / 4) + (rng() - 0.5) * 30;
      ctx.fillStyle = "rgba(40,38,34,0.75)";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(200,196,186,0.35)";
      ctx.beginPath();
      ctx.arc(x, y + 6, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Large tonal blotches (formwork pours, damp patches).
  for (let i = 0; i < 26; i++) {
    const v = rng() < 0.5 ? 0 : 255;
    blotch(ctx, size, rng() * size, rng() * size, 90 + rng() * 180, `rgba(${v},${v},${v},${0.04 + rng() * 0.07})`);
  }
  // Small dark pits / aggregate.
  for (let i = 0; i < 900; i++) {
    const a = 0.08 + rng() * 0.25;
    ctx.fillStyle = `rgba(40,36,32,${a})`;
    const s = 1 + rng() * 2.2;
    ctx.fillRect(rng() * size, rng() * size, s, s);
  }
  // Rain streaks running down.
  for (let i = 0; i < 40; i++) {
    const x = rng() * size;
    const y0 = rng() * size;
    const len = 60 + rng() * 260;
    const w = 1 + rng() * 3;
    const alpha = 0.05 + rng() * 0.1;
    for (const oy of [0, -size, size]) {
      const g = ctx.createLinearGradient(0, y0 + oy, 0, y0 + oy + len);
      g.addColorStop(0, `rgba(30,28,26,${alpha})`);
      g.addColorStop(1, "rgba(30,28,26,0)");
      ctx.fillStyle = g;
      ctx.fillRect(x, y0 + oy, w, len);
    }
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  // Roughness: mostly rough, slightly smoother where the streaks darken.
  const r = makeCanvas(size);
  const rimg = r.ctx.createImageData(size, size);
  const rd = rimg.data;
  for (let i = 0; i < size * size; i++) {
    const base = d[i * 4];
    const v = 228 + (base - 204) * 0.6 + (rng() - 0.5) * 18;
    rd[i * 4] = rd[i * 4 + 1] = rd[i * 4 + 2] = v;
    rd[i * 4 + 3] = 255;
  }
  r.ctx.putImageData(rimg, 0, 0);
  const rough = new THREE.CanvasTexture(r.canvas);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  rough.anisotropy = 8;

  return { map, rough };
}

/** Greyscale canvas texture helper (roughness / bump). */
function greyTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/**
 * Painted / galvanised sheet steel, tiled at `metalTile` metres. One repeat is a 2×2 grid
 * of folded panels: brushed grain along u, dark seams with a bevel catch-light, a line of
 * rivets beside each seam, light dents (bump only), grime clouds and rust drips running down
 * from rivets and seams. The albedo is a neutral mid grey so per-prop vertex tints
 * (0xb9bcbf, 0x5c5f63 ...) still read as distinct paint colours on top of it.
 */
function metalTextures(seed: number): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const size = 512;
  const half = size / 2;
  const rng = createRng(seed);
  const { canvas, ctx } = makeCanvas(size);
  const r = makeCanvas(size);
  const b = makeCanvas(size);

  // --- Base + brushed grain: a random walk along each row gives long horizontal streaks
  //     with a fresh per-row phase; a little per-pixel noise keeps it from looking vector-clean.
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const rimg = r.ctx.createImageData(size, size);
  const rd = rimg.data;
  const bimg = b.ctx.createImageData(size, size);
  const bd = bimg.data;
  for (let y = 0; y < size; y++) {
    let walk = 0;
    const rowBias = (rng() - 0.5) * 7;
    for (let x = 0; x < size; x++) {
      walk = walk * 0.92 + (rng() - 0.5) * 3.2;
      const i = y * size + x;
      const g = 176 + rowBias + walk + (rng() - 0.5) * 5;
      d[i * 4] = g;
      d[i * 4 + 1] = g;
      d[i * 4 + 2] = g - 1;
      d[i * 4 + 3] = 255;
      const rv = 158 + rowBias * 1.5 + walk * 1.2 + (rng() - 0.5) * 10;
      rd[i * 4] = rd[i * 4 + 1] = rd[i * 4 + 2] = rv;
      rd[i * 4 + 3] = 255;
      const bv = 128 + walk * 0.6 + (rng() - 0.5) * 4;
      bd[i * 4] = bd[i * 4 + 1] = bd[i * 4 + 2] = bv;
      bd[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  r.ctx.putImageData(rimg, 0, 0);
  b.ctx.putImageData(bimg, 0, 0);

  // --- Dents: soft depressions, bump only (plus a whisper of tone so they read in flat light).
  for (let i = 0; i < 9; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const rad = 18 + rng() * 40;
    blotch(b.ctx, size, x, y, rad, `rgba(70,70,70,${0.35 + rng() * 0.3})`);
    blotch(ctx, size, x, y, rad, `rgba(120,118,112,${0.05 + rng() * 0.05})`);
  }

  // --- Grime clouds and a few paler faded patches (sun-bleached paint).
  for (let i = 0; i < 14; i++) {
    blotch(ctx, size, rng() * size, rng() * size, 60 + rng() * 140, `rgba(48,44,38,${0.05 + rng() * 0.1})`);
  }
  for (let i = 0; i < 6; i++) {
    blotch(ctx, size, rng() * size, rng() * size, 80 + rng() * 120, `rgba(236,232,224,${0.04 + rng() * 0.05})`);
  }
  for (let i = 0; i < 10; i++) {
    blotch(r.ctx, size, rng() * size, rng() * size, 60 + rng() * 140, `rgba(230,230,230,${0.15 + rng() * 0.2})`);
  }

  // --- Panel seams on a 2×2 grid (x = 0 / half, y = 0 / half), wrapped. Groove + bevel catch.
  const seam = (vertical: boolean, at: number) => {
    for (const c of [ctx, r.ctx, b.ctx]) {
      const groove = c === ctx ? "rgba(30,30,32,0.6)" : c === r.ctx ? "rgba(215,215,215,0.9)" : "rgba(40,40,40,0.95)";
      const bevel = c === ctx ? "rgba(255,255,250,0.18)" : c === r.ctx ? "rgba(175,175,175,0.3)" : "rgba(215,215,215,0.9)";
      for (const off of [0, size, -size]) {
        const p = at + off;
        c.fillStyle = groove;
        if (vertical) c.fillRect(p - 1, 0, 2.4, size);
        else c.fillRect(0, p - 1, size, 2.4);
        c.fillStyle = bevel;
        if (vertical) c.fillRect(p + 1.4, 0, 1.2, size);
        else c.fillRect(0, p + 1.4, size, 1.2);
        // Soft shading into the panel on the shadowed side of the fold.
        const g = vertical ? c.createLinearGradient(p - 1, 0, p - 14, 0) : c.createLinearGradient(0, p - 1, 0, p - 14);
        g.addColorStop(0, c === ctx ? "rgba(20,20,22,0.16)" : c === b.ctx ? "rgba(60,60,60,0.5)" : "rgba(200,200,200,0.3)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = g;
        if (vertical) c.fillRect(p - 14, 0, 13, size);
        else c.fillRect(0, p - 14, size, 13);
      }
    }
  };
  seam(true, 0);
  seam(true, half);
  seam(false, 0);
  seam(false, half);

  // --- Rivets: one line beside each seam, ~10 cm pitch. Dark ring, domed highlight up-left.
  const rivets: [number, number][] = [];
  const rivet = (x: number, y: number) => {
    rivets.push([x, y]);
    for (const [ox, oy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      const px = x + ox;
      const py = y + oy;
      if (px < -8 || px > size + 8 || py < -8 || py > size + 8) continue;
      ctx.fillStyle = "rgba(34,32,30,0.55)";
      ctx.beginPath();
      ctx.arc(px, py, 2.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(200,200,196,0.6)";
      ctx.beginPath();
      ctx.arc(px, py, 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,250,0.5)";
      ctx.beginPath();
      ctx.arc(px - 0.7, py - 0.7, 0.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(20,18,16,0.3)";
      ctx.beginPath();
      ctx.arc(px + 0.3, py + 2.2, 2.0, 0.15, Math.PI - 0.15);
      ctx.fill();
      b.ctx.fillStyle = "rgba(60,60,60,0.9)";
      b.ctx.beginPath();
      b.ctx.arc(px, py, 3.2, 0, Math.PI * 2);
      b.ctx.fill();
      const g = b.ctx.createRadialGradient(px, py, 0, px, py, 2.4);
      g.addColorStop(0, "rgba(235,235,235,1)");
      g.addColorStop(1, "rgba(150,150,150,0.4)");
      b.ctx.fillStyle = g;
      b.ctx.beginPath();
      b.ctx.arc(px, py, 2.4, 0, Math.PI * 2);
      b.ctx.fill();
      r.ctx.fillStyle = "rgba(120,120,120,0.7)";
      r.ctx.beginPath();
      r.ctx.arc(px, py, 2.4, 0, Math.PI * 2);
      r.ctx.fill();
    }
  };
  const pitch = 32;
  for (const at of [0, half]) {
    for (let k = 0; k < size / pitch; k++) {
      const t = k * pitch + pitch / 2 + (rng() - 0.5) * 1.5;
      rivet(at + 8, t);
      rivet(t, at + 8);
    }
  }

  // --- Scratches: fine light hairlines, mostly along the grain.
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 46; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const len = 12 + rng() * 70;
    const ang = (rng() - 0.5) * 0.5 + (rng() < 0.15 ? Math.PI / 2 : 0);
    ctx.strokeStyle = rng() < 0.7 ? `rgba(230,230,226,${0.1 + rng() * 0.15})` : `rgba(40,40,40,${0.1 + rng() * 0.12})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ctx.stroke();
  }

  // --- Rust: drips run down from rivets and seam crossings; a few spots elsewhere.
  const drip = (x: number, y0: number, len: number, w: number, a: number) => {
    for (const oy of [0, -size, size]) {
      for (const ox of [0, -size, size]) {
        const g = ctx.createLinearGradient(0, y0 + oy, 0, y0 + oy + len);
        g.addColorStop(0, `rgba(146,72,28,${a})`);
        g.addColorStop(0.35, `rgba(128,62,24,${a * 0.6})`);
        g.addColorStop(1, "rgba(120,60,24,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - w / 2, y0 + oy, w, len);
        const rg = r.ctx.createLinearGradient(0, y0 + oy, 0, y0 + oy + len);
        rg.addColorStop(0, `rgba(240,240,240,${a})`);
        rg.addColorStop(1, "rgba(240,240,240,0)");
        r.ctx.fillStyle = rg;
        r.ctx.fillRect(x + ox - w / 2, y0 + oy, w, len);
      }
    }
    // Rust bloom at the source.
    blotch(ctx, size, x, y0 + 2, 4 + w * 1.5, `rgba(150,70,26,${a * 0.9})`);
    blotch(r.ctx, size, x, y0 + 2, 4 + w * 1.5, `rgba(240,240,240,${a * 0.8})`);
  };
  for (let i = 0; i < 16; i++) {
    const [rx, ry] = rivets[Math.floor(rng() * rivets.length)];
    drip(rx + (rng() - 0.5) * 2, ry + 2, 24 + rng() * rng() * 150, 2 + rng() * 3, 0.28 + rng() * 0.3);
  }
  for (let i = 0; i < 5; i++) {
    drip(rng() * size, rng() * size, 40 + rng() * 120, 3 + rng() * 5, 0.2 + rng() * 0.2);
  }
  // Rust freckles.
  for (let i = 0; i < 260; i++) {
    const a = 0.15 + rng() * 0.3;
    ctx.fillStyle = `rgba(140,70,30,${a})`;
    const s = 0.8 + rng() * 1.6;
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, s, 0, Math.PI * 2);
    ctx.fill();
  }

  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return { map, rough: greyTexture(r.canvas), bump: greyTexture(b.canvas) };
}

/**
 * Matte painted louvre: horizontal slats at ~6 cm pitch (10 per `darkTile`). Each slat is a
 * lit top face falling into a black shadow gap, in albedo and bump, over a rubbery dust-flecked
 * base. Applied to AC louvre panels, vent-box strips, grilles and window slots (blinds).
 */
function slatTextures(seed: number): { map: THREE.CanvasTexture; rough: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const size = 512;
  const rng = createRng(seed);
  const { canvas, ctx } = makeCanvas(size);
  const r = makeCanvas(size);
  const b = makeCanvas(size);
  const slats = 10;
  const pitch = size / slats;
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const rimg = r.ctx.createImageData(size, size);
  const rd = rimg.data;
  const bimg = b.ctx.createImageData(size, size);
  const bd = bimg.data;
  for (let y = 0; y < size; y++) {
    // f runs 0→1 down each slat. 0–0.62: the angled blade (bright top edge fading down);
    // 0.62–0.78: the dark gap under it; 0.78–1: the next blade's shadowed underside.
    const f = (y % pitch) / pitch;
    let shade: number;
    let bump: number;
    if (f < 0.62) {
      shade = 96 - f * 55;
      bump = 200 - (f / 0.62) * 90;
    } else if (f < 0.78) {
      shade = 22;
      bump = 40;
    } else {
      shade = 44;
      bump = 40 + ((f - 0.78) / 0.22) * 60;
    }
    // Edge catch-light on the very top of the blade.
    if (f < 0.04) shade += 40;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const n = (rng() - 0.5) * 8;
      d[i * 4] = shade + n + 2;
      d[i * 4 + 1] = shade + n + 1;
      d[i * 4 + 2] = shade + n - 2;
      d[i * 4 + 3] = 255;
      rd[i * 4] = rd[i * 4 + 1] = rd[i * 4 + 2] = (f < 0.62 ? 205 : 235) + (rng() - 0.5) * 20;
      rd[i * 4 + 3] = 255;
      bd[i * 4] = bd[i * 4 + 1] = bd[i * 4 + 2] = bump + (rng() - 0.5) * 3;
      bd[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  r.ctx.putImageData(rimg, 0, 0);
  b.ctx.putImageData(bimg, 0, 0);
  // Dust drifts and a little pale scuffing on the blades; a few chips.
  for (let i = 0; i < 10; i++) {
    blotch(ctx, size, rng() * size, rng() * size, 60 + rng() * 120, `rgba(150,140,120,${0.05 + rng() * 0.08})`);
  }
  for (let i = 0; i < 120; i++) {
    ctx.fillStyle = `rgba(190,186,176,${0.15 + rng() * 0.25})`;
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 2, 1);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return { map, rough: greyTexture(r.canvas), bump: greyTexture(b.canvas) };
}

export function createMaterials(): MaterialSet {
  const { map, rough } = concreteTextures(7);
  const steel = metalTextures(19);
  const slat = slatTextures(23);

  const concrete = new THREE.MeshStandardMaterial({
    map,
    roughnessMap: rough,
    bumpMap: map,
    bumpScale: 0.8,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
    envMapIntensity: 0.3,
  });
  patchMaterial(concrete, { concrete: true, boxFrac: true });

  // Tinted architectural glass: a touch of blue-green so the sky reflection reads as glass
  // rather than black lacquer; roughness borrows the steel grain so reflections smear a little.
  const glass = new THREE.MeshStandardMaterial({
    color: 0x18232a,
    roughness: 0.28,
    metalness: 0.55,
    envMapIntensity: 1.0,
  });
  patchMaterial(glass);

  // Painted sheet steel. The albedo map is a neutral mid grey (~0xb0) so `color` × vertex tint
  // sets the paint colour; low metalness keeps it from going black under the sky env map,
  // and the roughness map (satin ~0.62, rougher on rust/grime/seams) gives it a soft sheen.
  const metal = new THREE.MeshStandardMaterial({
    color: 0x969591,
    map: steel.map,
    roughnessMap: steel.rough,
    bumpMap: steel.bump,
    bumpScale: 0.6,
    roughness: 1,
    metalness: 0.25,
    envMapIntensity: 0.6,
    vertexColors: true,
  });
  patchMaterial(metal, { metal: true, boxFrac: true });

  // Safety orange, pushed redder so it still pops against warm sunlit concrete. It borrows the
  // concrete grain as bump + roughness (not albedo) so painted surfaces read as paint over
  // concrete instead of a flat plastic band, while the colour stays pure.
  const paint = new THREE.MeshStandardMaterial({
    color: 0xd4691c,
    roughnessMap: rough,
    bumpMap: map,
    bumpScale: 0.5,
    roughness: 0.85,
    metalness: 0,
    envMapIntensity: 0.25,
  });
  patchMaterial(paint);

  // Matte rubberised/painted louvre. Dark, but with a sky sheen so it never reads as a void.
  const dark = new THREE.MeshStandardMaterial({
    color: 0xd8d2c6,
    map: slat.map,
    roughnessMap: slat.rough,
    bumpMap: slat.bump,
    bumpScale: 0.35,
    roughness: 1,
    metalness: 0.05,
    envMapIntensity: 0.45,
    vertexColors: true,
  });
  patchMaterial(dark);

  const lamp = new THREE.MeshStandardMaterial({
    color: 0x2a1c0c,
    emissive: 0xffb347,
    emissiveIntensity: 3.2,
    roughness: 1,
    metalness: 0,
    vertexColors: true,
  });
  patchMaterial(lamp);

  return { concrete, glass, metal, paint, dark, lamp, concreteTile: 3, metalTile: 1.6, darkTile: 0.64 };
}
