#!/usr/bin/env node
/**
 * Headless capture: loads the running dev server (or a URL), teleports to named poses via
 * window.__parapet.setPose and writes shots/<tag>-<pose>.png. Fails on software rendering
 * or page errors.
 *
 *   node tools/shoot.mjs --tag=m1                 # all poses
 *   node tools/shoot.mjs --tag=m1 --poses=spawn,gap
 *   node tools/shoot.mjs --url=http://localhost:5310/
 */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchOptions, isSoftwareRenderer } from "./gpu.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const URL = arg("url", "http://localhost:5311/");
const TAG = arg("tag", "shot");
const ONLY = arg("poses", "").split(",").filter(Boolean);
const W = Number(arg("w", 1920));
const H = Number(arg("h", 1080));
const QUALITY = arg("quality", "high");

/** x, y (feet), z, yaw° (−90 looks +x/east), pitch° (+ up). */
const POSES = {
  spawn: { x: 2, y: 20, z: 0, yaw: -90, pitch: -4 },
  vent: { x: 8, y: 20, z: 1, yaw: -90, pitch: -8 },
  rack: { x: 15.5, y: 20, z: -1, yaw: -90, pitch: -6 },
  gapAB: { x: 25, y: 20, z: 0, yaw: -90, pitch: -12 },
  penthouse: { x: 36, y: 18.5, z: 2, yaw: -82, pitch: -2 },
  longroof: { x: 62, y: 15.5, z: 3, yaw: -90, pitch: -5 },
  wallrun: { x: 80, y: 15.5, z: -6, yaw: -78, pitch: -6 },
  stairs: { x: 101, y: 15, z: 3, yaw: -100, pitch: 2 },
  deck: { x: 116, y: 19, z: 0, yaw: -90, pitch: -14 },
  lowroof: { x: 126, y: 14, z: -2, yaw: -90, pitch: -6 },
  gapEF: { x: 147, y: 14, z: 0, yaw: -90, pitch: -10 },
  finish: { x: 159.5, y: 13, z: 0, yaw: -90, pitch: -8 },
  back: { x: 60, y: 15.5, z: -4, yaw: 90, pitch: 6 },
  overview: { x: 40, y: 60, z: 70, yaw: -60, pitch: -30 },
  pad: { x: -4, y: 20, z: 0, yaw: 90, pitch: -6 },
};

const poses = ONLY.length ? ONLY : Object.keys(POSES);
await fs.mkdir(path.join(ROOT, "shots"), { recursive: true });

const browser = await chromium.launch(launchOptions());
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__parapet?.ready === true, null, { timeout: 60_000 });
  await page.waitForTimeout(800);

  await page.evaluate((q) => window.__parapet.setQuality(q), QUALITY);
  const stats = await page.evaluate(() => window.__parapet.stats());
  console.log(`[gpu] ${stats.renderer}`);
  if (isSoftwareRenderer(stats.renderer)) throw new Error(`software renderer: ${stats.renderer}`);

  for (const name of poses) {
    const p = POSES[name];
    if (!p) {
      console.warn(`unknown pose ${name}`);
      continue;
    }
    await page.evaluate((p) => window.__parapet.setPose(p.x, p.y, p.z, p.yaw, p.pitch), p);
    await page.waitForTimeout(450);
    const file = path.join(ROOT, "shots", `${TAG}-${name}.png`);
    await page.screenshot({ path: file });
    const s = await page.evaluate(() => window.__parapet.stats());
    console.log(`${name.padEnd(10)} ${path.relative(ROOT, file)}  calls=${s.calls} tris=${s.triangles} fps~${s.fps}`);
  }
} finally {
  await browser.close();
}
if (errors.length) {
  console.error("\nPage errors/warnings:");
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}
