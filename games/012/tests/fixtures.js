"use strict";
// A small recording DOM and WebGL contract double for Node integration tests.
// It validates data passed to WebGL and never opens a window or rasterizes pixels.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const project = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(project,"index.html"), "utf8");
const scriptPaths = Array.from(html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g), m => m[1]);
const scripts = scriptPaths.map(file => new vm.Script(fs.readFileSync(path.join(project,file),"utf8"), { filename: file }));

function declarations(source, qualifier) {
  const result = new Map();
  const regex = new RegExp("\\b" + qualifier + "\\s+(\\w+)\\s+([^;]+);","g");
  for (const match of source.matchAll(regex)) {
    for (const name of match[2].split(",")) result.set(name.trim(),match[1]);
  }
  return result;
}

class RecordingGL {
  constructor(options = {}) {
    this.options = options;
    const names = ("VERTEX_SHADER FRAGMENT_SHADER COMPILE_STATUS LINK_STATUS ARRAY_BUFFER ELEMENT_ARRAY_BUFFER "
      + "STATIC_DRAW DYNAMIC_DRAW FLOAT TRIANGLES UNSIGNED_SHORT TEXTURE_2D RGBA UNSIGNED_BYTE TEXTURE_WRAP_S TEXTURE_WRAP_T "
      + "REPEAT CLAMP_TO_EDGE TEXTURE_MAG_FILTER LINEAR TEXTURE_MIN_FILTER LINEAR_MIPMAP_LINEAR DEPTH_TEST "
      + "LEQUAL SRC_ALPHA ONE_MINUS_SRC_ALPHA ONE BLEND CULL_FACE POINTS TEXTURE0 TRIANGLE_STRIP LINE_LOOP "
      + "TRIANGLE_FAN LINE_STRIP LINES").split(" ");
    names.forEach((name, i) => { this[name] = i + 1; });
    this.COLOR_BUFFER_BIT = 0x4000; this.DEPTH_BUFFER_BIT = 0x0100;
    this.draws = []; this.buffers = []; this.programs = []; this.textures = [];
    this.uploads = 0;
    this.bindings = new Map(); this.attributes = new Map(); this.enabledAttributes = new Set();
    this.enabled = new Set(); this.current = null; this.texture = null;
  }
  createShader(type) { return { type }; }
  shaderSource(shader,source) { shader.source = source; }
  compileShader(shader) { shader.compiled = !this.options.badShader && /void\s+main\s*\(/.test(shader.source); }
  getShaderParameter(shader,flag) { assert.equal(flag,this.COMPILE_STATUS); return shader.compiled; }
  getShaderInfoLog() { return "test compile error"; }
  deleteShader(shader) { shader.deleted = true; }
  createProgram() {
    const p = { shaders: [], bindings: new Map(), values: new Map() };
    this.programs.push(p); return p;
  }
  attachShader(p,shader) { p.shaders.push(shader); }
  bindAttribLocation(p,index,name) { p.bindings.set(name,index); }
  linkProgram(p) {
    assert.equal(p.shaders.length,2);
    const [vs,fs] = p.shaders.map(s=>s.source);
    p.uniforms = declarations(vs + "\n" + fs,"uniform");
    p.attributes = declarations(vs,"attribute");
    p.linked = !this.options.badLink && p.shaders.every(s=>s.compiled);
  }
  getProgramParameter(p,flag) { assert.equal(flag,this.LINK_STATUS); return p.linked; }
  getProgramInfoLog() { return "test link error"; }
  deleteProgram(p) { p.deleted = true; }
  useProgram(p) { assert.ok(p.linked && !p.deleted); this.current = p; }
  getUniformLocation(p,name) {
    assert.ok(p.uniforms.has(name),"Unknown uniform " + name);
    return { p, name, type: p.uniforms.get(name) };
  }
  setUniform(location,type,value) {
    assert.equal(location.p,this.current);
    assert.equal(location.type,type,location.name);
    assert.ok(Array.from(value).every(Number.isFinite),"Non-finite " + location.name);
    this.current.values.set(location.name,value);
  }
  uniform1i(l,v) { this.setUniform(l,"sampler2D",[v]); }
  uniform1f(l,v) { this.setUniform(l,"float",[v]); }
  uniform2f(l,x,y) { this.setUniform(l,"vec2",[x,y]); }
  uniform3fv(l,v) { assert.equal(v.length,3); this.setUniform(l,"vec3",v); }
  uniform4fv(l,v) { assert.equal(v.length,4); this.setUniform(l,"vec4",v); }
  uniformMatrix4fv(l,transpose,v) { assert.equal(transpose,false); assert.equal(v.length,16); this.setUniform(l,"mat4",v); }
  createBuffer() { const b={}; this.buffers.push(b); return b; }
  bindBuffer(target,b) { this.bindings.set(target,b); }
  bufferData(target,data,usage) {
    this.uploads++;
    assert.ok(usage===this.STATIC_DRAW || usage===this.DYNAMIC_DRAW);
    assert.ok(ArrayBuffer.isView(data));
    const b=this.bindings.get(target); b.bytes=data.byteLength; b.size=data.length;
    if (usage===this.DYNAMIC_DRAW) b.data=new Float32Array(data);
    if (target===this.ELEMENT_ARRAY_BUFFER) b.max=data.reduce((max,k)=>Math.max(max,k),0);
  }
  bufferSubData(target,offset,data) {
    const b=this.bindings.get(target);
    assert.ok(b.data && offset>=0 && offset+data.byteLength<=b.bytes);
    b.data.set(data,offset/4);
    this.uploads++;
  }
  enableVertexAttribArray(index) { this.enabledAttributes.add(index); }
  disableVertexAttribArray(index) { this.enabledAttributes.delete(index); }
  vertexAttribPointer(index,size,type,normalized,stride,offset) {
    assert.equal(type,this.FLOAT);
    assert.equal(normalized,false);
    this.attributes.set(index,{ buffer:this.bindings.get(this.ARRAY_BUFFER), size,stride,offset });
  }
  createTexture() { const tex={}; this.textures.push(tex); return tex; }
  bindTexture(target,tex) { assert.equal(target,this.TEXTURE_2D); this.texture=tex; }
  texImage2D(target,level,format,w,h,border,format2,type,data) {
    assert.equal(target,this.TEXTURE_2D); assert.equal(format,this.RGBA); assert.equal(format2,this.RGBA);
    assert.equal(border,0); assert.equal(level,0); assert.equal(type,this.UNSIGNED_BYTE);
    assert.equal(data.byteLength,w*h*4);
    Object.assign(this.texture,{ w,h });
  }
  texParameteri() {}
  generateMipmap() {
    assert.equal(this.texture.w & (this.texture.w-1),0,"WebGL 1 mipmaps require power-of-two images");
    assert.equal(this.texture.h & (this.texture.h-1),0);
    this.texture.complete=true;
  }
  activeTexture(unit) { assert.equal(unit,this.TEXTURE0); }
  clearColor(...values) { this.background=values; }
  clear() {}
  enable(flag) { this.enabled.add(flag); }
  disable(flag) { this.enabled.delete(flag); }
  depthFunc() {}
  depthMask(write) { this.depthWrite=write; }
  blendFunc() {}
  blendFuncSeparate() {}
  viewport(x,y,w,h) { assert.ok(w>=1 && h>=1); this.viewportSize=[w,h]; }
  draw(mode,count,maxIndex) {
    const p=this.current;
    assert.ok(p && Number.isInteger(count) && count>0);
    assert.ok([this.TRIANGLES,this.TRIANGLE_STRIP,this.TRIANGLE_FAN,this.POINTS,this.LINES,this.LINE_LOOP,this.LINE_STRIP].includes(mode),
      "Unrecognized draw primitive");
    for (const [name,type] of p.uniforms) {
      assert.ok(p.values.has(name),"Unset uniform " + name);
      if (type==="sampler2D") assert.ok(this.texture?.complete,"Incomplete sampler");
    }
    for (const [name,type] of p.attributes) {
      const index=p.bindings.get(name);
      assert.ok(this.enabledAttributes.has(index),"Unbound " + name);
      const attr=this.attributes.get(index);
      assert.equal(attr.size,Number(type.slice(-1)));
      assert.ok(attr.offset+maxIndex*attr.stride+attr.size*4<=attr.buffer.bytes,"Attribute fetch outside buffer");
    }
    this.draws.push({mode,count,prog:p,vp:p.values.get("uVP"),model:p.values.get("uModel"),
      light:p.values.get("uLight"),tint:p.values.get("uTint"),eyepiece:p.values.get("uEyepiece")?.[0],depth:this.enabled.has(this.DEPTH_TEST),
      write:this.depthWrite,blend:this.enabled.has(this.BLEND),vertex:this.attributes.get(0).buffer});
  }
  drawArrays(mode,start,count) { this.draw(mode,count,start+count-1); }
  drawElements(mode,count,type,offset) {
    const indices=this.bindings.get(this.ELEMENT_ARRAY_BUFFER);
    assert.equal(type,this.UNSIGNED_SHORT); assert.equal(offset,0); assert.ok(count<=indices.size);
    this.draw(mode,count,indices.max);
  }
}

class Events {
  constructor() { this.handlers=new Map(); }
  addEventListener(type,handler) {
    if (!this.handlers.has(type)) this.handlers.set(type,[]);
    this.handlers.get(type).push(handler);
  }
  emit(type,properties={}) {
    const event={ type,target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...properties };
    for (const handler of this.handlers.get(type)||[]) handler(event);
    return event;
  }
}

class MemoryStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class Element extends Events {
  constructor(tag,doc) {
    super(); this.tagName=tag.toUpperCase(); this.doc=doc; this.attrs=new Map(); this.children=[];
    this.hidden=false; this.open=false; this.disabled=false; this.textContent=""; this.className=""; this.value="";
    this.clientWidth=900; this.clientHeight=450; this.width=300; this.height=150;
    const tokens=()=>this.className.split(/\s+/).filter(Boolean);
    this.classList={
      add:(...items)=>{this.className=[...new Set([...tokens(),...items])].join(" ");},
      remove:(...items)=>{this.className=tokens().filter(n=>!items.includes(n)).join(" ");},
      contains:item=>tokens().includes(item),
      toggle:(item,value)=>{const yes=value ?? !tokens().includes(item); this.classList[yes?"add":"remove"](item); return yes;}
    };
    this.style={setProperty(key,value){this[key]=value;}};
  }
  setAttribute(key,value) { this.attrs.set(key,String(value)); }
  getAttribute(key) { return this.attrs.get(key) ?? null; }
  append(...nodes) { for (const node of nodes) {node.parent=this;this.children.push(node);} }
  replaceChildren(...nodes) { this.children.forEach(node=>{node.parent=null;}); this.children=[]; this.append(...nodes); }
  focus() { this.doc.activeElement=this; }
  matches() { return ["INPUT","SELECT","TEXTAREA"].includes(this.tagName); }
  closest(tag) { return this.tagName===tag.toUpperCase()?this:this.parent?.closest(tag); }
  setPointerCapture(id) { this.capture=id; }
  getBoundingClientRect() { return {left:0,top:0,right:this.clientWidth,bottom:this.clientHeight,width:this.clientWidth,height:this.clientHeight}; }
  showModal() { this.open=true; }
  close() { this.open=false;this.emit("close"); }
  click() { if (!this.disabled) this.emit("click"); }
  toDataURL(type) { assert.equal(type,"image/png"); assert.ok(this.gl?.draws.length); return "data:image/png;base64,AA=="; }
  getContext(type,options) {
    assert.equal(type,"webgl"); this.contextOptions=options;
    const unavailable=this.doc.options.offline || (this.id==="portrait" && this.doc.options.noPortrait);
    if (unavailable) return null;
    this.gl ||= new RecordingGL(this.doc.options);
    return this.gl;
  }
}

function environment(options={}) {
  const doc=new Events(), win=new Events(), elements=new Map();
  doc.options=options; doc.body=new Element("body",doc); doc.activeElement=doc.body; doc.hidden=false;
  doc.createElement=tag=>new Element(tag,doc);
  for (const match of html.matchAll(/<([a-z][\w-]*)\s+([^>]*?\bid="([^"]+)"[^>]*)>/gi)) {
    const el=doc.createElement(match[1]), attrs=match[2];
    el.id=match[3];
    for (const a of attrs.matchAll(/([\w-]+)="([^"]*)"/g)) el.setAttribute(a[1],a[2]);
    el.className=el.getAttribute("class")||""; el.hidden=/\bhidden(?:\s|$)/.test(attrs);
    elements.set(el.id,el);
  }
  doc.getElementById=id=>{assert.ok(elements.has(id),"Missing HTML element " + id); return elements.get(id);};
  const get=id=>doc.getElementById(id);
  get("specimen").clientWidth=236; get("specimen").clientHeight=148;
  const frames=new Map(); let sequence=0;
  win.document=doc; win.devicePixelRatio=options.ratio||1; win.messages=[];
  if (options.storage) win.localStorage=options.storage;
  if (options.denyStorage) Object.defineProperty(win,"localStorage",{get(){throw new Error("Storage denied");}});
  win.console={warn:(...message)=>win.messages.push(message)};
  win.location={reloads:0,reload(){this.reloads++;}};
  win.requestAnimationFrame=fn=>{frames.set(++sequence,fn);return sequence;};
  win.cancelAnimationFrame=id=>frames.delete(id);
  const observers=[];
  win.ResizeObserver=class {
    constructor(fn){this.fn=fn;this.nodes=[];observers.push(this);}
    observe(node){this.nodes.push(node);}
  };
  const frame=time=>{
    const callbacks=[...frames.values()]; frames.clear();
    callbacks.forEach(fn=>fn(time));
    return callbacks.length;
  };
  const resize=(id,w,h)=>{
    const node=get(id); node.clientWidth=w;node.clientHeight=h;
    if (id==="stage") {get("space").clientWidth=w; get("space").clientHeight=h;}
    for (const obs of observers) if (obs.nodes.includes(node)) obs.fn([{target:node}]);
  };
  const key=(key,properties={})=>doc.emit("keydown",{key,target:doc.body,...properties});
  return { win,doc,get,frame,frames,key,resize };
}

function application(options={}) {
  const page=environment(options);
  if (options.classic) {
    const context=vm.createContext(page.win);
    for (const script of scripts) script.runInContext(context);
  } else require("../js/app.js").mount(page.doc,page.win);
  return page;
}
module.exports={ html,project,scriptPaths,declarations,RecordingGL,MemoryStorage,environment,application };
