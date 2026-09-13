/**
 * Wires renderer, world, player, HUD and the fixed-step loop. Owns run state: timer,
 * checkpoints, respawn, finish, best time.
 */
import * as THREE from "three";
import { Input } from "./core/Input";
import { Loop } from "./core/Loop";
import { CameraRig } from "./player/CameraRig";
import { PLAYER } from "./player/PlayerConfig";
import { PlayerController } from "./player/PlayerController";
import { Post } from "./render/Post";
import { Hud } from "./ui/Hud";
import { CollisionWorld, type Aabb } from "./world/CollisionWorld";
import { buildCourse, type CourseData } from "./world/Course";
import { Kit } from "./world/Kit";
import { Lighting } from "./world/Lighting";
import { createMaterials } from "./world/materials";
import { Sky } from "./world/Sky";

const BEST_KEY = "parapet.best";

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly world = new CollisionWorld();
  readonly input: Input;
  readonly player: PlayerController;
  readonly rig: CameraRig;
  readonly hud: Hud;
  readonly lighting: Lighting;
  readonly sky: Sky;
  readonly course: CourseData;
  readonly post: Post;
  private elapsed = 0;
  private lowFpsTime = 0;
  private readonly loop: Loop;

  private time = 0;
  private timerRunning = false;
  private finished = false;
  private checkpoint = 0;
  private offRouteTimer = 0;
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
    this.post = new Post(this.renderer, this.scene, this.rig.camera);
    this.hud = new Hud(hudRoot);
    this.hud.setBest(this.loadBest());

    this.player.events = {
      onLand: (impact) => this.rig.land(impact),
      onStepUp: (dy) => this.rig.stepUp(dy),
      onJump: () => {},
      onFootstep: () => {},
    };
    this.input.onLockChange = (locked) => {
      this.hud.setLocked(locked);
      if (locked) this.hud.fadeHint();
    };

    this.restart();
    window.addEventListener("resize", () => this.resize());
    this.loop = new Loop((dt) => this.fixedUpdate(dt), (dt, alpha) => this.frameUpdate(dt, alpha));
  }

  start(): void {
    this.loop.start();
  }

  // ---------------------------------------------------------------- run state

  restart(): void {
    const s = this.course.spawn;
    this.player.teleport(s.pos[0], s.pos[1] + 0.05, s.pos[2], s.yaw);
    this.checkpoint = 0;
    this.time = 0;
    this.timerRunning = false;
    this.finished = false;
    this.hud.setTimer(0, false);
    this.hud.showHint();
  }

  private respawn(): void {
    const cp = this.course.checkpoints[this.checkpoint] ?? { spawn: this.course.spawn.pos, yaw: this.course.spawn.yaw };
    this.player.teleport(cp.spawn[0], cp.spawn[1] + 0.05, cp.spawn[2], cp.yaw);
    this.rig.punchFov(-6);
  }

  private inside(box: Aabb, p: THREE.Vector3): boolean {
    return p.x > box.min[0] && p.x < box.max[0] && p.y > box.min[1] && p.y < box.max[1] && p.z > box.min[2] && p.z < box.max[2];
  }

  private loadBest(): number | null {
    const v = Number(localStorage.getItem(BEST_KEY));
    return v > 0 ? v : null;
  }

  private finish(): void {
    this.finished = true;
    this.timerRunning = false;
    const best = this.loadBest();
    if (best === null || this.time < best) {
      localStorage.setItem(BEST_KEY, String(this.time));
      this.hud.setBest(this.time);
      this.hud.showToast("new best line", true, 3);
    } else {
      this.hud.showToast("line complete", true, 3);
    }
  }

  // ---------------------------------------------------------------- loop

  private fixedUpdate(dt: number): void {
    if (this.input.consume("restart")) this.restart();
    if (this.input.consume("debug")) this.debugOn = this.hud.toggleDebug();
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
        this.hud.showToast(this.course.checkpoints[i].name);
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
    this.lighting.follow(this.rig.camera.position);
    this.elapsed += dt;
    this.sky.update(this.elapsed, this.rig.camera.position);
    this.hud.update(dt);
    this.hud.setTimer(this.time, this.timerRunning);

    const blur = this.player.grounded || this.player.state === "air" ? Math.max(0, (this.player.speed - 6) / 4) : 0;
    if (location.search.includes("direct")) this.renderer.render(this.scene, this.rig.camera);
    else this.post.render(Math.min(1, blur) * this.player.sprintBlend, this.elapsed);

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
      checkpoint: this.checkpoint,
      time: this.time,
      finished: this.finished,
    };
  }
}
