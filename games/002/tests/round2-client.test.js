"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {boot} = require("./offline-page.js");
const {place,near} = require("./round.js");

function selectRelay(page) {
  page.id("pick-relay").emit("click");
  page.frame();
  return page.matches.at(-1);
}

test("the deployment picker previews the relay gates, rules and target using the existing graphics context", () => {
  const p=boot(), gl=p.views[0].gl;
  const before=gl.draws, uploads=gl.staticUploads;
  p.frame();
  const skirmishDraws=gl.draws-before;
  assert.equal(p.id("pick-skirmish").getAttribute("aria-pressed"),"true");
  const prev=gl.draws, relay=selectRelay(p);
  assert.equal(gl.draws-prev,skirmishDraws+2,"gates and core are real mesh draws");
  assert.equal(gl.staticUploads,uploads);
  assert.equal(p.views.length,1);
  assert.equal(relay.phase,"ready");
  assert.equal(p.id("mode-name").textContent,"Relay run");
  assert.equal(p.id("pick-relay").getAttribute("aria-pressed"),"true");
  assert.equal(p.id("score-target").textContent,"FIRST TO 3");
  assert.equal(p.id("round-brief").textContent,"First to 3 deliveries");
  assert.ok(!p.id("relay-status").hidden);
  p.key("Slash"); assert.match(p.id("dialog-content").textContent,/east gate/);
  for (const control of ["1 / 2","Rally","Fork coil","Patch reel","Catch net"]) {
    assert.ok(p.id("dialog-content").textContent.includes(control));
  }
  p.key("Escape");
  p.id("pick-skirmish").emit("click"); p.frame();
  assert.ok(p.id("relay-status").hidden);
  assert.equal(p.doc.activeElement,p.id("arena"));
  assert.equal(p.id("score-target").textContent,"FIRST TO 12");
  p.key("KeyW"); p.frame(2);
  assert.equal(p.matches.at(-1).phase,"playing");
  assert.ok(p.id("deployment").hidden);
  const rounds=p.matches.length;
  p.id("pick-relay").emit("click");
  assert.equal(p.matches.length,rounds,"live scores cannot be overwritten by the picker");
});

test("a contested pickup, carrier dash lock, delivery and same-mode rematch reach the live HUD", () => {
  const p=boot({rules:{target:1}}), g=selectRelay(p), [runner,,,foe]=g.actors;
  place(runner,0,0); place(foe,0.3,0);
  p.key("Enter"); p.frame(2);
  assert.match(p.id("relay-status").textContent,/contested/);
  place(foe,4,0); p.frame();
  assert.match(p.id("relay-status").textContent,/You have the core/);
  assert.match(p.id("tags").children[0].className,/carrier/);
  assert.equal(p.id("dash-card").querySelector(".cooldown").textContent,"CORE");
  p.key("Space"); p.frame();
  assert.equal(runner.dashCd,0);
  place(runner,p.api.relay.gates[1].x,0); p.frame();
  assert.equal(g.phase,"ended"); assert.equal(p.pending(),0);
  assert.equal(p.id("score0").textContent,"01");
  assert.match(p.id("feed").textContent,/YouDELIVERY/);
  assert.equal(p.id("dialog-title").textContent,"Undertow wins");
  assert.match(p.id("dialog-content").textContent,/Delivery target reached/);
  assert.match(p.id("dialog-content").textContent,/1 delivered/);
  p.action("Play again"); p.frame(2);
  assert.equal(p.matches.at(-1).mode,"relay");
  assert.equal(p.matches.at(-1).relay.carrier,null);
  assert.equal(p.id("score0").textContent,"00");
  assert.equal(p.id("feed").children.length,0);
  p.key("Escape"); p.action("Choose mode"); p.frame();
  assert.equal(p.matches.at(-1).phase,"ready");
  assert.ok(!p.id("deployment").hidden);
  assert.equal(p.doc.activeElement,p.id("pick-relay"));
  p.id("pick-skirmish").emit("click"); p.key("Enter"); p.frame(2);
  assert.equal(p.matches.at(-1).mode,"skirmish");
  assert.equal(p.matches.at(-1).phase,"playing");
});

test("a personal delivery at the deadline earns the late hand-in callout in the feed and result", () => {
  const p=boot({rules:{duration:5.1,target:1}}), g=selectRelay(p), player=g.actors[0];
  place(player,0,0); p.key("Enter"); p.frame(9);
  place(player,p.api.relay.gates[1].x,0); p.frame();
  assert.equal(g.winner,0);
  assert.match(p.id("feed").textContent,/YouDEADLINE DELIVERY/);
  assert.match(p.id("dialog-content").textContent,/Deadline delivery · Handed in with 5.0 s to spare/);
});

test("slot keys and card buttons spend the displayed energy, show failed plays and draw the reserve", () => {
  const p=boot(), g=p.matches[0], player=g.actors[0];
  const [fork,patch]=[p.id("card-1"),p.id("card-2")];
  assert.ok(fork.disabled && patch.disabled);
  p.key("Enter"); p.frame(2);
  p.key("Digit2"); p.frame();
  assert.match(p.id("deck-note").textContent,/No injured/);
  assert.equal(p.id("energy-value").textContent,"4/6");
  assert.equal(patch.dataset.card,"patch");
  player.hp=81;
  patch.emit("click"); p.frame();
  assert.equal(player.hp,100);
  assert.equal(p.id("hp-current").textContent,"100");
  assert.match(p.id("damage-numbers").textContent,/\+19/);
  assert.equal(patch.querySelector(".card-name").textContent,"Catch net");
  assert.equal(patch.querySelector("canvas").dataset.icon,"net");
  assert.match(patch.getAttribute("aria-label"),/3 energy/);
  assert.equal(p.id("deck-note").textContent,"Next · Patch reel");
  assert.equal(p.id("energy").getAttribute("aria-valuenow"),"2");
  assert.equal(player.shots,0);
  assert.ok(fork.disabled && patch.disabled);
  p.key("Digit1"); p.key("Digit1",{repeat:true}); p.frame(2);
  assert.equal(p.id("deck-note").textContent,"Need 3 energy");
  assert.equal(g.events.filter(e=>e.type==="cardDenied").length,2);
  p.frame(180);
  assert.ok(!fork.disabled);
  p.key("Digit1"); p.up("Digit1"); p.frame(2);
  assert.equal(player.shots,3);
  assert.equal(p.id("energy-value").textContent,"0/6");
  assert.equal(fork.dataset.card,"patch");
  assert.equal(p.id("deck-note").textContent,"Next · Fork coil");
});

test("the rally key uses the floor under the cursor, preserves an order on bad aim and expires", () => {
  const p=boot(), g=p.matches[0], view=p.views[0];
  p.key("Enter"); p.frame(2);
  const enemy=g.actors[3], helmet=view.locate(enemy.x,1.7,enemy.z);
  const floor=view.pick(helmet.x,helmet.y);
  assert.ok(Math.hypot(floor[0]-enemy.x,floor[2]-enemy.z)>0.5);
  p.pointer("pointermove",helmet.x,helmet.y); p.key("KeyR"); p.pointer("pointermove",0,0); p.frame();
  near(g.rally.x,floor[0]); near(g.rally.z,floor[2]);
  assert.match(p.id("rally-state").textContent,/6 s/);
  const order=g.rally, box=p.api.arena.blocks[0], solid=view.locate(box.x,0,box.z);
  p.pointer("pointermove",solid.x,solid.y); p.key("KeyR"); p.frame();
  assert.equal(g.rally,order);
  assert.equal(p.id("rally-state").textContent,"Aim at open deck");
  p.key("KeyR",{repeat:true}); p.frame(361);
  assert.equal(g.rally,null);
  assert.equal(p.id("rally-state").textContent,"Rally crew");
});

test("a quick click keeps its original aim while leaving the canvas clears the live rally location", () => {
  const p=boot(), g=p.matches[0], view=p.views[0], runner=g.actors[0], enemy=g.actors[3];
  place(runner,-3,0); place(enemy,1,0);
  runner.yaw=0;
  const head=view.locate(enemy.x,1.7,enemy.z);
  p.pointer("pointerdown",head.x,head.y); p.pointer("pointerup",head.x,head.y);
  p.pointer("pointermove",0,0); p.pointer("pointerleave",0,0);
  p.key("KeyR"); p.frame(22);
  assert.equal(runner.shots,1);
  assert.equal(enemy.hp,100-p.api.game.RULES.shotDamage);
  assert.deepEqual([g.rally.x,g.rally.z],[runner.x,runner.z]);
  p.pointer("pointerdown",head.x,head.y);
  p.id("arena").emit("lostpointercapture",{pointerId:1});
  p.frame(30);
  assert.equal(runner.shots,1,"an interrupted pointer cannot leave a pending tap");
});

test("context recovery preserves the carried core, live fields, hand and energy until explicit resume", () => {
  const p=boot(), g=selectRelay(p), canvas=p.id("arena");
  place(g.actors[0],0,0); g.deck.energy=6;
  p.key("Enter"); p.key("Digit1"); p.frame(2);
  p.key("Digit1"); p.key("KeyR"); p.frame(2);
  assert.ok(g.net && g.rally && g.relay.carrier===0);
  const snapshot=()=>JSON.stringify([g.relay,g.deck,g.rally,g.net,g.elapsed]);
  const before=snapshot();
  p.key("Digit2");
  canvas.emit("webglcontextlost"); p.frame(1,50000);
  canvas.emit("webglcontextrestored"); p.frame();
  assert.equal(p.id("dialog-title").textContent,"Round paused");
  assert.equal(snapshot(),before);
  p.action("Return to yard"); p.frame(3);
  assert.ok(g.net.remaining<p.api.deck.RULES.netTime);
  assert.equal(g.events.filter(e=>e.type==="cardDenied").length,0,"queued card was discarded");
  const gl=p.views.at(-1).gl, uploads=gl.staticUploads, batches=gl.dynamicUploads, draws=gl.draws;
  p.frame(8);
  assert.equal(gl.staticUploads,uploads);
  assert.equal(gl.dynamicUploads-batches,8);
  assert.ok(gl.draws-draws<=8*30);
  p.key("Escape"); p.action("Restart round"); p.frame(2);
  const next=p.matches.at(-1);
  assert.deepEqual([next.mode,next.rally,next.net,next.relay.carrier,next.deck.energy],["relay",null,null,null,4]);
  assert.equal(p.id("card-1").dataset.card,"fork");
});

test("the recovery dialog traps keyboard focus while the WebGL renderer is unavailable", () => {
  const p=boot({noWebGL:true}), reload=p.id("dialog-actions").children[0];
  for (const shiftKey of [false,true]) {
    assert.ok(p.key("Tab",{key:"Tab",shiftKey}).defaultPrevented);
    assert.equal(p.doc.activeElement,reload);
  }
});
