/**
 * Procedural materials. No image assets: concrete albedo/bump/roughness are painted on a
 * canvas at boot (grain, blotches, rain streaks) and tiled at 4 m per repeat via per-face
 * UV scaling in the kit. Colour variation per building is a vertex colour tint on one shared
 * concrete material, so the whole city is a handful of draw calls.
 */
import * as THREE from "three";
import { createRng } from "../core/math";
import { patchMaterial } from "./shaderPatches";

export type MaterialKey = "concrete" | "glass" | "metal" | "paint" | "dark";

export interface MaterialSet {
  concrete: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  /** World metres covered by one concrete texture repeat. */
  concreteTile: number;
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
    const g = 172 + (rng() - 0.5) * 30 + (rng() - 0.5) * 12;
    d[i * 4] = g + 5;
    d[i * 4 + 1] = g + 3;
    d[i * 4 + 2] = g - 4;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Aggregate: light and dark specks of varied size (what reads as "concrete" at 1–3 m).
  for (let i = 0; i < 2600; i++) {
    const light = rng() < 0.45;
    const a = 0.12 + rng() * 0.3;
    ctx.fillStyle = light ? `rgba(225,222,214,${a})` : `rgba(58,56,50,${a})`;
    const s = 1 + rng() * rng() * 4;
    ctx.beginPath();
    ctx.ellipse(rng() * size, rng() * size, s, s * (0.6 + rng() * 0.6), rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Large tonal blotches (formwork pours, damp patches).
  for (let i = 0; i < 22; i++) {
    const v = rng() < 0.5 ? 0 : 255;
    blotch(ctx, size, rng() * size, rng() * size, 80 + rng() * 160, `rgba(${v},${v},${v},${0.025 + rng() * 0.04})`);
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
    const v = 228 + (base - 178) * 0.6 + (rng() - 0.5) * 18;
    rd[i * 4] = rd[i * 4 + 1] = rd[i * 4 + 2] = v;
    rd[i * 4 + 3] = 255;
  }
  r.ctx.putImageData(rimg, 0, 0);
  const rough = new THREE.CanvasTexture(r.canvas);
  rough.wrapS = rough.wrapT = THREE.RepeatWrapping;
  rough.anisotropy = 8;

  return { map, rough };
}

export function createMaterials(): MaterialSet {
  const { map, rough } = concreteTextures(7);

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

  const glass = new THREE.MeshStandardMaterial({
    color: 0x14171a,
    roughness: 0.3,
    metalness: 0.6,
    envMapIntensity: 0.9,
  });
  patchMaterial(glass);

  const metal = new THREE.MeshStandardMaterial({
    color: 0x4a4d50,
    roughness: 0.62,
    metalness: 0.7,
    envMapIntensity: 0.7,
    vertexColors: true,
  });
  patchMaterial(metal);

  const paint = new THREE.MeshStandardMaterial({
    color: 0xb87a30,
    roughness: 0.8,
    metalness: 0,
    envMapIntensity: 0.25,
  });
  patchMaterial(paint);

  const dark = new THREE.MeshStandardMaterial({
    color: 0x22221f,
    roughness: 0.95,
    metalness: 0,
  });
  patchMaterial(dark);

  return { concrete, glass, metal, paint, dark, concreteTile: 3 };
}
