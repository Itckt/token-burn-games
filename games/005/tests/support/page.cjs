'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {Graphics,Ink} = require('./graphics.cjs');

const root = path.resolve(__dirname,'../..');
const read = name => fs.readFileSync(path.join(root,name),'utf8');
const html = read('index.html');
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)].map(m => m[1]);

class Element {
  constructor(name) {
    this.tagName = name.toUpperCase();
    this.attributes = new Map();
    this.listeners = new Map();
    this.children = [];
    this.dataset = {};
    this.textContent = '';
    this.style = {setProperty(k,v) { this[k] = v; }};
    this.classes = new Set();
    this.classList = {add: k => this.classes.add(k), remove: k => this.classes.delete(k),
      toggle: (k,on) => on ? this.classes.add(k) : this.classes.delete(k)};
  }
  setAttribute(k,v) { this.attributes.set(k,String(v)); }
  getAttribute(k) { return this.attributes.get(k) ?? null; }
  removeAttribute(k) { this.attributes.delete(k); }
  append(...children) {
    for (const child of children) {
      if (child.parent) child.parent.children = child.parent.children.filter(el => el !== child);
      child.parent = this; this.children.push(child);
    }
  }
  get parentNode() { return this.parent; }
  replaceChildren(...children) {
    for (const child of this.children) child.parent = null;
    this.children = []; this.append(...children);
  }
  addEventListener(type, fn) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(fn);
    this.listeners.set(type,handlers);
  }
  emit(type, properties = {}) {
    const event = {type, target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...properties};
    for (const fn of this.listeners.get(type) || []) fn(event);
    return event;
  }
  closest(tag) { return this.tagName===tag.toUpperCase() ? this : (this.parent?.closest(tag) ?? null); }
  getComputedTextLength() { return this.textContent.length*7; }
  getBoundingClientRect() { return {left: 0, top: 0, right: 400, bottom: 480}; }
  focus() { this.focused = true; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  setPointerCapture(id) { this.capture = id; }
}

function createPage(options = {}) {
  const gl = options.noGL ? null : new Graphics(options);
  const document = new Element('document'), elements = new Map(), observers = [];
  function element(name) {
    const el = new Element(name);
    if (el.tagName==='CANVAS') {
      el.ink = new Ink();
      el.getContext = kind => kind==='webgl' ? gl : kind==='2d' && !options.no2D ? el.ink : null;
    }
    return el;
  }
  // Preserve the shipped parent-child relationships, including SVG and void
  // elements, so moving a diagram exercises the real starting arrangement.
  const stack=[document], byClass=new Map();
  const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
  for (const [tag, name] of html.matchAll(/<\/?([a-z][\w-]*)\b[^<>]*>/gi)) {
    if (tag.startsWith('</')) {
      if (stack.pop()?.tagName!==name.toUpperCase()) throw new Error('Mismatched closing tag '+tag);
      continue;
    }
    const el = element(name);
    for (const [,k,v] of tag.matchAll(/\s([\w-]+)(?:="([^"]*)")?/g)) {
      el.setAttribute(k,v ?? '');
    }
    el.hidden = el.attributes.has('hidden');
    el.disabled = el.attributes.has('disabled');
    el.value = el.getAttribute('value') || '';
    const id=el.getAttribute('id');
    if (id) elements.set(id,el);
    for (const className of (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)) {
      if (!byClass.has(className)) byClass.set(className,el);
    }
    stack.at(-1).append(el);
    if (!voidTags.has(name) && !tag.endsWith('/>')) stack.push(el);
  }
  if (stack.length!==1) throw new Error('Unclosed element in index.html');
  const byId = id => elements.get(id);
  const ticks=byClass.get('step-ticks').children, gesture=byClass.get('gesture-help'), zoomHint=byClass.get('zoom-hint');
  Object.assign(byId('scene'),{clientWidth: 800, clientHeight: 440});
  Object.assign(byId('diagram'),{clientWidth: 300, clientHeight: 92});
  Object.assign(byId('bench-diagram'),{clientWidth: 300, clientHeight: 94});
  document.getElementById = byId;
  document.createElement = element;
  document.createElementNS = (_,name) => element(name);
  document.querySelectorAll = q => q==='.step-ticks i' ? ticks : [];
  document.querySelector = q => ({'.gesture-help': gesture, '.zoom-hint': zoomHint})[q];
  document.hidden = false;
  const frames = new Map(), warnings = [];
  let id = 0;
  const reduce = Object.assign(new Element('media'),{matches: !!options.reduced});
  const context = vm.createContext({
    document, devicePixelRatio: options.dpr || 1, console: {warn: (...message) => warnings.push(message)},
    matchMedia: q => q.includes('reduced-motion') ? reduce : {matches: !!options.touch},
    requestAnimationFrame(fn) { frames.set(++id,fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: class {
      constructor(fn) { this.fn = fn; }
      observe(el) { observers.push({el,fn: this.fn}); }
    }
  });
  for (const name of scripts) {
    if (options.rendererOnly && name.endsWith('/app.js')) continue;
    vm.runInContext(read(name),context,{filename: name});
  }
  function frame(stamp) {
    const scheduled = [...frames.values()];
    frames.clear();
    for (const fn of scheduled) fn(stamp);
    return scheduled.length;
  }
  const key = (key, props={}) => document.emit('keydown',{key, target: byId('scene'), ...props});
  function resize(w,h) {
    Object.assign(byId('scene'),{clientWidth: w, clientHeight: h});
    for (const {fn} of observers) fn();
  }
  function interact(id, event, value) {
    const el = byId(id);
    if (!el) throw new Error('Unknown control '+id);
    for (let node = el; node; node = node.parentNode) {
      if (node.hidden || node.disabled) return false;
    }
    if (value !== undefined) el.value = String(value);
    el.emit(event);
    return true;
  }
  return {byId,document,context,gl,frames,frame,key,resize,ticks,zoomHint,warnings,reduce,
    click:id => interact(id,'click'), input:(id,value,event='input') => interact(id,event,value)};
}

module.exports = {createPage,root,html,scripts,read};
