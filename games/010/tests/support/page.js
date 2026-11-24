'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const {RecordingGL}=require('./graphics');

const root=path.resolve(__dirname,'../..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=Array.from(html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g),m=>m[1]);
const sources=scripts.map(name=>new vm.Script(fs.readFileSync(path.join(root,name),'utf8'),{filename:name}));

class Events {
  constructor() { this.listeners=new Map(); }
  addEventListener(name,fn) {
    if (!this.listeners.has(name)) this.listeners.set(name,[]);
    this.listeners.get(name).push(fn);
  }
  emit(type,props={}) {
    const event={type,target:this,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...props};
    for (let target=this;target;target=target.parent) {
      for (const fn of target.listeners.get(type)||[]) fn(event);
    }
    return event;
  }
}

// The real artwork uses a small SVG path vocabulary on local 2D canvases.
class PrintPath {
  constructor(d) {
    const arity={M:2,L:2,Q:4,C:6,H:1,V:1,S:4,T:2,A:7,Z:0};
    const numbers=/-?(?:\d+(?:\.\d*)?|\.\d+)/g;
    const instructions=[...d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)];
    assert.ok(instructions.length && instructions[0][1].toUpperCase()==='M');
    for (const [,command,args] of instructions) {
      const size=arity[command.toUpperCase()],values=args.match(numbers)||[];
      assert.ok(size!==undefined,'known path command '+command);
      assert.equal(args.replace(numbers,'').replace(/[\s,]/g,''),'');
      assert.ok(size ? values.length>=size && values.length%size===0 : !values.length,'path arity: '+command+' '+args);
    }
    this.d=d;
  }
}
class Paper {
  constructor() { this.depth=0; this.commands=[]; this.texts=[]; this.colors=new Set(); }
  save() { this.depth++; }
  restore() { assert.ok(this.depth>0,'balanced canvas state'); this.depth--; }
  createLinearGradient() { return {addColorStop:(n,color)=>{assert.ok(n>=0 && n<=1); this.colors.add(color);}}; }
  measureText(text) {
    const size=Number(this.font.match(/([\d.]+)px/)[1]);
    return {width:Array.from(text).reduce((w,ch)=>w+size*(ch===' ' ? .28 : .55),0)};
  }
  fillText(text,...args) { this.texts.push(text); this.record('fillText',[text,...args]); }
  record(op,args) {
    assert.ok(args.every(n=>typeof n!=='number' || Number.isFinite(n)),op+' has finite coordinates');
    if (typeof this.fillStyle==='string') this.colors.add(this.fillStyle);
    this.commands.push([op,...args.map(a=>a instanceof PrintPath ? a.d : a)]);
  }
}
for (const op of ['beginPath','closePath','moveTo','lineTo','quadraticCurveTo','ellipse','arc','fill','stroke',
  'fillRect','clearRect','strokeRect','translate','rotate','scale','setLineDash','rect','clip','drawImage']) {
  Paper.prototype[op]=function (...args) { this.record(op,args); };
}

class Element extends Events {
  constructor(doc,tag) {
    super(); this.ownerDocument=doc; this.tag=tag; this.children=[]; this.attrs={}; this.dataset={};
    this.className=''; this.style={}; this.textContent=''; this.hidden=false; this.disabled=false;
    this.captures=new Set(); this.width=300; this.height=150;
    this.classList={toggle:(name,force)=>{
      const classes=new Set(this.className.split(/\s+/).filter(Boolean));
      if (force) classes.add(name); else classes.delete(name);
      this.className=[...classes].join(' ');
    }};
  }
  setAttribute(key,v) {
    this.attrs[key]=String(v);
    if (key==='class') this.className=String(v);
    if (key==='id') { this.id=v; this.ownerDocument.ids.set(v,this); }
    if (key==='hidden') this.hidden=true;
    if (key==='value') this.value=String(v);
    if (key==='width' || key==='height') this[key]=Number(v);
  }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  append(...nodes) { for (const n of nodes) { this.children.push(n); n.parent=this; } }
  replaceChildren(...nodes) {
    for (const n of this.children) n.parent=null;
    this.children=[]; this.append(...nodes);
  }
  click() {
    if (this.disabled) return;
    for (let n=this;n;n=n.parent) if (n.inert || n.hidden) return;
    this.emit('click');
  }
  focus() { this.ownerDocument.activeElement=this; }
  setPointerCapture(id) { this.captures.add(id); }
  hasPointerCapture(id) { return this.captures.has(id); }
  releasePointerCapture(id) { this.captures.delete(id); this.emit('lostpointercapture',{pointerId:id}); }
  showModal() {
    this.open=true;
    const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
    const nodes=descendants(this);
    (nodes.find(n=>n.getAttribute('autofocus')!==null) || nodes.find(n=>n.tag==='button'))?.focus();
  }
  close() { this.open=false; this.emit('close'); }
  getBoundingClientRect() { return this.ownerDocument.rect; }
  toBlob(callback,type) {
    assert.equal(this.tag,'canvas'); assert.equal(type,'image/png');
    const doc=this.ownerDocument;
    const encoding={canvas:this,type,complete:(blob={type})=>callback(blob)};
    doc.encodings.push(encoding);
    if (!doc.options.deferEncoding) encoding.complete();
  }
  getContext(type) {
    assert.equal(this.tag,'canvas');
    if (type==='2d') { this.paper ||= new Paper(); return this.paper; }
    assert.equal(type,'webgl');
    const doc=this.ownerDocument;
    if (doc.options.noWebGL) return null;
    doc.gl ||= new RecordingGL(this,doc.options);
    return doc.gl;
  }
}
class Document extends Events {
  constructor(options) {
    super(); this.options=options; this.ids=new Map(); this.elements=[]; this.encodings=[];
    this.rect={left:37,top:178,width:810,height:455,right:847,bottom:633};
    this.hidden=false;
    const stack=[this];
    for (const match of html.matchAll(/<[^>]+>|[^<]+/g)) {
      const token=match[0];
      if (token.startsWith('<!')) continue;
      if (token.startsWith('</')) { stack.pop(); continue; }
      if (!token.startsWith('<')) {
        if (stack.at(-1) instanceof Element) stack.at(-1).textContent+=token;
        continue;
      }
      const tag=token.match(/^<([\w-]+)/)[1],node=this.createElement(tag);
      for (const [,key,v] of token.slice(tag.length+1,-1).matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) {
        node.setAttribute(key,v ?? '');
      }
      if (stack.at(-1)===this) node.parent=this; else stack.at(-1).append(node);
      if (tag==='body') this.body=node;
      if (!token.endsWith('/>') && !['br','meta','link','input'].includes(tag)) stack.push(node);
    }
    this.activeElement=this.body;
  }
  createElement(tag) { const node=new Element(this,tag); this.elements.push(node); return node; }
  getElementById(id) { return this.ids.get(id)||null; }
  querySelectorAll(selectors) {
    const names=selectors.split(',').map(s=>s.trim().slice(1));
    return this.elements.filter(n=>n.className.split(/\s/).some(name=>names.includes(name)));
  }
}
class Window extends Events {
  constructor(options) {
    super(); this.frames=new Map(); this.serial=0; this.now=0;
    this.devicePixelRatio=options.dpr || 1.5;
    this.AudioContext=options.AudioContext;
    const saved=new Map();
    this.blobs=new Map();
    let urlSerial=0;
    this.URL={
      createObjectURL:blob=>{
        assert.equal(blob.type,'image/png');
        const url='blob:test/'+(++urlSerial);
        this.blobs.set(url,blob); return url;
      },
      revokeObjectURL:url=>assert.ok(this.blobs.delete(url),'release a live postcard URL')
    };
    this.localStorage=options.storage ?? {
      getItem:key=>saved.get(key) ?? null,
      setItem:(key,value)=>saved.set(key,String(value))
    };
    this.motion=Object.assign(new Events(),{matches:Boolean(options.reduced)});
    this.compact=Object.assign(new Events(),{matches:Boolean(options.compact)});
    this.ResizeObserver=class { constructor(fn){this.fn=fn;} observe(target){target.resize=this.fn;} };
  }
  matchMedia(query) { return query.includes('reduced-motion') ? this.motion : this.compact; }
  requestAnimationFrame(fn) { const id=++this.serial; this.frames.set(id,fn); return id; }
  cancelAnimationFrame(id) { this.frames.delete(id); }
  tick(dt=1000/60) {
    this.now+=dt; const callbacks=[...this.frames.values()]; this.frames.clear();
    for (const fn of callbacks) fn(this.now);
  }
}
function openPage(options={}) {
  const doc=new Document(options),win=new Window(options),errors=[];
  const context=vm.createContext({document:doc,window:win,Path2D:PrintPath,console:{error:(...args)=>errors.push(args)}});
  for (const script of sources) script.runInContext(context);
  return {doc,win,gl:doc.gl,context,errors,$:id=>doc.getElementById(id)};
}
function pointer(page,type,x,y,id=1,device='mouse') {
  return page.$('scene').emit(type,{clientX:x,clientY:y,pointerId:id,pointerType:device,button:0});
}
function tap(page,x,y) { pointer(page,'pointerdown',x,y); pointer(page,'pointerup',x,y); }
function ticks(page,n=12) { for (let i=0;i<n;i++) page.win.tick(); }
function key(page,key,extra={}) { return page.$('scene').emit('keydown',{key,...extra}); }
function surface(page) {
  return page.doc.gl.resources.find(r=>r.kind==='program' && r.name==='surface' && !r.deleted).uniforms;
}
module.exports={root,html,scripts,openPage,pointer,tap,ticks,key,surface};
