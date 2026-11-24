"use strict";
const assert = require("node:assert/strict");

function declarations(source, qualifier) {
  const found = new Map();
  const pattern = /\b(attribute|varying|uniform)\s+(?:(lowp|mediump|highp)\s+)?(\w+)\s+([^;]+);/g;
  for (const [,kind,precision,type,names] of source.matchAll(pattern)) {
    if (kind !== qualifier) continue;
    for (const name of names.split(",")) found.set(name.trim(),{type,precision});
  }
  return found;
}
function shaderShape(source, isVertex) {
  assert.match(source,/\bvoid\s+main\s*\(\s*\)\s*\{/);
  assert.match(source,isVertex ? /\bgl_Position\s*=/ : /\bgl_FragColor\s*=/);
  if (!isVertex) assert.match(source,/\bprecision\s+(highp|mediump)\s+float\s*;/);
  const closing = {"(":")","[":"]","{":"}"}, stack = [];
  for (const char of source) {
    if (closing[char]) stack.push(closing[char]);
    if (")]}".includes(char)) assert.equal(char,stack.pop(),"unbalanced GLSL delimiter");
  }
  assert.equal(stack.length,0);
}

// Records the WebGL 1 calls used by the game. It checks shader interfaces and draw
// contracts, but does not rasterize pixels or stand in for a GPU shader compiler.
class Graphics {
  constructor(options={}) {
    this.options = options;
    const constants = ("VERTEX_SHADER FRAGMENT_SHADER COMPILE_STATUS LINK_STATUS ARRAY_BUFFER STATIC_DRAW " +
      "DYNAMIC_DRAW FLOAT TRIANGLES DEPTH_TEST CULL_FACE BLEND SRC_ALPHA ONE_MINUS_SRC_ALPHA TEXTURE_2D " +
      "TEXTURE0 TEXTURE_MIN_FILTER TEXTURE_MAG_FILTER TEXTURE_WRAP_S TEXTURE_WRAP_T NEAREST CLAMP_TO_EDGE " +
      "RGBA UNSIGNED_BYTE FRAMEBUFFER RENDERBUFFER COLOR_ATTACHMENT0 DEPTH_ATTACHMENT DEPTH_COMPONENT16 " +
      "FRAMEBUFFER_COMPLETE MAX_TEXTURE_SIZE MAX_RENDERBUFFER_SIZE COLOR_BUFFER_BIT DEPTH_BUFFER_BIT").split(" ");
    constants.forEach((key,i) => { this[key] = i+1; });
    this.programs = [];
    this.shaders = [];
    this.activeArrays = new Set();
    this.pointers = new Map();
    this.enabled = new Set();
    this.staticUploads = 0;
    this.dynamicUploads = 0;
    this.draws = 0;
    this.depthWrite = true;
    this.textureSizes = [];
  }
  createShader(kind) {
    const shader = {kind};
    this.shaders.push(shader);
    return shader;
  }
  shaderSource(shader,source) { shader.source = source; }
  compileShader(shader) {
    shaderShape(shader.source,shader.kind===this.VERTEX_SHADER);
    shader.ok = !this.options.failCompile;
  }
  getShaderParameter(shader,key) { assert.equal(key,this.COMPILE_STATUS); return shader.ok; }
  getShaderInfoLog() { return "simulated shader compile error"; }
  attachShader(program,shader) { program.stages.push(shader); }
  deleteShader() {}
  createProgram() {
    const program = {stages:[],locations:new Map(),written:new Set()};
    this.programs.push(program);
    return program;
  }
  bindAttribLocation(p,index,name) { p.locations.set(name,index); }
  linkProgram(p) {
    assert.equal(p.stages.length,2);
    const vs = p.stages.find(s=>s.kind===this.VERTEX_SHADER).source;
    const fs = p.stages.find(s=>s.kind===this.FRAGMENT_SHADER).source;
    const produced = declarations(vs,"varying");
    for (const [name,entry] of declarations(fs,"varying")) assert.deepEqual(produced.get(name),entry,name);
    p.uniforms = new Map([...declarations(vs,"uniform"),...declarations(fs,"uniform")]);
    p.attributes = declarations(vs,"attribute");
    p.linked = true;
  }
  getProgramParameter(p,key) { assert.equal(key,this.LINK_STATUS); return p.linked; }
  getProgramInfoLog() { return "simulated link error"; }
  deleteProgram(p) { p.deleted = true; }
  useProgram(p) { assert.ok(p.linked && !p.deleted); this.current = p; }
  getUniformLocation(p,name) { assert.ok(p.uniforms.has(name),name); return {p,name}; }
  uniform(location,type) {
    const {p,name} = location;
    assert.equal(p,this.current);
    assert.equal(p.uniforms.get(name).type,type);
    p.written.add(name);
  }
  uniformMatrix4fv(location,transpose,data) {
    assert.equal(transpose,false);
    assert.ok(data.length===16 && data.every(Number.isFinite));
    this.uniform(location,"mat4");
  }
  uniform1f(location,value) { assert.ok(Number.isFinite(value)); this.uniform(location,"float"); }
  uniform1i(location,value) { assert.equal(value,0); this.uniform(location,"sampler2D"); }
  createBuffer() { return {}; }
  bindBuffer(target,buffer) { assert.equal(target,this.ARRAY_BUFFER); this.array = buffer; }
  bufferData(target,data,usage) {
    assert.equal(target,this.ARRAY_BUFFER);
    assert.ok(ArrayBuffer.isView(data) && data.byteLength>0);
    this.array.size = data.byteLength;
    if (usage===this.STATIC_DRAW) this.staticUploads++;
    else {
      assert.equal(usage,this.DYNAMIC_DRAW);
      this.dynamicUploads++;
      assert.ok(data.every(Number.isFinite),"finite particle batch");
    }
  }
  deleteBuffer(buffer) { buffer.deleted = true; }
  enableVertexAttribArray(i) { this.activeArrays.add(i); }
  disableVertexAttribArray(i) { this.activeArrays.delete(i); }
  vertexAttribPointer(i,size,type,normalized,stride,offset) {
    assert.equal(type,this.FLOAT);
    assert.equal(normalized,false);
    this.pointers.set(i,{buffer:this.array,size,stride,offset});
  }
  drawArrays(mode,first,count) {
    assert.equal(mode,this.TRIANGLES);
    assert.ok(Number.isInteger(count) && count>0 && count%3===0);
    const p = this.current;
    for (const name of p.uniforms.keys()) assert.ok(p.written.has(name),"unset uniform "+name);
    for (const [name,{type}] of p.attributes) {
      const slot = p.locations.get(name);
      assert.ok(this.activeArrays.has(slot),"disabled attribute "+name);
      const a = this.pointers.get(slot);
      assert.equal(a.size,type==="float" ? 1 : Number(type.slice(-1)));
      assert.ok(!a.buffer.deleted && a.offset+(first+count-1)*a.stride+4*a.size<=a.buffer.size,"attribute buffer bounds");
    }
    assert.ok(this.enabled.has(this.DEPTH_TEST));
    this.draws++;
  }
  getParameter(key) {
    assert.ok(key===this.MAX_TEXTURE_SIZE || key===this.MAX_RENDERBUFFER_SIZE);
    return 2048;
  }
  viewport(x,y,w,h) {
    assert.ok(w>=1 && h>=1 && Number.isInteger(w) && Number.isInteger(h));
    this.viewportSize = [w,h];
  }
  enable(cap) { this.enabled.add(cap); }
  disable(cap) { this.enabled.delete(cap); }
  depthMask(write) { this.depthWrite = write; }
  createFramebuffer() { return {}; }
  createTexture() { return {}; }
  createRenderbuffer() { return {}; }
  bindFramebuffer(target,fb) { assert.equal(target,this.FRAMEBUFFER); this.fb = fb; }
  texImage2D(target,level,format,w,h) { this.textureSizes.push([w,h]); }
  checkFramebufferStatus() { return this.options.noShadowBuffer ? 0 : this.FRAMEBUFFER_COMPLETE; }
  getExtension(name) {
    return name === "WEBGL_lose_context" ? {loseContext:()=>{ this.lost = true; }} : null;
  }
}
for (const method of ["clearColor","clear","blendFunc","activeTexture","bindTexture","texParameteri",
  "bindRenderbuffer","renderbufferStorage","framebufferTexture2D","framebufferRenderbuffer","deleteFramebuffer","deleteRenderbuffer"]) {
  Graphics.prototype[method] = function() {};
}
module.exports = { Graphics };
