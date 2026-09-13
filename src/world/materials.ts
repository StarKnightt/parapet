/**
 * Procedural materials. No image assets: concrete albedo/bump/roughness are painted on a
 * canvas at boot (grain, blotches, rain streaks) and tiled at 4 m per repeat via per-face
 * UV scaling in the kit. Colour variation per building is a vertex colour tint on one shared
 * concrete material, so the whole city is a handful of draw calls.
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
    const g = 164 + (rng() - 0.5) * 18 + (rng() - 0.5) * 8;
    d[i * 4] = g + 3;
    d[i * 4 + 1] = g + 2;
    d[i * 4 + 2] = g - 2;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Aggregate: dense fine specks (1–2 cm at a 3 m tile) plus a sparse coarse layer.
  for (let i = 0; i < 16000; i++) {
    const light = rng() < 0.42;
    const a = 0.18 + rng() * 0.34;
    ctx.fillStyle = light ? `rgba(228,224,214,${a})` : `rgba(48,46,40,${a})`;
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
    color: 0x5c5b55,
    roughness: 0.7,
    metalness: 0.45,
    envMapIntensity: 0.6,
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
    color: 0x4a4842,
    roughness: 0.95,
    metalness: 0,
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

  return { concrete, glass, metal, paint, dark, lamp, concreteTile: 3 };
}
