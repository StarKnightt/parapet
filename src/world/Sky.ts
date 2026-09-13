/**
 * Overcast sky. A near-white cloud deck (value-noise FBM, slowly drifting) that brightens
 * toward the horizon, so the fog and sky meet seamlessly and towers dissolve downward into
 * white. A faint warm patch marks where the sun is behind the clouds. Also baked into a PMREM
 * for PBR specular.
 */
import * as THREE from "three";

export const SUN_DIR = new THREE.Vector3(0.45, 0.32, -0.66).normalize();

export const SKY = {
  zenith: new THREE.Color(0xaeb2b5),
  horizon: new THREE.Color(0xd8d6cf),
  cloudDark: new THREE.Color(0xa6aaad),
  cloudLight: new THREE.Color(0xd6d7d5),
  sun: new THREE.Color(0xf2e2c8),
};

const vert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const frag = /* glsl */ `
  uniform vec3 zenith; uniform vec3 horizon; uniform vec3 cloudDark; uniform vec3 cloudLight; uniform vec3 sunColor;
  uniform vec3 sunDir; uniform float uTime;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    // Base gradient.
    float t = pow(max(h, 0.0), 0.6);
    vec3 col = mix(horizon, zenith, t);
    // Cloud deck: project onto a plane at height so the sky has perspective.
    if (h > 0.005) {
      vec2 uv = d.xz / (h + 0.12) * 1.6 + vec2(uTime * 0.008, uTime * 0.004);
      float c = fbm(uv);
      float c2 = fbm(uv * 3.1 + 5.0);
      float cloud = smoothstep(0.3, 0.8, c * 0.7 + c2 * 0.3);
      vec3 cloudCol = mix(cloudDark, cloudLight, cloud);
      float cover = smoothstep(0.0, 0.25, h);
      col = mix(col, cloudCol, cover * 0.7);
      // Thin the deck near the horizon so it fades into haze.
      col = mix(horizon, col, smoothstep(0.0, 0.22, h));
    } else {
      col = mix(horizon, horizon * 0.94, smoothstep(0.0, -0.3, h));
    }
    // Sun behind cloud: broad warm glow, no disc.
    float sd = max(dot(d, sunDir), 0.0);
    col += sunColor * (pow(sd, 18.0) * 0.16 + pow(sd, 4.0) * 0.05);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: SKY.zenith },
      horizon: { value: SKY.horizon },
      cloudDark: { value: SKY.cloudDark },
      cloudLight: { value: SKY.cloudLight },
      sunColor: { value: SKY.sun },
      sunDir: { value: SUN_DIR },
      uTime: { value: 0 },
    },
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

export class Sky {
  readonly dome: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    this.mat = createSkyMaterial();
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(520, 40, 20), this.mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), createSkyMaterial()));
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();

    // Kept so three compiles the fog chunks; the actual fog is the height-fog patch.
    scene.fog = new THREE.FogExp2(SKY.horizon, 0.0001);
  }

  update(time: number, cameraPos: THREE.Vector3): void {
    this.mat.uniforms.uTime.value = time;
    this.dome.position.copy(cameraPos);
  }
}
