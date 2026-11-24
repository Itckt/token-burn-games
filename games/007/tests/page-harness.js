"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const RecordingGL = require("./webgl-stub.js");
const { seeded } = require("./helpers.js");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(match => match[1]);

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  emit(type, properties = {}) {
    const event = { type, target: this, defaultPrevented: false, ...properties,
      preventDefault() { this.defaultPrevented = true; } };
    for (let node = this; node; node = node.parentNode) {
      for (const listener of node.listeners.get(type) || []) listener.call(node, event);
    }
    return event;
  }
}

class Element extends Events {
  constructor(tag, doc) {
    super();
    this.tag = tag;
    this.doc = doc;
    this.nodes = [];
    this.attributes = new Map();
    this.className = "";
    this.hidden = this.disabled = this.open = false;
    this.scrollLeft = 0;
    this.clientWidth = 800;
    this.clientHeight = 420;
    const classes = () => new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList = {
      contains: name => classes().has(name),
      add: (...names) => { const set = classes(); names.forEach(n => set.add(n)); this.className = [...set].join(" "); },
      remove: (...names) => { const set = classes(); names.forEach(n => set.delete(n)); this.className = [...set].join(" "); },
      toggle: (name, force = !classes().has(name)) => { this.classList[force ? "add" : "remove"](name); return force; }
    };
    const styles = new Map();
    this.style = { setProperty: (k, v) => styles.set(k, v), getPropertyValue: k => styles.get(k) || "" };
  }
  get children() { return this.nodes.filter(node => typeof node !== "string"); }
  get lastElementChild() { return this.children.at(-1); }
  get valueAsNumber() { return this.value === "" ? NaN : Number(this.value); }
  get textContent() { return this.nodes.map(node => typeof node === "string" ? node : node.textContent).join(""); }
  set textContent(value) { this.replaceChildren(String(value)); }
  get offsetLeft() { return (this.parentNode?.children.indexOf(this) || 0) * 43; }
  get offsetWidth() { return 36; }
  append(...nodes) {
    for (const n of nodes) {
      if (typeof n !== "string") { n.remove(); n.parentNode = this; }
      this.nodes.push(n);
    }
  }
  replaceChildren(...nodes) {
    for (const n of this.children) n.parentNode = null;
    this.nodes = [];
    this.append(...nodes);
  }
  remove() {
    if (this.parentNode?.nodes) this.parentNode.nodes = this.parentNode.nodes.filter(n => n !== this);
    this.parentNode = null;
  }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  removeAttribute(k) { this.attributes.delete(k); }
  getAttribute(k) { return this.attributes.get(k) ?? null; }
  querySelector(tag) { return this.children.find(n => n.tag === tag); }
  closest(selector) {
    const tags = selector.split(",").map(s => s.trim());
    for (let n = this; n instanceof Element; n = n.parentNode) if (tags.includes(n.tag)) return n;
    return null;
  }
  focus() {
    if (this.doc.activeElement === this) return;
    this.doc.activeElement?.emit("blur");
    this.doc.activeElement = this;
  }
  click(properties) { if (!this.disabled && !this.hidden) return this.emit("click", properties); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  setPointerCapture(id) { this.captured = id; }
  getBoundingClientRect() {
    return { left: 37, top: 80, width: this.clientWidth, height: this.clientHeight,
      right: 37 + this.clientWidth, bottom: 80 + this.clientHeight };
  }
}

// Run the same classic scripts as the double-click entry point. Only the DOM,
// graphics API, worker transport and animation clock are supplied by the test.
function boot(options = {}) {
  const ids = new Map(), document = new Events(), window = new Events();
  document.hidden = false;
  document.createElement = tag => new Element(tag, document);
  document.body = document.createElement("body");
  document.body.parentNode = document;
  document.activeElement = document.body;
  const get = id => ids.get(id);
  document.getElementById = get;
  for (const [, tag, attrs] of html.matchAll(/<([\w:-]+)\b([^<>]*)>/g)) {
    const id = attrs.match(/\bid="([^"]+)"/)?.[1];
    if (!id) continue;
    const el = document.createElement(tag);
    for (const [, name, value] of attrs.matchAll(/\s+([\w:-]+)="([^"]*)"/g)) el.setAttribute(name, value);
    el.hidden = /\bhidden(?:\s|$)/.test(attrs);
    el.value = attrs.match(/\bvalue="([^"]+)"/)?.[1] || "";
    el.className = attrs.match(/\bclass="([^"]+)"/)?.[1] || "";
    ids.set(id, el);
    document.body.append(el);
  }
  const canvas = get("cube-canvas");
  get("stage").append(canvas, get("reset-view"), get("expand-view"));
  for (const axis of ["x", "y", "z"]) get("axis-" + axis).append(document.createElement("line"), document.createElement("text"));
  let gl = "gl" in options ? options.gl : new RecordingGL();
  canvas.getContext = () => gl;
  let time = 0, frameId = 0, timerId = 0;
  const frames = new Map(), intervals = new Map();
  const performance = { now: () => time };
  Object.defineProperty(window, "localStorage", { get: () => options.storage });
  window.devicePixelRatio = 1.5;
  window.requestAnimationFrame = cb => { frames.set(++frameId, cb); return frameId; };
  window.cancelAnimationFrame = id => frames.delete(id);
  window.setInterval = (callback, period) => {
    intervals.set(++timerId, { callback, period, next: time + period });
    return timerId;
  };
  window.clearInterval = id => intervals.delete(id);
  function frame(ms = 16) {
    time += ms;
    for (const timer of intervals.values()) {
      if (time >= timer.next) { timer.next = time + timer.period; timer.callback(); }
    }
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach(cb => cb(time));
  }
  function settle() {
    let count = 0;
    while (frames.size) { assert.ok(++count < 2500, "animation must eventually sleep"); frame(); }
    return count;
  }
  const workers = [], urls = new Map();
  let urlId = 0;
  const URL = {
    createObjectURL(blob) { const url = "blob:local/" + ++urlId; urls.set(url, blob); return url; },
    revokeObjectURL(url) { urls.delete(url); }
  };
  class Worker {
    constructor(url) { assert.ok(urls.has(url)); this.url = url; this.requests = []; workers.push(this); }
    postMessage(request) { this.requests.push(structuredClone(request)); }
    terminate() { this.terminated = true; }
    reply(data) { this.onmessage({ data }); }
    fail() { this.onerror({ preventDefault() {} }); }
    messageError() { this.onmessageerror({ preventDefault() {} }); }
  }
  const deterministicMath = Object.create(Math);
  deterministicMath.random = seeded(141);
  const context = vm.createContext({ document, window, Blob, URL, performance, Math: deterministicMath });
  if (options.epoch !== undefined) {
    context.Date = class extends Date {
      constructor(...args) { super(...(args.length ? args : [options.epoch + time])); }
    };
  }
  if (options.workers !== false) context.Worker = Worker;
  for (const script of scripts) {
    const source = fs.readFileSync(path.join(root, script), "utf8");
    new vm.Script(source, { filename: script }).runInContext(context);
  }
  return { get, canvas, document, window, frame, settle, frames, intervals, workers, urls, getGL: () => gl,
    setGL(next) { gl = next; }, key(key, target = document.body, properties = {}) { return target.emit("keydown", { key, ...properties }); },
    click(id, properties) { return get(id).click(properties); }, text(id) { return get(id).textContent; },
    moves() { return get("sequence").children.filter(n => n.classList.contains("move-token")).map(n => n.textContent); }
  };
}

module.exports = { boot, scripts, root, html };
