/**
 * Late-afternoon sky. A blue zenith falling to a pale warm horizon, a low sun with disc,
 * corona and a broad forward-scatter glow, a scattered-cumulus deck (value-noise FBM, drifting)
 * whose sun-facing edges go cream and whose undersides go cool, a thin high cirrus veil, and a
 * warm haze band at the horizon that the height fog meets seamlessly. Also baked into a PMREM
 * so glass and metal pick up blue from above and gold from the sun side.
 */
import * as THREE from "three";

/**
 * Toward the sun. Elevation 25°, azimuth 6° off the run axis, behind the runner (the sun sits
 * over the calibration pad, slightly to the runner's right). The route is a slot between
 * 30–55 m towers, so any sun that is not nearly along the axis buries whole roofs in their
 * shadow; this angle keeps ~2/3 of the route roof (and 90 % of the spawn roof) in sun, lights
 * the facades the player runs toward, and throws the long shadows of stair-heads, plant and
 * parapets ahead along the run.
 */
export const SUN_DIR = new THREE.Vector3(-0.901, 0.423, 0.095).normalize();

export const SKY = {
  zenith: new THREE.Color(0x3a70b8),
  horizon: new THREE.Color(0xb7cbe0),
  horizonSun: new THREE.Color(0xf4dbb6),
  haze: new THREE.Color(0xe6dccc),
  cloudDark: new THREE.Color(0x98a4b4),
  cloudLight: new THREE.Color(0xfff3e2),
  sun: new THREE.Color(0xffd9a4),
};

const vert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const frag = /* glsl */ `
  uniform vec3 zenith; uniform vec3 horizon; uniform vec3 horizonSun; uniform vec3 haze;
  uniform vec3 cloudDark; uniform vec3 cloudLight; uniform vec3 sunColor;
  uniform vec3 sunDir; uniform float uTime;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm3(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
    return v;
  }
  // Five octaves, also handing back the first three so the self-shadow term can compare
  // against a matching fbm3 sample without a second five-octave evaluation.
  float fbm5(vec2 p, out float low) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 3; i++) { v += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
    low = v;
    for (int i = 0; i < 2; i++) { v += a * vnoise(p); p = p * 2.03 + 17.0; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    float sd = dot(d, sunDir);
    // Horizontal closeness to the sun's azimuth: warms the horizon and the haze on that side.
    vec2 dh = normalize(d.xz + vec2(1e-4, 0.0));
    vec2 sh = normalize(sunDir.xz);
    float az = max(dot(dh, sh), 0.0);
    float warmSide = pow(az, 3.5);

    // Base gradient: blue overhead, paler and warmer toward the horizon, warmest under the sun.
    vec3 hor = mix(horizon, horizonSun, warmSide);
    float t = pow(clamp(h, 0.0, 1.0), 0.45);
    vec3 col = mix(hor, zenith, t);
    // Blue deepens slightly opposite the sun.
    col *= 1.0 - 0.12 * (1.0 - az) * t;

    // Forward scatter (Mie): broad warm bloom around the sun, a tight corona, then the disc
    // itself (~0.8° radius, HDR-bright so ACES rolls it to white-gold and glass catches it).
    float sdp = max(sd, 0.0);
    col += sunColor * (pow(sdp, 5.0) * 0.09 + pow(sdp, 150.0) * 0.4);
    col += sunColor * vec3(1.0, 0.82, 0.55) * pow(sdp, 900.0) * 1.8;
    col += sunColor * smoothstep(0.99982, 0.99993, sd) * 8.0;

    if (h > 0.003) {
      // Cumulus deck on a plane above the camera; anisotropic so it streaks with the wind.
      vec2 uv = d.xz / (h + 0.12) * 1.3 + vec2(uTime * 0.006, uTime * 0.003);
      uv = vec2(uv.x * 0.85, uv.y) * 0.8;
      float cLow;
      float c = fbm5(uv, cLow);
      float c2 = fbm3(uv * 3.3 + 5.0);
      float dens = c * 0.72 + c2 * 0.28;
      // Scattered cumulus: a high threshold leaves most of the dome blue, the puffs keep a soft
      // but definite edge.
      float cloud = smoothstep(0.53, 0.70, dens);
      // Cheap self-shadowing: density a little toward the sun; where it is thinner the edge is lit.
      float cs = fbm3(uv + sh * 0.12 + vec2(0.0, 0.05));
      float lit = clamp((cLow - cs) * 7.0 + 0.55, 0.0, 1.0);
      lit = mix(lit, 1.0, pow(sdp, 3.0) * 0.5);
      vec3 cloudCol = mix(cloudDark, cloudLight, lit);
      // Sun-side clouds borrow the sun colour; the far side stays cool.
      cloudCol = mix(cloudCol, cloudCol * vec3(1.06, 0.98, 0.90), warmSide);
      // Fade the deck into the horizon haze and thin it overhead so blue stays dominant.
      float cover = smoothstep(0.0, 0.16, h) * (1.0 - 0.4 * smoothstep(0.45, 1.0, h));
      col = mix(col, cloudCol, cloud * cover * 0.94);

      // Thin cirrus veil, high and faint, so the blue is never a flat fill.
      vec2 uv2 = d.xz / (h + 0.25) * vec2(0.7, 1.3) + vec2(uTime * 0.002, 0.0) + 31.0;
      float cir = smoothstep(0.58, 0.85, fbm3(uv2)) * smoothstep(0.12, 0.4, h);
      col = mix(col, mix(cloudLight, sunColor, 0.3), cir * 0.14);
    }

    // Haze band at the horizon (warm under the sun, cooler opposite), continuing below it.
    vec3 hazeCol = mix(haze * vec3(0.94, 0.97, 1.02), haze * vec3(1.04, 0.99, 0.92), warmSide);
    hazeCol += sunColor * pow(sdp, 8.0) * 0.10;
    float band = 1.0 - smoothstep(0.0, 0.11, abs(h));
    col = mix(col, hazeCol, band * 0.66);
    col = mix(col, hazeCol * 0.92, smoothstep(0.0, -0.25, h));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: SKY.zenith },
      horizon: { value: SKY.horizon },
      horizonSun: { value: SKY.horizonSun },
      haze: { value: SKY.haze },
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
    // Drawn after the opaque world (depth-tested, never written) so the fullscreen cloud
    // shader only runs on the pixels where sky is actually visible. The dome (r = 520) sits
    // inside the camera far plane (600), so everything else still lands in front of it.
    this.dome.renderOrder = 10;
    scene.add(this.dome);

    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), createSkyMaterial()));
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.02).texture;
    pmrem.dispose();

    // Kept so three compiles the fog chunks; the actual fog is the height-fog patch.
    scene.fog = new THREE.FogExp2(SKY.haze, 0.0001);
  }

  update(time: number, cameraPos: THREE.Vector3): void {
    this.mat.uniforms.uTime.value = time;
    this.dome.position.copy(cameraPos);
  }
}
