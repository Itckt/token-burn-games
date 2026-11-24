'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {layout} = require('../js/postcard.js');
const {html, loadPage} = require('./support/page.js');

test('postcards preserve the full frame aspect and bound the export on wide, narrow and collapsed viewports', () => {
  for (const [w, h] of [[960,480],[390,690],[1,1],[8000,1000],[256,12000],[1,4096]]) {
    const c = layout(w, h);
    assert.ok(c.width >= c.photoWidth + 2 * c.margin);
    assert.ok(c.height >= c.photoHeight + 2 * c.margin + c.titleSize + c.smallSize);
    assert.ok(Math.max(c.photoWidth, c.photoHeight) <= 2048);
    const scale = Math.min(1, 2048 / Math.max(w, h));
    assert.ok(Math.abs(c.photoWidth - w * scale) < 1 && Math.abs(c.photoHeight - h * scale) < 1);
  }
  for (const dims of [[0,0], [-1,2], [NaN,100], [100,Infinity]]) assert.throws(() => layout(...dims), RangeError);
});

function lastWorldTime(page) {
  return page.gl.draws.findLast(d => d.uniforms.uTime && d.uniforms.uMirror[0] === 1).uniforms.uTime[0];
}

test('taking a postcard captures the current WebGL frame, produces a local PNG link and resumes at the same instant', () => {
  const p = loadPage({address:'#seed=852', width:900, height:540}); p.ready(); p.tick();
  p.key('2');
  p.id('timeline').value = 250; p.id('timeline').emit('input'); p.tick(50);
  const time = lastWorldTime(p), draws = p.gl.totalDraws;
  p.key('P');
  const dialog = p.id('postcard-dialog'), preview = p.id('postcard-preview'), save = p.id('save-postcard');
  const {width, height, photoWidth, photoHeight, margin} = layout(p.canvas.width, p.canvas.height);
  assert.ok(dialog.open && !save.hidden && !preview.hidden);
  assert.ok(p.gl.totalDraws > draws);
  assert.equal(lastWorldTime(p), time);
  assert.equal(preview.ink.image, p.canvas);
  assert.deepEqual(preview.ink.blit, [Math.floor((width - photoWidth) / 2), margin, photoWidth, photoHeight]);
  assert.deepEqual([preview.width, preview.height], [width, height]);
  assert.ok(preview.ink.words.includes('Neon passage  /  00:24  ·  Seed 852'));
  assert.equal(p.blobUrls.get(save.href).type, 'image/png');
  assert.equal(save.download, 'nightferry-852-neon-passage-00-24.png');
  assert.equal(p.id('postcard-status').textContent, width + ' × ' + height + ' · PNG');
  const captured = p.gl.totalDraws;
  for (const key of ['g', ' ', '1', 'p']) p.key(key);
  p.win.emit('resize'); p.tick(120000);
  assert.equal(p.frames.size, 0);
  assert.equal(p.gl.totalDraws, captured);
  assert.equal(p.location.hash, '#seed=852');
  p.id('close-postcard').emit('click'); p.tick();
  assert.ok(!dialog.open && save.hidden);
  assert.equal(save.href, '');
  assert.equal(p.blobUrls.size, 0);
  assert.equal(lastWorldTime(p), time);
  p.tick(100);
  assert.ok(Math.abs(lastWorldTime(p) - time - 0.1) < 1e-8);
  assert.equal(p.routes[1].getAttribute('aria-pressed'), 'true');
  assert.match(html, /id="postcard"[^>]+aria-haspopup="dialog"/);
  assert.match(html, /<dialog[^>]+aria-labelledby="postcard-title"/);
  assert.ok(html.includes('<kbd>P</kbd>'));
});

test('closing or retaking a paused postcard retires its URL and ignores out-of-order encodes', () => {
  const p = loadPage({reduced:true}); p.ready(); p.tick();
  const preview = p.id('postcard-preview'), dialog = p.id('postcard-dialog'), save = p.id('save-postcard');
  const pending = [];
  preview.toBlob = (done, type) => { assert.equal(type, 'image/png'); pending.push(done); };
  p.id('postcard').emit('click');
  assert.ok(dialog.open && save.hidden);
  dialog.close();
  p.key('3'); p.tick();
  p.key('p');
  const png = new Blob([], {type:'image/png'});
  pending[1](png);
  const current = save.href;
  assert.ok(current && save.download.includes('rooftop-glide'));
  pending[0](png);
  assert.equal(save.href, current);
  assert.equal(p.blobUrls.size, 1);
  dialog.close();
  p.key('p'); dialog.close(); pending[2](png); p.tick(10000);
  assert.equal(p.frames.size, 0);
  assert.equal(p.blobUrls.size, 0);
  assert.equal(p.id('flight-label').textContent, 'PAUSED');
  assert.equal(lastWorldTime(p), 0);
});

test('unavailable postcard encoding leaves the flight usable and a subsequent capture can succeed', () => {
  const p = loadPage({reduced:true}); p.ready(); p.tick();
  const preview = p.id('postcard-preview'), encode = preview.toBlob, save = p.id('save-postcard');
  for (const failure of [done => done(null), () => { throw new Error('Cannot encode'); }]) {
    preview.toBlob = failure; p.key('p');
    assert.ok(save.hidden && p.id('postcard-dialog').open);
    assert.match(p.id('postcard-status').textContent, /failed|could not/);
    p.id('postcard-dialog').close(); p.tick(); p.ready();
  }
  preview.toBlob = encode; p.key('p'); assert.ok(!save.hidden);
  p.id('postcard-dialog').close();
  p.globals.URL.createObjectURL = () => { throw new Error('Local URL allocation failed'); };
  p.key('p');
  assert.ok(save.hidden);
  assert.match(p.id('postcard-status').textContent, /download could not be prepared/);
  p.id('postcard-dialog').close(); p.tick(); p.ready();
  const unsupported = loadPage({reduced:true, noDialog:true}); unsupported.ready(); unsupported.tick();
  assert.ok(unsupported.id('postcard').hidden && unsupported.id('postcard-hint').hidden);
  unsupported.key('p'); assert.equal(unsupported.frames.size, 0);
});
