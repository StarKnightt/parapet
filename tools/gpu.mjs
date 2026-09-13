/**
 * GPU launch flags for headless Chromium on Windows. Default headless is chrome-headless-shell
 * which silently falls back to SwiftShader; `channel: "chromium"` + ANGLE/D3D11 reaches the
 * NVIDIA adapter. Never add --disable-gpu or swiftshader flags here.
 */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software\s*rasteriz|microsoft basic render|basic render/i;

export function launchOptions() {
  return {
    channel: "chromium",
    headless: true,
    args: [
      "--use-angle=d3d11",
      "--use-gl=angle",
      "--enable-gpu",
      "--enable-gpu-rasterization",
      "--ignore-gpu-blocklist",
      "--force_high_performance_gpu",
      "--hide-scrollbars",
      "--mute-audio",
    ],
  };
}

export const isSoftwareRenderer = (r) => SOFTWARE.test(String(r ?? ""));
