"use strict";

const assert = require("node:assert/strict");

// A recording WebGL 1 interface. It checks draw-time state and buffer bounds
// without creating a graphics context or depending on a native driver.
class RecordingGL {
  constructor() {
    Object.assign(this, {
      VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
      ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893, STATIC_DRAW: 0x88e4, FLOAT: 0x1406,
      UNSIGNED_SHORT: 0x1403, TRIANGLES: 4, TRIANGLE_STRIP: 5, DEPTH_TEST: 0x0b71, LEQUAL: 0x0203,
      CULL_FACE: 0x0b44, BLEND: 0x0be2, COLOR_BUFFER_BIT: 0x4000, DEPTH_BUFFER_BIT: 0x0100,
      SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303, ONE: 1,
      TEXTURE0: 0x84c0, TEXTURE_2D: 0x0de1, TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, LINEAR: 0x2601, CLAMP_TO_EDGE: 0x812f,
      ALPHA: 0x1906, UNSIGNED_BYTE: 0x1401
    });
    this.programs = [];
    this.buffers = [];
    this.textures = [];
    this.bound = new Map();
    this.enabled = new Set();
    this.attributes = new Set();
    this.pointers = new Map();
    this.draws = [];
    this.frames = 0;
    this.writeDepth = true;
  }
  createShader(type) { return { type }; }
  shaderSource(shader, source) { shader.source = source; }
  compileShader(shader) { shader.compiled = !this.failCompile; }
  getShaderParameter(shader, param) { assert.equal(param, this.COMPILE_STATUS); return shader.compiled; }
  getShaderInfoLog() { return "shader compilation failed"; }
  createProgram() {
    const program = { shaders: [], attributes: new Map(), uniforms: Object.create(null) };
    this.programs.push(program);
    return program;
  }
  attachShader(program, shader) { assert.ok(shader.compiled); program.shaders.push(shader); }
  deleteShader(shader) { shader.deletePending = true; }
  linkProgram(program) { assert.equal(program.shaders.length, 2); program.linked = !this.failLink; }
  getProgramParameter(program, param) { assert.equal(param, this.LINK_STATUS); return program.linked; }
  getProgramInfoLog() { return "program link failed"; }
  getAttribLocation(program, name) {
    assert.ok(program.shaders[0].source.includes(name));
    const index = program.attributes.size;
    program.attributes.set(name, index);
    return index;
  }
  getUniformLocation(program, name) {
    assert.ok(program.shaders.some(shader => shader.source.includes(name)));
    return { program, name };
  }
  useProgram(program) { assert.ok(program.linked); this.program = program; }
  createBuffer() { const buffer = {}; this.buffers.push(buffer); return buffer; }
  bindBuffer(target, buffer) { this.bound.set(target, buffer); }
  bufferData(target, data, usage) {
    assert.ok(ArrayBuffer.isView(data));
    assert.equal(usage, this.STATIC_DRAW);
    this.bound.get(target).data = data;
  }
  createTexture() {
    const texture = { parameters: new Map(), uploads: 0 };
    this.textures.push(texture);
    return texture;
  }
  activeTexture(unit) { assert.equal(unit, this.TEXTURE0); }
  bindTexture(target, texture) {
    assert.equal(target, this.TEXTURE_2D);
    assert.ok(this.textures.includes(texture));
    this.texture = texture;
  }
  texParameteri(target, parameter, value) {
    assert.equal(target, this.TEXTURE_2D);
    this.texture.parameters.set(parameter, value);
  }
  texImage2D(target, level, internalFormat, width, height, border, format, type, pixels) {
    assert.deepEqual([target, level, internalFormat, border, format, type],
      [this.TEXTURE_2D, 0, this.ALPHA, 0, this.ALPHA, this.UNSIGNED_BYTE]);
    assert.ok(ArrayBuffer.isView(pixels));
    assert.equal(pixels.byteLength, width * height);
    Object.assign(this.texture, { width, height, pixels });
    this.texture.uploads++;
  }
  clearColor(...rgba) { this.background = rgba; }
  clear(mask) { this.clearMask = mask; this.draws = []; this.frames++; }
  enable(flag) { this.enabled.add(flag); }
  disable(flag) { this.enabled.delete(flag); }
  depthFunc(value) { this.depthFunction = value; }
  depthMask(value) { this.writeDepth = value; }
  blendFuncSeparate(...values) { this.blend = values; }
  viewport(...rect) { this.rect = rect; }
  enableVertexAttribArray(index) { this.attributes.add(index); }
  disableVertexAttribArray(index) { this.attributes.delete(index); }
  vertexAttribPointer(index, size, type, normalized, stride, offset) {
    assert.ok(this.attributes.has(index));
    assert.equal(type, this.FLOAT);
    this.pointers.set(index, { size, normalized, stride, offset, buffer: this.bound.get(this.ARRAY_BUFFER) });
  }
  setUniform(location, value) {
    assert.equal(location.program, this.program);
    this.program.uniforms[location.name] = value;
  }
  uniformMatrix4fv(location, transpose, values) {
    assert.equal(transpose, false);
    assert.equal(values.length, 16);
    assert.ok(values.every(Number.isFinite));
    this.setUniform(location, Array.from(values));
  }
  uniform1f(location, value) { this.setUniform(location, value); }
  uniform1i(location, value) { assert.ok(Number.isInteger(value)); this.setUniform(location, value); }
  uniform3f(location, ...values) { this.setUniform(location, values); }
  record(mode, first, count) {
    for (const index of this.program.attributes.values()) {
      assert.ok(this.attributes.has(index) && this.pointers.get(index).buffer.data);
    }
    const draw = { mode, first, count, model: this.program.uniforms.uModel, writeDepth: this.writeDepth,
      cull: this.enabled.has(this.CULL_FACE), blend: this.enabled.has(this.BLEND) };
    if ("uFocus" in this.program.uniforms) draw.focus = this.program.uniforms.uFocus;
    this.draws.push(draw);
  }
  drawArrays(mode, first, count) { this.record(mode, first, count); }
  drawElements(mode, count, type, byteOffset) {
    assert.equal(type, this.UNSIGNED_SHORT);
    assert.equal(byteOffset % 2, 0);
    assert.ok(byteOffset / 2 + count <= this.bound.get(this.ELEMENT_ARRAY_BUFFER).data.length);
    this.record(mode, byteOffset / 2, count);
  }
}

module.exports = RecordingGL;
