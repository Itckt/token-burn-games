"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

class MemoryStorage {
  constructor() { this.data = new Map(); this.writes = 0; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key,String(value)); this.writes++; }
  removeItem(key) { this.data.delete(key); }
}

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name,new Set());
    this.listeners.get(name).add(fn);
  }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name, detail = {}) {
    const event = { target:this, defaultPrevented:false,
      preventDefault() { this.defaultPrevented = true; }, ...detail };
    event.finished = Promise.all(Array.from(this.listeners.get(name) || [], fn => fn(event)));
    return event;
  }
}

const decode = value => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, key) =>
  ({amp:"&",lt:"<",gt:">",quot:'"',"#39":"'"}[key]));
const voids = new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr"]);

// A narrow event harness for the elements and selectors used by this app.
// It checks real generated markup and dispatches events without starting a renderer.
class Element extends Events {
  constructor(tag, attrs, doc) {
    super();
    this.tag = tag;
    this.attrs = attrs;
    this.doc = doc || this;
    this.children = [];
    this.dataset = {};
    for (const [key,val] of Object.entries(attrs)) {
      if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val;
    }
    this.id = attrs.id || "";
    this.value = attrs.value || "";
    this.checked = Object.hasOwn(attrs,"checked");
    this.disabled = Object.hasOwn(attrs,"disabled");
    this.open = false;
  }
  append(child) {
    this.children.push(child);
    if (typeof child !== "string") child.parent = this;
  }
  matches(selector) {
    if (selector[0] === "#") return this.id === selector.slice(1);
    if (selector[0] === ".") return (this.attrs.class || "").split(/\s+/).includes(selector.slice(1));
    if (selector[0] === "[") {
      const match = selector.match(/^\[([\w:-]+)(?:="([^"]*)")?\]$/);
      if (!match) throw new Error("Unsupported test selector " + selector);
      return Object.hasOwn(this.attrs,match[1]) && (match[2] === undefined || this.attrs[match[1]] === match[2]);
    }
    return selector === this.tag;
  }
  closest(selector) {
    for (let item = this; item; item = item.parent) if (item.matches(selector)) return item;
    return null;
  }
  querySelectorAll(selector) {
    const result = [];
    const visit = item => {
      for (const child of item.children) {
        if (typeof child === "string") continue;
        if (child.matches(selector)) result.push(child);
        visit(child);
      }
    };
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  get textContent() { return this.children.map(child => typeof child === "string" ? child : child.textContent).join(""); }
  set textContent(text) { this.children = [String(text)]; }
  get innerHTML() { return this.source || ""; }
  set innerHTML(html) {
    this.source = html;
    this.children = [];
    const stack = [this];
    const tokens = html.match(/<!--[\s\S]*?-->|<![^>]+>|<\/?[^>]+>|[^<]+/g) || [];
    for (const token of tokens) {
      if (token.startsWith("<!")) continue;
      if (token.startsWith("</")) {
        const tag = token.slice(2,-1).trim().toLowerCase();
        const element = stack.pop();
        assert.equal(element.tag,tag,"Unbalanced closing tag " + tag);
        if (tag === "textarea") element.value = element.textContent.replace(/^\n/, "");
      } else if (token.startsWith("<")) {
        const match = token.match(/^<([\w:-]+)([\s\S]*?)\/?>$/);
        assert.ok(match,"Unrecognized markup");
        const tag = match[1].toLowerCase();
        const attrs = {};
        for (const attr of match[2].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
          attrs[attr[1]] = decode(attr[2] ?? attr[3] ?? attr[4] ?? "");
        }
        const child = new Element(tag,attrs,this.doc);
        stack.at(-1).append(child);
        if (!voids.has(tag) && !token.endsWith("/>")) stack.push(child);
      } else stack.at(-1).append(decode(token));
    }
    assert.equal(stack.length,1,"Unclosed markup elements");
  }
  get elements() {
    const named = {};
    for (const input of [...this.querySelectorAll("input"), ...this.querySelectorAll("textarea")]) {
      if (input.attrs.type !== "radio" || input.checked) named[input.attrs.name] = input;
    }
    return named;
  }
  focus() { this.doc.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}

const root = path.join(__dirname,"..");
class Document extends Element {
  constructor() {
    super("document",{});
    this.innerHTML = fs.readFileSync(path.join(root,"index.html"),"utf8");
    this.activeElement = this.querySelector("body");
    this.hidden = false;
  }
  getElementById(id) { return this.querySelector("#" + id); }
}

class Window extends Events {
  constructor(hash, storage) {
    super();
    this.location = {hash};
    this.localStorage = storage;
    this.navigator = {};
    this.Blob = Blob;
    this.URL = URL;
    this.timers = new Map();
    this.sequence = 0;
  }
  setTimeout(fn, wait) { this.timers.set(++this.sequence,{fn,wait}); return this.sequence; }
  clearTimeout(id) { this.timers.delete(id); }
  setInterval(fn, wait) { return this.setTimeout(fn,wait); }
  clearInterval(id) { this.clearTimeout(id); }
  scrollTo() {}
}

function fixture({date = "2026-11-23", hash = "#overview", storage = new MemoryStorage(), locks} = {}) {
  const doc = new Document();
  const win = new Window(hash,storage);
  if (locks) win.navigator.locks = locks;
  let now = date;
  let ids = 0;
  const app = require("../js/app.js").start({doc,win,clock:() => new Date(now + "T12:00:00"),
    makeId:() => "test-" + ++ids});
  const main = doc.getElementById("main-content");
  const dialog = doc.getElementById("journal-dialog");
  const content = doc.getElementById("dialog-content");
  const scope = () => dialog.open ? content : doc;
  const control = (action, data = {}) => scope().querySelectorAll(`[data-action="${action}"]`)
    .find(el => (dialog.open || !el.closest("dialog")) && Object.entries(data).every(([key,value]) => el.dataset[key] === value));
  async function click(action, data) {
    const button = control(action,data);
    assert.ok(button,"Missing control " + action + " " + JSON.stringify(data));
    button.focus();
    doc.emit("click",{target:button.querySelector("svg") || button});
    await app.idle();
  }
  function navigate(id) {
    assert.ok(doc.getElementById("sidebar").querySelector(`[href="#${id}"]`));
    win.location.hash = "#" + id;
    win.emit("hashchange");
  }
  async function submit(name, icon, days) {
    const form = content.querySelector("form");
    assert.ok(form,"Missing habit editor");
    form.elements.habitName.value = name;
    if (icon) for (const radio of form.querySelectorAll('[type="radio"]')) radio.checked = radio.value === icon;
    if (days) for (const input of form.querySelectorAll('[name="weekday"]')) input.checked = days.includes(Number(input.value));
    doc.emit("submit",{target:form});
    await app.idle();
  }
  async function submitGoal(target) {
    const form = content.querySelector("#goal-form");
    assert.ok(form, "Missing weekly goal editor");
    for (const radio of form.querySelectorAll("input")) radio.checked = Number(radio.value) === target;
    doc.emit("submit", {target: form});
    await app.idle();
  }
  function chooseBackup(file) {
    const input = content.querySelector("#backup-file");
    assert.ok(input, "Missing backup picker");
    input.files = file ? [file] : [];
    return doc.emit("change", {target: input}).finished;
  }
  return { doc,win,app,main,dialog,content,storage,control,click,navigate,submit,submitGoal,chooseBackup,
    setDate(value, notify = true) { now = value; if (notify) win.emit("focus"); } };
}

module.exports = { root, MemoryStorage, Element, Document, Window, fixture };
