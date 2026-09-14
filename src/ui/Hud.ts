/**
 * Minimal HUD: click-to-play overlay, run timer with best time, a fading controls hint,
 * checkpoint split toasts, the end-of-run results card, a run title card, screen flashes,
 * and an F3 debug readout.
 */

export interface SplitRow {
  name: string;
  time: number;
  /** Seconds vs the best run's split at this checkpoint (negative = faster); null if no best. */
  delta: number | null;
}

export interface Results {
  time: number;
  best: number | null;
  newBest: boolean;
  splits: SplitRow[];
  line: string;
}

export class Hud {
  private readonly overlay: HTMLDivElement;
  private readonly timer: HTMLDivElement;
  private readonly timerValue: HTMLSpanElement;
  private readonly best: HTMLSpanElement;
  private readonly hint: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly toastName: HTMLSpanElement;
  private readonly toastDelta: HTMLSpanElement;
  private readonly results: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly flashEl: HTMLDivElement;
  private readonly debug: HTMLDivElement;
  private toastTimer = 0;
  private titleTimer = 0;
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
      `<div><kbd>Shift</kbd>walk</div>` +
      `<div><kbd>Space</kbd>jump</div>` +
      `<div><kbd>Ctrl</kbd>slide</div>` +
      `<div><kbd>R</kbd>restart</div>` +
      `<div><kbd>M</kbd>mute</div>`;
    root.appendChild(this.hint);

    this.toast = document.createElement("div");
    this.toast.className = "toast";
    this.toastName = document.createElement("span");
    this.toastDelta = document.createElement("span");
    this.toastDelta.className = "delta";
    this.toast.append(this.toastName, this.toastDelta);
    root.appendChild(this.toast);

    this.results = document.createElement("div");
    this.results.className = "results";
    root.appendChild(this.results);

    this.title = document.createElement("div");
    this.title.className = "title";
    root.appendChild(this.title);

    this.flashEl = document.createElement("div");
    this.flashEl.className = "flash";
    root.appendChild(this.flashEl);

    this.overlay = document.createElement("div");
    this.overlay.className = "overlay";
    this.overlay.innerHTML =
      `<h1>PARA<span>PET</span></h1>` +
      `<p>click to run</p>` +
      `<div class="keys">` +
      `<b>WASD</b><span>move</span>` +
      `<b>Shift</b><span>walk</span>` +
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

  showToast(text: string, seconds = 1.4): void {
    this.toastName.textContent = text;
    this.toastDelta.textContent = "";
    this.toast.classList.add("on");
    this.toastTimer = seconds;
  }

  /** Checkpoint name with the split against the best run. */
  showSplit(name: string, delta: number | null): void {
    this.toastName.textContent = name;
    this.toastDelta.textContent = delta === null ? "" : formatDelta(delta);
    this.toastDelta.classList.toggle("faster", delta !== null && delta < 0);
    this.toastDelta.classList.toggle("slower", delta !== null && delta >= 0);
    this.toast.classList.add("on");
    this.toastTimer = 1.8;
  }

  showResults(r: Results): void {
    const delta = r.best === null || r.newBest ? null : r.time - r.best;
    const rows = r.splits
      .map(
        (s) =>
          `<div class="row"><span class="n">${s.name}</span><span class="t">${formatTime(s.time)}</span>` +
          `<span class="d ${s.delta === null ? "" : s.delta < 0 ? "faster" : "slower"}">${s.delta === null ? "" : formatDelta(s.delta)}</span></div>`,
      )
      .join("");
    this.results.innerHTML =
      `<div class="kicker">${r.newBest ? "new best line" : "line complete"}</div>` +
      `<div class="time">${formatTime(r.time)}</div>` +
      `<div class="sub">${
        r.newBest && r.best !== null
          ? `<span class="faster">${formatDelta(r.time - r.best)}</span> off your best`
          : delta !== null
            ? `<span class="slower">${formatDelta(delta)}</span> vs best ${formatTime(r.best!)}`
            : "first line on the books"
      }</div>` +
      `<div class="splits">${rows}</div>` +
      `<div class="line">${r.line}</div>` +
      `<div class="again"><kbd>R</kbd> run it again</div>`;
    this.results.classList.add("on");
  }

  hideResults(): void {
    this.results.classList.remove("on");
  }

  /** Big letter-spaced card on the run start; fades on its own. */
  showTitle(text: string, sub: string, seconds = 2.6): void {
    this.title.innerHTML = `<div class="big">${text}</div><div class="small">${sub}</div>`;
    this.title.classList.add("on");
    this.titleTimer = seconds;
  }

  /** Full-screen flash: `dark` fades from black (respawn), otherwise a light blink (restart). */
  flash(dark: boolean): void {
    this.flashEl.classList.remove("dark", "light", "on");
    // Force a reflow so the transition restarts.
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add(dark ? "dark" : "light", "on");
    requestAnimationFrame(() => requestAnimationFrame(() => this.flashEl.classList.remove("on")));
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
    if (this.titleTimer > 0) {
      this.titleTimer -= dt;
      if (this.titleTimer <= 0) this.title.classList.remove("on");
    }
  }
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(2).padStart(5, "0")}`;
}

export function formatDelta(d: number): string {
  return `${d < 0 ? "−" : "+"}${Math.abs(d).toFixed(2)}`;
}
