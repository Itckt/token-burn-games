"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/math");
const C = require("../js/camera");
const T = require("../js/track");
const G = require("../js/mesh");
const Pick = require("../js/picking");
const {near, vector} = require("./numeric");

test("picking rays pass through the projected point at any aspect, orbit, follow target or zoom", () => {
  const target = [-3, 2.5, 9];
  for (const aspect of [0.55, 1, 2.3]) for (const [yaw,pitch] of [[-2,0.12], [0.4,0.8], C.VIEWS.overhead]) {
    const view = C.matrices(target, yaw, pitch, 4.2, aspect, 29);
    for (const offset of [[0,0,0], [0.5,1.3,-0.65], [-1.5,-0.6,0.24]]) {
      const point = M.add(target, offset), [x,y] = M.transform(view.vp, point);
      const ray = Pick.viewRay(view, x, y);
      near(M.length(ray.direction), 1);
      const distance = M.dot(M.sub(point,ray.origin),ray.direction);
      assert.ok(distance > 0 && distance < ray.limit);
      vector(M.madd(ray.origin,ray.direction,distance),point,1e-5);
      near(M.transform(view.vp,ray.origin)[2], -1);
      near(M.transform(view.vp,M.madd(ray.origin,ray.direction,ray.limit))[2], 1);
    }
  }
});

test("picking respects occlusion, seams, reversed winding, parallel rays and near/far clipping", () => {
  function face(z, reversed = false) {
    const g = new G.Builder(), points = [[-1,-1,z], [1,-1,z], [1,1,z], [-1,1,z]];
    g.quad(...(reversed ? points.reverse() : points), [1,1,1]);
    return Pick.pickMesh(g.finish());
  }
  const back = face(-2), front = face(0, true);
  const ray = {origin: [0,0,3], direction: [0,0,-1], limit: 9};
  assert.equal(Pick.nearestSection([back,front],ray), 1);
  assert.equal(Pick.nearestSection([front,back],ray), 0);
  assert.equal(Pick.nearestSection([front,front],ray), 0);
  assert.equal(Pick.nearestSection([front],{...ray, origin:[1,1,3]}), 0);
  for (const change of [{limit:2.9}, {origin:[1.01,0,3]}, {direction:[0,0,1]}, {direction:[0,1,0]}]) {
    assert.equal(Pick.nearestSection([back,front],{...ray,...change}), -1);
  }
  const triangle = new G.Builder();
  triangle.quad([0,0,0],[1,0,0],[0,1,0],[0,1,0],[1,1,1]);
  assert.equal(Pick.nearestSection([Pick.pickMesh(triangle.finish())], {...ray, origin:[0.9,0.9,3]}), -1);
});

test("actual channel hardware can be picked on the inverted crown of a rotated loop", () => {
  const c = T.build({height: 4, pieces: ["left", "loop", "straight"]});
  const loop = c.sections[2], crown = T.atDistance(loop, loop.length/2);
  assert.ok(crown.n[1] < -0.99);
  const meshes = c.sections.map(section => Pick.pickMesh(G.sectionMesh(section)));
  const origin = M.madd(crown.p, [0,1,0], 6);
  assert.equal(Pick.nearestSection(meshes,{origin, direction:[0,-1,0], limit:10}), 2);
});
