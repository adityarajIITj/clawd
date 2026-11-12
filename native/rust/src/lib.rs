//! CLAWD: The Spark Odyssey — gameplay core (Rust -> wasm32-unknown-unknown)
//!
//! * `world_*`   : static/moving collision bodies (boxes + vertical cylinders)
//! * `player_*`  : the full character controller (accel, coyote time, jump
//!                 buffering, variable jump, double jump, ground pound,
//!                 bounce pads, moving-platform carry)
//! * `island_*`  : procedural floating-island mesh generator (flat shaded,
//!                 vertex-coloured, illustrative strata)
//!
//! No allocator use on the hot path; all state lives in statics and is shared
//! with JS through raw pointers into linear memory.

#![allow(static_mut_refs)]
#![allow(clippy::missing_safety_doc)]

use core::f32::consts::PI;

// ---------------------------------------------------------------------------
// Tunables (mirrored in tools/levelc.py for the level linter)
// ---------------------------------------------------------------------------
const P_RADIUS: f32 = 0.45;
const P_HEIGHT: f32 = 1.05;
const GRAVITY: f32 = 38.0;
const FALL_MULT: f32 = 1.18;
const TERMINAL: f32 = -42.0;
const MAX_SPEED: f32 = 9.0;
const ACCEL_GROUND: f32 = 75.0;
const ACCEL_AIR: f32 = 38.0;
const FRICTION: f32 = 62.0;
const AIR_DRAG: f32 = 6.0;
const JUMP_V: f32 = 14.0;
const DJUMP_V: f32 = 12.5;
const JUMP_CUT: f32 = 0.45;
const COYOTE: f32 = 0.12;
const BUFFER: f32 = 0.13;
const POUND_V: f32 = -34.0;
const POUND_HANG: f32 = 0.14;
const STEP_UP: f32 = 0.32;
const DASH_SPEED: f32 = 22.0;
const DASH_TIME: f32 = 0.16;
const DASH_COOLDOWN: f32 = 0.45;

pub const EV_JUMP: u32 = 1;
pub const EV_DJUMP: u32 = 2;
pub const EV_LAND: u32 = 4;
pub const EV_BOUNCE: u32 = 8;
pub const EV_POUND: u32 = 16;
pub const EV_POUND_LAND: u32 = 32;
pub const EV_WALL: u32 = 64;
pub const EV_DASH: u32 = 128;

const MAX_BODIES: usize = 2048;

#[derive(Clone, Copy)]
struct Body {
    shape: u32, // 0 = box (half extents), 1 = cylinder (radius, half height)
    pos: [f32; 3],
    half: [f32; 3],
    kind: u32, // 0 solid, 1 bounce(param = launch speed)
    param: f32,
    delta: [f32; 3],
    active: bool,
}

const EMPTY: Body = Body {
    shape: 0,
    pos: [0.0; 3],
    half: [0.0; 3],
    kind: 0,
    param: 0.0,
    delta: [0.0; 3],
    active: false,
};

struct World {
    bodies: [Body; MAX_BODIES],
    count: usize,
}

struct Player {
    pos: [f32; 3],
    vel: [f32; 3],
    grounded: bool,
    ground_id: i32,
    coyote: f32,
    buffer: f32,
    jumps: u32,
    can_cut: bool,
    pounding: bool,
    hang: f32,
    facing: f32,
    land_speed: f32,
    air_time: f32,
    gscale: f32,
    speed_scale: f32,
    dash_t: f32,
    dash_cd: f32,
    air_dashed: bool,
}

static mut WORLD: World = World { bodies: [EMPTY; MAX_BODIES], count: 0 };
static mut PLAYER: Player = Player {
    pos: [0.0; 3],
    vel: [0.0; 3],
    grounded: false,
    ground_id: -1,
    coyote: 0.0,
    buffer: 0.0,
    jumps: 0,
    can_cut: false,
    pounding: false,
    hang: 0.0,
    facing: 0.0,
    land_speed: 0.0,
    air_time: 0.0,
    gscale: 1.0,
    speed_scale: 1.0,
    dash_t: 0.0,
    dash_cd: 0.0,
    air_dashed: false,
};
static mut STATE: [f32; 16] = [0.0; 16];

// ---------------------------------------------------------------------------
// World API
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn world_reset() {
    unsafe {
        WORLD.count = 0;
    }
}

#[no_mangle]
pub extern "C" fn world_add(shape: u32, x: f32, y: f32, z: f32, a: f32, b: f32, c: f32, kind: u32, param: f32) -> i32 {
    unsafe {
        if WORLD.count >= MAX_BODIES {
            return -1;
        }
        let id = WORLD.count;
        WORLD.bodies[id] = Body { shape, pos: [x, y, z], half: [a, b, c], kind, param, delta: [0.0; 3], active: true };
        WORLD.count += 1;
        id as i32
    }
}

/// Teleport a body (used for moving platforms). The displacement is stored so
/// the controller can carry a player standing on it.
#[no_mangle]
pub extern "C" fn world_move(id: i32, x: f32, y: f32, z: f32) {
    unsafe {
        if id < 0 || id as usize >= WORLD.count {
            return;
        }
        let b = &mut WORLD.bodies[id as usize];
        b.delta[0] += x - b.pos[0];
        b.delta[1] += y - b.pos[1];
        b.delta[2] += z - b.pos[2];
        b.pos = [x, y, z];
    }
}

#[no_mangle]
pub extern "C" fn world_set_active(id: i32, on: u32) {
    unsafe {
        if id >= 0 && (id as usize) < WORLD.count {
            WORLD.bodies[id as usize].active = on != 0;
        }
    }
}

/// Highest surface below (x, y, z) within `range`, or -1e9 when nothing.
/// Used by JS for the contact shadow and enemy grounding.
#[no_mangle]
pub extern "C" fn world_ground_height(x: f32, y: f32, z: f32, range: f32) -> f32 {
    unsafe {
        let mut best = -1.0e9f32;
        for i in 0..WORLD.count {
            let b = &WORLD.bodies[i];
            if !b.active {
                continue;
            }
            if !inside_xz(b, x, z, 0.0) {
                continue;
            }
            let top = b.pos[1] + b.half[1];
            if top <= y + 0.01 && top >= y - range && top > best {
                best = top;
            }
        }
        best
    }
}

fn inside_xz(b: &Body, x: f32, z: f32, pad: f32) -> bool {
    if b.shape == 0 {
        (x - b.pos[0]).abs() <= b.half[0] + pad && (z - b.pos[2]).abs() <= b.half[2] + pad
    } else {
        let dx = x - b.pos[0];
        let dz = z - b.pos[2];
        dx * dx + dz * dz <= (b.half[0] + pad) * (b.half[0] + pad)
    }
}

// ---------------------------------------------------------------------------
// Player API
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn player_reset(x: f32, y: f32, z: f32) {
    unsafe {
        let p = &mut PLAYER;
        p.pos = [x, y, z];
        p.vel = [0.0; 3];
        p.grounded = false;
        p.ground_id = -1;
        p.jumps = 0;
        p.pounding = false;
        p.buffer = 0.0;
        p.coyote = 0.0;
        p.air_time = 0.0;
        p.dash_t = 0.0;
        p.dash_cd = 0.0;
        p.air_dashed = false;
        write_state();
    }
}

#[no_mangle]
pub extern "C" fn player_set_params(gravity_scale: f32, speed_scale: f32) {
    unsafe {
        PLAYER.gscale = gravity_scale;
        PLAYER.speed_scale = speed_scale;
    }
}

/// Enemy stomp / spring: launch upward and refund the double jump.
#[no_mangle]
pub extern "C" fn player_bounce(vy: f32) {
    unsafe {
        let p = &mut PLAYER;
        p.vel[1] = vy;
        p.grounded = false;
        p.ground_id = -1;
        p.pounding = false;
        p.jumps = 1;
        p.can_cut = false;
        p.coyote = 0.0;
        p.dash_t = 0.0;
        p.air_dashed = false;
        write_state();
    }
}

#[no_mangle]
pub extern "C" fn player_knock(vx: f32, vy: f32, vz: f32) {
    unsafe {
        let p = &mut PLAYER;
        p.vel = [vx, vy, vz];
        p.dash_t = 0.0;
        p.grounded = false;
        p.ground_id = -1;
        p.pounding = false;
        p.jumps = 1;
        p.can_cut = false;
        write_state();
    }
}

#[no_mangle]
pub extern "C" fn player_state_ptr() -> *const f32 {
    unsafe { STATE.as_ptr() }
}

unsafe fn write_state() {
    let p = &PLAYER;
    STATE[0] = p.pos[0];
    STATE[1] = p.pos[1];
    STATE[2] = p.pos[2];
    STATE[3] = p.vel[0];
    STATE[4] = p.vel[1];
    STATE[5] = p.vel[2];
    STATE[6] = if p.grounded { 1.0 } else { 0.0 };
    STATE[7] = p.facing;
    STATE[8] = p.jumps as f32;
    STATE[9] = if p.pounding { 1.0 } else { 0.0 };
    STATE[10] = p.ground_id as f32;
    STATE[11] = p.land_speed;
    STATE[12] = p.air_time;
    STATE[13] = if p.ground_id >= 0 { WORLD.bodies[p.ground_id as usize].kind as f32 } else { -1.0 };
    STATE[14] = p.dash_t;
    STATE[15] = p.dash_cd;
}

fn approach2(v: &mut [f32; 3], tx: f32, tz: f32, maxd: f32) {
    let dx = tx - v[0];
    let dz = tz - v[2];
    let d = (dx * dx + dz * dz).sqrt();
    if d <= maxd || d < 1e-6 {
        v[0] = tx;
        v[2] = tz;
    } else {
        v[0] += dx / d * maxd;
        v[2] += dz / d * maxd;
    }
}

/// One fixed controller tick. `ix, iz` is the desired move direction in world
/// space (magnitude <= 1). Returns a bitmask of EV_* events for audio/VFX.
#[no_mangle]
pub extern "C" fn player_step(dt: f32, ix: f32, iz: f32, jump_held: u32, jump_pressed: u32, pound_pressed: u32, dash_pressed: u32) -> u32 {
    unsafe { step(dt, ix, iz, jump_held != 0, jump_pressed != 0, pound_pressed != 0, dash_pressed != 0) }
}

unsafe fn step(dt: f32, mut ix: f32, mut iz: f32, jump_held: bool, jump_pressed: bool, pound_pressed: bool, dash_pressed: bool) -> u32 {
    let mut ev = 0u32;
    let p = &mut PLAYER;

    // ---- moving platform carry ------------------------------------------------
    if p.grounded && p.ground_id >= 0 {
        let d = WORLD.bodies[p.ground_id as usize].delta;
        p.pos[0] += d[0];
        p.pos[1] += d[1];
        p.pos[2] += d[2];
    }
    for i in 0..WORLD.count {
        WORLD.bodies[i].delta = [0.0; 3];
    }

    if jump_pressed {
        p.buffer = BUFFER;
    }

    // ---- horizontal control ---------------------------------------------------
    let len = (ix * ix + iz * iz).sqrt();
    if len > 1.0 {
        ix /= len;
        iz /= len;
    }
    // ---- dash: a short burst in the held (or facing) direction; one per airtime ----
    p.dash_cd = (p.dash_cd - dt).max(0.0);
    if p.grounded {
        p.air_dashed = false;
    }
    if dash_pressed && p.dash_cd <= 0.0 && !p.pounding && (p.grounded || !p.air_dashed) {
        let (dx, dz) = if len > 0.1 { (ix, iz) } else { (p.facing.sin(), p.facing.cos()) };
        p.vel[0] = dx * DASH_SPEED;
        p.vel[2] = dz * DASH_SPEED;
        p.vel[1] = 0.0;
        p.facing = dx.atan2(dz);
        p.dash_t = DASH_TIME;
        p.dash_cd = DASH_COOLDOWN;
        p.can_cut = false;
        if !p.grounded {
            p.air_dashed = true;
        }
        ev |= EV_DASH;
    }
    let dashing = p.dash_t > 0.0;
    if dashing {
        p.dash_t -= dt;
        if p.dash_t <= 0.0 {
            // bleed off the burst so control returns smoothly
            let max = MAX_SPEED * p.speed_scale * 1.15;
            let h = (p.vel[0] * p.vel[0] + p.vel[2] * p.vel[2]).sqrt();
            if h > max {
                p.vel[0] *= max / h;
                p.vel[2] *= max / h;
            }
        }
    }

    if !p.pounding && !dashing {
        let max = MAX_SPEED * p.speed_scale;
        let (tx, tz) = (ix * max, iz * max);
        let rate = if len > 0.05 {
            if p.grounded { ACCEL_GROUND } else { ACCEL_AIR }
        } else if p.grounded {
            FRICTION
        } else {
            AIR_DRAG
        };
        // turning around on the ground is snappier
        let dot = p.vel[0] * tx + p.vel[2] * tz;
        let boost = if p.grounded && dot < 0.0 { 1.6 } else { 1.0 };
        approach2(&mut p.vel, tx, tz, rate * boost * dt);
        if len > 0.1 {
            p.facing = ix.atan2(iz);
        }
    }

    // ---- jumping ---------------------------------------------------------------
    p.coyote = if p.grounded { COYOTE } else { p.coyote - dt };
    if p.buffer > 0.0 && !p.pounding {
        if p.coyote > 0.0 {
            p.vel[1] = JUMP_V;
            p.grounded = false;
            p.ground_id = -1;
            p.coyote = 0.0;
            p.jumps = 1;
            p.buffer = 0.0;
            p.can_cut = true;
            ev |= EV_JUMP;
        } else if p.jumps < 2 {
            p.vel[1] = DJUMP_V;
            p.jumps = 2;
            p.buffer = 0.0;
            p.can_cut = true;
            ev |= EV_DJUMP;
        }
    }
    p.buffer -= dt;
    if !jump_held && p.can_cut {
        if p.vel[1] > JUMP_V * JUMP_CUT {
            p.vel[1] = JUMP_V * JUMP_CUT;
        }
        p.can_cut = false;
    }

    // ---- ground pound ------------------------------------------------------------
    if pound_pressed && !p.grounded && !p.pounding && p.air_time > 0.08 {
        p.pounding = true;
        p.dash_t = 0.0;
        p.hang = POUND_HANG;
        p.vel = [0.0; 3];
        p.can_cut = false;
        ev |= EV_POUND;
    }

    // ---- gravity -------------------------------------------------------------------
    if p.pounding {
        if p.hang > 0.0 {
            p.hang -= dt;
            p.vel[1] = 0.0;
        } else {
            p.vel[1] = POUND_V;
        }
    } else if dashing && !jumped_now(ev) {
        p.vel[1] = 0.0;
    } else {
        let g = GRAVITY * p.gscale * if p.vel[1] < 0.0 { FALL_MULT } else { 1.0 };
        p.vel[1] -= g * dt;
        if p.vel[1] < TERMINAL {
            p.vel[1] = TERMINAL;
        }
    }

    // ---- integrate + collide (sub-stepped) ---------------------------------------
    let was_grounded = p.grounded;
    let jumped = ev & (EV_JUMP | EV_DJUMP) != 0;
    let pre_vy = p.vel[1];
    p.grounded = false;
    p.ground_id = -1;

    let speed = (p.vel[0] * p.vel[0] + p.vel[1] * p.vel[1] + p.vel[2] * p.vel[2]).sqrt();
    let mut steps = ((speed * dt) / 0.2).ceil() as i32;
    steps = steps.clamp(1, 10);
    let sdt = dt / steps as f32;
    let mut hit_wall = false;
    for _ in 0..steps {
        p.pos[0] += p.vel[0] * sdt;
        p.pos[1] += p.vel[1] * sdt;
        p.pos[2] += p.vel[2] * sdt;
        if resolve(p, sdt) {
            hit_wall = true;
        }
    }
    if hit_wall {
        ev |= EV_WALL;
    }

    // ---- ground snap (stick to descending slopes/platforms) ---------------------
    if was_grounded && !p.grounded && !jumped && p.vel[1] <= 0.0 {
        if let Some((id, top)) = probe(p.pos[0], p.pos[1], p.pos[2], 0.2) {
            p.pos[1] = top;
            p.vel[1] = 0.0;
            p.grounded = true;
            p.ground_id = id as i32;
        }
    }

    if p.grounded {
        if !was_grounded {
            ev |= EV_LAND;
            p.land_speed = -pre_vy;
            if p.pounding {
                ev |= EV_POUND_LAND;
            }
        }
        p.jumps = 0;
        p.air_time = 0.0;
        let gid = p.ground_id as usize;
        let body = WORLD.bodies[gid];
        if body.kind == 1 {
            let boost = if p.pounding { 1.3 } else { 1.0 };
            p.vel[1] = body.param * boost;
            p.grounded = false;
            p.ground_id = -1;
            p.jumps = 1;
            p.can_cut = false;
            ev |= EV_BOUNCE;
        }
        p.pounding = false;
    } else {
        p.air_time += dt;
    }

    write_state();
    ev
}

fn jumped_now(ev: u32) -> bool {
    ev & (EV_JUMP | EV_DJUMP) != 0
}

/// Downward probe for snapping; returns body id and its top.
unsafe fn probe(x: f32, y: f32, z: f32, dist: f32) -> Option<(usize, f32)> {
    let mut best: Option<(usize, f32)> = None;
    for i in 0..WORLD.count {
        let b = &WORLD.bodies[i];
        if !b.active || !inside_xz(b, x, z, P_RADIUS * 0.6) {
            continue;
        }
        let top = b.pos[1] + b.half[1];
        if top <= y + 0.01 && top >= y - dist {
            match best {
                Some((_, t)) if t >= top => {}
                _ => best = Some((i, top)),
            }
        }
    }
    best
}

/// Push the player cylinder out of every body using the minimum-penetration
/// axis, biased toward landing. Returns true if a wall was hit.
unsafe fn resolve(p: &mut Player, sdt: f32) -> bool {
    let mut wall = false;
    for _iter in 0..4 {
        let mut any = false;
        for i in 0..WORLD.count {
            let b = WORLD.bodies[i];
            if !b.active {
                continue;
            }
            let feet = p.pos[1];
            let head = feet + P_HEIGHT;
            let by0 = b.pos[1] - b.half[1];
            let by1 = b.pos[1] + b.half[1];
            if head <= by0 || feet >= by1 {
                continue;
            }

            // horizontal penetration & normal
            let (push_h, nx, nz);
            if b.shape == 0 {
                let cx = p.pos[0].clamp(b.pos[0] - b.half[0], b.pos[0] + b.half[0]);
                let cz = p.pos[2].clamp(b.pos[2] - b.half[2], b.pos[2] + b.half[2]);
                let dx = p.pos[0] - cx;
                let dz = p.pos[2] - cz;
                let d2 = dx * dx + dz * dz;
                if d2 >= P_RADIUS * P_RADIUS {
                    continue;
                }
                if d2 > 1e-8 {
                    let d = d2.sqrt();
                    push_h = P_RADIUS - d;
                    nx = dx / d;
                    nz = dz / d;
                } else {
                    let ex = b.half[0] - (p.pos[0] - b.pos[0]).abs();
                    let ez = b.half[2] - (p.pos[2] - b.pos[2]).abs();
                    if ex < ez {
                        push_h = ex + P_RADIUS;
                        nx = if p.pos[0] >= b.pos[0] { 1.0 } else { -1.0 };
                        nz = 0.0;
                    } else {
                        push_h = ez + P_RADIUS;
                        nx = 0.0;
                        nz = if p.pos[2] >= b.pos[2] { 1.0 } else { -1.0 };
                    }
                }
            } else {
                let dx = p.pos[0] - b.pos[0];
                let dz = p.pos[2] - b.pos[2];
                let d = (dx * dx + dz * dz).sqrt();
                let rr = P_RADIUS + b.half[0];
                if d >= rr {
                    continue;
                }
                push_h = rr - d;
                if d > 1e-6 {
                    nx = dx / d;
                    nz = dz / d;
                } else {
                    nx = 1.0;
                    nz = 0.0;
                }
            }

            let up = by1 - feet;
            let down = head - by0;
            let landing_bias = STEP_UP + (-p.vel[1]).max(0.0) * sdt * 1.5;
            if (up <= landing_bias && p.vel[1] <= 0.5) || (up < push_h && up <= down) {
                p.pos[1] += up;
                if p.vel[1] < 0.0 {
                    p.vel[1] = 0.0;
                }
                p.grounded = true;
                p.ground_id = i as i32;
            } else if down < push_h && down < up {
                p.pos[1] -= down;
                if p.vel[1] > 0.0 {
                    p.vel[1] = 0.0;
                }
            } else {
                p.pos[0] += nx * push_h;
                p.pos[2] += nz * push_h;
                let vn = p.vel[0] * nx + p.vel[2] * nz;
                if vn < 0.0 {
                    p.vel[0] -= vn * nx;
                    p.vel[2] -= vn * nz;
                }
                wall = true;
            }
            any = true;
        }
        if !any {
            break;
        }
    }
    wall
}

// ---------------------------------------------------------------------------
// Procedural floating island mesh
// ---------------------------------------------------------------------------

const MESH_CAP: usize = 9 * 60_000;
static mut MESH: [f32; MESH_CAP] = [0.0; MESH_CAP];
static mut MESH_LEN: usize = 0;

fn hash(mut n: u32) -> f32 {
    n = (n << 13) ^ n;
    n = n.wrapping_mul(n.wrapping_mul(n).wrapping_mul(15731).wrapping_add(789221)).wrapping_add(1376312589);
    (n & 0x7fffffff) as f32 / 2147483647.0
}

/// Periodic angular noise in [-1, 1] — seamless around the island rim.
fn ang_noise(theta: f32, seed: u32, layer: u32) -> f32 {
    let mut v = 0.0;
    let mut amp = 0.55;
    let mut total = 0.0;
    for o in 0..4u32 {
        let freq = (2 + o * 3 + (hash(seed ^ (layer * 97 + o)) * 3.0) as u32) as f32;
        let phase = hash(seed.wrapping_mul(31).wrapping_add(layer * 13 + o * 7)) * PI * 2.0;
        v += (theta * freq + phase).sin() * amp;
        total += amp;
        amp *= 0.55;
    }
    v / total
}

unsafe fn push_tri(a: [f32; 3], b: [f32; 3], c: [f32; 3], col: [f32; 3]) {
    if MESH_LEN + 27 > MESH_CAP {
        return;
    }
    let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let mut n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    let l = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt().max(1e-9);
    n = [n[0] / l, n[1] / l, n[2] / l];
    for p in [a, b, c] {
        let o = MESH_LEN;
        MESH[o..o + 3].copy_from_slice(&p);
        MESH[o + 3..o + 6].copy_from_slice(&n);
        MESH[o + 6..o + 9].copy_from_slice(&col);
        MESH_LEN += 9;
    }
}

fn lerp3(a: [f32; 3], b: [f32; 3], t: f32) -> [f32; 3] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

fn jitter(c: [f32; 3], h: f32, amt: f32) -> [f32; 3] {
    let k = 1.0 + (h - 0.5) * amt;
    [c[0] * k, c[1] * k, c[2] * k]
}

/// Build a floating island whose walkable top sits at y = 0 with the given
/// radius. Colours: top (grass/sand/crystal), side (soil), rock (underside).
/// `shape`: 0 = classic tapered island, 1 = tall pillar/mesa.
/// Returns the vertex count; data at `island_ptr()` as [pos3, nrm3, col3].
#[no_mangle]
pub extern "C" fn island_build(
    radius: f32, depth: f32, seed: u32, shape: u32,
    tr: f32, tg: f32, tb: f32,
    sr: f32, sg: f32, sb: f32,
    rr: f32, rg: f32, rb: f32,
) -> u32 {
    unsafe {
        MESH_LEN = 0;
        let top = [tr, tg, tb];
        let side = [sr, sg, sb];
        let rock = [rr, rg, rb];
        let seg = ((14.0 + radius * 4.0) as usize).clamp(14, 72);

        // ring profile: (radius factor, y, noise amp, colour)
        let rings: &[(f32, f32, f32, [f32; 3])] = if shape == 1 {
            &[
                (1.00, 0.0, 0.02, top),
                (1.04, -0.30, 0.04, lerp3(top, side, 0.5)),
                (1.00, -0.55, 0.05, side),
                (0.97, -depth * 0.35, 0.06, lerp3(side, rock, 0.4)),
                (0.95, -depth * 0.7, 0.07, rock),
                (0.92, -depth, 0.06, lerp3(rock, side, 0.25)),
            ]
        } else {
            &[
                (1.00, 0.0, 0.03, top),
                (1.05, -0.32, 0.05, lerp3(top, side, 0.55)),
                (0.98, -0.6, 0.07, side),
                (0.84, -depth * 0.32, 0.10, lerp3(side, rock, 0.45)),
                (0.58, -depth * 0.62, 0.14, rock),
                (0.26, -depth * 0.88, 0.18, lerp3(rock, side, 0.3)),
            ]
        };
        let tip_y = if shape == 1 { -depth } else { -depth * 1.08 };

        let mut pts: Vec<Vec<[f32; 3]>> = Vec::with_capacity(rings.len());
        for (k, &(rf, y, amp, _)) in rings.iter().enumerate() {
            let mut ring = Vec::with_capacity(seg);
            for i in 0..seg {
                let th = i as f32 / seg as f32 * PI * 2.0;
                let n = ang_noise(th, seed, k as u32);
                let r = radius * rf * (1.0 + n * amp);
                let yj = if k == 0 { 0.0 } else { y + (hash(seed ^ ((k * 1000 + i) as u32)) - 0.5) * 0.25 * (k as f32).min(2.0) };
                ring.push([th.cos() * r, yj, th.sin() * r]);
            }
            pts.push(ring);
        }

        // top cap: concentric faceted rings with gentle colour variation
        let inner_rings = 3usize;
        let mut prev: Vec<[f32; 3]> = vec![[0.0, 0.0, 0.0]];
        for k in 1..=inner_rings {
            let t = k as f32 / (inner_rings as f32 + 0.6);
            let ring: Vec<[f32; 3]> = (0..seg)
                .map(|i| {
                    let e = pts[0][i];
                    let bump = if k < inner_rings { (hash(seed ^ ((k * 777 + i) as u32)) - 0.5) * 0.06 } else { 0.0 };
                    [e[0] * t, bump, e[2] * t]
                })
                .collect();
            for i in 0..seg {
                let j = (i + 1) % seg;
                let h = hash(seed.wrapping_add((k * 5003 + i) as u32));
                let c = jitter(top, h, 0.14);
                if prev.len() == 1 {
                    push_tri(prev[0], ring[j], ring[i], c);
                } else {
                    push_tri(prev[i], ring[j], ring[i], c);
                    push_tri(prev[i], prev[j], ring[j], jitter(top, hash(h.to_bits()), 0.14));
                }
            }
            prev = ring;
        }
        for i in 0..seg {
            let j = (i + 1) % seg;
            let h = hash(seed.wrapping_add(90001 + i as u32));
            push_tri(prev[i], pts[0][j], pts[0][i], jitter(top, h, 0.14));
            push_tri(prev[i], prev[j], pts[0][j], jitter(top, hash(h.to_bits()), 0.14));
        }

        // side bands
        for k in 0..rings.len() - 1 {
            let ca = rings[k].3;
            let cb = rings[k + 1].3;
            for i in 0..seg {
                let j = (i + 1) % seg;
                let h = hash(seed.wrapping_add((k * 7919 + i * 31) as u32));
                // strata: alternate light/dark bands for an illustrated look
                let band = if (k + (i / 3)) % 2 == 0 { 1.0 } else { 0.9 };
                let c1 = jitter(lerp3(ca, cb, 0.35), h, 0.18);
                let c2 = jitter(lerp3(ca, cb, 0.65), hash(h.to_bits()), 0.18);
                let c1 = [c1[0] * band, c1[1] * band, c1[2] * band];
                push_tri(pts[k][i], pts[k][j], pts[k + 1][i], c1);
                push_tri(pts[k][j], pts[k + 1][j], pts[k + 1][i], c2);
            }
        }

        // underside: converge to a jagged tip (or flat base for pillars)
        let last = pts.len() - 1;
        let tip = [0.0, tip_y, 0.0];
        let base_col = rings[last].3;
        for i in 0..seg {
            let j = (i + 1) % seg;
            let h = hash(seed.wrapping_add(50000 + i as u32));
            let mut t = tip;
            if shape == 0 {
                // secondary stalactites hanging off the underside
                if i % 5 == 0 {
                    t = [pts[last][i][0] * 0.4, tip_y * (0.8 + h * 0.15), pts[last][i][2] * 0.4];
                }
            }
            push_tri(pts[last][j], t, pts[last][i], jitter(base_col, h, 0.2));
            if shape == 0 && i % 5 == 0 {
                push_tri(t, tip, pts[last][j], jitter(base_col, h * 0.7, 0.2));
            }
        }

        (MESH_LEN / 9) as u32
    }
}

#[no_mangle]
pub extern "C" fn island_ptr() -> *const f32 {
    unsafe { MESH.as_ptr() }
}

#[no_mangle]
pub extern "C" fn core_version() -> u32 {
    100
}
