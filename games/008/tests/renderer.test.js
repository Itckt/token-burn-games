"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/terrain");
const S = require("../js/simulation");
const Q = require("../js/survey");
const R = require("../js/relay");
const O = require("../js/observatory");
const shaders = require("../js/shaders");
const createRenderer = require("../js/renderer");
const { CommandGL, declarations } = require("./support/gl");

const world = T.createWorld(), grid = T.buildGrid(world, 22), items = T.scatter(world, grid, 220);
const all = { water: true, trees: true };
function setup(options = {}) {
  const gl = new CommandGL(options);
  const canvas = { width: 300, height: 150, getContext: (name, flags) => {
    assert.equal(name, "webgl"); assert.equal(flags.depth, true); assert.equal(flags.alpha, false);
    return gl;
  } };
  const renderer = createRenderer(canvas);
  renderer.resize(1001, 603);
  renderer.loadWorld(world, grid, items);
  return { renderer, gl, canvas, camera: S.homeCamera(world.style) };
}

test("each shader pair has one complete entry point and matching WebGL 1 interpolators", () => {
  for (const kind of ["land", "water", "sky", "rain", "runoff", "gate", "shadow"]) {
    const vertex = shaders[kind + "Vertex"], fragment = shaders[kind + "Fragment"];
    assert.match(vertex, /attribute\s+vec[23]\s+aPosition/);
    assert.match(vertex, /gl_Position\s*=/);
    assert.match(fragment, /precision highp float;/);
    assert.match(fragment, /gl_FragColor\s*=/);
    assert.deepEqual([...declarations(vertex, "varying")], [...declarations(fragment, "varying")]);
    for (const source of [vertex, fragment]) {
      assert.equal((source.match(/void\s+main\s*\(\s*\)/g) || []).length, 1);
      assert.doesNotMatch(source, /#version 300|#include|\bundefined\b|\$\{/);
      const stack = [];
      for (const token of source.match(/[()[\]{}]/g)) {
        if ("([{".includes(token)) stack.push(token);
        else assert.equal(stack.pop(), { ")": "(", "]": "[", "}": "{" }[token]);
      }
      assert.equal(stack.length, 0);
      const vars = new Set([...declarations(source, "uniform").keys()]);
      for (const name of source.match(/\bu[A-Z]\w*/g) || []) assert.ok(vars.has(name), name);
    }
  }
});

test("missing WebGL and shader compilation and link failures surface actionable diagnostics", () => {
  assert.throws(() => createRenderer({ getContext: () => null }), /WebGL is unavailable.*acceleration/);
  for (const [options, message] of [[{ failCompile: true }, /compile diagnostic/], [{ failLink: true }, /link diagnostic/]]) {
    const gl = new CommandGL(options);
    assert.throws(() => createRenderer({ getContext: () => gl }), message);
    assert.ok(gl.shaders.every(s => s.deleted));
    assert.ok(gl.programs.every(p => p.deleted));
  }
});

test("fragment precision fallback matches varyings in both stages and still draws water", () => {
  for (const highp of [null, false]) {
    const { renderer, gl, camera } = setup({ highp });
    for (const s of gl.shaders) {
      assert.match(s.source, /varying mediump/);
      if (s.type === gl.FRAGMENT_SHADER) assert.match(s.source, /precision mediump float;/);
    }
    renderer.render(camera, 0, 0, all);
    assert.equal(gl.draws.at(-1).kind, "water");
  }
});

test("first frame draws batches with valid buffers, outward winding and a planar reflection", () => {
  const { renderer, gl, camera } = setup();
  renderer.render(camera, S.START_HOUR, 0, all);
  const reflected = gl.draws.filter(d => d.reflected), main = gl.draws.filter(d => !d.reflected);
  assert.deepEqual(reflected.map(d => d.kind), ["land", "land", "land", "land", "sky"]);
  assert.deepEqual(main.map(d => d.kind), ["land", "land", "land", "land", "sky", "water"]);
  assert.equal(main[0].count, 6 * grid.segments ** 2);
  assert.equal(main[1].count, 18 * 3 * items.rocks.length);
  assert.equal(main[2].count, 20 * 3 * items.trees.length);
  assert.deepEqual(main.map(d => d.culled), [true, true, true, true, false, false]);
  assert.equal(main[0].winding, gl.CCW); assert.equal(reflected[0].winding, gl.CW);
  assert.equal(main[0].uniforms.uReflect, 0); assert.equal(reflected[0].uniforms.uReflect, 1);
  assert.deepEqual(reflected[0].uniforms.uEye, [camera.position[0], -camera.position[1], camera.position[2]]);
  const vp = main[0].uniforms.uVP, mirrored = reflected[0].uniforms.uVP;
  vp.forEach((v, i) => assert.equal(mirrored[i], i >= 4 && i <= 7 ? -v : v));
  assert.deepEqual(main.at(-1).uniforms.uMirrorVP, mirrored);
  assert.deepEqual(main.at(-1).viewport, [0, 0, 1001, 603]);
  assert.ok(reflected[0].viewport[2] <= 640);
  assert.equal(main.at(-1).count, 6);
  assert.equal(main.at(-1).uniforms.uHasMirror, 1);
  assert.equal(gl.buffers.length, 6);
  assert.ok(gl.shaders.every(s => s.deleted));
});

test("cached reflections use their own projector and refresh after movement or elapsed time", () => {
  const { renderer, gl, camera } = setup();
  renderer.render(camera, 12, 0, all);
  const cachedVP = gl.draws.at(-1).uniforms.uMirrorVP;
  const uploads = [gl.buffers.length, gl.textures.length];
  const draw = time => { gl.draws.length = 0; renderer.render(camera, 12, time, all); };
  camera.position[0] += 0.8;
  draw(0.01);
  assert.ok(!gl.draws.some(d => d.reflected));
  assert.deepEqual(gl.draws.at(-1).uniforms.uMirrorVP, cachedVP);
  draw(0.04);
  assert.ok(gl.draws.some(d => d.reflected));
  assert.notDeepEqual(gl.draws.at(-1).uniforms.uMirrorVP, cachedVP);
  draw(0.4);
  assert.ok(!gl.draws.some(d => d.reflected));
  draw(1);
  assert.ok(gl.draws.some(d => d.reflected));
  assert.deepEqual([gl.buffers.length, gl.textures.length], uploads);
});

test("scene switches suppress water passes, tree batches and canopy shading independently", () => {
  const { renderer, gl, camera } = setup();
  for (const trees of [true, false]) {
    for (const water of [true, false]) {
      gl.draws.length = 0;
      renderer.render(camera, 12, 0, { trees, water });
      const main = gl.draws.filter(d => !d.reflected);
      assert.equal(main.length, 4 + Number(trees) + Number(water));
      assert.equal(main[0].uniforms.uForest, Number(trees));
      assert.equal(main.some(d => d.kind === "water"), water);
      assert.equal(main.some(d => d.kind === "land" && d.count === 60 * items.trees.length), trees);
      if (!water) assert.ok(gl.draws.every(d => !d.reflected));
      else assert.equal(gl.draws.find(d => d.reflected).uniforms.uForest, Number(trees));
    }
  }
});

test("water uses the sky color fallback when a reflection attachment is unavailable", () => {
  const { renderer, gl, camera } = setup({ reflections: false });
  renderer.render(camera, 2, 3, all);
  assert.ok(gl.draws.every(d => !d.reflected));
  assert.equal(gl.draws.at(-1).kind, "water");
  assert.equal(gl.draws.at(-1).uniforms.uHasMirror, 0);
  assert.deepEqual(gl.draws.at(-1).uniforms.uHigh, S.lighting(2).high);
});

test("weather refreshes the reflected sky and terrain while rain uses one depth-tested transparent batch", () => {
  const { renderer, gl, camera } = setup({ highp: false });
  renderer.render(camera, 12, 0, all);
  gl.draws.length = 0;
  renderer.render(camera, 12, 0.05, all, [1, 0]);
  assert.ok(gl.draws.some(d => d.reflected));
  assert.ok(gl.draws.every(d => d.kind !== "rain"));
  for (const draw of gl.draws) assert.deepEqual(draw.uniforms.uWeather, [1, 0]);
  const allocated = gl.buffers.length;
  for (const water of [true, false, true]) {
    gl.draws.length = 0;
    renderer.render(camera, 0, 0.9, { trees: true, water }, [0.56, 1]);
    assert.equal(gl.draws.filter(d => d.kind === "rain").length, 1);
    const rain = gl.draws.at(-1), main = gl.draws.find(d => !d.reflected);
    assert.equal(rain.kind, "rain");
    assert.ok(!rain.reflected && rain.blend && !rain.depthWrite);
    assert.deepEqual(rain.uniforms.uVP, main.uniforms.uVP);
    assert.deepEqual(rain.uniforms.uEye, camera.position);
    assert.equal(rain.uniforms.uRain, 1);
    assert.ok(gl.draws.slice(0, -1).every(d => !d.blend && d.depthWrite));
    assert.ok(gl.depthWrite && !gl.caps.has(gl.BLEND));
    assert.equal(gl.buffers.length, allocated + 1);
    assert.equal(gl.programs.length, 4);
  }
  gl.draws.length = 0;
  renderer.render(camera, 12, 1.2, all);
  assert.equal(gl.draws.at(-1).kind, "water");
  assert.match(gl.shaders.at(-1).source, /varying mediump float vAlpha/);
});

test("a failure compiling a later startup program frees the previously linked programs", () => {
  for (const failProgram of [2, 3]) {
    const gl = new CommandGL({ failProgram });
    assert.throws(() => createRenderer({ getContext: () => gl }), /compile diagnostic/);
    assert.ok(gl.shaders.every(s => s.deleted) && gl.programs.every(p => p.deleted));
  }
});

test("resize is idempotent, scales the offscreen target and uses complete NPOT textures", () => {
  const { renderer, gl, canvas, camera } = setup();
  const allocated = gl.textures.length, previous = gl.textures[0];
  renderer.resize(1001.1, 602.9);
  assert.equal(gl.textures.length, allocated);
  renderer.resize(1900, 1000);
  assert.ok(previous.deleted);
  assert.deepEqual([canvas.width, canvas.height], [1900, 1000]);
  const mirror = gl.textures.at(-1);
  assert.deepEqual([mirror.w, mirror.h], [640, 337]);
  for (const texture of gl.textures) {
    assert.equal(texture.params[gl.TEXTURE_MIN_FILTER], gl.LINEAR);
    assert.equal(texture.params[gl.TEXTURE_WRAP_S], gl.CLAMP_TO_EDGE);
    assert.equal(texture.params[gl.TEXTURE_WRAP_T], gl.CLAMP_TO_EDGE);
  }
  renderer.resize(0, 0);
  assert.deepEqual([canvas.width, canvas.height], [1, 1]);
  renderer.render(camera, 12, 0, all);
  assert.deepEqual(gl.draws.at(-1).viewport, [0, 0, 1, 1]);
});

test("replacing the world releases its previous GPU mesh and texture allocations", () => {
  const { renderer, gl, camera } = setup();
  const old = gl.buffers.slice(2), oldTex = gl.textures.at(-1);
  const canyon = T.createWorld("Late Ferry", "canyon"), next = T.buildGrid(canyon, 12);
  renderer.loadWorld(canyon, next, T.scatter(canyon, next, 70));
  assert.ok(old.every(b => b.deleted) && oldTex.deleted);
  assert.ok(!gl.buffers[0].deleted && !gl.buffers[1].deleted);
  assert.equal(gl.buffers.filter(b => !b.deleted).length, 6);
  renderer.render(camera, 17, 0.1, all);
  assert.equal(gl.draws[0].count, 6 * 12 ** 2);
  assert.deepEqual(gl.draws.at(-1).uniforms.uDeep, canyon.style.deep);
});

test("a partial geometry upload rolls back its allocations and leaves the previous world drawable", () => {
  const { renderer, gl, camera } = setup();
  const active = gl.buffers.slice(), originalUpload = gl.bufferData.bind(gl);
  gl.bufferData = (...args) => {
    if (gl.buffers.length === active.length + 2) throw new Error("Interrupted upload");
    originalUpload(...args);
  };
  const next = T.createWorld("Ferry Pier", "fjord"), small = T.buildGrid(next, 11);
  assert.throws(() => renderer.loadWorld(next, small, T.scatter(next, small, 30)), /Interrupted upload/);
  assert.ok(gl.buffers.slice(active.length).every(b => b.deleted));
  assert.ok(active.every(b => !b.deleted));
  renderer.render(camera, 14, 1, all);
  assert.deepEqual(gl.draws.at(-1).uniforms.uDeep, world.style.deep);
  gl.bufferData = originalUpload;
  renderer.loadWorld(next, small, T.scatter(next, small, 30));
  renderer.render(camera, 14, 2, all);
  assert.deepEqual(gl.draws.at(-1).uniforms.uDeep, next.style.deep);
});

test("the lake draws with a complete fallback sampler when reflection storage cannot be created", () => {
  for (const method of ["createFramebuffer", "createRenderbuffer", "createTexture"]) {
    const gl = new CommandGL(), canvas = { width: 64, height: 32, getContext: () => gl };
    const original = gl[method].bind(gl);
    gl[method] = () => null;
    const renderer = createRenderer(canvas);
    renderer.resize(101, 53);
    gl[method] = original;
    renderer.loadWorld(world, grid, items);
    renderer.render(S.homeCamera(world.style), 9, 0, all, [0.5, 1]);
    assert.ok(gl.draws.every(d => !d.reflected));
    assert.equal(gl.draws.find(d => d.kind === "water").uniforms.uHasMirror, 0);
    assert.equal(gl.draws.at(-1).kind, "rain");
  }
});

test("disposing a rainy world releases the shared field, geometry, programs and reflection attachments", () => {
  const { renderer, gl, camera } = setup();
  renderer.render(camera, 19, 1.2, all, [0.5, 0.8]);
  const depth = gl.renderbuffer;
  renderer.dispose(); renderer.dispose();
  assert.ok(depth.deleted);
  assert.ok([...gl.buffers, ...gl.textures, ...gl.programs].every(object => object.deleted));
  gl.draws.length = 0;
  renderer.render(camera, 19, 2.5, all);
  assert.equal(gl.draws.length, 0);
});

test("moving the lake mirrors around its new plane immediately and keeps buffers and samplers resident", () => {
  const { gl, renderer, camera } = setup();
  const uploads = [gl.buffers.length, gl.textures.length];
  for (const level of [0, 8, -6]) {
    gl.draws.length = 0;
    renderer.render(camera, 16, 0, { ...all, level });
    const lake = gl.draws.at(-1), reflected = gl.draws.find(d => d.reflected && d.kind === "land");
    assert.equal(lake.uniforms.uLevel, level);
    assert.equal(lake.depthComparison, gl.LESS);
    assert.ok(gl.draws.slice(0, -1).every(d => d.depthComparison === gl.LEQUAL));
    assert.equal(gl.depthComparison, gl.LEQUAL);
    assert.equal(reflected.uniforms.uLevel, level);
    assert.deepEqual(reflected.uniforms.uEye, [camera.position[0], 2 * level - camera.position[1], camera.position[2]]);
    const vp = lake.uniforms.uVP, mirror = lake.uniforms.uMirrorVP;
    for (let i = 0; i < 4; i++) {
      assert.equal(mirror[4 + i], -vp[4 + i]);
      assert.equal(mirror[12 + i], Math.fround(vp[12 + i] + 2 * level * vp[4 + i]));
      // Points on the water plane have identical clip coordinates in both views.
      assert.ok(Math.abs(level * vp[4 + i] + vp[12 + i] - level * mirror[4 + i] - mirror[12 + i]) < 0.00003);
    }
    gl.draws.length = 0;
    renderer.render(camera, 16, 0, { ...all, level });
    assert.ok(gl.draws.every(d => !d.reflected));
    assert.deepEqual([gl.buffers.length, gl.textures.length], uploads);
  }
});

test("runoff draws with depth-tested blending, animates from one upload, and clears from both passes", () => {
  const { renderer, gl, camera } = setup({ highp: false });
  const points = [[10, 26], [8, 20], [1, 10]];
  const original = gl.buffers.length;
  renderer.render(camera, 9, 1, all);
  renderer.setRunoff(grid, points);
  gl.draws.length = 0;
  renderer.render(camera, 9, 1, all);
  const traces = gl.draws.filter(d => d.kind === "runoff");
  assert.deepEqual(traces.map(d => d.reflected), [true, false]);
  for (const d of traces) {
    assert.equal(d.uniforms.uReflect, +d.reflected);
    assert.ok(d.blend && !d.depthWrite && !d.culled && d.count > 12);
    assert.equal(d.uniforms.uTime, 1);
    assert.deepEqual(d.uniforms.uVP, gl.draws.find(x => x.reflected === d.reflected).uniforms.uVP);
  }
  const batch = gl.buffers.at(-1);
  renderer.setRunoff(grid, points);
  gl.draws.length = 0;
  renderer.render(camera, 0, 2, { water: false, trees: false, level: -6 });
  assert.equal(gl.draws.at(-1).kind, "runoff");
  assert.equal(gl.draws.at(-1).uniforms.uTime, 2);
  assert.equal(gl.draws.at(-1).uniforms.uLevel, -6);
  assert.equal(gl.buffers.length, original + 1);
  assert.ok(gl.depthWrite && !gl.caps.has(gl.BLEND));
  renderer.setRunoff(grid, null);
  gl.draws.length = 0;
  renderer.render(camera, 9, 2, all);
  assert.ok(batch.deleted && gl.draws.some(d => d.reflected));
  assert.ok(gl.draws.every(d => d.kind !== "runoff"));
});

test("a failed trace replacement leaves its old geometry available and disposal releases the last trace", () => {
  const { renderer, gl, camera } = setup();
  renderer.setRunoff(grid, [[0, 0], [0, 10]]);
  const active = gl.buffers.at(-1), upload = gl.bufferData.bind(gl);
  gl.bufferData = () => { throw new Error("Trace upload interrupted"); };
  assert.throws(() => renderer.setRunoff(grid, [[0, 0], [20, 0]]), /interrupted/);
  assert.ok(gl.buffers.at(-1).deleted && !active.deleted);
  renderer.render(camera, 10, 0, all);
  assert.ok(gl.draws.some(d => d.kind === "runoff"));
  gl.bufferData = upload;
  renderer.setRunoff(grid, [[0, 0], [20, 0]]);
  assert.ok(active.deleted && !gl.buffers.at(-1).deleted);
  renderer.dispose();
  assert.ok([...gl.buffers, ...gl.programs].every(b => b.deleted));
});

test("probe contours reach both land passes immediately, including a held clock and camera", () => {
  const { renderer, gl, camera } = setup();
  renderer.render(camera, 18, 0, all);
  const allocations = [gl.buffers.length, gl.textures.length, gl.programs.length];
  for (const probe of [true, false]) {
    gl.draws.length = 0;
    renderer.render(camera, 18, 0, { ...all, probe });
    const ground = gl.draws.filter(d => d.kind === "land" && d.uniforms.uKind === 0);
    assert.deepEqual(ground.map(d => d.reflected), [true, false]);
    assert.ok(ground.every(d => d.uniforms.uProbe === Number(probe)));
    assert.deepEqual([gl.buffers.length, gl.textures.length, gl.programs.length], allocations);
  }
});

test("relay rings share one depth-tested batch across gates, rain, reflections and upload failure", () => {
  const { renderer, gl, camera } = setup({ highp: false });
  const course = R.buildCourse(grid, Q.buildRoute(grid, [[32, 90], [10, -52]]));
  const count = gl.buffers.length;
  renderer.setGates(course.gates);
  const mesh = gl.buffers.at(-1);
  renderer.setRunoff(grid, [[32, 90], [10, -52]]);
  for (const nextGate of [0, 1, 2]) {
    gl.draws.length = 0;
    renderer.setGates(course.gates);
    renderer.render(camera, 2, 1, { ...all, nextGate }, [0.56, 1]);
    const draws = gl.draws.filter(d => d.kind === "gate");
    assert.deepEqual(draws.map(d => d.reflected), [true, false]);
    for (const d of draws) {
      assert.equal(d.uniforms.uNext, nextGate);
      assert.equal(d.count, 6 * 64 * course.gates.length);
      assert.ok(d.blend && !d.depthWrite && !d.culled);
      assert.deepEqual(d.uniforms.uVP, gl.draws.find(b => b.reflected === d.reflected).uniforms.uVP);
    }
    assert.equal(gl.draws.at(-1).kind, "rain"); assert.ok(gl.depthWrite && !gl.caps.has(gl.BLEND));
    assert.equal(gl.buffers.length, count + 3);
  }
  const upload = gl.bufferData.bind(gl);
  gl.bufferData = () => { throw new Error("Gate upload interrupted"); };
  assert.throws(() => renderer.setGates(course.gates.slice(1)), /interrupted/);
  assert.ok(gl.buffers.at(-1).deleted && !mesh.deleted);
  gl.bufferData = upload;
  gl.draws.length = 0;
  renderer.render(camera, 3, 2, { water: false, trees: false });
  assert.deepEqual(gl.draws.filter(d => d.kind === "gate").map(d => d.count), [6 * 64 * course.gates.length]);
  renderer.setGates(null); assert.ok(mesh.deleted);
  gl.draws.length = 0; renderer.render(camera, 3, 2, all);
  assert.ok(gl.draws.every(d => d.kind !== "gate"));
  assert.ok(gl.draws.some(d => d.kind === "runoff" && d.reflected));
  renderer.setGates(course.gates);
  renderer.dispose();
  assert.ok([...gl.buffers, ...gl.programs, ...gl.textures].every(b => b.deleted));
});

test("the depth chart flattens the existing terrain buffer at the new waterline and ordinary water returns to its quad", () => {
  const { renderer, gl, camera } = setup({ highp: false });
  const uploads = [gl.buffers.length, gl.textures.length, gl.programs.length];
  for (const [chart, level] of [[false, 0], [true, 8], [true, -6], [false, -6]]) {
    gl.draws.length = 0;
    renderer.render(camera, 11, 0, { ...all, level, chart });
    const water = gl.draws.at(-1), pointer = gl.pointers.get(0);
    assert.equal(water.kind, "water");
    assert.equal(water.uniforms.uChart, Number(chart)); assert.equal(water.uniforms.uLevel, level);
    assert.equal(water.count, chart ? 6 * grid.segments ** 2 : 6);
    assert.equal(pointer.stride, chart ? 36 : 12);
    assert.equal(water.depthComparison, gl.LESS);
    assert.deepEqual([gl.buffers.length, gl.textures.length, gl.programs.length], uploads);
  }
  assert.match(shaders.waterVertex, /vChartDepth\s*=\s*uLevel\s*-\s*aPosition\.y/);
  assert.match(shaders.waterFragment, /depthInk\(vChartDepth\)/);
});

test("passage buoys reuse one opaque batch, cast a reflection, disappear with water and release on replacement", () => {
  const { renderer, gl, camera } = setup();
  const passage = { waterLevel: 3, points: [[0, 0], [20, 20], [45, 10]] };
  const uploads = gl.buffers.length;
  renderer.setPassage(passage);
  const original = gl.buffers.at(-1);
  for (const water of [true, false, true]) {
    gl.draws.length = 0;
    renderer.setPassage(passage);
    renderer.render(camera, 20, water ? 3 : 1, { ...all, water, level: 3 });
    const buoys = gl.draws.filter(d => d.kind === "land" && d.uniforms.uKind === 3);
    if (water) assert.ok(buoys.length >= 1 && buoys.every(d => d.culled && d.depthWrite && d.count > 0));
    else assert.equal(buoys.length, 0);
    if (water && buoys.length === 2) assert.deepEqual(buoys.map(d => d.reflected), [true, false]);
    assert.equal(gl.buffers.length, uploads + 1);
  }
  const upload = gl.bufferData.bind(gl);
  gl.bufferData = () => { throw new Error("Interrupted buoy upload"); };
  assert.throws(() => renderer.setPassage({ ...passage, waterLevel: 5 }), /Interrupted/);
  assert.ok(!original.deleted && gl.buffers.at(-1).deleted);
  gl.bufferData = upload;
  renderer.setPassage({ ...passage, waterLevel: 5 });
  assert.ok(original.deleted && !gl.buffers.at(-1).deleted);
  renderer.setPassage(null); assert.ok(gl.buffers.at(-1).deleted);
  gl.draws.length = 0;
  renderer.render(camera, 20, 4, all);
  assert.ok(gl.draws.every(d => d.uniforms.uKind !== 3));
});

test("the lake writes depth before transparent rings and runoff, with rain still last", () => {
  const { renderer, gl, camera } = setup();
  const route = Q.buildRoute(grid, [[10, 20], [10, -40]]);
  renderer.setGates(R.buildCourse(grid, route).gates);
  renderer.setRunoff(grid, [[10, 20], [10, -40]]);
  renderer.render(camera, 9, 1, all, [0.56, 1]);
  const main = gl.draws.filter(d => !d.reflected);
  assert.deepEqual(main.slice(-4).map(d => d.kind), ["water", "runoff", "gate", "rain"]);
  assert.ok(main.at(-4).depthWrite && main.slice(-3).every(d => d.blend && !d.depthWrite));
  const mirror = gl.draws.filter(d => d.reflected);
  assert.deepEqual(mirror.slice(-2).map(d => d.kind), ["runoff", "gate"]);
  assert.ok(gl.depthWrite && !gl.caps.has(gl.BLEND));
});

test("one packed terrain depth pass supplies the reflected slopes, objects and lake with a common solar projection", () => {
  const { renderer, gl, camera } = setup({ highp: false }), layers = { ...all, shadows: true };
  const resources = [gl.buffers.length, gl.textures.length, gl.programs.length];
  renderer.render(camera, 0, 0, layers);
  assert.deepEqual([gl.buffers.length, gl.textures.length, gl.programs.length], resources);
  assert.ok(gl.draws.every(d => d.kind !== "shadow" && (!d.uniforms.uShade || d.uniforms.uShade[0] === 0)));
  gl.draws.length = 0;
  renderer.render(camera, 12, 0.01, layers);
  const caster = gl.draws[0];
  assert.equal(caster.kind, "shadow"); assert.equal(caster.pass, "shadow");
  assert.deepEqual(caster.viewport, [0, 0, 512, 512]);
  assert.deepEqual(caster.clearRGBA, [1, 1, 1, 1]);
  assert.ok(caster.depthWrite && !caster.blend && !caster.dither);
  assert.equal(caster.count, grid.segments ** 2 * 6);
  assert.deepEqual(caster.uniforms.uLightVP, Array.from(O.lightProjection(T.heightRange(grid), S.sunDirection(12))));
  for (const draw of gl.draws.filter(d => d.kind === "land" || d.kind === "water")) {
    assert.deepEqual(draw.uniforms.uLightVP, caster.uniforms.uLightVP);
    assert.deepEqual(draw.uniforms.uShade, [1, 1 / 512]);
    assert.equal(draw.uniforms.uShadow, 2);
    assert.ok(draw.dither);
  }
  assert.ok(gl.draws.some(d => d.reflected));
  assert.equal(gl.textures.at(-1).params[gl.TEXTURE_MIN_FILTER], gl.NEAREST);
  assert.deepEqual([gl.buffers.length, gl.textures.length, gl.programs.length],
    [resources[0], resources[1] + 1, resources[2] + 1]);
  gl.draws.length = 0;
  camera.position[0] += 5;
  renderer.render(camera, 12.0001, 1, { ...layers, level: 7, trees: false }, [0.56, 1]);
  assert.ok(gl.draws.every(d => d.kind !== "shadow")); assert.equal(gl.draws.at(-1).kind, "rain");
  assert.ok(gl.draws.find(d => d.kind === "water").uniforms.uShade[0] < 0.2);
});

test("sun jumps, shadow switches and new beds invalidate the appropriate main and reflection passes", () => {
  const { renderer, gl, camera } = setup(), layers = { ...all, shadows: true };
  renderer.render(camera, 9, 0, layers);
  const initialMatrix = gl.draws[0].uniforms.uLightVP;
  const textures = gl.textures.length;
  gl.draws.length = 0;
  renderer.render(camera, 15, 0, layers);
  assert.equal(gl.draws[0].kind, "shadow"); assert.notDeepEqual(gl.draws[0].uniforms.uLightVP, initialMatrix);
  assert.ok(gl.draws.some(d => d.reflected));
  for (const show of [false, true]) {
    gl.draws.length = 0;
    renderer.render(camera, 15, 0, { ...layers, shadows: show });
    assert.ok(gl.draws.every(d => d.kind !== "shadow"));
    assert.ok(gl.draws.some(d => d.reflected));
    assert.equal(gl.draws.at(-1).uniforms.uShade[0] > 0, show);
    assert.equal(gl.textures.length, textures);
  }
  gl.draws.length = 0;
  const flat = grid.withHeights(new Float32Array(grid.heights.length));
  renderer.loadWorld(world, flat, { trees: [], rocks: [] });
  renderer.render(camera, 15, 0, layers);
  assert.equal(gl.draws[0].kind, "shadow");
  assert.deepEqual(gl.draws[0].uniforms.uLightVP, Array.from(O.lightProjection({ low: 0, high: 0 }, S.sunDirection(15))));
  assert.equal(gl.textures.length, textures + 1);
  renderer.dispose();
  assert.ok([...gl.textures, ...gl.programs, ...gl.buffers, ...gl.framebuffers, ...gl.renderbuffers].every(r => r.deleted));
});

test("a missing shadow attachment, failed upload or unsupported caster preserves the ordinary lit scene", () => {
  for (const failure of ["createRenderbuffer", "texImage2D", "incomplete", "compile"]) {
    const { renderer, gl, camera } = setup();
    if (failure === "incomplete") gl.options.shadows = false;
    if (failure === "compile") gl.options.failCompile = true;
    if (failure === "createRenderbuffer") gl.createRenderbuffer = () => null;
    if (failure === "texImage2D") gl.texImage2D = () => { throw new Error("Unavailable shadow storage"); };
    renderer.render(camera, 12, 0, { ...all, shadows: true });
    assert.equal(renderer.shadowsAvailable, false);
    assert.ok(gl.draws.every(d => d.kind !== "shadow"));
    assert.ok(gl.draws.some(d => d.reflected)); assert.equal(gl.draws.at(-1).uniforms.uHasMirror, 1);
    assert.equal(gl.draws.at(-1).uniforms.uShade[0], 0);
    const attempts = gl.framebuffers.length;
    renderer.render(camera, 13, 1, { ...all, shadows: true });
    assert.equal(gl.framebuffers.length, attempts);
    renderer.dispose();
    assert.ok([...gl.textures, ...gl.shaders, ...gl.programs, ...gl.framebuffers, ...gl.renderbuffers].every(r => r.deleted));
  }
});
