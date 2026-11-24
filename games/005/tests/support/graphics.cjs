'use strict';
const assert = require('node:assert/strict');

// Record the WebGL 1 calls made by the production renderer. The tests inspect
// real buffer contents, attribute layouts and draw order without a GPU context.
class Graphics {
  constructor(options = {}) {
    const constants = [
      'VERTEX_SHADER','FRAGMENT_SHADER','HIGH_FLOAT','COMPILE_STATUS','LINK_STATUS',
      'ARRAY_BUFFER','ELEMENT_ARRAY_BUFFER','STATIC_DRAW','FLOAT','UNSIGNED_SHORT',
      'TEXTURE_2D','UNPACK_FLIP_Y_WEBGL','RGBA','UNSIGNED_BYTE','TEXTURE_MIN_FILTER',
      'TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T','LINEAR_MIPMAP_LINEAR',
      'LINEAR','REPEAT','CLAMP_TO_EDGE','BLEND','DEPTH_TEST','LEQUAL','CULL_FACE',
      'SRC_ALPHA','ONE_MINUS_SRC_ALPHA','ONE','TRIANGLES'
    ];
    constants.forEach((name,i) => { this[name] = i+1; });
    this.COLOR_BUFFER_BIT = 0x4000;
    this.DEPTH_BUFFER_BIT = 0x0100;
    this.options = options;
    this.shaders = [];
    this.enabled = new Set();
    this.attributes = new Map();
    this.arrays = new Set();
    this.pointers = new Map();
    this.bound = new Map();
    this.uniforms = {};
    this.uploads = 0;
    this.textureUploads = 0;
    this.draws = [];
    this.depthWrite = true;
  }
  getShaderPrecisionFormat() { return {precision: this.options.medium ? 0 : 23}; }
  createShader(type) {
    const shader = {type};
    this.shaders.push(shader);
    return shader;
  }
  shaderSource(shader, source) { shader.source = source; }
  compileShader(shader) { shader.compiled = !this.options.failCompile; }
  getShaderParameter(shader, param) { assert.equal(param,this.COMPILE_STATUS); return shader.compiled; }
  getShaderInfoLog() { return 'Simulated shader compilation failure'; }
  deleteShader(shader) { shader.deleted = true; }
  createProgram() { return {shaders: []}; }
  attachShader(program, shader) { program.shaders.push(shader); }
  linkProgram(program) { program.linked = program.shaders.length===2 && !this.options.failLink; }
  getProgramParameter(program, param) { assert.equal(param,this.LINK_STATUS); return program.linked; }
  getProgramInfoLog() { return 'Simulated program link failure'; }
  deleteProgram(program) { program.deleted = true; }
  useProgram(program) { assert.ok(program.linked); this.program = program; }
  getAttribLocation(program, name) {
    assert.ok(program.shaders[0].source.includes(name), 'unknown attribute ' + name);
    const index = this.attributes.size;
    this.attributes.set(name,index);
    return index;
  }
  getUniformLocation(program, name) {
    assert.ok(program.shaders.some(s => s.source.includes(name)), 'unknown uniform ' + name);
    return name;
  }
  uniform1i(name, value) { assert.ok(Number.isInteger(value)); this.uniforms[name] = value; }
  uniform1f(name, value) { assert.ok(Number.isFinite(value)); this.uniforms[name] = value; }
  uniform3fv(name, value) {
    assert.equal(value.length,3);
    assert.ok(value.every(Number.isFinite));
    this.uniforms[name] = Array.from(value);
  }
  matrix(name, transpose, value, size) {
    assert.equal(transpose,false);
    assert.equal(value.length,size);
    assert.ok(value.every(Number.isFinite));
    this.uniforms[name] = Array.from(value);
  }
  uniformMatrix3fv(n,t,v) { this.matrix(n,t,v,9); }
  uniformMatrix4fv(n,t,v) { this.matrix(n,t,v,16); }
  createBuffer() { return {}; }
  bindBuffer(target, buffer) { this.bound.set(target,buffer); }
  bufferData(target, data, usage) {
    assert.equal(usage,this.STATIC_DRAW);
    assert.ok(ArrayBuffer.isView(data));
    const buffer = this.bound.get(target);
    buffer.data = data;
    buffer.bytes = data.byteLength;
    if (target===this.ELEMENT_ARRAY_BUFFER) buffer.highest = data.reduce((a,b) => Math.max(a,b),0);
    this.uploads++;
  }
  enableVertexAttribArray(index) { this.arrays.add(index); }
  disableVertexAttribArray(index) { this.arrays.delete(index); }
  vertexAttribPointer(index, size, type, normalized, stride, offset) {
    assert.equal(type,this.FLOAT);
    assert.equal(normalized,false);
    this.pointers.set(index,{buffer: this.bound.get(this.ARRAY_BUFFER), size, stride, offset});
  }
  createTexture() { return {}; }
  bindTexture(target, texture) { assert.equal(target,this.TEXTURE_2D); this.texture = texture; }
  pixelStorei(param, value) { this.flipY = [param,value]; }
  texImage2D(target, level, internal, ...args) {
    assert.equal(target,this.TEXTURE_2D);
    if (args.length === 3) this.texture.image = args[2];
    else {
      const [width,height,border,format,type,pixels] = args;
      assert.ok(border===0 && format===this.RGBA && type===this.UNSIGNED_BYTE);
      assert.equal(pixels.length,width*height*4);
      this.texture.image = {width,height,pixels};
    }
    this.textureUploads++;
  }
  texParameteri(target, param, value) { this.texture[param] = value; }
  generateMipmap(target) { assert.equal(target,this.TEXTURE_2D); this.texture.mipmaps = true; }
  enable(cap) { this.enabled.add(cap); }
  disable(cap) { this.enabled.delete(cap); }
  depthMask(value) { this.depthWrite = value; }
  depthFunc(value) { this.depthFunction = value; }
  blendFuncSeparate(...args) { this.blend = args; }
  clearColor(...rgba) { this.clearRGBA = rgba; }
  viewport(...args) { this.viewportArgs = args; }
  clear(mask) {
    assert.equal(mask,this.COLOR_BUFFER_BIT | this.DEPTH_BUFFER_BIT);
    this.draws = [];
  }
  drawElements(mode, count, type, offset) {
    assert.equal(mode,this.TRIANGLES);
    assert.equal(type,this.UNSIGNED_SHORT);
    assert.ok(Number.isInteger(count) && count >= 0);
    assert.ok(Number.isInteger(offset) && offset >= 0 && offset % 2 === 0);
    assert.equal(count%3,0);
    const indices = this.bound.get(this.ELEMENT_ARRAY_BUFFER);
    assert.ok(offset+count*2<=indices.bytes);
    for (const at of this.arrays) {
      const p = this.pointers.get(at);
      assert.ok(p && indices.highest*p.stride+p.offset+p.size*4 <= p.buffer.bytes,
        'attribute ' + at + ' would read past its buffer');
    }
    const posed = this.uniforms.uMaterial===3;
    assert.equal(this.arrays.has(this.attributes.get('aWetPosition')),posed);
    assert.equal(this.arrays.has(this.attributes.get('aWetNormal')),posed);
    this.draws.push({indices, count, offset, uniforms: {...this.uniforms}, depthWrite: this.depthWrite,
      blended: this.enabled.has(this.BLEND), culled: this.enabled.has(this.CULL_FACE)});
  }
}

// The diagrams and printed sleeve use a small subset of the 2D canvas API.
class Ink {
  constructor() {
    this.text = []; this.rectangles = 0; this.stackDepth = 0; this.clears = 0;
    this.path = []; this.arcs = []; this.strokes = []; this.clips = []; this.fills = [];
  }
  measureText(label) { return {width: label.length*7}; }
  fillText(label) { this.text.push(label); }
  fillRect(x,y,w,h) {
    assert.ok([x,y,w,h].every(Number.isFinite));
    this.rectangles++; this.lastRect = {x,y,w,h,color:this.fillStyle};
  }
  clearRect(...bounds) {
    assert.ok(bounds.every(Number.isFinite));
    this.clears++; this.text = []; this.strokes = []; this.clips = []; this.fills = [];
  }
  beginPath() { this.path = []; this.arcs = []; }
  arc(x,y,r,start,end) {
    assert.ok([x,y,r,start,end].every(Number.isFinite) && r>=0);
    this.arcs.push({x,y,r,start,end});
  }
  moveTo(x,y) { assert.ok(Number.isFinite(x) && Number.isFinite(y)); this.path.push([x,y]); }
  lineTo(x,y) { this.moveTo(x,y); }
  rect(...bounds) { assert.ok(bounds.every(Number.isFinite)); this.path.push(bounds); }
  clip() { this.clips.push(this.path); }
  stroke() { this.strokes.push({points:this.path,arcs:this.arcs,color:this.strokeStyle,width:this.lineWidth}); }
  fill() { this.fills.push({points:this.path,arcs:this.arcs,color:this.fillStyle}); }
  save() { this.stackDepth++; }
  restore() { assert.ok(this.stackDepth>0); this.stackDepth--; }
}
for (const name of ['scale','translate','closePath','bezierCurveTo','setLineDash']) {
  Ink.prototype[name] = function (...args) {
    assert.ok(args.flat().every(Number.isFinite), 'non-finite 2D coordinates in ' + name);
  };
}

module.exports = {Graphics,Ink};
