# ✷ CLAWD — The Spark Odyssey

A 3D platformer starring **Clawd**, Claude's little terracotta mascot. The Great Context Window has
shattered, and Clawd travels through five illustrated worlds to bring its Sparks home.

There are no asset files. Every mesh, island, note, sound effect and level is generated from code.

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
| Shift / X / triggers | Ground pound (in the air) |
| Mouse drag or pointer lock / right stick | Orbit the camera · wheel to zoom |
| Q / E | Rotate the camera |
| Esc / Start | Pause |
| **Touch** | Drag on the left half to move (floating joystick) · drag on the right half to look · Jump / Pound buttons · ❚❚ to pause |

## The worlds

1. **Prompt Meadows** is the tutorial: spring islands over a sunrise sea of clouds, with lantern trees and petal pads.
2. **Token Falls** has mossy pillars in a turquoise lagoon, drifting logs, glyph waterfalls and lily pads.
3. **Gradient Dunes** has sunset mesas above sinking sand, with sunbeam sweepers and a staircase to the ridge.
4. **Neural Nebula** has crystal islets in a starfield, orbiting platforms, Hallucination Wisps and low gravity.
5. **The Context Citadel** is an obsidian fortress over a lava sea, ending in a spiral climb up the summit tower.

Each world has Sparks to collect (every 20 restores a heart), 3 hidden golden Tokens, Lighthouse
checkpoints, enemies to stomp, and an S/A/B/C rank. Your progress is saved in the browser.

## Architecture

| Language | Where | What it does |
|---|---|---|
| **Rust → wasm** | `native/rust/src/lib.rs` | Character controller (acceleration, coyote time, jump buffering, variable and double jump, ground pound, bounce pads, carry on moving platforms) and collision against boxes and cylinders. It also sculpts the floating islands: rims shaped by noise, strata, stalactites. |
| **C++ → wasm** | `native/cpp/fx.cpp` | A freestanding (no libc) particle simulation of 8,192 particles: bursts, dust, confetti, embers, curl-noise motes, shock rings. The JS side reads its packed buffer straight from linear memory. |
| **GLSL** | `web/js/shaders.js` | Stylized toon lighting, 8-tap rotated-Poisson PCF shadows, ink outlines, procedural sky, clouds and stars, five floor shaders (water, cloud sea, dunes, nebula, lava), 6-level HDR bloom, ACES tonemapping and color grading. |
| **JavaScript** | `web/js/*` | WebGL2 renderer (4× MSAA HDR, instancing), procedural model library, game state machine, camera, UI, WebAudio. |
| **Python** | `tools/levelc.py` | Level compiler. It expands generators (paths, spirals, spark patterns), scatters decor with Poisson-disk sampling, then runs a **reachability linter** using the same jump physics as the Rust controller. |
| **Python** | `tools/audiogen.py` | Synthesizer and algorithmic composer for 6 music loops and 18 SFX (additive synthesis plus FFT convolution reverb). |
| **Python** | `build.py`, `tools/serve.py` | Build orchestration and the local server. |

Levels are written in TOML (`levels/*.toml`). Edit one and rerun `python build.py`. The linter fails
the build if the goal can't be reached.
