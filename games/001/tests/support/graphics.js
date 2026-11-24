'use strict';
const assert = require('node:assert/strict');

// These record the API contract and check draw bounds. They do not rasterize pixels.
class Recording2D {
  constructor() { this.counts = {}; this.text = []; }
  fillText(words, ...args) {
    assert.ok(args.every(Number.isFinite));
    if (!this.text.includes(words)) this.text.push(words);
  }
}
for (const op of ['beginPath','closePath','moveTo','lineTo','arc','stroke','fill','fillRect','clearRect',
  'strokeRect','translate','scale','rotate','save','restore','setTransform','drawImage']) {
  Recording2D.prototype[op] = function (...args) {
    const numbers = op === 'drawImage' ? args.slice(1) : args;
    assert.ok(numbers.every(Number.isFinite), op+' received invalid coordinates');
    this.counts[op] = (this.counts[op] || 0) + 1;
  };
}

class RecordingGL {
  constructor(options = {}) {
    this.options = options;
    const names = ['VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','ARRAY_BUFFER',
      'STATIC_DRAW','TEXTURE_2D','RGBA','UNSIGNED_BYTE','TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER',
      'TEXTURE_WRAP_S','TEXTURE_WRAP_T','LINEAR_MIPMAP_LINEAR','LINEAR','NEAREST','CLAMP_TO_EDGE',
      'FRAMEBUFFER','RENDERBUFFER','DEPTH_COMPONENT16','DEPTH_ATTACHMENT','COLOR_ATTACHMENT0',
      'FRAMEBUFFER_COMPLETE','MAX_TEXTURE_SIZE','MAX_RENDERBUFFER_SIZE','DEPTH_TEST','FLOAT',
      'TRIANGLES','TEXTURE0','BLEND','SRC_ALPHA','ONE_MINUS_SRC_ALPHA','DITHER'];
    names.forEach((key, i) => { this[key] = i+1; });
    this.COLOR_BUFFER_BIT = 0x4000;
    this.DEPTH_BUFFER_BIT = 0x0100;
    this.draws = [];
    this.uploads = [];
    this.programs = [];
    this.buffers = [];
    this.textures = [];
    this.framebuffers = [];
    this.renderbuffers = [];
    this.attributes = new Map();
    this.enabledAttributes = new Set();
    this.flags = new Set([this.DITHER]);
    this.writeDepth = true;
    this.framebuffer = null;
    this.lost = false;
  }
  isContextLost() { return this.lost; }
  getExtension(name) { return name === 'OES_standard_derivatives' && this.options.derivatives !== false ? {} : null; }
  getParameter(key) {
    assert.ok(key === this.MAX_TEXTURE_SIZE || key === this.MAX_RENDERBUFFER_SIZE);
    return this.options.maxSize || 4096;
  }
  createProgram() {
    const p = {shaders:[], attributes:new Map(), uniforms:{}, id:this.programs.length};
    this.programs.push(p);
    return p;
  }
  createShader(type) { return {type}; }
  shaderSource(s,source) { s.source = source; }
  compileShader(s) { assert.ok(s.source.includes('void main()')); }
  getShaderParameter(s,key) { assert.equal(key,this.COMPILE_STATUS); return !this.options.compileFailure; }
  getShaderInfoLog() { return 'simulated compiler failure'; }
  attachShader(p,s) { p.shaders.push(s); }
  deleteShader(s) { s.deleted = true; }
  linkProgram(p) { assert.equal(p.shaders.length,2); }
  getProgramParameter(p,key) { assert.equal(key,this.LINK_STATUS); return !this.options.linkFailure; }
  getProgramInfoLog() { return 'simulated link failure'; }
  deleteProgram(p) { p.deleted = true; }
  getAttribLocation(p,key) {
    assert.ok(p.shaders[0].source.includes(key));
    if (!p.attributes.has(key)) p.attributes.set(key,p.attributes.size);
    return p.attributes.get(key);
  }
  getUniformLocation(p,key) {
    assert.ok(p.shaders.some(s => s.source.includes(key.replace('[0]',''))));
    return {p,key};
  }
  useProgram(p) { this.program = p; }
  setUniform(location,value) {
    assert.equal(location.p,this.program);
    const data = typeof value === 'number' ? [value] : Array.from(value);
    assert.ok(data.every(Number.isFinite),location.key);
    this.program.uniforms[location.key] = data;
  }
  uniformMatrix4fv(location,transpose,value) {
    assert.equal(transpose,false); assert.equal(value.length,16); this.setUniform(location,value);
  }
  uniform3fv(l,v) { assert.equal(v.length,3); this.setUniform(l,v); }
  uniform2fv(l,v) { assert.equal(v.length%2,0); this.setUniform(l,v); }
  uniform2f(l,x,y) { this.setUniform(l,[x,y]); }
  uniform1f(l,v) { this.setUniform(l,v); }
  uniform1i(l,v) { assert.ok(Number.isInteger(v)); this.setUniform(l,v); }
  createBuffer() { const b = {}; this.buffers.push(b); return b; }
  deleteBuffer(buffer) { buffer.deleted=true; }
  bindBuffer(target,b) { assert.equal(target,this.ARRAY_BUFFER); this.buffer=b; }
  bufferData(target,data,usage) {
    assert.equal(target,this.ARRAY_BUFFER); assert.equal(usage,this.STATIC_DRAW);
    this.buffer.data = data;
    this.uploads.push({kind:'buffer',size:data.byteLength});
  }
  createTexture() { const t={}; this.textures.push(t); return t; }
  deleteTexture(texture) { texture.deleted=true; }
  bindTexture(target,t) { assert.equal(target,this.TEXTURE_2D); this.texture=t; }
  texImage2D(...args) {
    const width = args.length === 6 ? args[5].width : args[3];
    const height = args.length === 6 ? args[5].height : args[4];
    assert.ok(width>0 && height>0 && Math.max(width,height)<=this.getParameter(this.MAX_TEXTURE_SIZE));
    Object.assign(this.texture,{width,height});
    if (args.length===6) this.texture.source=args[5];
    this.uploads.push({kind:'texture',width,height});
  }
  texParameteri() {}
  generateMipmap() {
    assert.equal(Math.log2(this.texture.width)%1,0);
    assert.equal(Math.log2(this.texture.height)%1,0);
  }
  activeTexture(unit) { assert.equal(unit,this.TEXTURE0); }
  createFramebuffer() { const fb={}; this.framebuffers.push(fb); return fb; }
  createRenderbuffer() { const rb={}; this.renderbuffers.push(rb); return rb; }
  bindFramebuffer(target,fb) { assert.equal(target,this.FRAMEBUFFER); this.framebuffer=fb; }
  bindRenderbuffer(target,rb) { assert.equal(target,this.RENDERBUFFER); this.renderbuffer=rb; }
  renderbufferStorage(target,fmt,w,h) {
    assert.equal(target,this.RENDERBUFFER); assert.equal(fmt,this.DEPTH_COMPONENT16);
    assert.ok(w===h && w<=this.getParameter(this.MAX_RENDERBUFFER_SIZE));
  }
  framebufferRenderbuffer(target,attachment,type,rb) { this.framebuffer.depth=rb; }
  framebufferTexture2D(target,attachment,type,texture) { this.framebuffer.color=texture; }
  checkFramebufferStatus() {
    assert.ok(this.framebuffer.depth && this.framebuffer.color);
    return this.options.shadow === false ? 0 : this.FRAMEBUFFER_COMPLETE;
  }
  deleteFramebuffer(fb) { fb.deleted=true; }
  deleteRenderbuffer(rb) { rb.deleted=true; }
  enable(flag) { this.flags.add(flag); }
  disable(flag) { this.flags.delete(flag); }
  depthMask(value) { this.writeDepth=value; }
  blendFunc() {}
  clearColor() {}
  clear() {}
  viewport(x,y,w,h) { assert.ok(w>0 && h>0); this.viewportSize=[w,h]; }
  enableVertexAttribArray(index) { this.enabledAttributes.add(index); }
  disableVertexAttribArray(index) { this.enabledAttributes.delete(index); }
  vertexAttribPointer(index,size,type,normalized,stride,offset) {
    assert.equal(type,this.FLOAT);
    this.attributes.set(index,{buffer:this.buffer,size,stride,offset});
  }
  drawArrays(mode,start,count) {
    assert.equal(mode,this.TRIANGLES);
    assert.ok(Number.isInteger(start) && start>=0 && count>0 && count%3===0);
    for (const index of this.program.attributes.values()) {
      assert.ok(this.enabledAttributes.has(index));
      const {buffer,size,stride,offset}=this.attributes.get(index);
      assert.ok((start+count-1)*stride+offset+size*4<=buffer.data.byteLength,'draw exceeds its buffer');
    }
    this.draws.push({program:this.program.id,start,count,offscreen:!!this.framebuffer,
      depth:this.flags.has(this.DEPTH_TEST),dither:this.flags.has(this.DITHER),
      blend:this.flags.has(this.BLEND),writeDepth:this.writeDepth,texture:this.texture});
  }
}
module.exports = {Recording2D,RecordingGL};
