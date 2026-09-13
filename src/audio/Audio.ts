/**
 * All sound is synthesised in Web Audio at runtime: no files, nothing to load.
 *
 *   wind       looping filtered noise; louder and brighter with speed and in the air
 *   footsteps  noise tap + low thump, coloured by surface (metal rings, concrete knocks)
 *   landing    sine drop + noise slap, scaled by impact speed
 *   slide      sustained scrape whoosh while sliding
 *   wall-run   sustained lighter scrape while on the wall
 *   mantle / wall-jump / jump   short whooshes
 *   checkpoint / finish        two quiet tones
 *
 * The context starts on the first click or key (browser autoplay rules).
 */
import type { Surface } from "../world/CollisionWorld";
import { clamp } from "../core/math";

const MASTER = 0.6;

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private muted = false;

  // Continuous layers.
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private windLevel = 0;
  private windCut = 400;
  private scrape: { gain: GainNode; src: AudioBufferSourceNode; filter: BiquadFilterNode } | null = null;

  /** Call from a user-gesture handler; safe to call repeatedly. */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER;
    // Gentle limiter so stacked hits never clip.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 18;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    this.master.connect(comp).connect(ctx.destination);

    // 2 s of white noise, reused by everything.
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // Wind: two noise sources through a wandering band-pass.
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = this.windCut;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1800;
    this.loop().connect(this.windFilter).connect(lp).connect(this.windGain).connect(this.master);
    // Slow LFO on the band centre so the wind breathes.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(this.windFilter.frequency);
    lfo.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : MASTER, this.ctx.currentTime, 0.05);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get state(): string {
    return this.ctx ? this.ctx.state : "off";
  }

  /** Per frame: drive the continuous layers. */
  update(dt: number, speed: number, grounded: number, sliding: boolean, wallrun: boolean): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const air = 1 - grounded;
    const target = 0.05 + clamp(speed / 10, 0, 1) * 0.16 + air * 0.12;
    this.windLevel += (target - this.windLevel) * Math.min(1, dt * 4);
    this.windGain.gain.setTargetAtTime(this.windLevel, t, 0.08);
    const cut = 320 + clamp(speed / 10, 0, 1) * 500 + air * 400;
    this.windCut += (cut - this.windCut) * Math.min(1, dt * 3);
    this.windFilter.frequency.setTargetAtTime(this.windCut, t, 0.1);

    const wantScrape = sliding || wallrun;
    if (wantScrape && !this.scrape) this.startScrape(wallrun ? 900 : 520, wallrun ? 0.09 : 0.16);
    if (!wantScrape && this.scrape) this.stopScrape();
    if (this.scrape) {
      const s = clamp(speed / 10, 0.2, 1);
      this.scrape.gain.gain.setTargetAtTime((wallrun ? 0.09 : 0.16) * s, t, 0.05);
      this.scrape.filter.frequency.setTargetAtTime((wallrun ? 900 : 520) * (0.7 + 0.5 * s), t, 0.08);
    }
  }

  // ---------------------------------------------------------------- one-shots

  footstep(surface: Surface, speed: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = clamp(0.25 + speed / 12, 0.3, 0.95);
    const metal = surface === "metal";
    // Tap: short band-passed noise.
    this.burst(t, metal ? 0.05 : 0.035, metal ? 2400 + Math.random() * 600 : 900 + Math.random() * 300, metal ? 2.5 : 1.2, v * (metal ? 0.22 : 0.28));
    // Thump.
    this.thump(t, metal ? 170 : 95, metal ? 70 : 48, metal ? 0.09 : 0.07, v * (metal ? 0.18 : 0.3));
    if (metal) this.tone(t, 640 + Math.random() * 120, 0.16, v * 0.05, "triangle");
  }

  land(impact: number, surface: Surface): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = clamp((impact - 3) / 12, 0.15, 1);
    const metal = surface === "metal";
    this.thump(t, metal ? 160 : 120, metal ? 55 : 38, 0.16 + k * 0.12, 0.35 + k * 0.5);
    this.burst(t, 0.07 + k * 0.05, metal ? 1800 : 700, 0.9, 0.18 + k * 0.25);
    if (metal) this.tone(t, 520, 0.3, 0.08 * k, "triangle");
  }

  jump(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.09, 600, 0.7, 0.09, 1400);
  }

  mantle(height: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = clamp(height / 1.5, 0.4, 1);
    // Cloth whoosh rising in pitch, then a hand-slap on the ledge.
    this.burst(t, 0.22 * k + 0.1, 500, 0.8, 0.2, 1500);
    this.burst(t + 0.12 * k, 0.04, 1100, 1.5, 0.12);
    this.thump(t + 0.12 * k, 110, 60, 0.06, 0.12);
  }

  slideStart(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.14, 700, 0.8, 0.16, 350);
  }

  wallJump(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.16, 800, 0.9, 0.18, 2200);
    this.thump(t, 130, 70, 0.05, 0.14);
  }

  checkpoint(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(t, 660, 0.18, 0.05, "sine");
    this.tone(t + 0.09, 880, 0.24, 0.04, "sine");
  }

  finish(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const [i, f] of [523, 659, 784, 1046].entries()) this.tone(t + i * 0.11, f, 0.5, 0.05, "sine");
  }

  // ---------------------------------------------------------------- primitives

  private loop(): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start();
    return src;
  }

  /** Band-passed noise with a fast attack and exponential decay; optional filter sweep. */
  private burst(t: number, dur: number, freq: number, q: number, gain: number, sweepTo?: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loopStart = Math.random() * 1.5;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, src.loopStart);
    src.stop(t + dur + 0.02);
  }

  /** Low sine that drops in pitch: footfall and landing body. */
  private thump(t: number, f0: number, f1: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private tone(t: number, f: number, dur: number, gain: number, type: OscillatorType): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private startScrape(freq: number, gain: number): void {
    const ctx = this.ctx!;
    const src = this.loop();
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.04);
    src.connect(filter).connect(g).connect(this.master);
    this.scrape = { gain: g, src, filter };
  }

  private stopScrape(): void {
    if (!this.scrape || !this.ctx) return;
    const { gain, src } = this.scrape;
    const t = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.08);
    src.stop(t + 0.1);
    this.scrape = null;
  }
}
