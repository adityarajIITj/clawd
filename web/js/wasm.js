// Loads the two native modules: Rust gameplay core + C++ VFX core.
async function load(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  try {
    if (WebAssembly.instantiateStreaming) return (await WebAssembly.instantiateStreaming(res.clone(), {})).instance;
  } catch (_) { /* MIME fallback below */ }
  return (await WebAssembly.instantiate(await res.arrayBuffer(), {})).instance;
}

export async function loadNative() {
  const [core, fx] = await Promise.all([load('wasm/clawd_core.wasm'), load('wasm/fx.wasm')]);
  const C = core.exports, F = fx.exports;

  const physics = {
    reset: () => C.world_reset(),
    add: (shape, pos, size, kind, param) =>
      C.world_add(shape, pos[0], pos[1], pos[2], size[0], size[1], size[2] ?? 0, kind, param),
    move: (id, x, y, z) => C.world_move(id, x, y, z),
    setActive: (id, on) => C.world_set_active(id, on ? 1 : 0),
    groundHeight: (x, y, z, range) => C.world_ground_height(x, y, z, range),
    playerReset: (x, y, z) => C.player_reset(x, y, z),
    playerParams: (g, s) => C.player_set_params(g, s),
    bounce: (vy) => C.player_bounce(vy),
    knock: (x, y, z) => C.player_knock(x, y, z),
    step: (dt, ix, iz, held, pressed, pound) => C.player_step(dt, ix, iz, held ? 1 : 0, pressed ? 1 : 0, pound ? 1 : 0),
    state() {
      return new Float32Array(C.memory.buffer, C.player_state_ptr(), 16);
    },
    island(radius, depth, seed, shape, top, side, rock) {
      const n = C.island_build(radius, depth, seed >>> 0, shape, ...top, ...side, ...rock);
      return new Float32Array(C.memory.buffer, C.island_ptr(), n * 9).slice();
    },
  };

  F.fx_init(1234);
  const fxApi = {
    clear: () => F.fx_clear(),
    ambient: (type, col, target, radius) => F.fx_set_ambient(type, col[0], col[1], col[2], target, radius),
    wind: (x, z) => F.fx_set_wind(x, z),
    gravity: (g) => F.fx_set_gravity(g),
    emit: (type, p, n, col, speed) => F.fx_emit(type, p[0], p[1], p[2], n, col[0], col[1], col[2], speed),
    update(dt, t, c) {
      const n = F.fx_update(dt, t, c[0], c[1], c[2]);
      return { count: n, data: new Float32Array(F.memory.buffer, F.fx_buffer(), n * 8) };
    },
    T: { BURST: 0, DUST: 1, MOTE: 2, CONFETTI: 3, TRAIL: 4, EMBER: 5, RING: 6, SNOW: 7 },
  };
  return { physics, fx: fxApi, EV: { JUMP: 1, DJUMP: 2, LAND: 4, BOUNCE: 8, POUND: 16, POUND_LAND: 32, WALL: 64 } };
}
