'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const Tide = require('../js/tide.js');
const Q = require('../js/quay.js');
const City = require('../js/city.js');
const G = require('../js/mesh.js');
const M = require('../js/math.js');

function close(a, b, tolerance = 1e-6) { assert.ok(Math.abs(a - b) < tolerance, a + ' vs ' + b); }

test('the tide staff reads both slack waters, crossings and the same level on earlier or later laps', () => {
  for (const [time, height, label, level] of [
    [0, 0, 'Rising tide', '0.00 m'], [45, 0.86, 'High tide', '+0.86 m'],
    [90, 0, 'Falling tide', '0.00 m'], [135, -0.86, 'Low tide', '−0.86 m']
  ]) {
    for (const lap of [-19, -1, 0, 1, 18571]) {
      const t = time + Tide.period * lap, reading = Tide.reading(t);
      close(Tide.heightAt(t), height);
      close(reading.height, height);
      assert.equal(reading.label, label);
      assert.equal(reading.level, level);
    }
  }
  assert.equal(Tide.reading(-0.01).level, '0.00 m');
  for (let t = -183; t < 183; t += 0.73) {
    const h = Tide.heightAt(t), next = Tide.heightAt(t + 0.01);
    assert.ok(Math.abs(h) <= Tide.amplitude);
    assert.ok(Math.abs(next - h) < 0.00031);
  }
});

test('the gangway meets the fixed quay and the floating deck at every water level', () => {
  const {start, end, height, weight} = Tide.gangway(Q.shoreZ), pier = Tide.landing;
  assert.ok(start < Q.shoreZ(pier.gateX) && end > pier.z - pier.depth / 2);
  assert.ok(pier.gateX - 1 > pier.x - pier.width / 2 && pier.gateX + 1 < pier.x + pier.width / 2);
  for (const level of [-Tide.amplitude, 0, 0.41, Tide.amplitude]) {
    close(height(start, level), 1.35);
    close(height(end, level), pier.freeboard + level);
    close(height((start + end) / 2, level), (1.35 + pier.freeboard + level) / 2);
    assert.equal(weight(start - 1), 0);
    assert.equal(weight(end + 1), 1);
    for (let i = 0; i <= 10; i++) assert.ok(height(M.mix(start, end, i / 10), level) > level);
  }
});

test('pier vertices encode rigid flotation, a hinged walking surface and fixed gauge piles in one batch', () => {
  const mesh = new G.Mesh();
  Tide.addLanding(mesh, Q.shoreZ);
  const chunks = mesh.finish();
  assert.equal(chunks.length, 1);
  const {vertices, indices} = chunks[0], pier = Tide.landing;
  const ramp = Tide.gangway(Q.shoreZ), slope = 1 / (ramp.end - ramp.start);
  const fixed = [], deck = [], walkway = [];
  for (let i = 0; i < vertices.length; i += G.STRIDE) {
    const [x,y,z,nx,ny,nz,w,d,tile] = vertices.subarray(i, i + 9);
    if (tile === -1 || tile === -2) { fixed.push([x,y,z]); continue; }
    assert.ok(tile === -5 || tile === -6);
    if (d === 0) {
      assert.equal(w, 1);
      deck.push([x,y,z]);
    } else {
      close(d, slope);
      close(w, ramp.weight(z));
      if (ny > 0.95 && Math.abs(x - pier.gateX) > 0.99 && Math.abs(y - ramp.height(z, 0)) < 1e-5) {
        for (const level of [-Tide.amplitude, Tide.amplitude]) {
          close(y + level * w, ramp.height(z, level));
          const dz = ramp.end - ramp.start, dy = ramp.height(ramp.end, level) - ramp.height(ramp.start, level);
          close(M.dot([nx, ny, nz - ny * level * d], [0, dy, dz]), 0);
        }
        walkway.push(z);
      }
    }
  }
  assert.ok(indices.every(i => i < vertices.length / G.STRIDE));
  assert.ok(deck.some(([,y]) => Math.abs(y - pier.freeboard) < 1e-6));
  assert.ok(deck.some(([,y]) => y > pier.freeboard + 2.8));
  assert.ok(fixed.some(([,y]) => y < -Tide.amplitude) && fixed.some(([,y]) => y > 3));
  assert.ok(walkway.some(z => Math.abs(z - ramp.start) < 1e-5));
  assert.ok(walkway.some(z => Math.abs(z - ramp.end) < 1e-5));
});

test('the floating pier and its guide piles clear the full swept hull of each vessel', () => {
  const pier = Tide.landing;
  for (const [pose, scale, period] of [[City.ferryPose, 1, 240], [t => City.ferryPose(t, 1), 0.64, 210], [City.junkPose, 1, 280]]) {
    for (let t = 0; t < period; t += 0.25) {
      const {x, z, angle} = pose(t), c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
      const halfX = scale * (7.25 * c + 1.7 * s), halfZ = scale * (7.25 * s + 1.7 * c);
      assert.ok(Math.abs(x - pier.x) > pier.width / 2 + 0.85 + halfX ||
        z - halfZ > pier.z + pier.depth / 2 + 0.2);
    }
  }
});
