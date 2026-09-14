/**
 * Turns the body's state into a camera: interpolated position, mouse look, stride bob,
 * landing spring, strafe lean, sprint FOV widen + additive FOV punch, and step-up smoothing.
 *
 * Everything here is cosmetic: the controller never reads the camera.
 */
import * as THREE from "three";
import { clamp, damp, DEG, moveToward, smoothstep } from "../core/math";
import type { Input } from "../core/Input";
import { PLAYER } from "./PlayerConfig";
import type { PlayerController } from "./PlayerController";

const BASE_FOV = 78;
const SPRINT_FOV_ADD = 7;
const BOB_AMP_WALK = 0.028;
const BOB_AMP_SPRINT = 0.045;
const BOB_SIDE = 0.018;
const LEAN_DEG = 1.6;
/** Wall-run: lean away from the wall by this much, eased in and out over `WALL_LEAN_TIME`. */
const WALL_LEAN_DEG = 8;
const WALL_LEAN_TIME = 0.12;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private fovPunch = 0;
  private bobAmount = 0;
  private dipY = 0;
  private dipV = 0;
  private stepOffset = 0;
  private roll = 0;
  private slideNod = 0;
  private eyeH: number = PLAYER.eyeHeight;
  /** Wall-run lean: side (-1 left wall, +1 right), 0..1 ease, and how firmly the wall holds (scales the lean). */
  private leanSide = 0;
  private leanK = 0;
  private leanOn = false;
  private leanHold = 1;
  private readonly mouse = { x: 0, y: 0 };
  private readonly tmp = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.08, 600);
  }

  /** Current landing-spring offset (negative = camera dipped). */
  get dip(): number {
    return this.dipY;
  }

  /** Called on landing: impact speed (m/s) → spring kick. */
  land(impact: number): void {
    const soft = PLAYER.softLand;
    const hard = PLAYER.hardLand;
    const t = Math.min(1, Math.max(0, (impact - soft * 0.5) / (hard - soft * 0.5)));
    this.dipV -= 0.9 + t * 3.2;
    if (impact > hard) this.punchFov(5);
  }

  punchFov(deg: number): void {
    this.fovPunch = Math.max(-12, Math.min(12, this.fovPunch + deg));
  }

  /** Teleport/respawn: drop every transient so no roll, dip or step offset survives. */
  reset(): void {
    this.dipY = 0;
    this.dipV = 0;
    this.stepOffset = 0;
    this.roll = 0;
    this.slideNod = 0;
    this.leanK = 0;
    this.leanOn = false;
    this.bobAmount = 0;
    this.eyeH = PLAYER.eyeHeight;
  }

  stepUp(dy: number): void {
    this.stepOffset -= dy;
  }

  /** Wall-run started (`side` -1 = wall on the left, +1 = right) or ended (0). */
  wallLean(side: -1 | 0 | 1): void {
    if (side !== 0) this.leanSide = side;
    this.leanOn = side !== 0;
  }

  /** Drain mouse into yaw/pitch. Runs once per render frame. */
  look(input: Input, player: PlayerController): void {
    input.drainMouse(this.mouse);
    if (this.mouse.x === 0 && this.mouse.y === 0) return;
    player.yaw -= this.mouse.x * PLAYER.mouseSensitivity;
    player.setPitch(player.pitch - this.mouse.y * PLAYER.mouseSensitivity);
  }

  update(dt: number, alpha: number, player: PlayerController, input: Input): void {
    // Landing spring (critically damped-ish).
    const k = 260;
    const c = 24;
    this.dipV += (-k * this.dipY - c * this.dipV) * dt;
    this.dipY += this.dipV * dt;

    this.stepOffset = damp(this.stepOffset, 0, 0.07, dt);

    const speed = player.speed;
    const moving = player.grounded && speed > 0.8 && !player.sliding;
    this.bobAmount = damp(this.bobAmount, moving ? 1 : 0, moving ? 0.12 : 0.2, dt);
    const amp = BOB_AMP_WALK + (BOB_AMP_SPRINT - BOB_AMP_WALK) * player.sprintBlend;
    const phase = player.stride * Math.PI * 2;
    const bobY = Math.sin(phase) * amp * this.bobAmount;
    const bobX = Math.sin(phase * 0.5) * BOB_SIDE * this.bobAmount;

    // Strafe lean from lateral velocity relative to view direction.
    const rx = Math.cos(player.yaw);
    const rz = -Math.sin(player.yaw);
    const lateral = player.vel.x * rx + player.vel.z * rz;
    // Wall lean eases in over WALL_LEAN_TIME rather than snapping, and relaxes a little as
    // the wall's grip fades through the sag (the ease-out keeps the last grip value).
    this.leanK = moveToward(this.leanK, this.leanOn ? 1 : 0, dt / WALL_LEAN_TIME);
    if (this.leanOn) this.leanHold = 0.6 + 0.4 * player.wallGrip;
    const wallRoll = -this.leanSide * WALL_LEAN_DEG * DEG * smoothstep(this.leanK) * this.leanHold;
    const targetRoll = -(lateral / PLAYER.sprintSpeed) * LEAN_DEG * DEG - input.moveX * 0.4 * DEG + wallRoll;
    this.roll = damp(this.roll, targetRoll, 0.14, dt);

    // Interpolated body position.
    this.tmp.lerpVectors(player.prevPos, player.pos, alpha);
    // Eye height follows crouch/stand with a short lag (drop fast, rise a touch slower).
    const eyeTarget = PLAYER.eyeHeight * (player.height / PLAYER.height);
    this.eyeH = damp(this.eyeH, eyeTarget, eyeTarget < this.eyeH ? 0.06 : 0.1, dt);
    this.camera.position.set(
      this.tmp.x + rx * bobX,
      this.tmp.y + this.eyeH + bobY + this.dipY + this.stepOffset,
      this.tmp.z + rz * bobX,
    );

    // Landing dip nods the view down a touch. A mantle nods down hard and early (toward the
    // hands planting on the lip), holds through the pull, then swings up as the body pushes
    // over; each arm's pull rocks the view a couple of degrees, right then left.
    const mt = player.mantleT;
    const nodK = mt <= 0 ? 0 : smoothstep(mt / 0.12) * (1 - smoothstep((mt - 0.42) / 0.45));
    const mantleNod = -0.62 * nodK;
    const mantleRoll = 2.5 * DEG * Math.sin(Math.PI * 2 * clamp((mt - 0.12) / 0.6, 0, 1));
    // Sliding looks down at the ground the trailing hand skims.
    this.slideNod = damp(this.slideNod, player.sliding && player.grounded ? -0.1 : 0, 0.12, dt);
    this.euler.set(player.pitch + this.dipY * 0.45 + mantleNod + this.slideNod, player.yaw, this.roll + mantleRoll);
    this.camera.quaternion.setFromEuler(this.euler);

    this.fovPunch *= Math.exp(-dt / 0.18);
    if (Math.abs(this.fovPunch) < 0.01) this.fovPunch = 0;
    const fov = BASE_FOV + SPRINT_FOV_ADD * player.sprintBlend + this.fovPunch;
    if (Math.abs(fov - this.camera.fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
