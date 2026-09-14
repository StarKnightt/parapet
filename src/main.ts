import { Game } from "./Game";

declare global {
  interface Window {
    __parapet?: {
      setPose: (x: number, y: number, z: number, yawDeg: number, pitchDeg: number) => void;
      look: (yawDeg: number, pitchDeg: number) => void;
      stats: () => Record<string, unknown>;
      key: (code: string, down: boolean) => void;
      setQuality: (q: "high" | "low") => void;
      colliders: () => { tag: string | undefined; min: number[]; max: number[] }[];
      setTimeScale: (k: number) => void;
      ready: boolean;
    };
  }
}

const canvas = document.getElementById("game") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLElement;

const game = new Game(canvas, hud);
game.start();

window.__parapet = {
  setPose: (x, y, z, yaw, pitch) => game.setPose(x, y, z, yaw, pitch),
  look: (yaw, pitch) => game.look(yaw, pitch),
  stats: () => game.stats(),
  key: (code, down) => game.key(code, down),
  setQuality: (q) => game.setQuality(q),
  colliders: () => game.colliders(),
  setTimeScale: (k) => game.setTimeScale(k),
  ready: true,
};
