# ✷ CLAWD — The Spark Odyssey

A 3D platformer by **Aditya**, starring **Clawd**, Claude's little terracotta mascot, and
**Marathi Manus**. The Great Context Window has shattered, and its Sparks are scattered across
eleven illustrated worlds.

Every mesh, island, sound effect and level is generated from code. The only asset files are the
soundtrack (`assets/music/`) and the photo for Marathi Manus's face (`assets/face/`).

## Run it

```bash
python build.py --serve
```

That builds everything into `dist/` and opens `http://127.0.0.1:8765`. To serve an existing build
again: `python tools/serve.py`.

**On a phone:** run `python tools/serve.py --lan` and open the printed address on a phone on the same
Wi-Fi (Windows may ask to allow Python through the firewall). Hold the phone sideways.

**Hosting:** the repo deploys to Vercel as-is — `vercel.json` serves the prebuilt `dist/` folder with no build step. After changing anything, run `python build.py`, commit and push.

**Requirements:** Python 3.11+ with numpy, clang++ with wasm-ld (MSYS2 `clang64` or LLVM), and Rust
with the `wasm32-unknown-unknown` target.

## Controls

| Input | Action |
|---|---|
| WASD / arrows / left stick | Move (relative to the camera) |
| Space / A | Jump, then press again in mid-air to double jump (hold longer to jump higher) |
| Shift / X / triggers | Ground pound (in the air); smashes crates |
| F / right-click / B / RB | Dash, on the ground or once per jump |
| Mouse drag or pointer lock / right stick | Orbit the camera · wheel to zoom |
| Q / E | Rotate the camera |
| Esc / Start | Pause |
| **Touch** | Drag on the left half to move (floating joystick) · drag on the right half to look · Jump / Pound / Dash buttons · ❚❚ to pause |

## The worlds

1. **Prompt Meadows** is the tutorial: spring islands over a sunrise sea of clouds, with lantern trees and petal pads.
2. **Token Falls** has mossy pillars in a turquoise lagoon, drifting logs, glyph waterfalls and lily pads.
3. **Gradient Dunes** has sunset mesas above sinking sand, with sunbeam sweepers and a staircase to the ridge.
4. **Neural Nebula** has crystal islets in a starfield, orbiting platforms, Hallucination Wisps and low gravity.
5. **The Context Citadel** is an obsidian fortress over a lava sea, ending in a spiral climb up the summit tower.
6. **Frostbyte Peaks** has snowy summits set far apart, built around the dash.

**Maharashtra Tales**

1. **Sahyadri Monsoon**: misty ghats in the rain, old fort walls and waterfalls.
2. **Konkan Coast**: laterite sea stacks, palms, fishing boats and a pier at sunset.
3. **Kandil Lake**: a festival night with akash kandils, floating diyas, lotus leaves and fireflies.
4. **Mumbai Nights**: rooftop hopping past water tanks and dish antennas, with kaali-peeli taxis as stepping stones.

**Bonus**

- **Spark Rush**: no enemies, just springs, the dash and a tight clock. It opens at 12 quest stars.

Each world has Sparks to collect (every 20 restores a heart), 3 hidden golden Tokens, Lighthouse
checkpoints, crates to smash with a ground pound (some hold a heart), and an S/A/B/C rank. A world
opens when you finish the one before it in its set. Your progress is saved in the browser.

## Quests

Every world has three quests, chosen in its level file: collect everything, find all three Tokens,
stomp every enemy, smash every crate, finish without losing a heart, or beat the par time. Each
finished quest earns a quest star. The pause menu shows live progress, the world map shows the
stars you have, and 12 stars open the bonus world.

## Two heroes

Pick **Hero** on the title screen. Both heroes can play every world, and they share progress.

- **Clawd** collects Sparks and golden Tokens.
- **Marathi Manus** has a man bun, a neckband and a phone that's always out. He collects lizards
  and Komodo dragons instead. Leave him idle and he fixes his bun, then takes a selfie. His face is
  a photo mapped onto a curved plate on the low-poly head, and it switches to a tongue-out photo
  while he dances or takes a selfie.

## Music

The soundtrack was provided by Aditya and is cut into bar-aligned loops in `assets/music/`: one for
the title, three that rotate across the worlds, and a one-shot ending. Sound effects are synthesized
by `tools/audiogen.py`.

## Architecture

| Language | Where | What it does |
|---|---|---|
| **Rust → wasm** | `native/rust/src/lib.rs` | Character controller (acceleration, coyote time, jump buffering, variable and double jump, dash, ground pound, bounce pads, carry on moving platforms) and collision against boxes and cylinders. It also sculpts the floating islands: rims shaped by noise, strata, stalactites. |
| **C++ → wasm** | `native/cpp/fx.cpp` | A freestanding (no libc) particle simulation of 8,192 particles: bursts, dust, confetti, embers, curl-noise motes, shock rings. The JS side reads its packed buffer straight from linear memory. |
| **GLSL** | `web/js/shaders.js` | Stylized toon lighting, 8-tap rotated-Poisson PCF shadows, ink outlines, procedural sky, clouds and stars, five floor shaders (water, cloud sea, dunes, nebula, lava), 6-level HDR bloom, ACES tonemapping and color grading. |
| **JavaScript** | `web/js/*` | WebGL2 renderer (4× MSAA HDR, instancing), procedural model library, game state machine, camera, UI, WebAudio. |
| **Python** | `tools/levelc.py` | Level compiler. It expands generators (paths, spirals, spark patterns), scatters decor with Poisson-disk sampling, then runs a **reachability linter** using the same jump physics as the Rust controller. |
| **Python** | `tools/audiogen.py` | Synthesizer for the 22 sound effects (additive synthesis plus FFT convolution reverb). |
| **Python** | `build.py`, `tools/serve.py` | Build orchestration and the local server. |

Levels are written in TOML (`levels/*.toml`). Edit one and rerun `python build.py`. The linter fails
the build if the goal can't be reached.
