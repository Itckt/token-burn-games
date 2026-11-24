'use strict';
const assert = require('node:assert/strict');

function declarations(source, storage) {
  const result = new Map();
  const pattern = /\b(attribute|uniform|varying)\s+(?:(lowp|mediump|highp)\s+)?(\w+)\s+([^;]+);/g;
  for (const [,kind,precision,type,names] of source.matchAll(pattern)) {
    if (kind === storage) for (const name of names.split(',')) {
      result.set(name.trim(), {type, precision: precision || source.match(/precision\s+(\w+)\s+float/)?.[1] || 'highp'});
    }
  }
  return result;
}

// Record the WebGL contract at the application boundary. This double never rasterizes
// pixels. It checks resource lifetimes, shader interfaces and bounds at each draw.
class RecordingGL {
  constructor(options = {}) {
    const enums = ('VERTEX_SHADER FRAGMENT_SHADER COMPILE_STATUS LINK_STATUS ACTIVE_UNIFORMS ' +
      'MAX_TEXTURE_SIZE MAX_RENDERBUFFER_SIZE UNPACK_COLORSPACE_CONVERSION_WEBGL NONE ' +
      'TEXTURE_2D TEXTURE_MIN_FILTER TEXTURE_MAG_FILTER TEXTURE_WRAP_S TEXTURE_WRAP_T REPEAT ' +
      'CLAMP_TO_EDGE LINEAR_MIPMAP_LINEAR LINEAR RGBA UNSIGNED_BYTE UNSIGNED_SHORT FLOAT ' +
      'ARRAY_BUFFER ELEMENT_ARRAY_BUFFER STATIC_DRAW FRAMEBUFFER RENDERBUFFER COLOR_ATTACHMENT0 ' +
      'DEPTH_ATTACHMENT DEPTH_COMPONENT16 FRAMEBUFFER_COMPLETE DEPTH_TEST SCISSOR_TEST CULL_FACE ' +
      'BLEND ONE ZERO CW CCW LEQUAL TRIANGLES').split(' ');
    for (const name of enums) this[name] = name;
    this.COLOR_BUFFER_BIT = 0x4000;
    this.DEPTH_BUFFER_BIT = 0x0100;
    this.TEXTURE0 = 0x84c0;
    this.options = options;
    this.unit = 0;
    this.textures = [];
    this.framebuffers = [];
    this.buffers = [];
    this.programs = [];
    this.units = [];
    this.boundBuffers = {};
    this.pointers = new Map();
    this.enabled = new Set();
    this.attributes = new Set();
    this.depthWrite = true;
    this.blendFactors = [this.ONE, this.ZERO];
    this.draws = [];
    this.totalDraws = 0;
  }
  getParameter(key) {
    if (key === this.MAX_TEXTURE_SIZE) return this.options.textureLimit || 4096;
    assert.equal(key, this.MAX_RENDERBUFFER_SIZE);
    return this.options.renderLimit || 4096;
  }
  createProgram() {
    const p = {id:this.programs.length, shaders:[], bindings:new Map(), values:new Map()};
    this.programs.push(p);
    return p;
  }
  deleteProgram(p) { p.deleted = true; }
  createShader(type) { return {type}; }
  shaderSource(shader,source) { shader.source = source; }
  compileShader(shader) { assert.match(shader.source, /void\s+main\s*\(\s*\)/); }
  getShaderParameter(_,key) { assert.equal(key,this.COMPILE_STATUS); return !this.options.badShader; }
  getShaderInfoLog() { return 'Shader failure injected by test'; }
  attachShader(p,shader) { p.shaders.push(shader); }
  deleteShader(shader) { shader.deleteRequested = true; }
  bindAttribLocation(p,index,name) { p.bindings.set(name,index); }
  linkProgram(p) {
    p.vertex = p.shaders.find(s => s.type === this.VERTEX_SHADER).source;
    p.fragment = p.shaders.find(s => s.type === this.FRAGMENT_SHADER).source;
    const outputs = declarations(p.vertex,'varying');
    for (const [name,decl] of declarations(p.fragment,'varying')) assert.deepEqual(outputs.get(name),decl,name);
    p.inputs = declarations(p.vertex,'attribute');
    p.uniforms = declarations(p.vertex,'uniform');
    for (const [name, decl] of declarations(p.fragment,'uniform')) {
      if (p.uniforms.has(name)) assert.deepEqual(p.uniforms.get(name), decl, name);
      p.uniforms.set(name, decl);
    }
  }
  getProgramParameter(p,key) { return key === this.LINK_STATUS ? p.id !== this.options.badLinkAt : p.uniforms.size; }
  getProgramInfoLog() { return 'Link failure injected by test'; }
  getActiveUniform(p,index) { return {name:[...p.uniforms.keys()][index]}; }
  getUniformLocation(p,name) { return {p, name, type:p.uniforms.get(name).type}; }
  useProgram(p) { assert.ok(!p.deleted); this.program = p; }
  setUniform(loc,type,values) {
    assert.ok(loc, 'declared uniform');
    assert.equal(loc.p,this.program);
    assert.equal(loc.type,type,loc.name);
    assert.ok(values.every(Number.isFinite),loc.name);
    this.program.values.set(loc.name,Array.from(values));
  }
  uniform1f(loc,x) { this.setUniform(loc,'float',[x]); }
  uniform1i(loc,x) { this.setUniform(loc,'sampler2D',[x]); }
  uniform2f(loc,x,y) { this.setUniform(loc,'vec2',[x,y]); }
  uniform4f(loc,x,y,z,w) { this.setUniform(loc,'vec4',[x,y,z,w]); }
  uniform2fv(loc,v) { assert.equal(v.length,2); this.setUniform(loc,'vec2',v); }
  uniform3fv(loc,v) { assert.equal(v.length,3); this.setUniform(loc,'vec3',v); }
  uniformMatrix4fv(loc,transpose,v) {
    assert.equal(transpose,false);
    assert.equal(v.length,16);
    this.setUniform(loc,'mat4',v);
  }
  createTexture() {
    if (this.options.missingTextureAt === this.textures.length + 1) return null;
    const t = {id:this.textures.length+1, uploads:0, params:{}};
    this.textures.push(t);
    return t;
  }
  activeTexture(unit) { this.unit = unit-this.TEXTURE0; }
  bindTexture(_,t) { this.units[this.unit] = t; }
  texImage2D(...args) {
    const t = this.units[this.unit], source = args.at(-1);
    assert.ok(!t.deleted);
    t.width = args.length === 6 ? source.width : args[3];
    t.height = args.length === 6 ? source.height : args[4];
    const limit = this.getParameter(this.MAX_TEXTURE_SIZE);
    for (const n of [t.width,t.height]) assert.ok(Number.isInteger(n) && n > 0 && n <= limit);
    if (source && args.length === 9) assert.equal(source.length,t.width*t.height*4);
    t.ink = source?.ink;
    t.uploads++;
  }
  texParameteri(_,name,value) { this.units[this.unit].params[name] = value; }
  generateMipmap() {
    const t = this.units[this.unit];
    assert.ok(!(t.width & (t.width-1)) && !(t.height & (t.height-1)), 'power-of-two mipmaps');
    t.mip = true;
  }
  pixelStorei() {}
  deleteTexture(t) { t.deleted = true; }
  createFramebuffer() {
    const fb = {id:this.framebuffers.length+1};
    this.framebuffers.push(fb);
    return fb;
  }
  bindFramebuffer(_,fb) { this.target = fb; }
  framebufferTexture2D(target,attachment,type,texture) { this.target.texture = texture; }
  createRenderbuffer() { return {}; }
  bindRenderbuffer(_,rb) { this.renderbuffer = rb; }
  renderbufferStorage(target,format,width,height) { Object.assign(this.renderbuffer,{width,height}); }
  framebufferRenderbuffer(target,attachment,type,rb) { this.target.depth = rb; }
  checkFramebufferStatus() {
    const {depth,texture} = this.target;
    assert.ok(texture && !texture.deleted);
    if (depth) assert.deepEqual([depth.width,depth.height],[texture.width,texture.height]);
    return this.options.badFramebuffer || this.options.badFramebufferAt === this.target.id ? 'incomplete' : this.FRAMEBUFFER_COMPLETE;
  }
  deleteFramebuffer(fb) { fb.deleted = true; }
  deleteRenderbuffer(rb) { rb.deleted = true; }
  createBuffer() {
    if (this.options.missingBufferAt === this.buffers.length + 1) return null;
    const b = {}; this.buffers.push(b); return b;
  }
  bindBuffer(target,b) { assert.ok(!b.deleted); this.boundBuffers[target] = b; }
  bufferData(target,data) {
    const b = this.boundBuffers[target];
    b.uploads = (b.uploads || 0) + 1;
    b.bytes = data.byteLength;
    b.count = data.length;
    if (target === this.ELEMENT_ARRAY_BUFFER) {
      assert.equal(data.BYTES_PER_ELEMENT,2);
      b.maxIndex = data.reduce((max,index) => Math.max(max,index),0);
    }
  }
  deleteBuffer(b) { b.deleted = true; }
  enableVertexAttribArray(i) { this.attributes.add(i); }
  disableVertexAttribArray(i) { this.attributes.delete(i); }
  vertexAttribPointer(i,n,type,normalized,stride,offset) {
    assert.equal(type,this.FLOAT);
    assert.equal(normalized,false);
    this.pointers.set(i,{n,stride,offset,buffer:this.boundBuffers[this.ARRAY_BUFFER]});
  }
  enable(cap) { this.enabled.add(cap); }
  disable(cap) { this.enabled.delete(cap); }
  blendFunc(src, dst) { this.blendFactors = [src, dst]; }
  depthMask(write) { this.depthWrite = write; }
  frontFace(winding) { this.winding = winding; }
  viewport(x,y,w,h) { this.view = [x,y,w,h]; }
  scissor(x,y,w,h) { this.clip = [x,y,w,h]; }
  clear() {}
  clearColor() {}
  depthFunc(mode) { assert.equal(mode,this.LEQUAL); }
  drawArrays(mode,first,count) {
    assert.equal(mode,this.TRIANGLES);
    assert.deepEqual([first,count],[0,3]);
    this.record(2,false,count);
  }
  drawElements(mode,count,type,offset) {
    const b = this.boundBuffers[this.ELEMENT_ARRAY_BUFFER];
    assert.equal(mode,this.TRIANGLES);
    assert.equal(type,this.UNSIGNED_SHORT);
    assert.equal(offset,0);
    assert.ok(!b.deleted && count > 0 && count <= b.count);
    this.record(b.maxIndex,true,count);
  }
  record(maxVertex,indexed,count) {
    const p = this.program, sampled = {};
    const output = this.target?.texture || this.canvas;
    assert.ok(!this.target?.deleted && !output.deleted);
    assert.deepEqual(this.view,[0,0,output.width,output.height]);
    for (const [name,{type}] of p.inputs) {
      const i = p.bindings.get(name), attr = this.pointers.get(i);
      assert.ok(this.attributes.has(i) && attr && !attr.buffer.deleted,name);
      assert.equal(attr.n, {float:1,vec2:2,vec3:3}[type]);
      const end = attr.offset + (attr.stride || attr.n*4)*maxVertex + attr.n*4;
      assert.ok(end <= attr.buffer.bytes,'vertex buffer bounds');
    }
    for (const [name,{type}] of p.uniforms) {
      assert.ok(p.values.has(name),name);
      if (type !== 'sampler2D') continue;
      const t = this.units[p.values.get(name)[0]];
      assert.ok(t && !t.deleted && t !== output,'live texture without framebuffer feedback');
      if (t.params[this.TEXTURE_MIN_FILTER] === this.LINEAR_MIPMAP_LINEAR) assert.ok(t.mip);
      if ((t.width & (t.width-1)) || (t.height & (t.height-1))) {
        assert.equal(t.params[this.TEXTURE_WRAP_S],this.CLAMP_TO_EDGE);
        assert.equal(t.params[this.TEXTURE_WRAP_T],this.CLAMP_TO_EDGE);
      }
      sampled[name] = t.id;
    }
    this.draws.push({program:p.id, target:this.target?.id || 0, output:this.target?.texture.id || 0,
      viewport:this.view, clip:this.enabled.has(this.SCISSOR_TEST) ? this.clip : null,
      depth:this.enabled.has(this.DEPTH_TEST), cull:this.enabled.has(this.CULL_FACE), winding:this.winding,
      depthWrite:this.depthWrite, blend:this.enabled.has(this.BLEND) ? this.blendFactors : null,
      indexed, count, indexBuffer:indexed ? this.boundBuffers[this.ELEMENT_ARRAY_BUFFER] : null,
      uniforms:Object.fromEntries(p.values), sampled});
    this.totalDraws++;
  }
}

module.exports = {RecordingGL, declarations};
