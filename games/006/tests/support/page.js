'use strict';
// A narrow, in-process host for the page's DOM events and drawing calls.
// All application scripts still execute in their actual HTML order.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname,'../..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const html = read('index.html');
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(match=>match[1]);

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type,listener) {
    if (!this.listeners.has(type)) this.listeners.set(type,[]);
    this.listeners.get(type).push(listener);
  }
  fire(type,details={}) {
    const e = { type, target:this, defaultPrevented:false, preventDefault(){this.defaultPrevented=true;}, ...details };
    e.done = Promise.all((this.listeners.get(type)||[]).map(fn=>fn(e)));
    return e;
  }
}

class Drawing2D {
  constructor(canvas,host) { this.canvas=canvas; this.host=host; }
  createImageData(w,h) { return {data:new Uint8ClampedArray(w*h*4)}; }
  putImageData(image) {
    let sum=0;
    for(let i=0;i<image.data.length;i+=1024) sum+=image.data[i];
    this.host.grain.push(sum);
  }
  drawImage(tile,x,y) { this.host.tiles.push({x,y,width:tile.width,height:tile.height}); }
  fillText(text) { this.host.lettering.push(text); }
  createLinearGradient() { return {addColorStop(){}}; }
  stroke(path) {
    if(path) this.host.icons.push({name:this.canvas.dataset.icon,path:path.d});
    else if(this.path) this.host.lines.push({points:this.path.slice(),dash:this.dash,ink:this.strokeStyle});
  }
  beginPath() { if(this.canvas.getAttribute('id')==='trace-plot') this.path=[]; }
  moveTo(x,y) { this.path?.push([x,y]); }
  lineTo(x,y) { this.path?.push([x,y]); }
  setLineDash(dash) { this.dash=[...dash]; }
  fillRect() {} strokeRect() {}
  fill() {} arc() {} closePath() {} save() {} restore() {} scale() {}
}

class Element extends Events {
  constructor(tag,host) {
    super();
    this.tagName=tag; this.host=host; this.children=[]; this.attrs={}; this.dataset={}; this.style={};
    this.classes=new Set(); this.text=''; this.open=false; this.hidden=false; this.disabled=false;
    this.classList={
      contains:n=>this.classes.has(n), add:n=>this.classes.add(n), remove:n=>this.classes.delete(n),
      toggle:(n,on)=>{ if(on) this.classes.add(n); else this.classes.delete(n); }
    };
    this.clientWidth=18; this.clientHeight=18; this.width=300; this.height=150;
  }
  set className(value) { this.classes=new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  set textContent(value) { this.children=[]; this.text=String(value); }
  get textContent() { return this.text+this.children.map(child=>child.textContent).join(''); }
  append(...children) { for(const child of children) { child.parent=this; this.children.push(child); } }
  setAttribute(name,value) {
    this.attrs[name]=String(value);
    if(name==='class') this.className=value;
    if(name==='id') this.host.ids.set(value,this);
    if(name==='hidden') this.hidden=true;
    if(name.startsWith('data-')) this.dataset[name.slice(5)]=value;
  }
  getAttribute(name) { return this.attrs[name]??null; }
  removeAttribute(name) { delete this.attrs[name]; }
  closest(tag) { return this.tagName===tag ? this : this.parent?.closest(tag) || null; }
  querySelectorAll(selector) {
    const result=[];
    for(const el of this.children) {
      if(selector===el.tagName || (selector.startsWith('[data-') && selector.slice(6,-1) in el.dataset)) result.push(el);
      result.push(...el.querySelectorAll(selector));
    }
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0]||null; }
  getContext(kind,options) {
    if(kind==='webgl') { this.host.contextRequests.push({kind,options}); return this.host.gl; }
    if(kind==='2d') { this.drawing ||= new Drawing2D(this,this.host); return this.drawing; }
    return null;
  }
  getBoundingClientRect() { return {left:0,top:0,right:this.clientWidth,bottom:this.clientHeight,width:this.clientWidth,height:this.clientHeight}; }
  focus() { this.host.document.activeElement=this; }
  setPointerCapture(id) { this.pointerId=id; }
  hasPointerCapture(id) { return this.pointerId===id; }
  releasePointerCapture() { this.pointerId=null; }
  showModal() { this.open=true; }
  close() { this.open=false; this.fire('close'); }
}

function parseMarkup(doc,host) {
  const stack=[doc];
  for(const [token] of html.matchAll(/<![^>]*>|<\/?[\w-]+[^>]*>|[^<]+/g)) {
    if(token.startsWith('<!')) continue;
    if(token.startsWith('</')) { stack.pop(); continue; }
    if(!token.startsWith('<')) { stack.at(-1).text+=token; continue; }
    const tag=token.match(/^<([\w-]+)/)[1];
    const el=new Element(tag,host);
    for(const [,key,value] of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) el.setAttribute(key,value??'');
    stack.at(-1).append(el);
    if(!['meta','link','br','hr','img','input'].includes(tag)) stack.push(el);
  }
}

function makePage(options={}) {
  const host={ids:new Map(),gl:options.gl||null,contextRequests:[],icons:[],tiles:[],grain:[],lettering:[],samples:[],lines:[]};
  const doc=new Element('document',host); host.document=doc;
  parseMarkup(doc,host);
  doc.createElement=tag=>new Element(tag,host); doc.getElementById=id=>host.ids.get(id)||null;
  doc.documentElement=doc.children[0]; doc.activeElement=doc; doc.hidden=false; doc.fullscreenElement=null;
  doc.fullscreenEnabled=options.fullscreen!==false;
  doc.documentElement.requestFullscreen=async()=>{
    if(options.fullscreenError) throw new Error('denied');
    doc.fullscreenElement=doc.documentElement; doc.fire('fullscreenchange');
  };
  doc.exitFullscreen=async()=>{ doc.fullscreenElement=null; doc.fire('fullscreenchange'); };
  const scene=doc.getElementById('scene');
  scene.clientWidth=options.width||960; scene.clientHeight=options.height||450;
  const frames=new Map(), timers=new Map();
  let next=0,now=0;
  const win=new Events();
  Object.assign(win,{window:win,document:doc,devicePixelRatio:options.dpr||1,AudioContext:options.AudioContext,
    getComputedStyle:()=>({color:'#dde2da'}),Path2D:class {constructor(d){this.d=d;}},
    requestAnimationFrame:fn=>{ const id=++next; frames.set(id,fn); return id; },
    cancelAnimationFrame:id=>frames.delete(id),
    setTimeout:(fn,delay)=>{const id=++next;timers.set(id,{at:now+delay,fn});return id;},
    clearTimeout:id=>timers.delete(id)
  });
  const context=vm.createContext(win);
  for(const file of scripts) {
    if(file==='js/app.js' && options.app===false) break;
    vm.runInContext(read(file),context,{filename:file});
    if(file==='js/renderer.js' && options.capture!==false) {
      win.Nightline.renderer.createRenderer=()=>({
        render:(s,c,traffic)=>host.samples.push({ride:structuredClone(s),camera:{...c},traffic:structuredClone(traffic)}), cancelPreparation(){}
      });
    }
  }
  function run(count=1,ms=1000/60) {
    for(let i=0;i<count;i++) {
      now+=ms;
      for(const [id,timer] of timers) if(timer.at<=now) {timers.delete(id);timer.fn();}
      const ready=[...frames.values()]; frames.clear();
      ready.forEach(fn=>fn(now));
    }
  }
  const id=name=>doc.getElementById(name);
  const button=action=>doc.querySelectorAll('[data-action]').find(el=>el.dataset.action===action && el.classList.contains('drive-control'));
  function key(code,type='keydown',props={}) { return win.fire(type,{code,target:doc.activeElement,...props}); }
  return { ...host,win,doc,id,scene,frames,run,key,button,api:win.Nightline };
}
module.exports={makePage,read,root,html,scripts};
