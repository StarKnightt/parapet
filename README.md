# Parapet

First-person rooftop parkour in a browser tab. One line across six roofs of a
brutalist city at golden hour: sprint, vault the vent box, slide under the pipe
rack, clear the gap, mantle the penthouse, wall-run the neighbour's facade, drop,
and run through the arch onto the painted stripes. There is no combat and no
collectable. The timer starts when you move and the movement is the whole game.

![The first gap: the orange lip of roof A, the 6.5 m drop to roof B, the towers
of the city beyond](media/01-gap.webp)

*Straight out of the running build in a GPU-backed headless Chromium, captured
with `tools/shoot.mjs`. Nothing in it is composited and nothing is retouched.
Every surface, the sky and the hands were computed in code a moment before the
shutter.*

**Play it: https://starknightt.github.io/parapet/** — desktop Chrome or Edge,
keyboard and mouse. Click the canvas to lock the pointer; that click also starts
the sound.

Everything in the scene is generated at runtime. There are no models, no image
files and no audio recordings anywhere in the repository: the city is a box kit
of authored numbers, the concrete and steel are painted onto canvases at boot,
the sky is a shader, the arms and legs are capsules posed by two-bone IK, and
every footstep, scrape and whoosh is synthesised in the Web Audio API. The
collision boxes are the same numbers that build the visible geometry, so what
you can stand on is exactly what you can see.

## Run it locally

**pnpm, not npm.** The lockfile is pnpm's.

```bash
git clone https://github.com/StarKnightt/parapet.git
cd parapet
pnpm install
pnpm dev             # vite on http://localhost:5311/, then click the canvas
```

`pnpm build` type-checks and writes the production bundle to `dist/`;
`pnpm typecheck` runs `tsc --noEmit` on its own. Pushing to `master` deploys to
GitHub Pages through `.github/workflows/pages.yml`, which builds with
`GITHUB_PAGES=1` so the bundle is served under `/parapet/`. Without that
variable the base is relative and `dist/` runs from any static host.

![Wall-running the neighbour facade over the C to D gap: the inner hand planted
on the concrete, the landing roof and its water-tower deck ahead](media/02-wall-run.webp)

## Controls

| Input | Action |
| --- | --- |
| Mouse | Look, once the pointer is locked by a click |
| `W` `A` `S` `D` | Move. Forward is always at running speed, 8.5 m/s; there is no walk key |
| `Space` | Jump, 1.25 m. Jump again on a wall to kick off it |
| `Ctrl` / `C` | Slide, while running |
| `R` | Restart the run |
| `M` | Mute |
| `F3` | Debug readout: state, position, speed, ground, draw calls |
| `1` – `8` | Teleport to a checkpoint (dev) |
| `Esc` | Release the pointer |

Running is the only pace. `Shift` is unbound on purpose: strafing and
backpedalling are slower, but there is no modifier that makes you careful, and
the beams and ledges are tuned for someone arriving at speed.

The teleports are 1 the start, 2 the penthouse, 3 the long roof, 4 the landing,
5 the deck, 6 the low roof, 7 the finish roof and 8 the calibration pad west of
the start, where the step heights and gap islands the controller was tuned on
still stand.

## The moves

**Vault and mantle.** Run into anything from a kerb up to a chest-high ledge and
you go over it. Kerbs and parapets up to 42 cm are stepped without an animation;
above that the body reaches, grabs the lip, pulls past it and pushes off, in 0.22
to 0.46 s depending on the height, keeping most of the approach speed if there is
floor to run onto. From the ground a mantle reaches 1.5 m; out of a jump, about
2.7 m, which is how the 2.1 m penthouse on roof B is taken.

**Slide.** Hold slide at speed to drop under the pipe rack and the duct. A slide
starts with a boost, runs on low friction for the first 0.6 s and then bites, and
a jump out of a fresh slide keeps the speed, which is how the last 7.5 m gap is
meant to be cleared.

**Wall-run.** Jump beside a tall wall while running and you catch it: the jump's
own rise finishes, the wall holds you flat for about half a second, then a
gentle sag, roughly 1.5 s and 12 m of run with the horizontal speed held.
Pressing or looking into a wall pulls you onto it from 40 cm out, and you can
still catch one from a slow fall after running off a ledge. Look away from the
wall to steer the run off it; look hard away to let go.

**Wall-jump.** Jump again on the wall and the kick goes where you look: aim
along the route to keep your speed, aim away to turn across a gap. Successive
kicks in one airtime lose height each time, and you cannot re-catch the wall you
just left until you have landed.

**Coyote time and jump buffering.** A jump pressed within 100 ms of leaving a
ledge still fires, and one pressed 120 ms before landing fires on contact.

**Off the line is allowed.** Neighbour roofs, buttress tops and cantilevers are
places to land and stand, and the HUD tells you once per run when you first do.
The only death is the fall: 14 m below the lower of your checkpoint and the last
surface you stood on. Every low roof a jump from the route can reach has a way
back, a kerb to sprint off, a landing slab across the alley, and a zig-zag of
bracket ledges up the route facade, each one a mantle from the one below.

![Mid-mantle onto the penthouse: both hands on the lip, the long roof and the
towers past it](media/03-mantle.webp)

## What is in it

- About 4,800 lines of hand-written TypeScript across 21 files in `src/`,
  comments and blank lines aside, plus the Playwright harness in `tools/`.
- One course, "the concrete line": six roofs from 20 m down to 13 m across about
  170 m of run, five checkpoints, a finish arch, and a calibration pad off the
  west end. Every gap and lip is a number in `src/world/Course.ts`; change it
  and the collision and the visuals both move.
- A box kit that turns those numbers into merged geometry per material and AABB
  colliders in one call, so the whole city is a handful of draw calls and the
  collision world can never disagree with the picture.
- Ten pieces of set dressing that never touch the collision world: pasted
  posters and stencilled numbers on the facades you run toward, a flaked
  geometric mural over roof E, a peeled billboard turned to the start, a
  skyline sign at the end of the canyon, bunting and service cables across the
  gaps, three graffiti throw-ups, a windsock on the water tank, and road paint
  on the street far below. All of it is one extra draw call from one canvas.
- A locomotion state machine on a fixed step: ground, air, mantle, slide and
  wall-run, with every feel number in one file, `src/player/PlayerConfig.ts`.
- A first-person body with world-anchored hands: on a mantle they reach, grab
  the lip, press flat and release as the body comes over; on a wall-run the
  inner hand plants on the wall plane and re-plants as you slide past it, and
  the wall-jump pushes off with both.
- A results card with per-checkpoint splits against your best line, kept in
  `localStorage`, and a beat of slow motion on the finish stripes.
- A synthesised soundscape: wind that rises with speed and in the air,
  footsteps coloured by the surface, landings scaled by impact, the slide and
  wall-run scrapes, and two quiet tones for a checkpoint and a finish.

![Facing the sun from the landing on roof D: the beam overhead, the low sun
between the towers, the deck lip in orange](media/04-sunward.webp)

## How it is built

**Procedural materials.** Concrete albedo, bump and roughness are painted on a
canvas at boot, grain, blotches and rain streaks, and tiled at 4 m per repeat by
per-face UV scaling in the kit. Steel gets brushed grain, panel seams with
rivets, dents and rust drips at a 1.6 m tile; the louvres are a slat pattern.
Colour variation per building and per prop is a vertex tint on one shared
material, which is what keeps the draw calls down. The set dressing shares one
1024² paper atlas: a dozen cells of poster, mural, billboard, graffiti, flag
and road-paint designs, each sun-bleached, grimed, wrinkled (into the bump) and
torn at the corners with an alpha cut, so every pasted sheet in the city is a
quad picking a UV rect from the same material.

**Sky and light.** A late-afternoon shader sky with a low sun disc, corona and
forward-scatter glow, a drifting cumulus deck whose sun-facing edges go cream
and whose undersides go cool, a cirrus veil and a warm haze band the height fog
meets. It is also baked into a PMREM so the glass and steel pick up blue from
above and gold from the sun side. One warm directional sun with a 2048-texel
shadow frustum that follows the player, snapped to shadow texels so the edges do
not shimmer while running, and a hemisphere fill. The sun sits 25° up and 6° off
the run axis, behind the runner, so two thirds of the route roof and the facades
you run toward are lit and the stair-heads and plant throw their shadows ahead
along the line.

**Post.** N8AO screen-space ambient occlusion for the corner darkening that sells
concrete mass, then a speed pass: a radial smear that comes in above 6 m/s, a
vignette that spikes on the finish, and fine grain; ACES tone mapping at the
end. If the frame rate sits under 50 fps for three seconds the AO is dropped.
`?direct` in the URL bypasses the post chain entirely.

**Camera.** Interpolated from the fixed step, with landing dips, step-up
smoothing, FOV kicks on the mantle, the slide, the wall catch and the kick, and
an eased lean away from the wall you are running.

## Tools

The page exposes `window.__parapet`: `setPose(x, y, z, yawDeg, pitchDeg)`,
`look(yaw, pitch)`, `key(code, down)`, `setQuality("high" | "low")`,
`setTimeScale(k)`, `colliders()` and `stats()`. Two scripts drive it through
Playwright against the dev server, with the GPU flags in `tools/gpu.mjs` that
reach the real adapter rather than SwiftShader:

```bash
node tools/shoot.mjs               # named poses → shots/<tag>-<pose>.png (1920×1080)
node tools/shoot.mjs --poses=spawn,sunward --tag=m1
node tools/bot.mjs                 # scripted playtest, 30 checks
```

The bot drives the controller with injected keys and measures the numbers the
level is designed around: top speed and the time to reach it, strafe direction,
jump apex, airtime and range, the 0.4 m auto step, the 0.6 / 1.25 / 2.0 m
mantles and that nothing mantles without input, slide speed, crouch height and
passing under a 1.2 m bar, wall-run attach from a straight run and from a 20°
angle, held height, the camera-aimed kick, the A to B and C to D crossings, that
C to D is impossible without the wall, fall and respawn, and landing on an
off-route roof and climbing back to the line by the ledge ladder. It fails on
any page error or a software renderer.

![The finish: the heavy arch on roof F and the three painted stripes through
it](media/05-finish-arch.webp)

## Layout

```
src/
  core/     input, fixed-step loop, math
  player/   controller (locomotion state machine), camera rig, first-person body, feel numbers
  world/    AABB collision world, box kit, course authoring, sky, lighting, materials
  render/   post chain
  ui/       HUD: timer, splits, results card, debug readout
  audio/    synthesised sound
tools/
  gpu.mjs   headless Chromium flags that reach the GPU
  shoot.mjs named-pose captures
  bot.mjs   the 30-check playtest
```

![The results card after a new best: the time, the gain on the previous best,
and a split per checkpoint](media/06-results.webp)

## Stack

Three.js 0.185 · TypeScript · Vite · n8ao and the three.js `EffectComposer` for
the post chain · Web Audio · Playwright for the capture and playtest harness ·
GitHub Pages.

## Licence

MIT — see [`LICENSE`](LICENSE).
