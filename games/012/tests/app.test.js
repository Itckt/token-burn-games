"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { application } = require("./fixtures.js");
const { bodies, planets } = require("../js/catalog.js");
const { systemAt, START_DAYS } = require("../js/physics.js");
const { screenBodies, OrbitCamera } = require("../js/camera.js");
const { periodText } = require("../js/app.js");
const eqText=(page,id,text)=>assert.equal(page.get(id).textContent,text);
const pressed=(page,id)=>page.get(id).getAttribute("aria-pressed");
const card=(page,id)=>page.get("planet-list").children.find(el=>el.getAttribute("data-body")===id);
const label=(page,id)=>page.get("map-labels").children.find(el=>el.getAttribute("data-body")===id);

test("the actual classic scripts bootstrap inside a file-style global environment with no module loader", () => {
  const p=application({classic:true});
  assert.deepEqual(p.win.messages,[]);
  assert.equal(p.get("graphics-error").hidden,true);
  assert.equal(p.frame(0),1); assert.equal(p.frames.size,1);
  assert.equal(p.get("planet-list").children.length,8);
  assert.equal(p.get("map-labels").children.length,10);
  assert.ok(label(p,"moon").hidden);
  assert.ok(p.get("map-labels").children.filter(tag=>!tag.hidden).length>=7);
  assert.equal(card(p,"earth").getAttribute("aria-pressed"),"true");
  assert.ok(card(p,"saturn").children[0].style.backgroundImage.startsWith('url("data:image/png;'));
  assert.equal(p.get("selection-marker").hidden,false);
  assert.equal(p.get("sim-date").getAttribute("datetime"),"2026-01-01");
  eqText(p,"view-name","System overview");
  eqText(p,"profile-name","Earth");
  eqText(p,"range-delay","20m 03s");
  p.key("1"); p.key("v"); p.get("toggle-link").click(); p.get("visit-perihelion").click();
  p.frame(500);
  eqText(p,"view-name","Mercury orbit"); eqText(p,"status-text","Paused");
  assert.equal(p.get("sim-date").getAttribute("datetime"),"2026-02-19");
  assert.ok(p.get("space").gl.draws.some(draw => draw.mode === p.get("space").gl.LINES));
  p.key("p"); p.key("e");
  p.get("encounter-events").children[0].click(); p.get("encounter-apply").click();
  eqText(p,"view-name","Mercury + Mars");
  const trails=p.get("trail-span"); trails.value="7"; trails.emit("change"); p.frame(600);
  assert.equal(p.get("space").gl.draws.filter(draw=>draw.tint).length,4);
});

test("planet index, map labels and cycle buttons select the correct profile and measurements", () => {
  const p=application();
  for (const body of planets) {
    card(p,body.id).click();
    eqText(p,"profile-name",body.name); eqText(p,"family",body.family);
    eqText(p,"diameter",body.diameter.toLocaleString("en-GB")+" km");
    eqText(p,"description",body.description);
    assert.equal(p.get("planet-list").children.filter(c=>c.getAttribute("aria-pressed")==="true").length,1);
    assert.match(p.get("distance").textContent,/^\d+\.\d{3} AU$/);
  }
  p.get("next").click(); eqText(p,"profile-name","Mercury");
  p.get("previous").click(); eqText(p,"profile-name","Neptune");
  label(p,"sun").click(); eqText(p,"profile-name","Sun");
  eqText(p,"period-label","Rotation period"); eqText(p,"distance","At origin");
  p.get("previous").click(); eqText(p,"profile-name","Neptune");
  label(p,"sun").click(); p.get("next").click(); eqText(p,"profile-name","Mercury");
  assert.equal(periodText(365.2569),"365.26 d");
  assert.equal(periodText(3652.568983),"10.00 yr");
});

test("follow mode changes targets through normal controls and returns to the overview", () => {
  const p=application(); p.frame(0);
  p.get("follow").click(); eqText(p,"view-name","Following Earth");
  eqText(p,"follow-text","Return to overview"); assert.equal(pressed(p,"follow"),"true");
  for (const b of planets) {
    p.key(String(b.order)); eqText(p,"view-name","Following "+b.name);
    p.frame(1000*b.order); assert.equal(p.get("graphics-error").hidden,true);
  }
  p.get("follow").click(); eqText(p,"view-name","System overview");
  assert.equal(pressed(p,"follow"),"false");
  card(p,"mars").emit("dblclick"); eqText(p,"view-name","Following Mars");
  p.key("0"); eqText(p,"view-name","System overview");
  label(p,"sun").emit("dblclick"); eqText(p,"view-name","Following Sun");
  p.key("Escape"); eqText(p,"view-name","System overview");
});

test("the slider and keyboard change simulated elapsed days, with independent pause and resume", () => {
  const p=application(); p.frame(0); p.frame(1000);
  assert.equal(p.get("sim-date").getAttribute("datetime"),"2026-01-02");
  p.get("play").click(); eqText(p,"status-text","Paused");
  assert.equal(p.get("play").getAttribute("aria-label"),"Resume simulation");
  p.frame(3000); p.frame(9000); eqText(p,"sim-date","02 Jan 2026");
  p.get("speed").value="6"; p.get("speed").emit("input");
  eqText(p,"speed-value","100 d/s"); assert.equal(p.get("speed").getAttribute("aria-valuetext"),"100 days per second");
  p.key(" "); p.frame(10000); p.frame(10500);
  eqText(p,"sim-date","21 Feb 2026"); eqText(p,"status-text","Running");
  p.key("["); eqText(p,"speed-value","30 d/s");
  p.key("]"); p.key("]"); eqText(p,"speed-value","100 d/s");
  for (let i=0;i<10;i++) p.key("[");
  eqText(p,"speed-value","0.1 d/s"); assert.equal(p.get("speed").value,"0");
});

test("layer buttons and shortcuts update the labels and the draw stream", () => {
  const p=application(); p.frame(0);
  const gl=p.get("space").gl;
  p.get("toggle-orbits").click(); p.key("l");
  assert.equal(pressed(p,"toggle-orbits"),"false"); assert.equal(pressed(p,"toggle-labels"),"false");
  assert.equal(p.get("map-labels").hidden,true);
  gl.draws.length=0; p.frame(100);
  assert.equal(gl.draws.filter(d=>d.mode===gl.LINE_LOOP).length,0);
  p.key("o"); p.get("toggle-labels").click(); p.frame(200);
  assert.equal(gl.draws.filter(d=>d.mode===gl.LINE_LOOP).length,8);
  assert.equal(p.get("map-labels").hidden,false);
});

test("keyboard handling preserves native button and input behavior and recognizes modifiers", () => {
  const p=application();
  p.key(" ",{target:p.get("follow")}); eqText(p,"status-text","Running");
  p.key("ArrowRight",{target:p.get("speed")});
  p.key("5",{target:p.get("speed")}); eqText(p,"profile-name","Earth");
  p.key("8",{ctrlKey:true}); p.key("4",{altKey:true}); p.key("6",{metaKey:true}); eqText(p,"profile-name","Earth");
  p.key(" ",{repeat:true}); eqText(p,"status-text","Running");
  assert.equal(p.key("7").defaultPrevented,true); eqText(p,"profile-name","Uranus");
});

test("on-screen help opens, isolates shortcuts, closes and restores keyboard focus", () => {
  const p=application(); p.get("help-open").focus(); p.get("help-open").click();
  assert.equal(p.get("controls-dialog").open,true);
  assert.equal(p.doc.activeElement,p.get("help-close"));
  p.key("1"); eqText(p,"profile-name","Earth");
  p.key("?",{repeat:true});
  assert.equal(p.get("controls-dialog").open,true);
  p.key("Escape"); assert.equal(p.get("controls-dialog").open,false);
  assert.equal(p.doc.activeElement,p.get("help-open"));
  p.key("?"); p.get("help-close").click(); assert.equal(p.get("controls-dialog").open,false);
  p.key("?",{repeat:true}); assert.equal(p.get("controls-dialog").open,false);
  p.key("f"); p.key("h"); p.key("Escape"); p.key("Escape",{repeat:true});
  eqText(p,"view-name","Following Earth");
});

test("expanded view and follow mode exit in order and update accessible control names", () => {
  const p=application(); p.key("f"); p.get("expand").click();
  assert.equal(pressed(p,"expand"),"true");
  assert.ok(p.doc.body.classList.contains("map-expanded"));
  assert.equal(p.get("expand").getAttribute("aria-label"),"Exit expanded map");
  p.key("Escape"); assert.equal(pressed(p,"expand"),"false"); eqText(p,"view-name","Following Earth");
  p.key("Escape"); eqText(p,"view-name","System overview");
});

test("canvas hit testing, double click, drag suppression and pointer cancellation use real event handlers", () => {
  const p=application(), canvas=p.get("space"), states=systemAt(START_DAYS); p.frame(0);
  const view=new OrbitCamera(2).step(0,states,2);
  const target=screenBodies(bodies,states,view,900,450).find(b=>b.id==="jupiter");
  const pointer={button:0,pointerId:1,clientX:target.x,clientY:target.y};
  canvas.emit("pointerdown",pointer); canvas.emit("pointerup",pointer); eqText(p,"profile-name","Jupiter");
  p.key("3"); canvas.emit("pointerdown",pointer);
  canvas.emit("pointermove",{...pointer,clientX:target.x+30}); canvas.emit("pointerup",pointer);
  eqText(p,"profile-name","Earth"); assert.ok(!canvas.classList.contains("dragging"));
  canvas.emit("pointerdown",pointer); canvas.emit("pointercancel",pointer); canvas.emit("pointerup",pointer);
  eqText(p,"profile-name","Earth");
  canvas.emit("dblclick",pointer); eqText(p,"view-name","Following Jupiter");
});

test("wheel, pinch, zoom buttons, arrows and resize reach the camera and renderer", () => {
  const p=application(), canvas=p.get("space"); p.frame(0); p.key(" ");
  let time=10;
  const vp=()=>{canvas.gl.draws.length=0;p.frame(time+=1500);return Array.from(canvas.gl.draws.find(d=>d.vp).vp);};
  let previous=vp();
  function changed(action) {
    action(); const next=vp(); assert.notDeepEqual(next,previous); previous=next;
  }
  changed(()=>p.get("zoom-in").click()); changed(()=>p.get("zoom-out").click());
  changed(()=>assert.ok(canvas.emit("wheel",{deltaY:3,deltaMode:1}).defaultPrevented));
  changed(()=>p.key("ArrowUp")); changed(()=>p.key("ArrowRight")); changed(()=>p.key("+")); changed(()=>p.key("-"));
  const touch=(id,x)=>({button:0,pointerId:id,clientX:x,clientY:90});
  changed(()=>{
    canvas.emit("pointerdown",touch(1,170)); canvas.emit("pointerdown",touch(2,230));
    canvas.emit("pointermove",touch(2,285)); canvas.emit("pointerup",touch(1,170));canvas.emit("pointerup",touch(2,285));
  });
  eqText(p,"profile-name","Earth");
  changed(()=>p.resize("stage",430,580));
  assert.deepEqual(canvas.gl.viewportSize,[430,580]);
  p.win.devicePixelRatio=1.5; vp();
  assert.deepEqual(canvas.gl.viewportSize,[645,870]);
  p.resize("specimen",220,120); assert.deepEqual(p.get("portrait").gl.viewportSize,[330,180]);
});

test("hiding the page suspends the clock without accumulating elapsed background time", () => {
  const p=application(); p.frame(0); p.frame(1000);
  p.doc.hidden=true; p.doc.emit("visibilitychange"); assert.equal(p.frame(40000),0);
  p.doc.hidden=false; p.doc.emit("visibilitychange");
  p.frame(60000); eqText(p,"sim-date","02 Jan 2026");
  p.frame(61000); eqText(p,"sim-date","03 Jan 2026");
  assert.equal(p.frames.size,1);
});

test("missing WebGL shows readable recovery guidance while the planet index and help still work", () => {
  const p=application({offline:true,classic:true});
  assert.equal(p.get("graphics-error").hidden,false);
  assert.match(p.get("error-detail").textContent,/WebGL.*acceleration.*reload/i);
  eqText(p,"status-text","View offline"); assert.equal(p.frames.size,0);
  assert.ok(p.get("play").disabled && p.get("follow").disabled);
  card(p,"neptune").click(); eqText(p,"profile-name","Neptune");
  p.key("?"); assert.ok(p.get("controls-dialog").open);
  p.get("retry").click(); assert.equal(p.win.location.reloads,1);
});

test("a failed shader link degrades gracefully and a failed portrait leaves the main map available", () => {
  const bad=application({badLink:true});
  assert.equal(bad.get("graphics-error").hidden,false);
  assert.ok(bad.win.messages.some(parts=>parts.includes("test link error")));
  const p=application({noPortrait:true});
  assert.ok(p.get("specimen").classList.contains("fallback"));
  assert.equal(p.get("graphics-error").hidden,true); assert.equal(p.frame(0),1);
  card(p,"saturn").click(); p.get("follow").click(); eqText(p,"view-name","Following Saturn");
});

test("context loss and restoration rebuild the view and preserve the current target and calendar", () => {
  const p=application(), canvas=p.get("space"); p.frame(0); p.frame(1000);
  card(p,"mars").click(); p.key("f"); p.get("expand").click();
  const lost=canvas.emit("webglcontextlost"); assert.ok(lost.defaultPrevented);
  eqText(p,"status-text","View offline"); assert.equal(p.frames.size,0);
  assert.equal(pressed(p,"expand"),"false"); assert.equal(p.get("graphics-error").hidden,false);
  canvas.emit("webglcontextrestored");
  p.frame(60000); eqText(p,"sim-date","02 Jan 2026"); eqText(p,"view-name","Following Mars");
  assert.equal(p.get("graphics-error").hidden,true); assert.equal(p.frames.size,1);
  const image=p.get("portrait"); image.emit("webglcontextlost");
  assert.ok(p.get("specimen").classList.contains("fallback"));
  image.emit("webglcontextrestored"); assert.ok(!p.get("specimen").classList.contains("fallback"));
});
