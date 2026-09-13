/** Small numeric helpers shared by the controller, camera rig and world builders. */

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp01 = (v: number): number => clamp(v, 0, 1);

/** Frame-rate independent exponential approach: `a` moves toward `b` with time constant `tau` seconds. */
export const damp = (a: number, b: number, tau: number, dt: number): number =>
  b + (a - b) * Math.exp(-dt / Math.max(tau, 1e-5));

/** Move `a` toward `b` by at most `maxDelta`. */
export const moveToward = (a: number, b: number, maxDelta: number): number => {
  const d = b - a;
  if (Math.abs(d) <= maxDelta) return b;
  return a + Math.sign(d) * maxDelta;
};

export const smoothstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2;

export const DEG = Math.PI / 180;

/** Deterministic seeded RNG (mulberry32). All world variation goes through this, never Math.random. */
export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
