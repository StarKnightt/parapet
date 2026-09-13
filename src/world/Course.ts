/**
 * "Concrete Line" — the rooftop course, authored in metres.
 *
 * Roofs run west→east along +x. Heights: A 20 · B 18.5 (penthouse 20.6) · C 15.5 · D 15
 * (deck 19) · E 14 · F 13. Every gap and lip is a number here; change it and the collision
 * and visuals both move.
 *
 *   A  sprint → vault vent box → slide under pipe rack → 4.5 m gap
 *   B  land → mantle 2.1 m penthouse (or hop the AC unit)          [CP]
 *   C  3 m drop → long run → wall-run the neighbour facade over a 7 m gap
 *        shortcut: mantle the tall AC unit, sprint the beam
 *   D  mantle chain up AC units → water-tower deck                    [CP]
 *   E  5 m hard drop → vault → slide under duct → 5 m gap
 *   F  finish slab
 *
 * West of A is a calibration pad: step heights and gap islands for tuning the controller.
 */
import { createRng } from "../core/math";
import type { Aabb, Vec3 } from "./CollisionWorld";
import type { Kit } from "./Kit";

export interface Checkpoint {
  name: string;
  trigger: Aabb;
  spawn: Vec3;
  yaw: number;
}

export interface CourseData {
  spawn: { pos: Vec3; yaw: number };
  checkpoints: Checkpoint[];
  finish: Aabb;
  /** Debug teleports for the number row (1..9). */
  teleports: { pos: Vec3; yaw: number; name: string }[];
}

const EAST = -Math.PI / 2;
const Z0 = -8;
const Z1 = 8;

function trigger(x0: number, x1: number, y: number, z0 = Z0, z1 = Z1): Aabb {
  return { min: [x0, y - 0.5, z0], max: [x1, y + 3, z1] };
}

export function buildCourse(kit: Kit): CourseData {
  const checkpoints: Checkpoint[] = [];
  const teleports: CourseData["teleports"] = [];
  const cp = (name: string, x0: number, x1: number, y: number, sx: number) => {
    checkpoints.push({ name, trigger: trigger(x0, x1, y), spawn: [sx, y, 0], yaw: EAST });
    teleports.push({ pos: [sx, y, 0], yaw: EAST, name });
  };

  // ---------------------------------------------------------------- A (20)
  const A = 20;
  kit.building({ x0: 0, x1: 28, z0: Z0, z1: Z1, top: A, tint: kit.pickTint(0), parapet: { w: 0 }, accent: ["e"], tag: "route" });
  cp("Start", 0, 6, A, 3);
  kit.ventBox(11.4, 12.6, A, -6, 6, 1.0);
  kit.pipeRack(20, A, Z0 + 0.3, 4.6, 1.2);
  kit.acUnit(20, A, 7, 2.2, 1.3, 1.9);

  // ---------------------------------------------------------------- B (18.5)
  const B = 18.5;
  kit.building({ x0: 32.5, x1: 58, z0: Z0, z1: Z1, top: B, tint: kit.pickTint(1), accent: ["w", "e"], tag: "route" });
  // Penthouse block — the mantle. AC unit beside it is the slow route.
  kit.building({ x0: 44, x1: 52, z0: Z0, z1: Z1, top: B + 2.1, base: B, tint: 0x9c9993, parapet: { n: 0, s: 0, e: 0, w: 0 }, windows: false, tag: "route" });
  kit.acUnit(42.4, B, 0, 1.6, 1.0, 3.2);
  cp("Penthouse", 45, 51, B + 2.1, 47);
  kit.acUnit(55, B, -5, 2.4, 1.4, 2.0);

  // ---------------------------------------------------------------- C (15.5)
  const C = 15.5;
  kit.building({ x0: 60, x1: 90, z0: Z0, z1: Z1, top: C, tint: kit.pickTint(2), parapet: { n: 0 }, accent: ["w"], tag: "route" });
  // North parapet only along the first stretch — it stops where the wall-run begins.
  kit.box([60, C, Z0], [80, C + 1.0, Z0 + 0.3], { tint: 0xd2cec6, tag: "route" });
  cp("Long roof", 61, 66, C, 63);
  // Neighbour to the north whose south facade (z = -8.6) is the wall-run surface across the gap.
  kit.building({ x0: 84, x1: 100, z0: -26, z1: -8.6, top: C + 6.5, tint: 0xa39f98, windows: true, parapet: { s: 0.6 }, tag: "wallrun" });
  // Shortcut: tall AC unit → beam over the gap.
  kit.acUnit(84, C, 4.2, 2.2, 2.0, 2.6, "route");
  kit.box([85, C + 1.7, 3.8], [97.4, C + 2.0, 4.4], { mat: "metal", tint: 0x6e7175, tag: "route" });
  kit.acUnit(72, C, -5.5, 2.6, 1.3, 2.0);
  kit.acUnit(66, C, 5.5, 1.8, 1.1, 1.8);

  // ---------------------------------------------------------------- D (15) + deck (19)
  const D = 15;
  kit.building({ x0: 97, x1: 120, z0: Z0, z1: Z1, top: D, tint: kit.pickTint(3), parapet: { w: 0, n: 0.6 }, tag: "route" });
  cp("Landing", 98, 102, D, 99.5);
  kit.acUnit(104.2, D, -1.5, 2.5, 1.2, 3.0, "route");
  kit.acUnit(107.8, D, 0.5, 2.5, 2.4, 3.0, "route");
  kit.acUnit(111.2, D, -1.5, 2.5, 3.6, 3.0, "route");
  // Water-tower deck, flush with D's east edge.
  kit.building({ x0: 114, x1: 120, z0: -4, z1: 4, top: D + 4, base: D, tint: 0x8f8c87, parapet: { w: 0, n: 0.9, s: 0.9 }, accent: ["e"], windows: false, tag: "route" });
  cp("Deck", 114.5, 119, D + 4, 116);
  // Tank on four legs, 2.6 m clearance so you run underneath it.
  for (const [lx, lz] of [[115.6, -1.8], [115.6, 1.8], [119.2, -1.8], [119.2, 1.8]]) {
    kit.boxAt(lx, D + 4, lz, 0.3, 2.6, 0.3, { mat: "metal", tint: 0x505357 });
  }
  kit.box([115, D + 6.6, -2.4], [119.8, D + 9.6, 2.4], { mat: "metal", tint: 0x7b7e82 });

  // ---------------------------------------------------------------- E (14)
  const E = 14;
  kit.building({ x0: 123, x1: 150, z0: Z0, z1: Z1, top: E, tint: kit.pickTint(4), accent: ["w", "e"], tag: "route" });
  cp("Low roof", 124, 128, E, 125.5);
  kit.ventBox(131.4, 132.6, E, -6.5, 6.5, 1.0);
  kit.pipeRack(140.5, E, -4.8, Z1 - 0.3, 1.2, 2);
  kit.acUnit(140.5, E, -7.1, 2.2, 1.3, 1.7);

  // ---------------------------------------------------------------- F (13) finish
  const F = 13;
  kit.building({ x0: 155, x1: 178, z0: Z0, z1: Z1, top: F, tint: kit.pickTint(5), accent: ["w"], tag: "route" });
  kit.box([160, F, -3], [166, F + 0.04, 3], { mat: "paint", surface: "paint", tag: "finish" });
  const finish: Aabb = { min: [160, F - 0.5, -3], max: [166, F + 3, 3] };
  teleports.push({ pos: [157, F, 0], yaw: EAST, name: "Finish roof" });

  // ---------------------------------------------------------------- calibration pad (west of A)
  const P = A;
  kit.building({ x0: -22, x1: 0, z0: -14, z1: 14, top: P, tint: 0xb4b0a9, parapet: { e: 0, w: 0 }, windows: true, tag: "pad" });
  // Step heights along z at x = -8: 0.2 … 2.0.
  const steps = [0.2, 0.4, 0.6, 0.8, 1.0, 1.25, 1.5, 2.0];
  steps.forEach((h, i) => {
    kit.box([-9, P, -12 + i * 3], [-7, P + h, -10 + i * 3], { tint: 0xa2a09b, tag: "pad" });
  });
  // Gap islands: 3, 4, 5, 6, 7 m gaps, each island 4 m deep.
  let x = -22;
  for (const gap of [3, 4, 5, 6, 7]) {
    const x1 = x - gap;
    const x0 = x1 - 4;
    kit.building({ x0, x1, z0: -6, z1: 6, top: P, tint: 0xb4b0a9, parapet: { n: 0, s: 0, e: 0, w: 0 }, windows: true, tag: "pad" });
    kit.box([x1 - 0.3, P, -6], [x1, P + 0.05, 6], { mat: "paint", surface: "paint", tag: "pad" });
    x = x0;
  }
  // Tall wall for mantle-height testing and a long flat wall for wall-run testing.
  kit.box([-20, P, 10], [-2, P + 6, 10.4], { tint: 0xaaa69f, tag: "pad" });
  // Slide-under bar across the z=-13 lane: 1.2 m clearance (standing body is 1.8 m).
  kit.box([-19.5, P + 1.2, -14], [-19.1, P + 1.6, -12], { mat: "metal", tint: 0x7a7c80, tag: "pad" });
  kit.box([-19.5, P, -14.3], [-19.1, P + 1.6, -14], { mat: "metal", tint: 0x7a7c80, tag: "pad" });
  kit.box([-19.5, P, -12], [-19.1, P + 1.6, -11.7], { mat: "metal", tint: 0x7a7c80, tag: "pad" });
  teleports.push({ pos: [-4, P, 0], yaw: Math.PI / 2, name: "Calibration pad" });

  // ---------------------------------------------------------------- neighbourhood + skyline
  buildNeighbourhood(kit);

  // Ground: streets far below.
  kit.box([-400, -1, -400], [400, 0, 400], { mat: "dark", collide: false, shadow: false });

  return {
    spawn: { pos: [3, A, 0], yaw: EAST },
    checkpoints,
    finish,
    teleports,
  };
}

/**
 * Off-route blocks either side of the street (collidable, tagged so landing on one respawns
 * you) and a far skyline that only exists to give the fog something to eat.
 */
function buildNeighbourhood(kit: Kit): void {
  const rng = createRng(99);
  for (const side of [-1, 1]) {
    let x = -70;
    while (x < 200) {
      const w = 14 + rng() * 18;
      const depth = 16 + rng() * 14;
      const gap = 6 + rng() * 8;
      const z0 = side < 0 ? -14 - depth : 14;
      const z1 = z0 + depth;
      // Keep the wall-run neighbour's footprint clear.
      const clash = side < 0 && x + w > 80 && x < 104;
      if (!clash) {
        const top = 5 + rng() * 22;
        kit.building({ x0: x, x1: x + w, z0, z1, top, tint: kit.pickTint(Math.floor(rng() * 6)), parapet: { n: 0.8, s: 0.8, e: 0.8, w: 0.8 }, tag: "offroute" });
        if (rng() < 0.6) kit.acUnit(x + w / 2 + (rng() - 0.5) * w * 0.5, top, (z0 + z1) / 2 + (rng() - 0.5) * depth * 0.5, 1.6 + rng() * 1.6, 1.0 + rng() * 0.8, 1.4 + rng() * 1.2);
      }
      x += w + gap;
    }
  }
  // Far skyline, non-collidable, no shadows.
  for (let i = 0; i < 70; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const x = -160 + rng() * 480;
    const dist = 55 + rng() * 220;
    const z = side * dist;
    const w = 16 + rng() * 34;
    const d = 16 + rng() * 34;
    const h = 14 + rng() * 70 * (dist / 250);
    kit.building({ x0: x, x1: x + w, z0: z - d / 2, z1: z + d / 2, top: h, tint: kit.pickTint(Math.floor(rng() * 6)), parapet: {}, windows: h > 20, collide: false, shadow: false });
  }
  // A few tall towers straight ahead so the run has a destination on the horizon.
  for (const [x, z, w, h] of [[230, -30, 26, 72], [262, 22, 30, 88], [300, -12, 34, 64], [215, 60, 24, 50]]) {
    kit.building({ x0: x, x1: x + w, z0: z - w / 2, z1: z + w / 2, top: h, tint: kit.pickTint(2), collide: false, shadow: false });
  }
}
