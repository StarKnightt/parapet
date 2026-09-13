/**
 * onBeforeCompile patches shared by every world material.
 *
 * 1. Analytic exponential height fog (Quilez): density falls off with altitude, so the
 *    street level drowns in near-white haze while tower tops stay crisp. Replaces three's
 *    fog_fragment; scene.fog must still be set so the fog chunks are compiled in.
 * 2. Weathered concrete detail (concrete only): world-space tint noise (olive ↔ tan),
 *    dark panel seams on face-tangent axes, dirt gradient at the foot of each box and drip
 *    darkening under its cap, and stronger staining on horizontal surfaces.
 */
import * as THREE from "three";

export const FOG_UNIFORMS = {
  uFogDensity: { value: 0.16 },
  uFogFalloff: { value: 0.2 },
  uFogBase: { value: 0.0 },
  uFogDist: { value: 0.0019 },
  uFogColor: { value: new THREE.Color(0xd8d6cf) },
  uFogColorUp: { value: new THREE.Color(0xc3c5c5) },
};

const VARYINGS_VERT = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWNormal;
  #ifdef USE_BOXFRAC
  attribute vec2 aBox;
  varying vec2 vBox;
  #endif
`;

const VARYINGS_FRAG = /* glsl */ `
  varying vec3 vWorldPos;
  varying vec3 vWNormal;
  #ifdef USE_BOXFRAC
  varying vec2 vBox;
  #endif
  uniform float uFogDensity; uniform float uFogFalloff; uniform float uFogBase; uniform float uFogDist;
  uniform vec3 uFogColor; uniform vec3 uFogColorUp;
`;

const FOG_VERTEX = /* glsl */ `
  vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vWNormal = normalize(mat3(modelMatrix) * objectNormal);
  #ifdef USE_BOXFRAC
  vBox = aBox;
  #endif
`;

const FOG_FRAGMENT = /* glsl */ `
  {
    vec3 ray = vWorldPos - cameraPosition;
    float dist = length(ray);
    vec3 rd = ray / max(dist, 1e-4);
    float ry = rd.y;
    if (abs(ry) < 1e-3) ry = ry < 0.0 ? -1e-3 : 1e-3;
    float b = uFogFalloff;
    float h = (uFogDensity / b) * exp(-(cameraPosition.y - uFogBase) * b) * (1.0 - exp(-dist * ry * b)) / ry;
    float amount = 1.0 - exp(-(h + dist * uFogDist));
    amount = clamp(amount, 0.0, 1.0);
    vec3 fogCol = mix(uFogColor, uFogColorUp, smoothstep(0.0, 0.5, rd.y));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, amount);
  }
`;

const CONCRETE_DETAIL = /* glsl */ `
  {
    vec3 n = abs(normalize(vWNormal));
    vec3 p = vWorldPos;

    // Low-frequency world tint: olive-grey ↔ warm tan, breaks up identical faces.
    float t1 = sin(p.x * 0.11 + p.y * 0.07) * sin(p.z * 0.09 - p.y * 0.05) * 0.5 + 0.5;
    float t2 = sin(p.x * 0.031 + 1.7) * sin(p.z * 0.027 + p.y * 0.02) * 0.5 + 0.5;
    vec3 olive = vec3(0.80, 0.83, 0.70);
    vec3 tan_ = vec3(1.06, 0.97, 0.82);
    vec3 tint = mix(olive, tan_, t1 * 0.6 + t2 * 0.4);
    // Mid-frequency patches (pour differences / damp) for tonal contrast.
    float pour = sin(p.x * 0.53 + p.y * 0.71 + 3.1) * sin(p.z * 0.47 - p.y * 0.38) * sin((p.x + p.z) * 0.29);
    tint *= 1.0 + pour * 0.13;
    diffuseColor.rgb *= tint;

    // Second speckle octave.
    #ifdef USE_MAP
    vec3 detail = texture2D(map, vMapUv * 3.7 + 0.31).rgb;
    diffuseColor.rgb *= mix(vec3(1.0), detail * 1.42, 0.35);
    #endif

    // Panel seams on the axes tangent to this face.
    float sx = (1.0 - n.x) * smoothstep(0.985, 1.0, abs(fract(p.x / 3.0) * 2.0 - 1.0));
    float sz = (1.0 - n.z) * smoothstep(0.985, 1.0, abs(fract(p.z / 3.0) * 2.0 - 1.0));
    float sy = (1.0 - n.y) * smoothstep(0.982, 1.0, abs(fract(p.y / 2.6) * 2.0 - 1.0));
    float seam = max(max(sx, sz), sy);
    diffuseColor.rgb *= 1.0 - seam * 0.42;

    #ifdef USE_BOXFRAC
    // Dirt at the foot of walls, drips under caps; only on vertical faces.
    float vert = 1.0 - n.y;
    float foot = smoothstep(0.42, 0.0, vBox.x) * min(vBox.y, 4.0) / 4.0;
    float cap = smoothstep(0.82, 1.0, vBox.x);
    float streak = 0.6 + 0.4 * (sin(p.x * 7.3 + p.z * 5.1) * 0.5 + 0.5);
    diffuseColor.rgb *= 1.0 - vert * foot * 0.38;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.78, 0.82, 0.68), vert * foot * 0.5);
    diffuseColor.rgb *= 1.0 - vert * cap * 0.16 * streak;
    #endif

    // Horizontal surfaces: heavier, more olive staining.
    float horiz = smoothstep(0.6, 1.0, n.y);
    float stain = sin(p.x * 0.43 + 2.0) * sin(p.z * 0.37) * 0.5 + 0.5;
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.74, 0.76, 0.66), horiz * (0.25 + 0.35 * stain));
  }
`;

export interface PatchOptions {
  concrete?: boolean;
  boxFrac?: boolean;
}

export function patchMaterial(mat: THREE.Material, opts: PatchOptions = {}): void {
  const m = mat as THREE.Material & { defines?: Record<string, unknown> };
  if (opts.boxFrac) {
    m.defines = { ...(m.defines ?? {}), USE_BOXFRAC: "" };
  }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, FOG_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace("#include <fog_pars_vertex>", "#include <fog_pars_vertex>\n" + VARYINGS_VERT)
      .replace("#include <fog_vertex>", "#include <fog_vertex>\n" + FOG_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <fog_pars_fragment>", "#include <fog_pars_fragment>\n" + VARYINGS_FRAG)
      .replace("#include <fog_fragment>", FOG_FRAGMENT);
    if (opts.concrete) {
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\n" + CONCRETE_DETAIL);
    }
  };
  mat.customProgramCacheKey = () => `parapet-${opts.concrete ? "c" : "p"}-${opts.boxFrac ? "b" : ""}`;
}
