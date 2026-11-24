'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {RecordingGL} = require('./graphics.js');
const root = path.resolve(__dirname,'../..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts = Array.from(html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g), m => m[1]);

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name,fn) {
    if (!this.listeners.has(name)) this.listeners.set(name,[]);
    this.listeners.get(name).push(fn);
  }
  emit(name,properties = {}) {
    const event = {target:this, defaultPrevented:false,
      preventDefault() { this.defaultPrevented=true; }, ...properties};
    for (const fn of this.listeners.get(name) || []) fn(event);
    return event;
  }
}

class Ink {
  constructor() { this.fills=0; this.words=[]; this.saves=0; }
  fillRect(...rect) { this.fills++; if (this.image) this.rects.push(rect); }
  save() { this.saves++; }
  restore() { assert.ok(this.saves > 0); this.saves--; }
  drawImage(source, ...rect) { this.image=source; this.blit=rect; this.arcs=[]; this.rects=[]; this.lines=[]; }
  beginPath() { if (this.image) this.path = []; }
  moveTo(x, y) { if (this.path) this.path.push([x, y]); }
  lineTo(x, y) { if (this.path) this.path.push([x, y]); }
  stroke() { if (this.path?.length > 1) this.lines.push(this.path); }
  fillText(word) { this.words.push(word); }
  arc(x,y,r) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && r > 0);
    if (this.image) this.arcs.push([x,y,r]);
  }
}
// These Canvas 2D calls paint route charts, glyphs and atlas details. The tests
// count painting work and inspect the text sent to each atlas.
for (const name of ['scale','setTransform','translate','strokeRect','strokeText','clearRect','setLineDash',
  'closePath','fill']) Ink.prototype[name] = function () {};

class Element extends Events {
  constructor(tag,attrs = {}) {
    super();
    this.tag=tag; this.attrs=attrs; this.dataset={}; this.textContent='';
    this.hidden=Object.hasOwn(attrs,'hidden'); this.disabled=false; this.value=attrs.value || '';
    const classes = new Set((attrs.class || '').split(/\s+/));
    this.classList = {contains:name=>classes.has(name), add:name=>classes.add(name), remove:name=>classes.delete(name),
      toggle:(name,active)=>active ? classes.add(name) : classes.delete(name)};
    this.style = {setProperty(name,value) { this[name]=value; }};
    for (const key of ['route','speed']) if (attrs['data-'+key]) this.dataset[key]=attrs['data-'+key];
  }
  setAttribute(key,value) { this.attrs[key]=String(value); }
  removeAttribute(key) { delete this.attrs[key]; }
  get href() { return this.attrs.href || ''; }
  set href(value) { this.setAttribute('href', value); }
  getAttribute(key) { return this.attrs[key]; }
  matches(selector) { return selector.split(',').includes(this.tag); }
  closest(selector) { return selector === this.tag ? this : null; }
  querySelector(selector) { assert.equal(selector,'canvas'); return this.icon; }
  focus() { this.focused=true; }
  setPointerCapture(id) { this.captured=id; }
}

function loadPage(options = {}) {
  const gl = new RecordingGL(options), ids = new Map(), routes = [], speeds = [], errors = [];
  const document = new Events(), win = new Events();
  const frames = new Map();
  const blobUrls = new Map();
  let now=0, nextId=0, nextUrl=0;
  function make(tag,attrs = {}) {
    const el = new Element(tag,attrs);
    if (tag === 'canvas') {
      el.width=Number(attrs.width || 300); el.height=Number(attrs.height || 150);
      el.toBlob = (done, type) => done(new Blob([], {type}));
      el.getContext = type => {
        if (type === '2d') {
          if (options.no2D) return null;
          if (!el.ink) el.ink=new Ink();
          return el.ink;
        }
        assert.equal(type,'webgl');
        assert.equal(el,ids.get('harbour'));
        return options.noWebGL ? null : gl;
      };
    }
    if (tag === 'dialog' && !options.noDialog) {
      el.open = false;
      el.showModal = () => { el.open = true; };
      el.close = () => { el.open = false; el.emit('close'); };
    }
    return el;
  }
  for (const [,tag,rest] of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)) {
    const attrs={};
    for (const [,name,value] of rest.matchAll(/\s+([\w-]+)(?:="([^"]*)")?/g)) attrs[name]=value || '';
    if (!attrs.id && !Object.hasOwn(attrs,'data-route') && !Object.hasOwn(attrs,'data-speed')) continue;
    const el=make(tag,attrs);
    if (attrs.id) ids.set(attrs.id,el);
    if (Object.hasOwn(attrs,'data-route')) { el.icon=make('canvas'); routes.push(el); }
    if (Object.hasOwn(attrs,'data-speed')) speeds.push(el);
  }
  const canvas=ids.get('harbour');
  for (const [,id,body] of html.matchAll(/<select id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    ids.get(id).options = Array.from(body.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g),
      ([,value,label]) => ({value,label}));
  }
  canvas.clientWidth=options.width || 1280; canvas.clientHeight=options.height || 630; gl.canvas=canvas;
  document.body=make('body');
  document.documentElement=make('html');
  document.hidden=false;
  const fullscreen=element=>{ document.fullscreenElement=element; document.emit('fullscreenchange'); };
  document.documentElement.requestFullscreen=()=>fullscreen(document.documentElement);
  document.exitFullscreen=()=>fullscreen(null);
  if (options.noFullscreen) delete document.documentElement.requestFullscreen;
  document.getElementById=id=>{ assert.ok(ids.has(id),id); return ids.get(id); };
  document.createElement=make;
  document.querySelectorAll=selector=>{
    if (selector === '[data-route]') return routes;
    if (selector === '[data-speed]') return speeds;
    throw new Error('Unrecognised selector '+selector);
  };
  const location=new URL('file:///nightferry/index.html'+(options.address || ''));
  const globals=vm.createContext({document, window:win, location, URLSearchParams, devicePixelRatio:options.dpr || 1,
    URL: {createObjectURL(blob) {
      const url = 'blob:postcard-' + (++nextUrl);
      blobUrls.set(url, blob);
      return url;
    }, revokeObjectURL:url=>blobUrls.delete(url)},
    console:{error:(...args)=>errors.push(args.join(' '))},
    matchMedia:()=>({matches:!!options.reduced}),
    requestAnimationFrame:fn=>{ frames.set(++nextId,fn); return nextId; },
    cancelAnimationFrame:id=>frames.delete(id)});
  for (const file of scripts) {
    new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file}).runInContext(globals);
  }
  function tick(milliseconds = 1000/60) {
    now+=milliseconds;
    gl.draws=[];
    const callbacks=[...frames.values()]; frames.clear();
    callbacks.forEach(fn=>fn(now));
    assert.ok(frames.size <= 1,'at most one pending animation callback');
  }
  const key = (key,props = {}) => win.emit('keydown',{key,code:key === ' ' ? 'Space' : key,target:canvas,...props});
  const id = name => document.getElementById(name);
  function ready() { assert.equal(canvas.dataset.status,'ready',errors.join('\n')); }
  return {gl, globals, document, win, location, canvas, routes, speeds, errors, frames, blobUrls, id, key, tick, ready};
}

module.exports = {root, html, scripts, loadPage};
