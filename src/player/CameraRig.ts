/**
 * Turns the body's state into a camera: interpolated position, mouse look, stride bob,
 * landing spring, strafe lean, sprint FOV widen + additive FOV punch, and step-up smoothing.
 *
 * Everything here is cosmetic: the controller never reads the camera.
 */
import * as THREE from "three";
import { damp, DEG } from "../core/math";
import type { Input } from "../core/Input";
import { PLAYER } from "./PlayerConfig";
import type { PlayerController } from "./PlayerController";

const BASE_FOV = 78;
const SPRINT_FOV_ADD = 7;
const BOB_AMP_WALK = 0.028;
const BOB_AMP_SPRINT = 0.045;
const BOB_SIDE = 0.018;
const LEAN_DEG = 1.6;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private fovPunch = 0;
  private bobAmount = 0;
  private dipY = 0;
  private dipV = 0;
  private stepOffset = 0;
  private roll = 0;
  /** External roll request in radians (wall-run sets this). */
  extraRoll = 0;
  private readonly mouse = { x: 0, y: 0 };
  private readonly tmp = new THREE.Vector3();
  private readonly euler = new THREE.Euler(0, 0, 0, "YXZ");

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, aspect, 0.08, 600);
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
    this.fovPunch = Math.min(12, this.fovPunch + deg);
  }

  stepUp(dy: number): void {
    this.stepOffset -= dy;
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
    const moving = player.grounded && speed > 0.8;
    this.bobAmount = damp(this.bobAmount, moving ? 1 : 0, moving ? 0.12 : 0.2, dt);
    const amp = BOB_AMP_WALK + (BOB_AMP_SPRINT - BOB_AMP_WALK) * player.sprintBlend;
    const phase = player.stride * Math.PI * 2;
    const bobY = Math.sin(phase) * amp * this.bobAmount;
    const bobX = Math.sin(phase * 0.5) * BOB_SIDE * this.bobAmount;

    // Strafe lean from lateral velocity relative to view direction.
    const rx = Math.cos(player.yaw);
    const rz = -Math.sin(player.yaw);
    const lateral = player.vel.x * rx + player.vel.z * rz;
    const targetRoll = -(lateral / PLAYER.sprintSpeed) * LEAN_DEG * DEG - input.moveX * 0.4 * DEG + this.extraRoll;
    this.roll = damp(this.roll, targetRoll, 0.14, dt);

    // Interpolated body position.
    this.tmp.lerpVectors(player.prevPos, player.pos, alpha);
    const eye = PLAYER.eyeHeight * (player.height / PLAYER.height);
    this.camera.position.set(
      this.tmp.x + rx * bobX,
      this.tmp.y + eye + bobY + this.dipY + this.stepOffset,
      this.tmp.z + rz * bobX,
    );

    this.euler.set(player.pitch, player.yaw, this.roll);
    this.camera.quaternion.setFromEuler(this.euler);

    this.fovPunch *= Math.exp(-dt / 0.18);
    if (this.fovPunch < 0.01) this.fovPunch = 0;
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
