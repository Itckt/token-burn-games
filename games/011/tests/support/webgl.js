"use strict";
const assert = require("node:assert/strict");

function names(source, kind) {
  const found = new Map();
  const expression = new RegExp("\\b" + kind + "\\s+(\\w+)\\s+([\\w, ]+);", "g");
  for (const [, type, list] of source.matchAll(expression)) {
    for (const name of list.split(",").map(value => value.trim())) found.set(name, type);
  }
  return found;
}

// A state-checking WebGL 1 test double. Draws validate the same buffer
// offsets, attribute widths, sampler bindings and index bounds used by the app.
class TestGL {
  constructor(failure = "") {
    const constants = ("ARRAY_BUFFER ELEMENT_ARRAY_BUFFER VERTEX_SHADER FRAGMENT_SHADER COMPILE_STATUS LINK_STATUS " +
      "STATIC_DRAW DYNAMIC_DRAW TEXTURE_2D TEXTURE_WRAP_S TEXTURE_WRAP_T TEXTURE_MAG_FILTER TEXTURE_MIN_FILTER " +
      "LINEAR LINEAR_MIPMAP_LINEAR REPEAT CLAMP_TO_EDGE RGBA UNSIGNED_BYTE FLOAT UNSIGNED_SHORT TEXTURE0 " +
      "TRIANGLES LINES DEPTH_TEST CULL_FACE SRC_ALPHA ONE_MINUS_SRC_ALPHA COLOR_BUFFER_BIT BLEND SCISSOR_TEST").split(" ");
    constants.forEach((name, i) => { this[name] = i + 1; });
    this.COLOR_BUFFER_BIT = 0x4000; this.DEPTH_BUFFER_BIT = 0x0100;
    this.failure = failure;
    this.resources = [];
    this.bindings = new Map();
    this.pointers = new Map();
    this.active = new Set();
    this.capabilities = new Set();
    this.draws = [];
    this.clears = [];
    this.uploads = 0;
  }
  resource(kind, fields = {}) {
    const object = { kind, deleted: false, ...fields };
    this.resources.push(object);
    return object;
  }
  remove(object, kind) {
    assert.equal(object.kind, kind); assert.equal(object.deleted, false);
    object.deleted = true;
  }
  createShader(type) { return this.resource("shader", { type }); }
  shaderSource(shader, source) { shader.source = source; }
  compileShader(shader) { shader.compiled = this.failure !== "compile" && shader.source.includes("void main()"); }
  getShaderParameter(shader, key) { assert.equal(key, this.COMPILE_STATUS); return shader.compiled; }
  getShaderInfoLog() { return "test compile error"; }
  deleteShader(shader) { this.remove(shader, "shader"); }
  createProgram() { return this.resource("program", { stages: [], values: new Map() }); }
  attachShader(program, shader) { assert.ok(shader.compiled); program.stages.push(shader); }
  linkProgram(program) {
    const vertex = program.stages.find(s => s.type === this.VERTEX_SHADER);
    const fragment = program.stages.find(s => s.type === this.FRAGMENT_SHADER);
    assert.ok(vertex && fragment);
    program.attributes = names(vertex.source, "attribute");
    program.uniforms = names(vertex.source + fragment.source, "uniform");
    program.locations = new Map(Array.from(program.attributes.keys(), (name, index) => [name, index]));
    program.name = program.attributes.has("aCenter") ? "cloud" : program.attributes.has("aBrightness") ? "rain" :
      program.uniforms.has("uEcho") ? "radar" : program.uniforms.has("uSite") ? "doppler" :
      program.uniforms.has("uPeakWind") ? "wind" : program.uniforms.has("uCentral") ? "pressure" :
      program.uniforms.has("uGrid") ? "sea" : "deck";
    program.linked = this.failure !== "link";
  }
  getProgramParameter(program, key) { assert.equal(key, this.LINK_STATUS); return program.linked; }
  getProgramInfoLog() { return "test link error"; }
  deleteProgram(program) { this.remove(program, "program"); }
  getAttribLocation(p, name) { assert.ok(p.attributes.has(name), name); return p.locations.get(name); }
  getUniformLocation(p, name) { assert.ok(p.uniforms.has(name), name); return { p, name }; }
  useProgram(p) { assert.ok(p.linked && !p.deleted); this.program = p; }
  uniform(location, value, type) {
    assert.equal(location.p, this.program); assert.equal(location.p.uniforms.get(location.name), type);
    const array = typeof value === "number" ? [value] : Array.from(value);
    assert.ok(array.every(Number.isFinite));
    this.program.values.set(location.name, array.length === 1 ? array[0] : array);
  }
  uniform1f(loc, n) { this.uniform(loc, n, "float"); }
  uniform1i(loc, n) { this.uniform(loc, n, "sampler2D"); }
  uniform2f(loc, x, y) { this.uniform(loc, [x, y], "vec2"); }
  uniform3fv(loc, values) { assert.equal(values.length, 3); this.uniform(loc, values, "vec3"); }
  uniform3f(loc, x, y, z) { this.uniform(loc, [x, y, z], "vec3"); }
  uniformMatrix4fv(loc, transpose, m) { assert.equal(transpose, false); assert.equal(m.length, 16); this.uniform(loc, m, "mat4"); }
  createBuffer() { return this.resource("buffer"); }
  bindBuffer(target, buffer) {
    assert.ok(!buffer.deleted); assert.ok(!buffer.target || buffer.target === target);
    buffer.target = target; this.bindings.set(target, buffer);
  }
  bufferData(target, data, usage) {
    const buffer = this.bindings.get(target); assert.ok(buffer);
    buffer.usage = usage;
    buffer.bytes = typeof data === "number" ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  }
  bufferSubData(target, offset, data) {
    const buffer = this.bindings.get(target);
    assert.equal(buffer.usage, this.DYNAMIC_DRAW); assert.ok(offset + data.byteLength <= buffer.bytes.length);
    buffer.bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), offset);
    this.uploads++;
  }
  deleteBuffer(buffer) { this.remove(buffer, "buffer"); }
  enableVertexAttribArray(index) { this.active.add(index); }
  disableVertexAttribArray(index) { this.active.delete(index); }
  vertexAttribPointer(index, count, type, normalized, stride, offset) {
    assert.equal(type, this.FLOAT); assert.equal(normalized, false);
    assert.equal(stride % 4, 0); assert.equal(offset % 4, 0);
    this.pointers.set(index, { count, stride: stride || count * 4, offset, buffer: this.bindings.get(this.ARRAY_BUFFER) });
  }
  createTexture() { return this.resource("texture", { parameters: new Map() }); }
  bindTexture(target, texture) { assert.equal(target, this.TEXTURE_2D); assert.ok(!texture.deleted); this.texture = texture; }
  texImage2D(target, level, internal, width, height, border, format, type, data) {
    assert.equal(target, this.TEXTURE_2D); assert.equal(level, 0); assert.equal(border, 0);
    assert.equal(internal, this.RGBA); assert.equal(format, this.RGBA); assert.equal(type, this.UNSIGNED_BYTE);
    assert.equal(data.byteLength, width * height * 4);
    Object.assign(this.texture, { width, height, pixels: data.slice() });
  }
  texParameteri(target, name, value) { assert.equal(target, this.TEXTURE_2D); this.texture.parameters.set(name, value); }
  generateMipmap(target) {
    assert.equal(target, this.TEXTURE_2D);
    for (const size of [this.texture.width, this.texture.height]) assert.ok(size > 0 && (size & (size - 1)) === 0);
    this.texture.mipped = true;
  }
  deleteTexture(texture) { this.remove(texture, "texture"); }
  activeTexture(unit) { assert.equal(unit, this.TEXTURE0); }
  viewport(x, y, w, h) { assert.ok(w > 0 && h > 0); this.viewportSize = [x, y, w, h]; }
  scissor(x, y, w, h) {
    assert.ok([x, y, w, h].every(Number.isInteger));
    assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0);
    assert.ok(x + w <= this.viewportSize[2] && y + h <= this.viewportSize[3]);
    this.scissorBox = [x, y, w, h];
  }
  activeScissor() { return this.capabilities.has(this.SCISSOR_TEST) ? this.scissorBox : null; }
  clearColor(...rgba) { assert.ok(rgba.every(v => v >= 0 && v <= 1)); }
  clear(mask) {
    assert.equal(mask, this.capabilities.has(this.DEPTH_TEST) ? this.COLOR_BUFFER_BIT | this.DEPTH_BUFFER_BIT : this.COLOR_BUFFER_BIT);
    this.clears.push({ mask, scissor: this.activeScissor() });
  }
  disable(cap) { this.capabilities.delete(cap); }
  enable(cap) { this.capabilities.add(cap); }
  blendFunc(source, dest) { assert.equal(source, this.SRC_ALPHA); assert.equal(dest, this.ONE_MINUS_SRC_ALPHA); }
  draw(mode, count, maximumIndex) {
    const p = this.program;
    assert.ok(p && !p.deleted);
    const attrs = {};
    for (const [name, type] of p.attributes) {
      const location = p.locations.get(name);
      assert.ok(this.active.has(location));
      const attr = this.pointers.get(location);
      assert.equal(attr.count, type === "float" ? 1 : Number(type.slice(-1)));
      assert.ok(!attr.buffer.deleted && attr.offset + attr.stride * maximumIndex + attr.count * 4 <= attr.buffer.bytes.length);
      attrs[name] = attr;
    }
    assert.equal(this.active.size, p.attributes.size);
    for (const [name, type] of p.uniforms) {
      assert.ok(p.values.has(name), "unbound " + name);
      if (type === "sampler2D") {
        assert.equal(p.values.get(name), 0);
        assert.equal(this.texture.parameters.size, 4);
        if (this.texture.parameters.get(this.TEXTURE_MIN_FILTER) === this.LINEAR_MIPMAP_LINEAR) assert.ok(this.texture.mipped);
        else assert.equal(this.texture.parameters.get(this.TEXTURE_MIN_FILTER), this.LINEAR);
      }
    }
    this.draws.push({ name: p.name, mode, count, attrs, uniforms: Object.fromEntries(p.values), scissor: this.activeScissor(),
      blended: this.capabilities.has(this.BLEND), depthTest: this.capabilities.has(this.DEPTH_TEST),
      indexBuffer: this.bindings.get(this.ELEMENT_ARRAY_BUFFER), texture: this.texture });
  }
  drawArrays(mode, start, count) { assert.ok(start >= 0 && count > 0); this.draw(mode, count, start + count - 1); }
  drawElements(mode, count, type, offset) {
    assert.equal(type, this.UNSIGNED_SHORT);
    const buffer = this.bindings.get(this.ELEMENT_ARRAY_BUFFER);
    assert.ok(buffer && !buffer.deleted && offset + count * 2 <= buffer.bytes.length);
    const indices = new Uint16Array(buffer.bytes.buffer, offset, count);
    let max = 0;
    for (const i of indices) max = Math.max(max, i);
    this.draw(mode, count, max);
  }
}
module.exports = { TestGL };
