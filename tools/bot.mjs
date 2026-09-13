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
// 0.6 m block at i=2 → z -6..-4 must NOT be stepped.
await pose(-4, 20, -5, 90);
await sleep(300);
await key("KeyW", true);
const wall = await sample(1200);
await releaseAll();
const wallY = Math.max(...wall.map((s) => s.pos[1])) - 20;
report("0.6 m block is a wall", wallY.toFixed(2), "0.00", wallY < 0.01);

// ---- 5. course A → B ------------------------------------------------------------------
await pose(3, 20, 5.3, -90);
await sleep(300);
await key("KeyW", true);
await key("ShiftLeft", true);
let j1 = false;
let j2 = false;
let minY = 99;
const route = await sample(6000, async (s) => {
  minY = Math.min(minY, s.pos[1]);
  if (!j1 && s.pos[0] > 9.9) {
    j1 = true;
    await key("Space", true);
    setTimeout(() => key("Space", false), 60);
  }
  if (!j2 && s.pos[0] > 26.6) {
    j2 = true;
    await key("Space", true);
    setTimeout(() => key("Space", false), 60);
  }
  if (s.pos[0] > 40) return "stop";
});
await releaseAll();
const end = route[route.length - 1];
const onB = end.pos[0] > 32.5 && Math.abs(end.pos[1] - 18.5) < 0.1 && end.grounded;
report("A→B: vault vent, lane, gap", `x=${end.pos[0].toFixed(1)} y=${end.pos[1].toFixed(2)} minY=${minY.toFixed(1)}`, "on roof B (y=18.5)", onB);

await browser.close();
if (errors.length) {
  console.error("Page errors:", errors);
  process.exit(1);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
