/**
 * Wires renderer, world, player, HUD and the fixed-step loop. Owns run state: timer,
 * checkpoints, respawn, finish, best time.
 */
import * as THREE from "three";
import { GameAudio } from "./audio/Audio";
import { Input } from "./core/Input";
import { Loop } from "./core/Loop";
import { Body } from "./player/Body";
import { CameraRig } from "./player/CameraRig";
import { PLAYER } from "./player/PlayerConfig";
import { PlayerController } from "./player/PlayerController";
import { Post } from "./render/Post";
import { damp } from "./core/math";
import { formatTime, Hud, type Results } from "./ui/Hud";
import { CollisionWorld, type Aabb } from "./world/CollisionWorld";
import { buildCourse, type CourseData } from "./world/Course";
import { Kit } from "./world/Kit";
import { Lighting } from "./world/Lighting";
import { createMaterials } from "./world/materials";
import { Sky } from "./world/Sky";

const BEST_KEY = "parapet.best";
const SPLITS_KEY = "parapet.splits";

/** Terse end-of-run lines; the world is empty, the voice stays dry. */
const LINES = {
  first: ["Alive. Now do it faster.", "That's a line. Not a clean one."],
  best: ["Clean.", "The city didn't see that coming.", "That one had no wasted steps."],
  slower: ["You know where you lost it.", "The roofs are patient. Again.", "Close. Not that close."],
  quick: ["No hesitation. That's the whole game.", "Nothing touched you."],
};
const pick = (arr: string[]): string => arr[Math.floor(Math.random() * arr.length)];

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly world = new CollisionWorld();
  readonly input: Input;
  readonly player: PlayerController;
  readonly rig: CameraRig;
  readonly body: Body;
  readonly hud: Hud;
  readonly lighting: Lighting;
  readonly sky: Sky;
  readonly course: CourseData;
  readonly post: Post;
  readonly audio = new GameAudio();
  private elapsed = 0;
  private lowFpsTime = 0;
  private readonly loop: Loop;

  private time = 0;
  private timerRunning = false;
  private finished = false;
  private checkpoint = 0;
  private offRouteTimer = 0;
  /** Run time at each checkpoint index (0 = start, unused). */
  private splits: number[] = [];
  /** Simulation speed; dips on the finish line for a beat of slow motion. */
  private timeScale = 1;
  private finishT = -1;
  private vignette = 0.5;
  private falls = 0;
  private fps = 60;
  private debugOn = false;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.sky = new Sky(this.renderer, this.scene);
    this.lighting = new Lighting(this.scene);

    const mats = createMaterials();
    const kit = new Kit(this.scene, this.world, mats);
    this.course = buildCourse(kit);
    kit.finalize();

    this.input = new Input(canvas);
    this.player = new PlayerController(this.world);
    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.body = new Body(this.scene);
    this.post = new Post(this.renderer, this.scene, this.rig.camera);
    this.hud = new Hud(hudRoot);
    this.hud.setBest(this.loadBest());

    this.player.events = {
      onLand: (impact, surface) => {
        this.rig.land(impact);
        this.audio.land(impact, surface);
      },
      onStepUp: (dy) => this.rig.stepUp(dy),
      onJump: () => this.audio.jump(),
      onFootstep: (surface, speed) => this.audio.footstep(surface, speed),
      onMantle: (height) => {
        this.rig.punchFov(3);
        this.audio.mantle(height);
      },
      onSlideStart: () => {
        this.rig.punchFov(4);
        this.audio.slideStart();
      },
      // Lean away from the wall while running it.
      onWallRunStart: (side) => (this.rig.extraRoll = -side * 8 * (Math.PI / 180)),
      onWallRunEnd: () => (this.rig.extraRoll = 0),
      onWallJump: () => {
        this.rig.punchFov(4);
        this.audio.wallJump();
      },
    };
    this.input.onLockChange = (locked) => {
      this.hud.setLocked(locked);
      if (locked) {
        this.hud.fadeHint();
        // First time in: name the line while the player is still standing at the start.
        if (!this.timerRunning && this.time === 0) this.showTitle();
      }
    };
    this.input.onGesture = () => this.audio.start();

    this.restart();
    window.addEventListener("resize", () => this.resize());
    this.loop = new Loop((dt) => this.fixedUpdate(dt), (dt, alpha) => this.frameUpdate(dt, alpha));
  }

  start(): void {
    this.loop.start();
  }

  // ---------------------------------------------------------------- run state

  restart(manual = false): void {
    const s = this.course.spawn;
    this.player.teleport(s.pos[0], s.pos[1] + 0.05, s.pos[2], s.yaw);
    this.rig.reset();
    this.checkpoint = 0;
    this.time = 0;
    this.timerRunning = false;
    this.finished = false;
    this.finishT = -1;
    this.timeScale = 1;
    this.splits = [];
    this.falls = 0;
    this.hud.setTimer(0, false);
    this.hud.showHint();
    this.hud.hideResults();
    if (manual) {
      this.hud.flash(false);
      this.audio.restart();
      this.showTitle();
    }
  }

  private showTitle(): void {
    const best = this.loadBest();
    this.hud.showTitle("the concrete line", best === null ? "six roofs · one line · timer starts when you move" : `best ${formatTime(best)} · timer starts when you move`);
  }

  private respawn(): void {
    const cp = this.course.checkpoints[this.checkpoint] ?? { spawn: this.course.spawn.pos, yaw: this.course.spawn.yaw };
    this.player.teleport(cp.spawn[0], cp.spawn[1] + 0.05, cp.spawn[2], cp.yaw);
    this.rig.reset();
    this.rig.punchFov(-6);
    this.falls++;
    this.hud.flash(true);
    this.audio.respawn();
    const name = this.course.checkpoints[this.checkpoint]?.name;
    if (name) this.hud.showToast(`back to ${name}`, 1.2);
  }

  private inside(box: Aabb, p: THREE.Vector3): boolean {
    return p.x > box.min[0] && p.x < box.max[0] && p.y > box.min[1] && p.y < box.max[1] && p.z > box.min[2] && p.z < box.max[2];
  }

  private loadBest(): number | null {
    const v = Number(localStorage.getItem(BEST_KEY));
    return v > 0 ? v : null;
  }

  private loadSplits(): number[] {
    try {
      const v = JSON.parse(localStorage.getItem(SPLITS_KEY) ?? "[]");
      return Array.isArray(v) ? v.map(Number) : [];
    } catch {
      return [];
    }
  }

  private finish(): void {
    this.finished = true;
    this.timerRunning = false;
    const best = this.loadBest();
    const bestSplits = this.loadSplits();
    const newBest = best === null || this.time < best;
    this.audio.finish(newBest);

    // The hit: a beat of slow motion, a wider lens, the frame closes in.
    this.timeScale = 0.18;
    this.finishT = 0;
    this.rig.punchFov(9);
    this.vignette = 0.9;

    const cps = this.course.checkpoints;
    const splits = [];
    for (let i = 1; i < cps.length; i++) {
      const t = this.splits[i];
      if (t === undefined) continue;
      const b = bestSplits[i];
      splits.push({ name: cps[i].name, time: t, delta: b ? t - b : null });
    }
    splits.push({ name: "finish", time: this.time, delta: best === null ? null : this.time - best });

    let line: string;
    if (best === null) line = pick(LINES.first);
    else if (newBest) line = pick(this.falls === 0 && this.time < 40 ? LINES.quick : LINES.best);
    else line = pick(LINES.slower);
    this.pendingResults = { time: this.time, best, newBest, splits, line };

    if (newBest) {
      localStorage.setItem(BEST_KEY, String(this.time));
      const saved = [...this.splits];
      saved[cps.length] = this.time;
      localStorage.setItem(SPLITS_KEY, JSON.stringify(saved));
      this.hud.setBest(this.time);
    }
  }
  private pendingResults: Results | null = null;

  // ---------------------------------------------------------------- loop

  private fixedUpdate(rawDt: number): void {
    if (this.input.consume("restart")) this.restart(true);
    const dt = rawDt * this.timeScale;
    if (this.input.consume("debug")) this.debugOn = this.hud.toggleDebug();
    if (this.input.consume("mute")) {
      this.audio.setMuted(!this.audio.isMuted);
      this.hud.showToast(this.audio.isMuted ? "muted" : "sound on");
    }
    const tp = this.input.drainTeleport();
    if (tp !== null && tp > 0 && this.course.teleports[tp - 1]) {
      const t = this.course.teleports[tp - 1];
      this.player.teleport(t.pos[0], t.pos[1] + 0.05, t.pos[2], t.yaw);
    }

    this.player.fixedUpdate(dt, this.input);
    const p = this.player.pos;

    if (!this.timerRunning && !this.finished && this.player.speed > 0.5) this.timerRunning = true;
    if (this.timerRunning) this.time += dt;

    // Checkpoints only advance forward.
    for (let i = this.checkpoint + 1; i < this.course.checkpoints.length; i++) {
      if (this.inside(this.course.checkpoints[i].trigger, p)) {
        this.checkpoint = i;
        this.splits[i] = this.time;
        const b = this.loadSplits()[i];
        this.hud.showSplit(this.course.checkpoints[i].name, b ? this.time - b : null);
        this.audio.checkpoint();
        break;
      }
    }
    if (!this.finished && this.inside(this.course.finish, p)) this.finish();

    // Fell off or landed somewhere off the line.
    const cpY = (this.course.checkpoints[this.checkpoint]?.spawn ?? this.course.spawn.pos)[1];
    if (p.y < cpY - PLAYER.killDepth) this.respawn();
    if (this.player.grounded && this.player.groundTag === "offroute") {
      this.offRouteTimer += dt;
      if (this.offRouteTimer > 0.35) {
        this.offRouteTimer = 0;
        this.respawn();
      }
    } else {
      this.offRouteTimer = 0;
    }
  }

  private frameUpdate(dt: number, alpha: number): void {
    this.rig.look(this.input, this.player);
    this.rig.update(dt, alpha, this.player, this.input);
    this.body.update(dt, alpha, this.player, this.rig.camera, this.rig.dip);
    this.lighting.follow(this.rig.camera.position);
    this.elapsed += dt;
    this.sky.update(this.elapsed, this.rig.camera.position);
    this.hud.update(dt);
    this.hud.setTimer(this.time, this.timerRunning);
    this.audio.update(dt, this.player.speed, this.player.grounded ? 1 : 0, this.player.sliding && this.player.grounded, this.player.state === "wallrun");

    // Finish sequence: hold the slow-mo for a beat, ease time back, then bring the card in.
    if (this.finishT >= 0) {
      this.finishT += dt;
      if (this.finishT > 0.45) this.timeScale = damp(this.timeScale, 1, 0.35, dt);
      if (this.finishT > 1.1 && this.pendingResults) {
        this.hud.showResults(this.pendingResults);
        this.pendingResults = null;
      }
    }
    this.vignette = damp(this.vignette, 0.5, 1.2, dt);

    const blur = this.player.grounded || this.player.state === "air" ? Math.max(0, (this.player.speed - 6) / 4) : 0;
    if (location.search.includes("direct")) this.renderer.render(this.scene, this.rig.camera);
    else this.post.render(Math.min(1, blur) * this.player.sprintBlend, this.elapsed, this.vignette);

    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    // Auto quality: sustained < 50 fps drops AO.
    if (this.post.getQuality() === "high") {
      this.lowFpsTime = this.fps < 50 ? this.lowFpsTime + dt : 0;
      if (this.lowFpsTime > 3) this.post.setQuality("low");
    }
    if (this.debugOn) {
      const p = this.player.pos;
      const v = this.player.vel;
      const info = this.renderer.info;
      this.hud.setDebug(
        `fps    ${this.fps.toFixed(0)}\n` +
          `state  ${this.player.state}\n` +
          `pos    ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}\n` +
          `speed  ${this.player.speed.toFixed(2)}  vy ${v.y.toFixed(2)}\n` +
          `ground ${this.player.grounded ? this.player.groundSurface : "-"} ${this.player.groundTag ?? ""}\n` +
          `cp     ${this.checkpoint} ${this.course.checkpoints[this.checkpoint]?.name ?? ""}\n` +
          `draws  ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(1)}k  post ${this.post.getQuality()}\n` +
          `boxes  ${this.world.count}`,
      );
    }
  }

  private resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.rig.resize(window.innerWidth / window.innerHeight);
    this.post.resize();
  }

  // ---------------------------------------------------------------- harness hooks

  /** Teleport for the capture harness. Angles in degrees. Hides the click-to-play overlay. */
  setPose(x: number, y: number, z: number, yawDeg: number, pitchDeg: number): void {
    this.hud.setLocked(true);
    this.hud.fadeHint();
    this.player.teleport(x, y, z, THREE.MathUtils.degToRad(yawDeg));
    this.player.setPitch(THREE.MathUtils.degToRad(pitchDeg));
  }

  key(code: string, down: boolean): void {
    this.input.inject(code, down);
  }

  setQuality(q: "high" | "low"): void {
    this.post.setQuality(q);
  }

  stats(): Record<string, unknown> {
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return {
      renderer,
      fps: Math.round(this.fps),
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      boxes: this.world.count,
      pos: this.player.pos.toArray(),
      vel: this.player.vel.toArray(),
      speed: this.player.speed,
      grounded: this.player.grounded,
      state: this.player.state,
      height: this.player.height,
      checkpoint: this.checkpoint,
      time: this.time,
      finished: this.finished,
      audio: this.audio.state,
    };
  }
}
