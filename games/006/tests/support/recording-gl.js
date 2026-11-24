'use strict';
const assert = require('node:assert/strict');

// Records the WebGL 1 contract, including attribute bounds and transparent draw state.
// Shader execution and GPU performance are outside the scope of this CPU test double.
class RecordingGL {
  constructor(options={}) {
    const names=['VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','TEXTURE_2D','RGBA',
      'UNSIGNED_BYTE','TEXTURE_MAG_FILTER','TEXTURE_MIN_FILTER','LINEAR','LINEAR_MIPMAP_LINEAR','TEXTURE_WRAP_S',
      'TEXTURE_WRAP_T','CLAMP_TO_EDGE','DEPTH_TEST','LEQUAL','SRC_ALPHA','ONE_MINUS_SRC_ALPHA','ARRAY_BUFFER',
      'ELEMENT_ARRAY_BUFFER','STATIC_DRAW','FLOAT','TRIANGLES','UNSIGNED_SHORT','BLEND'];
    names.forEach((name,i)=>{this[name]=i+1;});
    this.COLOR_BUFFER_BIT=16384; this.DEPTH_BUFFER_BIT=256;
    this.options=options; this.shaders=[]; this.buffers=new Set(); this.enabled=new Set(); this.locations=new Map();
    this.bindings=new Map(); this.uniforms={}; this.pointers=new Map(); this.draws=[]; this.parameters=new Map();
    this.uploads=0; this.deletions=0; this.clears=0; this.depthWrite=true;
    this.TEXTURE0=33984; this.unit=this.TEXTURE0; this.textures=new Map(); this.textureUploads=0;
  }
  createProgram() { return {attached:[]}; }
  createShader(type) { const s={type}; this.shaders.push(s); return s; }
  shaderSource(s,source) { s.source=source; }
  compileShader(s) { s.compiled=true; }
  getShaderParameter(s,kind) { return kind===this.COMPILE_STATUS && s.compiled && this.options.badShader!==s.type; }
  getShaderInfoLog() { return 'test compiler failure'; }
  attachShader(p,s) { assert.ok(s.compiled); p.attached.push(s); }
  deleteShader(s) { s.deleted=true; }
  linkProgram(p) { assert.equal(p.attached.length,2); p.linked=true; }
  getProgramParameter(p,kind) { return kind===this.LINK_STATUS && p.linked && !this.options.badLink; }
  getProgramInfoLog() { return 'test link failure'; }
  deleteProgram(p) { p.deleted=true; }
  useProgram(p) { assert.ok(p.linked); this.program=p; }
  getAttribLocation(p,name) { this.locations.set(name,this.locations.size); return this.locations.get(name); }
  enableVertexAttribArray(loc) { assert.ok(loc>=0 && loc<8); }
  getUniformLocation(p,name) { return name; }
  uniform1i(key,v) { this.uniforms[key]=v; }
  uniform1f(key,v) { assert.ok(Number.isFinite(v)); this.uniforms[key]=v; }
  uniform3f(key,x,y,z) { this.uniforms[key]=[x,y,z]; }
  uniform4f(key,x,y,z,w) { this.uniforms[key]=[x,y,z,w]; }
  uniform4fv(key,v) { assert.ok(v.length % 4 === 0 && v.every(Number.isFinite)); this.uniforms[key]=Array.from(v); }
  uniform2f(key,x,y) { this.uniforms[key]=[x,y]; }
  uniform3fv(key,v) { this.uniforms[key]=Array.from(v); }
  uniformMatrix4fv(key,transpose,v) { assert.equal(transpose,false); assert.equal(v.length,16); this.uniforms[key]=Array.from(v); }
  createTexture() { return {}; }
  activeTexture(unit) { assert.ok(unit>=this.TEXTURE0 && unit<this.TEXTURE0+8); this.unit=unit; }
  bindTexture(target,texture) { assert.equal(target,this.TEXTURE_2D); this.texture=texture; this.textures.set(this.unit,texture); }
  texImage2D(target,level,internal,format,type,image) {
    assert.deepEqual([target,level,internal,format,type],[this.TEXTURE_2D,0,this.RGBA,this.RGBA,this.UNSIGNED_BYTE]);
    this.texture.width=image.width; this.texture.height=image.height; this.textureUploads++;
  }
  texParameteri(target,key,value) { this.parameters.set(key,value); }
  generateMipmap() {
    for(const n of [this.texture.width,this.texture.height]) assert.ok(n>0 && (n & (n-1))===0);
    this.texture.mipmaps=true;
  }
  getExtension() { return null; }
  clearColor(...values) { this.background=values; }
  enable(cap) { this.enabled.add(cap); }
  disable(cap) { this.enabled.delete(cap); }
  depthFunc(v) { this.depthComparison=v; }
  blendFunc(source,dest) { this.blend=[source,dest]; }
  createBuffer() { const b={}; this.buffers.add(b); return b; }
  bindBuffer(target,b) { assert.ok(this.buffers.has(b)); this.bindings.set(target,b); }
  bufferData(target,data,usage) {
    assert.equal(usage,this.STATIC_DRAW);
    const b=this.bindings.get(target); b.data=data; this.uploads++;
    if(target===this.ELEMENT_ARRAY_BUFFER) b.maxIndex=data.reduce((a,x)=>Math.max(a,x),0);
  }
  deleteBuffer(b) { assert.ok(this.buffers.delete(b)); this.deletions++; }
  vertexAttribPointer(loc,size,type,normalized,stride,offset) {
    assert.equal(type,this.FLOAT); assert.equal(normalized,false);
    assert.ok(offset+size*4<=stride && offset%4===0);
    this.pointers.set(loc,{size,stride,offset,vb:this.bindings.get(this.ARRAY_BUFFER)});
  }
  viewport(x,y,w,h) { this.viewportRect=[x,y,w,h]; }
  depthMask(value) { this.depthWrite=value; }
  clear(mask) { assert.equal(mask,this.COLOR_BUFFER_BIT|this.DEPTH_BUFFER_BIT); this.draws=[]; this.clears++; }
  drawElements(mode,count,type,offset) {
    assert.equal(mode,this.TRIANGLES); assert.equal(type,this.UNSIGNED_SHORT); assert.equal(offset,0);
    const ib=this.bindings.get(this.ELEMENT_ARRAY_BUFFER), vb=this.bindings.get(this.ARRAY_BUFFER);
    assert.ok(this.buffers.has(ib) && this.buffers.has(vb));
    assert.equal(ib.data.length,count); assert.ok(count>0 && count%3===0);
    assert.ok(this.enabled.has(this.DEPTH_TEST));
    assert.equal(this.pointers.size,this.locations.size);
    for(const attr of this.pointers.values()) {
      assert.equal(attr.vb,vb);
      assert.ok(ib.maxIndex*attr.stride+attr.offset+4*attr.size<=vb.data.byteLength);
    }
    this.draws.push({state:{...this.uniforms},verts:vb.data,indices:ib.data,glass:this.enabled.has(this.BLEND),depthWrite:this.depthWrite});
  }
}
module.exports={RecordingGL};
