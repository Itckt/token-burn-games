"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { CommandGL } = require("./gl");
const root = path.resolve(__dirname, "../..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  emit(type, init = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...init };
    const results = (this.listeners.get(type) || []).map(fn => fn(event));
    event.settled = Promise.all(results);
    return event;
  }
}

class Ink {
  constructor() { this.fills = 0; this.strokes = 0; this.images = 0; this.depth = 0; }
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  clearRect() {}
  setLineDash(pattern) { assert.ok(pattern.every(v => v >= 0)); }
  fillText(text, x, y) { assert.ok(text && [x, y].every(Number.isFinite)); }
  scale() {}
  save() { this.depth++; }
  restore() { assert.ok(this.depth > 0); this.depth--; }
  fill() { this.fills++; }
  fillRect() { this.fills++; }
  stroke() { this.strokes++; }
  translate(x, y) { this.marker = [x, y]; }
  rotate(angle) { this.rotation = angle; }
  arc(x, y, r) { assert.ok([x, y, r].every(Number.isFinite) && r >= 0); }
  createLinearGradient() { return { addColorStop() {} }; }
  createRadialGradient() { return { addColorStop() {} }; }
  drawImage(sheet, ...rect) { this.images++; this.sheet = sheet; this.sheetRect = rect; }
}

class Element extends Events {
  constructor(page, tag, attrs = {}) {
    super();
    this.page = page; this.tagName = tag.toUpperCase(); this.attrs = attrs;
    this.id = attrs.id || ""; this.children = []; this.dataset = {};
    this.hidden = "hidden" in attrs; this.disabled = "disabled" in attrs;
    this.value = attrs.value || ""; this.open = false; this.textContent = "";
    this.width = Number(attrs.width) || 300; this.height = Number(attrs.height) || 150;
    for (const key of Object.keys(attrs)) if (key.startsWith("data-")) this.dataset[key.slice(5)] = attrs[key];
    const classes = new Set((attrs.class || "").split(/\s+/));
    this.classList = {
      add: k => classes.add(k), remove: k => classes.delete(k), contains: k => classes.has(k),
      toggle(k, active = !classes.has(k)) { if (active) classes.add(k); else classes.delete(k); return active; }
    };
    this.style = { setProperty(key, value) { this[key] = value; } };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  focus() { this.page.document.activeElement = this; this.page.document.emit("focusin", { target: this }); }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit("close"); }
  scrollIntoView(options) { this.scrolled = options; }
  setPointerCapture(id) { this.captured = id; }
  getBoundingClientRect() {
    const [width, height] = this.page.sizes[this.id] || [400, 300];
    return { left: 0, top: 0, width, height, right: width, bottom: height };
  }
  get clientHeight() { return this.getBoundingClientRect().height; }
  getContext(which) {
    assert.equal(this.tagName, "CANVAS");
    if (which === "webgl" && this.id === "world") return this.page.gl;
    if (which === "2d" && this.id !== "world" && !this.page.options.no2d) return this.ink ||= new Ink();
    return null;
  }
  querySelectorAll(selector) {
    const all = [];
    for (const el of this.children) {
      if (selector === el.tagName.toLowerCase() || (selector.startsWith("[") && selector.slice(1, -1) in el.attrs)) all.push(el);
      all.push(...el.querySelectorAll(selector));
    }
    return all;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

// Build only the element tree and event surfaces consumed by the page.
// JavaScript and shader sources come directly from the production entry point.
function mount(options = {}) {
  const page = { options, sizes: { world: [960, 460], survey: [300, 140] },
    gl: options.webgl === false ? null : new CommandGL(options), now: 0 };
  const document = new Element(page, "document"), window = new Events();
  Object.assign(page, { window, document });
  const stack = [document], ids = new Map(), voidTags = new Set(["input", "link", "meta", "br", "img"]);
  for (const match of html.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*?)>/gi)) {
    const [, closing, tag, raw] = match;
    if (closing) {
      assert.equal(stack.pop().tagName, tag.toUpperCase());
      continue;
    }
    const attrs = Object.fromEntries([...raw.matchAll(/([^\s=/]+)(?:="([^"]*)")?/g)].map(m => [m[1], m[2] || ""]));
    const el = new Element(page, tag, attrs);
    stack.at(-1).children.push(el);
    if (el.id) ids.set(el.id, el);
    if (tag === "body") document.body = el;
    if (!voidTags.has(tag) && !raw.endsWith("/")) stack.push(el);
  }
  assert.equal(stack.length, 1);
  page.el = id => { assert.ok(ids.has(id), "Missing page element " + id); return ids.get(id); };
  document.getElementById = page.el;
  document.createElement = tag => {
    const el = new Element(page, tag);
    if (options.noSheet && tag === "canvas") el.getContext = () => null;
    return el;
  };
  document.activeElement = document.body;
  document.hidden = !!options.hidden;
  document.fullscreenElement = null;
  if (options.fullscreen) {
    page.el("viewer").requestFullscreen = async () => {
      document.fullscreenElement = page.el("viewer"); document.emit("fullscreenchange");
    };
    document.exitFullscreen = async () => { document.fullscreenElement = null; document.emit("fullscreenchange"); };
  }
  let nextFrame = 0;
  const callbacks = new Map();
  window.requestAnimationFrame = cb => { callbacks.set(++nextFrame, cb); return nextFrame; };
  window.cancelAnimationFrame = id => callbacks.delete(id);
  page.frameCount = () => callbacks.size;
  page.advance = (count = 1, ms = 1000 / 60) => {
    for (let i = 0; i < count; i++) {
      page.now += ms;
      const current = [...callbacks.values()];
      callbacks.clear();
      for (const cb of current) cb(page.now);
    }
  };
  page.click = id => page.el(id).emit("click");
  page.key = (type, code, key = "", extra = {}) => {
    const init = { code, key, target: document.activeElement, ...extra };
    const local = init.target.emit(type, init);
    return document.emit(type, { ...init, defaultPrevented: local.defaultPrevented });
  };
  page.pointer = (el, type, pointerId, clientX, clientY) => el.emit(type, { pointerId, clientX, clientY, button: 0 });
  window.matchMedia = () => ({ matches: !!options.touch });
  window.devicePixelRatio = options.dpr || 1;
  Object.assign(window, { window, document, console, Math, Float32Array, Uint8Array });
  const context = vm.createContext(window);
  for (const src of scripts) vm.runInContext(fs.readFileSync(path.join(root, src), "utf8"), context, { filename: src });
  return page;
}
module.exports = { root, html, scripts, mount };
