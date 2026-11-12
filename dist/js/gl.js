// WebGL2 renderer: shadow map -> MSAA HDR scene -> bloom chain -> tonemap.
import * as S from './shaders.js';
import { m4, v3 } from './math.js';

export const lin = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];

class Program {
  constructor(gl, vs, fs, name) {
    this.gl = gl;
    const mk = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
        console.error(`[${name}] shader error\n${log}\n${lines}`);
        throw new Error(`Shader compile failed: ${name}: ${log}`);
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Link failed: ${name}: ${gl.getProgramInfoLog(p)}`);
    this.p = p;
    this.loc = new Map();
  }
  use() { this.gl.useProgram(this.p); return this; }
  u(name) {
    let l = this.loc.get(name);
    if (l === undefined) { l = this.gl.getUniformLocation(this.p, name); this.loc.set(name, l); }
    return l;
  }
  f1(n, v) { const l = this.u(n); if (l) this.gl.uniform1f(l, v); return this; }
  i1(n, v) { const l = this.u(n); if (l) this.gl.uniform1i(l, v); return this; }
  f2(n, v) { const l = this.u(n); if (l) this.gl.uniform2fv(l, v); return this; }
  f3(n, v) { const l = this.u(n); if (l) this.gl.uniform3fv(l, v); return this; }
  m4(n, v) { const l = this.u(n); if (l) this.gl.uniformMatrix4fv(l, false, v); return this; }
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.canvas = canvas;
    this.floatOK = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');
    this.quality = { scale: Math.min(window.devicePixelRatio || 1, 1.5), shadow: 2048, msaa: 4, grass: 1 };
    this.maxSamples = gl.getParameter(gl.MAX_SAMPLES);

    this.progs = {
      lit: new Program(gl, S.litVS(), S.litFS(), 'lit'),
      litI: new Program(gl, S.litVS('#define INSTANCED\n'), S.litFS('#define INSTANCED\n'), 'litI'),
      outline: new Program(gl, S.litVS('#define OUTLINE\n'), S.litFS('#define OUTLINE\n'), 'outline'),
      depth: new Program(gl, S.depthVS(), S.depthFS, 'depth'),
      depthI: new Program(gl, S.depthVS('#define INSTANCED\n'), S.depthFS, 'depthI'),
      sky: new Program(gl, S.fsVS, S.skyFS, 'sky'),
      floor: new Program(gl, S.floorVS, S.floorFS, 'floor'),
      fx: new Program(gl, S.fxVS, S.fxFS, 'fx'),
      particle: new Program(gl, S.particleVS, S.particleFS, 'particle'),
      down: new Program(gl, S.fsVS, S.downFS, 'down'),
      up: new Program(gl, S.fsVS, S.upFS, 'up'),
      composite: new Program(gl, S.fsVS, S.compositeFS, 'composite'),
    };

    this.emptyVAO = gl.createVertexArray();
    // floor grid (dense near centre for vertex-fog precision)
    const fp = [];
    const R = 1400;
    fp.push(-R, 0, -R, R, 0, -R, R, 0, R, -R, 0, -R, R, 0, R, -R, 0, R);
    this.floorMesh = this.createMesh({ pos: new Float32Array(fp) });

    // particle quad
    this.particleVAO = gl.createVertexArray();
    gl.bindVertexArray(this.particleVAO);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.particleBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 8192 * 32, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);

    this.queue = [];
    this.fxQueue = [];
    this.particleData = null;
    this.particleCount = 0;
    this.post = { bloom: 0.6, exposure: 1.0, saturation: 1.05, contrast: 1.04, fade: 0, hurt: 0 };
    this.createShadow();
    this.resize();
  }

  // -------------------------------------------------------------------------
  // resources
  // -------------------------------------------------------------------------
  createMesh({ pos, nrm, col, uv }) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const n = pos.length / 3;
    const data = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) {
      data[i * 9] = pos[i * 3]; data[i * 9 + 1] = pos[i * 3 + 1]; data[i * 9 + 2] = pos[i * 3 + 2];
      if (nrm) { data[i * 9 + 3] = nrm[i * 3]; data[i * 9 + 4] = nrm[i * 3 + 1]; data[i * 9 + 5] = nrm[i * 3 + 2]; } else data[i * 9 + 4] = 1;
      if (col) { data[i * 9 + 6] = col[i * 3]; data[i * 9 + 7] = col[i * 3 + 1]; data[i * 9 + 8] = col[i * 3 + 2]; } else { data[i * 9 + 6] = data[i * 9 + 7] = data[i * 9 + 8] = 1; }
    }
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    for (let a = 0; a < 3; a++) {
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 36, a * 12);
    }
    gl.bindVertexArray(null);
    return { vao, vbo, count: n };
  }

  // interleaved [pos3 nrm3 col3] straight from wasm memory
  createMeshInterleaved(f32) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, f32, gl.STATIC_DRAW);
    for (let a = 0; a < 3; a++) {
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 36, a * 12);
    }
    gl.bindVertexArray(null);
    return { vao, vbo, count: f32.length / 9 };
  }

  // Instanced variant sharing the mesh VBO. instance layout: [x y z scale | yaw wind tint emis]
  createInstanced(mesh, data) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    for (let a = 0; a < 3; a++) {
      gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(a, 3, gl.FLOAT, false, 36, a * 12);
    }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, ib);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 32, 0);
    gl.vertexAttribDivisor(3, 1);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 32, 16);
    gl.vertexAttribDivisor(4, 1);
    gl.bindVertexArray(null);
    return { vao, ib, count: mesh.count, instances: data.length / 8, capacity: data.length / 8 };
  }

  updateInstances(inst, data, count) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, inst.ib);
    if (count > inst.capacity) {
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      inst.capacity = count;
    } else {
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * 8);
    }
    inst.instances = count;
  }

  deleteMesh(m) {
    const gl = this.gl;
    if (!m) return;
    if (m.vao) gl.deleteVertexArray(m.vao);
    if (m.vbo) gl.deleteBuffer(m.vbo);
    if (m.ib) gl.deleteBuffer(m.ib);
  }

  createShadow() {
    const gl = this.gl;
    const size = this.quality.shadow;
    if (this.shadowTex) { gl.deleteTexture(this.shadowTex); gl.deleteFramebuffer(this.shadowFBO); }
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  makeColorTex(w, h) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (this.floatOK) gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, w, h);
    else gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { tex: t, fbo: f, w, h };
  }

  resize() {
    const gl = this.gl;
    const dpr = this.quality.scale;
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.w === w && this.h === h && this.targets) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.w = w; this.h = h;
    if (this.targets) {
      const t = this.targets;
      [t.hdr, ...t.bloom].forEach((x) => { gl.deleteTexture(x.tex); gl.deleteFramebuffer(x.fbo); });
      if (t.msFBO) { gl.deleteFramebuffer(t.msFBO); gl.deleteRenderbuffer(t.msColor); }
      gl.deleteRenderbuffer(t.depth);
    }
    const t = {};
    t.hdr = this.makeColorTex(w, h);
    const samples = Math.min(this.quality.msaa, this.maxSamples);
    t.depth = gl.createRenderbuffer();
    if (samples > 1 && this.floatOK) {
      t.msFBO = gl.createFramebuffer();
      t.msColor = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.msColor);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA16F, w, h);
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.depth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.msFBO);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, t.msColor);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        console.warn('MSAA target incomplete; falling back');
        gl.deleteFramebuffer(t.msFBO); t.msFBO = null;
      }
    }
    if (!t.msFBO) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, t.depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.hdr.fbo);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, t.depth);
    }
    t.bloom = [];
    let bw = w, bh = h;
    for (let i = 0; i < 6; i++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      t.bloom.push(this.makeColorTex(bw, bh));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.targets = t;
  }

  // -------------------------------------------------------------------------
  // per-frame submission
  // -------------------------------------------------------------------------
  draw(item) { this.queue.push(item); }
  drawFx(item) { this.fxQueue.push(item); }
  setParticles(f32, count) { this.particleData = f32; this.particleCount = count; }

  setAtmos(p, env, time) {
    p.f3('u_camPos', env.camPos).f3('u_sunDir', env.sunDir).f3('u_sunColor', env.sunColor).f1('u_sunI', env.sunI)
      .f3('u_skyTop', env.skyTop).f3('u_skyHorizon', env.skyHorizon).f3('u_skyBottom', env.skyBottom)
      .f3('u_fogColor', env.fogColor).f1('u_fogDensity', env.fogDensity).f1('u_floorY', env.floorY)
      .f1('u_time', time).f1('u_clouds', env.clouds).f1('u_stars', env.stars).f2('u_wind', env.wind)
      .f3('u_floorA', env.floorA).f3('u_floorB', env.floorB);
  }

  render(cam, env, time) {
    const gl = this.gl;
    this.resize();
    const t = this.targets;
    const viewProj = m4.mul(cam.proj, cam.view);
    const invVP = m4.invert(viewProj);
    env.camPos = cam.pos;

    // ---- shadow pass -------------------------------------------------------
    const focus = cam.shadowFocus || cam.target;
    const ext = 34;
    const texel = (ext * 2) / this.quality.shadow;
    // snap to texels to avoid shimmering
    const lv = m4.lookAt(v3.add(focus, v3.scale(env.sunDir, 120)), focus, Math.abs(env.sunDir[1]) > 0.99 ? [0, 0, 1] : [0, 1, 0]);
    const fx = lv[0] * focus[0] + lv[4] * focus[1] + lv[8] * focus[2];
    const fy = lv[1] * focus[0] + lv[5] * focus[1] + lv[9] * focus[2];
    const sx = fx - Math.floor(fx / texel) * texel, sy = fy - Math.floor(fy / texel) * texel;
    const lp = m4.ortho(-ext - sx, ext - sx, -ext - sy, ext - sy, 1, 320);
    const lightVP = m4.mul(lp, lv);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO);
    gl.viewport(0, 0, this.quality.shadow, this.quality.shadow);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.colorMask(false, false, false, false);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.5, 3.0);
    for (const it of this.queue) {
      if (it.noShadow) continue;
      const p = it.inst ? this.progs.depthI : this.progs.depth;
      p.use().m4('u_lightVP', lightVP);
      if (it.inst) {
        if (!it.inst.instances) continue;
        gl.bindVertexArray(it.inst.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, it.inst.count, it.inst.instances);
      } else {
        p.m4('u_model', it.model);
        gl.bindVertexArray(it.mesh.vao);
        gl.drawArrays(gl.TRIANGLES, 0, it.mesh.count);
      }
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.colorMask(true, true, true, true);

    // ---- main scene --------------------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.msFBO || t.hdr.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // sky
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    const sky = this.progs.sky.use();
    this.setAtmos(sky, env, time);
    sky.m4('u_invViewProj', invVP);
    gl.bindVertexArray(this.emptyVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);

    // floor
    const fl = this.progs.floor.use();
    this.setAtmos(fl, env, time);
    fl.m4('u_viewProj', viewProj).i1('u_floorType', env.floorType);
    gl.bindVertexArray(this.floorMesh.vao);
    gl.drawArrays(gl.TRIANGLES, 0, this.floorMesh.count);

    // lit opaque
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    const setupLit = (p) => {
      p.use();
      this.setAtmos(p, env, time);
      p.m4('u_viewProj', viewProj).m4('u_lightVP', lightVP).i1('u_shadow', 0)
        .f1('u_shadowTexel', 1 / this.quality.shadow).f3('u_ambSky', env.ambSky).f3('u_ambGround', env.ambGround);
      return p;
    };
    const lit = setupLit(this.progs.lit);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    let culled = true;
    for (const it of this.queue) {
      if (it.inst) continue;
      if (!!it.doubleSided === culled) { culled = !culled; culled ? gl.enable(gl.CULL_FACE) : gl.disable(gl.CULL_FACE); }
      lit.m4('u_model', it.model).f3('u_tint', it.tint || [1, 1, 1]).f3('u_emissive', it.emissive || [0, 0, 0])
        .f1('u_rim', it.rim ?? 0.35).f1('u_flash', it.flash || 0).f1('u_spec', it.spec ?? 0.15);
      gl.bindVertexArray(it.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, it.mesh.count);
    }
    const litI = setupLit(this.progs.litI);
    for (const it of this.queue) {
      if (!it.inst || !it.inst.instances) continue;
      if (!!it.doubleSided === culled) { culled = !culled; culled ? gl.enable(gl.CULL_FACE) : gl.disable(gl.CULL_FACE); }
      litI.f3('u_tint', it.tint || [1, 1, 1]).f3('u_emissive', it.emissive || [0, 0, 0])
        .f1('u_rim', it.rim ?? 0.3).f1('u_flash', 0).f1('u_spec', it.spec ?? 0.12);
      gl.bindVertexArray(it.inst.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, it.inst.count, it.inst.instances);
    }

    // ink outlines (inverted hull)
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    const ol = this.progs.outline.use();
    this.setAtmos(ol, env, time);
    ol.m4('u_viewProj', viewProj).m4('u_lightVP', lightVP);
    const px = 2.2 / this.h * (this.quality.scale > 1 ? 1.2 : 1);
    for (const it of this.queue) {
      if (!it.outline || it.inst) continue;
      ol.m4('u_model', it.model).f1('u_outline', px * it.outline).f3('u_outlineColor', it.outlineColor || [0.06, 0.035, 0.03])
        .f3('u_tint', [1, 1, 1]).f3('u_emissive', [0, 0, 0]);
      gl.bindVertexArray(it.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, it.mesh.count);
    }
    gl.cullFace(gl.BACK);
    gl.disable(gl.CULL_FACE);

    // transparent fx
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    const fxp = this.progs.fx.use();
    this.setAtmos(fxp, env, time);
    fxp.m4('u_viewProj', viewProj);
    // sort back-to-front
    this.fxQueue.sort((a, b) => b.depth - a.depth);
    for (const it of this.fxQueue) {
      if (it.additive) gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      fxp.m4('u_model', it.model).i1('u_mode', it.mode).f3('u_colA', it.colA || [1, 1, 1]).f3('u_colB', it.colB || [1, 1, 1])
        .f1('u_param', it.param ?? 1).f1('u_alpha', it.alpha ?? 1);
      gl.bindVertexArray(it.mesh.vao);
      gl.drawArrays(gl.TRIANGLES, 0, it.mesh.count);
    }

    // particles
    if (this.particleCount > 0) {
      gl.blendFunc(gl.ONE, gl.ONE);
      const pp = this.progs.particle.use();
      this.setAtmos(pp, env, time);
      pp.m4('u_viewProj', viewProj).f3('u_camRight', cam.right).f3('u_camUp', cam.up);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.particleBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.particleData, 0, this.particleCount * 8);
      gl.bindVertexArray(this.particleVAO);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.particleCount);
    }
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    // ---- resolve MSAA ------------------------------------------------------
    if (t.msFBO) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, t.msFBO);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, t.hdr.fbo);
      gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }

    // ---- bloom -------------------------------------------------------------
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.emptyVAO);
    const down = this.progs.down.use();
    let src = t.hdr;
    for (let i = 0; i < t.bloom.length; i++) {
      const dst = t.bloom[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      down.i1('u_src', 0).f2('u_texel', [1 / src.w, 1 / src.h]).f1('u_threshold', 1.25).i1('u_prefilter', i === 0 ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = dst;
    }
    const up = this.progs.up.use();
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = t.bloom.length - 1; i > 0; i--) {
      const s2 = t.bloom[i], dst = t.bloom[i - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, s2.tex);
      up.i1('u_src', 0).f2('u_texel', [1 / s2.w, 1 / s2.h]).f1('u_radius', 1.0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);

    // ---- composite ---------------------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    const c = this.progs.composite.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.hdr.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, t.bloom[0].tex);
    const P = this.post;
    c.i1('u_hdr', 0).i1('u_bloom', 1).f1('u_bloomStrength', P.bloom * 0.38).f1('u_exposure', P.exposure * 0.92)
      .f1('u_saturation', P.saturation).f1('u_contrast', P.contrast).f1('u_fade', P.fade).f1('u_hurt', P.hurt)
      .f1('u_time', time).f2('u_texel', [1 / this.w, 1 / this.h]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);

    this.queue.length = 0;
    this.fxQueue.length = 0;
    this.particleCount = 0;
  }
}
