"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {boot} = require("./offline-page.js");
const {place,near} = require("./round.js");

function select(p,mode) {
  p.id("pick-"+mode).emit("click");
  p.frame();
  return p.matches.at(-1);
}
function aimAt(p,actor) {
  return p.views.at(-1).locate(actor.x,1.65,actor.z);
}
function mark(p,actor) {
  const head=aimAt(p,actor);
  p.pointer("pointerdown",head.x,head.y,{button:2});
}
function rowValues(table,index) {
  return table.querySelector("tbody").children[index].children.map(cell=>cell.textContent);
}

test("a right-click locks the runner under the pointer, marks the world and radar, and leaves the driver alone", () => {
  const p=boot(), g=p.matches[0], foe=g.actors[3], other=g.actors[4];
  p.frame();
  mark(p,foe); p.frame();
  assert.equal(g.phase,"ready");
  p.key("Enter"); p.frame(2);
  const radarCalls=p.id("radar").ink.calls;
  mark(p,foe);
  const later=aimAt(p,other);
  p.pointer("pointermove",later.x,later.y); p.frame();
  assert.equal(g.focus.target,foe.id);
  assert.equal(g.actors[0].shots,0);
  assert.match(p.id("tags").children[foe.id].className,/focus-target/);
  assert.match(p.id("focus-state").textContent,/5 s/);
  assert.match(p.id("announcer").textContent,/focusing Torchlug/);
  assert.ok(p.id("radar").ink.calls>radarCalls);
  const floor=p.views[0].locate(0,0,0);
  p.pointer("pointerdown",floor.x,floor.y,{button:2}); p.frame();
  assert.equal(g.focus,null);
  assert.equal(p.id("focus-state").textContent,"Focus fire");
  mark(p,other); p.key("Escape"); p.action("Return to yard"); p.frame(3);
  assert.equal(g.focus,null,"opening a menu discards a queued mark");
});

test("either mouse button can go down first when marking and firing, and releasing the left ends continuous fire", () => {
  const p=boot(), g=p.matches[0], foe=g.actors[3], head=aimAt(p,foe);
  p.pointer("pointerdown",head.x,head.y); p.frame(2);
  p.pointer("pointermove",head.x,head.y,{button:2,buttons:3}); p.frame(20);
  assert.equal(g.focus.target,foe.id);
  assert.ok(g.actors[0].shots>=2);
  const before=g.actors[0].shots;
  p.pointer("pointermove",head.x,head.y,{button:0,buttons:2}); p.frame(30);
  assert.equal(g.actors[0].shots,before);
  p.pointer("pointerup",head.x,head.y,{button:2,buttons:0});
  mark(p,foe);
  p.pointer("pointermove",head.x,head.y,{button:0,buttons:3}); p.frame(2);
  assert.equal(g.actors[0].shots,before+1);
  p.pointer("pointermove",head.x,head.y,{button:2,buttons:1}); p.frame(20);
  assert.ok(g.actors[0].shots>before+1,"releasing just the mark button keeps the driver firing");
  p.pointer("pointerup",head.x,head.y,{button:0,buttons:0});
});

test("the crew sheet pauses a live round, shows every runner's contributions and returns to its opener", () => {
  const p=boot(), g=p.matches[0], [player,ally,,foe]=g.actors;
  p.key("Enter"); p.frame(2);
  mark(p,foe); p.frame();
  p.api.game.hurt(g,player,foe,25);
  p.api.game.hurt(g,ally,foe,100);
  p.frame();
  assert.match(p.id("feed").textContent,/Your assist/);
  assert.equal(g.focus,null);
  p.id("crew-sheet").focus();
  p.id("crew-sheet").emit("click"); p.frame();
  assert.equal(p.id("dialog-title").textContent,"Crew sheet");
  const tables=p.id("dialog-content").querySelectorAll("table");
  assert.equal(tables.length,2);
  assert.deepEqual(tables.map(t=>t.querySelector("tbody").children.length),[3,3]);
  assert.match(tables[0].querySelector("caption").textContent,/Undertow1 knockout/);
  assert.deepEqual(rowValues(tables[0],0),["CoilrunnerYou","0","1","0","25","0","0"]);
  assert.deepEqual(rowValues(tables[0],1),["Bollard","1","0","0","75","0","0"]);
  assert.equal(rowValues(tables[1],0)[3],"1");
  const state=JSON.stringify(g);
  p.key("Digit1"); p.key("Slash"); p.frame(6,1500);
  assert.equal(g.phase,"paused"); assert.equal(JSON.stringify(g),state);
  p.key("KeyC"); p.frame(2);
  assert.equal(g.phase,"playing"); assert.equal(p.doc.activeElement,p.id("crew-sheet"));
  p.key("Escape"); p.action("Crew sheet"); p.key("Escape");
  assert.equal(p.id("dialog-title").textContent,"Round paused");
  p.action("Return to yard"); p.frame(2);
  assert.equal(g.actors[0].shots,0);
});

test("a result sheet survives resize, returns to the result and clears the stats for a rematch", () => {
  const p=boot({rules:{target:1}}), g=p.matches[0], [player,ally,,foe]=g.actors;
  p.key("Enter"); p.frame(2);
  p.api.game.hurt(g,player,foe,7); p.api.game.hurt(g,ally,foe,100);
  p.frame();
  assert.match(p.id("dialog-content").textContent,/1 assist/);
  p.action("Crew sheet");
  p.win.emit("resize"); p.frame();
  assert.equal(p.id("dialog-title").textContent,"Crew sheet");
  assert.match(p.id("dialog-content").textContent,/Final/);
  assert.equal(g.phase,"ended");
  p.key("Escape");
  assert.equal(p.id("dialog-title").textContent,"Undertow wins");
  p.action("Play again"); p.frame(2); p.key("KeyC");
  const row=rowValues(p.id("dialog-content").querySelector("table"),0);
  assert.deepEqual(row.slice(1),["0","0","0","0","0","0"]);
});

test("three focus assists earn the group-project callout and the scoreboard still counts only knockouts", () => {
  const p=boot({rules:{target:3}}), g=p.matches[0], [player,ally]=g.actors;
  p.key("Enter"); p.frame(2);
  for (const foe of g.actors.slice(3)) {
    mark(p,foe); p.frame();
    p.api.game.hurt(g,ally,foe,100); p.frame();
  }
  assert.deepEqual([player.kills,player.assists,ally.kills,g.scores[0]],[0,3,3,3]);
  assert.match(p.id("dialog-content").textContent,/Group project/);
});

test("supply warnings, a contested drop and the player's repair and boost reach the real HUD", () => {
  const p=boot(), g=p.matches[0], [player,,,foe]=g.actors;
  const gl=p.views[0].gl, uploads=gl.staticUploads, site=p.api.supply.sites[g.supply.site];
  g.supply.nextAt=0.02;
  p.key("Enter"); p.frame(2);
  assert.ok(p.id("supply-status").hidden);
  const before=gl.draws;
  p.frame();
  assert.equal(gl.draws-before,28,"one cached supply mesh in addition to the skirmish scene");
  assert.equal(p.id("supply-site").textContent,site.name);
  assert.equal(p.id("supply-state").textContent,"Landing · 3 s");
  place(player,site.x,site.z); place(foe,site.x+0.4,site.z);
  p.frame(180);
  assert.match(p.id("supply-state").textContent,/Contested/);
  place(foe,4,0); player.hp=55;
  p.frame();
  assert.equal(p.id("hp-current").textContent,"90");
  assert.match(p.id("damage-numbers").textContent,/\+35/);
  assert.equal(p.id("supply-site").textContent,"Speed boost");
  assert.match(p.id("tags").children[0].className,/boosted/);
  const saved=JSON.stringify([g.supply,player.boostLeft]);
  p.id("arena").emit("webglcontextlost"); p.id("arena").emit("webglcontextrestored");
  p.frame(1,30000);
  assert.equal(JSON.stringify([g.supply,player.boostLeft]),saved);
  p.action("Return to yard"); p.frame(301);
  assert.equal(player.boostLeft,0); assert.ok(p.id("supply-status").hidden);
  assert.equal(gl.staticUploads,uploads*2,"the restored context rebuilt its static resources just once");
});

test("Signal shift previews its next station and exposes personal hold credit on the mode-specific sheet", () => {
  const p=boot(), g=select(p,"signal"), [player]=g.actors;
  assert.equal(p.id("score-target").textContent,"FIRST TO 30");
  assert.equal(p.id("signal-site").textContent,"Midships");
  assert.ok(!p.id("signal-status").hidden && p.id("relay-status").hidden);
  place(player,0,0); p.key("Enter"); p.frame(61);
  assert.equal(g.scores[0],1); assert.equal(p.id("score0").textContent,"01");
  assert.equal(p.id("signal-status").dataset.control,"ally");
  g.signal.remaining=0.04; p.frame();
  assert.match(p.id("signal-state").textContent,/Next North slip/);
  p.frame(2);
  assert.equal(p.id("signal-site").textContent,"North slip");
  assert.match(p.id("announcer").textContent,/Station moved/);
  p.key("KeyC");
  const table=p.id("dialog-content").querySelector("table");
  assert.equal(table.querySelector("thead").children[0].children.at(-1).textContent,"Held");
  assert.equal(rowValues(table,0).at(-1),"1");
});

test("the deck editor swaps occupied slots, discards drafts and keeps the equipped loadout across modes and restarts", () => {
  const p=boot();
  const editor=()=>p.id("edit-deck").emit("click");
  const choose=id=>p.id("dialog-content").querySelectorAll(".editor-card").find(b=>b.dataset.card===id).emit("click");
  editor();
  assert.equal(p.id("dialog-title").textContent,"Build your deck");
  assert.equal(p.doc.activeElement,p.id("dialog-content").querySelector(".editor-slot"));
  choose("patch");
  let slots=p.id("dialog-content").querySelectorAll(".editor-slot");
  assert.match(slots[0].textContent,/Patch reel/); assert.match(slots[1].textContent,/Fork coil/);
  p.key("Escape");
  assert.equal(p.id("card-1").dataset.card,"fork");
  assert.equal(p.doc.activeElement,p.id("edit-deck"));
  editor(); choose("bank");
  slots=p.id("dialog-content").querySelectorAll(".editor-slot");
  slots[2].emit("click"); choose("haul"); p.action("Equip deck"); p.frame();
  assert.equal(p.id("card-1").dataset.card,"bank"); assert.equal(p.id("deck-note").textContent,"Next · Haul line");
  const g=select(p,"signal");
  assert.deepEqual(Array.from(g.deck.hand),["bank","patch"]);
  p.key("Enter"); p.key("Digit1"); p.frame(2);
  assert.equal(p.id("card-1").dataset.card,"haul");
  p.key("Escape"); p.action("Restart round"); p.frame(2);
  assert.equal(p.id("card-1").dataset.card,"bank");
});

test("the Q pass remembers the teammate under the cursor and reports the completed pass on deck", () => {
  const p=boot(), g=select(p,"relay"), [player,ally]=g.actors;
  place(player,0,0); place(ally,3.2,0);
  p.key("Enter"); p.frame(2);
  const head=aimAt(p,ally);
  p.pointer("pointermove",head.x,head.y); p.key("KeyQ");
  p.pointer("pointermove",1,1); p.frame();
  assert.ok(g.relay.flight);
  near(g.relay.flight.dx,1);
  assert.match(p.id("relay-status").textContent,/Pass in flight/);
  p.frame(15);
  assert.equal(g.relay.carrier,ally.id);
  assert.equal(player.completions,1);
  assert.match(p.id("feed").textContent,/YouPASS TOBollard/);
  assert.match(p.id("relay-status").textContent,/Escort Bollard/);
  p.key("Slash");
  const guide=p.id("dialog-content").textContent;
  for (const term of ["Pass the core","RMB","crew sheet","crane drops","Bank lens","Haul line"]) assert.ok(guide.includes(term));
});
