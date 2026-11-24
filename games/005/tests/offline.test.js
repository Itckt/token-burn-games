'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL,fileURLToPath} = require('node:url');
const {root,html,scripts,read} = require('./support/page.cjs');
const L = require('../js/lesson.js');
const P = require('../js/packing.js');

test('every runtime script is referenced exactly once and resolves next to the local HTML file', () => {
  const url = pathToFileURL(path.join(root,'index.html'));
  const files = fs.readdirSync(path.join(root,'js')).filter(n => n.endsWith('.js')).map(n => 'js/'+n);
  assert.deepEqual([...scripts].sort(),files.sort());
  const tags = [...html.matchAll(/<script\b[^>]*>/gi)].map(m => m[0]);
  assert.equal(tags.length,scripts.length);
  for (const tag of tags) {
    assert.match(tag,/\bdefer\b/);
    assert.doesNotMatch(tag,/\b(module|async)\b/);
  }
  for (const [,ref] of html.matchAll(/\b(?:href|src)="([^"]+)"/gi)) {
    if (ref.startsWith('#') || ref==='data:,') continue;
    const asset = new URL(ref,url);
    assert.equal(asset.protocol,'file:');
    const local = fileURLToPath(asset);
    assert.ok(!path.relative(root,local).startsWith('..'));
    assert.ok(fs.statSync(local).isFile(),ref);
  }
});

test('runtime assets are self-contained and use local classic-script dependencies', () => {
  assert.doesNotMatch(read('style.css'),/@import\b|url\s*\(\s*["']?(?:https?:|\/\/)/i);
  for (const file of scripts) {
    const code = read(file);
    assert.doesNotMatch(code,/\b(fetch|XMLHttpRequest|WebSocket|EventSource|Worker|sendBeacon|importScripts)\s*\(|\bimport\s*\(/);
    for (const [,ref] of code.matchAll(/\brequire\(['"]([^'"]+)['"]\)/g)) {
      assert.ok(ref.startsWith('./'));
      assert.ok(fs.existsSync(path.resolve(root,path.dirname(file),ref)));
    }
  }
  assert.doesNotMatch(html,/<(?:base|iframe|object|embed)\b/i);
});

test('all static and generated icons resolve, and accessible labels point to existing elements', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const unique = new Set(ids);
  assert.equal(ids.length,unique.size);
  for (const m of html.matchAll(/\bhref="#([^"]+)"/g)) assert.ok(unique.has(m[1]),m[1]);
  for (const m of html.matchAll(/\b(?:aria-labelledby|aria-controls|aria-describedby|for)="([^"]+)"/g)) {
    for (const id of m[1].split(/\s+/)) assert.ok(unique.has(id),id);
  }
  for (const step of L.steps) assert.ok(unique.has('i-'+step.icon));
  assert.ok(unique.has('i-pause') && unique.has('i-play') && unique.has('i-reset'));
  assert.match(html,/<dialog\b[^>]*aria-labelledby=/);
  assert.match(html,/<div id="caption-region"[^>]*aria-live="polite"/);
  assert.match(html,/<canvas id="scene"[^>]*tabindex="0"/);
  assert.match(html,/<input id="scrubber"[^>]*aria-label=/);
  assert.match(html,/<noscript>/);
});

test('the bench slider and on-screen help match the implemented study controls', () => {
  const range=html.match(/<input\b[^>]*\bid="diameter"[^>]*>/)[0];
  for (const [key,value] of Object.entries({type:'range',min:P.minDiameter,max:P.maxDiameter,step:1,value:P.defaultDiameter})) {
    assert.ok(range.includes(key+'="'+value+'"'),key);
  }
  const help=html.match(/<dialog\b[\s\S]*?<\/dialog>/)[0];
  assert.match(help,/packing bench[\s\S]*?<kbd>B<\/kbd>/);
  assert.match(help,/Trace immersion[\s\S]*?<kbd>T<\/kbd>/);
  assert.match(html,/<p class="check-feedback"[^>]*role="status"/);
  assert.match(html,/<p class="bench-result"[^>]*aria-live="polite"/);
});

test('the initial HTML agrees with the first chapter before JavaScript starts', () => {
  assert.ok(html.includes('id="step-title">'+L.steps[0].title+'<'));
  assert.ok(html.includes('id="step-caption">'+L.steps[0].caption+'<'));
  assert.ok(html.includes('id="duration">'+L.formatTime(L.duration)+'<'));
  assert.match(html,/<meta charset="utf-8">/i);
});

test('study speed choices, instrument ranges and on-screen help describe the shipped controls', () => {
  const menu=html.match(/<select id="speed">([\s\S]+?)<\/select>/)[1];
  const choices=[...menu.matchAll(/<option value="([^"]+)"/g)].map(m=>Number(m[1]));
  assert.deepEqual(choices,L.rates);
  assert.match(menu,/<option value="1" selected>/);
  assert.match(html,/<button[^>]*id="repeat"[^>]*aria-pressed="false"/);
  assert.match(html,/<input id="scan-height"[^>]*min="0" max="100" step="1"/);
  assert.match(html,/<input id="dose"[^>]*min="0"[^>]*step="1"/);
  const help=html.match(/<dialog\b[\s\S]*?<\/dialog>/)[0];
  for (const word of ['Speed menu','Slice scanner','Metered pour','Repeat step','<kbd>L</kbd>']) assert.ok(help.includes(word));
  for (const id of ['speed','scan-height','dose']) assert.ok(html.includes('<label for="'+id+'">'));
});
