declare module "n8ao" {
  import type { Camera, Scene } from "three";
  import { Pass } from "three/addons/postprocessing/Pass.js";

  export interface N8AOConfiguration {
    aoSamples: number;
    aoRadius: number;
    denoiseSamples: number;
    denoiseRadius: number;
    distanceFalloff: number;
    intensity: number;
    denoiseIterations: number;
    renderMode: number;
    biasOffset: number;
    biasMultiplier: number;
    color: import("three").Color;
    gammaCorrection: boolean;
    logarithmicDepthBuffer: boolean;
    screenSpaceRadius: boolean;
    halfRes: boolean;
    depthAwareUpsampling: boolean;
    autoRenderBeauty: boolean;
    colorMultiply: boolean;
    transparencyAware: boolean;
    accumulate: boolean;
  }

  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: N8AOConfiguration;
    setQualityMode(mode: "Performance" | "Low" | "Medium" | "High" | "Ultra"): void;
    setSize(width: number, height: number): void;
    enabled: boolean;
  }
}
