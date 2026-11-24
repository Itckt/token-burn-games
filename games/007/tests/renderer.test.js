"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Renderer = require("../js/renderer.js");
const cube = require("../js/cube.js");
const math = require("../js/math.js");
const mesh = require("../js/mesh.js");
const RecordingGL = require("./webgl-stub.js");
const { vectorClose } = require("./helpers.js");

function makeRenderer() {
  const gl = new RecordingGL(), pieces = cube.apply(cube.create(), cube.STARTER);
  const canvas = { getContext: () => gl, width: 200, height: 100 };
  const renderer = new Renderer(canvas, pieces);
  return { renderer, pieces, gl, canvas };
}

function varyings(source, defaultPrecision) {
  const result = {};
  const declarations = /\bvarying\s+(?:(highp|mediump|lowp)\s+)?(\w+)\s+([^;]+);/g;
  for (const [, precision, type, names] of source.matchAll(declarations)) {
    for (const name of names.split(",")) result[name.trim()] = [precision || defaultPrecision, type];
  }
  return result;
}

test("both GLSL ES 1.00 programs have matching varying types and precision, entry points and outputs", () => {
  const { gl } = makeRenderer();
  assert.equal(gl.programs.length, 2);
  for (const program of gl.programs) {
    const [vs, fs] = program.shaders;
    assert.equal(vs.type, gl.VERTEX_SHADER);
    assert.equal(fs.type, gl.FRAGMENT_SHADER);
    for (const { source } of program.shaders) {
      assert.match(source, /void\s+main\s*\(\)\s*\{/);
      let depth = 0;
      for (const c of source) {
        if (c === "{") depth++;
        if (c === "}") depth--;
        assert.ok(depth >= 0);
      }
      assert.equal(depth, 0);
    }
    assert.match(vs.source, /gl_Position\s*=/);
    assert.match(fs.source, /precision\s+mediump\s+float\s*;/);
    assert.match(fs.source, /gl_FragColor\s*=/);
    const vertex = varyings(vs.source, "highp");
    assert.ok(Object.keys(vertex).length > 0);
    assert.deepEqual(vertex, varyings(fs.source, "mediump"));
  }
});

test("the renderer sets a transparent canvas, caps pixel density, and handles a zero-sized viewport", () => {
  const { renderer, gl, canvas } = makeRenderer();
  assert.deepEqual(gl.background, [0, 0, 0, 0]);
  assert.ok(gl.enabled.has(gl.DEPTH_TEST));
  assert.equal(gl.depthFunction, gl.LEQUAL);
  renderer.resize(501.2, 299.8, 4);
  assert.deepEqual([canvas.width, canvas.height], [1002, 600]);
  assert.deepEqual(gl.rect, [0, 0, 1002, 600]);
  renderer.resize(0, 0, 1);
  assert.deepEqual(gl.rect, [0, 0, 1, 1]);
});

test("a draw blends the floor first and depth-tests 26 correctly indexed opaque pieces", () => {
  const { renderer, gl, pieces } = makeRenderer();
  const camera = new math.Orbit().frame(2);
  renderer.draw(pieces, null, camera);
  assert.equal(gl.clearMask, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  assert.equal(gl.draws.length, 27);
  assert.deepEqual(gl.draws[0], { mode: gl.TRIANGLE_STRIP, first: 0, count: 4,
    model: undefined, writeDepth: false, cull: false, blend: true });
  let first = 0;
  gl.draws.slice(1).forEach((draw, i) => {
    assert.equal(draw.first, first);
    assert.equal(draw.mode, gl.TRIANGLES);
    assert.ok(draw.cull && draw.writeDepth && !draw.blend);
    assert.ok(draw.count > 0 && draw.count % 3 === 0);
    vectorClose(draw.model, math.model(pieces[i].basis, pieces[i].pos));
    first += draw.count;
  });
  assert.equal(first, renderer.indexBuffer.data.length);
  const layout = [...gl.pointers.values()].map(p => [p.size, p.stride, p.offset]);
  assert.deepEqual(layout, [[3,40,0], [3,40,12], [3,40,24], [1,40,36]]);
  assert.equal(gl.attributes.size, 0);
  vectorClose(gl.programs[0].uniforms.uVP, camera.vp);
  vectorClose(gl.programs[0].uniforms.uEye, camera.eye);
});

test("only the active nine model matrices change, with the same mesh buffers reused each frame", () => {
  const { renderer, gl, pieces } = makeRenderer();
  const camera = new math.Orbit().frame(1.3), before = cube.clone(pieces);
  const buffers = [...gl.buffers], active = { ...cube.describe("B'"), angle: -0.74 };
  renderer.draw(pieces, active, camera);
  const rotate = math.rotation(active.axis, active.angle);
  let changed = 0;
  gl.draws.slice(1).forEach(({ model }, i) => {
    const p = pieces[i], base = math.model(p.basis, p.pos);
    if (p.pos[active.axis] === active.side) {
      changed++;
      vectorClose(model, math.multiply(rotate, base));
    } else vectorClose(model, base);
  });
  assert.equal(changed, 9);
  assert.deepEqual(pieces, before);
  renderer.draw(pieces, null, camera);
  assert.equal(gl.buffers.length, 3);
  buffers.forEach((buffer, i) => assert.equal(gl.buffers[i], buffer));
  assert.equal(gl.programs.length, 2);
});

test("unavailable contexts, shader failures and link failures reach the caller", () => {
  const names = [];
  assert.throws(() => new Renderer({ getContext(name) { names.push(name); return null; } }, []), /WebGL/);
  assert.deepEqual(names, ["webgl", "experimental-webgl"]);
  for (const failure of ["failCompile", "failLink"]) {
    const gl = new RecordingGL();
    gl[failure] = true;
    assert.throws(() => new Renderer({ getContext: () => gl }, []), /failed/);
  }
});

test("the letter atlas contains six distinct upright glyphs, with padding between neighboring faces", () => {
  const { width, height, pixels } = mesh.letterAtlas();
  assert.deepEqual([width, height, pixels.length], [64, 8, 512]);
  const shapes = new Set();
  for (let cell = 0; cell < 8; cell++) {
    const rows = [];
    for (let y = height - 1; y >= 0; y--) {
      const left = y * width + cell * 8;
      const row = Array.from(pixels.slice(left, left + 8), n => n === 255 ? "#" : ".");
      assert.ok([0, 6, 7].every(i => row[i] === "."));
      rows.push(row.slice(1, 6).join(""));
    }
    assert.equal(rows[0], ".....");
    if (cell >= 6) { assert.ok(rows.every(row => row === ".....")); continue; }
    assert.ok(rows.slice(1).every(row => row.includes("#")));
    if (cube.FACES[cell] === "F") assert.deepEqual(rows.slice(1), ["#####", "#....", "#....", "####.", "#....", "#....", "#...."]);
    shapes.add(rows.join("\n"));
  }
  assert.equal(shapes.size, 6);
});

test("turning sticker letters on keeps the same draw calls and static buffers, with one complete texture", () => {
  const { renderer, gl, pieces } = makeRenderer();
  const camera = new math.Orbit().frame(1.5), turning = { ...cube.describe("L"), angle: 0.38 };
  renderer.draw(pieces, turning, camera);
  const original = structuredClone(gl.draws);
  for (const on of [true, false, true]) {
    renderer.draw(pieces, turning, camera, on);
    assert.deepEqual(gl.draws, original);
    assert.equal(gl.programs[0].uniforms.uLetters, Number(on));
    assert.equal(gl.programs[0].uniforms.uAlphabet, 0);
  }
  assert.equal(gl.textures.length, 1);
  assert.equal(gl.texture.uploads, 1);
  assert.deepEqual(gl.texture.pixels, mesh.letterAtlas().pixels);
  for (const name of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) assert.equal(gl.texture.parameters.get(name), gl.LINEAR);
  for (const name of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) assert.equal(gl.texture.parameters.get(name), gl.CLAMP_TO_EDGE);
  assert.equal(gl.buffers.length, 3);
});
