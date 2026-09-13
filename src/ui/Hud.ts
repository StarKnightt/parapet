/**
 * Minimal HUD: click-to-play overlay, run timer with best time, a fading controls hint,
 * checkpoint/finish toasts, and an F3 debug readout.
 */

export class Hud {
  private readonly overlay: HTMLDivElement;
  private readonly timer: HTMLDivElement;
  private readonly timerValue: HTMLSpanElement;
  private readonly best: HTMLSpanElement;
  private readonly hint: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly debug: HTMLDivElement;
  private toastTimer = 0;
  private debugOn = false;

  constructor(root: HTMLElement) {
    root.innerHTML = "";
    const dot = document.createElement("div");
    dot.className = "dot";
    root.appendChild(dot);

    this.timer = document.createElement("div");
    this.timer.className = "timer";
    this.timerValue = document.createElement("span");
    this.timerValue.textContent = "0:00.00";
    this.best = document.createElement("span");
    this.best.className = "best";
    this.timer.append(this.timerValue, this.best);
    root.appendChild(this.timer);

    this.hint = document.createElement("div");
    this.hint.className = "hint";
    this.hint.innerHTML =
      `<div><kbd>W A S D</kbd>move</div>` +
      `<div><kbd>Shift</kbd>sprint</div>` +
      `<div><kbd>Space</kbd>jump</div>` +
      `<div><kbd>Ctrl</kbd>slide</div>` +
      `<div><kbd>R</kbd>restart</div>`;
    root.appendChild(this.hint);

    this.toast = document.createElement("div");
    this.toast.className = "toast";
    root.appendChild(this.toast);

    this.overlay = document.createElement("div");
    this.overlay.className = "overlay";
    this.overlay.innerHTML =
      `<h1>PARA<span>PET</span></h1>` +
      `<p>click to run</p>` +
      `<div class="keys">` +
      `<b>WASD</b><span>move</span>` +
      `<b>Shift</b><span>sprint</span>` +
      `<b>Space</b><span>jump</span>` +
      `<b>Ctrl / C</b><span>slide</span>` +
      `<b>R</b><span>restart</span>` +
      `</div>`;
    root.appendChild(this.overlay);

    this.debug = document.createElement("div");
    this.debug.className = "debug";
    root.appendChild(this.debug);
  }

  setLocked(locked: boolean): void {
    this.overlay.classList.toggle("hidden", locked);
  }

  fadeHint(): void {
    this.hint.classList.add("faded");
  }

  showHint(): void {
    this.hint.classList.remove("faded");
  }

  setTimer(seconds: number, running: boolean): void {
    this.timer.classList.toggle("on", running || seconds > 0);
    this.timerValue.textContent = formatTime(seconds);
  }

  setBest(seconds: number | null): void {
    this.best.textContent = seconds === null ? "" : `best ${formatTime(seconds)}`;
  }

  showToast(text: string, finish = false, seconds = 1.4): void {
    this.toast.textContent = text;
    this.toast.classList.toggle("finish", finish);
    this.toast.classList.add("on");
    this.toastTimer = seconds;
  }

  toggleDebug(): boolean {
    this.debugOn = !this.debugOn;
    this.debug.classList.toggle("on", this.debugOn);
    return this.debugOn;
  }

  setDebug(text: string): void {
    if (this.debugOn) this.debug.textContent = text;
  }

  update(dt: number): void {
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove("on");
    }
  }
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(2).padStart(5, "0")}`;
}
