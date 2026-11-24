"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {workshop, html, root} = require("./workshop-harness");
const {near, vector} = require("./numeric");
const G = require("../js/mesh");
const T = require("../js/track");
const {FINISHES} = require("../js/render");

test("the double-click entry point includes every runtime script and uses only local assets", () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)><\/script>/g)].map(match => {
    assert.match(match[1], /\bdefer\b/);
    assert.doesNotMatch(match[1], /\btype\s*=\s*"module"/);
    return match[1].match(/src="([^"]+)"/)[1];
  });
  const files = fs.readdirSync(path.join(root, "js")).map(name => "js/" + name).sort();
  assert.deepEqual([...scripts].sort(), files);
  assert.equal(scripts.at(-1), "js/app.js");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const attr of html.matchAll(/(?:for|aria-controls|aria-labelledby|aria-describedby)="([^"]+)"/g)) {
    for (const id of attr[1].split(" ")) assert.ok(ids.includes(id), "missing control " + id);
  }
  for (const attr of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (attr[1] === "data:,") continue;
    assert.doesNotMatch(attr[1], /^(?:[a-z]+:|\/|\.\.)/i);
    assert.ok(fs.statSync(path.join(root, attr[1])).isFile());
  }
  assert.match(html, /connect-src 'none'/);
  const css = fs.readFileSync(path.join(root, "style.css"), "utf8");
  assert.doesNotMatch(css, /@import|url\s*\(\s*["']?(?:https?:|\/\/)/i);
  for (const file of files) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(src, /\b(?:fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon\s*\(|import\s*\()/);
  }
});

test("page startup builds every library preview, five swatches, and an idle lit scene", () => {
  const w = workshop();
  assert.equal(w.id("gl-error").hidden, true, w.id("error-detail").textContent);
  const cards = w.id("piece-grid").children;
  assert.deepEqual(cards.map(c => c.dataset.piece), T.LIBRARY.map(piece => piece.id));
  for (const card of cards) {
    assert.equal(card.disabled, false);
    assert.ok(card.getAttribute("aria-label").startsWith("Add "));
    assert.equal(card.querySelector("canvas").pen.copies, 1);
  }
  assert.equal(w.id("swatches").children.length, 5);
  for (const glyph of w.doc.querySelectorAll("[data-icon]")) {
    const canvas = glyph.tagName === "CANVAS" ? glyph : glyph.querySelector("canvas");
    assert.ok(canvas && canvas.pen.strokes > 0, "missing icon " + glyph.dataset.icon);
  }
  assert.equal(w.settle(), 1);
  assert.equal(w.gl.shadowPasses, 1);
  assert.equal(w.gl.screenPasses, T.LIBRARY.length + 1);
  assert.equal(w.gl.screenDraws.filter(d => d.kind === 0).length, 10);
  assert.equal(w.gl.screenDraws.filter(d => d.kind === 1).length, 1);
  assert.equal(w.gl.screenDraws.filter(d => d.kind === 2).length, 1);
  assert.ok(w.gl.screenDraws.every(d => d.shadows === 1));
  assert.equal(w.gl.buffers.size, 24);
  assert.equal(w.id("track-length").textContent, "64.0 m");
  assert.equal(w.id("in-play").textContent, "0");
  assert.equal(w.id("clear").disabled, true);
  assert.equal(w.id("undo").disabled, true);
});

function varyingTypes(source) {
  const types = new Map();
  for (const match of source.matchAll(/\bvarying\s+(?:(?:lowp|mediump|highp)\s+)?(vec[234])\s+([^;]+);/g)) {
    for (const name of match[2].split(",")) types.set(name.trim(), match[1]);
  }
  return types;
}
test("shader sources form complete WebGL 1 stages with matching varyings and extension fallback", () => {
  for (const available of [true, false]) {
    const w = workshop({derivatives: available, highPrecision: available});
    assert.equal(w.id("gl-error").hidden, true, w.id("error-detail").textContent);
    assert.equal(w.gl.programs.length, 2);
    for (const program of w.gl.programs) {
      const [vs, fs] = program.shaders.map(shader => shader.source);
      assert.match(vs, /gl_Position\s*=/);
      assert.match(fs, /gl_FragColor\s*=/);
      assert.match(fs, available ? /precision highp float/ : /precision mediump float/);
      assert.deepEqual(varyingTypes(vs), varyingTypes(fs));
      for (const source of [vs, fs]) {
        assert.equal((source.match(/void\s+main\s*\(\s*\)/g) || []).length, 1);
        const stack = [], pair = {"}": "{", ")": "(", "]": "["};
        for (const token of source.match(/[{}()[\]]/g) || []) {
          if ("{([".includes(token)) stack.push(token);
          else assert.equal(stack.pop(), pair[token]);
        }
        assert.equal(stack.length, 0);
      }
    }
    const fragment = w.gl.programs[0].shaders[1].source;
    assert.equal(fragment.includes("fwidth("), available);
    assert.equal(fragment.startsWith("#extension GL_OES_standard_derivatives : enable"), available);
    w.tick();
    assert.equal(w.gl.shadowPasses, available ? 1 : 0);
    assert.equal(w.gl.screenDraws.length, 12);
  }
});

test("a limited shadow framebuffer falls back to unshadowed directional lighting", () => {
  const w = workshop({framebuffer: false, size: 512});
  w.tick();
  assert.equal(w.id("gl-error").hidden, true);
  assert.equal(w.gl.shadowPasses, 0);
  assert.ok(w.gl.screenDraws.length > 0 && w.gl.screenDraws.every(d => d.shadows === 0));
});

test("launch controls select the actual marble colour and speed, hold, resume, and clear", () => {
  const w = workshop(), balls = () => w.gl.screenDraws.filter(d => d.kind === 2);
  w.settle();
  const swatches = w.id("swatches").children, speed = w.id("speed");
  swatches[3].click();
  speed.value = "12.5"; speed.fire("input");
  assert.equal(w.id("speed-value").textContent, "12.5");
  assert.equal(speed.style.getPropertyValue("--fill"), "78.125%");
  assert.equal(w.id("color-name").textContent, FINISHES[3].name);
  assert.equal(swatches[0].getAttribute("aria-pressed"), "false");
  w.settle();
  vector(balls()[0].tint, G.color(FINISHES[3].hex));
  const gate = balls()[0].model.slice(12, 15);
  w.id("drop").click();
  w.id("drop").click();
  assert.equal(w.id("in-play").textContent, "1");
  assert.match(w.id("toast").textContent, /occupied/);
  w.tick(4);
  const released = balls()[0].model.slice(12, 15);
  assert.ok(released[1] < gate[1]);
  near(released[0] - gate[0], 12.5 * (3 / 60 - 1 / 180), 0.002);
  w.id("pause").click();
  w.settle();
  assert.equal(w.id("pause").getAttribute("aria-label"), "Resume simulation");
  assert.equal(w.id("sim-state").textContent, "Physics paused");
  assert.equal(w.id("pause").querySelector("[data-icon]").dataset.icon, "play");
  const frozen = balls()[0].model.slice();
  w.tick(60);
  vector(frozen, balls()[0].model);
  w.key("p", {}, w.id("scene"));
  w.tick(4);
  assert.ok(balls()[0].model[12] > frozen[12]);
  w.id("clear").click();
  w.settle();
  assert.equal(w.id("in-play").textContent, "0");
  assert.equal(w.id("finished").textContent, "0");
  assert.equal(w.id("clear").disabled, true);
  vector(balls()[0].model.slice(12, 15), gate);
});

test("a full run through the page's frame loop reaches the flag and releases the animation clock", () => {
  const w = workshop();
  w.settle();
  const e = w.key(" ", {code: "Space"}, w.id("scene"));
  assert.equal(e.defaultPrevented, true);
  const frames = w.settle();
  assert.ok(frames > 400 && frames < 900);
  assert.equal(w.id("finished").textContent, "1");
  assert.equal(w.id("in-play").textContent, "0");
  assert.equal(w.gl.screenDraws.filter(d => d.kind === 2).length, 1);
  assert.ok(w.gl.shadowPasses < frames * 0.65);
  w.key("c");
  assert.equal(w.id("finished").textContent, "0");
});

test("cards, keyboard edits, undo, redo, and layout selection change the actual course", () => {
  const w = workshop(), scene = w.id("scene");
  w.settle();
  w.id("layouts-toggle").click();
  assert.equal(w.id("layouts-toggle").getAttribute("aria-expanded"), "true");
  const options = w.id("layouts-menu").querySelectorAll("button");
  assert.equal(w.doc.activeElement, options[0]);
  w.key("ArrowDown");
  assert.equal(w.doc.activeElement, options[1]);
  options.find(option => option.dataset.layout === "empty").click();
  w.settle();
  assert.equal(w.id("piece-count").textContent, "0 pieces");
  assert.equal(w.id("track-name").textContent, "Untitled track");
  assert.equal(w.id("remove").disabled, true);
  assert.equal(w.gl.buffers.size, 8);
  w.id("pause").click();
  w.id("drop").click();
  w.key("@", {code: "Digit2", shiftKey: true}, scene);
  assert.equal(w.id("piece-count").textContent, "1 piece");
  assert.match(w.id("toast").textContent, /Uphill ramp added.*run reset/);
  assert.equal(w.id("in-play").textContent, "0");
  assert.equal(w.id("sim-state").textContent, "Physics paused");
  const riseLength = w.id("track-length").textContent;
  w.id("piece-grid").children[4].click();
  assert.equal(w.id("piece-count").textContent, "2 pieces");
  w.key("z", {ctrlKey: true}, scene);
  assert.equal(w.id("track-length").textContent, riseLength);
  w.key("Z", {metaKey: true, shiftKey: true}, scene);
  assert.equal(w.id("piece-count").textContent, "2 pieces");
  w.key("Backspace", {}, scene);
  assert.equal(w.id("piece-count").textContent, "1 piece");
  w.id("undo").click();
  assert.equal(w.id("piece-count").textContent, "2 pieces");
  w.id("redo").click();
  w.settle();
  assert.equal(w.gl.screenDraws.filter(d => d.kind === 0).length, 3);
  assert.equal(w.gl.buffers.size, 10);
  w.id("layouts-toggle").click();
  options[1].click();
  assert.equal(w.id("track-name").textContent, "Golden Hairpin");
  w.id("undo").click();
  assert.equal(w.id("track-length").textContent, riseLength);
});

test("pointer orbit, scroll, pinch, camera menus, and fit update the view matrix", () => {
  const w = workshop({reducedMotion: true}), scene = w.id("scene");
  const vp = () => w.gl.screenDraws[0].vp;
  w.settle();
  const initial = vp();
  scene.fire("pointerdown", {button: 0, pointerId: 1, clientX: 20, clientY: 30});
  scene.fire("pointermove", {pointerId: 1, clientX: 90, clientY: 54});
  w.settle();
  const rotated = vp();
  assert.notDeepEqual(rotated, initial);
  assert.equal(w.id("view-name").textContent, "Free orbit");
  scene.fire("pointerdown", {button: 0, pointerId: 2, clientX: 150, clientY: 54});
  scene.fire("pointermove", {pointerId: 2, clientX: 210, clientY: 54});
  w.settle();
  const pinched = vp();
  near(pinched[0] / rotated[0], 2, 1e-5);
  scene.fire("pointercancel", {pointerId: 2});
  scene.fire("lostpointercapture", {pointerId: 1});
  assert.equal(scene.classList.contains("dragging"), false);
  const event = scene.fire("wheel", {deltaY: 40, deltaMode: 0});
  w.settle();
  assert.ok(Math.abs(vp()[0]) < Math.abs(pinched[0]));
  assert.equal(event.defaultPrevented, true);
  w.id("view-toggle").click();
  w.id("view-menu").querySelectorAll("button")[1].click();
  w.settle();
  assert.equal(w.id("view-name").textContent, "Overhead");
  const overhead = vp();
  w.id("zoom-in").click();
  w.settle();
  assert.notDeepEqual(vp(), overhead);
  w.id("zoom-out").click();
  w.settle();
  vector(vp(), overhead);
  w.key("+", {}, scene);
  w.key("f", {}, scene);
  w.settle();
  vector(vp(), overhead);
  w.key("ArrowRight", {}, scene);
  w.settle();
  assert.notDeepEqual(vp(), overhead);
});

test("keyboard help, menus, editable controls, and native button activation keep their focus semantics", () => {
  const w = workshop();
  const count = () => w.id("piece-count").textContent;
  w.id("speed").focus();
  assert.equal(w.key("ArrowRight").defaultPrevented, false);
  w.key("1"); w.key(" ");
  assert.equal(count(), "8 pieces");
  assert.equal(w.id("in-play").textContent, "0");
  w.id("scene").focus();
  w.key("?");
  assert.equal(w.id("help").open, true);
  w.key("5");
  assert.equal(count(), "8 pieces");
  w.id("help-close").click();
  w.id("layouts-toggle").click();
  w.key("Escape");
  assert.equal(w.id("layouts-menu").hidden, true);
  assert.equal(w.doc.activeElement, w.id("layouts-toggle"));
  assert.equal(w.key(" ").defaultPrevented, false);
  w.id("layouts-toggle").click();
  w.id("scene").fire("pointerdown", {button: 2});
  assert.equal(w.id("layouts-menu").hidden, true);
  w.id("help-open").click();
  assert.equal(w.id("help").open, true);
  w.id("help").click();
  w.key("5", {repeat: true}, w.id("scene"));
  assert.equal(count(), "8 pieces");
});

test("resizing fits the track, caps the backing resolution, and suspends hidden-tab simulation", () => {
  const w = workshop({dpr: 3, reducedMotion: true}), scene = w.id("scene");
  scene.clientWidth = 350; scene.clientHeight = 430;
  w.window.fire("resize"); w.settle();
  assert.deepEqual(w.gl.viewportSize, [700, 860]);
  scene.clientWidth = 2400; scene.clientHeight = 1200;
  w.window.fire("resize"); w.settle();
  assert.ok(scene.width * scene.height <= 1802000);
  near(scene.width / scene.height, 2, 0.002);
  w.id("drop").click(); w.tick(5);
  const position = () => w.gl.screenDraws.find(d => d.kind === 2).model[12];
  const before = position();
  w.doc.hidden = true; w.doc.fire("visibilitychange");
  w.tick(1, 120000);
  assert.equal(w.frames.size, 0);
  near(position(), before);
  w.doc.hidden = false; w.doc.fire("visibilitychange"); w.tick();
  near(position(), before);
  w.tick(2);
  assert.ok(position() > before);
});

test("unavailable WebGL, compile failures, and link failures all have actionable startup messages", () => {
  for (const [options, title] of [
    [{webgl: false}, "WebGL is unavailable"], [{compile: false}, "3D view could not start"],
    [{link: false}, "3D view could not start"]
  ]) {
    const w = workshop(options);
    assert.equal(w.id("gl-error").hidden, false);
    assert.equal(w.id("error-title").textContent, title);
    assert.ok(w.id("error-detail").textContent.length > 30);
    assert.equal(w.id("sim-state").textContent, "3D offline");
    assert.equal(w.id("drop").disabled, true);
    assert.equal(w.frames.size, 0);
    w.gl.options.compile = true; w.gl.options.link = true;
    w.doc.graphics = w.gl;
    w.id("retry").click();
    w.tick();
    assert.equal(w.id("gl-error").hidden, true, w.id("error-detail").textContent);
    assert.equal(w.id("drop").disabled, false);
  }
});

test("context loss and restoration retain the edited layout and the marble in flight", () => {
  const w = workshop();
  w.key("3"); w.id("drop").click(); w.tick(10);
  w.gl.lost = true;
  const e = w.id("scene").fire("webglcontextlost");
  assert.equal(e.defaultPrevented, true);
  assert.equal(w.id("gl-error").hidden, false);
  assert.match(w.id("error-title").textContent, /interrupted/);
  assert.equal(w.frames.size, 0);
  w.tick(1, 60000);
  w.gl.lost = false;
  w.id("scene").fire("webglcontextrestored");
  w.tick();
  assert.equal(w.id("gl-error").hidden, true, w.id("error-detail").textContent);
  assert.equal(w.id("piece-count").textContent, "9 pieces");
  assert.equal(w.id("in-play").textContent, "1");
  assert.equal(w.gl.screenDraws.filter(d => d.kind === 0).length, 11);
});
