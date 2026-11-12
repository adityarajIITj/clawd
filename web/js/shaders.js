// GLSL ES 3.00 shader library for CLAWD: The Spark Odyssey.
// Stylised "illustrated" lighting: wrapped + banded diffuse, hemispheric
// ambient, rim light, soft PCF shadows, aerial/height fog with sun scatter.

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DShadow;
`;

const NOISE = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y);
}
float fbm(vec2 p){ float v=0.0, a=0.5; mat2 r=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<5;i++){ v+=a*vnoise(p); p=r*p; a*=0.5;} return v; }
float fbm3(vec2 p){ float v=0.0, a=0.5; mat2 r=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<3;i++){ v+=a*vnoise(p); p=r*p; a*=0.5;} return v; }
`;

// Uniforms shared by everything that needs atmosphere
const ATMOS = `
uniform vec3 u_camPos;
uniform vec3 u_sunDir;
uniform vec3 u_sunColor;
uniform float u_sunI;
uniform vec3 u_skyTop, u_skyHorizon, u_skyBottom;
uniform vec3 u_fogColor;
uniform float u_fogDensity;
uniform float u_floorY;
uniform float u_time;
uniform float u_clouds;
uniform float u_stars;
uniform vec2 u_wind;
uniform vec3 u_floorA, u_floorB;

vec3 skyColor(vec3 d, bool withSun){
  float y = d.y;
  vec3 c = y > 0.0 ? mix(u_skyHorizon, u_skyTop, pow(clamp(y,0.0,1.0), 0.36))
                   : mix(u_skyHorizon, u_skyBottom, pow(clamp(-y,0.0,1.0), 0.35));
  float sd = max(dot(d, u_sunDir), 0.0);
  c += u_sunColor * (pow(sd, 5.0) * 0.22 + pow(sd, 48.0) * 0.5);
  if (withSun) c += u_sunColor * smoothstep(0.9965, 0.9985, sd) * 8.0;
  if (u_stars > 0.0) {
    // nebula wisps
    vec2 nuv = d.xz / (abs(y) + 0.35) * 1.4;
    float n1 = fbm(nuv + vec2(u_time*0.004, 0.0));
    float n2 = fbm(nuv*1.7 - 3.1);
    c += (u_floorA * smoothstep(0.45, 0.9, n1) * 0.35 + u_floorB * smoothstep(0.5, 0.95, n2) * 0.25) * u_stars * smoothstep(-0.3, 0.4, y);
    for (int k = 0; k < 2; k++) {
      vec3 p = d * (180.0 + float(k) * 140.0);
      vec3 cell = floor(p);
      float h = hash13(cell + float(k) * 17.0);
      if (h > 0.985) {
        vec3 f = fract(p) - 0.5;
        float s = smoothstep(0.3, 0.0, length(f));
        float tw = 0.55 + 0.45 * sin(u_time * (2.0 + h * 3.0) + h * 90.0);
        c += mix(vec3(0.8,0.9,1.0), vec3(1.0,0.85,0.7), fract(h*37.0)) * s * tw * u_stars * 2.5;
      }
    }
  }
  if (u_clouds > 0.0 && y > 0.0) {
    vec2 uv = d.xz / (y + 0.12) * 0.9 + u_wind * u_time * 0.004;
    float n = fbm(uv);
    float cl = smoothstep(0.42, 0.78, n) * u_clouds * smoothstep(0.0, 0.18, y);
    float lit = smoothstep(0.4, 0.9, fbm(uv + u_sunDir.xz * 0.15));
    vec3 cc = mix(mix(u_skyHorizon, vec3(1.0), 0.65), vec3(1.0, 0.98, 0.95), lit) + u_sunColor * pow(sd, 3.0) * 0.6;
    c = mix(c, cc, cl * 0.9);
  }
  return c;
}

vec3 applyFog(vec3 col, vec3 wpos){
  vec3 dv = wpos - u_camPos;
  float d = length(dv);
  vec3 dir = dv / max(d, 1e-4);
  float f = 1.0 - exp(-pow(d * u_fogDensity, 1.35));
  float h = clamp((u_floorY + 10.0 - wpos.y) / 26.0, 0.0, 1.0);
  f = max(f, h * h * 0.8);
  float sunAmt = pow(max(dot(dir, u_sunDir), 0.0), 6.0);
  vec3 fc = mix(u_fogColor, u_sunColor * 1.15, sunAmt * 0.55);
  return mix(col, fc, clamp(f, 0.0, 1.0));
}
`;

// ---------------------------------------------------------------------------
// Lit geometry
// ---------------------------------------------------------------------------
export function litVS(defs = '') {
  return HEADER + defs + `
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nrm;
layout(location=2) in vec3 a_col;
#ifdef INSTANCED
layout(location=3) in vec4 a_ipos;
layout(location=4) in vec4 a_irot;
#endif
uniform mat4 u_viewProj;
uniform mat4 u_model;
uniform mat4 u_lightVP;
uniform float u_time;
uniform vec2 u_wind;
uniform vec3 u_tint;
uniform vec3 u_emissive;
uniform float u_outline;
out vec3 v_wpos;
out vec3 v_nrm;
out vec3 v_col;
out vec3 v_emis;
out vec4 v_lpos;
void main(){
  vec3 p = a_pos;
  vec3 n = a_nrm;
  vec4 world;
  vec3 tint = u_tint;
  vec3 emis = u_emissive;
#ifdef INSTANCED
  float c = cos(a_irot.x), s = sin(a_irot.x);
  vec3 lp = p * a_ipos.w;
  vec3 rp = vec3(c*lp.x + s*lp.z, lp.y, -s*lp.x + c*lp.z);
  n = vec3(c*n.x + s*n.z, n.y, -s*n.x + c*n.z);
  float sway = a_irot.y * max(lp.y, 0.0);
  float ph = u_time * 1.9 + a_ipos.x * 0.35 + a_ipos.z * 0.27;
  rp.xz += (u_wind * 0.6 + vec2(0.25)) * sway * (sin(ph) * 0.6 + sin(ph * 2.3) * 0.25 + 0.35);
  world = vec4(rp + a_ipos.xyz, 1.0);
  tint *= a_irot.z;
  emis *= a_irot.w;
#else
  world = u_model * vec4(p, 1.0);
  n = mat3(u_model) * n;
#endif
  v_wpos = world.xyz;
  v_nrm = n;
  v_col = a_col * tint;
  v_emis = emis * a_col;
  v_lpos = u_lightVP * world;
  vec4 clip = u_viewProj * world;
#ifdef OUTLINE
  vec3 cn = mat3(u_viewProj) * normalize(n);
  vec2 off = normalize(cn.xy + 1e-5);
  clip.xy += off * u_outline * clip.w;
#endif
  gl_Position = clip;
}`;
}

export function litFS(defs = '') {
  return HEADER + defs + NOISE + ATMOS + `
in vec3 v_wpos;
in vec3 v_nrm;
in vec3 v_col;
in vec3 v_emis;
in vec4 v_lpos;
uniform sampler2DShadow u_shadow;
uniform float u_shadowTexel;
uniform vec3 u_ambSky, u_ambGround;
uniform float u_rim;
uniform vec3 u_outlineColor;
uniform float u_flash;
uniform float u_spec;
out vec4 o_col;

const vec2 POISSON[8] = vec2[](vec2(-0.613,0.617), vec2(0.170,-0.040), vec2(-0.299,-0.792), vec2(0.645,0.493),
                               vec2(-0.651,-0.065), vec2(0.421,-0.581), vec2(-0.093,0.992), vec2(0.962,-0.194));
float shadowAt(vec4 lp, float ndl){
  vec3 p = lp.xyz / lp.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  float bias = 0.0008 + 0.0022 * (1.0 - clamp(ndl, 0.0, 1.0));
  float s = 0.0;
  float rot = hash12(gl_FragCoord.xy) * 6.2831;
  mat2 R = mat2(cos(rot), sin(rot), -sin(rot), cos(rot));
  for (int i = 0; i < 8; i++) {
    s += texture(u_shadow, vec3(p.xy + R * POISSON[i] * u_shadowTexel * 1.8, p.z - bias));
  }
  return s / 8.0;
}

void main(){
#ifdef OUTLINE
  o_col = vec4(applyFog(u_outlineColor, v_wpos), 1.0);
  return;
#else
  vec3 N = normalize(v_nrm);
  if (!gl_FrontFacing) N = -N;
  vec3 V = normalize(u_camPos - v_wpos);
  vec3 L = u_sunDir;
  float ndl = dot(N, L);
  float sh = shadowAt(v_lpos, ndl);
  float wrap = clamp((ndl + 0.35) / 1.35, 0.0, 1.0);
  float band = smoothstep(0.0, 0.28, ndl);
  float diff = mix(wrap * wrap, band, 0.55) * sh;
  vec3 hemi = mix(u_ambGround, u_ambSky, N.y * 0.5 + 0.5);
  vec3 albedo = v_col;
  vec3 col = albedo * (u_sunColor * diff * u_sunI * 0.62 + hemi * 0.62);
  vec3 H = normalize(L + V);
  col += u_sunColor * pow(max(dot(N, H), 0.0), 36.0) * u_spec * sh;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * u_rim;
  col += mix(u_skyHorizon, u_sunColor, 0.5) * rim * (0.35 + 0.65 * sh);
  col += v_emis;
  col = mix(col, vec3(2.5, 2.3, 2.2), u_flash);
  o_col = vec4(applyFog(col, v_wpos), 1.0);
#endif
}`;
}

// Depth-only (shadow map)
export function depthVS(defs = '') {
  return HEADER + defs + `
layout(location=0) in vec3 a_pos;
#ifdef INSTANCED
layout(location=3) in vec4 a_ipos;
layout(location=4) in vec4 a_irot;
#endif
uniform mat4 u_lightVP;
uniform mat4 u_model;
void main(){
#ifdef INSTANCED
  float c = cos(a_irot.x), s = sin(a_irot.x);
  vec3 lp = a_pos * a_ipos.w;
  vec3 rp = vec3(c*lp.x + s*lp.z, lp.y, -s*lp.x + c*lp.z);
  gl_Position = u_lightVP * vec4(rp + a_ipos.xyz, 1.0);
#else
  gl_Position = u_lightVP * u_model * vec4(a_pos, 1.0);
#endif
}`;
}
export const depthFS = HEADER + `out vec4 o; void main(){ o = vec4(1.0); }`;

// ---------------------------------------------------------------------------
// Fullscreen: sky
// ---------------------------------------------------------------------------
export const fsVS = HEADER + `
out vec2 v_uv;
void main(){
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const skyFS = HEADER + NOISE + ATMOS + `
in vec2 v_uv;
uniform mat4 u_invViewProj;
out vec4 o_col;
void main(){
  vec4 a = u_invViewProj * vec4(v_uv * 2.0 - 1.0, 1.0, 1.0);
  vec3 d = normalize(a.xyz / a.w - u_camPos);
  o_col = vec4(skyColor(d, true), 1.0);
}`;

// ---------------------------------------------------------------------------
// Floor: water / clouds / sand / nebula / lava
// ---------------------------------------------------------------------------
export const floorVS = HEADER + `
layout(location=0) in vec3 a_pos;
uniform mat4 u_viewProj;
uniform vec3 u_camPos;
uniform float u_floorY;
out vec3 v_wpos;
void main(){
  vec3 w = vec3(a_pos.x + u_camPos.x, u_floorY, a_pos.z + u_camPos.z);
  v_wpos = w;
  gl_Position = u_viewProj * vec4(w, 1.0);
}`;

export const floorFS = HEADER + NOISE + ATMOS + `
in vec3 v_wpos;
uniform int u_floorType;
out vec4 o_col;

float waveH(vec2 p){
  float t = u_time;
  return fbm3(p * 0.18 + vec2(t * 0.05, t * 0.03)) * 0.6 + fbm3(p * 0.45 - vec2(t * 0.07, -t * 0.04)) * 0.4;
}
void main(){
  vec2 p = v_wpos.xz;
  vec3 V = normalize(u_camPos - v_wpos);
  vec3 col;
  if (u_floorType == 1) {               // water
    float e = 0.15;
    float h0 = waveH(p), hx = waveH(p + vec2(e, 0.0)), hz = waveH(p + vec2(0.0, e));
    vec3 N = normalize(vec3((h0 - hx) / e * 1.6, 1.0, (h0 - hz) / e * 1.6));
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    vec3 deep = mix(u_floorB, u_floorA, smoothstep(0.3, 0.7, h0));
    vec3 refl = skyColor(R, false);
    col = mix(deep * (0.55 + 0.45 * u_sunI * 0.4), refl, fres * 0.85);
    float spec = pow(max(dot(R, u_sunDir), 0.0), 220.0);
    col += u_sunColor * spec * 6.0;
    float caust = smoothstep(0.62, 0.7, fbm3(p * 0.6 + u_time * 0.12)) * 0.25;
    col += vec3(caust) * u_floorA;
  } else if (u_floorType == 0) {        // sea of clouds
    vec2 q = p * 0.02 + u_wind * u_time * 0.006;
    float n = fbm(q);
    float n2 = fbm(q * 2.3 + 4.0 + u_time * 0.01);
    float puff = smoothstep(0.3, 0.8, n * 0.65 + n2 * 0.45);
    float lit = smoothstep(0.35, 0.85, fbm(q + u_sunDir.xz * 0.05));
    col = mix(u_floorB, u_floorA, puff);
    col *= 0.75 + 0.45 * lit * u_sunI * 0.45;
    col += u_sunColor * pow(max(dot(-V, u_sunDir), 0.0), 3.0) * 0.15;
  } else if (u_floorType == 2) {        // sand dunes
    float dune = fbm(p * 0.03);
    float ripple = sin(dot(p, vec2(0.8, 0.6)) * 2.2 + dune * 18.0) * 0.5 + 0.5;
    float e = 0.5;
    float hx = fbm((p + vec2(e, 0.0)) * 0.03), hz = fbm((p + vec2(0.0, e)) * 0.03);
    vec3 N = normalize(vec3((dune - hx) * 60.0, 1.0, (dune - hz) * 60.0));
    float ndl = clamp(dot(N, u_sunDir), 0.0, 1.0);
    col = mix(u_floorB, u_floorA, smoothstep(0.25, 0.75, dune) * 0.7 + ripple * 0.3);
    col *= 0.55 + ndl * u_sunI * 0.35;
    col += u_sunColor * pow(ndl, 30.0) * 0.2;
    float glint = step(0.995, hash12(floor(p * 6.0))) * pow(ndl, 4.0);
    col += vec3(glint) * 1.5;
  } else if (u_floorType == 3) {        // nebula void
    vec2 q = p * 0.012;
    float n1 = fbm(q + vec2(u_time * 0.006, 0.0));
    float n2 = fbm(q * 2.1 - vec2(0.0, u_time * 0.01) + 7.0);
    col = u_floorA * smoothstep(0.35, 0.9, n1) * 1.4 + u_floorB * smoothstep(0.45, 0.95, n2) * 1.2;
    col += u_skyBottom * 0.5;
    float st = step(0.997, hash12(floor(p * 1.5)));
    col += vec3(st) * (0.6 + 0.4 * sin(u_time * 3.0 + p.x));
  } else {                              // lava
    vec2 q = p * 0.07 + vec2(u_time * 0.02, u_time * 0.012);
    float n = fbm(q);
    float cracks = 1.0 - smoothstep(0.0, 0.07, abs(n - 0.5));
    float n2 = fbm(q * 2.5 - u_time * 0.03);
    float glow = cracks * (0.6 + 0.4 * n2) + smoothstep(0.62, 0.85, n2) * 0.6;
    vec3 crust = u_floorB * (0.6 + 0.6 * fbm(q * 4.0));
    col = crust + u_floorA * glow * 3.2;
    col += u_floorA * 0.15 * (0.5 + 0.5 * sin(u_time * 1.3 + n * 9.0));
  }
  o_col = vec4(applyFog(col, v_wpos), 1.0);
}`;

// ---------------------------------------------------------------------------
// FX surfaces (waterfall, portal, laser beam, blob shadow)
// ---------------------------------------------------------------------------
export const fxVS = HEADER + `
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_nrm;
layout(location=2) in vec3 a_col;
uniform mat4 u_viewProj;
uniform mat4 u_model;
out vec2 v_uv;
out vec3 v_wpos;
void main(){
  vec4 w = u_model * vec4(a_pos, 1.0);
  v_wpos = w.xyz;
  v_uv = a_col.xy;
  gl_Position = u_viewProj * w;
}`;

export const fxFS = HEADER + NOISE + ATMOS + `
in vec2 v_uv;
in vec3 v_wpos;
uniform int u_mode;
uniform vec3 u_colA;
uniform vec3 u_colB;
uniform float u_param;
uniform float u_alpha;
out vec4 o_col;
void main(){
  vec2 uv = v_uv;
  vec4 c = vec4(0.0);
  if (u_mode == 0) {           // waterfall
    float edge = smoothstep(0.0, 0.12, uv.x) * smoothstep(1.0, 0.88, uv.x);
    float streak = fbm3(vec2(uv.x * 9.0 * u_param, uv.y * 1.2 * u_param - u_time * 2.6));
    float streak2 = vnoise(vec2(uv.x * 30.0, uv.y * 3.0 * u_param - u_time * 4.0));
    vec3 col = mix(u_colA, vec3(1.0), smoothstep(0.45, 0.8, streak) * 0.8 + streak2 * 0.15);
    float foamBottom = smoothstep(0.08, 0.0, uv.y);
    col = mix(col, vec3(1.2), foamBottom);
    c = vec4(applyFog(col * (0.8 + 0.4 * u_sunI * 0.4), v_wpos), (0.72 + 0.28 * streak) * edge);
  } else if (u_mode == 1) {    // portal swirl
    vec2 q = uv * 2.0 - 1.0;
    float r = length(q);
    float a = atan(q.y, q.x);
    float sw = sin(a * 5.0 + r * 10.0 - u_time * 4.0) * 0.5 + 0.5;
    float n = fbm(vec2(a * 2.0, r * 4.0 - u_time * 1.5));
    vec3 col = mix(u_colA, u_colB, sw * 0.6 + n * 0.4) * (1.6 + 2.0 * smoothstep(0.6, 0.0, r));
    float alpha = smoothstep(1.0, 0.85, r);
    c = vec4(col * u_param, alpha * 0.95);
  } else if (u_mode == 2) {    // laser beam (additive)
    float d = abs(uv.y - 0.5) * 2.0;
    float core = smoothstep(0.35, 0.0, d);
    float glow = smoothstep(1.0, 0.0, d);
    float flick = 0.85 + 0.15 * sin(u_time * 40.0 + uv.x * 20.0);
    vec3 col = (u_colA * glow * 2.0 + vec3(3.0) * core) * flick;
    c = vec4(col, glow);
  } else if (u_mode == 3) {    // contact shadow
    float r = length(uv * 2.0 - 1.0);
    c = vec4(0.0, 0.0, 0.0, smoothstep(1.0, 0.2, r) * u_alpha);
  } else {                     // soft glow halo (additive)
    float r = length(uv * 2.0 - 1.0);
    float g = pow(smoothstep(1.0, 0.0, r), 2.2);
    c = vec4(u_colA * g * u_param, g);
  }
  o_col = c;
}`;

// ---------------------------------------------------------------------------
// Particles (instanced billboards, additive)
// ---------------------------------------------------------------------------
export const particleVS = HEADER + `
layout(location=0) in vec2 a_corner;
layout(location=3) in vec4 a_p;
layout(location=4) in vec4 a_c;
uniform mat4 u_viewProj;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
out vec2 v_uv;
out vec4 v_c;
out vec3 v_wpos;
void main(){
  vec3 w = a_p.xyz + (u_camRight * a_corner.x + u_camUp * a_corner.y) * a_p.w;
  v_uv = a_corner;
  v_c = a_c;
  v_wpos = w;
  gl_Position = u_viewProj * vec4(w, 1.0);
}`;

export const particleFS = HEADER + NOISE + ATMOS + `
in vec2 v_uv;
in vec4 v_c;
in vec3 v_wpos;
out vec4 o_col;
void main(){
  float r = length(v_uv);
  float core = smoothstep(1.0, 0.0, r);
  float glow = core * core;
  float star = max(0.0, 1.0 - abs(v_uv.x) * 6.0) * max(0.0, 1.0 - abs(v_uv.y)) + max(0.0, 1.0 - abs(v_uv.y) * 6.0) * max(0.0, 1.0 - abs(v_uv.x));
  float a = (glow + star * 0.35 * core) * v_c.a;
  float d = length(v_wpos - u_camPos);
  float fade = exp(-d * u_fogDensity * 1.2);
  o_col = vec4(v_c.rgb * a * fade, 0.0);
}`;

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------
export const downFS = HEADER + `
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_threshold;
uniform int u_prefilter;
out vec4 o_col;
vec3 tap(vec2 o){ return texture(u_src, v_uv + o * u_texel).rgb; }
void main(){
  vec3 a = tap(vec2(-2,-2)), b = tap(vec2(0,-2)), c = tap(vec2(2,-2));
  vec3 d = tap(vec2(-1,-1)), e = tap(vec2(1,-1));
  vec3 f = tap(vec2(-2,0)), g = tap(vec2(0,0)), h = tap(vec2(2,0));
  vec3 i = tap(vec2(-1,1)), j = tap(vec2(1,1));
  vec3 k = tap(vec2(-2,2)), l = tap(vec2(0,2)), m = tap(vec2(2,2));
  vec3 col = (d+e+i+j) * 0.125 + (a+c+k+m) * 0.03125 + (b+f+h+l) * 0.0625 + g * 0.125;
  if (u_prefilter == 1) {
    float br = max(col.r, max(col.g, col.b));
    float knee = u_threshold * 0.5;
    float soft = clamp(br - u_threshold + knee, 0.0, 2.0 * knee);
    soft = soft * soft / (4.0 * knee + 1e-4);
    float w = max(soft, br - u_threshold) / max(br, 1e-4);
    col *= w;
    col = min(col, vec3(40.0));
  }
  o_col = vec4(col, 1.0);
}`;

export const upFS = HEADER + `
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_radius;
out vec4 o_col;
void main(){
  vec2 t = u_texel * u_radius;
  vec3 c = texture(u_src, v_uv).rgb * 4.0;
  c += (texture(u_src, v_uv + vec2(-t.x, 0)).rgb + texture(u_src, v_uv + vec2(t.x, 0)).rgb +
        texture(u_src, v_uv + vec2(0, -t.y)).rgb + texture(u_src, v_uv + vec2(0, t.y)).rgb) * 2.0;
  c += texture(u_src, v_uv + vec2(-t.x, -t.y)).rgb + texture(u_src, v_uv + vec2(t.x, -t.y)).rgb +
       texture(u_src, v_uv + vec2(-t.x, t.y)).rgb + texture(u_src, v_uv + vec2(t.x, t.y)).rgb;
  o_col = vec4(c / 16.0, 1.0);
}`;

export const compositeFS = HEADER + NOISE + `
in vec2 v_uv;
uniform sampler2D u_hdr;
uniform sampler2D u_bloom;
uniform float u_bloomStrength;
uniform float u_exposure;
uniform float u_saturation;
uniform float u_contrast;
uniform float u_fade;
uniform float u_hurt;
uniform float u_time;
uniform vec2 u_texel;
out vec4 o_col;
vec3 aces(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main(){
  // subtle chromatic aberration toward the edges
  vec2 dc = v_uv - 0.5;
  float ca = dot(dc, dc) * 0.006;
  vec3 hdr;
  hdr.r = texture(u_hdr, v_uv - dc * ca).r;
  hdr.g = texture(u_hdr, v_uv).g;
  hdr.b = texture(u_hdr, v_uv + dc * ca).b;
  vec3 bloom = texture(u_bloom, v_uv).rgb;
  vec3 col = hdr + bloom * u_bloomStrength;
  col *= u_exposure;
  col = aces(col);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, u_saturation);
  col = (col - 0.5) * u_contrast + 0.5;
  // warm split-tone: shadows lean cool-violet, highlights lean peach
  col += vec3(0.02, 0.0, 0.03) * (1.0 - l) + vec3(0.02, 0.01, -0.01) * l;
  float vig = smoothstep(1.15, 0.35, length(dc * vec2(1.25, 1.0)));
  col *= mix(0.72, 1.0, vig);
  col = mix(col, vec3(0.9, 0.1, 0.1), u_hurt * (1.0 - vig) * 0.8);
  col += (hash12(v_uv * 1000.0 + fract(u_time) * 100.0) - 0.5) * 0.018;
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  col = mix(col, vec3(0.06, 0.05, 0.06), u_fade);
  o_col = vec4(col, 1.0);
}`;
