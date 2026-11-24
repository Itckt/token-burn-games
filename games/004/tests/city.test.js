'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/city.js');
const T = require('../js/textures.js');
const Tide = require('../js/tide.js');

test('seeds round-trip from local file URLs with fragments taking priority over queries', () => {
  assert.equal(C.readSeed('',''), C.SEED);
  assert.equal(C.readSeed('?seed=371','#seed=0'), 0);
  assert.equal(C.readSeed('?seed=4294967295',''), 0xffffffff);
  assert.equal(C.readSeed('?seed=22','#district'), 22);
  for (const bad of ['','-1','1e3','42.5','4294967296','notes']) {
    assert.equal(C.readSeed('?seed='+bad,''), C.SEED);
    assert.equal(C.readSeed('?seed=23','#seed='+bad), 23);
  }
});

test('seeds reproduce the entire district and change its blocks and windows', () => {
  assert.deepEqual(C.generateCity(), C.generateCity(C.SEED));
  assert.deepEqual(C.generateCity(-1), C.generateCity(0xffffffff));
  assert.notDeepEqual(C.generateCity(0).buildings, C.generateCity(1).buildings);
  assert.deepEqual(T.facadePattern(2,17), T.facadePattern(2,17));
  assert.notDeepEqual(T.facadePattern(2,17), T.facadePattern(2,18));
  assert.notDeepEqual(T.facadePattern(2,17), T.facadePattern(3,17));
});

test('lots respect the quay, their neighbours and the footprints of the signature towers', () => {
  for (const seed of [0,1,C.SEED,0xffffffff,...Array.from({length:24},(_,i) => i*571)]) {
    const city = C.generateCity(seed);
    assert.ok(city.buildings.length > 160 && city.buildings.length < 320);
    for (let row = 0; row < 5; row++) {
      const lots = city.buildings.filter(b => b.row === row);
      assert.ok(lots.length > 24);
      lots.forEach((b,i) => {
        assert.ok(b.height > 4 && b.width > 4 && b.depth > 5);
        assert.ok(b.z + b.depth/2 < C.shoreZ(b.x) - 4);
        assert.ok(Number.isInteger(b.style) && b.style >= 0 && b.style < 16);
        if (i) assert.ok(lots[i-1].x+lots[i-1].width/2 < b.x-b.width/2);
        for (const tower of city.landmarks) {
          assert.ok(Math.abs(tower.x-b.x) >= (tower.width+b.width)/2+0.59 ||
            Math.abs(tower.z-b.z) >= (tower.depth+b.depth)/2+0.59);
        }
      });
    }
    const occupied = new Set();
    for (const s of city.signs) {
      const mount = city.buildings.find(b => Math.abs(b.z+b.depth/2+(s.vertical ? 1.4 : 0.5)-s.z)<1e-8 &&
        Math.abs(b.x+(s.vertical ? b.width*0.31 : 0)-s.x)<1e-8);
      assert.ok(mount && !occupied.has(mount));
      occupied.add(mount);
      assert.ok(s.y > 1.3 && s.w <= mount.width && s.y+s.h <= mount.height+0.701);
    }
    assert.equal(new Set(city.signs.map(s => s.design)).size, C.signDesigns.length);
  }
});

test('the shore and layered ridgelines are continuous across the rendered waterfront', () => {
  for (let x = -285; x < 285; x++) {
    assert.ok(C.shoreZ(x) < -16 && C.shoreZ(x) > -26);
    assert.ok(Math.abs(C.shoreZ(x+1)-C.shoreZ(x)) < 0.13);
    for (let layer = 0; layer < 3; layer++) {
      const h = C.ridgeHeight(x,layer);
      assert.ok(h > 2 && h < 95);
      assert.ok(Math.abs(C.ridgeHeight(x+1,layer)-h) < 2);
    }
  }
  assert.notEqual(C.ridgeHeight(20,1), C.ridgeHeight(20,2));
});

test('bilingual signs have disjoint padded rectangles inside the power-of-two atlas', () => {
  const designs = C.signDesigns, rects = designs.map((_,i) => C.signRect(i));
  assert.equal(new Set(designs.map(d => d.han)).size, designs.length);
  rects.forEach((r,i) => {
    assert.match(designs[i].han, /\p{Script=Han}/u);
    assert.match(designs[i].latin, /[A-Z]/);
    assert.equal(designs[i].type, r.h > r.w ? 'vertical' : 'horizontal');
    assert.ok(r.x >= 1 && r.y >= 1 && r.x+r.w < 1024 && r.y+r.h < 1024);
    for (const q of rects.slice(0,i)) {
      assert.ok(r.x+r.w < q.x || q.x+q.w < r.x || r.y+r.h < q.y || q.y+q.h < r.y);
    }
  });
});

test('all facade tiles contain occupied and dark windows with repeatable fittings', () => {
  for (let tile = 0; tile < 16; tile++) {
    const cells = T.facadePattern(tile, C.SEED);
    assert.equal(cells.length, T.COLS * T.FLOORS);
    const lit = cells.filter(c => c.lit).length / cells.length;
    assert.ok(lit > 0.18 && lit < 0.70);
    assert.ok(cells.every(c => /^#[\da-f]{6}$/.test(c.color) && c.shade >= 0 && c.shade < 1));
    assert.ok(cells.some(c => c.blind && c.split));
    assert.equal(cells.some(c => c.ac), tile%4 !== 2);
  }
});

test('noise textures have repeatable colour channels, opaque alpha and bounded atlas sizes', () => {
  const noise = T.noisePixels(0,32);
  assert.ok(noise instanceof Uint8Array);
  assert.equal(noise.length,32*32*4);
  assert.deepEqual(noise,T.noisePixels(0,32));
  assert.notDeepEqual(noise,T.noisePixels(1,32));
  assert.ok(noise.every((v,i) => i%4 !== 3 || v === 255));
  assert.ok(new Set(noise.filter((_,i) => i%4 === 0)).size > 240);
  assert.equal(T.atlasSize(2048,4096),2048);
  assert.equal(T.atlasSize(2048,1024),1024);
  assert.equal(T.atlasSize(1024,600),512);
});

test('all three hulls float in the harbour and their headings follow their own paths', () => {
  for (const [sample, period] of [[t=>C.ferryPose(t),240],[t=>C.ferryPose(t,1),210],[C.junkPose,280]]) {
    for (let t = 0; t <= period; t += 1.25) {
      const boat = sample(t), before = sample(t-0.01), after = sample(t+0.01);
      assert.ok(Math.abs(boat.y - Tide.heightAt(t)) <= 0.071 && boat.z > C.shoreZ(boat.x)+10);
      const dx = after.x-before.x, dz = after.z-before.z;
      assert.ok((dx*Math.cos(boat.angle)+dz*Math.sin(boat.angle))/Math.hypot(dx,dz) > 0.99999);
      const nextLap = sample(t+period);
      assert.ok(Math.hypot(nextLap.x-boat.x,nextLap.z-boat.z) < 1e-10);
    }
  }
});
