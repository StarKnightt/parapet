/**
 * First-person body: two arms hung from the camera and two legs hung from the hips, all
 * procedural (capsules, tapered cylinders, boxed fingers) and posed by two-bone IK from hand
 * and foot targets that the movement state drives. Nothing here touches the simulation.
 *
 *   ground   arms pump opposite the legs, feet cycle with the stride
 *   air      hands rise and spread, knees tuck
 *   mantle   both hands reach for the lip and stay planted while the body climbs past them
 *   wallrun  inner hand flat on the wall, fingers spread; outer arm keeps pumping
 *   slide    arms low and wide for balance, legs out ahead
 */
import * as THREE from "three";
import { clamp, damp, easeOutCubic, smoothstep } from "../core/math";
import { PLAYER } from "./PlayerConfig";
import type { PlayerController } from "./PlayerController";

const UPPER_ARM = 0.30;
const FOREARM = 0.27;
const THIGH = 0.45;
const SHIN = 0.44;

const Y = new THREE.Vector3(0, 1, 0);

interface Finger {
  root: THREE.Group;
  mid: THREE.Group;
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
  target: THREE.Vector3;
  palm: THREE.Vector3;
  curl: number;
  spread: number;
}

interface Leg {
  side: -1 | 1;
  thigh: THREE.Mesh;
  shin: THREE.Mesh;
  knee: THREE.Mesh;
  foot: THREE.Group;
  target: THREE.Vector3;
}

export class Body {
  /** Follows the camera (with a little lag): arms live here. */
  readonly armRoot = new THREE.Group();
  /** Follows the body position and yaw: legs live here. */
  readonly legRoot = new THREE.Group();

  private readonly arms: Arm[] = [];
  private readonly legs: Leg[] = [];
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
  private readonly elbow = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly m = new THREE.Matrix4();
  private airPhase = 0;
  private hipH = 0.94;
  private readonly mats: Record<"sleeve" | "skin" | "cuff" | "trouser" | "shoe" | "sole", THREE.MeshStandardMaterial>;

  constructor(scene: THREE.Scene) {
    const mk = (color: number, roughness: number) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
    this.mats = {
      sleeve: mk(0x2a2b2f, 0.92),
      skin: mk(0xb98a63, 0.72),
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
    const wrist = this.mesh(new THREE.SphereGeometry(0.034, 12, 8), this.mats.skin, this.armRoot);
    const hand = this.buildHand();
    if (side < 0) hand.group.scale.x = -1; // left hand is the mirror of the right
    this.armRoot.add(hand.group);
    return { side, upper, fore, wrist, cuff, hand, target: new THREE.Vector3(side * 0.26, -0.4, -0.42), palm: new THREE.Vector3(-side, -0.4, 0), curl: 0.6, spread: 0 };
  }

  /** Right hand frame: +z toward fingertips, +y back of hand, +x thumb side. */
  private buildHand(): Hand {
    const group = new THREE.Group();
    const thumbSign = 1;
    const palm = this.mesh(new THREE.BoxGeometry(0.084, 0.024, 0.1), this.mats.skin, group);
    palm.position.set(0, 0, 0.05);
    const fingers: Finger[] = [];
    const xs = [-0.031, -0.0105, 0.0105, 0.031];
    const lens = [0.034, 0.038, 0.036, 0.03];
    for (let i = 0; i < 4; i++) {
      fingers.push(this.buildFinger(group, xs[i], 0, 0.1, lens[i], lens[i] * 0.8, 0.0145));
    }
    const thumb = this.buildFinger(group, thumbSign * 0.05, -0.002, 0.03, 0.032, 0.028, 0.017);
    thumb.root.rotation.y = thumbSign * 0.95;
    return { group, fingers, thumb };
  }

  private buildFinger(parent: THREE.Object3D, x: number, y: number, z: number, l1: number, l2: number, w: number): Finger {
    const root = new THREE.Group();
    root.position.set(x, y, z);
    parent.add(root);
    const s1 = this.mesh(new THREE.BoxGeometry(w, w * 0.9, l1), this.mats.skin, root);
    s1.position.set(0, 0, l1 / 2);
    const mid = new THREE.Group();
    mid.position.set(0, 0, l1);
    root.add(mid);
    const s2 = this.mesh(new THREE.BoxGeometry(w * 0.92, w * 0.82, l2), this.mats.skin, mid);
    s2.position.set(0, 0, l2 / 2);
    return { root, mid };
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

    // Leg root: interpolated body position, yaw only.
    this.legRoot.position.lerpVectors(player.prevPos, player.pos, alpha);
    this.legRoot.rotation.set(0, player.yaw, 0);

    const state = player.state;
    const phase = player.stride * Math.PI * 2;
    const speedK = clamp(player.speed / PLAYER.sprintSpeed, 0, 1);
    const inAir = !player.grounded && state !== "mantle";
    if (inAir) this.airPhase += dt * 9; // keeps limbs cycling on the wall / in long falls
    // Hips follow the body's current height (crouch/slide lowers them).
    this.hipH = damp(this.hipH, player.height * 0.52, 0.06, dt);

    for (const arm of this.arms) this.poseArmTarget(arm, player, phase, speedK, dip);
    for (const arm of this.arms) this.solveArm(arm, dt);
    for (const leg of this.legs) this.poseLegTarget(leg, player, phase, speedK);
    for (const leg of this.legs) this.solveLeg(leg, dt);
  }

  private poseArmTarget(arm: Arm, p: PlayerController, phase: number, speedK: number, dip: number): void {
    const s = arm.side;
    const t = this.v; // target in camera space
    const palm = this.v2; // desired palm normal in camera space
    let curl = 0.6;
    let spread = 0;
    // Runner's pump: right arm forward when left leg forward.
    const swing = Math.sin(phase + (s > 0 ? Math.PI : 0));
    const amp = 0.35 + 0.65 * p.sprintBlend;

    if (p.state === "mantle") {
      // Hands plant on the lip and stay there in world terms while the body rises past them.
      const mt = p.mantleT;
      const rise = p.mantleLedge * easeOutCubic(Math.min(1, mt * 1.4));
      const eye = PLAYER.eyeHeight * (p.height / PLAYER.height);
      // Clamped into the visible band: the camera nods down to meet them (CameraRig).
      const lipY = clamp(p.mantleLedge - rise - eye, -0.40, 0.16);
      const reach = smoothstep(mt / 0.18);
      const release = smoothstep((mt - 0.62) / 0.38);
      t.set(s * (0.30 - 0.08 * reach), lipY, -0.44);
      t.lerp(this.v3.set(s * 0.25, -0.30, -0.50), release);
      palm.set(0, -1, -0.2);
      curl = 0.12 + 0.5 * release;
    } else if (p.state === "wallrun" && p.wallSide === s) {
      // Inner hand flat on the wall.
      t.set(s * 0.33, -0.12, -0.30);
      palm.set(s, 0.05, 0);
      curl = 0.05;
      spread = 1;
    } else if (p.state === "wallrun") {
      const sw = Math.sin(this.airPhase);
      t.set(s * 0.26, -0.26 + 0.05 * sw, -0.50 - 0.1 * sw);
      palm.set(-s, -0.3, 0);
    } else if (p.state === "slide") {
      // Low and wide, palms down-out, like skimming the ground.
      t.set(s * 0.34, -0.36, -0.48);
      palm.set(s * 0.5, -1, 0.1);
      curl = 0.25;
      spread = 0.5;
    } else if (!p.grounded) {
      // Hands rise as we fall faster.
      const fall = clamp(-p.vel.y / 10, 0, 1);
      t.set(s * (0.29 + 0.04 * fall), -0.20 + 0.14 * fall, -0.50);
      palm.set(-s * 0.6, -0.7, 0.4);
      curl = 0.4;
      spread = 0.4 * fall;
    } else if (p.speed > 1.0) {
      const base = -0.37 + 0.10 * speedK;
      t.set(s * (0.25 - 0.03 * swing * amp), base + 0.07 * swing * amp * speedK, -0.50 - 0.12 * swing * amp * speedK);
      palm.set(-s, -0.45 + 0.2 * swing, 0.1);
      curl = 0.55 + 0.15 * p.sprintBlend;
    } else {
      t.set(s * 0.27, -0.43, -0.46);
      palm.set(-s, -0.5, 0.15);
    }
    // Landing spring drops the hands with the view.
    t.y += dip * 1.4;

    arm.target.copy(t);
    arm.palm.copy(palm);
    arm.curl = curl;
    arm.spread = spread;
  }

  private solveArm(arm: Arm, dt: number): void {
    const s = arm.side;
    const shoulder = this.v3.set(s * 0.19, -0.24, 0.06);
    // Damped target for weight; hands snap quicker on mantles (short tau).
    const hp = arm.hand.group.position;
    const tau = 0.05;
    hp.x = damp(hp.x, arm.target.x, tau, dt);
    hp.y = damp(hp.y, arm.target.y, tau, dt);
    hp.z = damp(hp.z, arm.target.z, tau, dt);

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

    // Hand frame: fingers continue the forearm line, back of hand opposes the palm normal.
    const z = this.v2; // forearm direction (already normalised)
    const y = this.v.copy(arm.palm).negate();
    y.addScaledVector(z, -y.dot(z)).normalize();
    const x = this.v3.crossVectors(y, z).normalize();
    this.m.makeBasis(x, y, z);
    arm.hand.group.quaternion.setFromRotationMatrix(this.m);

    // Finger curl / spread.
    const c1 = -arm.curl * 1.1;
    const c2 = -arm.curl * 1.4;
    for (let i = 0; i < 4; i++) {
      const f = arm.hand.fingers[i];
      f.root.rotation.x = damp(f.root.rotation.x, c1, 0.08, dt);
      f.mid.rotation.x = damp(f.mid.rotation.x, c2, 0.08, dt);
      f.root.rotation.y = damp(f.root.rotation.y, (i - 1.5) * 0.14 * arm.spread, 0.08, dt);
    }
    arm.hand.thumb.root.rotation.x = damp(arm.hand.thumb.root.rotation.x, -0.2 - arm.curl * 0.5, 0.08, dt);
    arm.hand.thumb.mid.rotation.x = damp(arm.hand.thumb.mid.rotation.x, -arm.curl * 0.8, 0.08, dt);
  }

  private poseLegTarget(leg: Leg, p: PlayerController, phase: number, speedK: number): void {
    const s = leg.side;
    const t = this.v;
    const hipH = p.height * 0.52;
    const swing = Math.sin(phase + (s > 0 ? 0 : Math.PI));
    if (p.state === "slide") {
      t.set(s * 0.16, 0.06 + 0.04 * (s > 0 ? 1 : 0), -0.82 + 0.1 * (s > 0 ? 1 : 0));
    } else if (p.state === "mantle") {
      const mt = p.mantleT;
      t.set(s * 0.14, hipH * (0.35 + 0.25 * Math.sin(mt * Math.PI)) * (s > 0 ? 1 : 0.7), -0.28);
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
    const hip = this.v3.set(s * 0.1, 0, 0);
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
