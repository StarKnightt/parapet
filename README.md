# Parapet

First-person rooftop parkour in the browser. Run, vault, slide and wall-run across a
brutalist city. No combat — movement is the whole game.

**Play:** https://starknightt.github.io/parapet/ (Chrome desktop; click to lock the mouse)

```bash
pnpm install
pnpm dev          # http://localhost:5311
pnpm build        # static site in dist/
```

Controls: `WASD` move · `Shift` sprint · `Space` jump · `Ctrl`/`C` slide · `M` mute · `R` restart · `F3` debug readout · `1–9` teleport to checkpoints (dev).

Moves: push into a chest-high ledge to mantle; hold slide at speed to drop under pipe racks (slide-jump keeps the speed); jump beside a tall wall while sprinting to wall-run, jump again to kick off it.

Deploys to GitHub Pages on every push to `master` (`.github/workflows/pages.yml`).

## Layout

```
src/
  core/     input, fixed-step loop, math
  player/   controller (locomotion state machine), camera rig, parkour moves
  world/    AABB collision world, box kit, course authoring, sky, lighting, materials
  ui/       HUD
  audio/    synthesized sound
tools/
  shoot.mjs  headless GPU captures of named poses → shots/
  bot.mjs    scripted playtest that measures speed, jump apex, jump range, step-up, A→B
```

Everything is procedural: no models, no textures, no audio files. Collision boxes are the
same numbers that build the visible geometry (`world/Kit.ts`).
