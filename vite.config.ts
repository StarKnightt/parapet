import { defineConfig } from "vite";

// GitHub Pages serves under /parapet/ (set GITHUB_PAGES=1 in the workflow). Local dev,
// `pnpm build` and the capture harness keep the relative base so Vercel/any static host works.
const base = process.env.GITHUB_PAGES ? "/parapet/" : "./";

export default defineConfig({
  base,
  server: { port: 5311, strictPort: true, open: false },
  preview: { port: 5310, strictPort: true, open: false },
  build: { target: "es2022", sourcemap: false },
});
