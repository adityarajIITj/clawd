// ============================================================================
//  CLAWD: The Spark Odyssey — particle & VFX simulation core (C++ -> wasm32)
//
//  Freestanding C++: no libc, no allocator. Everything lives in static arrays
//  so the JS renderer can read the packed instance buffer straight out of
//  linear memory and upload it to the GPU with zero copies on the C++ side.
//
//  Output layout per live particle (8 floats):
//      x, y, z, size,  r, g, b, a
// ============================================================================

#define EXPORT extern "C" __attribute__((visibility("default")))

namespace {

constexpr int   kMaxParticles = 8192;
constexpr float kPi           = 3.14159265358979f;
constexpr float kTau          = 6.28318530717958f;

enum Type : int {
    BURST    = 0,  // spark pickup burst: fast, gravity, drag, fade
    DUST     = 1,  // landing puffs: slow rise, expand, fade
    MOTE     = 2,  // ambient drifting motes (pollen, glyphs, stars)
    CONFETTI = 3,  // celebratory confetti: flutter + gravity
    TRAIL    = 4,  // stationary trail dots
    EMBER    = 5,  // rising embers / heat glyphs
    RING     = 6,  // expanding shock ring (horizontal)
    SNOW     = 7,  // slow falling flakes / sand grains with wind
};

struct Particle {
    float x, y, z;
    float vx, vy, vz;
    float life, maxLife;
    float size0, size1;
    float r, g, b;
    float seed;
    int   type;
    int   ambient;
};

Particle gParts[kMaxParticles];
float    gOut[kMaxParticles * 8];
int      gCount = 0;

// ambient emitter state
int   gAmbType    = -1;
float gAmbR = 1, gAmbG = 1, gAmbB = 1;
int   gAmbTarget  = 0;
float gAmbRadius  = 30.0f;
int   gAmbLive    = 0;
float gWindX = 0.0f, gWindZ = 0.0f;
float gGravity = 1.0f;

unsigned gRng = 0x9E3779B9u;

inline unsigned xorshift() {
    gRng ^= gRng << 13;
    gRng ^= gRng >> 17;
    gRng ^= gRng << 5;
    return gRng;
}
inline float frand() { return (xorshift() & 0xFFFFFF) * (1.0f / 16777216.0f); }
inline float frange(float a, float b) { return a + (b - a) * frand(); }

inline float fsqrt(float x) { return __builtin_sqrtf(x); }
inline float fabs_(float x) { return x < 0 ? -x : x; }

// Fast sine: range-reduce to [-pi, pi], then a 5th-order minimax-ish poly.
inline float fsin(float x) {
    x = x - kTau * __builtin_floorf((x + kPi) / kTau);
    const float x2 = x * x;
    return x * (1.0f - x2 * (0.16666667f - x2 * (0.0083333310f - x2 * 0.00019840874f)));
}
inline float fcos(float x) { return fsin(x + kPi * 0.5f); }

// Smooth pseudo-curl field built from layered sines; cheap and divergence-light.
inline void curl(float x, float y, float z, float t, float s, float& ox, float& oy, float& oz) {
    ox = fsin(y * 0.61f + t * 0.37f + s) + 0.5f * fsin(z * 1.31f - t * 0.23f);
    oy = fsin(z * 0.53f + t * 0.41f + s * 1.7f) * 0.6f;
    oz = fsin(x * 0.67f - t * 0.29f + s * 2.3f) + 0.5f * fsin(y * 1.17f + t * 0.31f);
}

Particle* spawn() {
    if (gCount >= kMaxParticles) return nullptr;
    Particle* p = &gParts[gCount++];
    p->ambient = 0;
    p->seed = frand() * 100.0f;
    return p;
}

void kill(int i) {
    if (gParts[i].ambient) --gAmbLive;
    gParts[i] = gParts[--gCount];
}

void spawnAmbient(float cx, float cy, float cz) {
    Particle* p = spawn();
    if (!p) return;
    const float a = frand() * kTau;
    const float r = fsqrt(frand()) * gAmbRadius;
    p->x = cx + fcos(a) * r;
    p->z = cz + fsin(a) * r;
    p->y = cy + frange(-6.0f, 14.0f);
    p->type = gAmbType;
    p->ambient = 1;
    p->life = 0.0f;
    p->r = gAmbR; p->g = gAmbG; p->b = gAmbB;
    switch (gAmbType) {
        case SNOW:
            p->y = cy + frange(4.0f, 22.0f);
            p->vx = gWindX; p->vy = frange(-1.6f, -0.6f); p->vz = gWindZ;
            p->maxLife = frange(6.0f, 11.0f);
            p->size0 = p->size1 = frange(0.05f, 0.11f);
            break;
        case EMBER:
            p->y = cy + frange(-12.0f, 2.0f);
            p->vx = 0; p->vy = frange(0.8f, 2.2f); p->vz = 0;
            p->maxLife = frange(4.0f, 8.0f);
            p->size0 = frange(0.08f, 0.16f); p->size1 = 0.01f;
            break;
        default:  // MOTE
            p->vx = p->vy = p->vz = 0;
            p->maxLife = frange(5.0f, 10.0f);
            p->size0 = p->size1 = frange(0.06f, 0.16f);
            break;
    }
    ++gAmbLive;
}

}  // namespace

// ---------------------------------------------------------------------------
//  Exported API
// ---------------------------------------------------------------------------

EXPORT void fx_init(unsigned seed) {
    gRng = seed ? seed : 0x9E3779B9u;
    gCount = 0;
    gAmbLive = 0;
    gAmbType = -1;
}

EXPORT void fx_clear() {
    gCount = 0;
    gAmbLive = 0;
}

EXPORT void fx_set_ambient(int type, float r, float g, float b, int target, float radius) {
    gAmbType = type;
    gAmbR = r; gAmbG = g; gAmbB = b;
    gAmbTarget = target < kMaxParticles / 2 ? target : kMaxParticles / 2;
    gAmbRadius = radius;
}

EXPORT void fx_set_wind(float x, float z) { gWindX = x; gWindZ = z; }
EXPORT void fx_set_gravity(float g) { gGravity = g; }

EXPORT void fx_emit(int type, float x, float y, float z, int n,
                    float r, float g, float b, float speed) {
    for (int i = 0; i < n; ++i) {
        Particle* p = spawn();
        if (!p) return;
        p->type = type;
        p->x = x; p->y = y; p->z = z;
        p->life = 0.0f;
        // slight per-particle hue jitter keeps bursts lively
        const float j = frange(0.85f, 1.15f);
        p->r = r * j; p->g = g * j; p->b = b * j;

        const float a  = frand() * kTau;
        const float u  = frange(-1.0f, 1.0f);
        const float sq = fsqrt(1.0f - u * u);
        float dx = sq * fcos(a), dy = u, dz = sq * fsin(a);

        switch (type) {
            case BURST: {
                const float s = speed * frange(0.4f, 1.0f);
                p->vx = dx * s; p->vy = fabs_(dy) * s * 0.9f + speed * 0.3f; p->vz = dz * s;
                p->maxLife = frange(0.45f, 0.9f);
                p->size0 = frange(0.10f, 0.22f); p->size1 = 0.0f;
            } break;
            case DUST: {
                const float s = speed * frange(0.5f, 1.0f);
                p->vx = fcos(a) * s; p->vy = frange(0.3f, 1.2f); p->vz = fsin(a) * s;
                p->y += 0.05f;
                p->maxLife = frange(0.5f, 0.9f);
                p->size0 = frange(0.12f, 0.2f); p->size1 = frange(0.4f, 0.6f);
            } break;
            case CONFETTI: {
                const float s = speed * frange(0.5f, 1.0f);
                p->vx = dx * s * 0.6f; p->vy = frange(0.6f, 1.0f) * s; p->vz = dz * s * 0.6f;
                p->maxLife = frange(2.0f, 3.5f);
                p->size0 = p->size1 = frange(0.08f, 0.14f);
                // pick from a festive palette instead of the passed tint
                const int k = (int)(frand() * 5.0f);
                const float pal[5][3] = {{1.0f, 0.55f, 0.35f}, {1.0f, 0.85f, 0.4f},
                                         {0.45f, 0.8f, 1.0f},  {0.95f, 0.5f, 0.85f},
                                         {0.6f, 1.0f, 0.6f}};
                p->r = pal[k][0] * 1.6f; p->g = pal[k][1] * 1.6f; p->b = pal[k][2] * 1.6f;
            } break;
            case TRAIL: {
                p->vx = dx * 0.3f; p->vy = dy * 0.3f; p->vz = dz * 0.3f;
                p->maxLife = frange(0.25f, 0.45f);
                p->size0 = speed; p->size1 = 0.0f;
            } break;
            case EMBER: {
                p->vx = dx * speed; p->vy = frange(1.0f, 3.0f); p->vz = dz * speed;
                p->maxLife = frange(0.8f, 1.6f);
                p->size0 = frange(0.08f, 0.16f); p->size1 = 0.0f;
            } break;
            case RING: {
                const float ang = (float)i / (float)(n > 0 ? n : 1) * kTau;
                p->vx = fcos(ang) * speed; p->vy = 0.2f; p->vz = fsin(ang) * speed;
                p->maxLife = 0.45f;
                p->size0 = 0.22f; p->size1 = 0.05f;
            } break;
            default: {
                p->vx = dx * speed; p->vy = dy * speed; p->vz = dz * speed;
                p->maxLife = 1.0f;
                p->size0 = 0.1f; p->size1 = 0.0f;
            } break;
        }
    }
}

// Advances the simulation and packs live particles into gOut. Returns count.
EXPORT int fx_update(float dt, float t, float cx, float cy, float cz) {
    if (dt > 0.05f) dt = 0.05f;

    // top up ambient population around the focus point
    if (gAmbType >= 0) {
        int budget = 40;
        while (gAmbLive < gAmbTarget && budget-- > 0) spawnAmbient(cx, cy, cz);
    }

    const float g = 18.0f * gGravity;
    int i = 0;
    while (i < gCount) {
        Particle& p = gParts[i];
        p.life += dt;
        if (p.life >= p.maxLife) { kill(i); continue; }

        switch (p.type) {
            case BURST: {
                const float drag = 1.0f - 3.0f * dt;
                p.vx *= drag; p.vy = p.vy * drag - g * 0.6f * dt; p.vz *= drag;
            } break;
            case DUST: {
                const float drag = 1.0f - 4.0f * dt;
                p.vx *= drag; p.vz *= drag; p.vy *= (1.0f - 1.5f * dt);
            } break;
            case MOTE: {
                float ox, oy, oz;
                curl(p.x * 0.15f, p.y * 0.15f, p.z * 0.15f, t, p.seed, ox, oy, oz);
                p.vx += (ox * 0.9f + gWindX * 0.3f - p.vx) * dt;
                p.vy += (oy * 0.5f - p.vy) * dt;
                p.vz += (oz * 0.9f + gWindZ * 0.3f - p.vz) * dt;
            } break;
            case CONFETTI: {
                const float drag = 1.0f - 2.2f * dt;
                p.vx = p.vx * drag + fsin(t * 6.0f + p.seed) * 2.0f * dt;
                p.vz = p.vz * drag + fcos(t * 5.0f + p.seed) * 2.0f * dt;
                p.vy = p.vy * drag - g * 0.35f * dt;
                if (p.vy < -2.5f) p.vy = -2.5f;
            } break;
            case EMBER: {
                float ox, oy, oz;
                curl(p.x * 0.3f, p.y * 0.3f, p.z * 0.3f, t * 2.0f, p.seed, ox, oy, oz);
                p.vx += ox * 1.5f * dt; p.vz += oz * 1.5f * dt;
            } break;
            case SNOW: {
                p.vx += (gWindX - p.vx) * dt + fsin(t + p.seed) * 0.3f * dt;
                p.vz += (gWindZ - p.vz) * dt;
            } break;
            case RING: {
                const float drag = 1.0f - 5.0f * dt;
                p.vx *= drag; p.vz *= drag;
            } break;
            default: break;
        }

        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;

        if (p.ambient) {
            const float dx = p.x - cx, dz = p.z - cz;
            const float lim = gAmbRadius * 1.35f;
            if (dx * dx + dz * dz > lim * lim) { kill(i); continue; }
        }
        ++i;
    }

    // pack
    for (int k = 0; k < gCount; ++k) {
        const Particle& p = gParts[k];
        const float u = p.life / p.maxLife;
        float alpha;
        if (p.ambient) {
            // fade in & out, plus twinkle
            float fin = u * 5.0f; if (fin > 1.0f) fin = 1.0f;
            float fout = (1.0f - u) * 4.0f; if (fout > 1.0f) fout = 1.0f;
            alpha = fin * fout * (0.65f + 0.35f * fsin(t * 3.0f + p.seed * 7.0f));
        } else if (p.type == CONFETTI) {
            alpha = u < 0.8f ? 1.0f : (1.0f - u) * 5.0f;
        } else {
            alpha = 1.0f - u * u;
        }
        float* o = &gOut[k * 8];
        o[0] = p.x; o[1] = p.y; o[2] = p.z;
        o[3] = p.size0 + (p.size1 - p.size0) * u;
        o[4] = p.r; o[5] = p.g; o[6] = p.b; o[7] = alpha;
    }
    return gCount;
}

EXPORT float* fx_buffer() { return gOut; }
EXPORT int fx_capacity() { return kMaxParticles; }
