/**
 * onBeforeCompile patches shared by every world material.
 *
 * 1. Analytic exponential height fog (Quilez): density falls off with altitude, so the
 *    street level drowns in near-white haze while tower tops stay crisp. Replaces three's
 *    fog_fragment; scene.fog must still be set so the fog chunks are compiled in.
 * 2. Weathered concrete detail (concrete only): world-space tint noise (warm grey ↔ ochre),
 *    dark panel seams on face-tangent axes, dirt gradient at the foot of each box and drip
 *    darkening under its cap, and stronger staining on horizontal surfaces.
 * 3. Weathered painted steel (metal only): warm/cool paint drift and bleached patches in
 *    world space, rust-brown grime at the foot of each cabinet, drips under the top edge,
 *    a second grain octave to hide the tile repeat, and a dust film + rust rings on tops.
 */
import * as THREE from "three";
import { SUN_DIR } from "./Sky";

export const FOG_UNIFORMS = {
  uFogDensity: { value: 0.13 },
  uFogFalloff: { value: 0.2 },
  uFogBase: { value: 0.0 },
  uFogDist: { value: 0.00045 },
  /** Haze away from the sun: cool blue-grey. */
  uFogColor: { value: new THREE.Color(0xc3ccd6) },
  /** Haze toward the sun: warm cream. */
  uFogColorSun: { value: new THREE.Color(0xf1dcbe) },
  /** Haze when looking up: sky blue. */
  uFogColorUp: { value: new THREE.Color(0x9fb8d6) },
  uSunDir: { value: SUN_DIR },
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
  uniform vec3 uFogColor; uniform vec3 uFogColorSun; uniform vec3 uFogColorUp; uniform vec3 uSunDir;
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
    // Aerial perspective: cream toward the sun's azimuth, blue-grey away, sky-blue overhead.
    vec2 fh = normalize(rd.xz + vec2(1e-4, 0.0));
    float toSun = pow(max(dot(fh, normalize(uSunDir.xz)), 0.0), 2.5);
    vec3 fogCol = mix(uFogColor, uFogColorSun, toSun);
    fogCol = mix(fogCol, uFogColorUp, smoothstep(0.0, 0.5, rd.y));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, amount);
  }
`;

const CONCRETE_DETAIL = /* glsl */ `
  {
    vec3 n = abs(normalize(vWNormal));
    vec3 p = vWorldPos;

    // Low-frequency world tint: warm grey ↔ pale ochre, breaks up identical faces.
    float t1 = sin(p.x * 0.11 + p.y * 0.07) * sin(p.z * 0.09 - p.y * 0.05) * 0.5 + 0.5;
    float t2 = sin(p.x * 0.031 + 1.7) * sin(p.z * 0.027 + p.y * 0.02) * 0.5 + 0.5;
    vec3 olive = vec3(0.84, 0.82, 0.77);
    vec3 tan_ = vec3(1.0, 0.95, 0.86);
    vec3 tint = mix(olive, tan_, t1 * 0.6 + t2 * 0.4);
    // Mid-frequency patches (pour differences / damp) for tonal contrast.
    float pour = sin(p.x * 0.53 + p.y * 0.71 + 3.1) * sin(p.z * 0.47 - p.y * 0.38) * sin((p.x + p.z) * 0.29);
    tint *= 1.0 + pour * 0.13;
    // Per-face jitter so no two faces of one mass match.
    vec3 sn = sign(vWNormal);
    tint *= 1.0 + dot(sn, vec3(0.05, 0.02, -0.04));
    diffuseColor.rgb *= tint;

    // Face-tangent coordinate (u along the wall, v up) for streaks and seams.
    float u = n.x > 0.5 ? p.z : p.x;

    // Second speckle octave.
    #ifdef USE_MAP
    vec3 detail = texture2D(map, vMapUv * 3.7 + 0.31).rgb;
    diffuseColor.rgb *= mix(vec3(1.0), detail * 1.75, 0.4);
    #endif

    // Panel seams on the axes tangent to this face (faint, irregular-ish spacing).
    float sx = (1.0 - n.x) * smoothstep(0.988, 1.0, abs(fract(p.x / 2.4 + 0.13) * 2.0 - 1.0));
    float sz = (1.0 - n.z) * smoothstep(0.988, 1.0, abs(fract(p.z / 2.4 + 0.41) * 2.0 - 1.0));
    float sy = (1.0 - n.y) * smoothstep(0.985, 1.0, abs(fract(p.y / 1.3) * 2.0 - 1.0));
    float seam = max(max(sx, sz), sy);
    diffuseColor.rgb *= 1.0 - seam * 0.22;

    float vert = 1.0 - n.y;
    // Vertical rain streaks: thin, tall noise stretched along y.
    float sk = sin(u * 23.0) * sin(u * 7.1 + 1.3) * sin(u * 2.9 + p.y * 0.05);
    float streak = smoothstep(0.1, 0.9, sk * 0.5 + 0.5);

    #ifdef USE_BOXFRAC
    // Dirt at the foot of walls, drips under caps; only on vertical faces.
    float foot = smoothstep(0.42, 0.0, vBox.x) * min(vBox.y, 4.0) / 4.0;
    float cap = smoothstep(0.78, 1.0, vBox.x);
    diffuseColor.rgb *= 1.0 - vert * foot * (0.3 + 0.2 * streak);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.80, 0.76, 0.68), vert * foot * 0.5);
    diffuseColor.rgb *= 1.0 - vert * cap * (0.12 + 0.28 * streak);
    #else
    diffuseColor.rgb *= 1.0 - vert * streak * 0.12;
    #endif
    // Mid-wall streaking (lighter).
    diffuseColor.rgb *= 1.0 - vert * streak * 0.1;

    // Horizontal surfaces: heavier, dusty-ochre staining, plus darker damp patches.
    float horiz = smoothstep(0.6, 1.0, n.y);
    float stain = sin(p.x * 0.43 + 2.0) * sin(p.z * 0.37) * 0.5 + 0.5;
    float puddle = smoothstep(0.55, 0.9, sin(p.x * 0.21 + 1.0) * sin(p.z * 0.17 + 0.4));
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.84, 0.80, 0.72), horiz * (0.15 + 0.3 * stain));
    diffuseColor.rgb *= 1.0 - horiz * puddle * 0.13;
  }
`;

const METAL_DETAIL = /* glsl */ `
  {
    vec3 n = abs(normalize(vWNormal));
    vec3 p = vWorldPos;
    float vert = 1.0 - n.y;
    float horiz = smoothstep(0.6, 1.0, n.y);

    // World-space paint variation: slow warm/cool drift plus a per-face jitter, so a row of
    // identical cabinets in the same tint never reads as clones.
    float t1 = sin(p.x * 0.23 + p.y * 0.31) * sin(p.z * 0.19 - p.y * 0.17) * 0.5 + 0.5;
    float t2 = sin(p.x * 0.071 + 2.3) * sin(p.z * 0.083 + p.y * 0.05) * 0.5 + 0.5;
    vec3 cool = vec3(0.94, 0.96, 1.0);
    vec3 warm = vec3(1.04, 1.0, 0.94);
    vec3 tint = mix(cool, warm, t1 * 0.55 + t2 * 0.45);
    vec3 sn = sign(vWNormal);
    tint *= 1.0 + dot(sn, vec3(0.03, 0.0, -0.03));
    // Fade patches: bleached paint in blotches.
    float fade = smoothstep(0.35, 0.95, sin(p.x * 0.9 + p.y * 0.7 + 1.0) * sin(p.z * 0.8 - p.y * 0.5 + 2.0));
    tint *= 1.0 + fade * 0.09;
    diffuseColor.rgb *= tint;

    // Face-tangent coordinate along the panel for streaks.
    float u = n.x > 0.5 ? p.z : p.x;
    float sk = sin(u * 31.0) * sin(u * 9.3 + 1.3) * sin(u * 3.7 + p.y * 0.1);
    float streak = smoothstep(0.2, 0.95, sk * 0.5 + 0.5);

    #ifdef USE_MAP
    // Second grain octave so the tile repeat is hidden on long runs of pipe and rail.
    vec3 detail = texture2D(map, vMapUv * 2.63 + 0.47).rgb;
    diffuseColor.rgb *= mix(vec3(1.0), detail * 1.45, 0.35);
    // Rust from the map is orange in the red channel: strengthen it where water runs.
    float rustiness = clamp((detail.r - detail.b) * 4.0, 0.0, 1.0);
    #else
    float rustiness = 0.0;
    #endif

    #ifdef USE_BOXFRAC
    // Grime and splash-back at the foot; drips under the top edge. Vertical faces only.
    float footFrac = smoothstep(0.5, 0.0, vBox.x);
    float foot = footFrac * min(vBox.y, 2.5) / 2.5;
    float cap = smoothstep(0.82, 1.0, vBox.x);
    diffuseColor.rgb *= 1.0 - vert * foot * (0.28 + 0.22 * streak);
    // Foot grime is brown-orange (rust wash + dirt), not neutral.
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.9, 0.72, 0.52), vert * foot * (0.35 + 0.4 * rustiness));
    diffuseColor.rgb *= 1.0 - vert * cap * (0.1 + 0.25 * streak);
    #else
    diffuseColor.rgb *= 1.0 - vert * streak * 0.1;
    #endif
    // Lighter mid-panel streaking.
    diffuseColor.rgb *= 1.0 - vert * streak * 0.08;

    // Tops: dust film (paler, warmer) with standing-water rings and a rust ring or two.
    float dust = sin(p.x * 0.7 + 1.0) * sin(p.z * 0.6 + 0.4) * 0.5 + 0.5;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.04, 0.96) + vec3(0.02), horiz * (0.2 + 0.3 * dust));
    float ring = smoothstep(0.7, 0.95, sin(p.x * 1.7 + 0.5) * sin(p.z * 1.5 + 1.2));
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.7, 0.5, 0.36), horiz * ring * 0.35);
  }
`;

export interface PatchOptions {
  concrete?: boolean;
  /** Weathered painted-steel detail (tint drift, foot grime, rust wash, dust on tops). */
  metal?: boolean;
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
    } else if (opts.metal) {
      shader.fragmentShader = shader.fragmentShader.replace("#include <color_fragment>", "#include <color_fragment>\n" + METAL_DETAIL);
    }
  };
  mat.customProgramCacheKey = () => `parapet-${opts.concrete ? "c" : opts.metal ? "m" : "p"}-${opts.boxFrac ? "b" : ""}`;
}
