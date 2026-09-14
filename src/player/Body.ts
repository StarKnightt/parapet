/**
 * First-person body: two arms hung from the camera and two legs hung from the hips, all
 * procedural (capsules, tapered cylinders, capsule fingers) and posed by two-bone IK from hand
 * and foot targets that the movement state drives. Nothing here touches the simulation.
 *
 *   ground   arms pump opposite the legs at ~90° elbows, hands loosely open; idle breathes
 *   air      hands rise and spread, knees tuck; a hard landing drops both hands to "catch"
 *   mantle   reach → grab the lip (world-anchored) → pull past it → push off and follow through
 *   wallrun  inner hand planted on the wall plane, lifting and slapping down again ahead;
 *            outer arm keeps pumping; a wall-jump shoves off with both hands
 *   slide    one hand skims the ground beside the hip, the other reaches ahead for balance
 *
 * World anchors (the mantle lip, the wall plane) come from the controller and are converted
 * into the arm root's space every frame, so the hands stay glued to the ledge while the
 * camera moves. That is what makes the climb read as a climb rather than a hand animation.
 */
import * as THREE from "three";
import { clamp, damp, lerp, smoothstep } from "../core/math";
import { PLAYER } from "./PlayerConfig";
import type { PlayerController } from "./PlayerController";

const UPPER_ARM = 0.30;
const FOREARM = 0.27;
const THIGH = 0.45;
const SHIN = 0.44;
const PALM_L = 0.088;

/** Hands are kept above this many metres down per metre forward (≈36° below the view axis, inside a 78° FOV). */
const VIEW_FLOOR = 0.72;
/** Hands never come closer to the eye than this along the view axis. */
const VIEW_NEAR = 0.3;
/**
 * Wall-run hand: seconds planted before it lifts (at full grip; shortens to ~0.7× as the grip
 * fades through the sag so the cadence quickens as the run dies), lift duration, slap duration.
 */
const PLANT_HOLD = 0.34;
const PLANT_LIFT = 0.09;
const PLANT_SLAP = 0.05;
/** How far ahead of the shoulder the wall hand plants, and where it has slid back to by the lift. */
const PLANT_AHEAD = 0.78;
const PLANT_BEHIND = 0.36;
/** Wall hand plants this far below the eye. */
const PLANT_DROP = 0.22;
const CATCH_TIME = 0.32;
const PUSH_TIME = 0.26;

const Y = new THREE.Vector3(0, 1, 0);

interface Finger {
  root: THREE.Group;
  mid: THREE.Group;
  tip: THREE.Group;
  /** Curl multiplier: the pinky closes more than the index. */
  k: number;
}

interface Hand {
  group: THREE.Group;
  fingers: Finger[];
  thumb: Finger;
}

interface Arm {
  side: -1 | 1;
  upper: THREE.Mesh;
  fore: THREE.Mesh;
  wrist: THREE.Mesh;
  cuff: THREE.Mesh;
  hand: Hand;
  /** Hand target, arm-root space. */
  target: THREE.Vector3;
  /** Desired palm normal, arm-root space. */
  palm: THREE.Vector3;
  /** Desired fingertip direction, arm-root space; blended in by `dirWeight` (0 = follow the forearm). */
  fingerDir: THREE.Vector3;
  dirWeight: number;
  /** 0 = flat open hand, 1 = fist. */
  curl: number;
  /** 0 = fingers together, 1 = splayed. */
  spread: number;
  /** Time constant of the hand's approach to its target; short when planting. */
  tau: number;
}

interface Leg {
  side: -1 | 1;
  thigh: THREE.Mesh;
  shin: THREE.Mesh;
  knee: THREE.Mesh;
  foot: THREE.Group;
  target: THREE.Vector3;
}

type PlantPhase = "hold" | "lift" | "slap";

export class Body {
  /** Follows the camera (with a little lag): arms live here. */
  readonly armRoot = new THREE.Group();
  /** Follows the body position and yaw: legs live here. */
  readonly legRoot = new THREE.Group();

  private readonly arms: Arm[] = [];
  private readonly legs: Leg[] = [];
  private readonly q = new THREE.Quaternion();
  private readonly invQ = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly v4 = new THREE.Vector3();
  private readonly w1 = new THREE.Vector3();
  private readonly w2 = new THREE.Vector3();
  private readonly w3 = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private time = 0;
  private airPhase = 0;
  private hipH = 0.94;
  /** Hard-landing "catch": seconds left with both hands dropped toward the ground. */
  private catchT = 0;
  private catchK = 0;
  /** Wall-jump shove: seconds left, and which side the wall was on. */
  private pushT = 0;
  private lastWallSide: -1 | 1 = 1;
  /** Wall-run hand plant state. `y` is the world height planted at; `ahead` is metres ahead of the shoulder. */
  private readonly plant = { active: false, phase: "hold" as PlantPhase, t: 0, y: 0, ahead: PLANT_AHEAD, lift: 0 };
  private readonly mats: Record<"sleeve" | "skin" | "skinDark" | "cuff" | "trouser" | "shoe" | "sole", THREE.MeshStandardMaterial>;

  constructor(scene: THREE.Scene) {
    const mk = (color: number, roughness: number) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    this.mats = {
      sleeve: mk(0x2a2b2f, 0.92),
      skin: mk(0xb98a63, 0.68),
      // Knuckles and finger joints: a touch darker and redder, rougher.
      skinDark: mk(0xa87a57, 0.8),
      cuff: mk(0x6e7277, 0.85),
      trouser: mk(0x3a3b37, 0.95),
      shoe: mk(0x1e1f22, 0.8),
      sole: mk(0xb6b1a6, 0.9),
    };
    for (const side of [-1, 1] as const) {
      this.arms.push(this.buildArm(side));
      this.legs.push(this.buildLeg(side));
    }
    scene.add(this.armRoot, this.legRoot);
  }

  // ---------------------------------------------------------------- events

  /** Landing impact (m/s): above ~8 both hands drop forward to catch the fall for a beat. */
  land(impact: number): void {
    if (impact < 8) return;
    this.catchT = CATCH_TIME;
    this.catchK = clamp((impact - 8) / 8, 0.45, 1);
  }

  /** Wall-jump: both hands push off the wall. */
  wallJump(): void {
    this.pushT = PUSH_TIME;
  }

  /** Hand positions in arm-root (≈camera) space, for the debug readout. */
  handPositions(): number[][] {
    return this.arms.map((a) => a.hand.group.position.toArray().map((v) => Math.round(v * 1000) / 1000));
  }

  /** Teleport/respawn: drop every transient. */
  reset(): void {
    this.catchT = 0;
    this.pushT = 0;
    this.plant.active = false;
  }

  // ---------------------------------------------------------------- construction

  private mesh(geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.receiveShadow = false;
    m.frustumCulled = false;
    parent.add(m);
    return m;
  }

  private buildArm(side: -1 | 1): Arm {
    const upper = this.mesh(new THREE.CapsuleGeometry(0.052, UPPER_ARM - 0.104, 4, 10), this.mats.sleeve, this.armRoot);
    const fore = this.mesh(new THREE.CylinderGeometry(0.036, 0.05, FOREARM - 0.03, 12), this.mats.sleeve, this.armRoot);
    const cuff = this.mesh(new THREE.CylinderGeometry(0.04, 0.041, 0.05, 12), this.mats.cuff, this.armRoot);
    const wrist = this.mesh(new THREE.SphereGeometry(0.033, 12, 8), this.mats.skin, this.armRoot);
    wrist.scale.set(1.1, 0.8, 1);
    const hand = this.buildHand();
    if (side < 0) hand.group.scale.x = -1; // left hand is the mirror of the right
    this.armRoot.add(hand.group);
    return {
      side,
      upper,
      fore,
      wrist,
      cuff,
      hand,
      target: new THREE.Vector3(side * 0.26, -0.4, -0.42),
      palm: new THREE.Vector3(-side, -0.4, 0),
      fingerDir: new THREE.Vector3(0, 0, -1),
      dirWeight: 0,
      curl: 0.3,
      spread: 0.1,
      tau: 0.05,
    };
  }

  /**
   * Right hand frame: +z toward fingertips, +y back of hand, +x thumb side. Origin at the wrist.
   * Palm is a box tapered from the wrist (narrow, thick) to the knuckles (wide, flat); fingers
   * are three capsule phalanges each so the joints read as knuckles; the thumb hangs off a
   * pad on the heel of the palm, opposed to the fingers.
   */
  private buildHand(): Hand {
    const group = new THREE.Group();
    const palmGeo = new THREE.BoxGeometry(1, 1, 1);
    const pos = palmGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getZ(i) + 0.5;
      pos.setXYZ(i, pos.getX(i) * lerp(0.062, 0.086, t), pos.getY(i) * lerp(0.031, 0.022, t), t * PALM_L);
    }
    palmGeo.computeVertexNormals();
    this.mesh(palmGeo, this.mats.skin, group);
    const pad = this.mesh(new THREE.SphereGeometry(1, 10, 7), this.mats.skin, group);
    pad.scale.set(0.022, 0.013, 0.032);
    pad.position.set(0.027, -0.008, 0.032);

    // Index → pinky along -x. Lengths are proximal / middle / distal phalanges.
    const xs = [0.031, 0.0105, -0.0105, -0.031];
    const ys = [0.0, 0.002, 0.001, -0.002];
    const lens: [number, number, number][] = [[0.040, 0.025, 0.020], [0.044, 0.028, 0.022], [0.041, 0.026, 0.021], [0.032, 0.020, 0.018]];
    const radii = [0.0085, 0.0085, 0.008, 0.007];
    const ks = [0.9, 1.0, 1.05, 1.15];
    const fingers: Finger[] = [];
    for (let i = 0; i < 4; i++) {
      const f = this.buildFinger(group, xs[i], ys[i], PALM_L - 0.004, lens[i], radii[i], ks[i]);
      // Knuckles fan out a hair at rest.
      f.root.rotation.y = (1.5 - i) * 0.03;
      fingers.push(f);
    }
    const thumb = this.buildFinger(group, 0.036, -0.008, 0.02, [0.036, 0.03, 0.025], 0.0102, 1);
    thumb.root.rotation.order = "YXZ";
    return { group, fingers, thumb };
  }

  private buildFinger(parent: THREE.Object3D, x: number, y: number, z: number, lens: [number, number, number], r: number, k: number): Finger {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    parent.add(root);
    const seg = (p: THREE.Object3D, l: number, rad: number, mat: THREE.Material) => {
      const g = new THREE.CapsuleGeometry(rad, Math.max(0.002, l - rad), 2, 8);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0, l / 2);
      this.mesh(g, mat, p);
    };
    seg(root, lens[0], r, this.mats.skinDark);
    const mid = new THREE.Group();
    mid.position.set(0, 0, lens[0]);
    root.add(mid);
    seg(mid, lens[1], r * 0.92, this.mats.skin);
    const tip = new THREE.Group();
    tip.position.set(0, 0, lens[1]);
    mid.add(tip);
    seg(tip, lens[2], r * 0.84, this.mats.skin);
    return { root, mid, tip, k };
  }

  private buildLeg(side: -1 | 1): Leg {
    const thigh = this.mesh(new THREE.CapsuleGeometry(0.085, THIGH - 0.17, 4, 12), this.mats.trouser, this.legRoot);
    const shin = this.mesh(new THREE.CylinderGeometry(0.055, 0.075, SHIN - 0.05, 12), this.mats.trouser, this.legRoot);
    const knee = this.mesh(new THREE.SphereGeometry(0.075, 12, 8), this.mats.trouser, this.legRoot);
    const foot = new THREE.Group();
    const shoe = this.mesh(new THREE.BoxGeometry(0.1, 0.075, 0.27), this.mats.shoe, foot);
    shoe.position.set(0, 0.055, -0.05);
    const sole = this.mesh(new THREE.BoxGeometry(0.104, 0.022, 0.28), this.mats.sole, foot);
    sole.position.set(0, 0.011, -0.05);
    this.legRoot.add(foot);
    return { side, thigh, shin, knee, foot, target: new THREE.Vector3(side * 0.13, 0, 0) };
  }

  // ---------------------------------------------------------------- posing

  /** `dip` is the camera landing spring offset (negative = down). */
  update(dt: number, alpha: number, player: PlayerController, camera: THREE.PerspectiveCamera, dip: number): void {
    // Arm root: camera position, rotation with a hint of lag so the arms carry weight.
    this.armRoot.position.copy(camera.position);
    const k = 1 - Math.exp(-dt / 0.035);
    this.armRoot.quaternion.slerp(camera.quaternion, k);
    this.invQ.copy(this.armRoot.quaternion).invert();

    // Leg root: interpolated body position, yaw only.
    this.legRoot.position.lerpVectors(player.prevPos, player.pos, alpha);
    this.legRoot.rotation.set(0, player.yaw, 0);

    // World basis of the body's facing (yaw 0 looks down -z; +x is right).
    this.right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    this.fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));

    this.time += dt;
    this.catchT = Math.max(0, this.catchT - dt);
    this.pushT = Math.max(0, this.pushT - dt);
    const state = player.state;
    const phase = player.stride * Math.PI * 2;
    const speedK = clamp(player.speed / PLAYER.sprintSpeed, 0, 1);
    const inAir = !player.grounded && state !== "mantle";
    if (inAir) this.airPhase += dt * 9; // keeps limbs cycling on the wall / in long falls
    // Hips follow the body's current height (crouch/slide lowers them).
    this.hipH = damp(this.hipH, player.height * 0.52, 0.06, dt);

    if (state === "wallrun" && player.wallSide !== 0) {
      this.lastWallSide = player.wallSide;
      this.updatePlant(dt, player, camera);
    } else {
      this.plant.active = false;
    }

    for (const arm of this.arms) this.poseArmTarget(arm, player, camera, phase, speedK, dip);
    for (const arm of this.arms) this.solveArm(arm, dt);
    for (const leg of this.legs) this.poseLegTarget(leg, player, phase, speedK);
    for (const leg of this.legs) this.solveLeg(leg, dt);
  }

  /**
   * Wall-run hand cadence. The hand is glued to the wall plane; along the wall it slides back
   * from `PLANT_AHEAD` toward the shoulder as if planted in the world, then lifts a hand's
   * width off the surface, moves forward and slaps down ahead again.
   */
  private updatePlant(dt: number, player: PlayerController, camera: THREE.PerspectiveCamera): void {
    const pl = this.plant;
    if (!pl.active) {
      pl.active = true;
      pl.phase = "slap";
      pl.t = 0;
      pl.ahead = PLANT_AHEAD;
      pl.y = camera.position.y - PLANT_DROP;
      pl.lift = 0.08;
    }
    pl.t += dt;
    if (pl.phase === "hold") {
      pl.ahead = damp(pl.ahead, PLANT_BEHIND, 0.16, dt);
      pl.lift = 0;
      if (pl.t > PLANT_HOLD * (0.7 + 0.3 * player.wallGrip) || player.wallRunTime < 0.02) {
        pl.phase = "lift";
        pl.t = 0;
      }
    } else if (pl.phase === "lift") {
      const k = clamp(pl.t / PLANT_LIFT, 0, 1);
      pl.lift = 0.10 * Math.sin(Math.PI * Math.min(1, k * 0.75 + 0.25));
      pl.ahead = lerp(pl.ahead, PLANT_AHEAD, k * 0.7);
      if (k >= 1) {
        pl.phase = "slap";
        pl.t = 0;
        pl.ahead = PLANT_AHEAD;
        pl.y = camera.position.y - PLANT_DROP;
      }
    } else {
      const k = clamp(pl.t / PLANT_SLAP, 0, 1);
      pl.lift = 0.07 * (1 - k);
      if (k >= 1) {
        pl.phase = "hold";
        pl.t = 0;
      }
    }
  }

  /** World → arm-root space (in place). */
  private toLocal(v: THREE.Vector3): THREE.Vector3 {
    return v.sub(this.armRoot.position).applyQuaternion(this.invQ);
  }

  private dirToLocal(v: THREE.Vector3): THREE.Vector3 {
    return v.applyQuaternion(this.invQ);
  }

  /**
   * Keep a world-anchored hand target in reach and in frame: first pull it toward the shoulder
   * until the arm can reach it (a planted hand the body has risen past stays on the line to
   * its anchor), then hold it in front of the eye and above the bottom of the frame.
   */
  private clampView(t: THREE.Vector3, side: number): void {
    this.clampReach(t, side);
    if (t.z > -VIEW_NEAR) t.z = -VIEW_NEAR;
    const floor = VIEW_FLOOR * t.z;
    if (t.y < floor) t.y = floor;
  }

  /** Pull a world-anchored target toward the shoulder until the arm can reach it. */
  private clampReach(t: THREE.Vector3, side: number): void {
    const sh = this.v3.set(side * 0.19, -0.24, 0.06);
    const d = t.distanceTo(sh);
    const reach = UPPER_ARM + FOREARM - 0.01;
    if (d > reach) t.sub(sh).multiplyScalar(reach / d).add(sh);
  }

  private poseArmTarget(arm: Arm, p: PlayerController, camera: THREE.PerspectiveCamera, phase: number, speedK: number, dip: number): void {
    const s = arm.side;
    const t = this.v; // target, arm-root space
    const palm = this.v2; // desired palm normal
    const fdir = this.v4.set(0, 0, -1);
    let dirWeight = 0;
    let curl = 0.3;
    let spread = 0.1;
    let tau = 0.05;
    // Runner's pump: right arm forward when left leg forward.
    const swing = Math.sin(phase + (s > 0 ? Math.PI : 0));
    const amp = 0.35 + 0.65 * p.sprintBlend;

    if (p.state === "mantle") {
      // Right hand leads by ~0.06 of the climb. Timeline (of mantleT): reach 0–0.1 while the
      // body hangs, grab and pull 0.1–0.5 with the hands glued to the lip so they slide down
      // and out of the frame as the body rises past them, palms flatten to push 0.4–0.55,
      // then release: the hands lift off and swing up into the run pose as the view comes up.
      const tt = clamp(p.mantleT + (s > 0 ? 0.03 : -0.03), 0, 1);
      const reach = smoothstep(tt / 0.1);
      const flat = smoothstep((tt - 0.4) / 0.15);
      const release = smoothstep((tt - 0.55) / 0.3);
      // Anchor: on the lip, a hand's width out from centre, a little past the face.
      const a = this.w1.copy(p.mantleLip).addScaledVector(this.right, s * 0.22).addScaledVector(p.mantleDir, 0.05);
      a.y += 0.035; // palm rests on the lip, not centred in it
      this.toLocal(a);
      // Reach: open hands come in from above and behind the lip.
      a.y += 0.14 * (1 - reach);
      a.z += 0.12 * (1 - reach);
      this.clampReach(a, s);
      t.copy(a);
      // Release: lift off and swing back to the run pose with a forward follow-through.
      const rest = this.v3.set(s * 0.26, -0.30 + 0.06 * Math.sin(Math.PI * release), -0.40 - 0.14 * Math.sin(Math.PI * release));
      t.lerp(rest, release);
      palm.copy(this.dirToLocal(this.w2.set(0, -1, 0)));
      palm.lerp(this.w3.set(-s, -0.5, 0.2), release);
      // Fingers lie forward on the roof, pressing down a little on the grab, flat to push.
      fdir.copy(this.dirToLocal(this.w2.copy(p.mantleDir).addScaledVector(Y, -0.2 * (1 - flat))));
      dirWeight = 1 - release;
      // Open on the reach, grip the top on the grab, flatten to push, relax on the release.
      curl = lerp(lerp(0.04, 0.26, reach), 0.08, flat);
      curl = lerp(curl, 0.3, release);
      spread = lerp(lerp(0.45, 0.15, reach), 0.1, release);
      tau = reach < 1 ? 0.035 : 0.02;
    } else if (p.state === "wallrun" && p.wallSide === s) {
      // Inner hand planted on the wall plane, fingers splayed, pointing up along the run.
      const pl = this.plant;
      const n = p.wallNormal;
      const along = this.w2.copy(p.vel).addScaledVector(n, -p.vel.dot(n));
      along.y = 0;
      if (along.lengthSq() < 0.5) along.copy(this.fwd).addScaledVector(n, -this.fwd.dot(n));
      along.normalize();
      const a = this.w1.copy(camera.position);
      p.wallPoint(a, a);
      a.addScaledVector(along, pl.ahead).addScaledVector(n, 0.015 + pl.lift);
      a.y = clamp(pl.y, camera.position.y - 0.55, camera.position.y - 0.05);
      this.toLocal(a);
      this.clampView(a, s);
      t.copy(a);
      palm.copy(this.dirToLocal(this.w3.copy(n).negate()));
      fdir.copy(this.dirToLocal(this.w3.copy(along).multiplyScalar(0.8).addScaledVector(Y, 0.6)));
      dirWeight = 1;
      const lifted = clamp(pl.lift / 0.08, 0, 1);
      curl = 0.04 + 0.2 * lifted;
      spread = 1 - 0.4 * lifted;
      tau = pl.phase === "slap" ? 0.018 : 0.035;
    } else if (p.state === "wallrun") {
      const sw = Math.sin(this.airPhase);
      t.set(s * 0.26, -0.26 + 0.05 * sw, -0.48 - 0.1 * sw);
      palm.set(-s, -0.3, 0);
      curl = 0.35;
    } else if (p.state === "slide") {
      if (s > 0) {
        // Trailing hand skims the ground beside the hip: low in the corner, palm down.
        t.set(s * 0.37, -0.35, -0.42);
        palm.set(s * 0.25, -1, 0.15);
        fdir.set(s * 0.3, -0.35, -1);
        dirWeight = 0.7;
        curl = 0.1;
        spread = 0.7;
      } else {
        // Lead hand out ahead for balance.
        t.set(s * 0.30, -0.30, -0.50);
        palm.set(s * 0.6, -0.8, 0.2);
        curl = 0.2;
        spread = 0.4;
      }
    } else if (!p.grounded) {
      // Hands rise as we fall faster.
      const fall = clamp(-p.vel.y / 10, 0, 1);
      t.set(s * (0.29 + 0.04 * fall), -0.20 + 0.14 * fall, -0.50);
      palm.set(-s * 0.6, -0.7, 0.4);
      curl = 0.3;
      spread = 0.4 * fall;
    } else if (p.speed > 1.0) {
      // Sprint pump: elbows near 90°, hands chest-low, loosely open.
      const base = -0.31 + 0.02 * speedK;
      t.set(s * (0.25 - 0.02 * swing * amp), base + 0.06 * swing * amp * speedK, -0.40 - 0.12 * swing * amp * speedK);
      palm.set(-s, -0.35 + 0.15 * swing, 0.25);
      curl = 0.28 + 0.06 * p.sprintBlend;
      spread = 0.12;
    } else {
      // Idle: hands low, breathing.
      const br = Math.sin(this.time * 1.3);
      t.set(s * 0.27, -0.40 + 0.008 * br, -0.44 + 0.004 * Math.sin(this.time * 1.3 + 0.6));
      palm.set(-s, -0.5, 0.15);
      curl = 0.32 + 0.02 * br;
    }

    // Wall-jump: both hands shove off the wall for a beat, then settle into the air pose.
    if (this.pushT > 0 && p.state !== "wallrun" && p.state !== "mantle") {
      const k = smoothstep(this.pushT / PUSH_TIME);
      const ws = this.lastWallSide;
      if (s === ws) {
        t.lerp(this.v3.set(s * 0.12, -0.14, -0.50), k);
        palm.lerp(this.v3.set(s * 0.9, 0.2, -0.3), k);
      } else {
        t.lerp(this.v3.set(s * 0.34, -0.06, -0.42), k);
        palm.lerp(this.v3.set(-s * 0.5, -0.3, -0.8), k);
      }
      curl = lerp(curl, 0.02, k);
      spread = lerp(spread, 1, k);
      tau = 0.03;
    }

    // Landing spring drops the hands with the view.
    t.y += dip * 1.4;

    // Hard landing: both hands drop forward and down to catch the fall (held in frame: the
    // view is already dipping toward the ground).
    if (this.catchT > 0 && p.grounded) {
      const k = Math.sin(Math.PI * (1 - this.catchT / CATCH_TIME)) * this.catchK;
      t.lerp(this.v3.set(s * 0.30, -0.29, -0.44), k);
      palm.lerp(this.v3.set(s * 0.15, -1, -0.3), k);
      fdir.lerp(this.v3.set(s * 0.1, -0.5, -1), k);
      dirWeight = lerp(dirWeight, 0.8, k);
      curl = lerp(curl, 0.08, k);
      spread = lerp(spread, 0.7, k);
      tau = 0.03;
    }

    arm.target.copy(t);
    arm.palm.copy(palm);
    arm.fingerDir.copy(fdir).normalize();
    arm.dirWeight = dirWeight;
    arm.curl = curl;
    arm.spread = spread;
    arm.tau = tau;
  }

  private solveArm(arm: Arm, dt: number): void {
    const s = arm.side;
    const shoulder = this.v3.set(s * 0.19, -0.24, 0.06);
    // Damped target for weight; hands snap quicker when planting (short tau).
    const hp = arm.hand.group.position;
    hp.x = damp(hp.x, arm.target.x, arm.tau, dt);
    hp.y = damp(hp.y, arm.target.y, arm.tau, dt);
    hp.z = damp(hp.z, arm.target.z, arm.tau, dt);

    // Two-bone IK with the elbow pushed out, down and back.
    const pole = this.v.set(s * 1.0, -0.7, 0.35);
    this.twoBone(shoulder, hp, UPPER_ARM, FOREARM, pole, this.elbow);
    this.orient(arm.upper, shoulder, this.elbow);
    this.orient(arm.fore, this.elbow, hp);
    arm.wrist.position.copy(hp);
    // Cuff sits just before the wrist along the forearm.
    this.v2.copy(hp).sub(this.elbow).normalize();
    arm.cuff.position.copy(hp).addScaledVector(this.v2, -0.04);
    arm.cuff.quaternion.setFromUnitVectors(Y, this.v2);
    arm.wrist.quaternion.copy(arm.cuff.quaternion);

    // Hand frame: fingers continue the forearm line unless a finger direction is asked for
    // (planted hands bend at the wrist); back of hand opposes the palm normal.
    const z = this.v2; // forearm direction (already normalised)
    if (arm.dirWeight > 0) z.lerp(arm.fingerDir, arm.dirWeight).normalize();
    const y = this.v.copy(arm.palm).negate();
    y.addScaledVector(z, -y.dot(z));
    if (y.lengthSq() < 1e-6) y.set(0, 1, 0).addScaledVector(z, -z.y);
    y.normalize();
    const x = this.v3.crossVectors(y, z).normalize();
    this.m.makeBasis(x, y, z);
    arm.hand.group.quaternion.setFromRotationMatrix(this.m);

    // Finger curl / spread. Positive x rotation bends toward the palm (-y). Fingers respond
    // as quickly as the hand does, so a fast reach opens them in time to grab.
    const ft = clamp(arm.tau * 1.3, 0.025, 0.07);
    for (let i = 0; i < 4; i++) {
      const f = arm.hand.fingers[i];
      const c = clamp(arm.curl * f.k, 0, 1);
      f.root.rotation.x = damp(f.root.rotation.x, c * 1.45, ft, dt);
      f.mid.rotation.x = damp(f.mid.rotation.x, c * 1.7, ft, dt);
      f.tip.rotation.x = damp(f.tip.rotation.x, c * 1.0, ft, dt);
      f.root.rotation.y = damp(f.root.rotation.y, (1.5 - i) * (0.03 + 0.13 * arm.spread), ft, dt);
    }
    // Thumb: opposed (swung out and toward the palm), closing across the palm with the curl.
    const th = arm.hand.thumb;
    th.root.rotation.y = damp(th.root.rotation.y, 1.05 - 0.25 * arm.spread, ft, dt);
    th.root.rotation.x = damp(th.root.rotation.x, 0.35 + arm.curl * 0.55, ft, dt);
    th.root.rotation.z = damp(th.root.rotation.z, -0.35, ft, dt);
    th.mid.rotation.x = damp(th.mid.rotation.x, 0.1 + arm.curl * 0.6, ft, dt);
    th.tip.rotation.x = damp(th.tip.rotation.x, arm.curl * 0.8, ft, dt);
  }

  private poseLegTarget(leg: Leg, p: PlayerController, phase: number, speedK: number): void {
    const s = leg.side;
    const t = this.v;
    const hipH = p.height * 0.52;
    const swing = Math.sin(phase + (s > 0 ? 0 : Math.PI));
    if (p.state === "slide") {
      t.set(s * 0.16, 0.06 + 0.04 * (s > 0 ? 1 : 0), -0.82 + 0.1 * (s > 0 ? 1 : 0));
    } else if (p.state === "mantle") {
      // Legs hang while the hands take the weight, then the lead knee comes up to step over
      // the lip once the view has come back up (so the knee stays under the frame).
      const step = Math.sin(Math.PI * clamp((p.mantleT - 0.55) / 0.45, 0, 1));
      t.set(s * 0.14, hipH * 0.4 * step * (s > 0 ? 1 : 0.6), 0.08 - 0.26 * step);
    } else if (!p.grounded) {
      // Tucked, cycling slowly on the wall.
      const w = p.state === "wallrun" ? Math.sin(this.airPhase + (s > 0 ? 0 : Math.PI)) : 0;
      const fall = clamp(-p.vel.y / 10, 0, 1);
      t.set(s * 0.14, hipH * (0.3 - 0.12 * fall) + 0.08 * w, -0.22 - 0.16 * w);
    } else if (p.speed > 0.8) {
      const len = (PLAYER.strideWalk + (PLAYER.strideSprint - PLAYER.strideWalk) * p.sprintBlend) * 0.5;
      const lift = Math.max(0, swing) * (0.08 + 0.1 * speedK);
      t.set(s * 0.12, lift, -swing * len * 0.5);
    } else {
      t.set(s * 0.13, 0, -0.06);
    }
    leg.target.copy(t);
  }

  private solveLeg(leg: Leg, dt: number): void {
    const s = leg.side;
    // Hips sit a little behind the eye, so hanging legs stay under the frame.
    const hip = this.v3.set(s * 0.1, 0, 0.12);
    const fp = leg.foot.position;
    fp.x = damp(fp.x, leg.target.x, 0.05, dt);
    fp.y = damp(fp.y, leg.target.y, 0.05, dt);
    fp.z = damp(fp.z, leg.target.z, 0.05, dt);
    hip.y = this.hipH;
    const ankle = this.v2.copy(fp);
    ankle.y += 0.07;
    const pole = this.v.set(s * 0.15, 0.1, -1);
    this.twoBone(hip, ankle, THIGH, SHIN, pole, this.elbow);
    this.orient(leg.thigh, hip, this.elbow);
    this.orient(leg.shin, this.elbow, ankle);
    leg.knee.position.copy(this.elbow);
    // Foot points forward, tilted down a little when lifted.
    leg.foot.rotation.set(fp.y > 0.02 ? -0.5 * clamp(fp.y / 0.2, 0, 1) : 0, 0, 0);
  }

  // ---------------------------------------------------------------- helpers

  /** Place `mesh` (built along +y) between `a` and `b`. */
  private orient(mesh: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
    mesh.position.lerpVectors(a, b, 0.5);
    this.dir.subVectors(b, a).normalize();
    this.q.setFromUnitVectors(Y, this.dir);
    mesh.quaternion.copy(this.q);
  }

  /** Two-bone IK: elbow/knee position for root `a`, end `b`, bone lengths, bend direction `pole`. */
  private twoBone(a: THREE.Vector3, b: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    let d = Math.hypot(dx, dy, dz);
    const maxD = l1 + l2 - 0.005;
    const minD = Math.abs(l1 - l2) + 0.005;
    if (d < 1e-5) d = 1e-5;
    const dc = clamp(d, minD, maxD);
    const ux = dx / d;
    const uy = dy / d;
    const uz = dz / d;
    if (d > maxD) {
      // Out of reach: pull the end in along the line so the chain stays connected.
      b.set(a.x + ux * dc, a.y + uy * dc, a.z + uz * dc);
    }
    const x = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
    const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
    // Perpendicular component of the pole.
    const pd = pole.x * ux + pole.y * uy + pole.z * uz;
    let px = pole.x - ux * pd;
    let py = pole.y - uy * pd;
    let pz = pole.z - uz * pd;
    const pl = Math.hypot(px, py, pz) || 1;
    px /= pl;
    py /= pl;
    pz /= pl;
    out.set(a.x + ux * x + px * h, a.y + uy * x + py * h, a.z + uz * x + pz * h);
  }
}
