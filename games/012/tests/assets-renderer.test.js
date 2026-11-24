"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { html, project, scriptPaths, declarations, RecordingGL, environment } = require("./fixtures.js");
const { bodies, planets, moon, byId } = require("../js/catalog.js");
const { surface, landMask, textureFor, dustMap } = require("../js/surfaces.js");
const { program, Renderer } = require("../js/renderer.js");
const { systemAt, START_DAYS } = require("../js/physics.js");
const { OrbitCamera } = require("../js/camera.js");
const { bodyMatrix, dot, normalize, transform } = require("../js/math.js");
const { moonInScene } = require("../js/lunar.js");
const { sites, targets, celestialNorth, observerAt, observe } = require("../js/sky.js");
const shaders = require("../js/shaders.js");

test("the double-click entry point loads every application script once in dependency order", () => {
  assert.deepEqual(scriptPaths, ["math","catalog","time","physics","observations","encounters","fieldlog","lunar","sky","camera",
    "geometry","surfaces","shaders","renderer","controls","instruments","observatory","planner","app"].map(n=>"js/"+n+".js"));
  const disk=fs.readdirSync(path.join(project,"js")).filter(n=>n.endsWith(".js")).map(n=>"js/"+n);
  assert.deepEqual([...scriptPaths].sort(),disk.sort());
  for (const tag of html.matchAll(/<script\b[^>]*>/g)) {
    assert.match(tag[0],/\bdefer\b/);
    assert.doesNotMatch(tag[0],/\basync\b|type="module"/);
  }
  const ids=Array.from(html.matchAll(/\bid="([^"]+)"/g),m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  for (const ref of html.matchAll(/\b(?:aria-labelledby|aria-controls|aria-describedby|for)="([^"]+)"/g)) {
    for (const id of ref[1].split(" ")) assert.ok(ids.includes(id),"Unresolved identifier " + id);
  }
  assert.match(html,/<noscript>/);
  assert.match(html,/id="graphics-error"[^>]*role="alert"/);
});

test("assets stay local and the application contains no network or module-loader dependency", () => {
  for (const ref of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (ref[1]==="data:,") continue;
    assert.doesNotMatch(ref[1],/[:\\]|^\/|\.\./);
    assert.ok(fs.statSync(path.join(project,ref[1])).isFile());
  }
  for (const name of [...scriptPaths,"styles.css"]) {
    const source=fs.readFileSync(path.join(project,name),"utf8");
    assert.doesNotMatch(source,/https?:\/\/|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|@import|\bimport\s*\(/);
  }
});

test("procedural surface maps are deterministic, varied and body-specific", () => {
  const signatures=new Set();
  for (const body of [...bodies, moon]) {
    const a=surface(body.id,64,32), b=surface(body.id,64,32);
    assert.deepEqual(a,b);
    assert.equal(a.data.length,64*32*4);
    const colors=new Set(), sum=[0,0,0];
    for (let i=0;i<a.data.length;i+=4) {
      colors.add(a.data.slice(i,i+3).join(","));
      for (let c=0;c<3;c++) sum[c]+=a.data[i+c];
    }
    assert.ok(colors.size>25,body.id+" lacks surface variation");
    signatures.add(sum.map(n=>Math.round(n/(64*32))).join(","));
  }
  assert.equal(signatures.size,bodies.length + 1);
  assert.throws(()=>surface("pluto",16,8),RangeError);
  assert.throws(()=>surface("constructor",16,8),RangeError);
  assert.throws(()=>surface("earth",0,8),RangeError);
});

test("Earth has recognizable continents, oceans, polar ice and a separate specular mask", () => {
  const land=landMask(512,256);
  for (const [lon,lat] of [[20,23],[-62,-9],[133,-23],[-102,41],[80,57],[-45,73]]) assert.equal(land(lon,lat),1);
  for (const [lon,lat] of [[-133,0],[-34,30],[74,-25],[-160,-39]]) assert.equal(land(lon,lat),0);
  assert.equal(land(20+360,23),land(20,23));
  const texture=textureFor("earth");
  let ocean=0,landPixels=0;
  for (let i=3;i<texture.data.length;i+=4) {
    if (texture.data[i]>20) ocean++;
    if (texture.data[i]===4) landPixels++;
  }
  assert.ok(ocean>20000 && landPixels>20000);
  const polar=texture.data.slice(0,3);
  assert.ok(polar.every(channel=>channel>185));
});

test("textures and backdrop are cached or reproducible and support WebGL 1 mipmapping", () => {
  for (const b of bodies) {
    const t=textureFor(b.id);
    assert.equal(t,textureFor(b.id));
    assert.equal(t.width & (t.width-1),0); assert.equal(t.height & (t.height-1),0);
  }
  const dust=dustMap(32);
  assert.deepEqual(dust,dustMap(32));
  assert.ok(new Set(dust.data).size>80);
  assert.equal(dust.data.length,32*32*4);
});

test("all eight shader pairs have balanced GLSL ES 1.00 sources and matching varyings", () => {
  assert.deepEqual(Object.keys(shaders).sort(), ["body","glow","link","path","points","rings","sky","trail"]);
  for (const [name,s] of Object.entries(shaders)) {
    for (const [stage,source] of Object.entries(s)) {
      assert.match(source,/void\s+main\s*\(\s*\)/,name);
      assert.match(source,/precision\s+(?:highp|mediump)\s+float;/);
      const brackets=[], pairs={")":"(","]":"[","}":"{"};
      for (const char of source) {
        if ("([{".includes(char)) brackets.push(char);
        else if (")]}".includes(char)) assert.equal(brackets.pop(),pairs[char],name+" "+stage);
      }
      assert.equal(brackets.length,0);
      assert.doesNotMatch(source,/\b(?:layout|texelFetch|textureLod|gl_VertexID)\b/);
    }
    assert.match(s.vertex,/gl_Position\s*=/);
    assert.match(s.fragment,/gl_FragColor\s*=/);
    assert.deepEqual(declarations(s.vertex,"varying"),declarations(s.fragment,"varying"));
  }
});

test("shader compilation and linking errors propagate and release failed programs", () => {
  for (const opts of [{badShader:true},{badLink:true}]) {
    const gl=new RecordingGL(opts);
    assert.throws(()=>program(gl,shaders.body), /test (compile|link) error/);
    assert.equal(gl.programs[0].deleted,true);
    assert.ok(gl.programs[0].shaders.every(s=>s.deleted));
  }
});

test("the renderer draws nine textured spheres, rings, eight tracks, stars, belt, sky and corona", () => {
  const env=environment(), canvas=env.get("space"), r=new Renderer(canvas), gl=canvas.gl;
  r.resize(900,450,1.5);
  assert.deepEqual(gl.viewportSize,[1350,675]);
  const states=systemAt(START_DAYS), view=new OrbitCamera(2).step(0,states,2);
  r.scene(states,START_DAYS,view,{selected:"earth",orbits:true});
  const counts=mode=>gl.draws.filter(d=>d.mode===mode).length;
  assert.equal(counts(gl.TRIANGLES),10);
  assert.equal(counts(gl.LINE_LOOP),8);
  assert.equal(counts(gl.POINTS),2);
  assert.equal(counts(gl.TRIANGLE_STRIP),2);
  assert.equal(gl.draws.filter(d=>d.mode===gl.TRIANGLES && d.depth).length,10);
  assert.equal(gl.textures.length,10);
  const allocations=[gl.buffers.length,gl.textures.length,gl.programs.length];
  gl.draws.length=0;
  for (let frame=1;frame<=8;frame++) r.scene(systemAt(START_DAYS+frame/60),START_DAYS+frame/60,view,{selected:"mars",orbits:false});
  assert.equal(counts(gl.LINE_LOOP),0);
  assert.deepEqual([gl.buffers.length,gl.textures.length,gl.programs.length],allocations);
});

test("portrait renderer uses transparent backgrounds and frames all eight planets including Saturn's rings", () => {
  const canvas=environment().get("portrait"), r=new Renderer(canvas,true), gl=canvas.gl;
  assert.equal(canvas.contextOptions.alpha,true);
  assert.equal(gl.background[3],0);
  for (const body of planets) {
    gl.draws.length=0; r.portrait(body,140,110,2);
    assert.equal(gl.draws.length,body===byId.saturn?2:1);
    assert.ok(gl.draws.every(d=>d.mode===gl.TRIANGLES && d.vp.every(Number.isFinite)));
  }
  assert.deepEqual(gl.viewportSize,[280,220]);
});

test("the orbit sectors reuse their own mesh per planet and signal endpoints update without GPU allocations or uploads", () => {
  const canvas = environment().get("space"), renderer = new Renderer(canvas), gl = canvas.gl;
  const camera = new OrbitCamera(2);
  const budget = () => [gl.buffers.length, gl.uploads, gl.programs.length, gl.textures.length];
  renderer.resize(900, 450);
  const first = systemAt(START_DAYS);
  renderer.scene(first, START_DAYS, camera.step(0, first, 2), { selected: "earth", orbits: true });
  const initial = budget(), seen = new Set();
  for (const body of planets) {
    const day = START_DAYS + body.order / 60;
    const states = systemAt(day);
    gl.draws.length = 0;
    renderer.scene(states, day, camera.step(1 / 60, states, 2),
      { selected: body.id, sweeps: true, linkTarget: "sun", orbits: false });
    const fills = gl.draws.filter(draw => draw.mode === gl.TRIANGLE_FAN);
    const outlines = gl.draws.filter(draw => draw.mode === gl.LINE_STRIP);
    assert.equal(fills.length, 2);
    assert.equal(outlines.length, 2);
    for (const [i, fill] of fills.entries()) {
      assert.ok(fill.depth && fill.blend && !fill.write);
      assert.equal(outlines[i].vertex, fill.vertex);
      assert.equal(outlines[i].count, fill.count + 1);
      assert.ok(!seen.has(fill.vertex));
      seen.add(fill.vertex);
    }
    const link = gl.draws.find(draw => draw.mode === gl.LINES);
    assert.deepEqual(link.prog.values.get("uFrom"), states[body.id].position);
    assert.deepEqual(link.prog.values.get("uTo"), [0, 0, 0]);
    assert.deepEqual(budget(), initial);
  }
  gl.draws.length = 0;
  renderer.scene(first, START_DAYS, camera.step(0, first, 2),
    { selected: "sun", sweeps: true, linkTarget: "earth", orbits: false });
  assert.ok(!gl.draws.some(draw => draw.mode === gl.TRIANGLE_FAN));
  assert.ok(gl.draws.some(draw => draw.mode === gl.LINES));
  assert.deepEqual(budget(), initial);
});

test("framebuffer budget caps high-density screens and handles tiny containers", () => {
  const canvas=environment().get("space"), r=new Renderer(canvas,true);
  r.resize(7000,4000,4);
  assert.ok(canvas.width*canvas.height<2404000);
  assert.ok(Math.abs(canvas.width/canvas.height-1.75)<0.005);
  r.resize(0,0,2);
  assert.deepEqual(canvas.gl.viewportSize,[1,1]);
});

test("the moving lunar guide reuses its unit ellipse and restores heliocentric path transforms", () => {
  const canvas = environment().get("space"), renderer = new Renderer(canvas), gl = canvas.gl;
  const camera = new OrbitCamera(2);
  renderer.resize(900,450);
  const budget = () => [gl.buffers.length, gl.uploads, gl.textures.length, gl.programs.length];
  let baseline, guideBuffer;
  for (const offset of [0, 7, -2, 10000]) {
    const day = START_DAYS + offset, states = systemAt(day), lunar = moonInScene(day, states.earth);
    gl.draws.length = 0;
    renderer.scene(states, day, camera.step(0, states, 2), { selected: "earth", orbits: true, moon: lunar });
    const tracks = gl.draws.filter(d => d.mode === gl.LINE_LOOP);
    const guide = tracks.at(-1), sphere = gl.draws.filter(d => d.eyepiece === 0).at(-1);
    assert.equal(tracks.length, 9);
    for (const track of tracks.slice(0,-1)) assert.deepEqual(track.model, bodyMatrix([0,0,0],1));
    assert.deepEqual(guide.model, lunar.guide);
    assert.deepEqual(sphere.model, lunar.model);
    assert.deepEqual(sphere.light, lunar.light);
    assert.ok(guide.depth && !guide.write && guide.blend && sphere.depth && sphere.write);
    if (offset === 0) { baseline = budget(); guideBuffer = guide.vertex; }
    assert.equal(guide.vertex, guideBuffer);
    assert.deepEqual(budget(), baseline);
  }
});

test("every eyepiece frames its globe with celestial north up and uses station-to-target phase geometry", () => {
  const canvas = environment().get("eyepiece"), renderer = new Renderer(canvas, true), gl = canvas.gl;
  for (const body of targets) {
    const observation = observe(body.id, observerAt(START_DAYS, sites[0]));
    gl.draws.length = 0;
    renderer.eyepiece(body, START_DAYS, observation, 160, 210, 1.5);
    assert.equal(gl.draws.length, body.id === "saturn" ? 2 : 1);
    const globe = gl.draws[0];
    assert.equal(globe.eyepiece, 1);
    assert.ok(globe.depth && globe.write);
    const north = transform(globe.vp, celestialNorth, 0);
    assert.ok(Math.abs(north[0]) < 1e-6 && north[1] > 0);
    const center = transform(globe.vp, [0,0,0]);
    assert.ok(center.slice(0,2).every(k => Math.abs(k) < 1e-6) && Math.abs(center[2]) < 1);
    for (const axis of [[1,0,0], [0,1,0], [0,0,1]]) {
      const tip = transform(globe.vp, axis);
      assert.equal(tip[3], center[3]); // Parallel projection even for a very close zoom.
      assert.ok(tip.slice(0,3).every(k => Math.abs(k) < 1));
    }
    if (body.id !== "sun") {
      assert.deepEqual(globe.light, observation.light);
      const eye = normalize(globe.prog.values.get("uEye"));
      assert.ok(Math.abs((1 + dot(eye, globe.light))/2 - observation.illuminated) < 1e-12);
    }
  }
  const allocations = [gl.programs.length, gl.buffers.length, gl.textures.length, gl.uploads];
  renderer.eyepiece(moon, START_DAYS+1, observe("moon", observerAt(START_DAYS+1, sites[2])), 300, 104);
  renderer.portrait(moon, 100, 100);
  assert.equal(gl.draws.at(-1).eyepiece, 0);
  assert.deepEqual([gl.programs.length, gl.buffers.length, gl.textures.length, gl.uploads], allocations);
});
