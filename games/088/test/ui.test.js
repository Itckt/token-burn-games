"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { simulate, asSvg } = require("../automaton.js");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
function attributes(source) {
  return Object.fromEntries([...source.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(m => [m[1], m[2] ?? ""]));
}
const tags = [...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)].map(m => ({ tag: m[1], attrs: attributes(m[2]) }));

// Use only the DOM, clock and canvas operations that the page calls. All IDs,
// select defaults, preset buttons and script load order come from the actual HTML.
class Element {
  constructor(attrs = {}) {
    this.attrs = { ...attrs };
    this.value = attrs.value ?? "";
    this.hidden = Object.hasOwn(attrs, "hidden");
    this.open = Object.hasOwn(attrs, "open");
    this.dataset = { rule: attrs["data-rule"] };
    this.children = [];
    this.listeners = new Map();
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  get valueAsNumber() { return this.value === "" ? NaN : Number(this.value); }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  fire(type) {
    if (type === "click" && this.disabled) return;
    for (const fn of this.listeners.get(type) ?? []) fn({ preventDefault() {} });
  }
  click() { this.fire("click"); }
  focus() { this.focused = true; }
  append(...items) {
    for (const item of items) { this.children.push(item); item.parent = this; }
  }
  replaceChildren(...items) {
    for (const item of this.children) item.parent = null;
    this.children = [];
    this.append(...items);
  }
  remove() {
    this.parent.children = this.parent.children.filter(child => child !== this);
  }
}

function openFixture() {
  const fields = new Map(tags.filter(t => t.attrs.id).map(t => [t.attrs.id, new Element(t.attrs)]));
  const by = id => fields.get(id);
  for (const [, source, contents] of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/g)) {
    const options = [...contents.matchAll(/<option\b([^>]*)>/g)].map(m => attributes(m[1]));
    by(attributes(source).id).value = (options.find(o => Object.hasOwn(o, "selected")) ?? options[0])?.value ?? "";
  }
  const presets = tags.filter(t => t.attrs["data-rule"]).map(t => new Element(t.attrs));
  function attachCanvas(id) {
    const drawing = {
      createImageData(width, height) { return { width, height, data: new Uint8ClampedArray(width * height * 4) }; },
      fillRect(...bounds) { this.backdrop = { color: this.fillStyle, bounds }; },
      putImageData(image, ...bounds) { this.image = image; this.bounds = bounds; },
    };
    by(id).getContext = name => { assert.equal(name, "2d"); return drawing; };
    return drawing;
  }
  const drawings = attachCanvas("diagram");
  const damageDrawing = attachCanvas("damage-diagram");
  const clocks = new Map(), timeouts = [], blobs = new Map(), downloads = [];
  let nextId = 1;
  const body = new Element();
  const document = {
    body, getElementById: by,
    querySelectorAll(selector) { assert.equal(selector, "[data-rule]"); return presets; },
    createElement(tag) {
      const el = new Element();
      if (tag === "a") el.addEventListener("click", () => downloads.push({ name: el.download, blob: blobs.get(el.href) }));
      return el;
    },
  };
  const sandbox = vm.createContext({
    document, Blob,
    setInterval(fn, ms) { const id = nextId++; clocks.set(id, { fn, ms }); return id; },
    clearInterval(id) { clocks.delete(id); },
    setTimeout(fn) { timeouts.push(fn); },
    URL: {
      createObjectURL(blob) { const url = "blob:test-" + nextId++; blobs.set(url, blob); return url; },
      revokeObjectURL(url) { blobs.delete(url); },
    },
  });
  for (const { attrs } of tags.filter(t => t.tag === "script")) {
    vm.runInContext(fs.readFileSync(path.join(root, attrs.src), "utf8"), sandbox, { filename: attrs.src });
  }
  function apply(values = {}) {
    for (const [name, value] of Object.entries(values)) by(name).value = String(value);
    by("settings").fire("submit");
  }
  function tick() { for (const { fn } of [...clocks.values()]) fn(); }
  function openPanel(id) { by(id).open = true; by(id).fire("toggle"); }
  return { by, apply, tick, openPanel, clocks, timeouts, drawings, damageDrawing, presets, downloads, blobs, body };
}

function paintedRows(drawing, live = "22,62,53,255") {
  const { width, height, data } = drawing.image;
  const rows = [];
  for (let y = 0; y < height; y++) {
    let word = "";
    for (let x = 0; x < width; x++) {
      const i = 4 * (y * width + x);
      const rgba = Array.from(data.subarray(i, i + 4)).join(",");
      assert.ok(rgba === live || rgba === "250,249,242,255");
      word += rgba === live ? "1" : "0";
    }
    rows.push(word);
  }
  return rows;
}

test("page assets are present locally, IDs are unique and each label targets a control", () => {
  const ids = tags.filter(t => t.attrs.id).map(t => t.attrs.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const { attrs } of tags) {
    if (attrs.for) assert.ok(ids.includes(attrs.for));
    for (const ref of [attrs.src, attrs.href].filter(Boolean)) {
      assert.match(ref, /^[a-z][\w.-]*$/i);
      assert.ok(fs.statSync(path.join(root, ref)).isFile());
    }
  }
  assert.deepEqual(tags.filter(t => t.tag === "script").map(t => t.attrs.src), ["automaton.js", "analysis.js", "workbench.js", "app.js"]);
  assert.match(html, /<html lang="en">/);
});

test("the visual entry point renders the complete default diagram and eight editable outputs", () => {
  const { by, drawings, presets } = openFixture();
  assert.equal(by("rule-title").textContent, "Rule 90");
  assert.equal(by("binary").textContent, "01011010₂");
  assert.equal(by("position").textContent, "63 / 63");
  assert.equal(by("dimensions").textContent, "127 cells × 64 rows");
  assert.equal(by("population").textContent, "64 of 127 cells on in generation 63.");
  assert.deepEqual(drawings.bounds, [0, 0, 0, 0, 127, 64]);
  assert.equal(by("bits").children.map(b => b.children[2].textContent).join(""), "01011010");
  assert.equal(presets.find(p => p.dataset.rule === "90").attrs["aria-pressed"], "true");
  assert.equal(by("error").hidden, true);
  assert.equal(by("step").disabled, true);
});

test("seed controls and canvas pixels agree with a known wrapping evolution", () => {
  const { by, apply, drawings } = openFixture();
  by("seed").value = "custom";
  by("seed").fire("change");
  assert.equal(by("custom-tools").hidden, false);
  assert.equal(by("random-tools").hidden, true);
  apply({ rule: 170, width: 5, rows: 3, pattern: "10000", boundary: "wrap" });
  assert.deepEqual(paintedRows(drawings), ["10000", "00001", "00010"]);
  apply({ boundary: "fixed" });
  assert.deepEqual(paintedRows(drawings), ["10000", "00000", "00000"]);
  apply({ seed: "random", key: 0, width: 31 });
  assert.equal(by("random-tools").hidden, false);
  assert.equal(by("custom-tools").hidden, true);
  const original = paintedRows(drawings);
  apply({ key: 7 });
  assert.notDeepEqual(paintedRows(drawings), original);
  apply({ key: 0 });
  assert.deepEqual(paintedRows(drawings), original);
  apply({ seed: "campus", width: 8 });
  assert.equal(paintedRows(drawings)[0], "00101010");
});

test("rule buttons, presets and both extremes keep the number, table and diagram in sync", () => {
  const { by, apply, presets } = openFixture();
  const bits = by("bits").children;
  bits[7].click();
  assert.equal(by("rule").value, "91");
  assert.equal(bits[7].attrs["aria-pressed"], "true");
  bits[7].click();
  assert.equal(by("rule").value, "90");
  presets.find(p => p.dataset.rule === "110").click();
  assert.equal(by("rule-title").textContent, "Rule 110");
  by("rule-up").click();
  assert.equal(by("rule-title").textContent, "Rule 111");
  by("rule-down").click();
  assert.equal(by("rule").value, "110");
  apply({ rule: 0 });
  assert.equal(by("rule-down").disabled, true);
  bits[0].click();
  assert.equal(by("rule").value, "128");
  apply({ rule: 255 });
  assert.equal(by("rule-up").disabled, true);
  assert.equal(by("binary").textContent, "11111111₂");
  by("rule").value = "12";
  by("rule").fire("input");
  by("rule-up").click();
  assert.equal(by("rule-title").textContent, "Rule 13");
});

test("an invalid form preserves the last valid result and recovers when corrected", () => {
  const { by, apply, drawings, clocks } = openFixture();
  const before = drawings.image;
  by("play").click();
  apply({ width: "" });
  assert.equal(clocks.size, 0);
  assert.equal(by("error").hidden, false);
  assert.match(by("error").textContent, /Width/);
  assert.equal(drawings.image, before);
  apply({ width: 2, seed: "custom", pattern: "single" });
  assert.match(by("error").textContent, /binary pattern/);
  apply({ pattern: "101" });
  assert.match(by("error").textContent, /fit/);
  apply({ pattern: "11", rows: 1 });
  assert.equal(by("error").hidden, true);
  assert.deepEqual(paintedRows(drawings), ["11"]);
  assert.ok(["play", "scrub", "step", "rewind"].every(id => by(id).disabled));
});

test("a preset updates the rule stepper even when a different field prevents applying it", () => {
  const { by, apply, presets } = openFixture();
  apply({ rule: 0 });
  by("width").value = "";
  presets.find(p => p.dataset.rule === "110").click();
  assert.equal(by("rule-title").textContent, "Rule 0");
  assert.equal(by("rule").value, "110");
  assert.equal(by("rule-down").disabled, false);
  by("width").value = "5";
  by("rule-down").click();
  assert.equal(by("rule-title").textContent, "Rule 109");
});

test("play, pause, speed, seek and step reveal the correct rows and stop at the last generation", () => {
  const { by, apply, tick, clocks, drawings } = openFixture();
  apply({ width: 7, rows: 4 });
  by("play").click();
  assert.equal(by("position").textContent, "0 / 3");
  assert.equal(by("play-label").textContent, "Pause");
  assert.equal([...clocks.values()][0].ms, 125);
  tick();
  assert.equal(by("population").textContent, "2 of 7 cells on in generation 1.");
  by("speed").value = "2";
  by("speed").fire("change");
  assert.equal(clocks.size, 1);
  assert.equal([...clocks.values()][0].ms, 500);
  by("play").click();
  tick();
  assert.equal(by("position").textContent, "1 / 3");
  by("step").click();
  assert.equal(by("position").textContent, "2 / 3");
  by("play").click();
  by("scrub").value = "1";
  by("scrub").fire("input");
  assert.equal(clocks.size, 0);
  assert.deepEqual(drawings.backdrop, { bounds: [0, 0, 7, 4], color: "#faf9f2" });
  assert.deepEqual(drawings.bounds, [0, 0, 0, 0, 7, 2]);
  assert.equal(by("scrub").attrs["aria-valuetext"], "Generation 1 of 3");
  by("rewind").click();
  by("play").click();
  tick(); tick(); tick(); tick();
  assert.equal(by("position").textContent, "3 / 3");
  assert.equal(by("play-label").textContent, "Play");
  assert.equal(by("step").disabled, true);
  assert.equal(clocks.size, 0);
  by("play").click();
  apply({ rule: 30 });
  assert.equal(clocks.size, 0);
  assert.equal(by("position").textContent, "3 / 3");
});

test("saving exports precisely the visible generations and releases the local download URL", async () => {
  const { by, apply, downloads, blobs, timeouts, body } = openFixture();
  apply({ rule: 30, rows: 6, width: 9 });
  by("rewind").click();
  by("step").click();
  by("save").click();
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].name, "rule-30-g1.svg");
  assert.equal(downloads[0].blob.type, "image/svg+xml");
  assert.equal(await downloads[0].blob.text(), asSvg(simulate({ rule: 30, rows: 2, width: 9 }).history));
  assert.equal(body.children.length, 0);
  assert.equal(blobs.size, 1);
  timeouts.forEach(fn => fn());
  assert.equal(blobs.size, 0);
});

test("cycle navigation seeks to the first repeat and the activity readout follows playback", () => {
  const { by, apply, clocks, tick } = openFixture();
  apply({ rule: 170, boundary: "wrap", width: 3, rows: 8 });
  assert.equal(by("cycle-summary").textContent, "Generation 3 repeats generation 0 (period 3).");
  assert.equal(by("go-repeat").hidden, false);
  by("play").click();
  assert.equal(by("activity").textContent, "Seed row.");
  tick();
  assert.equal(by("activity").textContent, "2 cells changed since generation 0.");
  by("go-repeat").click();
  assert.equal(clocks.size, 0);
  assert.equal(by("position").textContent, "3 / 7");
  assert.equal(by("activity").textContent, "2 cells changed since generation 2.");
  apply({ rows: 3 });
  assert.equal(by("go-repeat").hidden, true);
  assert.equal(by("cycle-summary").textContent, "No repeated row in 3 generations.");
  apply({ rule: 204, rows: 2 });
  assert.equal(by("cycle-summary").textContent, "Generation 1 repeats generation 0 (fixed point, period 1).");
});

test("equivalent-run controls transform the applied seed and edges at the same timeline position", async () => {
  const { by, apply, drawings, downloads, clocks, tick } = openFixture();
  apply({ rule: 30, width: 6, rows: 4, seed: "custom", pattern: "100010" });
  const original = paintedRows(drawings);
  assert.deepEqual(["mirror", "invert", "both"].map(id => by(id + "-rule").textContent), ["Rule 86", "Rule 135", "Rule 149"]);
  by("play").click(); tick();
  by("invert").click();
  assert.equal(clocks.size, 0);
  assert.equal(by("position").textContent, "1 / 3");
  assert.equal(by("rule").value, "135");
  assert.equal(by("boundary").value, "fixed-on");
  assert.equal(by("pattern").value, "011101");
  assert.equal(by("custom-tools").hidden, false);
  const inverted = original.map(word => word.replace(/[01]/g, bit => bit === "0" ? "1" : "0"));
  assert.deepEqual(paintedRows(drawings), inverted);
  by("save").click();
  assert.equal(downloads[0].name, "rule-135-g1.svg");
  assert.equal(await downloads[0].blob.text(), asSvg(simulate({
    rule: 135, width: 6, rows: 2, seed: "011101", boundary: "fixed-on",
  }).history));
  by("mirror").click();
  assert.deepEqual(paintedRows(drawings), inverted.map(word => [...word].reverse().join("")));
  by("both").click();
  assert.equal(by("boundary").value, "fixed");
  assert.deepEqual(paintedRows(drawings), original);
  apply();
  assert.deepEqual(paintedRows(drawings), original);
});

test("predecessor samples track the selected row and can start a new run from a one-row diagram", () => {
  const { by, apply, drawings } = openFixture();
  apply({ rule: 170, width: 4, rows: 1, seed: "custom", pattern: "1000", boundary: "wrap" });
  assert.equal(by("parent-generation").textContent, "0");
  assert.equal(by("parent-seeds").children.length, 0);
  by("parents").open = true;
  by("parents").fire("toggle");
  assert.equal(by("parent-count").textContent, "1 predecessor.");
  const sample = by("parent-seeds").children[0].children[0];
  assert.equal(sample.textContent, "0100");
  assert.match(sample.attrs["aria-label"], /0100/);
  sample.click();
  assert.deepEqual(paintedRows(drawings), ["0100", "1000"]);
  assert.equal(by("rows").value, "2");
  assert.equal(by("pattern").value, "0100");
  assert.equal(by("position").textContent, "1 / 1");
  assert.equal(by("scrub").focused, true);
  by("rewind").click();
  assert.equal(by("parent-seeds").children[0].children[0].textContent, "0010");
  apply({ rule: 0, rows: 3 });
  assert.equal(by("parent-count").textContent, "First 3 of 16 predecessors.");
  assert.deepEqual(by("parent-seeds").children.map(li => li.children[0].textContent), ["0000", "0001", "0010"]);
  by("rewind").click();
  assert.equal(by("parent-count").textContent, "0 predecessors.");
  assert.equal(by("parent-help").hidden, true);
  assert.equal(by("parent-seeds").children.length, 0);
});

test("inspection pauses playback and reopens on the current generation", () => {
  const { by, apply, clocks, tick } = openFixture();
  apply({ rule: 0, width: 2, rows: 4 });
  by("play").click();
  by("parents").open = true;
  by("parents").fire("toggle");
  assert.equal(clocks.size, 0);
  assert.equal(by("parent-count").textContent, "0 predecessors.");
  by("parents").open = false;
  by("parents").fire("toggle");
  by("play").click(); tick();
  by("parents").open = true;
  by("parents").fire("toggle");
  assert.equal(clocks.size, 0);
  assert.equal(by("parent-generation").textContent, "1");
  assert.equal(by("parent-help").hidden, false);
  assert.equal(by("parent-count").textContent, "First 3 of 4 predecessors.");
});

test("a random key survives a round trip through an explicit transformed seed", () => {
  const { by, apply, drawings } = openFixture();
  apply({ seed: "random", key: 0, width: 16, rows: 2 });
  const initial = paintedRows(drawings);
  by("mirror").click();
  apply();
  by("mirror").click();
  apply({ seed: "random" });
  assert.equal(by("key").value, "0");
  assert.deepEqual(paintedRows(drawings), initial);
});

test("loading an experiment restores its applied random key even after a pending key edit or custom reapply", () => {
  const { by, apply, drawings } = openFixture();
  apply({ seed: "random", key: 4294967295, rule: 30, width: 16, rows: 3 });
  const initial = paintedRows(drawings);
  by("key").value = "7";
  by("mirror").click();
  assert.equal(by("key").value, "4294967295");
  apply();
  by("mirror").click();
  assert.equal(by("key").value, "4294967295");
  apply({ seed: "random" });
  assert.deepEqual(paintedRows(drawings), initial);
});

test("the damage plot paints only the selected prefix and tracks the timeline without evolving the run again", () => {
  const { by, apply, openPanel, tick, clocks, damageDrawing } = openFixture();
  apply({ rule: 90, width: 7, rows: 5 });
  assert.equal(damageDrawing.image, undefined);
  by("play").click();
  tick();
  openPanel("damage");
  assert.equal(clocks.size, 0);
  assert.equal(by("damage-cell").value, "3");
  assert.equal(by("damage-cell").max, "6");
  assert.equal(by("damage-count").textContent, "Flipped cell 3 · generation 1 · 2 different cells.");
  assert.equal(by("damage-agreement").textContent, "The runs agree from generation 4.");
  assert.deepEqual(damageDrawing.bounds, [0, 0, 0, 0, 7, 2]);
  assert.deepEqual(paintedRows(damageDrawing, "167,68,37,255"), ["0001000", "0010100", "0100010", "1010101", "0000000"]);
  const image = damageDrawing.image;
  by("rewind").click();
  assert.equal(damageDrawing.image, image);
  assert.deepEqual(damageDrawing.bounds, [0, 0, 0, 0, 7, 1]);
  assert.match(by("damage-diagram").attrs["aria-label"], /generation 0 · 1 different cell\./);
  apply({ width: 1, rows: 1 });
  assert.equal(by("damage-cell").value, "0");
  assert.equal(by("damage-cell").max, "0");
  assert.equal(by("damage-agreement").textContent, "No agreement in 1 generation.");
});

test("an edge flip can become the new seed at the same generation after a failed comparison", () => {
  const { by, apply, drawings, damageDrawing, openPanel } = openFixture();
  apply({ rule: 170, width: 4, rows: 3, seed: "custom", pattern: "1000", boundary: "wrap" });
  openPanel("damage");
  const original = paintedRows(drawings);
  by("damage-cell").value = "0";
  by("damage-form").fire("submit");
  assert.deepEqual(paintedRows(damageDrawing, "167,68,37,255"), ["1000", "0001", "0010"]);
  const image = damageDrawing.image;
  by("damage-cell").value = "4";
  by("damage-form").fire("submit");
  assert.match(by("damage-error").textContent, /0 to 3/);
  assert.equal(damageDrawing.image, image);
  assert.deepEqual(paintedRows(drawings), original);
  by("scrub").value = "1";
  by("scrub").fire("input");
  by("width").value = "";
  by("use-flip").click();
  assert.equal(by("width").value, "4");
  assert.equal(by("pattern").value, "0000");
  assert.equal(by("position").textContent, "1 / 2");
  assert.deepEqual(paintedRows(drawings), ["0000", "0000", "0000"]);
  assert.equal(by("damage-error").hidden, true);
  assert.equal(by("damage-cell").value, "0");
  by("use-flip").click();
  assert.deepEqual(paintedRows(drawings), original);
});

test("timeline inference forgets future evidence on rewind and can replay an alternative rule", () => {
  const { by, apply, openPanel, drawings, clocks, tick } = openFixture();
  apply({ rule: 170, seed: "custom", pattern: "00010111", width: 8, rows: 3, boundary: "wrap" });
  by("play").click(); tick();
  openPanel("inference");
  assert.equal(clocks.size, 0);
  assert.equal(by("evidence-source").textContent, "Generations 0 through 1 · 8 cells · wrap");
  assert.equal(by("evidence-bits").textContent, "10101010");
  assert.equal(by("candidate-count").textContent, "1 compatible rule");
  assert.equal(by("candidate").value, "170");
  by("rewind").click();
  assert.equal(by("evidence-bits").textContent, "????????");
  assert.deepEqual(by("candidate").children.map(o => o.value), Array.from({ length: 256 }, (_, n) => String(n)));
  by("candidate").value = "204";
  by("try-rule").click();
  assert.equal(by("rule").value, "204");
  assert.equal(by("position").textContent, "0 / 2");
  assert.deepEqual(paintedRows(drawings), ["00010111", "00010111", "00010111"]);
  apply({ seed: "random", key: 0, rows: 1 });
  const seed = paintedRows(drawings)[0];
  by("candidate").value = "0";
  by("try-rule").click();
  assert.equal(by("seed").value, "random");
  assert.equal(by("key").value, "0");
  assert.equal(paintedRows(drawings)[0], seed);
});

test("entered observations replay at their own width, flag contradictions and recover from malformed input", () => {
  const { by, apply, openPanel, drawings } = openFixture();
  apply({ rule: 30, rows: 1, width: 9, boundary: "wrap" });
  openPanel("inference");
  const rows = ["00010111", "00101110", "01011100"];
  by("observations").value = rows.join("\r\n");
  by("inference-form").fire("submit");
  assert.equal(by("candidate").value, "170");
  assert.equal(by("evidence-source").textContent, "3 entered rows · 8 cells · wrap");
  by("try-rule").click();
  assert.deepEqual(paintedRows(drawings), rows);
  assert.equal(by("width").value, "8");
  assert.equal(by("position").textContent, "2 / 2");
  assert.equal(by("seed").value, "custom");
  assert.equal(by("pattern").value, rows[0]);
  by("observations").value = "0/0/1";
  by("inference-form").fire("submit");
  assert.equal(by("candidate-count").textContent, "0 compatible rules");
  assert.equal(by("evidence-bits").textContent, "???????!");
  assert.equal(by("candidate-controls").hidden, true);
  assert.equal(by("try-rule").disabled, true);
  by("observations").value = "00/1";
  by("inference-form").fire("submit");
  assert.match(by("inference-error").textContent, /row 2/);
  assert.deepEqual(paintedRows(drawings), rows);
  by("observations").value = "";
  by("inference-form").fire("submit");
  assert.equal(by("inference-error").hidden, true);
  assert.equal(by("candidate-controls").hidden, false);
  assert.equal(by("try-rule").disabled, false);
  assert.equal(by("candidate").value, "170");
});

test("literal observations follow boundary changes only when the new settings are applied", () => {
  const { by, apply, openPanel } = openFixture();
  apply({ width: 2, rows: 1, boundary: "fixed" });
  openPanel("inference");
  by("observations").value = "00/10";
  by("boundary").value = "fixed-on";
  by("inference-form").fire("submit");
  assert.equal(by("evidence-bits").textContent, "???????!");
  assert.equal(by("candidate-count").textContent, "0 compatible rules");
  apply();
  assert.equal(by("evidence-bits").textContent, "???1??0?");
  assert.equal(by("candidate-count").textContent, "64 compatible rules");
  assert.equal(by("try-rule").disabled, false);
  apply({ boundary: "wrap" });
  assert.equal(by("try-rule").disabled, true);
});

test("basin browsing uses the chosen width and opens a witness long enough to reach its first repeat", () => {
  const { by, apply, openPanel, drawings, clocks } = openFixture();
  apply({ rule: 170, width: 7, rows: 2, boundary: "wrap" });
  by("play").click();
  openPanel("basins");
  assert.equal(clocks.size, 0);
  by("basin-width").value = "3";
  by("basin-form").fire("submit");
  assert.equal(by("width").value, "7");
  assert.equal(by("basin-count").textContent, "Rule 170 · 3 cells · wrap · 8 seeds in 4 basins.");
  assert.equal(by("basin-rank").max, "4");
  assert.equal(by("cycle-seed").textContent, "001");
  by("basin-rank").value = "2";
  by("basin-rank").fire("input");
  assert.equal(by("cycle-seed").textContent, "011");
  assert.equal(by("basin-size").textContent, "3");
  assert.equal(by("basin-period").textContent, "3");
  assert.equal(by("basin-depth").textContent, "0");
  by("use-basin").click();
  assert.equal(by("width").value, "3");
  assert.equal(by("position").textContent, "0 / 3");
  assert.deepEqual(paintedRows(drawings), ["011", "110", "101", "011"]);
  assert.equal(by("basin-position").textContent, "2 / 4");
  apply({ rows: 1, boundary: "fixed" });
  assert.equal(by("basin-rank").disabled, true);
  assert.equal(by("basin-depth").textContent, "3");
  assert.equal(by("use-basin").textContent, "Run example seed 001");
  by("use-basin").click();
  assert.deepEqual(paintedRows(drawings), ["001", "010", "100", "000", "000"]);
});

test("a large diagram opens a small basin map, validates width edits, and caps long example runs", () => {
  const { by, apply, openPanel } = openFixture();
  apply({ rule: 204, width: 127, rows: 1 });
  openPanel("basins");
  assert.equal(by("basin-width").value, "8");
  by("basin-width").value = "13";
  by("basin-form").fire("submit");
  assert.match(by("basin-error").textContent, /1 to 12/);
  assert.match(by("basin-count").textContent, /256 seeds in 256 basins/);
  by("basin-width").value = "12";
  by("basin-form").fire("submit");
  assert.equal(by("basin-error").hidden, true);
  assert.equal(by("basin-rank").max, "4096");
  by("basin-rank").value = "4096";
  by("basin-rank").fire("input");
  assert.equal(by("cycle-seed").textContent, "111111111111");
  apply({ rule: 45, width: 11, boundary: "wrap" });
  assert.equal(by("basin-period").textContent, "979");
  by("use-basin").click();
  assert.equal(by("rows").value, "512");
  assert.equal(by("position").textContent, "0 / 511");
  assert.equal(by("cycle-summary").textContent, "No repeated row in 512 generations.");
});
