'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/math');
const {Builder, STRIDE, outline, rgb} = require('../js/mesh');
const {CARDS, LANES, TOWER_X} = require('../js/battle');
const models = require('../js/models');
const arena = require('../js/arena');

function near(actual, expected, tolerance = 1e-5) {
  assert.ok(Math.abs(actual - expected) <= tolerance, actual + ' differs from ' + expected);
}
function nearArray(actual, expected, tolerance) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, i) => near(actual[i], value, tolerance));
}
function vertex(data, i, offset = 0) {
  return Array.from(data.subarray(i * STRIDE + offset, i * STRIDE + offset + 3));
}
function inspectMesh(data) {
  assert.ok(data instanceof Float32Array);
  assert.ok(data.length > 0);
  assert.equal(data.length % (3 * STRIDE), 0);
  assert.ok(data.every(Number.isFinite));
  let volume = 0;
  for (let i = 0; i < data.length / STRIDE; i += 3) {
    const a = vertex(data, i), b = vertex(data, i + 1), c = vertex(data, i + 2);
    const face = M.cross(M.sub(b, a), M.sub(c, a));
    assert.ok(Math.hypot(...face) > 0, 'degenerate triangle');
    const n = M.normalize(face);
    for (let j = i; j < i + 3; j++) {
      const normal = vertex(data, j, 3), color = vertex(data, j, 6);
      nearArray(normal, n, .002);
      assert.ok(color.every(v => v >= 0 && v <= 1));
      assert.ok(data[j * STRIDE + 9] >= 0);
    }
    volume += M.dot(a, M.cross(b, c)) / 6;
  }
  return volume;
}

test('vector operations preserve handedness and safely normalize zero', () => {
  nearArray(M.cross([1,0,0], [0,1,0]), [0,0,1]);
  nearArray(M.sub([4,-1,3], [1,2,-2]), [3,-3,5]);
  nearArray(M.normalize([3,4,0]), [.6,.8,0]);
  nearArray(M.normalize([0,0,0]), [0,0,0]);
  near(M.dot([1,-2,3], [4,2,1]), 3);
  near(M.lerp(3,9,.25), 4.5);
  assert.equal(M.clamp(-3,0,4), 0);
  assert.equal(M.clamp(12,0,4), 4);
});

test('column-major multiplication applies scale, rotation, then translation', () => {
  const quarter = Math.PI / 2;
  nearArray(M.transformPoint(M.rotationX(quarter), [0,1,0]), [0,0,1]);
  nearArray(M.transformPoint(M.rotationZ(quarter), [1,0,0]), [0,1,0]);
  const model = M.multiply(M.translation(4,5,6), M.multiply(M.rotationY(quarter), M.scaling(2,3,4)));
  nearArray(M.transformPoint(model, [1,2,3]), [16,11,4]);
  nearArray(M.multiply(model, M.inverse(model)), M.identity());
  nearArray(M.multiply(M.inverse(model), model), M.identity());
  assert.equal(M.inverse(M.scaling(1,0,1)), null);
  const w = M.identity();
  w[15] = 2;
  nearArray(M.transformPoint(w, [2,4,6]), [1,2,3]);
});

test('view and orthographic projection map their reference points to clip space', () => {
  const eye = [3,4,5], target = [-1,1,0], view = M.lookAt(eye, target);
  nearArray(M.transformPoint(view, eye), [0,0,0]);
  nearArray(M.transformPoint(view, target), [0,0,-Math.hypot(4,3,5)]);
  const p = M.ortho(-4,6,-3,7,2,12);
  nearArray(M.transformPoint(p, [-4,-3,-2]), [-1,-1,-1]);
  nearArray(M.transformPoint(p, [6,7,-12]), [1,1,1]);
  assert.equal(M.groundPoint(M.identity(), 0, 0), null);
});

test('arena cameras frame the full board and all relay health bars during the transition', () => {
  for (const [w,h] of [[320,215],[860,360],[1440,640],[1920,540]]) {
    for (const view of [0,.25,.5,.75,1]) for (const drift of [-.028,.028]) {
      const {vp,inverse} = arena.camera(w,h,view,drift);
      nearArray(M.multiply(vp,inverse), M.identity(), 1e-4);
      const points = [];
      for (const x of [-9.4,9.4]) for (const z of [-4.42,4.42]) points.push([x,-.96,z], [x,.24,z]);
      for (const x of [-TOWER_X,TOWER_X]) for (const z of LANES) points.push([x,2.9,z]);
      for (const point of points) {
        const clip = M.transformPoint(vp,point);
        assert.ok(clip.every(v => Math.abs(v) < 1), 'clipped ' + point + ' at ' + [w,h,view,drift]);
      }
      for (const x of [-6,0,6]) for (let lane = 0; lane < 2; lane++) {
        const p = [x,.16,LANES[lane]], clip = M.transformPoint(vp,p);
        const picked = M.groundPoint(inverse,clip[0],clip[1],.16);
        nearArray(picked,p,.00003);
        assert.equal(arena.pickLane(picked), lane);
      }
    }
  }
});

test('lane picking leaves the divider and the surrounding city inactive', () => {
  for (const p of [null, [], [0,0,NaN], [NaN,0,2], [0,0,0], [-9.43,0,2], [6,0,-4.44]]) assert.equal(arena.pickLane(p), null);
  assert.equal(arena.pickLane([0,0,-.58]), 0);
  assert.equal(arena.pickLane([0,0,.58]), 1);
});

test('seeded random streams replay exactly and remain in the half-open unit interval', () => {
  const a = M.seeded(2026), b = M.seeded(2026), c = M.seeded(2027);
  const stream = Array.from({length: 500}, a);
  assert.deepEqual(stream, Array.from({length: 500}, b));
  assert.notDeepEqual(stream, Array.from({length: 500}, c));
  assert.ok(stream.every(n => n >= 0 && n < 1));
});

test('box caps, bevels, outline clamping and materials form outward triangles', () => {
  const b = new Builder();
  const data = b.box(3,1,-2,2,4,6,'#ff8040',0,0,.6).finish();
  assert.equal(data.length, 12 * 3 * STRIDE);
  near(inspectMesh(data), 48);
  nearArray(vertex(data,0,6), [1,128/255,64/255]);
  near(data[9], .6);
  assert.deepEqual(rgb([.1,.2,.3]), [.1,.2,.3]);
  const octagon = outline(2,4,100);
  assert.equal(octagon.length, 8);
  assert.ok(octagon.every(([x,z]) => Math.abs(x) <= 1 && Math.abs(z) <= 2));
  const volume = inspectMesh(new Builder().box(0,0,0,2,4,6,'#ffffff',.23,.18).finish());
  assert.ok(volume > 40 && volume < 48);
});

test('cylinders, arbitrary-axis tubes, cones and polygon extrusions have correct signed volume', () => {
  const sides = 8, area = sides * Math.sin(M.TAU/sides) / 2;
  near(inspectMesh(new Builder().cylinder(0,0,0,1,1,3,sides,'#ffffff').finish()), area*3);
  near(inspectMesh(new Builder().cylinder(0,0,0,1,0,3,sides,'#ffffff').finish()), area);
  near(inspectMesh(new Builder().tube([1,2,3],[4,6,3],1,1,sides,'#ffffff').finish()), area*5);
  near(inspectMesh(new Builder().poly([[-1,-1],[-1,1],[1,1],[1,-1]],0,2,'#ffffff').finish()), 8);
  assert.equal(new Builder().tube([1,1,1],[1,1,1],1,1,8,'#ffffff').finish().length, 0);
});

test('nested mesh groups restore the parent transform, including when a callback throws', () => {
  const b = new Builder();
  const tri = g => g.tri([0,0,0],[1,0,0],[0,1,0],'#ffffff');
  b.group(3,0,0,0,0,0,g => g.group(0,2,0,Math.PI/2,0,0,tri));
  assert.throws(() => b.group(25,0,0,0,0,0,() => { throw new Error('stop'); }), /stop/);
  tri(b);
  b.tri([0,0,0],[1,0,0],[2,0,0],'#ffffff');
  const data = b.finish();
  assert.equal(data.length, 6 * STRIDE);
  nearArray(vertex(data,0), [3,2,0]);
  nearArray(vertex(data,1), [3,2,-1]);
  nearArray(vertex(data,3), [0,0,0]);
});

test('every card, faction model and relay crystal has finite lit geometry with distinct paint', () => {
  for (const card of CARDS) {
    const portrait = models.unit(card.id), ally = models.unit(card.id,0), rival = models.unit(card.id,1);
    assert.ok(inspectMesh(portrait) > 0);
    assert.equal(ally.length, portrait.length);
    assert.equal(ally.length, rival.length);
    assert.notDeepEqual(ally, rival);
    for (let i=0; i<ally.length; i+=STRIDE) nearArray(ally.subarray(i,i+6), rival.subarray(i,i+6));
  }
  for (const team of [0,1]) {
    assert.ok(inspectMesh(models.tower(team)) > 0);
    assert.ok(inspectMesh(models.crystal(team)) > 0);
  }
  assert.throws(() => models.unit('unknown'), /Unknown unit/);
});

test('static scenery is reproducible and fits a bounded two-mesh triangle budget', () => {
  const board = arena.board(), city = arena.city(842);
  assert.ok(board.every(Number.isFinite) && city.every(Number.isFinite));
  assert.deepEqual(city, arena.city(842));
  assert.deepEqual(board, arena.board());
  const triangles = (board.length + city.length) / (STRIDE * 3);
  assert.ok(Number.isInteger(triangles) && triangles > 0 && triangles < 70000);
});

test('card portraits center the full silhouette, including feet, wings and antennae', () => {
  for (const card of CARDS) {
    const data = models.portrait(card.id);
    for (const aspect of [1,440/284,2]) {
      const {vp} = arena.portraitCamera(data,aspect);
      let minX = 1, maxX = -1, minY = 1, maxY = -1;
      for (let i=0; i<data.length/STRIDE; i++) {
        const [x,y,z] = M.transformPoint(vp,vertex(data,i));
        assert.ok(Math.abs(z) <= 1);
        minX=Math.min(minX,x); maxX=Math.max(maxX,x);
        minY=Math.min(minY,y); maxY=Math.max(maxY,y);
      }
      near(minX+maxX,0);
      near(minY+maxY,0);
      assert.ok(Math.max(maxX,maxY) > .88 && Math.max(maxX,maxY) < .93);
    }
  }
});

test('the cargo sled, delivery arch and both twins in the card portrait have bounded, outward geometry', () => {
  for (const data of [models.unit('carrier',0), models.deliveryGate(), models.portrait('splitpin')]) {
    assert.ok(inspectMesh(data) > 0);
    assert.ok(data.length / (3 * STRIDE) < 6000);
  }
  assert.equal(models.portrait('splitpin').length, 2 * models.unit('splitpin').length);
});

test('freight rail equipment and paired snare posts have compact outward meshes inside the board', () => {
  const F = require('../js/freight'), B = require('../js/battle');
  const track = models.freightTrack(F.DOCK), cart = models.freightCart(), coil = models.snareCoil();
  for (const mesh of [track,cart,coil]) {
    assert.ok(inspectMesh(mesh) > 0);
    assert.ok(mesh.length / (3 * STRIDE) < 1800);
  }
  for (let lane = 0; lane < 2; lane++) {
    for (let i = 0; i < track.length; i+=STRIDE) {
      assert.ok(Math.abs(track[i+2] + B.freightRailZ(lane)) < 4.4);
      assert.ok(Math.abs(track[i]) < B.TOWER_X);
    }
  }
});

test('projecting each of the six coil sockets back to the board works for both cameras and a narrow viewport', () => {
  const C = require('../js/coils');
  for (const [w,h] of [[320,215],[1200,480]]) for (const view of [0,.5,1]) {
    const camera = arena.camera(w,h,view,-.025);
    LANES.forEach((z, lane) => C.SOCKETS.forEach((x, socket) => {
      const [nx,ny] = M.transformPoint(camera.vp,[x,.16,z]);
      assert.deepEqual(arena.pickSite(M.groundPoint(camera.inverse,nx,ny,.16)),{lane,socket});
    }));
  }
  for (const p of [null,[0,0,0],[10,0,LANES[0]],[NaN,0,LANES[1]]]) assert.equal(arena.pickSite(p),null);
  for (const x of [-1.8,0,1.8]) assert.equal(C.nearestSocket(x),1);
  for (const x of [NaN,Infinity,null,'0']) assert.equal(C.nearestSocket(x),null);
});
