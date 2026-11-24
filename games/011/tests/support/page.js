"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { TestGL } = require("./webgl");
const root = path.join(__dirname, "..", "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  fire(type, details = {}) {
    const event = { type, target: this, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...details };
    const results = Array.from(this.listeners.get(type) || [], handler => handler(event));
    event.done = Promise.all(results);
    return event;
  }
}

function make2D() {
  const ctx = { calls: 0 };
  for (const name of ["setTransform", "clearRect", "beginPath", "closePath", "moveTo", "lineTo", "stroke", "fill",
    "arc", "ellipse", "fillRect", "strokeRect", "bezierCurveTo", "save", "restore", "translate", "rotate", "fillText", "setLineDash"]) {
    ctx[name] = (...args) => {
      assert.ok(args.filter(v => typeof v === "number").every(Number.isFinite), name + " received a nonfinite coordinate");
      ctx.calls++;
    };
  }
  ctx.createLinearGradient = () => ({ addColorStop() {} });
  return ctx;
}

class Element extends Events {
  constructor(tag, attributes, doc, gl) {
    super();
    this.tagName = tag.toUpperCase();
    this.attributes = new Map();
    this.dataset = {};
    this.children = [];
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.doc = doc;
    this.textContent = "";
    this.open = false;
    this.classes = new Set();
    this.classList = { contains: name => this.classes.has(name), add: name => this.classes.add(name), remove: name => this.classes.delete(name) };
    for (const [, name, value] of attributes.matchAll(/([:\w-]+)(?:="([^"]*)")?/g)) this.setAttribute(name, value ?? "");
    this.clientWidth = this.id === "stage" ? 900 : this.classes.has("spark") ? 120 : 18;
    this.clientHeight = this.id === "stage" ? 420 : this.classes.has("spark") ? 38 : 18;
    if (this.tagName === "CANVAS") {
      this.width = 300; this.height = 150;
      const context = make2D();
      this.getContext = name => name === "2d" ? context : gl;
      this.setPointerCapture = id => { this.captured = id; };
    }
  }
  setAttribute(name, value) {
    const text = String(value);
    this.attributes.set(name, text);
    if (name.startsWith("data-")) this.dataset[name.slice(5)] = text;
    if (name === "class") this.classes = new Set(text.split(/\s+/));
    if (["id", "type", "value"].includes(name)) this[name] = text;
    if (["hidden", "checked", "disabled"].includes(name)) this[name] = true;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  matches(selector) {
    if (selector.startsWith("[data-")) return selector.slice(6, -1) in this.dataset;
    return this.tagName === selector.toUpperCase();
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }
  contains(element) {
    return element === this || this.children.some(child => child.contains(element));
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight };
  }
  focus() { this.doc.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire("close"); }
  click() {
    if (this.disabled) return;
    this.focus();
    if (this.type === "checkbox") { this.checked = !this.checked; this.fire("change"); }
    return this.fire("click");
  }
}

function createPage(options = {}) {
  const gl = options.actualGraphics ? new TestGL(options.failure) : null;
  const doc = new Events(), win = new Events(), elements = [], ids = new Map(), stack = [];
  const voidTags = new Set(["meta", "link", "input", "br", "img", "hr"]);
  // Read the project's own markup so a missing ID, renamed data attribute or
  // moved script breaks these integration tests at the normal entry point.
  for (const match of html.matchAll(/<(\/?)([\w-]+)([^>]*)>|([^<]+)/g)) {
    if (match[4] !== undefined) { if (stack.length) stack.at(-1).textContent += match[4]; continue; }
    if (match[1]) { assert.equal(stack.pop().tagName, match[2].toUpperCase()); continue; }
    const el = new Element(match[2], match[3], doc, gl);
    if (stack.length) stack.at(-1).children.push(el);
    elements.push(el);
    if (el.id) ids.set(el.id, el);
    if (!voidTags.has(match[2])) stack.push(el);
  }
  assert.equal(stack.length, 0);
  doc.getElementById = id => ids.get(id) || null;
  doc.querySelectorAll = selector => elements.filter(el => el.matches(selector));
  doc.body = elements.find(el => el.tagName === "BODY");
  doc.activeElement = doc.body;
  doc.hidden = false;
  doc.fullscreenElement = null;
  const viewport = ids.get("viewport");
  if (options.fullscreen) {
    viewport.requestFullscreen = async () => {
      if (options.fullscreen === "reject") throw new Error("Unavailable in this container");
      doc.fullscreenElement = viewport; doc.fire("fullscreenchange");
    };
    doc.exitFullscreen = async () => { doc.fullscreenElement = null; doc.fire("fullscreenchange"); };
  }

  let time = 0, requestId = 0;
  const frames = new Map(), warnings = [];
  win.document = doc;
  if (options.storageDenied) {
    Object.defineProperty(win, "localStorage", { get() { throw new Error("Local storage denied"); } });
  } else {
    win.localStorage = options.storage;
  }
  win.devicePixelRatio = 1;
  win.getComputedStyle = () => ({ color: "#c5ef83" });
  win.matchMedia = () => ({ matches: Boolean(options.reducedMotion) });
  win.console = { warn: (...items) => warnings.push(items.join(" ")) };
  win.requestAnimationFrame = callback => { const id = ++requestId; frames.set(id, callback); return id; };
  win.cancelAnimationFrame = id => frames.delete(id);
  win.ResizeObserver = class {
    constructor(handler) { this.handler = handler; }
    observe(target) { assert.equal(target, ids.get("stage")); }
    disconnect() { this.disconnected = true; }
  };
  const context = vm.createContext(win);
  const log = { attempts: 0, disposed: 0, rendered: [], sizes: [] };
  for (const script of doc.querySelectorAll("script")) {
    const name = script.getAttribute("src");
    if (name === "js/app.js") {
      const actual = win.Isobar.renderer.makeRenderer;
      win.Isobar.renderer.makeRenderer = canvas => {
        log.attempts++;
        const real = options.actualGraphics || options.noWebGL ? actual(canvas) : null;
        return {
          render(state, view) {
            real?.render(state, view);
            log.rendered.push({ time: state.time, phase: state.phase, strength: state.strength,
              speed: state.speed, signal: state.signal, rainTravel: state.rainTravel, imagery: state.imagery,
              comparing: state.comparing, cloudPercent: state.cloudPercent, lightMinutes: state.lightMinutes,
              radarSite: state.radarSite && { ...state.radarSite },
              layers: { ...state.layers }, section: { ...state.section }, distance: view.distance, back: Array.from(view.back) });
          },
          resize(...size) { real?.resize(...size); log.sizes.push(size); },
          dispose() { real?.dispose(); log.disposed++; }
        };
      };
    }
    new vm.Script(fs.readFileSync(path.join(root, name), "utf8"), { filename: name }).runInContext(context);
  }
  function step(ms = 1000 / 60) {
    time += ms;
    const pending = [...frames.values()]; frames.clear();
    pending.forEach(callback => callback(time));
  }
  return { doc, win, gl, log, warnings, frames, step, get: id => ids.get(id),
    input(id, value) { const control = ids.get(id); control.value = String(value); control.fire("input"); },
    data: (key, value) => elements.find(el => el.dataset[key] === value),
    key: (key, other = {}) => doc.fire("keydown", { key, target: doc.body, ...other }),
    run: (count, ms) => { for (let i = 0; i < count; i++) step(ms); },
    last: () => log.rendered.at(-1) };
}
module.exports = { createPage };
