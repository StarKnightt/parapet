/**
 * First-person body. Owns position, velocity, yaw/pitch and the locomotion state machine.
 * Runs inside the fixed step; the camera rig reads it at render time with interpolation.
 *
 * Milestone 1: ground / air with sprint, jump, coyote time, jump buffering, auto step-up,
 * landing classification and stride tracking. Parkour moves (mantle, slide, wall-run) plug in
 * as additional states in `src/player/moves/`.
 */
import * as THREE from "three";
import { clamp, moveToward } from "../core/math";
import type { Input } from "../core/Input";
import type { Aabb, Collider, CollisionWorld, Surface } from "../world/CollisionWorld";
import { JUMP_SPEED, PLAYER } from "./PlayerConfig";

export type MoveState = "ground" | "air" | "slide" | "mantle" | "wallrun";

/** How far below the feet we look for ground while walking (keeps grounded stable over seams). */
const GROUND_SNAP = 0.08;

export interface PlayerEvents {
  onJump?: () => void;
  /** Impact speed in m/s (positive) and the surface landed on. */
  onLand?: (impact: number, surface: Surface) => void;
  onFootstep?: (surface: Surface, speed: number) => void;
  /** Body was lifted `dy` metres by the auto step; the camera smooths it away. */
  onStepUp?: (dy: number) => void;
}

export class PlayerController {
  /** Feet centre, world space. */
  readonly pos = new THREE.Vector3();
  readonly prevPos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  /** Radians. yaw 0 looks toward -z; positive yaw turns left. */
  yaw = 0;
  pitch = 0;

  state: MoveState = "air";
  grounded = false;
  groundSurface: Surface = "concrete";
  groundTag: string | undefined;
  height = PLAYER.height;
  /** Continuous stride counter (distance / stride length). Fractional part = bob phase. */
  stride = 0;
  /** 0..1 blend toward sprint speed (drives FOV). */
  sprintBlend = 0;
  events: PlayerEvents = {};

  private coyote = 0;
  private jumpBuffer = 0;
  private wasGrounded = false;
  private lastStrideInt = 0;
  private readonly box: Aabb = { min: [0, 0, 0], max: [0, 0, 0] };
  private readonly saved: Aabb = { min: [0, 0, 0], max: [0, 0, 0] };
  private readonly fwd = new THREE.Vector2();
  private readonly right = new THREE.Vector2();
  private readonly wish = new THREE.Vector2();
  private readonly hvel = new THREE.Vector2();

  constructor(private readonly world: CollisionWorld) {}

  /** Horizontal speed, m/s. */
  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  teleport(x: number, y: number, z: number, yawRad: number): void {
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.yaw = yawRad;
    this.pitch = 0;
    this.state = "air";
    this.grounded = false;
    this.wasGrounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
  }

  fixedUpdate(dt: number, input: Input): void {
    this.prevPos.copy(this.pos);
    this.wasGrounded = this.grounded;

    // --- intent -------------------------------------------------------------------
    // Three.js convention: yaw 0 looks down -z and +x is to the right.
    this.fwd.set(-Math.sin(this.yaw), -Math.cos(this.yaw));
    this.right.set(-this.fwd.y, this.fwd.x);
    this.wish.set(0, 0).addScaledVector(this.fwd, input.moveZ).addScaledVector(this.right, input.moveX);
    const hasInput = this.wish.lengthSq() > 0;
    if (hasInput) this.wish.normalize();

    const sprinting = input.sprint && input.moveZ > 0;
    const targetSpeed = sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    this.sprintBlend = moveToward(this.sprintBlend, sprinting && hasInput ? 1 : 0, dt / 0.25);

    if (input.consume("jump")) this.jumpBuffer = PLAYER.jumpBuffer;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    // --- horizontal velocity --------------------------------------------------------
    this.hvel.set(this.vel.x, this.vel.z);
    if (this.grounded) {
      if (hasInput) {
        const tx = this.wish.x * targetSpeed;
        const ty = this.wish.y * targetSpeed;
        const dx = tx - this.hvel.x;
        const dy = ty - this.hvel.y;
        const dist = Math.hypot(dx, dy);
        const maxStep = PLAYER.groundAccel * dt;
        if (dist <= maxStep) {
          this.hvel.set(tx, ty);
        } else {
          this.hvel.x += (dx / dist) * maxStep;
          this.hvel.y += (dy / dist) * maxStep;
        }
      } else {
        const s = this.hvel.length();
        if (s > 0) this.hvel.multiplyScalar(Math.max(0, s - PLAYER.groundFriction * dt) / s);
      }
    } else if (hasInput) {
      const cur = this.hvel.length();
      const cap = Math.max(cur, targetSpeed);
      this.hvel.addScaledVector(this.wish, PLAYER.airAccel * dt);
      const n = this.hvel.length();
      if (n > cap) this.hvel.multiplyScalar(cap / n);
    }
    this.vel.x = this.hvel.x;
    this.vel.z = this.hvel.y;

    // --- jump ---------------------------------------------------------------------
    if (this.grounded) this.coyote = PLAYER.coyoteTime;
    else this.coyote = Math.max(0, this.coyote - dt);

    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
      this.vel.y = JUMP_SPEED;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.events.onJump?.();
    }

    // --- gravity ------------------------------------------------------------------
    this.vel.y = Math.max(this.vel.y - PLAYER.gravity * dt, -PLAYER.terminalVelocity);

    // --- resolve ------------------------------------------------------------------
    this.writeBox();
    this.moveHorizontal(0, this.vel.x * dt);
    this.moveHorizontal(2, this.vel.z * dt);

    // Vertical. When we were grounded and are not rising, probe a little further down than
    // gravity alone would move us so the body stays glued to the roof (no grounded flicker);
    // if nothing is there, only the true gravity displacement is kept.
    const vyBefore = this.vel.y;
    const dy = this.vel.y * dt;
    let hitY: Collider | null;
    if (this.wasGrounded && this.vel.y <= 0) {
      const snap = Math.min(dy, -GROUND_SNAP);
      const y0 = this.box.min[1];
      hitY = this.world.moveAxis(this.box, 1, snap);
      if (!hitY) {
        const h = this.box.max[1] - this.box.min[1];
        this.box.min[1] = y0 + dy;
        this.box.max[1] = this.box.min[1] + h;
      }
    } else {
      hitY = this.world.moveAxis(this.box, 1, dy);
    }
    if (hitY) {
      if (this.vel.y < 0) {
        this.grounded = true;
        this.groundSurface = hitY.surface;
        this.groundTag = hitY.tag;
        if (!this.wasGrounded) this.events.onLand?.(-vyBefore, hitY.surface);
      }
      this.vel.y = 0;
    } else {
      this.grounded = false;
    }
    this.readBox();

    this.state = this.grounded ? "ground" : "air";

    // --- stride -------------------------------------------------------------------
    if (this.grounded) {
      const s = this.speed;
      if (s > 0.8) {
        const strideLen = PLAYER.strideWalk + (PLAYER.strideSprint - PLAYER.strideWalk) * this.sprintBlend;
        this.stride += (s * dt) / strideLen;
        const n = Math.floor(this.stride);
        if (n !== this.lastStrideInt) {
          this.lastStrideInt = n;
          this.events.onFootstep?.(this.groundSurface, s);
        }
      }
    }
  }

  /** Move along X or Z with wall sliding and automatic step-up. */
  private moveHorizontal(axis: 0 | 2, delta: number): void {
    if (delta === 0) return;
    const startPos = this.box.min[axis];
    const hit = this.world.moveAxis(this.box, axis, delta);
    if (!hit) return;
    const moved = this.box.min[axis] - startPos;
    const remaining = delta - moved;

    // Step-up: only when the blocker's top is within reach and we are on or near the ground.
    const feetY = this.box.min[1];
    const ledge = hit.max[1] - feetY;
    if (ledge > 0 && ledge <= PLAYER.stepHeight && (this.grounded || this.vel.y <= 0.5)) {
      this.copyBox(this.box, this.saved);
      const up = this.world.moveAxis(this.box, 1, ledge + 0.01);
      if (!up) {
        const before = this.box.min[axis];
        this.world.moveAxis(this.box, axis, remaining);
        const progressed = Math.abs(this.box.min[axis] - before) > 1e-4;
        const down = this.world.moveAxis(this.box, 1, -(ledge + 0.01));
        if (progressed && down && this.box.min[1] > this.saved.min[1] + 1e-3) {
          this.events.onStepUp?.(this.box.min[1] - this.saved.min[1]);
          if (!this.grounded && this.vel.y < 0) this.vel.y = 0;
          return;
        }
      }
      this.copyBox(this.saved, this.box);
    }
    // Genuine wall: kill velocity along this axis so we slide along it.
    if (axis === 0) this.vel.x = 0;
    else this.vel.z = 0;
  }

  private writeBox(): void {
    const r = PLAYER.radius;
    this.box.min[0] = this.pos.x - r;
    this.box.min[1] = this.pos.y;
    this.box.min[2] = this.pos.z - r;
    this.box.max[0] = this.pos.x + r;
    this.box.max[1] = this.pos.y + this.height;
    this.box.max[2] = this.pos.z + r;
  }

  private readBox(): void {
    const r = PLAYER.radius;
    this.pos.set(this.box.min[0] + r, this.box.min[1], this.box.min[2] + r);
  }

  private copyBox(from: Aabb, to: Aabb): void {
    for (let i = 0; i < 3; i++) {
      to.min[i] = from.min[i];
      to.max[i] = from.max[i];
    }
  }

  /** Colliders touching the body right now (for debug/probes). */
  overlapping(out: Collider[]): Collider[] {
    this.writeBox();
    return this.world.query(this.box, out);
  }

  setPitch(p: number): void {
    const lim = PLAYER.pitchLimitDeg * (Math.PI / 180);
    this.pitch = clamp(p, -lim, lim);
  }
}
