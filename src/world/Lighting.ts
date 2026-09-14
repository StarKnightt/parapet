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
    // Golden hour: a warm low key. Roughly 3:1 lit:shadow on roofs once the sky fill is added,
    // so the long shadows read without going to mud.
    this.sun = new THREE.DirectionalLight(0xffdfb4, 6.0);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    s.camera.near = 1;
    s.camera.far = 260;
    s.camera.left = -SHADOW_HALF;
    s.camera.right = SHADOW_HALF;
    s.camera.top = SHADOW_HALF;
    s.camera.bottom = -SHADOW_HALF;
    // 25° sun stretches shadow texels ~2.4× across roofs, so a touch more normal bias.
    s.bias = -0.0005;
    s.normalBias = 0.08;
    s.radius = 4;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Cool sky-blue fill from above, warm bounce from the sunlit concrete below.
    this.hemi = new THREE.HemisphereLight(0xafbccd, 0x7d6e5b, 2.8);
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
