/**
 * Post pipeline: scene → N8AO (screen-space AO, the corner darkening that sells concrete
 * mass) → speed pass (radial smear at sprint, vignette, fine grain) → tone map/sRGB.
 *
 * `quality` "low" skips AO for weaker machines; the game auto-drops when fps sags.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { N8AOPass } from "n8ao";

export type Quality = "high" | "low";

const SPEED_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uBlur: { value: 0 },
    uVignette: { value: 0.5 },
    uGrain: { value: 0.012 },
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uBlur; uniform float uVignette; uniform float uGrain; uniform float uTime; uniform vec2 uCenter;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 toC = vUv - uCenter;
      float r = length(toC);
      vec3 col;
      if (uBlur > 0.001) {
        // Radial smear, weighted toward the edges so the centre stays readable.
        float w = smoothstep(0.08, 0.75, r);
        float amt = uBlur * w * 0.11;
        col = vec3(0.0);
        const int N = 10;
        for (int i = 0; i < N; i++) {
          float t = float(i) / float(N - 1);
          col += texture2D(tDiffuse, vUv - toC * amt * t).rgb;
        }
        col /= float(N);
      } else {
        col = texture2D(tDiffuse, vUv).rgb;
      }
      // Vignette.
      float v = 1.0 - uVignette * smoothstep(0.25, 1.0, r * 1.25);
      col *= v;
      // Gentle contrast lift around mid-grey (linear space, pre tone map).
      col = (col - 0.18) * 1.1 + 0.18;
      col = max(col, 0.0);
      // Static, very fine grain (no per-frame reseed: animated grain reads as screen jitter).
      col += (hash(vUv * 1000.0) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Post {
  private readonly composer: EffectComposer;
  private readonly ao: N8AOPass;
  private readonly speed: ShaderPass;
  private quality: Quality = "high";

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    this.ao = new N8AOPass(scene, camera, size.x, size.y);
    this.ao.configuration.aoRadius = 1.0;
    this.ao.configuration.distanceFalloff = 0.6;
    this.ao.configuration.intensity = 5.5;
    this.ao.configuration.halfRes = true;
    this.ao.configuration.gammaCorrection = false;
    this.ao.configuration.screenSpaceRadius = false;
    this.ao.setQualityMode("Medium");
    // Stronger denoise: AO speckle shimmering under camera motion reads as jitter.
    this.ao.configuration.denoiseSamples = 8;
    this.ao.configuration.denoiseRadius = 12;
    if (!location.search.includes("noao")) this.composer.addPass(this.ao);

    this.speed = new ShaderPass(SPEED_SHADER);
    this.composer.addPass(this.speed);
    this.composer.addPass(new OutputPass());
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.ao.enabled = q === "high";
  }

  getQuality(): Quality {
    return this.quality;
  }

  /** `blur` 0..1 (sprint fraction), `time` seconds for grain. */
  render(blur: number, time: number): void {
    this.speed.uniforms.uBlur.value = blur;
    this.speed.uniforms.uTime.value = time;
    this.composer.render();
  }

  resize(): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer.setSize(size.x, size.y);
    this.ao.setSize(size.x, size.y);
    this.camera.updateProjectionMatrix();
  }
}
