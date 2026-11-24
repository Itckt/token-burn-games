'use strict';

// A small event tree for exercising the real page bindings in a Node process.
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  emit(type, properties = {}) {
    const event = {type, target:this, defaultPrevented:false, preventDefault() { this.defaultPrevented = true; }, ...properties};
    for (const fn of this.listeners.get(type) || []) fn(event);
    return event;
  }
}

class Element extends Events {
  constructor(tag) {
    super();
    this.tag = tag;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {setProperty(key,value) { this[key] = value; }};
    this.className = '';
    this.text = '';
    this.hidden = false;
    this.disabled = false;
    const classes = () => new Set(this.className.split(/\s+/).filter(Boolean));
    this.classList = {
      contains: name => classes().has(name),
      remove: name => this.classList.toggle(name,false),
      toggle: (name,force) => {
        const names = classes(), add = force === undefined ? !names.has(name) : force;
        if (add) names.add(name);
        else names.delete(name);
        this.className = [...names].join(' ');
        return add;
      }
    };
  }
  get textContent() { return this.text + this.children.map(c => c.textContent).join(''); }
  set textContent(text) { this.replaceChildren(); this.text = String(text); }
  setAttribute(name,value) {
    this.attributes.set(name,String(value));
    if (name === 'class') this.className = value;
    if (name === 'hidden') this.hidden = true;
    if (name === 'id') this.id = value;
    if (name.startsWith('data-')) this.dataset[name.slice(5)] = value;
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  remove() {
    if (!this.parent) return;
    const i = this.parent.children.indexOf(this);
    if (i !== -1) this.parent.children.splice(i,1);
    this.parent = null;
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.text = '';
    this.append(...nodes);
  }
  *descendants() {
    for (const node of this.children) { yield node; yield* node.descendants(); }
  }
  querySelector(tag) { return [...this.descendants()].find(node => node.tag === tag) || null; }
  click() { if (!this.disabled) return this.emit('click'); }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
}

function parse(html) {
  const doc = new Events(), root = new Element('document'), stack = [root], ids = new Map();
  const voidTags = new Set(['link','meta','img','br','input','hr']);
  for (const [token] of html.matchAll(/<[^>]+>|[^<]+/g)) {
    const parent = stack.at(-1);
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) {
      if (parent.tag !== token.slice(2,-1)) throw new Error('Unexpected closing tag ' + token);
      stack.pop();
    } else if (token[0] === '<') {
      const [,tag,attributes] = token.match(/^<([\w-]+)([\s\S]*?)\/?\s*>$/);
      const el = new Element(tag);
      el.ownerDocument = doc;
      for (const [,name,value] of attributes.matchAll(/([:\w-]+)(?:="([^"]*)")?/g)) el.setAttribute(name, value ?? '');
      parent.append(el);
      if (el.id) {
        if (ids.has(el.id)) throw new Error('Duplicate id ' + el.id);
        ids.set(el.id,el);
      }
      if (!voidTags.has(tag) && !token.endsWith('/>')) stack.push(el);
    } else {
      parent.text += token;
    }
  }
  if (stack.length !== 1) throw new Error('Unclosed tag ' + stack.at(-1).tag);
  doc.getElementById = id => ids.get(id) || null;
  doc.documentElement = root.querySelector('html');
  doc.body = root.querySelector('body');
  doc.createElement = tag => Object.assign(new Element(tag), {ownerDocument:doc});
  doc.createElementNS = (_,tag) => doc.createElement(tag);
  doc.all = tag => [...root.descendants()].filter(el => el.tag === tag);
  doc.fullscreenEnabled = true;
  doc.documentElement.requestFullscreen = async () => {
    doc.fullscreenElement = doc.documentElement;
    doc.emit('fullscreenchange');
  };
  doc.exitFullscreen = async () => { doc.fullscreenElement = null; doc.emit('fullscreenchange'); };
  return doc;
}
module.exports = {parse};
