"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const mesh = require("../js/geometry");
const textures = require("../js/textures");
const storm = require("../js/storm");
const math = require("../js/math");
const shaders = require("../js/shaders");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("the sea is a nondegenerate upward-facing two-triangle plane", () => {
  const vertices = mesh.plane();
  assert.equal(vertices.length, 12); assert.equal(new Set(vertices).size, 2);
  for (let i = 0; i < vertices.length; i += 6) {
    const a = [vertices[i], 0, vertices[i + 1]], b = [vertices[i + 2], 0, vertices[i + 3]], c = [vertices[i + 4], 0, vertices[i + 5]];
    const normal = math.cross(b.map((n, j) => n - a[j]), c.map((n, j) => n - a[j]));
    assert.deepEqual(normal, [0, 4, 0]);
  }
});

test("cloud quads share four profile vertices with the expected UVs, normals and winding", () => {
  const particles = storm.makeClouds(333, 50);
  const { profiles, indices } = mesh.billboards(particles);
  assert.equal(profiles.length, 50 * 24); assert.equal(indices.length, 50 * 6);
  for (let i = 0; i < particles.length; i++) {
    const base = i * 4;
    assert.deepEqual(Array.from(indices.slice(i * 6, i * 6 + 6)), [base, base + 1, base + 2, base, base + 2, base + 3]);
    for (let j = 0; j < 4; j++) {
      const o = (base + j) * 6;
      assert.deepEqual(Array.from(profiles.slice(o, o + 2)), [[-1, -1], [1, -1], [1, 1], [-1, 1]][j]);
      assert.equal(profiles[o + 4], particles[i].tile);
      assert.equal(profiles[o + 2], Math.fround(particles[i].size));
      assert.equal(profiles[o + 3], Math.fround(particles[i].stretch));
    }
  }
});

test("billboard index limits and sorted prefix updates keep buffer boundaries intact", () => {
  assert.equal(mesh.billboards([]).indices.length, 0);
  const particle = storm.makeClouds(1, 1)[0];
  const full = mesh.billboards(Array(16384).fill(particle));
  assert.equal(full.indices.at(-1), 65535);
  assert.throws(() => mesh.billboards(Array(16385)), RangeError);
  const indices = new Uint16Array(19).fill(999);
  mesh.writeIndices(indices, [2, 0, 1]);
  assert.deepEqual(Array.from(indices.slice(0, 6)), [8, 9, 10, 8, 10, 11]);
  assert.equal(indices[6], 0); assert.equal(indices[12], 4); assert.equal(indices[18], 999);
});

test("value noise tiles continuously, including across negative world coordinates", () => {
  const noise = textures.noiseSource(storm.randomSource(27));
  for (const period of [4, 16, 128]) {
    for (const x of [-19.26, -0.4, 0, 3.14, 23.09]) {
      const n = noise(x, -5.37, period);
      assert.ok(n >= 0 && n <= 1);
      assert.ok(Math.abs(noise(x + period, -5.37 - period, period) - n) < 1e-12);
    }
    assert.ok(Math.abs(noise(-0.000001, 0.44, period) - noise(0.000001, 0.44, period)) < 1e-8);
  }
});

test("procedural water has reproducible multiscale data and complete RGBA texels", () => {
  const a = textures.oceanNoise();
  assert.deepEqual(a.data, textures.oceanNoise().data);
  assert.equal(a.data.length, a.width * a.height * 4);
  assert.equal(a.width & (a.width - 1), 0);
  const levels = [new Set(), new Set(), new Set()];
  for (let i = 0; i < a.data.length; i += 4) {
    for (let c = 0; c < 3; c++) levels[c].add(a.data[i + c]);
    assert.equal(a.data[i + 3], 255);
  }
  assert.ok(levels.every(set => set.size > 125));
});

test("all atlas tiles have a transparent gutter, a solid centre and shaded translucent edges", () => {
  const size = 64, atlas = textures.cloudAtlas(size);
  assert.equal(atlas.width, 2 * size); assert.equal(atlas.height, 2 * size);
  assert.deepEqual(atlas.data, textures.cloudAtlas(size).data);
  const variants = new Set();
  for (let tile = 0; tile < 4; tile++) {
    const counts = { transparent: 0, partial: 0, solid: 0 };
    const tones = new Set(), normals = new Set();
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = ((y + (tile >> 1) * size) * atlas.width + x + (tile & 1) * size) * 4;
      const alpha = atlas.data[i + 3];
      counts[alpha === 0 ? "transparent" : alpha === 255 ? "solid" : "partial"]++;
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) assert.equal(alpha, 0);
      if (x === size / 2 && y === size / 2) assert.equal(alpha, 255);
      if (alpha > 0) {
        tones.add(atlas.data[i + 2]); normals.add(atlas.data[i]);
        const nx = atlas.data[i] / 127.5 - 1, ny = atlas.data[i + 1] / 127.5 - 1;
        assert.ok(nx * nx + ny * ny < 1.025);
      }
    }
    variants.add(JSON.stringify(counts));
    assert.ok(counts.transparent > 700 && counts.solid > 260 && counts.partial > 500);
    assert.ok(tones.size > 90 && normals.size > 110);
  }
  assert.equal(variants.size, 4);
});

function declarations(source, kind) {
  const result = {};
  const pattern = new RegExp("\\b" + kind + "\\s+(?:(lowp|mediump|highp)\\s+)?(\\w+)\\s+([^;]+);", "g");
  for (const match of source.matchAll(pattern)) {
    for (const name of match[3].split(",").map(n => n.trim())) result[name] = [match[1], match[2]];
  }
  return result;
}

test("each WebGL 1 shader pair has balanced GLSL, matching varying interfaces and a stage output", () => {
  assert.deepEqual(Object.keys(shaders).sort(), ["cloud", "deck", "doppler", "pressure", "radar", "rain", "sea", "wind"]);
  for (const { vertex, fragment } of Object.values(shaders)) {
    for (const source of [vertex, fragment]) {
      assert.equal((source.match(/\bvoid\s+main\s*\(\s*\)/g) || []).length, 1);
      const stack = [];
      for (const char of source) {
        if ("({[".includes(char)) stack.push(char);
        else if (")}]".includes(char)) assert.equal(stack.pop(), { ")": "(", "}": "{", "]": "[" }[char]);
      }
      assert.equal(stack.length, 0);
      assert.doesNotMatch(source, /#include|#version 300|\b(?:undefined|NaN)\b/);
    }
    assert.match(vertex, /\bgl_Position\s*=/);
    assert.match(fragment, /\bgl_FragColor\s*=/);
    assert.match(fragment, /precision mediump float/);
    assert.deepEqual(declarations(vertex, "varying"), declarations(fragment, "varying"));
    assert.ok(Object.keys(declarations(vertex, "attribute")).length > 0);
  }
});

test("the double-click entry loads every script in dependency order from local classic files", () => {
  const tags = [...html.matchAll(/<script\b([^>]+)><\/script>/g)].map(match => match[1]);
  const scripts = tags.map(tag => tag.match(/src="([^"]+)"/)[1]);
  const actual = fs.readdirSync(path.join(root, "js")).filter(f => f.endsWith(".js")).map(f => "js/" + f);
  assert.deepEqual([...scripts].sort(), actual.sort());
  assert.ok(tags.every(tag => /\bdefer\b/.test(tag) && !/type="module"|\basync\b/.test(tag)));
  const context = vm.createContext({});
  for (const name of scripts) {
    const code = fs.readFileSync(path.join(root, name), "utf8");
    const parsed = new vm.Script(code, { filename: name });
    if (name !== "js/app.js") parsed.runInContext(context);
    assert.doesNotMatch(code, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(|\bimport\s*\(/);
  }
  assert.equal(scripts.at(-1), "js/app.js");
  assert.ok(context.Isobar.renderer.makeRenderer);
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.doesNotMatch(css, /@import\b|url\s*\(/);
  for (const [, url] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    if (url === "data:,") continue;
    assert.doesNotMatch(url, /:|^\/|\.\./);
    assert.ok(fs.statSync(path.join(root, url)).isFile());
  }
});

test("the HTML associates control labels, dialog headings and error feedback with existing elements", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size);
  for (const [, name] of html.matchAll(/(?:for|aria-labelledby|aria-controls)="([^"]+)"/g)) assert.ok(ids.includes(name));
  assert.match(html, /<label for="signal">/);
  assert.match(html, /id="signal" type="range" min="1" max="10" step="1"/);
  assert.equal((html.match(/role="switch"/g) || []).length, 3);
  assert.match(html, /id="graphics-message" role="alert"/);
  assert.match(html, /<noscript>/);
  assert.match(html, /Drag to orbit/);
});

test("the life-cycle plot and cursor share the native slider thumb's travel at both endpoints", () => {
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(html, /class="cycle-track"><canvas class="cycle-curve"/);
  assert.match(css, /\.cycle-track\s*\{[^}]*inset: 0 calc\(var\(--range-thumb\) \/ 2\)/);
  assert.match(css, /\.cycle-track::after\s*\{[^}]*left: var\(--cursor\)/);
  for (const thumb of ["-webkit-slider-thumb", "-moz-range-thumb"]) {
    assert.match(css, new RegExp(thumb + "\\s*\\{[^}]*width: var\\(--range-thumb\\)"));
  }
});
