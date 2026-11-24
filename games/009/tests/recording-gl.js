"use strict";
const assert = require("node:assert/strict");

// Records WebGL 1 commands and checks their buffer/program bindings. The test
// double has no graphics driver and neither compiles GLSL nor rasterizes pixels.
class RecordingGL {
  constructor(options = {}) {
    this.options = options;
    const enums = ["VERTEX_SHADER", "FRAGMENT_SHADER", "COMPILE_STATUS", "LINK_STATUS", "HIGH_FLOAT",
      "MAX_TEXTURE_SIZE", "MAX_RENDERBUFFER_SIZE", "FRAMEBUFFER", "RENDERBUFFER", "TEXTURE_2D", "TEXTURE0",
      "RGBA", "UNSIGNED_BYTE", "TEXTURE_MIN_FILTER", "TEXTURE_MAG_FILTER", "NEAREST", "TEXTURE_WRAP_S",
      "TEXTURE_WRAP_T", "CLAMP_TO_EDGE", "COLOR_ATTACHMENT0", "DEPTH_COMPONENT16", "DEPTH_ATTACHMENT",
      "FRAMEBUFFER_COMPLETE", "DEPTH_TEST", "DITHER", "ARRAY_BUFFER", "ELEMENT_ARRAY_BUFFER",
      "STATIC_DRAW", "FLOAT", "TRIANGLES", "UNSIGNED_SHORT"];
    enums.forEach((name, index) => { this[name] = index + 1; });
    this.COLOR_BUFFER_BIT = 0x4000;
    this.DEPTH_BUFFER_BIT = 0x0100;
    this.buffers = new Set();
    this.bindings = new Map();
    this.attributes = new Map();
    this.enabled = new Set();
    this.shaders = [];
    this.programs = [];
    this.screenDraws = [];
    this.shadowPasses = 0;
    this.shadowDraws = 0;
    this.screenPasses = 0;
    this.lost = false;
  }
  isContextLost() { return this.lost; }
  getExtension(name) { return name === "OES_standard_derivatives" && this.options.derivatives !== false ? {} : null; }
  getShaderPrecisionFormat() { return {precision: this.options.highPrecision === false ? 0 : 23}; }
  getParameter(key) {
    assert.ok(key === this.MAX_TEXTURE_SIZE || key === this.MAX_RENDERBUFFER_SIZE);
    return this.options.size || 2048;
  }
  createProgram() {
    const p = {shaders: [], uniforms: new Map(), attributes: new Map()};
    this.programs.push(p);
    return p;
  }
  createShader(kind) {
    const shader = {kind};
    this.shaders.push(shader);
    return shader;
  }
  shaderSource(shader, source) { shader.source = source; }
  compileShader(shader) {
    shader.compiled = this.options.compile !== false && this.options.failShader !== this.shaders.length;
  }
  getShaderParameter(shader, key) { assert.equal(key, this.COMPILE_STATUS); return shader.compiled; }
  getShaderInfoLog() { return "Test driver rejected a shader"; }
  attachShader(p, s) { assert.ok(s.compiled); p.shaders.push(s); }
  deleteShader(shader) { shader.deleted = true; }
  deleteProgram(program) { program.deleted = true; }
  bindAttribLocation(p, i, name) { p.attributes.set(name, i); }
  linkProgram(p) {
    assert.deepEqual(p.shaders.map(s => s.kind), [this.VERTEX_SHADER, this.FRAGMENT_SHADER]);
    p.linked = this.options.link !== false;
    p.lit = p.shaders[0].source.includes("aNormal");
  }
  getProgramParameter(p, key) { assert.equal(key, this.LINK_STATUS); return p.linked; }
  getProgramInfoLog() { return "Test driver rejected a program"; }
  getUniformLocation(program, name) {
    assert.ok(program.shaders.some(s => s.source.includes(name)), "undeclared uniform " + name);
    return {program, name};
  }
  useProgram(p) { assert.ok(p.linked && !p.deleted); this.activeProgram = p; }
  saveUniform(location, data) {
    assert.equal(this.activeProgram, location.program);
    assert.ok(data.every(Number.isFinite), "non-finite uniform " + location.name);
    location.program.uniforms.set(location.name, data);
  }
  uniformMatrix4fv(loc, transpose, values) {
    assert.equal(transpose, false); assert.equal(values.length, 16); this.saveUniform(loc, Array.from(values));
  }
  uniform3fv(loc, values) { assert.equal(values.length, 3); this.saveUniform(loc, Array.from(values)); }
  uniform2f(loc, x, y) { this.saveUniform(loc, [x, y]); }
  uniform1f(loc, x) { this.saveUniform(loc, [x]); }
  uniform1i(loc, x) { this.saveUniform(loc, [x]); }
  createBuffer() { const buffer = {}; this.buffers.add(buffer); return buffer; }
  bindBuffer(target, buffer) {
    assert.ok(this.buffers.has(buffer));
    this.bindings.set(target, buffer);
  }
  bufferData(target, data, usage) {
    assert.equal(usage, this.STATIC_DRAW);
    const buffer = this.bindings.get(target);
    assert.ok(buffer);
    buffer.length = data.length;
    if (target === this.ARRAY_BUFFER) assert.equal(data.constructor.name, "Float32Array");
    else {
      assert.equal(target, this.ELEMENT_ARRAY_BUFFER);
      assert.equal(data.constructor.name, "Uint16Array");
      buffer.largest = data.reduce((a, b) => Math.max(a, b), 0);
    }
  }
  deleteBuffer(buffer) { assert.ok(this.buffers.delete(buffer)); }
  enableVertexAttribArray(i) { this.enabled.add(i); }
  disableVertexAttribArray(i) { this.enabled.delete(i); }
  vertexAttribPointer(i, size, type, normalized, stride, offset) {
    assert.deepEqual([size, type, normalized, stride, offset], [3, this.FLOAT, false, 36, 12 * i]);
    this.attributes.set(i, this.bindings.get(this.ARRAY_BUFFER));
  }
  createTexture() { return {}; }
  createFramebuffer() { return {}; }
  createRenderbuffer() { return {}; }
  bindTexture(target, texture) { assert.equal(target, this.TEXTURE_2D); this.texture = texture; }
  bindFramebuffer(target, fb) { assert.equal(target, this.FRAMEBUFFER); this.framebuffer = fb; }
  bindRenderbuffer(target, rb) { assert.equal(target, this.RENDERBUFFER); this.renderbuffer = rb; }
  texImage2D(target, level, format, w, h) {
    assert.equal(target, this.TEXTURE_2D);
    assert.ok(w > 0 && w <= this.getParameter(this.MAX_TEXTURE_SIZE) && w === h);
    this.texture.size = w;
  }
  texParameteri() {}
  framebufferTexture2D(target, attachment, kind, texture) { this.framebuffer.texture = texture; }
  renderbufferStorage(target, format, w, h) { assert.equal(w, h); this.renderbuffer.size = w; }
  framebufferRenderbuffer(target, attachment, kind, rb) { this.framebuffer.depth = rb; }
  checkFramebufferStatus() {
    assert.equal(this.framebuffer.texture.size, this.framebuffer.depth.size);
    return this.options.framebuffer === false ? 0 : this.FRAMEBUFFER_COMPLETE;
  }
  activeTexture(unit) { assert.equal(unit, this.TEXTURE0); }
  enable() {}
  disable() {}
  viewport(x, y, w, h) { assert.ok(w > 0 && h > 0); this.viewportSize = [w, h]; }
  clearColor() {}
  clear(mask) {
    assert.equal(mask, this.COLOR_BUFFER_BIT | this.DEPTH_BUFFER_BIT);
    if (this.framebuffer) { this.shadowPasses++; this.shadowDraws = 0; }
    else {
      this.screenPasses++;
      this.screenDraws = [];
    }
  }
  drawElements(mode, count, kind, offset) {
    assert.deepEqual([mode, kind, offset], [this.TRIANGLES, this.UNSIGNED_SHORT, 0]);
    const indices = this.bindings.get(this.ELEMENT_ARRAY_BUFFER);
    assert.ok(this.buffers.has(indices) && indices.length >= count && count % 3 === 0);
    const p = this.activeProgram;
    for (const i of p.lit ? [0, 1, 2] : [0]) {
      const buffer = this.attributes.get(i);
      assert.ok(this.enabled.has(i) && this.buffers.has(buffer));
      assert.ok(indices.largest < buffer.length / 9);
    }
    const u = p.uniforms;
    assert.ok(u.has("uVP") && u.has("uModel"));
    if (this.framebuffer) {
      this.shadowDraws++;
      assert.equal(p.lit, false);
      assert.notEqual(this.texture, this.framebuffer.texture, "texture feedback");
    } else {
      assert.equal(p.lit, true);
      this.screenDraws.push({kind: u.get("uKind")[0], model: u.get("uModel"), vp: u.get("uVP"),
        tint: u.get("uTint"), shadows: u.get("uShadowOn")[0]});
    }
  }
}
module.exports = {RecordingGL};
