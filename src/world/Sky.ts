/**
 * Late-afternoon haze. A gradient dome (zenith → warm horizon) with a soft sun glow, also
 * baked into a PMREM so glass and steel pick up believable reflections. Fog matches the
 * horizon so buildings dissolve into the sky instead of hitting a hard colour wall.
 */
import * as THREE from "three";

export const SUN_DIR = new THREE.Vector3(0.45, 0.24, -0.66).normalize();

export const SKY = {
  zenith: new THREE.Color(0x8797a6),
  mid: new THREE.Color(0xb3b7b9),
  horizon: new THREE.Color(0xd9c9b2),
  sun: new THREE.Color(0xffd9a8),
  fog: new THREE.Color(0xc9bdab),
};

const vert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const frag = /* glsl */ `
  uniform vec3 zenith; uniform vec3 mid; uniform vec3 horizon; uniform vec3 sunColor; uniform vec3 sunDir;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -1.0, 1.0);
    float t = pow(max(h, 0.0), 0.55);
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.35, t));
    col = mix(col, zenith, smoothstep(0.3, 1.0, t));
    // Below the horizon: darker ground haze.
    col = mix(col, horizon * 0.82, smoothstep(0.0, -0.25, h));
    float sd = max(dot(d, sunDir), 0.0);
    col += sunColor * (pow(sd, 1400.0) * 2.5 + pow(sd, 48.0) * 0.22 + pow(sd, 5.0) * 0.06);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      zenith: { value: SKY.zenith },
      mid: { value: SKY.mid },
      horizon: { value: SKY.horizon },
      sunColor: { value: SKY.sun },
      sunDir: { value: SUN_DIR },
    },
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
}

export function createSky(renderer: THREE.WebGLRenderer, scene: THREE.Scene): THREE.Mesh {
  const mat = createSkyMaterial();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);

  // Environment for PBR specular from the same dome.
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), createSkyMaterial()));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();

  scene.fog = new THREE.FogExp2(SKY.fog, 0.0052);
  return dome;
}
