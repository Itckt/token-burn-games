"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const {RecordingGL} = require("./recording-gl");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  fire(type, data = {}) {
    const event = {type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...data};
    for (let node = this; node; node = node.parentNode) {
      event.currentTarget = node;
      for (const callback of node.listeners.get(type) || []) callback.call(node, event);
    }
    return event;
  }
}
const dataName = name => name.slice(5).replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
class Element extends Events {
  constructor(tag, document) {
    super();
    this.tagName = tag.toUpperCase();
    this.ownerDocument = document;
    this.children = [];
    this.dataset = {};
    this.attributes = new Map();
    this.style = {values: new Map(), setProperty(k, v) { this.values.set(k, v); }, getPropertyValue(k) { return this.values.get(k); }};
    this.text = "";
    this.value = "";
    this.className = "";
    const classes = () => this.className.split(/\s+/).filter(Boolean);
    this.classList = {
      contains: c => classes().includes(c),
      add: c => { this.className = [...new Set([...classes(), c])].join(" "); },
      remove: c => { this.className = classes().filter(s => s !== c).join(" "); },
      toggle: (c, on) => { if (on) this.classList.add(c); else this.classList.remove(c); }
    };
    this.hidden = this.disabled = this.open = false;
    this.width = 300; this.height = 150;
    this.clientWidth = 1050; this.clientHeight = 660;
  }
  append(...nodes) {
    for (const node of nodes) { this.children.push(node); node.parentNode = this; }
  }
  get textContent() { return this.text + this.children.map(el => el.textContent).join(""); }
  set textContent(value) { this.text = String(value); this.children = []; }
  setAttribute(k, v) {
    const str = String(v);
    this.attributes.set(k, str);
    if (k === "id") this.ownerDocument.ids.set(str, this);
    if (k === "class") this.className = str;
    if (k.startsWith("data-")) this.dataset[dataName(k)] = str;
    if (k === "value" || k === "max" || k === "min") this[k] = str;
    if (k === "width" || k === "height") this[k] = Number(str);
    if (k === "hidden" || k === "disabled") this[k] = true;
  }
  getAttribute(k) { return this.attributes.get(k) ?? null; }
  matches(selector) {
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    if (selector.startsWith("[data-")) return Object.hasOwn(this.dataset, dataName(selector.slice(1, -1)));
    return this.tagName === selector.toUpperCase();
  }
  closest(selector) {
    for (let el = this; el; el = el.parentNode) if (el.matches(selector)) return el;
    return null;
  }
  contains(target) { return this === target || this.children.some(el => el.contains(target)); }
  querySelectorAll(selector) {
    return this.children.flatMap(el => [...(el.matches(selector) ? [el] : []), ...el.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() {
    this.ownerDocument.activeElement = this;
    this.fire("focusin");
  }
  click(data) { if (!this.disabled) return this.fire("click", data); }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire("close"); }
  select() { this.selectionStart = 0; this.selectionEnd = this.value.length; }
  setPointerCapture(id) { this.capture = id; }
  getBoundingClientRect() { return {left: 0, top: 0, width: this.clientWidth, height: this.clientHeight}; }
  getContext(kind) {
    assert.equal(this.tagName, "CANVAS");
    if (kind === "webgl") return this.ownerDocument.graphics;
    assert.equal(kind, "2d");
    if (!this.pen) {
      this.pen = {copies: 0, strokes: 0, drawImage(source) {
        assert.equal(source.tagName, "CANVAS");
        assert.ok(source.width > 0 && source.height > 0);
        this.copies++;
      }, stroke() { this.strokes++; }};
      for (const name of ["scale", "setTransform", "clearRect", "beginPath", "arc", "fill", "moveTo", "lineTo", "fillText"]) {
        this.pen[name] = () => {};
      }
      this.pen.fillRect = (...rect) => assert.ok(rect.length === 4 && rect.every(Number.isFinite));
    }
    return this.pen;
  }
}

// Parse just the element/attribute/text subset in the actual entry page. This
// supplies event targets for the application; layout and browser CSS are out of scope.
function makeDocument(graphics) {
  const doc = new Element("document", null);
  doc.ownerDocument = doc;
  doc.ids = new Map();
  doc.graphics = graphics;
  doc.createElement = tag => new Element(tag, doc);
  doc.getElementById = id => doc.ids.get(id) || null;
  const stack = [doc];
  const tokens = html.replace(/<noscript>[\s\S]*?<\/noscript>/gi, "").match(/<[^>]+>|[^<]+/g);
  for (const token of tokens) {
    if (token.startsWith("<!")) continue;
    if (token.startsWith("</")) { stack.pop(); continue; }
    if (!token.startsWith("<")) { stack.at(-1).text += token; continue; }
    const tag = token.match(/^<([\w-]+)/)[1];
    const el = doc.createElement(tag);
    for (const m of token.matchAll(/\s+([\w:-]+)(?:="([^"]*)")?/g)) el.setAttribute(m[1], m[2] || "");
    stack.at(-1).append(el);
    if (!["meta", "link", "input", "br", "hr", "img"].includes(tag)) stack.push(el);
  }
  assert.equal(stack.length, 1, "balanced HTML elements");
  doc.body = doc.querySelector("body");
  doc.activeElement = doc.body;
  return doc;
}

function workshop(options = {}) {
  const gl = new RecordingGL(options);
  const doc = makeDocument(options.webgl === false ? null : gl);
  const frames = new Map(), timers = new Map();
  let serial = 0, now = 0;
  const window = new Events();
  Object.assign(window, {
    document: doc, navigator: options.navigator || {}, devicePixelRatio: options.dpr || 1,
    matchMedia: () => ({matches: Boolean(options.reducedMotion)}),
    getComputedStyle: () => ({color: "#19332d"}),
    Path2D: class { constructor(d) { assert.ok(/^M/.test(d)); } },
    requestAnimationFrame(fn) { frames.set(++serial, fn); return serial; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn, ms) { timers.set(++serial, {fn, at: now + ms}); return serial; },
    clearTimeout(id) { timers.delete(id); }
  });
  window.window = window;
  const ctx = vm.createContext(window);
  for (const script of doc.querySelectorAll("script")) {
    const file = path.join(root, script.getAttribute("src"));
    vm.runInContext(fs.readFileSync(file, "utf8"), ctx, {filename: file});
  }
  function tick(count = 1, ms = 1000 / 60) {
    for (let i = 0; i < count; i++) {
      now += ms;
      const waiting = Array.from(frames.values());
      frames.clear();
      for (const fn of waiting) fn(now);
      for (const [id, t] of timers) if (t.at <= now) { timers.delete(id); t.fn(); }
    }
  }
  return {gl, doc, window, ctx, frames, tick, id: el => doc.getElementById(el),
    key(key, fields = {}, target = doc.activeElement) {
      const event = target.fire("keydown", {key, ...fields});
      if (key === "Escape" && !event.defaultPrevented) {
        const dialog = doc.querySelectorAll("dialog").find(el => el.open);
        if (dialog && !dialog.fire("cancel").defaultPrevented) dialog.close();
      }
      return event;
    },
    settle(limit = 1200) {
      let count = 0;
      while (frames.size && count < limit) { tick(); count++; }
      assert.equal(frames.size, 0, "animation returned to idle");
      return count;
    }
  };
}
function chooseLayout(w, key) {
  w.id("layouts-toggle").click();
  w.id("layouts-menu").querySelectorAll("button").find(button => button.dataset.layout === key).click();
}
function openBlueprint(w) { w.id("layouts-toggle").click(); w.id("blueprint-open").click(); }
function edit(w, id, value) { w.id(id).value = String(value); w.id(id).fire("input"); }
const speed = (w, value) => edit(w, "speed", value);
module.exports = {workshop, html, root, chooseLayout, openBlueprint, edit, speed};
