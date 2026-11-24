"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { boot, root, html, scripts } = require("./offline-page.js");

function near(actual,expected,eps=1e-5) {
  assert.ok(Math.abs(actual-expected)<eps, actual+" differs from "+expected);
}

test("the double-click entry point loads every local script once and needs no network or module loader", () => {
  const files=fs.readdirSync(path.join(root,"src")).filter(f=>f.endsWith(".js")).map(f=>"src/"+f);
  assert.deepEqual(scripts.slice().sort(),files.sort());
  assert.equal(new Set(scripts).size,scripts.length);
  assert.doesNotMatch(html,/<base\b|<script[^>]*\btype="module"|https?:\/\//i);
  for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) assert.match(tag,/\bdefer\b/);
  for (const [,file] of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    if (file.startsWith("data:")) continue;
    assert.match(file,/^(?:src\/)?[\w.-]+$/);
    assert.ok(fs.statSync(path.join(root,file)).isFile());
  }
  const css=fs.readFileSync(path.join(root,"styles.css"),"utf8");
  assert.doesNotMatch(css,/@import\b|url\s*\(/i);
  for (const file of scripts) {
    const source=fs.readFileSync(path.join(root,file),"utf8");
    assert.doesNotMatch(source,/\b(?:fetch|importScripts|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/);
  }
  assert.match(html,/<noscript>/);
  assert.match(html,/W A S D/);
});

test("startup renders the six runners, radar, score and portrait while the clock waits for deployment", () => {
  const p=boot(), [view]=p.views, gl=view.gl;
  assert.equal(p.pending(),1);
  p.frame();
  assert.equal(p.id("overlay").hidden,true);
  assert.equal(p.id("deploy").hidden,false);
  assert.equal(p.id("tags").children.length,6);
  assert.equal(p.id("tags").querySelectorAll(".you-tag").length,1);
  assert.equal(p.id("tags").querySelectorAll(".hostile").length,3);
  assert.equal(p.id("clock").textContent,"03:00");
  assert.equal(p.id("score0").textContent,"00");
  assert.ok(p.id("radar").ink.calls>0 && p.id("portrait").ink.calls>0);
  assert.equal(gl.programs.length,4);
  assert.equal(p.doc.graphics[1].programs.length,1);
  assert.ok(p.doc.graphics[1].lost,"one-shot portrait releases its graphics context");
  assert.ok(gl.shaders.every(s=>s.ok) && gl.programs.every(prog=>prog.linked));
  const staticUploads=gl.staticUploads, draws=gl.draws, dynamic=gl.dynamicUploads;
  p.frame(5);
  assert.equal(p.matches[0].elapsed,0);
  assert.equal(gl.staticUploads,staticUploads,"no geometry rebuild per frame");
  assert.equal(gl.dynamicUploads-dynamic,5,"effects are batched");
  assert.ok(gl.draws>draws && gl.draws-draws<=5*32);
  assert.ok(gl.depthWrite && !gl.enabled.has(gl.BLEND) && gl.enabled.has(gl.CULL_FACE));
});

test("camera damping, resize, resolution budget and head-to-foot mouse picking share one projection", () => {
  const p=boot({dpr:3}), [view]=p.views, actors=p.matches[0].actors, enemy=actors[3];
  for (const [w,h] of [[1920,1080],[430,680],[1680,430]]) {
    p.doc.options.width=w; p.doc.options.height=h;
    const before=view.focusX;
    view.camera(8,2,0.045);
    const target=8*(w/h<1.1 ? 0.62 : 0.17);
    assert.ok(Math.abs(target-view.focusX)<Math.abs(target-before));
    assert.ok(Math.abs(target-view.focusX)>1e-6);
    assert.equal(view.width,w); assert.equal(view.height,h);
    assert.ok(view.canvas.width*view.canvas.height<=2250000+4500);
    const floor=view.locate(-2.1,0,-0.8), at=view.pick(floor.x,floor.y,actors);
    near(at[0],-2.1); near(at[1],0); near(at[2],-0.8);
    for (const y of [0.1,1.1,1.9]) {
      const point=view.locate(enemy.x,y,enemy.z);
      assert.deepEqual(Array.from(view.pick(point.x,point.y,actors)),[enemy.x,0,enemy.z]);
    }
  }
  const head=view.locate(enemy.x,1.8,enemy.z);
  enemy.hp=0;
  const aim=view.pick(head.x,head.y,actors);
  assert.ok(Math.hypot(aim[0]-enemy.x,aim[2]-enemy.z)>0.5,"fallen actors do not capture aim");
});

test("a sub-frame helmet click deploys, fires once, knocks out its target and updates the live HUD", () => {
  const p=boot(), g=p.matches[0], [view]=p.views, enemy=g.actors[3];
  enemy.hp=p.api.game.RULES.shotDamage;
  p.frame();
  const head=view.locate(enemy.x,1.8,enemy.z);
  p.pointer("pointerdown",head.x,head.y);
  p.pointer("pointerup",head.x,head.y);
  p.frame(40);
  assert.equal(g.phase,"playing"); assert.equal(g.actors[0].shots,1);
  assert.equal(g.actors[0].kills,1); assert.equal(enemy.hp,0);
  assert.equal(p.id("score0").textContent,"01");
  assert.equal(p.id("tags").children[enemy.id].hidden,true);
  assert.match(p.id("feed").textContent,/YouKOTorchlug/);
  assert.match(p.id("announcer").textContent,/knocked out/);
  assert.equal(p.id("damage-numbers").children.length,1);
  p.frame(46);
  assert.equal(p.id("damage-numbers").children.length,0);
  p.frame(275);
  assert.equal(p.id("feed").children.length,0);
  assert.equal(p.id("tags").children[enemy.id].hidden,false);
  assert.equal(g.actors[0].shots,1);
});

test("hold-to-fire, release, movement keys, one-shot abilities and cooldown badges use real client handlers", () => {
  const p=boot(), g=p.matches[0], player=g.actors[0], x=player.x;
  p.key("KeyD"); p.frame(10); p.up("KeyD");
  assert.ok(player.x>x);
  const released=player.x; p.frame(3); near(player.x,released);
  p.pointer("pointerdown",870,295,{button:2}); p.frame(3); assert.equal(player.shots,0);
  p.pointer("pointerdown",870,295); p.frame(40);
  assert.ok(player.shots>=2);
  p.pointer("pointerup",870,295);
  const shots=player.shots; p.frame(22); assert.equal(player.shots,shots);
  p.key("KeyE"); p.frame(2);
  assert.ok(player.pulseCd>6);
  assert.match(p.id("pulse-card").querySelector(".cooldown").textContent,/[1-7]/);
  p.key("Space"); p.frame(2);
  assert.ok(player.dashLeft>0 && player.dashCd>3);
  assert.equal(p.id("dash-card").querySelector(".cooldown").textContent,"4");
  p.key("Space",{repeat:true});
  assert.equal(g.events.filter(e=>e.type==="dash").length,1);
  p.pointer("pointerdown",450,270); p.pointer("pointercancel",450,270);
  p.frame(24); assert.equal(player.shots,shots);
});

test("the fixed step matches at 30, 60 and 144 display Hz and caps catch-up after a stall", () => {
  const positions=[];
  for (const hz of [30,60,144]) {
    const p=boot(), g=p.matches[0];
    p.key("KeyD"); p.frame(1,1000/hz); p.frame(hz,1000/hz);
    near(g.elapsed,1);
    positions.push([g.actors[0].x,g.actors[0].z]);
    p.frame(1,60000);
    near(g.elapsed,1.10);
  }
  assert.deepEqual(positions[0],positions[1]); assert.deepEqual(positions[1],positions[2]);
});

test("field guide and pause preserve state, restore keyboard focus and discard held inputs", () => {
  const p=boot(), g=p.matches[0];
  p.id("guide").emit("click");
  assert.equal(g.phase,"paused"); assert.equal(p.id("game").inert,true);
  assert.match(p.id("dialog-content").textContent,/W A S D/);
  p.key("Escape");
  assert.equal(g.phase,"ready");
  p.id("deploy").emit("click");
  p.key("KeyD"); p.pointer("pointerdown",800,300); p.frame(8);
  p.id("pause").emit("click"); p.frame();
  assert.equal(p.id("pause").getAttribute("aria-pressed"),"true");
  const buttons=p.id("dialog-actions").children;
  assert.equal(p.doc.activeElement,buttons[0]);
  p.key("Tab",{key:"Tab",shiftKey:true}); assert.equal(p.doc.activeElement,buttons.at(-1));
  p.key("Tab",{key:"Tab"}); assert.equal(p.doc.activeElement,buttons[0]);
  const elapsed=g.elapsed, x=g.actors[0].x, shots=g.actors[0].shots;
  p.action("Field guide");
  p.frame(20,250);
  assert.equal(g.elapsed,elapsed);
  p.action("Back to pause");
  assert.equal(p.id("dialog-title").textContent,"Round paused");
  p.action("Return to yard");
  p.frame(35);
  assert.equal(p.id("game").inert,false);
  assert.equal(p.doc.activeElement,p.id("arena"));
  assert.ok(g.elapsed>elapsed); near(g.actors[0].x,x); assert.equal(g.actors[0].shots,shots);
});

test("focus loss and hidden tabs stop the clock until explicitly resumed", () => {
  const p=boot(), g=p.matches[0];
  p.key("Enter"); p.frame(7);
  p.win.emit("blur");
  const elapsed=g.elapsed;
  assert.equal(g.phase,"paused"); p.frame(2);
  assert.equal(p.pending(),0);
  p.action("Return to yard"); p.frame(2);
  p.doc.hidden=true; p.doc.emit("visibilitychange");
  p.frame(1,70000);
  assert.equal(p.pending(),0);
  p.doc.hidden=false; p.doc.emit("visibilitychange"); p.frame();
  assert.equal(g.phase,"paused"); near(g.elapsed,elapsed+1/60);
  p.key("Escape"); p.frame(2); near(g.elapsed,elapsed+2/60);
});

test("a downed player sees a respawn countdown, then recovers health and a shield in their bay", () => {
  const p=boot(), g=p.matches[0], player=g.actors[0];
  p.key("Enter"); p.frame(2);
  p.api.game.hurt(g,g.actors[3],player,100);
  p.frame();
  assert.equal(p.id("respawn").hidden,false);
  assert.match(p.id("respawn-text").textContent,/Back on deck in/);
  assert.equal(p.id("health").getAttribute("aria-valuenow"),"0");
  assert.equal(p.id("hp-current").textContent,"0");
  assert.equal(p.id("score1").textContent,"01");
  p.frame(193);
  assert.equal(p.id("respawn").hidden,true);
  assert.equal(p.id("health").getAttribute("aria-valuenow"),"100");
  assert.match(p.id("tags").children[0].className,/\bshield\b/);
  assert.deepEqual([player.x,player.z],Array.from(p.api.arena.homes[0][0]));
});

test("a result stops dispatch and a rematch clears old scores, effects, controls and feed", () => {
  const p=boot({rules:{duration:0.08}}), g=p.matches[0];
  p.key("KeyA"); p.frame(2);
  p.api.game.hurt(g,g.actors[3],g.actors[1],100);
  p.frame(8);
  assert.equal(g.phase,"ended"); assert.equal(p.pending(),0);
  assert.equal(p.id("dialog-title").textContent,"Afterburn wins");
  assert.match(p.id("dialog-content").textContent,/0 – 1/);
  p.key("Enter"); p.key("Escape"); p.frame(5);
  assert.equal(p.matches.length,1); assert.equal(g.phase,"ended");
  p.action("Play again");
  const next=p.matches[1]; p.frame(2);
  assert.equal(next.phase,"playing"); assert.equal(p.id("overlay").hidden,true);
  assert.equal(p.id("score1").textContent,"00"); assert.equal(p.id("feed").children.length,0);
  near(next.actors[0].x,p.api.arena.opening[0][0]);
  p.frame(8); assert.equal(p.id("dialog-title").textContent,"Round drawn");
});

test("the winning shot produces the target-score result and final player statistics", () => {
  const p=boot({rules:{target:1}}), g=p.matches[0], enemy=g.actors[3];
  enemy.hp=20; p.frame();
  const target=p.views[0].locate(enemy.x,1,enemy.z);
  p.pointer("pointerdown",target.x,target.y); p.pointer("pointerup",target.x,target.y); p.frame(50);
  assert.equal(g.phase,"ended"); assert.equal(p.id("dialog-title").textContent,"Undertow wins");
  assert.match(p.id("dialog-content").textContent,/Knockout target reached/);
  assert.match(p.id("dialog-content").textContent,/1 KO · 0 down · 20 damage/);
});

test("sound is opt-in, synthesized on demand and optional on browsers without Web Audio", () => {
  const p=boot(); p.key("Enter"); p.pointer("pointerdown",800,300); p.frame(3);
  assert.equal(p.audio.contexts,0);
  p.id("audio").emit("click",{detail:1});
  assert.equal(p.audio.contexts,1); assert.equal(p.id("audio").getAttribute("aria-pressed"),"true");
  const cue=p.audio.tones; p.frame(25); assert.ok(p.audio.tones>cue);
  p.key("KeyM"); const muted=p.audio.tones; p.frame(25); assert.equal(p.audio.tones,muted);
  assert.equal(p.id("audio").getAttribute("aria-pressed"),"false");
  const silent=boot({noAudio:true});
  assert.ok(silent.id("audio").disabled); silent.key("KeyM"); silent.key("KeyW"); silent.frame(4);
  assert.equal(silent.matches[0].phase,"playing");
});

test("WebGL refusal and shader failure show readable recovery actions without scheduling gameplay", () => {
  for (const [options,title] of [[{noWebGL:true},"WebGL unavailable"],[{failCompile:true},"Graphics unavailable"]]) {
    const p=boot(options);
    assert.equal(p.id("dialog-title").textContent,title);
    assert.match(p.id("dialog-content").textContent,/WebGL.*graphics acceleration/);
    assert.equal(p.pending(),0);
    assert.equal(p.id("overlay").hidden,false); assert.ok(p.id("game").inert);
    p.key("KeyW"); p.frame(4); assert.equal(p.matches[0].elapsed,0);
    p.action("Reload arena"); assert.ok(p.reloaded);
  }
});

test("an unavailable shadow target falls back to an unshadowed lit scene", () => {
  const p=boot({noShadowBuffer:true});
  p.key("KeyW"); p.frame(3);
  const gl=p.views[0].gl;
  assert.ok(gl.textureSizes.some(([w,h])=>w===1 && h===1));
  assert.equal(gl.fb,null);
  assert.ok(gl.draws>0 && p.matches[0].elapsed>0);
});

test("losing and restoring the graphics context preserves the round and rebuilds GPU resources", () => {
  const p=boot(), g=p.matches[0], canvas=p.id("arena");
  p.key("KeyW"); p.frame(5);
  const before=[g.actors[0].x,g.actors[0].z,g.elapsed], uploads=p.views[0].gl.staticUploads;
  assert.ok(canvas.emit("webglcontextlost").defaultPrevented);
  p.frame(1,50000);
  assert.equal(p.id("dialog-title").textContent,"Graphics interrupted"); assert.equal(p.pending(),0);
  canvas.emit("webglcontextrestored"); p.frame();
  assert.equal(p.views.length,2); assert.ok(p.views[1].gl.staticUploads>uploads);
  assert.equal(p.matches.length,1); assert.equal(g.phase,"paused");
  assert.deepEqual([g.actors[0].x,g.actors[0].z,g.elapsed],before);
  p.action("Return to yard"); p.frame(4);
  assert.ok(g.elapsed>before[2]); near(g.actors[0].z,before[1]);
});
