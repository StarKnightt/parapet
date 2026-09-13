/**
 * One warm low sun with a shadow frustum that follows the player (snapped to shadow texels
 * so edges don't shimmer while running), plus a sky/ground hemisphere fill.
 */
import * as THREE from "three";
import { SUN_DIR } from "./Sky";

const SHADOW_HALF = 42;
const SHADOW_MAP = 2048;

export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly snapped = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // Overcast: a soft, slightly warm key through cloud. Shadows stay but are low-contrast.
    this.sun = new THREE.DirectionalLight(0xffeedd, 2.3);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    s.camera.near = 1;
    s.camera.far = 260;
    s.camera.left = -SHADOW_HALF;
    s.camera.right = SHADOW_HALF;
    s.camera.top = SHADOW_HALF;
    s.camera.bottom = -SHADOW_HALF;
    s.bias = -0.0006;
    s.normalBias = 0.06;
    s.radius = 4;
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xb8c0c8, 0x3e3a34, 1.15);
    scene.add(this.hemi);

    // Light-space basis for texel snapping.
    this.up.set(0, 1, 0);
    this.right.crossVectors(this.up, SUN_DIR).normalize();
    this.up.crossVectors(SUN_DIR, this.right).normalize();
  }

  /** Re-centre the shadow frustum on the player, snapped to the shadow-map texel grid. */
  follow(target: THREE.Vector3): void {
    const texel = (SHADOW_HALF * 2) / SHADOW_MAP;
    const px = Math.round(target.dot(this.right) / texel) * texel;
    const py = Math.round(target.dot(this.up) / texel) * texel;
    const pz = target.dot(SUN_DIR);
    this.snapped
      .set(0, 0, 0)
      .addScaledVector(this.right, px)
      .addScaledVector(this.up, py)
      .addScaledVector(SUN_DIR, pz);
    this.sun.target.position.copy(this.snapped);
    this.sun.position.copy(this.snapped).addScaledVector(SUN_DIR, 140);
    this.sun.target.updateMatrixWorld();
  }
}
