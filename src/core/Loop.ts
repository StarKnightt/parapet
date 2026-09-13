/**
 * Fixed-step simulation, variable-rate render.
 *
 * Gameplay runs at 120 Hz so a sprinting player (8.5 m/s) moves ~7 cm per step against
 * 20 cm walls — no tunnelling, deterministic feel regardless of monitor refresh. Frame
 * delta is clamped to 100 ms so a tab switch never spirals into hundreds of steps.
 */
export const FIXED_DT = 1 / 120;
const MAX_FRAME_DT = 0.1;

export class Loop {
  private last = 0;
  private acc = 0;
  private running = false;
  private handle = 0;

  constructor(
    private readonly fixedUpdate: (dt: number) => void,
    private readonly frameUpdate: (dt: number, alpha: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      let dt = (now - this.last) / 1000;
      this.last = now;
      if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
      this.acc += dt;
      let steps = 0;
      while (this.acc >= FIXED_DT && steps < 16) {
        this.fixedUpdate(FIXED_DT);
        this.acc -= FIXED_DT;
        steps++;
      }
      this.frameUpdate(dt, this.acc / FIXED_DT);
      this.handle = requestAnimationFrame(tick);
    };
    this.handle = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }
}
