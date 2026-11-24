"use strict";
const assert = require("node:assert/strict");

function declarations(source, storage) {
  const pattern = new RegExp("\\b" + storage + "\\s+(?:(lowp|mediump|highp)\\s+)?(\\w+)\\s+([\\w,\\s]+);", "g");
  const result = new Map();
  for (const match of source.matchAll(pattern)) {
    for (const name of match[3].split(",").map(s => s.trim())) {
      result.set(name, { type: match[2], precision: match[1] });
    }
  }
  return result;
}

// A recording WebGL 1 interface. It checks draw contracts and resource lifetimes in Node.
class CommandGL {
  constructor(options = {}) {
    this.options = options;
    const enums = ("VERTEX_SHADER FRAGMENT_SHADER HIGH_FLOAT COMPILE_STATUS LINK_STATUS ACTIVE_UNIFORMS " +
      "ACTIVE_ATTRIBUTES ARRAY_BUFFER STATIC_DRAW FLOAT TRIANGLES TEXTURE_2D TEXTURE_MIN_FILTER TEXTURE_MAG_FILTER " +
      "TEXTURE_WRAP_S TEXTURE_WRAP_T CLAMP_TO_EDGE LINEAR RGBA UNSIGNED_BYTE FRAMEBUFFER RENDERBUFFER " +
      "COLOR_ATTACHMENT0 DEPTH_ATTACHMENT0 DEPTH_ATTACHMENT DEPTH_COMPONENT16 FRAMEBUFFER_COMPLETE " +
      "FRAMEBUFFER_INCOMPLETE_ATTACHMENT DEPTH_TEST CULL_FACE LESS LEQUAL CW CCW TEXTURE0 TEXTURE1 TEXTURE2 NEAREST DITHER " +
      "BLEND SRC_ALPHA ONE_MINUS_SRC_ALPHA").split(" ");
    enums.forEach((name, index) => { this[name] = index + 1; });
    this.COLOR_BUFFER_BIT = 0x4000;
    this.DEPTH_BUFFER_BIT = 0x0100;
    this.programs = []; this.shaders = []; this.buffers = []; this.textures = [];
    this.framebuffers = []; this.renderbuffers = [];
    this.draws = []; this.framebuffer = null; this.textureUnit = this.TEXTURE0;
    this.boundTextures = new Map(); this.enabled = new Set(); this.pointers = new Map();
    this.caps = new Set(); this.winding = this.CCW; this.viewportRect = []; this.depthWrite = true;
  }
  getShaderPrecisionFormat() {
    return this.options.highp === null ? null : { precision: this.options.highp === false ? 0 : 23 };
  }
  createShader(type) { const s = { type }; this.shaders.push(s); return s; }
  shaderSource(shader, source) { shader.source = source; }
  compileShader(shader) {
    assert.match(shader.source, /void\s+main\s*\(\s*\)/);
    assert.match(shader.source, shader.type === this.VERTEX_SHADER ? /gl_Position\s*=/ : /gl_FragColor\s*=/);
    shader.compiled = !((this.options.failCompile || this.options.failProgram === this.programs.length + 1)
      && shader.type === this.FRAGMENT_SHADER);
  }
  getShaderParameter(shader, name) { assert.equal(name, this.COMPILE_STATUS); return shader.compiled; }
  getShaderInfoLog() { return "test compile diagnostic"; }
  deleteShader(shader) { shader.deleted = true; }
  createProgram() {
    const p = { stages: [], values: {} };
    this.programs.push(p); return p;
  }
  attachShader(p, shader) { p.stages.push(shader); }
  linkProgram(p) {
    const [vs, fs] = p.stages.map(s => s.source), both = vs + fs;
    assert.deepEqual([...declarations(vs, "varying")], [...declarations(fs, "varying")]);
    p.uniforms = [...declarations(both, "uniform")].filter(([name]) => {
      const identifiers = both.match(new RegExp("\\b" + name + "\\b", "g"));
      return identifiers.length > 1;
    });
    p.attrs = [...declarations(vs, "attribute").keys()];
    p.kind = p.attrs.includes("aRing") ? "gate" : p.attrs.includes("aFlow") ? "runoff" : p.attrs.includes("aCorner") ? "rain" : p.attrs.includes("aNormal") ? "land"
      : p.uniforms.some(([n]) => n === "uMirror") ? "water"
      : p.uniforms.some(([n]) => n === "uLightVP") ? "shadow" : "sky";
    p.linked = !this.options.failLink;
  }
  getProgramParameter(p, field) {
    if (field === this.LINK_STATUS) return p.linked;
    if (field === this.ACTIVE_UNIFORMS) return p.uniforms.length;
    assert.equal(field, this.ACTIVE_ATTRIBUTES); return p.attrs.length;
  }
  getProgramInfoLog() { return "test link diagnostic"; }
  deleteProgram(p) { p.deleted = true; }
  getActiveUniform(p, i) { return { name: p.uniforms[i][0] }; }
  getUniformLocation(p, name) { return { p, name, type: p.uniforms.find(([n]) => n === name)[1].type }; }
  getActiveAttrib(p, i) { return { name: p.attrs[i] }; }
  getAttribLocation(p, name) { return p.attrs.indexOf(name); }
  useProgram(p) { assert.ok(p.linked && !p.deleted); this.current = p; }
  write(location, type, value) {
    assert.ok(location, "active uniform location required");
    assert.equal(location.p, this.current);
    assert.equal(location.type, type);
    const values = typeof value === "number" ? [value] : value;
    assert.ok(values.every(Number.isFinite), location.name + " contains a non-finite value");
    this.current.values[location.name] = value;
  }
  uniform1f(loc, v) { this.write(loc, "float", v); }
  uniform1i(loc, v) { assert.ok(Number.isInteger(v)); this.write(loc, "sampler2D", v); }
  uniform2f(loc, a, b) { this.write(loc, "vec2", [a, b]); }
  uniform3fv(loc, v) { assert.equal(v.length, 3); this.write(loc, "vec3", Array.from(v)); }
  uniformMatrix4fv(loc, transpose, v) {
    assert.equal(transpose, false); assert.equal(v.length, 16);
    this.write(loc, "mat4", Array.from(v));
  }
  createBuffer() { const b = {}; this.buffers.push(b); return b; }
  bindBuffer(target, b) { assert.equal(target, this.ARRAY_BUFFER); assert.ok(!b.deleted); this.buffer = b; }
  bufferData(target, data, usage) {
    assert.equal(target, this.ARRAY_BUFFER);
    assert.equal(usage, this.STATIC_DRAW);
    assert.equal(data.BYTES_PER_ELEMENT, 4);
    this.buffer.bytes = data.byteLength;
  }
  deleteBuffer(b) { b.deleted = true; }
  createTexture() { const tex = { params: {} }; this.textures.push(tex); return tex; }
  activeTexture(unit) { this.textureUnit = unit; }
  bindTexture(target, tex) {
    assert.equal(target, this.TEXTURE_2D); assert.ok(!tex.deleted);
    this.boundTextures.set(this.textureUnit, tex);
  }
  texParameteri(target, key, value) { this.boundTextures.get(this.textureUnit).params[key] = value; }
  texImage2D(target, level, internal, w, h, border, format, type, pixels) {
    assert.equal(internal, this.RGBA); assert.equal(format, this.RGBA); assert.equal(type, this.UNSIGNED_BYTE);
    assert.equal(level, 0); assert.equal(border, 0); assert.ok(w > 0 && h > 0);
    if (pixels) assert.equal(pixels.byteLength, w * h * 4);
    Object.assign(this.boundTextures.get(this.textureUnit), { w, h });
  }
  deleteTexture(tex) { tex.deleted = true; }
  createFramebuffer() { const fb = {}; this.framebuffers.push(fb); return fb; }
  deleteFramebuffer(fb) { fb.deleted = true; }
  bindFramebuffer(target, fb) { this.framebuffer = fb; }
  framebufferTexture2D(target, slot, type, tex) { this.framebuffer.color = tex; }
  createRenderbuffer() { const rb = {}; this.renderbuffers.push(rb); return rb; }
  deleteRenderbuffer(rb) { rb.deleted = true; }
  bindRenderbuffer(target, rb) { this.renderbuffer = rb; }
  renderbufferStorage(target, format, w, h) {
    assert.equal(format, this.DEPTH_COMPONENT16); Object.assign(this.renderbuffer, { w, h });
  }
  framebufferRenderbuffer(target, slot, type, rb) { this.framebuffer.depth = rb; }
  checkFramebufferStatus() {
    const { depth, color } = this.framebuffer;
    assert.deepEqual([depth.w, depth.h], [color.w, color.h]);
    const supported = color.params[this.TEXTURE_MIN_FILTER] === this.NEAREST ? this.options.shadows : this.options.reflections;
    return supported === false ? this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT : this.FRAMEBUFFER_COMPLETE;
  }
  enable(cap) { this.caps.add(cap); }
  disable(cap) { this.caps.delete(cap); }
  depthFunc(mode) { assert.ok(mode === this.LESS || mode === this.LEQUAL); this.depthComparison = mode; }
  depthMask(write) { this.depthWrite = write; }
  blendFunc(src, dst) { assert.equal(src, this.SRC_ALPHA); assert.equal(dst, this.ONE_MINUS_SRC_ALPHA); }
  frontFace(winding) { this.winding = winding; }
  clearColor(...rgba) { assert.ok(rgba.every(v => v >= 0 && v <= 1)); this.clearRGBA = rgba; }
  clear(mask) { assert.equal(mask, this.COLOR_BUFFER_BIT | this.DEPTH_BUFFER_BIT); }
  viewport(...rect) { this.viewportRect = rect; }
  enableVertexAttribArray(i) { this.enabled.add(i); }
  disableVertexAttribArray(i) { this.enabled.delete(i); }
  vertexAttribPointer(i, size, type, normalized, stride, offset) {
    assert.equal(type, this.FLOAT); assert.equal(normalized, false); assert.ok(this.enabled.has(i));
    this.pointers.set(i, { buffer: this.buffer, stride: stride || size * 4, size, offset });
  }
  drawArrays(mode, first, count) {
    const p = this.current;
    assert.equal(mode, this.TRIANGLES); assert.equal(first, 0); assert.equal(count % 3, 0);
    assert.equal(this.enabled.size, p.attrs.length); assert.ok(this.caps.has(this.DEPTH_TEST));
    this.viewportRect.slice(2).forEach(v => assert.ok(v > 0));
    for (let i = 0; i < p.attrs.length; i++) {
      assert.ok(this.enabled.has(i));
      const { buffer, stride, size, offset } = this.pointers.get(i);
      assert.ok(!buffer.deleted);
      assert.ok(count === 0 || offset + (count - 1) * stride + size * 4 <= buffer.bytes);
    }
    for (const [name, { type }] of p.uniforms) {
      if (type !== "sampler2D") continue;
      const tex = this.boundTextures.get(this.TEXTURE0 + p.values[name]);
      assert.ok(tex && !tex.deleted && tex.w && tex.h);
      assert.notEqual(tex, this.framebuffer?.color, "a draw cannot sample its own color attachment");
    }
    const pass = !this.framebuffer ? "main" : p.kind === "shadow" ? "shadow" : "reflection";
    this.draws.push({ kind: p.kind, uniforms: { ...p.values }, count, pass, reflected: pass === "reflection", clearRGBA: this.clearRGBA,
      winding: this.winding, culled: this.caps.has(this.CULL_FACE), viewport: this.viewportRect.slice(),
      blend: this.caps.has(this.BLEND), dither: this.caps.has(this.DITHER), depthWrite: this.depthWrite, depthComparison: this.depthComparison });
  }
}
module.exports = { CommandGL, declarations };
