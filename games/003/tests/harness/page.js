'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {parse} = require('./dom');
const math = require('../../js/math'), mesh = require('../../js/mesh'), battle = require('../../js/battle');
const arena = require('../../js/arena'), models = require('../../js/models');
const root = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
const deps = {math,mesh,battle,arena,models,signal:require('../../js/signal'),replay:require('../../js/replay'),
  roster:require('../../js/roster'),drills:require('../../js/drills'),workshop:require('../../js/workshop'),
  coils:require('../../js/coils'),freight:require('../../js/freight'),instruments:require('../../js/instruments'),
  salvage:require('../../js/salvage'),projectiles:require('../../js/projectiles'),shelf:require('../../js/shelf'),dialogs:require('../../js/dialogs')};

function boot(options = {}) {
  const doc = parse(html), byId = doc.getElementById, field = byId('field');
  const frames = new Map(), timers = new Map(), renders = [], contextRequests = [];
  let time = 0, serial = 0, portraitCount = 0;
  const win = {
    devicePixelRatio: options.ratio ?? 1.25,
    matchMedia: () => ({matches: Boolean(options.reduced)}),
    requestAnimationFrame: fn => { frames.set(++serial,fn); return serial; },
    cancelAnimationFrame: id => frames.delete(id),
    setTimeout: (fn,delay) => { timers.set(++serial,{due:time+delay,fn}); return serial; },
    clearTimeout: id => timers.delete(id),
    AudioContext: options.AudioContext, localStorage:options.storage
  };
  field.clientWidth = 900;
  field.clientHeight = 385;
  field.getBoundingClientRect = () => ({left:10, top:20, width:field.clientWidth, height:field.clientHeight});
  field.getContext = (name,settings) => { contextRequests.push({name,settings}); return options.gl ?? null; };
  field.toDataURL = type => { portraitCount++; return 'data:' + type + ';base64,AA=='; };
  class TestRenderer {
    constructor() {
      this.reduced = Boolean(options.reduced);
      this.targetView = 0;
      this.portraits = Object.fromEntries(battle.CARDS.map(c => [c.id,'data:image/png;base64,AA==']));
      renders.push(this);
    }
    render(match, sceneTime, alpha, delta, pointer) {
      this.match = match;
      this.sceneTime = sceneTime;
      this.alpha = alpha;
      this.camera = arena.camera(field.clientWidth,field.clientHeight,this.targetView);
      if (pointer) {
        const site = this.siteAt(...pointer);
        this.hover = site?.lane ?? null;
        if (site && this.previewSocket != null) this.previewSocket = site.socket;
      }
    }
    project(x,y,z) {
      const [nx,ny] = math.transformPoint(this.camera.vp,[x,y,z]);
      return [(nx+1)/2,(1-ny)/2];
    }
    siteAt(x,y) { return this.camera ? arena.pickSite(math.groundPoint(this.camera.inverse,x,y,.16)) : null; }
  }
  const context = vm.createContext({window:win, document:doc});
  function run(src) {
    const filename = path.join(root,src);
    vm.runInContext(fs.readFileSync(filename,'utf8'),context,{filename});
  }
  if (options.entry) {
    for (const script of doc.all('script')) run(script.getAttribute('src'));
  } else {
    context.Rift = {...deps,Renderer:TestRenderer};
    run('js/app.js');
  }
  function frame(ms = 1000/60) {
    time += ms;
    for (const [id,timer] of timers) if (timer.due <= time) { timers.delete(id); timer.fn(); }
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(fn => fn(time));
  }
  const api = {
    byId,doc,win,context,frames,contextRequests,frame,
    get renderer() { return renders.at(-1); },
    get match() { return renders.at(-1)?.match; },
    get portraitCount() { return portraitCount; },
    key: (key,extra = {}) => doc.emit('keydown',{key,...extra}),
    click: id => byId(id).click(),
    advance(n,ms = 1000/60) { for (let i=0; i<n; i++) frame(ms); },
    point(x,z) {
      const [u,v] = this.renderer.project(x,.16,z), rect = field.getBoundingClientRect();
      return {clientX:rect.left+u*rect.width, clientY:rect.top+v*rect.height};
    }
  };
  frame(0);
  return api;
}
module.exports = {boot,root,html,deps};
