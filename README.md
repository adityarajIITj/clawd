# ✷ CLAWD — The Spark Odyssey

A 3D platformer by **Aditya**, starring **Clawd**, Claude's little terracotta mascot, and
**Marathi Manus**, **Mahak** and **Lingraj**. The Great Context Window has shattered, and its Sparks are scattered across
thirteen illustrated worlds.

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

**Himalayan Trails**

1. **Valley of Flowers**: alpine meadows in Uttarakhand with deodars, rhododendrons, a slate-roofed hut, temple bells and glacier blocks.

**Odisha Shores**

1. **Konark Sun Shore**: sunrise on the Bay of Bengal, with stone chariot wheels, a temple tower, fishing boats and a pier.

**Bonus**

- **Spark Rush**: no enemies, just springs, the dash and a tight clock. It opens at 12 quest stars.

Each world has Sparks to collect (every 20 restores a heart), 3 hidden golden Tokens, Lighthouse
checkpoints, crates to smash with a ground pound (some hold a heart), and an S/A/B/C rank. A world
opens when you finish the one before it in its set. Your progress is saved in the browser.

## Enemies and the boss

| Enemy | What it does | How to beat it |
|---|---|---|
| **Glitchling** | Paces back and forth | Stomp it |
| **Hallucination Wisp** | Floats toward you when you're close | Stomp it |
| **Rambot** | Spots you, paws the ground, then charges in a straight line and gets dizzy at walls and edges | Stomp it, ideally while it's dizzy |
| **Spitpod** | A potted turret that turns to aim and lobs glowing orbs | Dodge the orbs, then stomp it |
| **Shellback** | Armoured; a normal stomp just bounces off | Ground pound it |
| **The Glitch King** (Context Citadel summit) | Hops at you and slams out shockwave rings; after three slams he gets dizzy | Jump the rings, then ground pound his head while he's dizzy, three times. The portal stays shut until he falls |

## World mechanics and feel

- **Glacier ice** (Frostbyte Peaks, Valley of Flowers) is slippery: you speed up slowly and slide when you let go.
- **Wind gusts** (Gradient Dunes, plus a helpful tailwind in Spark Rush) push you in pulses; watch the sand to time your jumps.
- **Ambient soundscapes**: wind, rain, waves, crickets, a city hum, a lava rumble or a space drone, depending on the world (adjustable in Settings → Sound).
- The camera moves in front of walls and islands instead of passing through them, big hits briefly freeze the action, worlds fade in, and **Continue** on the home screen takes you back to where you left off.

## Quests

Every world has three quests, chosen in its level file: collect everything, find all three Tokens,
stomp every enemy, smash every crate, finish without losing a heart, or beat the par time. Each
finished quest earns a quest star. The pause menu shows live progress, the world map shows the
stars you have, and 12 stars open the bonus world.

## Four heroes

Pick a hero from the home screen. Every hero can play every world, and they share progress. Each
one collects their own version of Sparks and Tokens.

| Hero | From | Collects | Idle routine |
|---|---|---|---|
| **Clawd** | The Workshop | Sparks, golden Tokens | Bobs and blinks |
| **Marathi Manus** | Maharashtra | Lizards, Komodo dragons | Fixes his bun, then takes a tongue-out selfie |
| **Mahak** | Uttarakhand | Brahma Kamal flowers, Himalayan Monals | Brings her braid forward, then shades her eyes to look across the valley |
| **Lingraj** | Odisha | Rasagolas, Konark wheels | Wipes his forehead with his gamucha, then greets you with a namaskar |

Marathi Manus's face is a photo mapped onto a curved plate on the low-poly head. Mahak and Lingraj
are original characters with modelled faces: Mahak wears a knitted sweater, a ghagra, a nose ring
and a long braid with a red tassel; Lingraj wears a kurta with an ikat border, a dhoti and a checked
gamucha.

## Gamer tag and settings

The first time the game opens, it makes up a gamer tag (like `FilmyYak32`) and remembers it in that
browser, so there's no login. Tap the tag at the top right of the home screen to rename it
(3–16 letters, numbers or `_`). Settings are split into Sound, Graphics, Controls and Profile
tabs; Profile also has a reset-progress button that asks for a second tap.

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
