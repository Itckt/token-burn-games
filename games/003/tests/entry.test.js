'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {parse} = require('./harness/dom');
const {boot,html,root} = require('./harness/page');
const {recordingGL} = require('./harness/gl');

test('the file entry point references every local script exactly once and resolves its styles and icons', () => {
  const doc = parse(html), scripts = doc.all('script');
  const paths = scripts.map(s => s.getAttribute('src'));
  assert.deepEqual([...paths].sort(),fs.readdirSync(path.join(root,'js')).filter(f => f.endsWith('.js')).map(f => 'js/'+f).sort());
  for (const script of scripts) {
    assert.equal(script.getAttribute('defer'),'');
    assert.equal(script.getAttribute('type'),null);
  }
  const style = doc.all('link').find(l => l.getAttribute('rel') === 'stylesheet');
  assert.equal(style.getAttribute('href'),'style.css');
  const css = fs.readFileSync(path.join(root,'style.css'),'utf8');
  assert.doesNotMatch(css,/@import\b|url\(\s*['"]?(?:https?:|\/\/)/i);
  for (const el of doc.all('use')) {
    const target = el.getAttribute('href');
    assert.ok(target.startsWith('#') && doc.getElementById(target.slice(1)),'unknown symbol ' + target);
  }
  for (const src of paths) {
    assert.match(src,/^js\/[\w-]+\.js$/);
    const code = fs.readFileSync(path.join(root,src),'utf8');
    assert.doesNotMatch(code,/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|import)\s*\(/);
    for (const [,id] of code.matchAll(/byId\('([^']+)'\)/g)) assert.ok(doc.getElementById(id),'missing control ' + id);
  }
  assert.match(html,/<noscript>/);
});

test('index.html loads its scripts in a browser-style global scope and supports a local match', () => {
  const g = recordingGL(), p = boot({entry:true,gl:g.gl});
  assert.equal(p.context.require,undefined);
  assert.equal(p.context.module,undefined);
  assert.equal(p.byId('phase-text').textContent,'STANDBY');
  assert.equal(p.byId('overlay').hidden,true);
  assert.deepEqual(p.contextRequests.map(e => e.name),['webgl']);
  assert.equal(p.portraitCount,p.context.Rift.roster.CARDS.length);
  assert.equal(p.frames.size,1);
  p.key('3');
  p.click('lane-b');
  p.advance(4);
  assert.equal(p.byId('energy-number').textContent,'4');
  assert.match(p.byId('feed-message').textContent,/Prism Wasp in Lane B/);
  assert.equal(p.byId('phase-text').textContent,'LIVE MATCH');
  assert.ok(g.draws.length > 50);
  assert.equal(g.draws.at(-1).framebuffer,null);
});

test('without WebGL the real page displays actionable recovery, blocks deployment and keeps help usable', () => {
  const options = {entry:true}, p = boot(options);
  assert.equal(p.byId('overlay').hidden,false);
  assert.equal(p.byId('overlay-title').textContent,'WebGL is unavailable');
  assert.match(p.byId('overlay-body').textContent,/hardware acceleration/);
  assert.ok(p.byId('lane-b').disabled && p.byId('pause-button').disabled);
  p.key('q');
  p.key('p');
  assert.equal(p.byId('phase-text').textContent,'OFFLINE');
  assert.equal(p.byId('energy-number').textContent,'7');
  assert.equal(p.frames.size,0);
  p.click('help-button');
  assert.equal(p.byId('dialog-heading').textContent,'How to play');
  p.click('dialog-done');
  options.gl = recordingGL().gl;
  p.click('overlay-main');
  p.frame();
  assert.equal(p.byId('overlay').hidden,true);
  p.click('lane-a');
  assert.equal(p.byId('phase-text').textContent,'LIVE MATCH');
});

test('a failed resize releases partial GPU resources and retry preserves the active match', () => {
  const limits = {}, g = recordingGL(limits), p = boot({entry:true,gl:g.gl});
  p.key('q');
  limits.rejectTarget = g.targets.length+2;
  p.byId('field').clientWidth += 100;
  p.frame();
  assert.equal(p.byId('overlay-title').textContent,'Arena graphics unavailable');
  assert.equal(p.frames.size,0);
  assert.ok(g.targets.every(t => t.deleted && t.tex.deleted && (!t.depth || t.depth.deleted)));
  assert.ok(g.programs.every(prog => prog.deleted));
  assert.ok(g.uploads.every(buf => buf.deleted));
  delete limits.rejectTarget;
  p.click('overlay-main');
  p.frame();
  assert.equal(p.byId('overlay-title').textContent,'Match paused');
  assert.equal(p.byId('energy-number').textContent,'5');
  p.click('overlay-main');
  assert.equal(p.byId('phase-text').textContent,'LIVE MATCH');
});
