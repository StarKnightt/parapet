/**
 * Keyboard + pointer-lock mouse input.
 *
 * Movement keys are read as held state. One-shot actions (jump, slide, restart) are
 * latched on keydown and consumed by the controller inside the fixed-step update, so a
 * press that lands between two physics steps is never lost. Mouse deltas accumulate and
 * are drained once per render frame by the camera rig (look is not tied to the fixed step).
 */

export type Action = "jump" | "slide" | "restart" | "debug" | "mute";

const KEY_TO_ACTION: Record<string, Action> = {
  Space: "jump",
  ControlLeft: "slide",
  ControlRight: "slide",
  KeyC: "slide",
  KeyR: "restart",
  KeyM: "mute",
  F3: "debug",
};

export class Input {
  readonly keys = new Set<string>();
  private latched = new Set<Action>();
  private mouseDX = 0;
  private mouseDY = 0;
  locked = false;
  /** Keys pressed since the last `drainTeleport()` — number row for debug teleports. */
  private teleportKey: number | null = null;

  onLockChange?: (locked: boolean) => void;
  /** First click or key: the audio context may start now. */
  onGesture?: () => void;

  constructor(element: HTMLElement) {
    element.addEventListener("click", () => {
      this.onGesture?.();
      if (!this.locked) element.requestPointerLock();
    });
    document.addEventListener("keydown", () => this.onGesture?.(), { capture: true });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === element;
      if (!this.locked) this.keys.clear();
      this.onLockChange?.(this.locked);
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener("keydown", (e) => {
      if (e.code === "F3") e.preventDefault();
      if (!this.locked && e.code !== "F3") return;
      if (e.repeat) return;
      this.keys.add(e.code);
      const action = KEY_TO_ACTION[e.code];
      if (action) this.latched.add(action);
      if (/^Digit[0-9]$/.test(e.code)) this.teleportKey = Number(e.code.slice(5));
      if (e.code === "Space" || e.code.startsWith("Control")) e.preventDefault();
    });
    document.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
  }

  /** -1..1 strafe (positive = right) and forward (positive = forward). */
  get moveX(): number {
    return (this.keys.has("KeyD") || this.keys.has("ArrowRight") ? 1 : 0) - (this.keys.has("KeyA") || this.keys.has("ArrowLeft") ? 1 : 0);
  }
  get moveZ(): number {
    return (this.keys.has("KeyW") || this.keys.has("ArrowUp") ? 1 : 0) - (this.keys.has("KeyS") || this.keys.has("ArrowDown") ? 1 : 0);
  }
  get sprint(): boolean {
    return this.keys.has("ShiftLeft") || this.keys.has("ShiftRight");
  }
  get jumpHeld(): boolean {
    return this.keys.has("Space");
  }
  get slideHeld(): boolean {
    return this.keys.has("ControlLeft") || this.keys.has("ControlRight") || this.keys.has("KeyC");
  }

  /** Programmatic key press/release (bot playtests and the capture harness; bypasses pointer lock). */
  inject(code: string, down: boolean): void {
    if (down) {
      if (this.keys.has(code)) return;
      this.keys.add(code);
      const action = KEY_TO_ACTION[code];
      if (action) this.latched.add(action);
    } else {
      this.keys.delete(code);
    }
  }

  /** Returns true once per physical press. */
  consume(action: Action): boolean {
    if (!this.latched.has(action)) return false;
    this.latched.delete(action);
    return true;
  }

  /** Mouse delta since the last drain, in pixels. */
  drainMouse(out: { x: number; y: number }): void {
    out.x = this.mouseDX;
    out.y = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  drainTeleport(): number | null {
    const k = this.teleportKey;
    this.teleportKey = null;
    return k;
  }
}
