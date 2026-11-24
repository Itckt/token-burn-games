"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { Graphics } = require("./graphics-double.js");

const root = path.resolve(__dirname,"..");
const html = fs.readFileSync(path.join(root,"index.html"),"utf8");
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)].map(m=>m[1]);

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type,fn) {
    if (!this.listeners.has(type)) this.listeners.set(type,[]);
    this.listeners.get(type).push(fn);
  }
  emit(type,values={}) {
    const e = {target:this,defaultPrevented:false,preventDefault(){ this.defaultPrevented=true; },...values};
    for (const fn of this.listeners.get(type) || []) fn(e);
    return e;
  }
}
function drawing2D() {
  const ctx = {calls:0};
  for (const name of ["beginPath","closePath","fill","stroke","setTransform","moveTo","lineTo","arc",
    "fillRect","strokeRect","drawImage","fillText"]) {
    ctx[name] = (...args) => {
      for (const n of args) if (typeof n==="number") assert.ok(Number.isFinite(n),"finite 2D coordinate");
      ctx.calls++;
    };
  }
  return ctx;
}
class Element extends Events {
  constructor(tag,doc) {
    super();
    this.tagName=tag.toUpperCase(); this.doc=doc;
    this.children=[]; this.attributes=new Map(); this.style={}; this.dataset={};
    this._text=""; this.className=""; this.hidden=false; this.disabled=false;
    this.classList={
      toggle:(name,on) => {
        const names=new Set(this.className.split(/\s+/).filter(Boolean));
        if (on) names.add(name); else names.delete(name);
        this.className=[...names].join(" ");
      }
    };
    this.width=300; this.height=150;
  }
  get textContent() { return this._text + this.children.map(c=>c.textContent).join(""); }
  set textContent(value) { this.replaceChildren(); this._text=String(value); }
  setAttribute(name,value) {
    this.attributes.set(name,value);
    if (name==="id") {
      assert.ok(!this.doc.ids.has(value),"duplicate HTML id "+value);
      this.id=value; this.doc.ids.set(value,this);
    } else if (name==="data-icon") this.dataset.icon=value;
    else if (name==="class") this.className=value;
    else if (name==="hidden") this.hidden=true;
    else if (name==="title") this.title=value;
    else if (name==="height" || name==="width") this[name]=Number(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { for (const n of nodes) { n.remove(); this.children.push(n); n.parent=this; } }
  prepend(node) { node.remove(); this.children.unshift(node); node.parent=this; }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this),1);
    this.parent=null;
  }
  replaceChildren(...nodes) {
    this.children.forEach(n=>{ n.parent=null; });
    this.children=[]; this._text=""; this.append(...nodes);
  }
  focus() { this.doc.activeElement=this; }
  matches(selector) {
    if (selector.includes(",")) return selector.split(",").some(s=>this.matches(s.trim()));
    if (selector==="canvas[data-icon]") return this.tagName==="CANVAS" && Boolean(this.dataset.icon);
    if (selector.startsWith(".")) return this.className.split(/\s+/).includes(selector.slice(1));
    return this.tagName===selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const out=[];
    function walk(node) {
      for (const child of node.children) {
        if (child.matches(selector)) out.push(child);
        walk(child);
      }
    }
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get clientWidth() { return this.doc.options.width; }
  get clientHeight() { return this.doc.options.height; }
  getBoundingClientRect() { return {left:12,top:69,width:this.clientWidth,height:this.clientHeight}; }
  getContext(type) {
    assert.equal(this.tagName,"CANVAS");
    if (type==="2d") {
      if (this.gl) return null;
      return this.ink ||= drawing2D();
    }
    assert.ok(type==="webgl" || type==="experimental-webgl");
    if (this.ink || this.doc.options.noWebGL) return null;
    if (!this.gl) {
      this.gl = new Graphics(this.doc.options);
      this.doc.graphics.push(this.gl);
    }
    return this.gl;
  }
  setPointerCapture(id) { this.captured=id; }
  hasPointerCapture(id) { return this.captured===id; }
  releasePointerCapture(id) { if (this.captured===id) this.captured=null; }
}
class Document extends Events {
  constructor(options) {
    super();
    this.options=options; this.ids=new Map(); this.hidden=false; this.graphics=[];
    this.root=this.createElement("document"); this.activeElement=this.root;
    // Parse the static element tree so missing files, selectors and nesting surface in the tests.
    const stack=[this.root];
    for (const token of html.match(/<[^>]+>|[^<]+/g)) {
      if (token.startsWith("<!")) continue;
      if (token.startsWith("</")) {
        assert.equal(stack.pop().tagName,token.slice(2,-1).toUpperCase());
      } else if (token.startsWith("<")) {
        const tag=token.match(/^<([\w-]+)/)[1], node=this.createElement(tag);
        for (const [,key,value] of token.slice(tag.length+1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
          node.setAttribute(key,value ?? "");
        }
        stack.at(-1).append(node);
        if (!["meta","link","br","hr","img","input"].includes(tag)) stack.push(node);
      } else stack.at(-1)._text+=token;
    }
    assert.equal(stack.length,1);
  }
  createElement(tag) { return new Element(tag,this); }
  getElementById(id) { return this.ids.get(id) || null; }
  querySelectorAll(s) { return this.root.querySelectorAll(s); }
}
function audioDouble(stats) {
  const parameter=()=>({value:0,setValueAtTime(){},exponentialRampToValueAtTime(){}});
  return class {
    constructor() { stats.contexts++; this.state="suspended"; this.currentTime=0; this.destination={}; }
    createGain() { return {gain:parameter(),connect(){},disconnect(){}}; }
    createOscillator() {
      return {frequency:parameter(),connect(){},disconnect(){},start(){stats.tones++;},stop(){this.onended();}};
    }
    resume() { this.state="running"; return Promise.resolve(); }
  };
}
function boot(options={}) {
  const doc=new Document({width:1180,height:620,...options}), win=new Events();
  const page={doc,win,matches:[],views:[],audio:{contexts:0,tones:0},time:0};
  const frames=new Map();
  let id=0;
  win.location={reload:()=>{page.reloaded=true;}};
  const scope=vm.createContext({
    window:win,document:doc,devicePixelRatio:options.dpr ?? 1,
    requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},
    cancelAnimationFrame:id=>frames.delete(id),
    AudioContext:options.noAudio ? undefined : audioDouble(page.audio)
  });
  for (const file of scripts) {
    assert.match(file,/^src\/[\w-]+\.js$/);
    if (file==="src/client.js") {
      const {game,view}=scope.Slipwake, original=game.createMatch;
      game.createMatch=params=>{
        const match=original({...params,seed:17,bots:false,...options.rules});
        page.matches.push(match);
        return match;
      };
      view.Renderer=class extends view.Renderer {
        constructor(canvas) {
          try { super(canvas); page.views.push(this); }
          catch (e) { page.graphicsError=e; throw e; }
        }
      };
    }
    vm.runInContext(fs.readFileSync(path.join(root,file),"utf8"),scope,{filename:file});
  }
  page.api=scope.Slipwake;
  page.id=name=>doc.getElementById(name);
  page.frame=(count=1,ms=1000/60)=>{
    for (let i=0;i<count;i++) {
      page.time+=ms;
      const pending=[...frames.values()]; frames.clear();
      pending.forEach(fn=>fn(page.time));
    }
  };
  page.pending=()=>frames.size;
  page.key=(code,extra={})=>win.emit("keydown",{code,key:code,target:doc.activeElement,...extra});
  page.up=code=>win.emit("keyup",{code});
  page.pointer=(type,x,y,extra={})=>{
    const canvas=page.id("arena"), rect=canvas.getBoundingClientRect();
    const target=type==="pointerup" || type==="pointercancel" ? win : canvas;
    return target.emit(type,{clientX:x+rect.left,clientY:y+rect.top,pointerId:1,button:0,isPrimary:true,...extra});
  };
  page.action=text=>{
    const button=page.id("dialog-actions").querySelectorAll("button").find(b=>b.textContent===text);
    assert.ok(button,"action "+text);
    button.emit("click");
  };
  if (page.graphicsError && !options.noWebGL && !options.failCompile) throw page.graphicsError;
  return page;
}
module.exports={boot,root,html,scripts};
