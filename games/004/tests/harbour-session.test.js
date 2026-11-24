'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {loadPage} = require('./support/page.js');
const V = require('../js/vessels.js');

test('seed 852 flies, boards the ferry, watches a delivery, photographs the beacon and comes to rest', () => {
  const p = loadPage({address:'#seed=852'});
  const live = () => p.gl.draws.find(d => d.uniforms.uTime && d.uniforms.uMirror[0] === 1).uniforms;
  p.ready(); p.tick();
  for (let i = 0; i < 60; i++) p.tick();
  assert.ok(Math.abs(live().uTime[0] - 1) < 1e-7);
  p.key('4');
  for (let i = 0; i < 20; i++) p.tick(100);
  assert.equal(p.id('flight-label').textContent, 'ON DECK');
  assert.deepEqual(live().uEye, V.deckView(live().uTime[0]).eye);
  p.key(' '); p.tick(0);

  const lookout = p.id('lookout');
  lookout.value = 'cargo'; lookout.emit('change');
  p.key('n'); p.tick();
  assert.equal(p.id('lookout-call').textContent, 'Landed on barge');
  assert.equal(live().uTime[0], 12);
  p.key('w');
  lookout.value = 'beacon'; lookout.emit('change');
  p.id('next-event').emit('click');
  for (let i = 0; i < 21; i++) p.tick(100);
  assert.equal(p.id('lookout-call').textContent, 'Lens bearing · E');
  assert.equal(p.id('weather').value, 'mist');
  assert.equal(p.id('elapsed').textContent, '00:17');
  assert.equal(p.frames.size, 0);

  p.key('p');
  assert.equal(p.id('save-postcard').download, 'nightferry-852-ferry-deck-00-17.png');
  p.id('close-postcard').emit('click'); p.tick();
  const shot = live();
  p.canvas.emit('webglcontextlost');
  assert.equal(p.canvas.dataset.status, 'unavailable');
  p.canvas.emit('webglcontextrestored'); p.tick(); p.ready();
  assert.deepEqual(live().uEye, shot.uEye);
  assert.deepEqual(live().uForward, shot.uForward);
  assert.equal(live().uTime[0], 17.5);
  assert.equal(p.frames.size, 0);
  assert.equal(p.blobUrls.size, 0);
  assert.deepEqual(p.errors, []);
});
