'use strict';
// A bounded trip through the file entry point, its real renderer and the cab controls.
const assert = require('node:assert/strict');
const { makePage } = require('./support/page.js');
const { RecordingGL } = require('./support/recording-gl.js');

const gl = new RecordingGL();
const page = makePage({ gl, capture: false });
const value = id => page.id(id).textContent;
let sawWetViaduct = false, sawLimit = false;

function tap(code) { page.key(code); page.key(code, 'keyup'); }
function reach(description, check, seconds = 75) {
  for (let i = 0; i < seconds * 10 && !check(); i++) {
    page.run(1, 100);
    sawWetViaduct ||= gl.uniforms.uWeather[1] > 0.3 && gl.draws.some(draw => draw.state.uSky);
    sawLimit ||= value('posted-speed') === '40' && value('target-value') === '80';
  }
  assert.ok(check(), description);
}
function dispatch() {
  reach('passenger exchange completes', () => value('guard-instruction').includes('Exchange complete'));
  tap('KeyD');
  reach('doors prove closed', () => !page.id('departure-bell').disabled);
  tap('KeyB');
}

page.run();
assert.ok(page.id('scene-error').hidden && gl.draws.length > 0);
assert.equal(value('track-place'), 'Kowloon Tong');
const duty = page.id('duty-select'); duty.value = 'smooth'; duty.fire('change');
for (const code of ['KeyN', 'KeyT', 'KeyG', 'KeyZ', 'KeyJ', 'KeyV']) tap(code);
assert.equal(value('service-clock'), '23:58');
for (let i = 0; i < 8; i++) tap('ArrowUp');
tap('KeyD'); dispatch(); tap('KeyR');
reach('red signal holds the train', () => value('drive-state') === 'Signal hold');
assert.equal(value('door-state'), 'Closed'); assert.equal(value('posted-speed'), '40');
tap('KeyP'); page.run();
const heldTime = value('service-clock'); page.run(2, 60000);
assert.equal(value('service-clock'), heldTime); assert.equal(page.frames.size, 0);
tap('KeyP');
tap('KeyI');
reach('the saloon announces Campus Gate', () => value('saloon-english') === 'Arriving · Campus Gate');
assert.deepEqual(gl.uniforms.uPassengerRows, [1, page.api.saloon.stages.find(stage => stage.key === 'arriving').row]);
reach('arrival is recorded at Campus Gate', () => !page.id('cab-recorder').hidden);
const cells = page.id('sheet-rows').children[0].children;
assert.equal(cells[0].textContent, 'Campus Gate'); assert.equal(cells[3].textContent, 'On time');
assert.ok(sawWetViaduct && sawLimit);
assert.equal(page.id('duty-result').dataset.passed, 'true');
assert.match(value('review-forces'), /m\/s²/); assert.equal(gl.textureUploads, 2);
page.id('run-sheet').open = true; page.id('run-sheet').fire('toggle');
assert.ok(page.lines.some(line => line.ink === '#aebcf3'));
tap('KeyV'); dispatch();
reach('the following leg starts', () => value('next-name') === 'Junction Road' && parseInt(value('distance')) < 430);
tap('KeyP'); page.run();
assert.equal(page.frames.size, 0); assert.equal(value('feed-text'), 'Paused');
console.log('Kowloon Tong to Campus Gate in ' + cells[1].textContent + ', arriving at ' + cells[7].textContent +
  '. Signal hold, 40 km/h board, saloon announcement, steady-carriage duty and second dispatch checked.');
