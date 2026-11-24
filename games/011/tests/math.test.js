"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const m = require("../js/math");
const near = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) < tolerance, a + " differs from " + b);
const nearVector = (a, b) => { assert.equal(a.length, b.length); a.forEach((v, i) => near(v, b[i])); };

test("vector operations preserve handedness, length and an explicit zero vector", () => {
  assert.equal(m.dot([1, 2, 3], [-2, 4, 1]), 9);
  nearVector(m.cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  nearVector(m.normalize([0, 0, 0]), [0, 0, 0]);
  nearVector(m.normalize([3, 4, 0]), [0.6, 0.8, 0]);
  assert.equal(m.clamp(-2, 1, 10), 1);
  assert.equal(m.mix(-2, 8, 0.5), 3);
});

test("perspective maps both clipping planes and the field-of-view edges correctly", () => {
  const p = m.perspective(Math.PI / 2, 2, 1, 50);
  for (const [depth, expected] of [[1, -1], [50, 1]]) {
    const v = m.transform(p, 0, 0, -depth);
    near(v[2] / v[3], expected);
  }
  const edge = m.transform(p, 6, 3, -3);
  near(edge[0] / edge[3], 1); near(edge[1] / edge[3], 1);
});

test("view matrices put the camera at the origin and look down negative Z", () => {
  for (const eye of [[4, 3, 2], [0, 5, 0], [0, -5, 0]]) {
    const matrix = m.lookAt(eye, [0, 0, 0]);
    nearVector(m.transform(matrix, ...eye), [0, 0, 0, 1]);
    nearVector(m.transform(matrix, 0, 0, 0), [0, 0, -Math.hypot(...eye), 1]);
    const axes = [0, 1, 2].map(i => [matrix[i], matrix[4 + i], matrix[8 + i]]);
    for (const axis of axes) near(Math.hypot(...axis), 1);
    nearVector(m.cross(axes[0], axes[1]), axes[2]);
  }
});

test("matrix multiplication composes in projection-then-view order", () => {
  const view = m.lookAt([3, 4, 7], [0, 0, 0]);
  const p = m.perspective(0.83, 1.55, 0.1, 80);
  const point = [1.2, 0.7, -2.1];
  nearVector(m.transform(m.multiply(p, view), ...point), m.transform(p, ...m.transform(view, ...point)));
});

test("parallel, zero and non-unit up vectors produce a usable camera basis even along Z", () => {
  for (const [eye, up] of [[[0, 0, 5], [0, 0, 2]], [[0, 0, -3], [0, 0, 0]],
    [[2, 4, -7], [0, 10, 0]], [[0, 0, 0], [0, 1, 0]]]) {
    const matrix = m.lookAt(eye, [0, 0, 0], up);
    nearVector(m.transform(matrix, ...eye), [0, 0, 0, 1]);
    const rows = [0, 1, 2].map(i => [matrix[i], matrix[4 + i], matrix[8 + i]]);
    rows.forEach(row => near(Math.hypot(...row), 1));
    nearVector(m.cross(rows[0], rows[1]), rows[2]);
  }
});

test("screen projection uses top-left pixels and rejects behind-camera and clipped points", () => {
  const p = m.perspective(Math.PI / 2, 2, 1, 20);
  assert.deepEqual(m.project(p, [0, 0, -2], 800, 400), { x: 400, y: 200, visible: true });
  const upperRight = m.project(p, [2, 1, -2], 800, 400);
  near(upperRight.x, 600); near(upperRight.y, 100);
  for (const point of [[0, 0, 5], [0, 0, -50], [0, 0, -0.5], [9, 0, -2]]) {
    assert.equal(m.project(p, point, 800, 400).visible, false);
  }
});

test("the camera keeps a finite orthonormal basis on phone, desktop and top-down views", () => {
  const camera = m.makeCamera();
  for (const mode of ["orbit", "overhead"]) {
    m.aim(camera, mode);
    m.easeCamera(camera, 5);
    for (const aspect of [0.55, 1, 2.13, 3.6]) {
      const view = m.cameraFrame(camera, aspect);
      assert.ok(view.vp.every(Number.isFinite));
      nearVector(m.cross(view.right, view.up), view.back);
      near(Math.hypot(...view.right), 1); near(Math.hypot(...view.up), 1);
      const centre = m.project(view.vp, [0, 0, 0], 100, 80);
      near(centre.x, 50); near(centre.y, 40);
    }
  }
  assert.ok(m.cameraFrame(camera, 0.7).distance > m.cameraFrame(camera, 2).distance);
});

test("orbit and zoom clamp extremes and recover to the home view by the short arc", () => {
  const c = m.makeCamera();
  m.zoom(c, 0.0001); assert.equal(c.target.distance, 15);
  m.zoom(c, Infinity); m.zoom(c, -1); assert.equal(c.target.distance, 15);
  m.zoom(c, 1e8); assert.equal(c.target.distance, 54);
  m.orbit(c, -10000, -1e8); assert.equal(c.target.pitch, 0.35);
  m.orbit(c, 360, 1e8); assert.ok(c.target.pitch < Math.PI / 2);
  m.easeCamera(c, 5); m.aim(c, "orbit");
  assert.ok(Math.abs(c.target.yaw - c.yaw) <= Math.PI);
  m.easeCamera(c, 5);
  near(Math.cos(c.yaw), Math.cos(m.HOME.yaw)); near(c.pitch, m.HOME.pitch); near(c.distance, m.HOME.distance);
});

test("camera smoothing is independent of frame partition", () => {
  const a = m.makeCamera(), b = m.makeCamera();
  m.aim(a, "overhead"); m.aim(b, "overhead");
  m.easeCamera(a, 0.24);
  for (let i = 0; i < 24; i++) m.easeCamera(b, 0.01);
  for (const key of ["yaw", "pitch", "distance"]) near(a[key], b[key]);
  assert.ok(a.distance > m.HOME.distance && a.distance < a.target.distance);
});

test("surface picking inverts the rendered projection in orbit and overhead at different aspect ratios", () => {
  for (const [width, height] of [[330, 460], [900, 420], [1820, 640]]) {
    const camera = m.makeCamera();
    for (const mode of ["orbit", "overhead"]) {
      m.aim(camera, mode); m.easeCamera(camera, 10);
      const view = m.cameraFrame(camera, width / height);
      for (const [x, z] of [[0, 0], [1.8, -2.2], [-3.4, 2.7]]) {
        const pixel = m.project(view.vp, [x, 0, z], width, height);
        assert.equal(pixel.visible, true);
        const ground = m.seaPoint(view, pixel.x, pixel.y, width, height);
        near(ground.x, x); near(ground.z, z);
      }
    }
  }
});

test("picking rejects the sky, horizon, invalid viewport and coordinates outside the stage", () => {
  const view = m.cameraFrame({ ...m.HOME, pitch: 0 }, 2);
  for (const [x, y, w, h] of [[400, 190, 800, 400], [400, 200, 800, 400], [0, 0, 0, 400],
    [-1, 0, 800, 400], [801, 10, 800, 400], [0, 401, 800, 400], [NaN, 0, 800, 400]]) {
    assert.equal(m.seaPoint(view, x, y, w, h), null);
  }
  const p = m.project(m.perspective(m.FOV, 2, 0.25, 320), [0, 0, 0], 800, 400);
  assert.equal(p.visible, false);
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});
