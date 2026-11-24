"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {boot} = require("./offline-page.js");
const {place,near} = require("./round.js");

function freight(p) {
  p.id("pick-freight").emit("click");
  p.frame();
  return p.matches.at(-1);
}
function review(p) {
  p.action("Tactical replay");
  const content=p.id("dialog-content");
  const button=name=>{
    const found=content.querySelectorAll("button").find(b=>b.textContent===name);
    assert.ok(found,name);
    return found;
  };
  return {content,button,slider:content.querySelector("input"),caption:content.querySelector(".tape-caption")};
}

test("Freight tug previews its rail and trolley, then reports moving, contested and reset states on the real HUD", () => {
  const p=boot(), gl=p.views[0].gl, start=gl.draws, uploads=gl.staticUploads;
  p.frame(); const base=gl.draws-start, before=gl.draws;
  const g=freight(p), [player,ally,,foe]=g.actors;
  assert.equal(gl.draws-before,base+2);
  assert.equal(p.id("pick-freight").getAttribute("aria-pressed"),"true");
  assert.equal(p.id("round-brief").textContent,"First to 2 hauls");
  assert.equal(p.id("freight-status").hidden,false);
  assert.equal(p.id("signal-status").hidden,true);
  p.key("Slash");
  assert.match(p.id("dialog-content").textContent,/east depot/);
  assert.match(p.id("dialog-content").textContent,/return vane/);
  p.key("Escape");
  place(player,0,0); place(ally,0,1);
  p.key("Enter"); p.frame(2);
  assert.match(p.id("freight-state").textContent,/Eastbound.*2 escorts/);
  assert.ok(parseFloat(p.id("freight-pin").style.left)>50);
  place(foe,0,0); p.frame();
  assert.match(p.id("freight-state").textContent,/Contested/);
  const end=p.api.freight.RULES.terminal;
  g.freight.x=end-0.01; place(player,end,0); place(ally,end,0.7);
  p.frame();
  assert.match(p.id("freight-state").textContent,/reset in 2 s/);
  assert.match(p.id("feed").textContent,/UndertowHAULEast depot/);
  assert.equal(p.id("score0").textContent,"01");
  p.key("KeyC");
  const table=p.id("dialog-content").querySelector("table");
  assert.equal(table.querySelector("thead").children[0].children.at(-1).textContent,"Hauls");
  assert.equal(table.querySelector("tbody").children[0].children.at(-1).textContent,"1");
  p.key("Escape"); p.frame(123);
  assert.equal(g.freight.resetLeft,0); assert.equal(gl.staticUploads,uploads);
  p.key("Escape"); p.action("Choose mode"); p.id("pick-skirmish").emit("click"); p.frame();
  assert.ok(p.id("freight-status").hidden);
});

test("F and the vane tile return incoming fire, display their cooldown and discard queued activations on pause", () => {
  const p=boot(), g=p.matches[0], [player,,,foe]=g.actors;
  p.key("KeyF"); p.frame(); assert.equal(g.phase,"ready"); assert.ok(p.id("vane").disabled);
  place(player,0,0); place(foe,1.4,0);
  p.key("Enter"); p.frame(2); assert.equal(p.id("vane").disabled,false);
  p.api.game.fire(g,foe,-Math.PI/2);
  p.key("KeyF"); p.key("KeyF",{repeat:true}); p.frame();
  assert.equal(p.id("vane-state").textContent,"Active");
  assert.match(p.id("vane").className,/raised/); assert.ok(p.id("vane").disabled);
  p.frame(5); assert.equal(player.hp,100); assert.equal(foe.hp,78);
  assert.equal(player.returns,1);
  assert.match(p.id("announcer").textContent,/returned a bolt/);
  p.frame(15); assert.equal(p.id("vane-state").textContent,"4 s");
  p.key("Escape"); p.action("Restart round"); p.frame(2);
  const fresh=p.matches.at(-1);
  p.id("vane").emit("click"); p.key("Escape"); p.action("Return to yard"); p.frame(2);
  assert.equal(fresh.actors[0].vaneCd,0);
  p.id("vane").emit("click"); p.frame();
  assert.ok(fresh.actors[0].vaneLeft>0);
  assert.equal(p.doc.activeElement,p.id("arena"));
});

test("a finished round can be scrubbed, stepped between plays, paused on blur and replayed without altering combat", () => {
  const p=boot({rules:{duration:1.24}}), g=p.matches[0], [player,,,foe,other]=g.actors;
  p.key("KeyD"); p.frame(7); p.up("KeyD");
  const first=g.elapsed; p.api.game.hurt(g,player,foe,100);
  p.frame(13);
  const second=g.elapsed; p.api.game.hurt(g,other,player,100);
  p.frame(80); assert.equal(g.phase,"ended");
  const result=JSON.stringify(g), gl=p.views[0].gl, draws=gl.draws, tones=p.audio.tones;
  const r=review(p);
  assert.equal(p.id("dialog-title").textContent,"Tactical replay");
  assert.equal(r.slider.getAttribute("aria-label"),"Replay position");
  assert.match(r.content.querySelector(".tape-heading").textContent,/0 – 0/);
  assert.equal(r.content.querySelectorAll(".tape-runner").length,6);
  assert.equal(p.doc.activeElement,r.button("Play"));
  assert.equal(r.button("Previous play").disabled,true);
  r.button("Next play").emit("click");
  near(Number(r.slider.value),first); assert.match(r.caption.textContent,/knocked out Torchlug/);
  assert.match(r.content.querySelector(".tape-heading").textContent,/1 – 0/);
  r.button("Next play").emit("click");
  near(Number(r.slider.value),second); assert.match(r.caption.textContent,/knocked out Coilrunner/);
  assert.equal(r.button("Next play").disabled,true);
  r.button("Previous play").emit("click"); near(Number(r.slider.value),first);
  r.slider.value="0.52"; r.slider.emit("input"); near(Number(r.slider.value),0.52);
  r.slider.emit("keydown",{key:"ArrowLeft"}); near(Number(r.slider.value),0);
  r.slider.focus(); p.key("Tab",{key:"Tab",shiftKey:true});
  assert.equal(p.doc.activeElement,p.id("dialog-actions").querySelector("button"));
  p.key("Tab",{key:"Tab"}); assert.equal(p.doc.activeElement,r.slider);
  r.button("Play").emit("click"); p.frame(7); const at=Number(r.slider.value);
  assert.ok(at>0); assert.equal(r.button("Pause").getAttribute("aria-pressed"),"true");
  p.win.emit("blur"); p.frame(5,30000); near(Number(r.slider.value),at);
  p.key("Space"); p.key("KeyF"); p.key("KeyW"); p.key("KeyC");
  assert.equal(p.id("dialog-title").textContent,"Tactical replay");
  r.button("Play").emit("click"); p.frame(90);
  near(Number(r.slider.value),g.elapsed); assert.equal(p.pending(),0);
  assert.equal(r.button("Play").getAttribute("aria-pressed"),"false");
  r.button("Play").emit("click"); near(Number(r.slider.value),0); p.frame(2);
  assert.equal(gl.draws,draws); assert.equal(p.audio.tones,tones);
  assert.equal(JSON.stringify(g),result);
  p.key("Escape"); assert.equal(p.id("dialog-title").textContent,"Round drawn");
  assert.equal(p.doc.activeElement.textContent,"Tactical replay");
});

test("a recorded winning haul survives graphics recovery and a rematch gets its own tape", () => {
  const p=boot({rules:{target:1,duration:0.5}}), g=freight(p), end=p.api.freight.RULES.terminal;
  p.key("Enter"); p.frame(3);
  place(g.actors[0],end,0); g.freight.x=end-0.001;
  p.frame(); assert.equal(g.winner,0);
  assert.match(p.id("dialog-content").textContent,/1 haul escorted/);
  const r=review(p);
  r.button("Next play").emit("click"); assert.match(r.caption.textContent,/Undertow docked/);
  r.button("Play").emit("click"); p.frame(2);
  p.id("arena").emit("webglcontextlost"); assert.equal(p.pending(),0);
  p.id("arena").emit("webglcontextrestored"); p.frame();
  assert.equal(p.id("dialog-title").textContent,"Undertow wins");
  const restored=review(p);
  restored.button("Next play").emit("click"); assert.match(restored.caption.textContent,/east depot/);
  p.action("Back to result"); p.action("Play again"); p.frame(34);
  assert.equal(p.id("dialog-title").textContent,"Round drawn");
  const fresh=review(p);
  assert.equal(fresh.button("Next play").disabled,true);
  assert.match(fresh.content.querySelector(".tape-heading").textContent,/0 – 0/);
});

test("a zero-length tape has a readable opening and a keyboard route back to the result", () => {
  const p=boot({rules:{duration:0}});
  p.key("Enter"); p.frame(2); const r=review(p);
  assert.equal(r.slider.disabled,true); assert.equal(r.button("Play").disabled,true);
  assert.equal(r.button("Previous play").disabled,true); assert.equal(r.button("Next play").disabled,true);
  assert.equal(p.doc.activeElement.textContent,"Back to result");
  assert.equal(r.caption.textContent,"Opening positions");
  p.key("Tab",{key:"Tab"}); assert.equal(p.doc.activeElement.textContent,"Back to result");
  p.key("Escape"); assert.equal(p.id("dialog-title").textContent,"Round drawn");
});
