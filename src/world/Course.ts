/**
 * "Concrete Line" — the rooftop course, authored in metres.
 *
 * Roofs run west→east along +x. Heights: A 20 · B 18.5 (penthouse 20.6) · C 15.5 · D 15
 * (deck 19) · E 14 · F 13. Every gap and lip is a number here; change it and the collision
 * and visuals both move.
 *
 *   A  sprint → vault vent box → slide under pipe rack → 6.5 m gap (sprint required)
 *   B  land → mantle 2.1 m penthouse (or hop the AC unit)          [CP]
 *   C  3 m drop → long run → wall-run the neighbour facade over an 8.5 m gap
 *        shortcut: mantle the tall AC unit, sprint the beam
 *   D  mantle chain up AC units → water-tower deck                    [CP]
 *   E  5 m hard drop → vault → slide under duct → 7.5 m gap (slide-jump helps)
 *   F  finish stripes
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
const PARAPET_T = 0.3;

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
  // A lit stair-head behind the spawn: the run starts by leaving a doorway.
  // (Sits in the z band the calibration-pad bot lanes leave free.)
  kit.stairHead(-6, 0, -4.5, 0.5, A - 0.1, A + 4.2, "e", -2, { tag: "route" });
  // Obstacles span the whole roof: the vent is vaulted, the rack is slid under. No lanes.
  kit.ventBox(11.4, 12.6, A, Z0 + PARAPET_T, Z1 - PARAPET_T, 1.0);
  kit.pipeRack(20, A, Z0 + PARAPET_T, Z1 - PARAPET_T, 1.2);
  kit.acUnit(24.5, A, 5.5, 2.2, 1.3, 1.9);
  kit.roundVent("n", Z0, 8, A - 4, 1.3);

  // ---------------------------------------------------------------- B (18.5)
  const B = 18.5;
  // 6.5 m gap, 1.5 m drop: sprint required (walk-jump carries ~6.0 m).
  kit.building({ x0: 34.5, x1: 58, z0: Z0, z1: Z1, top: B, tint: kit.pickTint(1), accent: ["w", "e"], tag: "route" });
  // Penthouse block — the mantle. AC unit beside it is the slow route.
  kit.building({ x0: 44, x1: 52, z0: Z0, z1: Z1, top: B + 2.1, base: B, tint: 0x9c9993, parapet: { n: 0, s: 0, e: 0, w: 0 }, windows: false, tag: "route" });
  kit.acUnit(42.4, B, 0, 1.6, 1.0, 3.2);
  cp("Penthouse", 45, 51, B + 2.1, 47);
  kit.acUnit(55, B, -5, 2.4, 1.4, 2.0);
  // Battered piers on B's west face, either side of the landing.
  kit.buttress(-6, 34.5, 0, B - 0.5, 1.6, 2.2, 0.4, "w", { tag: "offroute" });
  kit.buttress(6, 34.5, 0, B - 0.5, 1.6, 2.2, 0.4, "w", { tag: "offroute" });

  // ---------------------------------------------------------------- C (15.5)
  const C = 15.5;
  // East edge is the take-off for the 10 m wall-run gap: open, and painted.
  kit.building({ x0: 60, x1: 90, z0: Z0, z1: Z1, top: C, tint: kit.pickTint(2), parapet: { n: 0, e: 0 }, accent: ["w", "e"], tag: "route" });
  // North parapet only along the first stretch — it stops where the wall-run begins.
  kit.box([60, C, Z0], [80, C + 1.0, Z0 + 0.3], { tint: 0xd2cec6, tag: "route" });
  cp("Long roof", 61, 66, C, 63);
  // Neighbour to the north whose south facade (z = -8.6) is the wall-run surface across the gap.
  // Ribs everywhere except that face; a lit arch in it to run past.
  kit.building({ x0: 84, x1: 100, z0: -26, z1: -8.6, top: C + 6.5, tint: 0xa39f98, windows: true, ribs: ["n", "e", "w"], parapet: { s: 0.6 }, tag: "wallrun" });
  kit.tower({ x0: 84, x1: 100, z0: -26, z1: -9.2, top: C + 34, base: C + 6.5, tint: 0xa39f98, setbacks: 1, ribs: ["n", "e", "w"], tag: "offroute" });
  // Shortcut: tall AC unit → concrete beam over the gap.
  kit.acUnit(84, C, 4.2, 2.2, 2.0, 2.6, "route");
  kit.box([85, C + 1.6, 3.8], [98.9, C + 2.0, 4.4], { tint: 0x9a968f, tag: "route" });
  kit.box([85, C + 1.2, 3.95], [98.9, C + 1.6, 4.25], { tint: 0x8a867f, collide: false });
  kit.acUnit(72, C, -5.5, 2.6, 1.3, 2.0);
  kit.acUnit(66, C, 5.5, 1.8, 1.1, 1.8);
  kit.stairHead(68, 74, 3.5, Z1 - 0.4, C - 0.1, C + 4.0, "w", 5.6, { tint: kit.pickTint(2), tag: "route" });

  // ---------------------------------------------------------------- D (15) + deck (19)
  const D = 15;
  // 8.5 m gap from C (sprint-jump alone carries ~8.2 m): the facade wall-run or the beam.
  kit.building({ x0: 98.5, x1: 120, z0: Z0, z1: Z1, top: D, tint: kit.pickTint(3), parapet: { w: 0, n: 0 }, accent: ["w"], tag: "route" });
  // North parapet only past the landing zone: the wall-run drops you onto open roof.
  kit.box([106, D, Z0], [120, D + 0.6, Z0 + PARAPET_T], { tint: 0xd2cec6, tag: "route" });
  cp("Landing", 100, 104, D, 101.5);
  kit.acUnit(105.5, D, -1.5, 2.5, 1.2, 3.0, "route");
  kit.acUnit(109, D, 0.5, 2.5, 2.4, 3.0, "route");
  kit.acUnit(112.5, D, -1.5, 2.5, 3.6, 3.0, "route");
  // Water-tower deck, flush with D's east edge.
  kit.building({ x0: 114, x1: 120, z0: -4, z1: 4, top: D + 4, base: D, tint: 0x8f8c87, parapet: { w: 0, n: 0.9, s: 0.9 }, accent: ["e"], windows: false, tag: "route" });
  cp("Deck", 114.5, 119, D + 4, 116);
  // Tank on four legs, 3.3 m clearance so a jump under it never bonks (head at 3.05 m).
  for (const [lx, lz] of [[115.6, -1.8], [115.6, 1.8], [119.2, -1.8], [119.2, 1.8]]) {
    kit.boxAt(lx, D + 4, lz, 0.3, 3.3, 0.3, { mat: "metal", tint: 0x505357 });
  }
  kit.box([115, D + 7.3, -2.4], [119.8, D + 10.3, 2.4], { mat: "metal", tint: 0x7b7e82 });
  kit.cantilever("s", Z1, 110, 5, D - 4, 3.2, { tag: "offroute", tint: kit.pickTint(3) });

  // ---------------------------------------------------------------- E (14)
  const E = 14;
  kit.building({ x0: 123, x1: 150, z0: Z0, z1: Z1, top: E, tint: kit.pickTint(4), accent: ["w", "e"], tag: "route" });
  cp("Low roof", 124, 128, E, 125.5);
  kit.ventBox(131.4, 132.6, E, Z0 + PARAPET_T, Z1 - PARAPET_T, 1.0);
  kit.pipeRack(140.5, E, Z0 + PARAPET_T, Z1 - PARAPET_T, 1.2, 2);
  kit.acUnit(145.5, E, -5.2, 2.2, 1.3, 1.7);
  kit.roundVent("n", Z0, 136, E - 3.5, 1.1);

  // ---------------------------------------------------------------- F (13) finish
  const F = 13;
  // 7.5 m gap, 1 m drop: sprint, ideally out of the slide.
  kit.building({ x0: 157.5, x1: 181, z0: Z0, z1: Z1, top: F, tint: kit.pickTint(5), accent: ["w"], tag: "route" });
  // Finish gate: a heavy arch you run through onto the painted slab.
  kit.archWall(0, -6, 6, F, F + 7, 161.4, 162.4, [{ u: 0, w: 5.2, h: 5.2 }], { tint: 0x8f8b84, tag: "route" });
  kit.box([161.4, F + 7, -6.6], [162.4, F + 7.5, 6.6], { tint: 0x8f8b84, tag: "route" });
  // Painted finish: three stripes rather than a solid slab.
  for (const sx of [163.2, 165.2, 167.2]) kit.box([sx, F, -3], [sx + 0.5, F + 0.04, 3], { mat: "paint", surface: "paint", tag: "finish" });
  const finish: Aabb = { min: [163, F - 0.5, -3], max: [169, F + 3, 3] };
  teleports.push({ pos: [160, F, 0], yaw: EAST, name: "Finish roof" });
  // Behind the finish, a stair-head with a lit door: the destination.
  kit.stairHead(173, 181, -5, 5, F - 0.1, F + 4.5, "w", 0, { tag: "route" });

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
  teleports.push({ pos: [-4, P, 2.5], yaw: Math.PI / 2, name: "Calibration pad" });

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
  const pick = () => kit.pickTint(Math.floor(rng() * 6));
  // Street canyon: masses either side of the route. Every third one is a tall ribbed tower
  // so the run reads as a slot between monoliths; the rest are low blocks with plant on top.
  for (const side of [-1, 1]) {
    let x = -70;
    let i = 0;
    while (x < 210) {
      const tall = i % 3 === 1;
      const w = tall ? 18 + rng() * 10 : 14 + rng() * 18;
      const depth = 16 + rng() * 14;
      const gap = 6 + rng() * 8;
      const z0 = side < 0 ? -14 - depth : 14;
      const z1 = z0 + depth;
      // Keep the wall-run neighbour's footprint clear.
      const clash = side < 0 && x + w > 80 && x < 104;
      if (!clash) {
        if (tall) {
          const top = 30 + rng() * 26;
          kit.tower({ x0: x, x1: x + w, z0, z1, top, tint: pick(), setbacks: rng() < 0.5 ? 1 : 2, tag: "offroute" });
          // Battered piers on the street face.
          const face = side < 0 ? "s" : "n";
          const fc = side < 0 ? z1 : z0;
          const n = 2 + Math.floor(rng() * 2);
          for (let k = 0; k < n; k++) {
            const u = x + (w * (k + 0.5)) / n;
            kit.buttress(u, fc, 0, 8 + rng() * 10, 2.0 + rng(), 2.6, 0.5, face, { tint: pick(), tag: "offroute" });
          }
          if (rng() < 0.7) kit.roundVent(face, fc, x + w / 2, 6 + rng() * 6, 1.2 + rng() * 0.6);
          if (rng() < 0.6) kit.doorway(face, fc, x + w * (0.3 + rng() * 0.4), 9 + rng() * 8, 2.4, 3.2, 2.6, { tint: pick(), tag: "offroute", porch: true });
          if (rng() < 0.6) kit.cantilever(face, fc, x + w * (0.25 + rng() * 0.5), 4 + rng() * 3, 14 + rng() * 10, 2.4 + rng() * 1.6, { tint: pick(), tag: "offroute" });
        } else {
          const top = 5 + rng() * 20;
          kit.building({ x0: x, x1: x + w, z0, z1, top, tint: pick(), parapet: { n: 0.8, s: 0.8, e: 0.8, w: 0.8 }, tag: "offroute" });
          if (rng() < 0.6) kit.acUnit(x + w / 2 + (rng() - 0.5) * w * 0.5, top, (z0 + z1) / 2 + (rng() - 0.5) * depth * 0.5, 1.6 + rng() * 1.6, 1.0 + rng() * 0.8, 1.4 + rng() * 1.2);
        }
      }
      x += w + gap;
      i++;
    }
  }
  // Sky bridges across the canyon, high above the route.
  for (const [bx, by] of [[40, 34], [92, 41], [146, 37]]) {
    kit.bridge(2, -14, 14, by, bx, 3.2, { tag: "offroute" });
  }
  // Far skyline, non-collidable, no shadows.
  for (let i = 0; i < 60; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const x = -160 + rng() * 480;
    const dist = 55 + rng() * 220;
    const z = side * dist;
    const w = 16 + rng() * 34;
    const d = 16 + rng() * 34;
    const h = 14 + rng() * 70 * (dist / 250);
    kit.tower({ x0: x, x1: x + w, z0: z - d / 2, z1: z + d / 2, top: h, tint: pick(), setbacks: h > 40 ? 1 : 0, detail: "far", collide: false, shadow: false });
  }
  // A few tall towers straight ahead so the run has a destination on the horizon.
  for (const [x, z, w, h] of [[230, -30, 26, 72], [262, 22, 30, 88], [300, -12, 34, 64], [215, 60, 24, 50]]) {
    kit.tower({ x0: x, x1: x + w, z0: z - w / 2, z1: z + w / 2, top: h, tint: kit.pickTint(2), setbacks: 2, detail: "far", collide: false, shadow: false });
  }
}
