'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/math.js');
const C = require('../js/camera.js');

function near(a, b, tolerance = 1e-5) { assert.ok(Math.abs(a-b) <= tolerance, a + ' vs ' + b); }
function transform(m, v) {
  return [0,1,2,3].map(row => v.reduce((sum, x, col) => sum + m[4*col+row]*x, 0));
}

test('clamping and positive modulo cover negative positions and the loop seam', () => {
  assert.deepEqual([-2, 0, 0.4, 1, 2].map(n => M.clamp(n,0,1)), [0,0,0.4,1,1]);
  assert.deepEqual([-19,-9,-1,0,9,10,18].map(n => M.mod(n,9)), [8,0,8,0,0,1,0]);
});
test('vector operations produce an orthogonal, right-handed, unit basis', () => {
  assert.deepEqual(M.subtract([2,5,8],[1,4,6]), [1,1,2]);
  assert.deepEqual(M.cross([1,0,0],[0,1,0]), [0,0,1]);
  const a = [-3,4,2], b = [0,2,1], n = M.normalize(M.cross(a,b));
  near(M.dot(a,n), 0); near(M.dot(b,n), 0); near(M.dot(n,n), 1);
  assert.deepEqual(M.normalize([0,0,0]), [0,0,0]);
});
test('view matrix places the eye at the origin and the target down negative Z', () => {
  const eye = [2.5,7,-9], target = [1,3,-11];
  const view = M.lookAt(eye, target, [0.02,1,0]);
  transform(view,[...eye,1]).forEach((n,i) => near(n, [0,0,0,1][i]));
  const t = transform(view,[...target,1]);
  near(t[0],0); near(t[1],0); near(t[2],-Math.hypot(...M.subtract(target,eye)));
});
test('perspective maps frustum corners and near/far planes into WebGL clip space', () => {
  const p = M.perspective(Math.PI/2, 2, 0.5, 75);
  for (const [z, depth] of [[-0.5,-1], [-75,1]]) {
    const v = transform(p, [-2*z,-z,z,1]);
    near(v[0]/v[3],1); near(v[1]/v[3],1); near(v[2]/v[3],depth);
  }
  for (const args of [[0,1,1,2], [Math.PI,1,1,2], [1,-1,1,2], [1,1,0,2],
    [1,1,2,2], [1,1,2,1], [NaN,1,1,2], [1,Infinity,1,2], [1,1,1,Infinity]]) {
    assert.throws(() => M.perspective(...args), RangeError);
  }
});
test('composed matrix transforms agree with sequential transforms', () => {
  const a = M.perspective(1.14,1.8,0.2,300), b = M.lookAt([1,4,7],[-3,2,1],[0,1,0]);
  const point = [0.4,8,-3,1], v = transform(M.multiply(a,b),point);
  transform(a,transform(b,point)).forEach((n,i) => near(v[i],n));
});
test('route detail random numbers repeat by seed and stay inside [0,1)', () => {
  const sample = seed => Array.from({ length: 128 }, M.seeded(seed));
  const a = sample(401);
  assert.deepEqual(sample(401),a);
  assert.notDeepEqual(sample(402),a);
  assert.equal(new Set(a).size,128); assert.ok(a.every(n => n >= 0 && n < 1));
});
test('camera presets ease without a jump and settle exactly on their bearings', () => {
  const c = C.createCamera();
  C.setView(c,'platform');
  assert.equal(c.yaw,0); assert.equal(c.pitch,0); assert.equal(c.preset,'platform');
  const previous = c.yaw;
  assert.equal(C.advance(c,1/60),true); assert.ok(previous < c.yaw && c.yaw < c.goalYaw);
  for (let i=0; i<200; i++) C.advance(c,1/60);
  assert.equal(c.yaw,c.goalYaw); assert.equal(C.advance(c,1/60),false);
  assert.ok(Math.sin(c.yaw+0.105)>0 && Math.cos(c.yaw+0.105)<0);
  C.setView(c,'front'); C.advance(c,5);
  assert.equal(c.yaw,0); assert.equal(c.pitch,0);
});
test('look smoothing is frame-rate independent and free look stays inside its limits', () => {
  const a = C.createCamera(), b = C.createCamera();
  C.pan(a,200,100); C.pan(b,200,100);
  assert.equal(a.goalYaw,Math.PI); assert.ok(a.goalPitch < Math.PI/2);
  for (let i=0;i<24;i++) C.advance(a,1/60);
  for (let i=0;i<12;i++) C.advance(b,1/30);
  near(a.yaw,b.yaw,1e-12); near(a.pitch,b.pitch,1e-12);
  C.pan(a,-400,-200); assert.equal(a.goalYaw,-Math.PI); assert.ok(a.goalPitch > -Math.PI/2);
  assert.equal(a.preset,'free'); C.setView(a,'front'); C.pan(a,0,0); assert.equal(a.preset,'front');
});
test('switching windows near the rear bearing takes the short way around and settles at the requested preset', () => {
  const c = C.createCamera();
  C.pan(c,-Math.PI,0); C.advance(c,5);
  C.setView(c,'platform'); C.advance(c,1/60);
  assert.ok(c.yaw > 3 && c.yaw < Math.PI);
  C.advance(c,5); assert.equal(c.yaw,2.28);
  C.setView(c,'left'); C.advance(c,1/60);
  assert.ok(c.yaw > 2.28);
  for (let i=0; i<200; i++) C.advance(c,1/60);
  assert.equal(c.yaw,c.goalYaw); assert.equal(c.preset,'left');
  assert.ok(c.yaw < -1.3 && c.yaw > -Math.PI/2);
});
