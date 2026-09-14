/**
 * First-person body. Owns position, velocity, yaw/pitch and the locomotion state machine.
 * Runs inside the fixed step; the camera rig reads it at render time with interpolation.
 *
 * Milestone 1: ground / air with sprint-by-default (Shift walks), jump, coyote time, jump buffering, auto step-up,
 * landing classification and stride tracking. Parkour moves (mantle, slide, wall-run) plug in
 * as additional states in `src/player/moves/`.
 */
import * as THREE from "three";
import { clamp, moveToward, smoothstep } from "../core/math";
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
  /** Mantle started; `height` is the ledge height climbed, `duration` seconds. */
  onMantle?: (height: number, duration: number) => void;
  onSlideStart?: (speed: number) => void;
  onSlideEnd?: () => void;
  /** `side` is -1 when the wall is on the left, +1 on the right. */
  onWallRunStart?: (side: -1 | 1) => void;
  onWallRunEnd?: () => void;
  onWallJump?: () => void;
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
  height: number = PLAYER.height;
  /** Continuous stride counter (distance / stride length). Fractional part = bob phase. */
  stride = 0;
  /** 0..1 blend toward sprint speed (drives FOV). */
  sprintBlend = 0;
  events: PlayerEvents = {};

  private coyote = 0;
  private jumpBuffer = 0;
  private wasGrounded = false;
  private lastStrideInt = 0;

  // Mantle: scripted motion from `mFrom` to `mTo` over `mDuration`.
  private readonly mFrom = new THREE.Vector3();
  private readonly mTo = new THREE.Vector3();
  private mT = 0;
  private mDuration = 0.3;
  /** Height of the ledge being mantled (for the arm reach). */
  mantleLedge = 0;
  /**
   * World point on the lip being mantled: on the face plane, at the lip top, centred on the
   * body. The hands plant here (offset sideways) and stay put while the body climbs past.
   */
  readonly mantleLip = new THREE.Vector3();
  /** Unit horizontal direction from the body into the mantled face (world). */
  readonly mantleDir = new THREE.Vector3(0, 0, -1);
  /** Which side the wall is on while wall-running, relative to facing (0 = none). */
  wallSide: -1 | 0 | 1 = 0;
  /** Unit normal of the wall being run, pointing out of the wall toward the body (world). */
  readonly wallNormal = new THREE.Vector3();

  /** 0..1 through the current mantle (0 when not mantling). */
  get mantleT(): number {
    return this.state === "mantle" ? this.mT : 0;
  }
  private readonly mExit = new THREE.Vector2();

  // Slide / crouch.
  crouched = false;
  sliding = false;
  private slideTime = 0;
  private slideCool = 0;

  // Wall-run.
  private wall: Collider | null = null;
  /** Axis perpendicular to the wall face (0 = wall is at ±x, 2 = wall is at ±z). */
  private wallAxis: 0 | 2 = 0;
  /** +1 if the wall lies on the positive side of `wallAxis`. */
  private wallDir = 1;
  private wallTime = 0;
  /** World coordinate of the wall face along `wallAxis`. */
  private wallCoord = 0;
  private wallCool = 0;
  private lastWallFace: { axis: 0 | 2; dir: number; coord: number } | null = null;
  private wallChain = 0;
  /** Wall-runs need a deliberate jump; walking off a ledge beside a wall does not attach. */
  private jumpedSinceGround = false;
  private readonly probe: Aabb = { min: [0, 0, 0], max: [0, 0, 0] };
  private readonly hits: Collider[] = [];
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

  /** Seconds spent on the current wall (0 when not wall-running). */
  get wallRunTime(): number {
    return this.wall ? this.wallTime : 0;
  }

  /**
   * Closest point on the wall being run to world point `p`, written to `out`. Returns false
   * (and leaves `out` alone) when not wall-running.
   */
  wallPoint(p: THREE.Vector3, out: THREE.Vector3): boolean {
    if (!this.wall) return false;
    out.copy(p);
    if (this.wallAxis === 0) out.x = this.wallCoord;
    else out.z = this.wallCoord;
    return true;
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
    this.crouched = false;
    this.sliding = false;
    this.height = PLAYER.height;
    this.detachWall();
    this.lastWallFace = null;
    this.wallChain = 0;
    this.wallCool = 0;
    this.jumpedSinceGround = false;
  }

  fixedUpdate(dt: number, input: Input): void {
    this.prevPos.copy(this.pos);
    this.wasGrounded = this.grounded;

    if (this.state === "mantle") {
      this.updateMantle(dt);
      return;
    }

    // --- intent -------------------------------------------------------------------
    // Three.js convention: yaw 0 looks down -z and +x is to the right.
    this.fwd.set(-Math.sin(this.yaw), -Math.cos(this.yaw));
    this.right.set(-this.fwd.y, this.fwd.x);
    this.wish.set(0, 0).addScaledVector(this.fwd, input.moveZ).addScaledVector(this.right, input.moveX);
    const hasInput = this.wish.lengthSq() > 0;
    if (hasInput) this.wish.normalize();

    // Running is the default: any forward-ish intent (W, with or without a strafe) goes at sprint
    // speed unless Shift is held to walk. Pure strafing and backpedalling stay at walking pace.
    const sprinting = !input.walk && input.moveZ > 0 && !this.crouched;
    this.sprintBlend = moveToward(this.sprintBlend, sprinting && hasInput ? 1 : 0, dt / 0.25);

    if (input.consume("jump")) this.jumpBuffer = PLAYER.jumpBuffer;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    // --- slide / crouch state -------------------------------------------------------
    this.slideCool = Math.max(0, this.slideCool - dt);
    const wantSlide = input.slideHeld;
    if (!this.sliding && this.grounded && wantSlide && this.slideCool <= 0 && this.speed >= PLAYER.slideMinSpeed) {
      this.startSlide();
    }
    if (this.sliding && this.grounded) this.slideTime += dt;
    if (this.sliding && (!wantSlide || (this.grounded && this.speed < PLAYER.slideEndSpeed))) {
      this.sliding = false;
      this.slideCool = PLAYER.slideCooldown;
      this.events.onSlideEnd?.();
    }
    // Holding Ctrl in the air means "slide on landing", not "stay small".
    if (this.crouched && !this.sliding && (!wantSlide || !this.grounded)) this.tryStand();

    const targetSpeed = this.crouched ? PLAYER.crouchSpeed : sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;

    // --- horizontal velocity --------------------------------------------------------
    this.hvel.set(this.vel.x, this.vel.z);
    if (this.grounded && this.sliding) {
      // Slide: low friction that bites after `slideFreshTime`; gentle steering only.
      const s = this.hvel.length();
      const fr = this.slideTime < PLAYER.slideFreshTime ? PLAYER.slideFrictionFresh : PLAYER.slideFriction;
      if (s > 0) {
        this.hvel.multiplyScalar(Math.max(0, s - fr * dt) / s);
        if (hasInput) {
          const cur = Math.atan2(this.hvel.y, this.hvel.x);
          const want = Math.atan2(this.wish.y, this.wish.x);
          let d = want - cur;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          const turn = clamp(d, -PLAYER.slideSteer * dt, PLAYER.slideSteer * dt);
          const sp = this.hvel.length();
          this.hvel.set(Math.cos(cur + turn) * sp, Math.sin(cur + turn) * sp);
        }
      }
    } else if (this.grounded) {
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

    // --- wall-run -----------------------------------------------------------------
    this.wallCool = Math.max(0, this.wallCool - dt);
    if (this.grounded) {
      this.lastWallFace = null;
      this.wallChain = 0;
      this.jumpedSinceGround = false;
    }
    if (
      !this.wall &&
      !this.grounded &&
      !this.crouched &&
      this.jumpedSinceGround &&
      this.wallCool <= 0 &&
      input.moveZ > 0 &&
      this.vel.y > PLAYER.wallMaxFall
    ) {
      this.tryWallRun();
    }
    if (this.wall) {
      this.wallTime += dt;
      // Hold speed along the wall (light drag), kill the component into it.
      const along = this.wallAxis === 0 ? 2 : 0;
      const v = along === 0 ? this.vel.x : this.vel.z;
      const nv = Math.sign(v) * Math.max(0, Math.abs(v) - PLAYER.wallDrag * dt);
      if (along === 0) this.vel.x = nv;
      else this.vel.z = nv;
      if (this.wallAxis === 0) this.vel.x = this.wallDir * 0.6; // gentle press into the wall
      else this.vel.z = this.wallDir * 0.6;
      this.hvel.set(this.vel.x, this.vel.z);

      if (this.jumpBuffer > 0) {
        this.wallJump();
      } else if (this.wallTime > PLAYER.wallMaxTime || Math.abs(nv) < PLAYER.wallMinSpeed * 0.6 || !this.wallStillThere()) {
        this.detachWall();
      }
    }

    // --- jump ---------------------------------------------------------------------
    if (this.grounded) this.coyote = PLAYER.coyoteTime;
    else this.coyote = Math.max(0, this.coyote - dt);

    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
      this.vel.y = JUMP_SPEED;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.jumpedSinceGround = true;
      if (this.sliding) {
        // Slide-jump: keep the slide speed, stand up in the air.
        this.sliding = false;
        this.slideCool = PLAYER.slideCooldown;
        this.events.onSlideEnd?.();
      }
      if (this.crouched) this.tryStand();
      this.events.onJump?.();
    }

    // --- gravity ------------------------------------------------------------------
    let g = PLAYER.gravity;
    if (this.wall) {
      const k = clamp(this.wallTime / PLAYER.wallGravityRamp, 0, 1);
      g *= PLAYER.wallGravityStart + (1 - PLAYER.wallGravityStart) * k * k;
    }
    this.vel.y = Math.max(this.vel.y - g * dt, -PLAYER.terminalVelocity);

    // --- resolve ------------------------------------------------------------------
    this.writeBox();
    this.moveHorizontal(0, this.vel.x * dt);
    if ((this.state as MoveState) === "mantle") return; // moveHorizontal started a mantle
    this.moveHorizontal(2, this.vel.z * dt);
    if ((this.state as MoveState) === "mantle") return;

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
        if (this.wall) this.detachWall();
        if (!this.wasGrounded) this.events.onLand?.(-vyBefore, hitY.surface);
      }
      this.vel.y = 0;
    } else {
      this.grounded = false;
    }
    this.readBox();

    // Standing up while airborne if the slide ended mid-air and there is room.
    if (this.crouched && !this.sliding && (!wantSlide || !this.grounded)) this.tryStand();

    this.state = this.grounded ? (this.sliding ? "slide" : "ground") : this.wall ? "wallrun" : "air";

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

    const feetY = this.box.min[1];
    const top = this.obstacleTop(axis, Math.sign(delta), hit);
    const ledge = top - feetY;

    // Mantle: chest-high (or, mid-jump, anything within reach) while pushing into the face.
    if (ledge > PLAYER.stepHeight && ledge <= PLAYER.mantleMaxHeight && !this.sliding && !this.crouched) {
      const wishAlong = axis === 0 ? this.wish.x : this.wish.y;
      if (wishAlong * Math.sign(delta) > 0.4 && this.tryMantle(axis, Math.sign(delta), hit, top)) return;
    }

    // Rising past a kerb-height lip (jumped just before the edge): hold speed, we clear it next tick.
    if (ledge > 0 && ledge <= PLAYER.stepHeight && !this.grounded && this.vel.y > 0.5) return;

    // Step-up: only when the blocker's top is within reach and we are on or near the ground.
    if (ledge > 0 && ledge <= PLAYER.stepHeight) {
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

  /**
   * Top of the obstruction we just hit, following stacked colliders that share the face
   * (building mass + roof slab, parapet + paint layer) so a 6 cm veneer never hides a ledge.
   * Only the chain that starts at `hit` counts: a pipe 1.2 m above a kerb is not part of it.
   */
  private obstacleTop(axis: 0 | 2, dir: number, hit: Collider): number {
    this.copyBox(this.box, this.probe);
    const face = dir > 0 ? this.box.max[axis] : this.box.min[axis];
    this.probe.min[axis] = dir > 0 ? face : face - 0.05;
    this.probe.max[axis] = dir > 0 ? face + 0.05 : face;
    this.probe.min[1] = this.box.min[1] - 0.01;
    this.probe.max[1] = this.box.min[1] + PLAYER.mantleMaxHeight + 0.5;
    this.hits.length = 0;
    this.world.query(this.probe, this.hits);
    let top = hit.max[1];
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of this.hits) {
        if (c.min[1] <= top + 0.03 && c.max[1] > top) {
          top = c.max[1];
          grew = true;
        }
      }
    }
    return top;
  }

  /** Try to start a mantle onto the obstruction whose top is at `top`, approached along `axis`. */
  private tryMantle(axis: 0 | 2, dir: number, hit: Collider, top: number): boolean {
    const w = PLAYER.radius * 2;
    const ledge = top - this.box.min[1];
    this.copyBox(this.box, this.saved);
    // Target: standing on the ledge, inset just past its face, at full height.
    this.saved.min[axis] = dir > 0 ? hit.min[axis] + PLAYER.mantleInset : hit.max[axis] - PLAYER.mantleInset - w;
    this.saved.max[axis] = this.saved.min[axis] + w;
    this.saved.min[1] = top + 0.02;
    this.saved.max[1] = this.saved.min[1] + PLAYER.height;
    if (this.world.overlapsAny(this.saved)) return false;

    // Is there floor past the lip? On a thin parapet with a drop behind it we still climb,
    // but stop on top instead of being flung over the edge.
    this.copyBox(this.saved, this.probe);
    this.probe.min[axis] += dir * PLAYER.mantleFloorReach;
    this.probe.max[axis] += dir * PLAYER.mantleFloorReach;
    const floorBeyond = this.world.overlapsAny(this.probe) !== null || this.world.probeDown(this.probe, PLAYER.mantleFloorDrop) !== null;

    const r = PLAYER.radius;
    this.readBox();
    this.mFrom.copy(this.pos);
    this.mTo.set(this.saved.min[0] + r, this.saved.min[1], this.saved.min[2] + r);
    const k = clamp((ledge - PLAYER.stepHeight) / (PLAYER.mantleMaxHeight - PLAYER.stepHeight), 0, 1);
    this.mDuration = PLAYER.mantleDurationMin + (PLAYER.mantleDurationMax - PLAYER.mantleDurationMin) * k;
    this.mT = 0;
    this.mantleLedge = ledge;
    // Lip anchor for the hands: on the face plane, at the lip, centred on the body.
    const face = dir > 0 ? hit.min[axis] : hit.max[axis];
    this.mantleLip.set(this.pos.x, top, this.pos.z);
    this.mantleDir.set(0, 0, 0);
    if (axis === 0) {
      this.mantleLip.x = face;
      this.mantleDir.x = dir;
    } else {
      this.mantleLip.z = face;
      this.mantleDir.z = dir;
    }

    // Keep some approach speed, redirected over the ledge.
    const approach = floorBeyond ? clamp(this.speed * PLAYER.mantleKeep, 3, 7) : 0;
    this.mExit.set(0, 0);
    if (axis === 0) this.mExit.x = dir * approach;
    else this.mExit.y = dir * approach;

    this.detachWall();
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.state = "mantle";
    this.events.onMantle?.(ledge, this.mDuration);
    return true;
  }

  private updateMantle(dt: number): void {
    this.mT = Math.min(1, this.mT + dt / this.mDuration);
    // Grab first (a beat with the hands on the lip), pull up, then push over the lip. The
    // horizontal move trails the rise so the body clears the corner before it goes forward.
    const up = smoothstep((this.mT - 0.1) / 0.55);
    const over = smoothstep((this.mT - 0.3) / 0.7);
    this.pos.x = this.mFrom.x + (this.mTo.x - this.mFrom.x) * over;
    this.pos.z = this.mFrom.z + (this.mTo.z - this.mFrom.z) * over;
    this.pos.y = this.mFrom.y + (this.mTo.y - this.mFrom.y) * up;
    if (this.mT >= 1) {
      this.pos.copy(this.mTo);
      this.vel.set(this.mExit.x, 0, this.mExit.y);
      this.grounded = true;
      this.wasGrounded = true;
      this.state = "ground";
    }
  }

  /** Look for a runnable wall beside the body and attach to it. */
  private tryWallRun(): boolean {
    this.writeBox();
    for (const axis of [0, 2] as const) {
      const along = axis === 0 ? 2 : 0;
      const vAlong = along === 0 ? this.vel.x : this.vel.z;
      if (Math.abs(vAlong) < PLAYER.wallMinSpeed) continue;
      const vInto = axis === 0 ? this.vel.x : this.vel.z;
      for (const dir of [1, -1]) {
        // Moving away from this side: not a candidate.
        if (vInto * dir < -0.8) continue;
        this.copyBox(this.box, this.probe);
        if (dir > 0) {
          this.probe.min[axis] = this.box.max[axis];
          this.probe.max[axis] = this.box.max[axis] + PLAYER.wallProbe;
        } else {
          this.probe.max[axis] = this.box.min[axis];
          this.probe.min[axis] = this.box.min[axis] - PLAYER.wallProbe;
        }
        // Only the upper body counts: kerbs and rails are not walls.
        this.probe.min[1] = this.box.min[1] + this.height * 0.45;
        this.hits.length = 0;
        this.world.query(this.probe, this.hits);
        let best: Collider | null = null;
        for (const c of this.hits) {
          if (c.max[1] < this.box.min[1] + this.height * 0.9) continue; // must reach above the head-ish
          // Never re-attach to the face plane we just left (segmented facades share one plane).
          const cFace = dir > 0 ? c.min[axis] : c.max[axis];
          const lf = this.lastWallFace;
          if (lf && lf.axis === axis && lf.dir === dir && Math.abs(lf.coord - cFace) < 0.05) continue;
          if (!best || c.max[1] > best.max[1]) best = c;
        }
        if (!best) continue;

        this.wall = best;
        this.wallAxis = axis;
        this.wallDir = dir;
        this.wallTime = 0;
        // Snap flush to the face and kick upward a little.
        const face = dir > 0 ? best.min[axis] : best.max[axis];
        this.lastWallFace = { axis, dir, coord: face };
        this.wallCoord = face;
        this.wallNormal.set(0, 0, 0);
        if (axis === 0) this.wallNormal.x = -dir;
        else this.wallNormal.z = -dir;
        const r = PLAYER.radius;
        if (axis === 0) this.pos.x = face - dir * (r + 0.005);
        else this.pos.z = face - dir * (r + 0.005);
        this.vel.y = Math.max(this.vel.y * PLAYER.wallKeepUp, PLAYER.wallKick);
        this.jumpBuffer = 0; // a press buffered before contact must not fire a same-tick wall-jump
        // Side relative to facing: wall on the right if its direction matches `right`.
        const rightAlong = axis === 0 ? this.right.x : this.right.y;
        this.wallSide = rightAlong * dir > 0 ? 1 : -1;
        this.events.onWallRunStart?.(this.wallSide);
        return true;
      }
    }
    return false;
  }

  private wallStillThere(): boolean {
    if (!this.wall) return false;
    this.writeBox();
    this.copyBox(this.box, this.probe);
    const axis = this.wallAxis;
    if (this.wallDir > 0) {
      this.probe.min[axis] = this.box.max[axis];
      this.probe.max[axis] = this.box.max[axis] + PLAYER.wallProbe;
    } else {
      this.probe.max[axis] = this.box.min[axis];
      this.probe.min[axis] = this.box.min[axis] - PLAYER.wallProbe;
    }
    this.probe.min[1] = this.box.min[1] + this.height * 0.45;
    this.hits.length = 0;
    this.world.query(this.probe, this.hits);
    return this.hits.includes(this.wall);
  }

  private detachWall(): void {
    if (!this.wall) return;
    this.wall = null;
    this.wallSide = 0;
    this.wallCool = PLAYER.wallCooldown;
    this.events.onWallRunEnd?.();
  }

  private wallJump(): void {
    if (!this.wall) return;
    const axis = this.wallAxis;
    const push = -this.wallDir * PLAYER.wallJumpPush;
    if (axis === 0) {
      this.vel.x = push;
      this.vel.z *= PLAYER.wallJumpKeep;
    } else {
      this.vel.z = push;
      this.vel.x *= PLAYER.wallJumpKeep;
    }
    this.hvel.set(this.vel.x, this.vel.z);
    // Each successive wall-jump in one airtime lifts less, so parallel walls are not a ladder.
    this.vel.y = JUMP_SPEED * PLAYER.wallJumpUp * Math.pow(PLAYER.wallChainDecay, this.wallChain);
    this.wallChain++;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.jumpedSinceGround = true;
    this.detachWall();
    this.events.onWallJump?.();
    this.events.onJump?.();
  }

  private startSlide(): void {
    this.sliding = true;
    this.crouched = true;
    this.height = PLAYER.crouchHeight;
    this.slideTime = 0;
    const s = this.speed;
    const boosted = Math.min(s + PLAYER.slideBoost, PLAYER.slideMaxSpeed);
    if (s > 0) {
      this.vel.x *= boosted / s;
      this.vel.z *= boosted / s;
    }
    this.events.onSlideStart?.(boosted);
  }

  /** Stand up if there is headroom; otherwise stay crouched. */
  private tryStand(): void {
    const r = PLAYER.radius;
    this.saved.min[0] = this.pos.x - r;
    this.saved.min[1] = this.pos.y + 0.01;
    this.saved.min[2] = this.pos.z - r;
    this.saved.max[0] = this.pos.x + r;
    this.saved.max[1] = this.pos.y + PLAYER.height;
    this.saved.max[2] = this.pos.z + r;
    if (this.world.overlapsAny(this.saved)) return;
    this.crouched = false;
    this.height = PLAYER.height;
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
