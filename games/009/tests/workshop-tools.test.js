"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {workshop, chooseLayout, openBlueprint, speed, edit} = require("./workshop-harness");
const {vector} = require("./numeric");
const B = require("../js/blueprint");
const T = require("../js/track");

const ghost = w => w.gl.screenDraws.find(draw => draw.kind === 3);

test("both active pieces work through cards and shortcuts and the relay can be timed through the page", () => {
  const w = workshop();
  chooseLayout(w,"empty");
  const cards = w.id("piece-grid").children;
  cards.find(c => c.dataset.piece === "drive").click();
  assert.match(w.id("toast").textContent,/Drive strip added/);
  w.key("8", {code: "Numpad8"}, w.id("scene"));
  assert.match(w.id("toast").textContent,/Brake strip added/);
  assert.equal(w.id("piece-count").textContent,"2 pieces");
  assert.equal(w.key("0", {code: "Digit0"}, w.id("scene")).defaultPrevented,false);
  w.id("undo").click();
  assert.equal(w.id("piece-count").textContent,"1 piece");
  chooseLayout(w,"relay");
  w.id("trials-tab").click();
  speed(w,5);
  w.id("drop").click();
  w.settle();
  assert.equal(w.id("track-name").textContent,"Lion Rock Relay");
  assert.equal(w.id("finished").textContent,"1");
  assert.equal(w.id("trial-state").textContent,"Finished");
  assert.ok(parseFloat(w.id("trial-best").textContent) > parseFloat(w.id("trial-split").textContent));
  assert.match(w.id("trial-results").textContent,/#1\s+Persimmon/);
});

test("timing tabs support keyboard navigation and the board catches up when reopened", () => {
  const w = workshop(), build = w.id("build-tab"), trials = w.id("trials-tab");
  build.focus();
  assert.ok(w.key("End").defaultPrevented);
  assert.equal(w.doc.activeElement,trials);
  assert.equal(trials.getAttribute("aria-selected"),"true");
  assert.equal(w.id("build-panel").hidden,true);
  assert.equal(w.id("trial-state").textContent,"Ready");
  w.key("Home");
  assert.equal(w.doc.activeElement,build);
  assert.equal(trials.getAttribute("tabindex"),"-1");
  chooseLayout(w,"empty");
  w.id("drop").click();
  w.settle();
  build.focus(); w.key("ArrowRight");
  assert.equal(w.id("trial-state").textContent,"Finished");
  assert.equal(w.id("trial-results").children.length,1);
  w.key("ArrowLeft");
  w.id("clear").click();
  trials.click();
  assert.equal(w.id("trial-runner").textContent,"Release gate");
  assert.equal(w.id("trial-best").textContent,"—");
  assert.equal(w.id("trial-results").textContent,"No finishes yet.");
});

test("the second drop races a switchable ghost, posts split and finish gaps, and uses no extra marble slot or shadow", () => {
  const w = workshop();
  chooseLayout(w,"empty"); w.settle();
  w.id("trials-tab").click();
  speed(w,5); w.id("drop").click(); w.settle();
  const first = parseFloat(w.id("trial-best").textContent);
  assert.ok(first > 0);
  w.id("swatches").children[1].click(); speed(w,10);
  w.id("pause").click(); w.id("drop").click(); w.settle();
  assert.equal(w.id("trial-state").textContent,"Paused");
  assert.match(w.id("trial-runner").textContent,/#2\s+Jade/);
  assert.equal(w.id("in-play").textContent,"1");
  assert.ok(ghost(w));
  assert.equal(w.gl.shadowDraws,w.gl.screenDraws.filter(d => d.kind === 0 || d.kind === 2).length);
  w.id("ghost-toggle").click(); w.settle();
  assert.equal(ghost(w),undefined);
  assert.equal(w.id("ghost-toggle").getAttribute("aria-pressed"),"false");
  w.key("g",{},w.id("scene")); w.settle();
  assert.ok(ghost(w));
  w.id("pause").click(); w.tick(8);
  assert.equal(w.id("trial-state").textContent,"Rolling");
  assert.ok(parseFloat(w.id("trial-clock").textContent) > 0);
  assert.match(w.id("trial-gap").textContent,/ahead at halfway/);
  assert.ok(ghost(w).model[12] < w.gl.screenDraws.find(d => d.kind === 2).model[12]);
  w.settle();
  assert.match(w.id("trial-gap").textContent,/ahead at the flag/);
  assert.ok(parseFloat(w.id("trial-best").textContent) < first);
  assert.equal(w.id("finished").textContent,"2");
  assert.equal(w.id("trial-results").children.length,2);
  assert.equal(ghost(w),undefined);
  w.key("7",{},w.id("scene"));
  assert.equal(w.id("trial-best").textContent,"—");
  assert.equal(w.id("trial-gap").hidden,true);
  assert.equal(w.id("trial-results").textContent,"No finishes yet.");
});

test("tab hiding and WebGL recovery hold both the reference and the racing marble", () => {
  const w = workshop(), scene = w.id("scene");
  chooseLayout(w,"empty"); w.id("trials-tab").click();
  w.id("drop").click(); w.settle();
  speed(w,6); w.id("drop").click(); w.tick(4);
  const read = () => [w.id("trial-clock").textContent, w.id("trial-best").textContent];
  const times = read(), pose = ghost(w).model.slice();
  w.doc.hidden = true; w.doc.fire("visibilitychange"); w.tick(1,60000);
  w.doc.hidden = false; w.doc.fire("visibilitychange"); w.tick();
  vector(ghost(w).model,pose);
  assert.deepEqual(read(),times);
  w.gl.lost = true; scene.fire("webglcontextlost"); w.tick(1,60000);
  w.gl.lost = false; scene.fire("webglcontextrestored"); w.tick();
  vector(ghost(w).model,pose);
  assert.deepEqual(read(),times);
  w.settle();
  assert.equal(w.id("finished").textContent,"2");
});

test("a missed loop freezes its clock and leaves the course record open", () => {
  const w = workshop();
  w.id("trials-tab").click();
  speed(w,5); w.id("drop").click(); w.settle();
  assert.equal(w.id("trial-state").textContent,"Off track");
  assert.ok(parseFloat(w.id("trial-clock").textContent)>0);
  assert.equal(w.id("trial-best").textContent,"—");
  assert.equal(w.id("finished").textContent,"0");
  assert.equal(w.id("in-play").textContent,"0");
});

test("blueprints export a named copy, reject bad input without changing a run, and import in one undoable edit", () => {
  const w = workshop();
  w.id("pause").click(); w.id("drop").click();
  openBlueprint(w);
  assert.ok(w.id("blueprints").open);
  assert.equal(w.id("blueprint-export").value,B.encode(T.PRESETS.switchback));
  edit(w,"blueprint-name","   ");
  assert.equal(w.id("blueprint-copy").disabled,true);
  assert.equal(w.id("blueprint-export").value,"");
  edit(w,"blueprint-name","Kowloon / 夜班");
  const output = w.id("blueprint-export");
  assert.equal(B.decode(output.value).name,"Kowloon / 夜班");
  w.id("blueprint-copy").click();
  assert.equal(w.doc.activeElement,output);
  assert.equal(output.selectionEnd,output.value.length);
  assert.match(w.id("blueprint-status").textContent,/selected/);
  edit(w,"blueprint-input","LF1/4/SX/Unknown");
  w.id("blueprint-load").click();
  assert.ok(w.id("blueprints").open);
  assert.equal(w.id("blueprint-input").getAttribute("aria-invalid"),"true");
  assert.match(w.id("blueprint-status").textContent,/unknown piece/);
  w.key("7",{},w.id("scene")); w.key("c",{},w.id("scene"));
  assert.equal(w.id("in-play").textContent,"1");
  assert.equal(w.id("piece-count").textContent,"8 pieces");
  assert.equal(w.id("undo").disabled,true);
  edit(w,"blueprint-input","LF1/5.5/UPB/<Night shift>");
  w.id("blueprint-load").click();
  assert.equal(w.id("blueprints").open,false);
  assert.equal(w.doc.activeElement,w.id("layouts-toggle"));
  assert.equal(w.id("track-name").textContent,"<Night shift>");
  assert.equal(w.id("track-name").children.length,0);
  assert.equal(w.id("piece-count").textContent,"3 pieces");
  assert.equal(w.id("in-play").textContent,"0");
  assert.equal(w.id("sim-state").textContent,"Physics paused");
  w.id("undo").click();
  assert.equal(w.id("track-name").textContent,T.PRESETS.switchback.name);
  assert.equal(w.id("undo").disabled,true);
  w.id("redo").click();
  openBlueprint(w);
  assert.equal(output.value,"LF1/5.5/UPB/<Night shift>");
  w.key("Escape");
  assert.equal(w.id("blueprints").open,false);
  assert.equal(w.doc.activeElement,w.id("layouts-toggle"));
});

test("copy uses the available clipboard and keeps the full text selected when copying is denied", async () => {
  for (const denied of [true,false]) {
    let written;
    const w = workshop({navigator: {clipboard: {async writeText(code) {
      if (denied) throw new Error("Access denied");
      written = code;
    }}}});
    openBlueprint(w); w.id("blueprint-copy").click();
    await new Promise(resolve => setImmediate(resolve));
    if (denied) {
      assert.match(w.id("blueprint-status").textContent,/selected/);
      const output = w.id("blueprint-export");
      assert.equal(output.selectionStart,0);
      assert.equal(output.selectionEnd,output.value.length);
    } else {
      assert.equal(written,B.encode(T.PRESETS.switchback));
      assert.match(w.id("blueprint-status").textContent,/copied/);
    }
  }
});

test("failed shaders and programs are released before retry, including failures in the shadow program", () => {
  for (const options of [{failShader: 2},{failShader: 4},{link: false}]) {
    const w = workshop(options);
    assert.ok(w.gl.programs.every(p => p.deleted));
    assert.ok(w.gl.shaders.every(s => s.deleted));
    assert.match(w.id("error-detail").textContent,/Test driver rejected/);
    w.gl.options.failShader = undefined; w.gl.options.link = true;
    w.id("retry").click(); w.settle();
    const programs = w.gl.programs.filter(p => !p.deleted);
    assert.equal(programs.length,2);
    w.id("scene").fire("webglcontextrestored");
    assert.deepEqual(w.gl.programs.filter(p => !p.deleted),programs);
    assert.equal(w.id("gl-error").hidden,true);
  }
});
