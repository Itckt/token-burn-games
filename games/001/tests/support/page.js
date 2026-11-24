'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {RecordingGL, Recording2D} = require('./graphics.js');
const {RecordingAudio} = require('./audio.js');
const root = path.resolve(__dirname,'../..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);

class Events {
  constructor() { this.events=new Map(); }
  addEventListener(type,fn) {
    if (!this.events.has(type)) this.events.set(type,[]);
    this.events.get(type).push(fn);
  }
  emit(type, fields={}) {
    const e={target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...fields,type};
    for (const fn of this.events.get(type)||[]) fn(e);
    return e;
  }
}
class Element extends Events {
  constructor(tag,doc) {
    super();
    this.tag=tag; this.ownerDocument=doc;
    this.children=[]; this.attributes={}; this.dataset={}; this.style={};
    this.textContent=''; this.hidden=false; this.disabled=false; this.open=false;
    this.clientWidth=300; this.clientHeight=150; this.width=300; this.height=150;
    this.left=0; this.top=0;
    this.captures=new Set();
    this.classList=new Set();
    this.classList.remove=name=>this.classList.delete(name);
    this.classList.toggle=(name,on)=>on?this.classList.add(name):this.classList.delete(name);
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children=[...nodes]; }
  setAttribute(key,value) {
    this.attributes[key]=String(value);
    if (key==='class') String(value).split(/\s+/).forEach(c=>this.classList.add(c));
    if (key.startsWith('data-')) this.dataset[key.slice(5)]=value;
    if (key==='hidden' || key==='disabled') this[key]=true;
    if (key==='id') this.id=value;
    if (key==='width' || key==='height') this[key]=Number(value);
  }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  set href(value) { this.setAttribute('href',value); }
  get href() { return this.getAttribute('href'); }
  querySelectorAll(selector) {
    const matches=el=>selector.startsWith('.')?el.classList.has(selector.slice(1)):el.tag===selector;
    return this.children.flatMap(el=>[...(matches(el)?[el]:[]),...el.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0]; }
  focus() { this.ownerDocument.activeElement=this; }
  showModal() { this.beforeModal=this.ownerDocument.activeElement; this.open=true; }
  close() { this.open=false; this.beforeModal?.focus(); this.emit('close'); }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) {
    if (this.captures.delete(id)) this.emit('lostpointercapture',{pointerId:id});
  }
  getBoundingClientRect() {
    return {left:this.left,top:this.top,width:this.clientWidth,height:this.clientHeight,
      right:this.left+this.clientWidth,bottom:this.top+this.clientHeight};
  }
  getContext(kind) {
    if (kind==='2d') return this.pen ??= new Recording2D();
    if (kind==='webgl' || kind==='experimental-webgl') return this.ownerDocument.getGL();
    throw Error('Unexpected context '+kind);
  }
  toBlob(callback,type) { this.ownerDocument.encode(this,callback,type); }
}

// Load controls from the actual markup so a missing ID or changed nesting breaks the test.
function controls(doc) {
  const ids=new Map(), stack=[];
  const voids=new Set(['meta','link','br','hr','img','input']);
  for (const token of html.match(/<[^>]+>|[^<]+/g)) {
    const tag=token.match(/^<(\/?)([\w-]+)([^>]*)>/);
    if (!tag) {
      if (!token.startsWith('<') && stack.length) stack.at(-1).textContent+=token;
      continue;
    }
    if (tag[1]) { stack.pop(); continue; }
    const el=new Element(tag[2],doc);
    for (const attr of tag[3].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) {
      el.setAttribute(attr[1],attr[2] ?? '');
    }
    if (el.id) { assert.ok(!ids.has(el.id),'duplicate id '+el.id); ids.set(el.id,el); }
    if (stack.length) stack.at(-1).append(el);
    if (tag[2]==='body') doc.body=el;
    if (tag[2]==='html') doc.documentElement=el;
    if (!voids.has(tag[2]) && !tag[3].endsWith('/')) stack.push(el);
  }
  return ids;
}

function page(options={}) {
  const doc=new Events(),win=new Events(),gl=new RecordingGL(options);
  doc.defaultView=win; doc.hidden=false; doc.pointerLockElement=null;
  doc.createElement=tag=>new Element(tag,doc);
  doc.getGL=()=>options.webgl===false?null:gl;
  const encodings=[],urls=new Map(),audioContexts=[];
  doc.encode=(sheet,callback,type)=>{
    assert.equal(type,'image/png');
    const blob={type,width:sheet.width,height:sheet.height};
    encodings.push({sheet,blob,callback});
    if (!options.holdPNG) queueMicrotask(()=>callback(blob));
  };
  let urlSerial=0;
  win.URL={
    createObjectURL(blob) {
      if (options.denyURL) throw Error('object URL unavailable');
      const url='blob:local/'+(++urlSerial);
      urls.set(url,blob);
      return url;
    },
    revokeObjectURL(url) { assert.ok(urls.delete(url),'object URL released once'); }
  };
  if (options.audio) win.AudioContext=class extends RecordingAudio {
    constructor() { super(options.audio); audioContexts.push(this); }
  };
  const ids=controls(doc);
  const id=key=>ids.get(key);
  doc.getElementById=id;
  doc.activeElement=doc.body;
  const canvas=id('campus');
  Object.assign(canvas,{clientWidth:1280,clientHeight:700});
  Object.assign(id('mini-map'),{clientWidth:195,clientHeight:130});
  Object.assign(id('guide-map'),{clientWidth:330,clientHeight:246,left:100,top:80});
  let lockRequests=0;
  canvas.requestPointerLock=()=>{
    lockRequests++;
    if (options.lock==='deny') return Promise.reject(Error('pointer lock denied'));
    if (options.lock==='pending') return;
    doc.pointerLockElement=canvas;
    doc.emit('pointerlockchange');
  };
  doc.exitPointerLock=()=>{ doc.pointerLockElement=null; doc.emit('pointerlockchange'); };
  win.devicePixelRatio=options.dpr || 1;
  const stored = options.storage || new Map();
  Object.defineProperty(win,'localStorage',{get() {
    if (options.denyStorage) throw Error('storage denied');
    return {
      getItem: key => stored.get(key) ?? null,
      setItem(key,value) {
        if (options.storageFull) throw Error('storage full');
        stored.set(key,String(value));
      }
    };
  }});
  const preferences=new Map();
  win.matchMedia=query=>{
    if (!preferences.has(query)) {
      const pref=new Events();
      pref.matches=query.includes('reduced')?!!options.reduced:!!options.coarse;
      preferences.set(query,pref);
    }
    return preferences.get(query);
  };
  const frames=new Map(),timers=new Map(),errors=[];
  let serial=0,now=0;
  const context=vm.createContext({
    document:doc,window:win,console:{error:(...args)=>errors.push(args)},
    requestAnimationFrame:cb=>{ frames.set(++serial,cb); return serial; },
    cancelAnimationFrame:n=>frames.delete(n),
    setTimeout:(cb,ms)=>{ timers.set(++serial,{cb,due:now+ms}); return serial; },
    clearTimeout:n=>timers.delete(n)
  });
  function tick(milliseconds=1000/60) {
    now+=milliseconds;
    for (const [n,t] of timers) if (t.due<=now) { timers.delete(n); t.cb(); }
    const pending=[...frames.values()];
    frames.clear();
    pending.forEach(cb=>cb(now));
  }
  function settle() {
    for (let i=0; frames.size && i<360; i++) tick();
    assert.equal(frames.size,0,'animation should settle at rest');
  }
  return {doc,win,gl,canvas,id,frames,context,errors,tick,settle,encodings,urls,audioContexts,
    get locks(){return lockRequests;},
    boot(){
      for (const file of scripts) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context,{filename:file});
      return this;
    },
    key(code,fields={}){
      return doc.emit('keydown',{key:code,code,target:doc.activeElement,...fields});
    },
    up(code){return doc.emit('keyup',{key:code,code,target:doc.activeElement});},
    uniform(name){
      const draw=gl.draws.findLast(d=>Object.hasOwn(gl.programs[d.program].uniforms,name));
      return draw && gl.programs[draw.program].uniforms[name];
    }
  };
}
module.exports={page,html,root,scripts};
