#!/usr/bin/env node
/**
 * Bot playtest: drives the controller through window.__parapet.key() and measures the
 * numbers the level is designed around. Run against the dev server.
 *
 *   node tools/bot.mjs                 # all tests
 *   node tools/bot.mjs --url=http://localhost:5310/
 */
import { chromium } from "playwright";
import { launchOptions } from "./gpu.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const URL = arg("url", "http://localhost:5311/");

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => window.__parapet?.ready === true, null, { timeout: 60_000 });
await page.waitForTimeout(500);

const key = (code, down) => page.evaluate(([c, d]) => window.__parapet.key(c, d), [code, down]);
const tap = async (code, ms = 60) => {
  await key(code, true);
  await page.waitForTimeout(ms);
  await key(code, false);
};
const pose = (x, y, z, yaw, pitch = 0) => page.evaluate((p) => window.__parapet.setPose(...p), [x, y, z, yaw, pitch]);
const stats = () => page.evaluate(() => window.__parapet.stats());
const releaseAll = async () => {
  for (const k of ["KeyW", "KeyA", "KeyS", "KeyD", "ShiftLeft", "Space", "ControlLeft"]) await key(k, false);
};
const sleep = (ms) => page.waitForTimeout(ms);

/** Sample stats every ~8 ms for `ms`, optionally reacting via `onSample`. */
async function sample(ms, onSample) {
  const out = [];
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await stats();
    s.t = (Date.now() - t0) / 1000;
    out.push(s);
    if (onSample && (await onSample(s)) === "stop") break;
    await sleep(6);
  }
  return out;
}

const results = [];
const report = (name, value, expect, ok) => {
  results.push({ name, value, expect, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(26)} ${value}   (expect ${expect})`);
};

// Calibration pad lane at z = -13 is free of step blocks (they start at z = -12).
const LANE = -13;

// ---- 1. sprint speed ----------------------------------------------------------------
await pose(-3, 20, LANE, 90);
await sleep(300);
await key("KeyW", true);
await key("ShiftLeft", true);
const run = await sample(1500);
await releaseAll();
const topSpeed = Math.max(...run.map((s) => s.speed));
const t85 = run.find((s) => s.speed > 8.4)?.t ?? null;
report("sprint top speed m/s", topSpeed.toFixed(2), "8.5", Math.abs(topSpeed - 8.5) < 0.1);
report("time to 8.4 m/s", t85 === null ? "never" : t85.toFixed(2) + "s", "< 0.3s", t85 !== null && t85 < 0.3);

// ---- 1b. strafe direction (yaw 0 looks -z, D must move +x) --------------------------
await pose(-3, 20, LANE + 4, 0);
await sleep(300);
await key("KeyD", true);
await sleep(400);
const strafe = await stats();
await releaseAll();
report("D strafes +x", strafe.pos[0].toFixed(2), "> -3 (moved right)", strafe.pos[0] > -2.5);

// ---- 2. jump apex ----------------------------------------------------------------------
await pose(-3, 20, LANE, 90);
await sleep(400);
const base = (await stats()).pos[1];
await tap("Space");
const jump = await sample(1100);
const apex = Math.max(...jump.map((s) => s.pos[1])) - base;
const left = jump.findIndex((s) => !s.grounded);
const landed = left >= 0 ? jump.slice(left).find((s) => s.grounded) : null;
const flicker = jump.filter((s, i) => i > 0 && s.grounded !== jump[i - 1].grounded).length;
report("jump apex m", apex.toFixed(3), "1.25", Math.abs(apex - 1.25) < 0.05);
report("airtime s", landed ? (landed.t - jump[left].t).toFixed(2) : "n/a", "0.6–0.75", landed && landed.t - jump[left].t > 0.58 && landed.t - jump[left].t < 0.78);
report("grounded transitions", flicker, "≤ 2 (no flicker)", flicker <= 2);

// ---- 3. sprint-jump range ----------------------------------------------------------
await pose(-3, 20, LANE, 90);
await sleep(300);
await key("KeyW", true);
await key("ShiftLeft", true);
let takeoff = null;
let landing = null;
let jumped = false;
await sample(3000, async (s) => {
  if (!jumped && s.pos[0] < -9) {
    jumped = true;
    await key("Space", true);
    setTimeout(() => key("Space", false), 60);
    return;
  }
  if (jumped && !takeoff && !s.grounded) takeoff = s.pos[0];
  if (takeoff !== null && landing === null && s.grounded && s.t > 0.2 && s.pos[0] < takeoff - 1) {
    landing = s.pos[0];
    return "stop";
  }
});
await releaseAll();
const range = takeoff !== null && landing !== null ? takeoff - landing : NaN;
report("sprint-jump range m", range.toFixed(2), "5.5–6.0", range > 5.4 && range < 6.1);

// ---- 4. step-up -----------------------------------------------------------------------
// Walk west into the 0.4 m step at x∈[-9,-7], z∈[-6,-4] (index 1 → z = -12+3 = -9..-7? use 0.4 block at i=1: z -9..-7)
await pose(-4, 20, -8, 90);
await sleep(300);
await key("KeyW", true);
const step = await sample(1200);
await releaseAll();
const stepY = Math.max(...step.map((s) => s.pos[1])) - 20;
report("auto step 0.4 m", stepY.toFixed(2), "0.40", Math.abs(stepY - 0.4) < 0.02);
// 0.6 m block at i=2 → z -6..-4 is above step height: it must be a mantle, not a step.
await pose(-4, 20, -5, 90);
await sleep(300);
await key("KeyW", true);
const wall = await sample(1200, (s) => (s.grounded && s.pos[1] > 20.55 ? "stop" : undefined));
await releaseAll();
const wallY = Math.max(...wall.map((s) => s.pos[1])) - 20;
const wallMantled = wall.some((s) => s.state === "mantle");
report("0.6 m block mantles", `${wallY.toFixed(2)} mantle=${wallMantled}`, "0.60 via mantle", Math.abs(wallY - 0.6) < 0.03 && wallMantled);

// ---- 5. mantle (M2) ---------------------------------------------------------------------
// 1.25 m block at i=5 → z 3..5. Walk into it: should end on top (y = 21.25).
await pose(-4, 20, 4, 90);
await sleep(300);
await key("KeyW", true);
const m1 = await sample(1500, (s) => (s.grounded && s.pos[1] > 21.2 ? "stop" : undefined));
await releaseAll();
const m1End = m1[m1.length - 1];
const m1States = new Set(m1.map((s) => s.state));
report("mantle 1.25 m (walk)", `y=${m1End.pos[1].toFixed(2)} x=${m1End.pos[0].toFixed(1)} states=${[...m1States].join(",")}`, "y=21.25, x<-7, mantle seen", Math.abs(m1End.pos[1] - 21.25) < 0.03 && m1End.pos[0] < -7 && m1States.has("mantle"));

// 2.0 m block at i=7 → z 9..11 (lane z=9.4 stays clear of the tall wall at z≥10).
// Needs a jump: press Space near the face, mantle at the apex.
await pose(-4, 20, 9.4, 90);
await sleep(300);
await key("KeyW", true);
let mj = false;
const m2 = await sample(2200, async (s) => {
  if (!mj && s.pos[0] < -5.6) {
    mj = true;
    await key("Space", true);
    setTimeout(() => key("Space", false), 60);
  }
  if (s.pos[1] > 21.9 && s.grounded && s.pos[0] < -7) return "stop";
});
await releaseAll();
const m2End = m2[m2.length - 1];
report("mantle 2.0 m (jump)", `y=${m2End.pos[1].toFixed(2)} x=${m2End.pos[0].toFixed(1)}`, "y=22.0, x<-7", Math.abs(m2End.pos[1] - 22) < 0.03 && m2End.pos[0] < -7 && m2End.grounded);

// Mantle must not trigger without pushing into the face: stand still next to the 1.0 block (i=4 → z 0..2).
await pose(-6.65, 20, 1, 90);
await sleep(600);
const idle = await stats();
report("no mantle without input", `y=${idle.pos[1].toFixed(2)} ${idle.state}`, "y=20.00", Math.abs(idle.pos[1] - 20) < 0.01);

// ---- 6. slide (M2) ----------------------------------------------------------------------
// Sprint west along the lane, slide at x < -8: expect crouch height, speed boost, and passing
// under the 1.2 m bar at x ≈ -19.3 (a standing body would be stopped there).
await pose(-3, 20, LANE, 90);
await sleep(300);
await key("KeyW", true);
await key("ShiftLeft", true);
let slid = false;
let slideStart = null;
const sl = await sample(3500, async (s) => {
  if (!slid && s.pos[0] < -8) {
    slid = true;
    slideStart = s.pos[0];
    await key("ControlLeft", true);
  }
  if (s.pos[0] < -20.5) return "stop";
});
await releaseAll();
const slEnd = sl[sl.length - 1];
const slPeak = Math.max(...sl.filter((s) => s.state === "slide").map((s) => s.speed), 0);
const slHeight = Math.min(...sl.map((s) => s.height));
const slideSamples = sl.filter((s) => s.state === "slide");
const slideDist = slideSamples.length ? slideStart - Math.min(...slideSamples.map((s) => s.pos[0])) : 0;
report("slide peak speed", slPeak.toFixed(2), "≈10.3 (8.5+1.8)", slPeak > 9.9 && slPeak < 10.6);
report("slide crouch height", slHeight.toFixed(2), "0.95", Math.abs(slHeight - 0.95) < 0.01);
report("slide passes 1.2 m bar", `x=${slEnd.pos[0].toFixed(1)} y=${slEnd.pos[1].toFixed(2)} slideDist=${slideDist.toFixed(1)}`, "x<-20.5, y=20", slEnd.pos[0] < -20.5 && Math.abs(slEnd.pos[1] - 20) < 0.01);

// Control: walking (standing) into the bar is blocked.
await pose(-16, 20, LANE, 90);
await sleep(300);
await key("KeyW", true);
await sleep(1200);
const blocked = await stats();
await releaseAll();
report("standing blocked by bar", `x=${blocked.pos[0].toFixed(2)} h=${blocked.height}`, "x≈-18.75 (stopped)", blocked.pos[0] > -18.9 && blocked.height === 1.8);

// Stand back up after releasing Ctrl in the open.
await pose(-3, 20, LANE + 2, 90);
await sleep(300);
await key("KeyW", true);
await key("ShiftLeft", true);
await sleep(700);
await key("ControlLeft", true);
await sleep(400);
const mid = await stats();
await key("ControlLeft", false);
await sleep(300);
const stood = await stats();
await releaseAll();
report("crouch → stand", `h=${mid.height} → ${stood.height}`, "0.95 → 1.8", mid.height === 0.95 && stood.height === 1.8);

// ---- 7. wall-run (M3) -------------------------------------------------------------------
// Tall wall z∈[10,10.4], x∈[-20,-2], top 26. Sprint west hugging it (body at z 9.2..9.9), jump.
await pose(-10, 20, 9.55, 90);
await sleep(300);
await key("KeyW", true);
await key("ShiftLeft", true);
let wj = false;
const wr = await sample(3000, async (s) => {
  if (!wj && s.pos[0] < -11) {
    wj = true;
    await key("Space", true);
    setTimeout(() => key("Space", false), 60);
  }
  if (wj && s.grounded && s.t > 0.6) return "stop";
});
await releaseAll();
const wrSamples = wr.filter((s) => s.state === "wallrun");
const wrTime = wrSamples.length ? wrSamples[wrSamples.length - 1].t - wrSamples[0].t : 0;
const wrApex = Math.max(...wr.map((s) => s.pos[1])) - 20;
const airStart = wr.findIndex((s) => !s.grounded);
const airEnd = airStart >= 0 ? wr.slice(airStart).findIndex((s) => s.grounded) : -1;
const airTime = airStart >= 0 && airEnd > 0 ? wr[airStart + airEnd].t - wr[airStart].t : 0;
report("wall-run attaches", `${wrSamples.length} samples, ${wrTime.toFixed(2)}s`, "> 0.5 s in wallrun", wrTime > 0.5);
report("wall-run extends air", `air ${airTime.toFixed(2)}s apex ${wrApex.toFixed(2)}m`, "air > 1.0 s, apex > 1.4 m", airTime > 1.0 && wrApex > 1.4);

// Wall-jump: attach, then press Space mid-run → pushed off the wall toward -z.
await pose(-10, 20, 9.55, 90);
await sleep(300);
await key("KeyW", true);
await key("ShiftLeft", true);
let phase = 0;
const wjr = await sample(3000, async (s) => {
  if (phase === 0 && s.pos[0] < -11) {
    phase = 1;
    await key("Space", true);
    setTimeout(() => key("Space", false), 60);
  } else if (phase === 1 && s.state === "wallrun") {
    phase = 2;
    setTimeout(async () => {
      await key("Space", true);
      setTimeout(() => key("Space", false), 60);
    }, 250);
  } else if (phase === 2 && s.grounded && s.t > 0.8) return "stop";
});
await releaseAll();
const wjEnd = wjr[wjr.length - 1];
report("wall-jump pushes off", `z=${wjEnd.pos[2].toFixed(2)} x=${wjEnd.pos[0].toFixed(1)}`, "z < 8.6 (started 9.55)", phase === 2 && wjEnd.pos[2] < 8.6);

// No attach while merely walking beside a wall on the ground.
await pose(-10, 20, 9.55, 90);
await sleep(300);
await key("KeyW", true);
await sleep(900);
const walkBy = await stats();
await releaseAll();
report("no wall-run on ground", walkBy.state, "ground", walkBy.state === "ground" && Math.abs(walkBy.pos[1] - 20) < 0.01);

// ---- 8. course A → B: vault the vent, slide under the rack, sprint the 6.5 m gap -------
await pose(3, 20, 0, -90);
await sleep(300);
await key("KeyW", true);
await key("ShiftLeft", true);
let slideOn = false;
let slideOff = false;
let j2 = false;
let takeoffSpeed = 0;
const route = await sample(7000, async (s) => {
  if (!slideOn && s.pos[0] > 16) {
    slideOn = true;
    await key("ControlLeft", true);
  }
  if (slideOn && !slideOff && s.pos[0] > 22) {
    slideOff = true;
    await key("ControlLeft", false);
  }
  if (!j2 && s.pos[0] > 27.5) {
    j2 = true;
    takeoffSpeed = s.speed;
    await key("Space", true);
    setTimeout(() => key("Space", false), 60);
  }
  if (j2 && s.grounded && s.pos[0] > 30) return "stop";
  if (s.pos[1] < 17) return "stop";
});
await releaseAll();
const end = route[route.length - 1];
const states = new Set(route.map((s) => s.state));
const onB = end.pos[0] > 34.5 && end.pos[1] > 18.45 && end.pos[1] < 18.95 && end.grounded;
report("A→B: vault, slide, gap", `x=${end.pos[0].toFixed(1)} y=${end.pos[1].toFixed(2)} v0=${takeoffSpeed.toFixed(1)} states=${[...states].join(",")}`, "on roof B, mantle+slide seen, v0>7.5", onB && states.has("mantle") && states.has("slide") && takeoffSpeed > 7.5);

// ---- 9. penthouse mantle from B (stacked mass + slab colliders) -----------------------
await pose(40, 18.5, 5, -90);
await sleep(300);
await key("KeyW", true);
await key("ShiftLeft", true);
let pj = false;
const pent = await sample(2500, async (s) => {
  if (!pj && s.pos[0] > 42.6) {
    pj = true;
    await key("Space", true);
    setTimeout(() => key("Space", false), 60);
  }
  if (pj && s.grounded && s.pos[1] > 20.5 && s.pos[0] > 44.5) return "stop";
});
await releaseAll();
const pEnd = pent[pent.length - 1];
report("penthouse mantle 2.1 m", `x=${pEnd.pos[0].toFixed(1)} y=${pEnd.pos[1].toFixed(2)} mantle=${pent.some((s) => s.state === "mantle")}`, "y=20.6 on top", pEnd.grounded && Math.abs(pEnd.pos[1] - 20.6) < 0.05 && pEnd.pos[0] > 44.5);

// ---- 10. C → D: wall-run the facade over the 9 m gap ----------------------------------
await pose(78, 15.5, -8.2, -90);
await sleep(300);
await key("KeyW", true);
await key("ShiftLeft", true);
let cj = false;
let cjT = 0;
const cd = await sample(4000, async (s) => {
  if (!cj && s.pos[0] > 89.0) {
    cj = true;
    cjT = s.t;
    await key("Space", true);
    setTimeout(() => key("Space", false), 60);
  }
  if (cj && s.grounded && s.t > cjT + 0.4) return "stop";
  if (s.pos[1] < 12) return "stop";
});
await releaseAll();
const cdEnd = cd[cd.length - 1];
const cdWall = cd.filter((s) => s.state === "wallrun");
const cdWallTime = cdWall.length ? cdWall[cdWall.length - 1].t - cdWall[0].t : 0;
report("C→D wall-run crossing", `x=${cdEnd.pos[0].toFixed(1)} y=${cdEnd.pos[1].toFixed(2)} wall=${cdWallTime.toFixed(2)}s`, "lands on D (x>98.5, y≈15 or lip 15.35), wall>0.6 s", cdEnd.grounded && cdEnd.pos[0] > 98.5 && cdEnd.pos[1] > 14.95 && cdEnd.pos[1] < 15.4 && cdWallTime > 0.6);

// ---- 11. C → D without the wall: sprint-jump alone must NOT make it -------------------
await pose(78, 15.5, 4.2 - 3, -90); // lane south of the beam, away from the facade
await sleep(300);
await key("KeyW", true);
await key("ShiftLeft", true);
let nj = false;
let njT = 0;
const nd = await sample(3500, async (s) => {
  if (!nj && s.pos[0] > 89.2) {
    nj = true;
    njT = s.t;
    await key("Space", true);
    setTimeout(() => key("Space", false), 60);
  }
  if (nj && s.grounded && s.t > njT + 0.4) return "stop";
  if (s.pos[1] < 13) return "stop";
});
await releaseAll();
const ndEnd = nd[nd.length - 1];
report("C→D needs the wall", `x=${ndEnd.pos[0].toFixed(1)} y=${ndEnd.pos[1].toFixed(2)}`, "falls short (y<13)", ndEnd.pos[1] < 13);

// ---- 12. fall → respawn at the last checkpoint ----------------------------------------
await pose(3, 20, 0, -90); // touch the Start checkpoint first
await sleep(200);
await pose(30, 20, 0, -90);
await sleep(200);
await key("KeyW", true);
const fall = await sample(4000, (s) => (s.pos[1] < 17 ? "stop" : undefined));
await releaseAll();
await sleep(2500);
const back = await stats();
report("fall → respawn", `x=${back.pos[0].toFixed(1)} y=${back.pos[1].toFixed(2)} ${back.state} fell=${fall.some((s) => s.pos[1] < 17)}`, "back on a roof, grounded", back.grounded && back.pos[1] > 12 && back.speed < 0.1);

// ---- 13. off-route: land on a neighbour, stay, and climb back --------------------------
// Leave A southward over the parapet onto the low block (top 15). No respawn: you can stay.
const until = async (pred, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await stats();
    if (pred(s)) return s;
    await sleep(6);
  }
  return null;
};
await pose(17.4, 20, -2, 180);
await sleep(300);
await key("KeyW", true);
await key("ShiftLeft", true);
await until((s) => s.pos[2] > 5.2, 3000);
await tap("Space");
const offLanded = await until((s) => s.grounded && s.pos[2] > 13, 4000);
await releaseAll();
await sleep(1200);
const offStayed = await stats();
report("off-route: land and stay", `y=${offStayed.pos[1].toFixed(2)} tag=${offStayed.groundTag} falls=${offStayed.falls}`, "grounded on offroute, no respawn", !!offLanded && offStayed.grounded && offStayed.groundTag === "offroute" && offStayed.falls === offLanded.falls);

// Back: sprint off the kerb onto the landing slab, then the ledge ladder up A's south face.
await pose(17.4, 15, 18, 0);
await sleep(300);
await key("KeyW", true);
await key("ShiftLeft", true);
await until((s) => s.pos[2] < 15.0, 3000);
await tap("Space");
const onSlab = await until((s) => s.grounded && s.pos[2] < 11 && s.pos[1] > 14.9, 3000);
await releaseAll();
// Each ledge is a mantle from the one below, alternating east/west along the face.
const climb = async (yaw, hug, y) => {
  const s = await stats();
  await pose(s.pos[0], s.pos[1], s.pos[2], yaw);
  await sleep(150);
  await key("KeyW", true);
  await key(hug, true);
  const r = await until((q) => q.grounded && q.pos[1] > y - 0.1, 3000);
  await releaseAll();
  return r;
};
const l1 = onSlab && (await climb(-90, "KeyA", 16.4));
const l2 = l1 && (await climb(90, "KeyD", 17.8));
const l3 = l2 && (await climb(-90, "KeyA", 19.2));
let backOnA = null;
if (l3) {
  const s = await stats();
  await pose(s.pos[0], s.pos[1], s.pos[2], 0);
  await sleep(150);
  await key("KeyW", true);
  await sleep(80);
  await tap("Space");
  backOnA = await until((q) => q.grounded && q.pos[1] > 19.9 && q.pos[2] < 7.7, 3000);
  await releaseAll();
}
report("off-route: climb back to A", `slab=${!!onSlab} ledges=${[l1, l2, l3].filter(Boolean).length}/3 back=${backOnA ? `y=${backOnA.pos[1].toFixed(2)} ${backOnA.groundTag}` : "no"}`, "slab, 3 ledges, roof A (route)", !!backOnA && backOnA.groundTag === "route");

await browser.close();
if (errors.length) {
  console.error("Page errors:", errors);
  process.exit(1);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
