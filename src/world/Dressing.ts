/**
 * Set dressing: the marks people leave on a city — pasted posters, a flaked mural, a peeled
 * billboard, a skyline sign, bunting and cables across the canyon, graffiti, a windsock, road
 * paint far below. Ten pieces, all visual (`collide: false`, no shadows), all from the poster
 * atlas or the existing steel/louvre materials, so the whole set is one extra draw call.
 *
 * Placement rules: on faces the runner approaches (west-facing, so the low sun lights them),
 * never on the wall-run facade or in the run lane, nothing in the route's safety orange, and
 * no readable line longer than a stencil word. Built after the course so it never touches the
 * massing RNG.
 */
import { createRng } from "../core/math";
import type { Vec3 } from "./CollisionWorld";
import type { Kit } from "./Kit";
import { POSTER_SHEETS as S } from "./materials";

/** Faded cloth / paint tints for flags and road paint (none near the route orange 0xd4691c). */
const CLOTH = [0xd9d2c2, 0x4f7d7c, 0x6b7f96, 0xc4a25a, 0x8f4a44];

export function buildDressing(kit: Kit): void {
  const rng = createRng(777);
  const A = 20;
  const B = 18.5;
  const C = 15.5;
  const D = 15;
  const F = 13;
  const dark = { mat: "dark", collide: false, shadow: false } as const;
  const steel = { mat: "metal", collide: false, shadow: false } as const;

  // ---------------------------------------------------------------- 1. wall posters
  // Water-tower deck, west face (x = 114): two overlapping sheets beside the AC-unit chain,
  // seen for the whole run along roof D.
  kit.poster("w", 114, 2.35, D + 1.4, 2.0, 2.0, S.bands, { roll: 0.05 });
  kit.poster("w", 114, 3.05, D + 0.9, 1.9, 2.85, S.line4, { roll: -0.03, proud: 0.035 });
  // Finish arch, the pier right of the opening (x = 161.4): a stencilled 7.
  kit.poster("w", 161.4, 4.3, F + 2.4, 1.8, 2.7, S.seven, { roll: 0.02 });
  // Finish stair-head, right of the lit door (x = 173): a wayfinding sheet, seen through the arch.
  kit.poster("w", 173, 3.3, F + 0.9, 1.6, 2.4, S.exit, { roll: -0.04 });
  // Penthouse on B, north end of the mantle face (x = 44): a small stencilled 12.
  kit.poster("w", 44, -6.3, B + 0.25, 1.1, 1.65, S.twelve, { roll: 0.03 });

  // ---------------------------------------------------------------- 2. mural
  // North block over roof E (top 22.3), street face z = -14, lit by the low sun. 11.5 × 10 m,
  // flaked through to the concrete; the facade's fins stand in front of it.
  kit.poster("s", -14, 132.8, 11, 11.5, 10, S.mural, { proud: 0.03 });

  // ---------------------------------------------------------------- 3. roof billboard
  // South block beside roof A/B (top 20.9), turned to face the start: steel frame, backing
  // panel, a peeled sheet, two lamp hoods on arms (unlit, it is daytime), a catwalk.
  {
    const n = norm([-0.55, 0, -0.835]);
    const u: Vec3 = [n[2], 0, -n[0]]; // up × n: along the sheet, viewer's left → right
    const cx = 49.5;
    const cz = 17.2;
    const base = 20.9;
    const yaw = Math.atan2(n[0], n[2]);
    const at = (du: number, dn: number, y: number): Vec3 => [cx + u[0] * du + n[0] * dn, y, cz + u[2] * du + n[2] * dn];
    const sheetW = 6.0;
    const sheetH = 3.2;
    const y0 = base + 1.6;
    kit.sheet(at(0, 0.05, y0 + sheetH / 2), sheetW, sheetH, n, S.board);
    kit.prism(at(0, -0.01, y0 + sheetH / 2), [sheetW + 0.1, sheetH + 0.1, 0.06], [0, yaw, 0], { ...steel, tint: 0x4a4d50 });
    for (const du of [-2.4, 2.4]) {
      kit.prism(at(du, -0.2, base + 2.6), [0.24, 5.2, 0.24], [0, yaw, 0], { ...steel, tint: 0x5c5f63 });
      kit.prism(at(du, -0.2, base + 0.05), [0.6, 0.1, 0.6], [0, yaw, 0], { ...steel, tint: 0x6a6d70 });
    }
    for (const y of [y0 - 0.12, y0 + sheetH + 0.06]) {
      kit.prism(at(0, -0.2, y), [sheetW + 0.4, 0.12, 0.12], [0, yaw, 0], { ...steel, tint: 0x5c5f63 });
    }
    // Catwalk in front of the sheet.
    kit.prism(at(0, 0.45, y0 - 0.35), [sheetW + 0.2, 0.06, 0.7], [0, yaw, 0], { ...dark, tint: 0x55575a });
    kit.prism(at(0, 0.8, y0 + 0.15), [sheetW + 0.2, 0.05, 0.05], [0, yaw, 0], { ...steel, tint: 0x5c5f63 });
    // Lamp arms and hoods.
    for (const du of [-1.9, 1.9]) {
      kit.prism(at(du, 0.35, y0 + sheetH + 0.35), [0.06, 0.06, 0.9], [0, yaw, 0], { ...steel, tint: 0x5c5f63 });
      kit.prism(at(du, 0.8, y0 + sheetH + 0.3), [0.4, 0.16, 0.34], [0.35, yaw, 0], { ...steel, tint: 0x45484b });
      kit.prism(at(du, 0.8, y0 + sheetH + 0.19), [0.3, 0.04, 0.24], [0.35, yaw, 0], { mat: "glass", collide: false, shadow: false });
    }
  }

  // ---------------------------------------------------------------- 4. skyline sign
  // "NORD" on the far tower at the end of the canyon (x 300–334, z −29..5, top 64): 6 m letters
  // on a rail frame, silhouetted against the sky down the slot from roofs C to F.
  {
    const h = 6;
    const top = 64;
    const z0 = -12 - 20.5 / 2;
    const len = kit.signLetters("NORD", [312.6, top + 0.5, z0], [0, 0, 1], h, 0.8, { ...dark, tint: 0x2f3134 });
    for (const y of [top + 0.5 + 1.1, top + 0.5 + h - 1.1]) {
      kit.prism([313.2, y, z0 + len / 2], [0.2, 0.2, len + 1.4], [0, 0, 0], { ...dark, tint: 0x2f3134 });
    }
    for (let i = 0; i <= 4; i++) {
      kit.prism([313.2, top + 3.6, z0 - 0.6 + ((len + 1.2) * i) / 4], [0.24, 7.6, 0.24], [0, 0, 0], { ...dark, tint: 0x2f3134 });
    }
  }

  // ---------------------------------------------------------------- 5. bunting + cables
  // Bunting across the canyon over roof B, from the north tower's second tier (z = -15.8) to a
  // mast on the south block (top 20.9). Lowest point 5 m above the roof.
  {
    const a: Vec3 = [56, 26.2, -15.75];
    const b: Vec3 = [56, 24.7, 14.6];
    kit.prism([56, 26.2, -15.7], [0.16, 0.3, 0.16], [0, 0, 0], { ...dark, tint: 0x2a2a2a });
    kit.tube([56, 20.9, 14.6], [56, 24.85, 14.6], 0.05, 0.04, { ...steel, tint: 0x5c5f63, segments: 8 });
    kit.prism([56, 20.95, 14.6], [0.4, 0.1, 0.4], [0, 0, 0], { ...steel, tint: 0x6a6d70 });
    const pts = kit.catenary(a, b, 1.8, 0.018, 16, { ...dark, tint: 0x1e1e1e });
    // Flags every ~1.2 m along the line, a few missing.
    const span = 30.35;
    let k = 0;
    for (let s = 1.6; s < span - 1.6; s += 1.25) {
      const t = s / span;
      const i = Math.min(Math.floor(t * 16), 15);
      const f = t * 16 - i;
      const p = pts[i];
      const q = pts[i + 1];
      const y = p[1] + (q[1] - p[1]) * f;
      const z = p[2] + (q[2] - p[2]) * f;
      if (rng() < 0.15) continue;
      const tint = CLOTH[k++ % 4];
      kit.sheet([56, y - 0.24, z], 0.3, 0.44, "w", S.flag, { tint, roll: (rng() - 0.5) * 0.3 });
    }
  }
  // Two service cables high over the C→D gap, from the wall-run tower's south face (z = -9.2)
  // to the south tower's second tier (z = 16.4). 12 m above the wall-run.
  for (const x of [94.3, 94.7]) {
    kit.catenary([x, 30.5, -9.2], [x, 28.5, 16.4], 2.0, 0.02, 14, { ...dark, tint: 0x1a1a1a });
    kit.prism([x, 30.5, -9.1], [0.14, 0.22, 0.2], [0, 0, 0], { ...dark, tint: 0x2a2a2a });
    kit.prism([x, 28.5, 16.3], [0.14, 0.22, 0.2], [0, 0, 0], { ...dark, tint: 0x2a2a2a });
  }

  // ---------------------------------------------------------------- 6. graffiti
  // Vent box on A, west face (x = 11.4): the first thing the run vaults, tagged over its louvre.
  kit.poster("w", 11.4, -2.2, A + 0.08, 1.2, 0.9, S.tagA, { proud: 0.06, roll: -0.02 });
  // Stair-head on C, north face (z = 3.5), beside the run.
  kit.poster("n", 3.5, 70.2, C + 0.5, 1.4, 1.05, S.tagB, { roll: 0.03 });
  // Finish stair-head, left of the door (x = 173).
  kit.poster("w", 173, -3.4, F + 0.6, 1.5, 1.0, S.tagC, { roll: -0.03 });

  // ---------------------------------------------------------------- 7. windsock
  // Mast on the water tank (top 25.3), sock pointing south so it reads side-on from the run.
  {
    const mx = 118.6;
    const mz = -1.6;
    const top = D + 10.3;
    kit.tube([mx, top, mz], [mx, top + 3.3, mz], 0.05, 0.035, { ...steel, tint: 0x5c5f63, segments: 8 });
    kit.prism([mx, top + 0.04, mz], [0.36, 0.08, 0.36], [0, 0, 0], { ...steel, tint: 0x6a6d70 });
    kit.tube([mx, top + 3.05, mz], [mx, top + 3.05, mz + 0.42], 0.03, 0.03, { ...steel, tint: 0x5c5f63, segments: 6 });
    kit.tube([mx, top + 3.05, mz + 0.4], [mx, top + 2.55, mz + 2.3], 0.24, 0.09, { mat: "poster", collide: false, shadow: false, segments: 10, rect: S.sock });
    kit.tube([mx, top + 3.05, mz + 0.38], [mx, top + 3.05, mz + 0.46], 0.26, 0.26, { ...steel, tint: 0x8a8d90, segments: 10 });
  }

  // ---------------------------------------------------------------- 8. road paint
  // Zebra crossings and lane dashes on the street floor under the two gaps the run looks down
  // into (A→B and E→F), faded white, mostly lost in the haze — enough to make it a street.
  const paint = { tint: 0xd8d2c4 } as const;
  const stripe = (x0: number, x1: number, z0: number, z1: number) =>
    kit.sheet([(x0 + x1) / 2, 0.02, (z0 + z1) / 2], x1 - x0, z1 - z0, [0, 1, 0] as Vec3, S.plain, paint);
  const zebra = (x0: number, x1: number) => {
    for (let x = x0 + 0.6; x + 0.5 <= x1 - 0.3; x += 1.0) stripe(x, x + 0.5, -1.6, 1.6);
    // Stop lines either side of the crossing.
    stripe(x0 + 0.2, x1 - 0.2, -2.6, -2.35);
    stripe(x0 + 0.2, x1 - 0.2, 2.35, 2.6);
  };
  const dashes = (x0: number, x1: number, z: number) => {
    for (let x = x0; x + 2 <= x1; x += 4.5) stripe(x, x + 2, z - 0.08, z + 0.08);
  };
  zebra(28, 34.5);
  dashes(1, 60, -11);
  dashes(1, 60, 11);
  zebra(150, 157.5);
  dashes(126, 190, -11);
  dashes(126, 190, 11);
}

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
