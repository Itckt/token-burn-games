"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const math = require("../js/math");
const storm = require("../js/storm");
const field = require("../js/field");
const relief = require("../js/relief");
const shaders = require("../js/shaders");
const { createPage } = require("./support/page");
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, a + " differs from " + b);

test("pressure relief has a continuous indexed surface with upward winding and 16-bit addressable vertices", () => {
  const { positions, indices } = relief.mesh();
  const side = Math.sqrt(positions.length / 2);
  assert.ok(Number.isInteger(side) && side * side <= 65536);
  assert.ok(indices instanceof Uint16Array);
  assert.equal(indices.length, 6 * (side - 1) ** 2);
  const used = new Set(indices);
  assert.equal(used.size, side * side);
  assert.equal(Math.min(...used), 0);
  assert.equal(Math.max(...used), side * side - 1);
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = Array.from(indices.subarray(i, i + 3), index => 2 * index);
    const abX = positions[b] - positions[a], abZ = positions[b + 1] - positions[a + 1];
    const acX = positions[c] - positions[a], acZ = positions[c + 1] - positions[a + 1];
    assert.ok(abZ * acX - abX * acZ > 0);
  }
});

test("depth encodes the probe pressure at every signal and recovers ambient pressure away from the core", () => {
  const state = storm.makeState();
  let previousDepth = 0;
  for (let signal = 1; signal <= 10; signal++) {
    Object.assign(state, { signal, strength: storm.normalized(signal), time: 13.25 });
    const surface = relief.surface(state), eye = relief.height(surface, 0, 0);
    assert.ok(eye < previousDepth); previousDepth = eye;
    let previous = eye;
    for (let x = 0; x <= 12; x += 0.25) {
      const h = relief.height(surface, x, 0);
      close(h / relief.DEPTH_PER_HPA + field.AMBIENT_PRESSURE, field.sample(state, { x, z: 0 }).pressure);
      assert.ok(h >= previous && h <= 0); previous = h;
    }
    close(relief.height(surface, 145, -145), 0);
    const a = relief.vertexHeight(surface, 1, 2.25), b = relief.vertexHeight(surface, 1.25, 2);
    close(relief.height(surface, 1.125, 2.125), (a + b) / 2);
  }
  assert.ok(shaders.pressure.vertex.includes(relief.DEPTH_PER_HPA.toFixed(3)));
  assert.ok(shaders.pressure.fragment.includes(relief.CONTOUR_HPA.toFixed(1)));
});

test("pressure picking inverts projected triangles, including grid seams, tall viewports and the range edge", () => {
  const model = relief.surface({ strength: 1, time: 8.75 });
  for (const [width, height] of [[900, 420], [320, 560]]) {
    for (const yaw of [-1.23, 0, 2.7]) {
      const view = math.cameraFrame({ ...math.makeCamera(), yaw, pitch: 1.46, distance: 52 }, width / height);
      for (const [x, z] of [[0, 0], [12, 0], [-5.125, 2.125], [0.13, -2.13], [2.7, 3.17]]) {
        const world = [x, relief.height(model, x, z), z], pixel = math.project(view.vp, world, width, height);
        assert.ok(pixel.visible);
        const hit = relief.pick(model, view, pixel.x, pixel.y, width, height);
        close(hit.x, x, 5e-5); close(hit.z, z, 5e-5);
        assert.ok(relief.visible(model, view, world, pixel, width, height));
      }
      for (const [x, y, w, h] of [[-1, 10, width, height], [NaN, 50, width, height], [0, 0, 0, height]]) {
        assert.equal(relief.pick(model, view, x, y, w, h), null);
      }
    }
  }
});

test("at a shallow angle the near rim occludes the eye for both picks and labels", () => {
  const model = relief.surface({ strength: 1, time: 0 });
  const view = math.cameraFrame({ ...math.makeCamera(), pitch: 0.35, yaw: 0 }, 2);
  const eye = [0, relief.height(model, 0, 0), 0], pixel = math.project(view.vp, eye, 840, 420);
  assert.ok(pixel.visible);
  assert.equal(relief.visible(model, view, eye, pixel, 840, 420), false);
  const near = relief.pick(model, view, pixel.x, pixel.y, 840, 420);
  assert.ok(near.z > 7 && near.z < 8); close(near.x, 0);
  const world = [near.x, relief.height(model, near.x, near.z), near.z];
  assert.ok(relief.visible(model, view, world, pixel, 840, 420));
  const projected = math.project(view.vp, world, 840, 420);
  close(projected.x, pixel.x, 1e-5); close(projected.y, pixel.y, 1e-5);
});

test("pressure mode shares grid, transect, palette and signal with the UI, and reuses a single depth-tested draw", () => {
  const p = createPage({ actualGraphics: true, reducedMotion: true });
  p.step(); p.key("i"); p.step();
  const draw = p.gl.draws.at(-1), resources = p.gl.resources.length, uploads = p.gl.uploads;
  assert.equal(draw.name, "pressure"); assert.ok(draw.depthTest); assert.equal(draw.blended, false);
  assert.equal(draw.count, relief.mesh().indices.length);
  assert.equal(p.get("pressure-key").hidden, false);
  assert.equal(p.get("wind-key").hidden, true); assert.equal(p.get("radar-key").hidden, true);
  for (const [i, stop] of relief.STOPS.entries()) {
    assert.equal(p.data("isobar", String(i)).textContent, String(stop.pressure));
    assert.ok(p.get("pressure-ramp").style["--ramp"].includes(stop.color));
  }
  p.key("i", { repeat: true }); p.key("x"); p.data("layer", "grid").click();
  for (const level of [1, 5, 10]) {
    const slider = p.get("signal"); slider.value = String(level); slider.fire("input");
    p.gl.draws.length = 0; p.step();
    assert.equal(p.gl.draws.length, 1);
    const { uniforms, indexBuffer } = p.gl.draws[0];
    close(uniforms.uCentral, storm.readings(storm.normalized(level), 0).pressure);
    close(uniforms.uScale, storm.radialScale(storm.normalized(level)));
    assert.equal(uniforms.uGrid, 0); close(uniforms.uTransect[0], 1);
    assert.equal(draw.indexBuffer, indexBuffer); assert.equal(resources, p.gl.resources.length);
    assert.equal(p.gl.uploads, uploads); assert.equal(p.frames.size, 0);
  }
  p.key("i"); p.step();
  assert.equal(p.get("pressure-key").hidden, true);
  assert.equal(p.gl.draws.at(-1).name, "cloud"); assert.equal(p.gl.draws.at(-1).depthTest, false);
  p.win.fire("pagehide", { persisted: false });
  assert.ok(p.gl.resources.every(resource => resource.deleted));
});

test("a relief tap with a page offset samples the surface under the pointer and anchors its marker at mesh height", () => {
  const p = createPage({ reducedMotion: true }), c = p.get("storm-canvas");
  const width = 900, height = 420, left = 23, top = 81;
  p.get("stage").getBoundingClientRect = () => ({ width, height, left, top });
  p.data("stage", "2").click(); p.data("imagery", "pressure").click(); p.key("p"); p.step();
  assert.match(p.get("probe-hint").textContent, /pressure surface/);
  const view = math.cameraFrame(math.makeCamera(), width / height), pose = p.last();
  const x = 1.32, z = -0.9, y = relief.height(relief.surface(pose), x, z);
  const pixel = math.project(view.vp, [x, y, z], width, height);
  const flat = math.seaPoint(view, pixel.x, pixel.y, width, height);
  assert.ok(Math.hypot(flat.x - x, flat.z - z) > 2);
  const event = { pointerId: 4, button: 0, clientX: left + pixel.x, clientY: top + pixel.y };
  c.fire("pointerdown", event); c.fire("pointerup", event); p.step();
  const expected = field.sample(pose, { x, z });
  assert.equal(p.get("probe-pressure").textContent, expected.pressure.toFixed(0));
  assert.equal(p.get("probe-rain").textContent, expected.rain.toFixed(1));
  assert.equal(p.get("probe-marker").style.transform, "translate(" + pixel.x.toFixed(2) + "px," + pixel.y.toFixed(2) + "px)");
  assert.equal(p.get("probe-marker").hidden, false);
});
