'use strict';
const assert=require('node:assert/strict');
const {rasterize}=require('./raster');

// A structural checker, deliberately independent of a browser or native GPU.
function shaderDeclarations(source,qualifier) {
  const found=new Map();
  const pattern=new RegExp('\\b'+qualifier+'\\s+(?:(lowp|mediump|highp)\\s+)?(\\w+)\\s+([^;]+);','g');
  for (const [,precision,type,names] of source.matchAll(pattern)) {
    for (const name of names.split(',')) found.set(name.trim(),(precision ? precision+' ' : '')+type);
  }
  return found;
}
function checkShader(source,fragment) {
  assert.equal((source.match(/\bvoid\s+main\s*\(\s*\)/g)||[]).length,1);
  assert.match(source,fragment ? /gl_FragColor\s*=/ : /gl_Position\s*=/);
  if (fragment) assert.match(source,/precision\s+(highp|mediump)\s+float;/);
  assert.doesNotMatch(source,/\b(undefined|NaN|Infinity)\b/);
  const expected=[],pairs={'(':')','[':']','{':'}'};
  for (const ch of source.replace(/\/\/[^\n]*/g,'')) {
    if (pairs[ch]) expected.push(pairs[ch]);
    if (')]}'.includes(ch)) assert.equal(ch,expected.pop());
  }
  assert.equal(expected.length,0);
}

class RecordingGL {
  constructor(canvas,options={}) {
    this.canvas=canvas; this.options=options; this.draws=[]; this.reads=0; this.uploads=[];
    this.resources=[]; this.enabled=new Set(); this.arrays=new Set(); this.pointers=new Map();
    this.buffers=new Map(); this.textures=new Map(); this.unit=0; this.depthWrite=true;
    this.viewportBox=[0,0,1,1];
    const enums='VERTEX_SHADER FRAGMENT_SHADER COMPILE_STATUS LINK_STATUS ARRAY_BUFFER ELEMENT_ARRAY_BUFFER STATIC_DRAW DYNAMIC_DRAW TEXTURE_2D TEXTURE_MIN_FILTER TEXTURE_MAG_FILTER TEXTURE_WRAP_S TEXTURE_WRAP_T NEAREST LINEAR LINEAR_MIPMAP_LINEAR CLAMP_TO_EDGE RGBA UNSIGNED_BYTE RENDERBUFFER DEPTH_COMPONENT16 FRAMEBUFFER COLOR_ATTACHMENT0 DEPTH_ATTACHMENT FRAMEBUFFER_COMPLETE MAX_TEXTURE_SIZE MAX_VIEWPORT_DIMS MAX_RENDERBUFFER_SIZE UNPACK_FLIP_Y_WEBGL UNPACK_PREMULTIPLY_ALPHA_WEBGL DEPTH_TEST LEQUAL DITHER CULL_FACE BLEND SRC_ALPHA ONE_MINUS_SRC_ALPHA ONE FLOAT TRIANGLES TRIANGLE_STRIP UNSIGNED_SHORT';
    enums.split(' ').forEach((name,i)=>this[name]=i+10);
    this.TEXTURE0=1000; this.TEXTURE1=1001; this.COLOR_BUFFER_BIT=1; this.DEPTH_BUFFER_BIT=2;
  }
  get drawingBufferWidth() { return this.canvas.width; }
  get drawingBufferHeight() { return this.canvas.height; }
  create(kind) { const obj={kind,deleted:false}; this.resources.push(obj); return obj; }
  createShader(type) { return Object.assign(this.create('shader'),{type}); }
  shaderSource(shader,source) { shader.source=source; }
  compileShader(shader) { checkShader(shader.source,shader.type===this.FRAGMENT_SHADER); }
  getShaderParameter(shader,parameter) { assert.equal(parameter,this.COMPILE_STATUS); return !this.options.failCompile; }
  getShaderInfoLog() { return 'Simulated shader compile failure'; }
  createProgram() { return Object.assign(this.create('program'),{shaders:[],attrs:{},uniforms:{}}); }
  attachShader(program,shader) { program.shaders.push(shader); }
  bindAttribLocation(program,slot,name) { program.attrs[name]=slot; }
  linkProgram(program) {
    const vs=program.shaders.find(s=>s.type===this.VERTEX_SHADER).source;
    const fs=program.shaders.find(s=>s.type===this.FRAGMENT_SHADER).source;
    const outputs=shaderDeclarations(vs,'varying');
    for (const [name,type] of shaderDeclarations(fs,'varying')) assert.equal(outputs.get(name),type);
    program.name=vs.includes('a_ground') ? 'ground' : vs.includes('a_wisp') ? 'steam' :
      fs.includes('u_shadowStep') ? 'surface' : fs.includes('gl_FragCoord') ? 'shadow' : 'pick';
    program.declared=new Map([...shaderDeclarations(vs,'uniform'),...shaderDeclarations(fs,'uniform')]);
    program.inputs=shaderDeclarations(vs,'attribute');
  }
  getProgramParameter(program,parameter) { assert.equal(parameter,this.LINK_STATUS); return !this.options.failLink; }
  getProgramInfoLog() { return 'Simulated program link failure'; }
  getUniformLocation(program,name) { assert.ok(program.declared.has(name),name); return {program,name}; }
  useProgram(program) { assert.ok(!program.deleted); this.program=program; }
  setUniform(location,value) {
    assert.equal(location.program,this.program); this.program.uniforms[location.name]=value;
  }
  uniformMatrix4fv(loc,transpose,m) {
    assert.equal(transpose,false); assert.equal(m.length,16); assert.ok(m.every(Number.isFinite));
    this.setUniform(loc,Array.from(m));
  }
  uniform3fv(loc,v) { assert.equal(v.length,3); assert.ok(v.every(Number.isFinite)); this.setUniform(loc,Array.from(v)); }
  uniform2f(loc,x,y) { assert.ok(Number.isFinite(x) && Number.isFinite(y)); this.setUniform(loc,[x,y]); }
  uniform4f(loc,...values) { assert.equal(values.length,4); assert.ok(values.every(Number.isFinite)); this.setUniform(loc,values); }
  uniform1f(loc,n) { assert.ok(Number.isFinite(n)); this.setUniform(loc,n); }
  uniform1i(loc,n) { assert.ok(Number.isInteger(n)); this.setUniform(loc,n); }
  createBuffer() { return this.create('buffer'); }
  bindBuffer(type,handle) { this.buffers.set(type,handle); }
  bufferData(type,data,usage) {
    const buf=this.buffers.get(type);
    buf.bytes=typeof data==='number' ? data : data.byteLength; buf.data=data; buf.usage=usage;
    if (type===this.ELEMENT_ARRAY_BUFFER) {
      assert.equal(data.BYTES_PER_ELEMENT,2); buf.max=data.reduce((a,b)=>Math.max(a,b),0);
    }
    this.uploads.push({buf,bytes:buf.bytes,static:true});
  }
  bufferSubData(type,offset,data) {
    const buf=this.buffers.get(type);
    assert.equal(buf.usage,this.DYNAMIC_DRAW); assert.ok(offset>=0 && offset+data.byteLength<=buf.bytes);
    buf.data=data;
    assert.ok(data.every(Number.isFinite)); this.uploads.push({buf,bytes:data.byteLength,static:false,probe:data[50]});
  }
  enableVertexAttribArray(slot) { this.arrays.add(slot); }
  disableVertexAttribArray(slot) { this.arrays.delete(slot); }
  vertexAttribPointer(slot,size,type,normalized,stride,offset) {
    assert.equal(type,this.FLOAT); assert.equal(normalized,false);
    assert.ok(offset%4===0 && stride%4===0 && stride<=255);
    this.pointers.set(slot,{buf:this.buffers.get(this.ARRAY_BUFFER),size,stride,offset});
  }
  createTexture() { return Object.assign(this.create('texture'),{params:new Map()}); }
  activeTexture(unit) { this.unit=unit-this.TEXTURE0; }
  bindTexture(type,t) { assert.equal(type,this.TEXTURE_2D); this.textures.set(this.unit,t); }
  texParameteri(type,key,value) { this.textures.get(this.unit).params.set(key,value); }
  texImage2D(...args) {
    const texture=this.textures.get(this.unit),image=args.at(-1);
    texture.width=args.length===6 ? image.width : args[3];
    texture.height=args.length===6 ? image.height : args[4];
    assert.ok(texture.width>0 && texture.height>0 && texture.width<=this.getParameter(this.MAX_TEXTURE_SIZE));
  }
  pixelStorei() {}
  generateMipmap() {
    const tex=this.textures.get(this.unit);
    assert.ok((tex.width & (tex.width-1))===0 && (tex.height & (tex.height-1))===0);
    tex.mipmap=true;
  }
  createRenderbuffer() { return this.create('renderbuffer'); }
  bindRenderbuffer(type,buf) { this.depthBuffer=buf; }
  renderbufferStorage(type,format,width,height) { Object.assign(this.depthBuffer,{width,height}); }
  createFramebuffer() { return this.create('framebuffer'); }
  bindFramebuffer(type,fbo) { this.fbo=fbo; }
  framebufferTexture2D(type,attachment,textureType,texture) { this.fbo.color=texture; }
  framebufferRenderbuffer(type,attachment,bufferType,buffer) { this.fbo.depth=buffer; }
  checkFramebufferStatus() {
    assert.equal(this.fbo.color.width,this.fbo.depth.width); assert.equal(this.fbo.color.height,this.fbo.depth.height);
    return this.options.incomplete ? 0 : this.FRAMEBUFFER_COMPLETE;
  }
  getParameter(p) {
    if (p===this.MAX_TEXTURE_SIZE) return this.options.maxTexture || 4096;
    if (p===this.MAX_VIEWPORT_DIMS) return [8192,8192];
    if (p===this.MAX_RENDERBUFFER_SIZE) return 4096;
    throw new Error('Unexpected graphics parameter '+p);
  }
  enable(flag) { this.enabled.add(flag); }
  disable(flag) { this.enabled.delete(flag); }
  depthMask(v) { this.depthWrite=v; }
  depthFunc(v) { assert.equal(v,this.LEQUAL); }
  blendFuncSeparate(...args) { assert.deepEqual(args,[this.SRC_ALPHA,this.ONE_MINUS_SRC_ALPHA,this.ONE,this.ONE_MINUS_SRC_ALPHA]); }
  viewport(...args) { this.viewportBox=args; }
  clearColor(...args) { this.clearValue=args; }
  clear(mask) {
    assert.ok(mask & this.DEPTH_BUFFER_BIT); assert.ok(this.depthWrite);
    if (this.fbo) this.fbo.geometry=[];
  }
  recordDraw(last,count) {
    for (const input of this.program.inputs.keys()) assert.ok(this.arrays.has(this.program.attrs[input]),input);
    for (const slot of this.arrays) {
      const {buf,size,stride,offset}=this.pointers.get(slot);
      assert.ok(buf && !buf.deleted && offset+last*stride+size*4<=buf.bytes,'vertex attribute bounds');
    }
    for (const [name,type] of this.program.declared) if (type==='sampler2D') {
      const tex=this.textures.get(this.program.uniforms[name] || 0);
      assert.ok(tex && tex.width>0 && !tex.deleted); assert.notEqual(tex,this.fbo?.color);
      if (tex.params.get(this.TEXTURE_MIN_FILTER)===this.LINEAR_MIPMAP_LINEAR) assert.ok(tex.mipmap);
    }
    assert.ok(this.enabled.has(this.DEPTH_TEST));
    this.draws.push({name:this.program.name,count,viewport:[...this.viewportBox],target:this.fbo,
      matrix:this.program.uniforms.u_camera,blend:this.enabled.has(this.BLEND),depthWrite:this.depthWrite});
  }
  drawArrays(type,start,count) { assert.equal(type,this.TRIANGLE_STRIP); this.recordDraw(start+count-1,count); }
  drawElements(type,count,indexType,offset) {
    assert.equal(type,this.TRIANGLES); assert.equal(indexType,this.UNSIGNED_SHORT);
    const indices=this.buffers.get(this.ELEMENT_ARRAY_BUFFER);
    assert.equal(offset,0); assert.equal(count*2,indices.bytes); this.recordDraw(indices.max,count);
    if (this.program.name==='pick') this.fbo.geometry.push({vertices:this.pointers.get(0).buf.data,indices:indices.data});
  }
  readPixels(x,y,w,h,format,type,pixel) {
    assert.deepEqual([x,y,w,h],[0,0,1,1]); assert.equal(this.fbo.color.width,1);
    const [vx,vy,vw,vh]=this.viewportBox;
    this.reads++;
    let id=this.options.pickId || 0;
    if (this.options.rasterPick) {
      const scale=Math.min(1,700/vw), rw=Math.round(vw*scale),rh=Math.round(vh*scale);
      const pose=this.program.uniforms;
      const image=rasterize(this.fbo.geometry,pose.u_camera,rw,rh,pose);
      id=Math.max(0,image.at((-vx+.5)/vw*rw,(1-(-vy+.5)/vh)*rh));
    }
    pixel.set([id,0,0,id ? 255 : 0]);
  }
  isContextLost() { return false; }
}
for (const type of ['Buffer','Texture','Shader','Renderbuffer','Framebuffer','Program']) {
  RecordingGL.prototype['delete'+type]=resource=>{ assert.ok(!resource.deleted); resource.deleted=true; };
}
module.exports={RecordingGL,shaderDeclarations,checkShader};
