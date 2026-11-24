'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/mesh.js');
const M = require('../js/math.js');
const C = require('../js/city.js');
const F = require('../js/flight.js');
const Q = require('../js/quay.js');
const {projectFrom} = require('./support/projection.js');

const {checkChunk} = require('./support/mesh.js');

test('boxes have outward faces, world-scale wall UVs and a separate roof material', () => {
  const mesh = new G.Mesh();
  mesh.box(6,1.5,-2,4,3,2,G.wall(7),G.solid([0.2,0.3,0.4]),5);
  const [chunk] = mesh.finish();
  checkChunk(chunk);
  assert.equal(chunk.vertices.length / G.STRIDE, 24);
  assert.equal(chunk.indices.length, 36);
  const center = [6,3,-2];
  for (let i = 0; i < 24; i++) {
    const v = chunk.vertices.subarray(i*G.STRIDE,(i+1)*G.STRIDE);
    assert.ok(M.dot(M.subtract(Array.from(v.slice(0,3)), center), v.subarray(3,6)) > 0);
    assert.equal(v[8], i < 16 ? 7 : -1);
  }
  assert.deepEqual([0,1,2,3].map(i => Array.from(chunk.vertices.subarray(i*G.STRIDE+6,i*G.STRIDE+8))),
    [[5,0],[9,0],[9,3],[5,3]]);
});

test('beams handle both vertical and diagonal axes with closed, correctly wound caps', () => {
  for (const end of [[1,9,3],[-4,3,12]]) {
    const mesh = new G.Mesh(), start = [1,2,3];
    mesh.beam(start,end,0.4,G.light([1,0.3,0.2]),6);
    const [chunk] = mesh.finish();
    checkChunk(chunk);
    assert.equal(chunk.indices.length/3, 20);
    const top = 4*6*G.STRIDE;
    const axis = M.normalize(M.subtract(end,start));
    assert.ok(M.dot(chunk.vertices.subarray(top+3,top+6),axis) > 0.99999);
    const capPosition = Array.from(chunk.vertices.subarray(top,top+3));
    assert.ok(Math.abs(Math.hypot(...M.subtract(capPosition,end))-0.4) < 1e-6);
  }
});

test('the mesh builder splits at whole faces before a WebGL 1 index can overflow', () => {
  const mesh = new G.Mesh(), material = G.wall(2);
  const points = [[0,0,0],[2,0,0],[2,1,0],[0,1,0]];
  for (let i = 0; i < 16400; i++) mesh.face(points, material);
  const chunks = mesh.finish();
  assert.equal(chunks.length, 2);
  for (const chunk of chunks) checkChunk(chunk);
  assert.equal(chunks.reduce((sum,c) => sum + c.indices.length, 0), 16400*6);
  assert.deepEqual(Array.from(chunks[1].indices.slice(0,6)), [0,1,2,0,2,3]);
  assert.equal(mesh.finish().length, 2);
  assert.deepEqual(new G.Mesh().finish(), []);
});

test('the full shoreline, red-sailed junk and ferry produce finite renderable triangles', () => {
  const world = C.buildWorld(C.generateCity()), junk = C.buildJunk(), ferry = C.buildFerry();
  for (const chunk of [...world,...junk,...ferry]) checkChunk(chunk);
  const tiles = new Set();
  for (const {vertices} of world) {
    for (let i = 8; i < vertices.length; i += G.STRIDE) tiles.add(vertices[i]);
  }
  for (const id of [-3,-2,-1,...Array.from({length:25}, (_,i) => i)]) assert.ok(tiles.has(id), `material ${id}`);
  assert.ok(world.length <= 3 && junk.length === 1 && ferry.length === 1, 'the city and boats stay batched');
  const redSail = Array.from(junk[0].vertices).filter((v,i,a) => i%G.STRIDE === 9 && v > 0.65 && a[i+1] < 0.3);
  assert.ok(redSail.length >= 72);
});

test('sign geometry addresses the correct atlas rectangle with upright canvas lettering', () => {
  const city = C.generateCity(317);
  const seen = new Set();
  for (const {vertices} of C.buildWorld(city)) {
    for (let i = 0; i < vertices.length; i += G.STRIDE) {
      const design = vertices[i+8] - 16;
      if (design < 0) continue;
      seen.add(design);
      const rect = C.signRect(design);
      for (let k = 0; k < 4; k++) {
        const j = i + k*G.STRIDE;
        const u = (rect.x + (k === 1 || k === 2 ? rect.w - 0.5 : 0.5)) / 1024;
        const v = (rect.y + (k < 2 ? rect.h - 0.5 : 0.5)) / 1024;
        assert.equal(vertices[j+6], u);
        assert.equal(vertices[j+7], v);
        assert.equal(vertices[j+5], 1);
      }
      i += 3*G.STRIDE;
    }
  }
  assert.equal(seen.size, C.signDesigns.length);
});

test('the tram, wheel rim and suspended cabins each fit a single indexed draw with valid winding', () => {
  let triangles = 0;
  for (const build of [Q.buildTram, Q.buildWheelRotor, Q.buildWheelCabins]) {
    const parts = build();
    assert.equal(parts.length, 1);
    checkChunk(parts[0]);
    triangles += parts[0].indices.length / 3;
    const materials = new Set(parts[0].vertices.filter((_, i) => i % G.STRIDE === 8));
    assert.deepEqual(materials, new Set(build === Q.buildTram ? [-1, -2, -4] : [-1, -2]));
  }
  assert.ok(triangles < 5000);
});

test('one cargo rig buffer keeps the four cable tops on the trolley while the hook and box move independently', () => {
  const C = require('../js/cargo.js');
  const batches = C.buildRig();
  assert.equal(batches.length, 1);
  const [{vertices, indices}] = batches;
  const pulley = C.rail - 0.7;
  const ropes = new Map();
  for (let i = 0; i < vertices.length; i += G.STRIDE) {
    const [x,y,z] = vertices.subarray(i,i+3), hook = vertices[i+6], load = vertices[i+7];
    assert.ok((hook === 0 || hook === 1) && (load === 0 || load === 1) && hook + load <= 1);
    if (Math.abs(y) > 1e-6 && Math.abs(y - pulley) > 1e-5) continue;
    if (Math.abs(Math.abs(x) - 0.78) > 0.053 || Math.abs(Math.abs(z) - 1.38) > 0.053) continue;
    const key = [Math.sign(x), Math.sign(z)].join(',');
    if (!ropes.has(key)) ropes.set(key, new Set());
    assert.equal(load, 0);
    assert.equal(hook, y < 1 ? 1 : 0);
    ropes.get(key).add(hook);
  }
  assert.equal(ropes.size, 4);
  assert.ok([...ropes.values()].every(ends => ends.size === 2));
  for (const time of [-18, 0, 12, 34, 48]) {
    const rig = C.transfer(time), moved = vertices.slice();
    for (let i = 0; i < moved.length; i += G.STRIDE)
      moved[i+1] += moved[i+6] * rig.hook + moved[i+7] * rig.bottom;
    checkChunk({vertices:moved, indices});
  }
  assert.ok(indices.length / 3 < 700);
});

test('the opening camera frames both the skyline and its reflection, with the junk in the foreground', () => {
  const city = C.generateCity(), shot = F.sampleRoute(0,0);
  for (const aspect of [16/9, 0.65]) {
    const project = projectFrom(shot, aspect);
    const inFrame = point => point.every(n => Math.abs(n) < 1);
    const visible = city.signs.filter(s => inFrame(project([s.x,s.y+s.h/2,s.z])));
    assert.ok(visible.length >= (aspect > 1 ? 8 : 3));
    for (const s of visible) {
      const [x,y] = project([s.x,-s.y-s.h/2,s.z]);
      assert.ok(Number.isFinite(x) && y < project([s.x,0,s.z])[1]);
    }
    const boat = C.junkPose(0);
    assert.ok(inFrame(project([boat.x,4,boat.z])));
    const tower = city.landmarks[0];
    assert.ok(inFrame(project([tower.x,tower.height+7,tower.z])));
    assert.ok(project([tower.x,tower.height,tower.z])[1] > project([boat.x,4,boat.z])[1]);
  }
});

test('the opening shot shows the tram and wheel, and the wheel lookout frames the full orbit on phones and wide screens', () => {
  const state = F.createFlight(true), opening = F.camera(state), tram = Q.tramPose(0), wheel = Q.wheel;
  for (const aspect of [16/9, 0.65]) {
    const openingFrame = projectFrom(opening, aspect);
    for (const point of [[tram.x, tram.y + 2.1, tram.z], [wheel.x, wheel.y, wheel.z]]) {
      assert.ok(openingFrame(point).every(n => Math.abs(n) < 1));
    }
    F.chooseLookout(state, 'wheel');
    for (let route = 0; route < F.routes.length; route++) {
      F.chooseRoute(state, route);
      for (const phase of [0, 0.25, 0.5, 0.75]) {
        F.seek(state, phase);
        const project = projectFrom(F.camera(state), aspect);
        for (let i = 0; i < wheel.cabins; i++) {
          const [x, y] = Q.hanger(i);
          const floor = [wheel.x + x, wheel.y + y - 1.68, wheel.z + 0.7];
          const rim = [wheel.x + x, wheel.y + y, wheel.z + 1];
          assert.ok([floor, rim].every(point => project(point).every(n => Math.abs(n) < 0.95)));
        }
      }
    }
  }
});
