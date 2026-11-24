"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {workshop, chooseLayout, openBlueprint, edit, speed} = require("./workshop-harness");
const {near, vector} = require("./numeric");
const T = require("../js/track");
const P = require("../js/physics");
const M = require("../js/math");
const B = require("../js/blueprint");
const Replay = require("../js/replay");

const marbleDraws = w => w.gl.screenDraws.filter(draw => draw.kind === 2);
function projected(w, point) {
  const rect = w.id("scene").getBoundingClientRect();
  const [x, y] = M.transform(w.gl.screenDraws[0].vp, point);
  return {clientX:rect.left + (x+1)*rect.width/2, clientY:rect.top + (1-y)*rect.height/2};
}
function tap(w, at, release = at) {
  const scene = w.id("scene");
  scene.fire("pointerdown", {button:0, pointerId:1, ...at});
  scene.fire("pointerup", {button:0, pointerId:1, ...release});
}
function reference(layout, speed) {
  const world = new P.World(T.build(layout));
  world.spawn(speed);
  for (let i = 0; i < 15/P.DT && !world.timing.lastReplay; i++) world.step();
  assert.ok(world.timing.lastReplay);
  return world.timing.lastReplay;
}
function expectReplayPose(w, record, time) {
  const pose = Replay.pose(record, time), draws = marbleDraws(w);
  assert.equal(draws.length, 1);
  vector(draws[0].model, M.modelMatrix(pose.p,T.RADIUS,pose.q), 2e-5);
  assert.equal(w.id("follow-speed").textContent, pose.speed.toFixed(1) + " m/s");
  assert.equal(w.id("follow-height").textContent, pose.p[1].toFixed(1) + " m high");
  assert.equal(w.id("replay-time").textContent, time.toFixed(3) + " / " + record.time.toFixed(3) + " s");
}

test("tapping visible track selects it in the builder, including both bays and the empty space inside a jump", () => {
  const w = workshop({dpr:2,reducedMotion:true}), scene = w.id("scene");
  const rect = {left:83, top:27, width:810, height:550};
  scene.clientWidth = rect.width; scene.clientHeight = rect.height;
  scene.getBoundingClientRect = () => rect;
  w.window.fire("resize");
  chooseLayout(w,"podium");
  w.id("view-toggle").click();
  w.id("view-menu").querySelectorAll("button").find(b => b.dataset.view === "overhead").click();
  w.id("trials-tab").click();
  w.id("pause").click(); w.id("drop").click(); w.settle();
  const course = T.build(T.PRESETS.podium), jump = course.sections[2];
  const originalBuffers = new Set(w.gl.buffers), shadows = w.gl.shadowPasses;
  const takeoff = projected(w, jump.decks[0][8].p);
  // A little finger jitter still counts as a tap and leaves the camera in place.
  scene.fire("pointerdown",{button:0,pointerId:1,...takeoff});
  scene.fire("pointermove",{pointerId:1,clientX:takeoff.clientX+1,clientY:takeoff.clientY});
  scene.fire("pointerup",{pointerId:1,...takeoff});
  w.settle();
  assert.equal(w.id("build-panel").hidden, false);
  assert.equal(w.id("piece-position").value, "1");
  assert.equal(w.id("view-name").textContent, "Overhead");
  assert.equal(w.gl.screenDraws.filter(d => d.kind === -1).length, 1);
  const gap = M.lerp(jump.decks[0].at(-1).p,jump.decks[1][0].p,0.5);
  tap(w,projected(w,gap)); w.settle();
  assert.equal(w.id("piece-position").value, "-1");
  tap(w,projected(w,course.launch.p)); w.settle();
  assert.equal(w.id("piece-position").value, "0");
  tap(w,projected(w,course.finish.p)); w.settle();
  assert.equal(w.id("piece-position").value, "-1");
  assert.equal(w.id("in-play").textContent, "1");
  assert.deepEqual(w.gl.buffers, originalBuffers);
  assert.equal(w.gl.shadowPasses, shadows);
});

test("orbit, pinch, releases outside the canvas and cancelled captures cannot change the build selection", () => {
  const w = workshop({reducedMotion:true}), scene = w.id("scene");
  w.settle();
  const select = w.id("piece-position");
  select.value = "2"; select.fire("change");
  const at = {clientX:6,clientY:8};
  const down = id => scene.fire("pointerdown",{pointerId:id,button:0,...at});
  const up = id => scene.fire("pointerup",{pointerId:id,...at});
  down(3);
  scene.fire("pointermove",{pointerId:3,clientX:80,clientY:80});
  up(3); w.settle();
  assert.equal(w.id("view-name").textContent, "Free orbit");
  down(4); down(5); up(5); up(4);
  down(6); scene.fire("pointercancel",{pointerId:6}); up(6);
  down(7); scene.fire("lostpointercapture",{pointerId:7}); up(7);
  tap(w,{clientX:1,clientY:9},{clientX:-1,clientY:9});
  tap(w,at,{clientX:90,clientY:10}); // No move events delivered before release.
  down(8); w.gl.lost = true; scene.fire("webglcontextlost");
  w.gl.lost = false; scene.fire("webglcontextrestored"); w.settle(); up(8);
  assert.equal(w.id("piece-position").value, "2");
  assert.equal(scene.classList.contains("dragging"), false);
});

test("the ninth card and shortcut edit the gap jump, export its blueprint, and undo it in one edit", () => {
  const w = workshop(), scene = w.id("scene");
  chooseLayout(w, "empty");
  assert.ok(w.key("9",{code:"Digit9"},scene).defaultPrevented);
  w.id("piece-grid").children.find(card => card.dataset.piece === "jump").click();
  openBlueprint(w);
  assert.equal(w.id("blueprint-export").value, "LF1/4/JJ/Untitled track");
  w.id("blueprint-close").click(); w.id("undo").click(); w.settle();
  assert.equal(w.id("piece-count").textContent, "1 piece");
  assert.equal(w.gl.screenDraws.filter(d => d.kind === 0).length, 3);
  w.id("redo").click();
  assert.equal(w.id("piece-count").textContent, "2 pieces");
});

test("gate height accepts an explicit edit, retains a pending value through pause, and preserves imported precision", () => {
  const w = workshop(), height = w.id("release-height");
  const select = w.id("piece-position");
  select.value = "2"; select.fire("change");
  w.id("drop").click();
  for (const invalid of ["",0,12.001,"NaN"]) {
    edit(w,"release-height",invalid); height.focus(); w.key("Enter");
    assert.equal(w.id("apply-height").disabled,true);
    assert.equal(height.getAttribute("aria-invalid"),"true");
    assert.equal(w.id("in-play").textContent,"1");
    assert.equal(w.id("undo").disabled,true);
  }
  edit(w,"release-height",5.725); w.id("pause").click();
  assert.equal(height.value,"5.725");
  assert.equal(w.id("apply-height").disabled,false);
  w.key("Enter",{},height); w.settle();
  assert.equal(w.id("height-error").textContent,"");
  assert.equal(w.id("in-play").textContent,"0");
  assert.equal(w.id("sim-state").textContent,"Physics paused");
  assert.equal(select.value,"2");
  near(marbleDraws(w)[0].model[13],5.725+T.RADIUS+0.5);
  w.id("undo").click();
  assert.equal(height.value,"7.1");
  assert.equal(w.id("undo").disabled,true);
  w.id("redo").click(); openBlueprint(w);
  assert.equal(B.decode(w.id("blueprint-export").value).height,5.725);
  edit(w,"blueprint-input","LF1/0.93715/J/Studio post"); w.id("blueprint-load").click();
  assert.equal(height.value,"0.93715");
  assert.equal(w.id("apply-height").disabled,true);
  edit(w,"release-height",12); w.id("apply-height").click(); w.settle();
  near(marbleDraws(w)[0].model[13],12+T.RADIUS+0.5);
});

test("a replay can scrub, step, slow down and restart while a live heat holds its exact state", () => {
  const w = workshop({reducedMotion:true});
  chooseLayout(w,"podium"); w.id("trials-tab").click();
  assert.equal(w.id("review-run").disabled,true);
  w.id("drop").click(); w.settle();
  const record = reference(T.PRESETS.podium,10);
  assert.equal(w.id("replay-outcome").textContent,"Finished");
  assert.equal(w.id("replay-duration").textContent,record.time.toFixed(3)+" s");
  assert.equal(w.id("replay-peak").textContent,Math.max(...record.speeds).toFixed(1)+" m/s peak");
  assert.ok(w.id("replay-trace").pen.strokes > 0);
  const strokes = w.id("replay-trace").pen.strokes;
  w.id("start-heat").click(); w.tick(20);
  const before = marbleDraws(w).map(d => d.model.slice()), liveClock = w.id("trial-clock").textContent;
  w.id("review-run").click(); w.tick();
  expectReplayPose(w,record,0);
  assert.equal(w.id("live-transport").hidden,true);
  assert.equal(w.id("start-heat").disabled,true);
  assert.equal(w.id("trial-state").textContent,"Held for replay");
  w.tick(160);
  assert.equal(w.id("trial-clock").textContent,liveClock);
  assert.equal(w.id("in-play").textContent,"1");
  assert.equal(w.id("heat-standings").textContent.match(/Queued/g).length,2);
  const scrub = w.id("replay-scrub"), time = record.time*0.375;
  edit(w,"replay-scrub",375); scrub.focus(); w.settle();
  assert.equal(w.id("sim-state").textContent,"Replay paused");
  expectReplayPose(w,record,time);
  assert.equal(w.key("ArrowRight",{},scrub).defaultPrevented,false);
  w.key(".",{},scrub); w.settle(); expectReplayPose(w,record,time+1/60);
  w.doc.querySelectorAll("[data-rate]").find(b => b.dataset.rate === "0.5").click();
  w.key("p",{},scrub); w.tick(61);
  expectReplayPose(w,record,time+1/60+0.5);
  edit(w,"replay-scrub",1000); w.settle();
  expectReplayPose(w,record,record.time);
  assert.equal(w.id("step-frame").disabled,true);
  w.id("replay-play").click(); w.tick(); expectReplayPose(w,record,0);
  w.settle();
  expectReplayPose(w,record,record.time);
  assert.equal(w.id("finished").textContent,"1");
  assert.equal(w.id("sim-state").textContent,"Replay paused");
  assert.equal(w.id("replay-trace").pen.strokes,strokes);
  w.key("Escape",{},scrub); w.tick(1,60000);
  assert.equal(w.id("live-transport").hidden,false);
  assert.deepEqual(marbleDraws(w).map(d => d.model),before);
  assert.equal(w.id("trial-clock").textContent,liveClock);
  assert.equal(w.id("heat-state").textContent,"Racing");
  w.tick(10);
  assert.ok(Number(w.id("trial-clock").textContent) > Number(liveClock));
});

test("a missed jump stays reviewable after collection and graphics recovery, and clear or edit retires the recording", () => {
  const w = workshop({reducedMotion:true}), scene = w.id("scene");
  chooseLayout(w,"podium"); speed(w,7); w.id("drop").click(); w.settle();
  const record = reference(T.PRESETS.podium,7);
  w.id("pause").click(); w.key("r",{},scene); w.tick(15);
  assert.equal(w.id("replay-outcome").textContent,"Off track");
  assert.equal(w.id("trial-best").textContent,"—");
  w.key("v",{},scene); w.tick();
  const held = w.id("replay-time").textContent, model = marbleDraws(w)[0].model.slice();
  w.doc.hidden = true; w.doc.fire("visibilitychange"); w.tick(1,60000);
  w.doc.hidden = false; w.doc.fire("visibilitychange"); w.tick();
  w.gl.lost = true; scene.fire("webglcontextlost"); w.tick(1,60000);
  assert.equal(w.id("replay-scrub").disabled,true);
  w.gl.lost = false; scene.fire("webglcontextrestored"); w.tick();
  assert.equal(w.id("replay-time").textContent,held);
  vector(marbleDraws(w)[0].model,model);
  assert.equal(w.id("view-name").textContent,"Follow marble");
  edit(w,"replay-scrub",1000); w.settle(); expectReplayPose(w,record,record.time);
  w.id("replay-exit").click(); w.settle();
  assert.equal(w.id("sim-state").textContent,"Physics paused");
  assert.equal(w.id("follow-runner").textContent,"Release gate");
  w.key("r",{},scene); w.key("c",{},scene); w.settle();
  assert.equal(w.id("replay-transport").hidden,true);
  assert.equal(w.id("review-run").disabled,true);
  assert.equal(w.id("replay-chart").hidden,true);
  chooseLayout(w,"empty"); w.id("pause").click(); w.id("drop").click(); w.settle();
  w.key("r",{},scene); w.tick(); w.key("9",{},scene); w.settle();
  assert.equal(w.id("replay-transport").hidden,true);
  assert.equal(w.id("review-run").disabled,true);
  assert.equal(w.id("finished").textContent,"0");
});
