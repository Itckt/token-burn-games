'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {deps,root} = require('./harness/page');
const {recordingGL} = require('./harness/gl');
const source = fs.readFileSync(path.join(root,'js/renderer.js'),'utf8');

function fixture(gl, options = {}) {
  const Rift = {...deps}, pictures = [];
  const canvas = {
    clientWidth: options.width ?? 840, clientHeight: options.height ?? 380,
    getContext(type) { assert.equal(type,'webgl'); return gl; },
    toDataURL(type) { pictures.push(type); return 'data:image/png;base64,AA=='; }
  };
  const window = {devicePixelRatio:options.ratio ?? 1.5, matchMedia:() => ({matches:Boolean(options.reduced)})};
  vm.runInNewContext(source,{Rift,window},{filename:'renderer.js'});
  return {create: () => new Rift.Renderer(canvas), canvas, pictures};
}

test('the render pipeline binds complete shader interfaces, draws combat and composites bloom to the screen', () => {
  const g = recordingGL(), f = fixture(g.gl), renderer = f.create(), B = deps.battle;
  assert.equal(g.programs.length,5);
  assert.equal(g.shaders.length,10);
  assert.ok(g.shaders.every(s => s.compiled && s.deleted));
  assert.deepEqual(f.pictures, B.CARDS.map(() => 'image/png'));
  assert.deepEqual(Object.keys(renderer.portraits),B.CARDS.map(c => c.id));
  assert.equal(g.uploads.filter(buf => buf.deleted).length,B.CARDS.length);
  const uploadCount = g.uploads.length, s = B.create({ai:false});
  B.deploy(s,0,1,'mortar');
  s.towers[0].hp = 0;
  s.units[1].hit = .5;
  s.units[1].fire = .6;
  for (const type of ['pulse','shell','relay']) {
    s.shots.push({type,age:.2,duration:.6,x:-1,y:1,z:2,tx:1.9,ty:1,tz:2,team:0});
  }
  for (const [id,kind] of ['strike','wreck','blast','impact'].entries()) {
    s.effects.push({id:id+100,kind,age:.2,life:.5,x:1,y:.5,z:2,team:1});
  }
  const before = JSON.stringify(s);
  renderer.render(s,1,.5,1/60);
  const [scene,blurX,blurY] = renderer.targets;
  assert.ok(scene.rb && !blurX.rb && !blurY.rb);
  assert.equal(blurX.w,Math.ceil(scene.w/3));
  assert.equal(g.draws.at(-3).framebuffer,blurX.fb);
  assert.equal(g.draws.at(-2).framebuffer,blurY.fb);
  assert.equal(g.draws.at(-1).framebuffer,null);
  assert.equal(new Set(g.draws.map(d => d.program)).size,5);
  for (const mesh of ['city','board','ruin','tower1','crystal1','mortar0','beam','shard']) {
    assert.ok(g.draws.some(d => d.buffer === renderer.meshes[mesh].buf),'missing draw of ' + mesh);
  }
  const [u,v] = renderer.project(0,.16,B.LANES[0]);
  assert.equal(renderer.laneAt(u*2-1,1-v*2),0);
  renderer.targetView = 1;
  renderer.render(s,1.1,.6,1/60);
  assert.ok(renderer.view > 0 && renderer.view < 1);
  assert.equal(g.uploads.length,uploadCount);
  assert.equal(g.targets.length,3);
  assert.equal(JSON.stringify(s),before);
});

test('resize obeys both GPU size limits, reuses matching targets and releases old attachments', () => {
  const g = recordingGL({limit:768}), f = fixture(g.gl,{width:1600,height:900,ratio:3}), renderer = f.create();
  renderer.resize();
  assert.deepEqual([renderer.width,renderer.height],[768,432]);
  const old = [...renderer.targets];
  renderer.resize();
  assert.equal(g.targets.length,3);
  f.canvas.clientWidth = 300;
  f.canvas.clientHeight = 240;
  renderer.resize();
  assert.deepEqual([renderer.width,renderer.height],[495,396]);
  assert.ok(old.every(t => t.fb.deleted && t.tex.deleted && (!t.rb || t.rb.deleted)));
  assert.equal(g.targets.length,6);
  f.canvas.clientHeight = f.canvas.clientWidth = 0;
  renderer.resize();
  assert.deepEqual([renderer.width,renderer.height],[1,1]);
});

test('reduced-motion camera switches immediately and sustained frame pressure lowers resolution', () => {
  const g = recordingGL(), renderer = fixture(g.gl,{reduced:true}).create();
  renderer.targetView = 1;
  renderer.pointer = 1;
  renderer.render(deps.battle.create(),0,0,1/60);
  assert.equal(renderer.view,1);
  assert.equal(renderer.drift,0);
  const cap = renderer.pixelRatio;
  for (let i=0; i<600; i++) renderer.sampleFrame(1/30);
  assert.ok(renderer.pixelRatio >= .75 && renderer.pixelRatio < cap);
  const low = renderer.pixelRatio;
  renderer.sampleFrame(5);
  assert.equal(renderer.pixelRatio,low);
  for (let i=0; i<2600; i++) renderer.sampleFrame(1/144);
  assert.ok(renderer.pixelRatio > low && renderer.pixelRatio <= cap);
});

test('missing contexts and rejected shaders or links produce catchable initialization errors', () => {
  assert.throws(fixture(null).create,/WebGL is unavailable/);
  const badShader=recordingGL({failShader:true}), badLink=recordingGL({failLink:true});
  assert.throws(fixture(badShader.gl).create,/compilation failure/);
  assert.throws(fixture(badLink.gl).create,/link failure/);
  assert.ok(badShader.shaders.every(s => s.deleted));
  assert.ok(badLink.shaders.every(s => s.deleted) && badLink.programs.every(p => p.deleted));
});

test('an incomplete framebuffer is reported before drawing a partial frame', () => {
  const g = recordingGL({failTarget:true}), renderer = fixture(g.gl).create();
  assert.throws(() => renderer.render(deps.battle.create(),0,0,1/60),/framebuffer unavailable/);
  assert.equal(g.draws.length,deps.battle.CARDS.length); // Only the one-off portraits.
});

test('drill landmarks, paired scouts and a live repair tether draw from cached meshes in both cameras', () => {
  const g = recordingGL(), renderer = fixture(g.gl,{reduced:true}).create(), B = deps.battle;
  const s = B.create({mode:'escort',ai:false,deck:['tender','splitpin','ram','wasp']});
  B.deploy(s,0,0,'splitpin');
  const tender = B.deploy(s,0,0,'tender').unit;
  const carrier = deps.drills.subject(s);
  carrier.hp -= 50;
  tender.cooldown = 0;
  B.tick(s);
  assert.equal(s.repaired[0],24);
  const uploadCount = g.uploads.length;
  const before = JSON.stringify(s);
  for (const view of [0,1]) {
    const index = g.draws.length;
    renderer.targetView = view;
    renderer.render(s,0,.5,1/60);
    const frame = g.draws.slice(index);
    for (const [name, count] of [['gate',1],['carrier0',1],['splitpin0',2],['tender0',1],['beam',1]]) {
      assert.equal(frame.filter(d => d.buffer === renderer.meshes[name].buf).length,count, name);
    }
    assert.equal(frame.at(-1).framebuffer,null);
  }
  assert.equal(JSON.stringify(s),before);
  const watch = B.create({mode:'watch'}), relay = deps.drills.subject(watch), marks = [];
  const spot = renderer.spot.bind(renderer);
  renderer.spot = (...args) => { marks.push(args); spot(...args); };
  renderer.render(watch,0,1,1/60);
  assert.ok(marks.some(([center,,,,,kind]) => center[0] === relay.x && center[2] === relay.z && kind === 4));
  assert.equal(g.uploads.length,uploadCount);
  renderer.dispose();
  assert.ok(g.uploads.every(b => b.deleted));
});

test('a legal hover draws the twin holograms before composition and suppresses them on cooldown or pause', () => {
  const g = recordingGL(), renderer = fixture(g.gl).create(), B = deps.battle;
  const s = B.create({deck:['splitpin','ram','wasp','mortar'],ai:false,opening:false});
  renderer.hover = 1;
  renderer.previewCard = 'splitpin';
  const uploadCount = g.uploads.length, buffer = renderer.meshes.splitpin0.buf;
  function drawsOfPair() {
    const index = g.draws.length;
    renderer.render(s,0,1,1/60);
    assert.equal(g.draws.at(-1).framebuffer,null);
    return g.draws.slice(index).filter(d => d.buffer === buffer).length;
  }
  const before = JSON.stringify(s);
  assert.equal(drawsOfPair(),2);
  assert.equal(JSON.stringify(s),before);
  B.pause(s);
  assert.equal(drawsOfPair(),0);
  B.pause(s);
  renderer.hover = null;
  assert.equal(drawsOfPair(),0);
  renderer.hover = 1;
  B.deploy(s,0,1,'splitpin');
  assert.equal(drawsOfPair(),2); // The two real scouts only, both slots now locked.
  assert.equal(g.uploads.length,uploadCount);
});

test('freight carts interpolate on their rails and coil previews share the actual placement geometry', () => {
  const g = recordingGL(), renderer = fixture(g.gl,{reduced:true}).create(), B = deps.battle, C = deps.coils;
  const s = B.create({mode:'freight',ai:false});
  B.deploy(s,0,1,'strider');
  Object.assign(s.objective.carts[0],{prevX:-1.2, x:.8, escorts:[1,0]});
  const poses = [], draw = renderer.draw.bind(renderer);
  renderer.draw = (name, matrix, ...args) => {
    if (matrix) poses.push({name,x:matrix[12],y:matrix[13],z:matrix[14]});
    draw(name,matrix,...args);
  };
  const uploadCount = g.uploads.length;
  renderer.hover = 0;
  renderer.previewSocket = 2;
  const before = JSON.stringify(s);
  for (const view of [0,1]) {
    poses.length = 0;
    renderer.targetView = view;
    renderer.render(s,0,.25,1/60);
    assert.equal(poses.filter(p => p.name === 'freight-track').length,2);
    const carts = poses.filter(p => p.name === 'freight-cart');
    assert.equal(carts.length,2);
    assert.ok(Math.abs(carts[0].x + .7) < 1e-6);
    assert.ok(Math.abs(carts[0].z - B.freightRailZ(0)) < 1e-6);
    assert.ok(!poses.some(p => p.name === 'cache'));
    const coils = poses.filter(p => p.name === 'coil');
    assert.equal(coils.length,1);
    assert.ok(Math.abs(coils[0].x - C.SOCKETS[2]) < 1e-6);
    assert.ok(Math.abs(coils[0].z - B.LANES[0]) < 1e-6);
    const [x,y] = renderer.project(C.SOCKETS[2],.16,B.LANES[0]);
    const site = renderer.siteAt(2*x-1,1-2*y);
    assert.equal(site.lane,0);
    assert.equal(site.socket,2);
  }
  assert.equal(JSON.stringify(s),before);
  renderer.targetView = 0;
  renderer.render(s,0,1,1/60);
  const [u,v] = renderer.project(-2.1,.16,B.LANES[0]), cursor = [2*u-1,1-2*v];
  renderer.render(s,0,1,1/60,cursor);
  assert.equal(renderer.previewSocket,0);
  renderer.targetView = 1;
  renderer.render(s,0,1,1/60,cursor);
  assert.equal(renderer.previewSocket,1);
  B.placeCoil(s,0,0,2);
  poses.length = 0;
  renderer.render(s,0,1,1/60);
  assert.equal(poses.filter(p => p.name === 'coil').length,1, 'recharge suppresses a second ghost');
  assert.equal(g.uploads.length,uploadCount);
  assert.equal(g.draws.at(-1).framebuffer,null);
  renderer.dispose();
  assert.ok(g.uploads.every(buf => buf.deleted));
});

test('projectile heads and trails sample the same sub-tick flight between simulation updates', () => {
  const renderer = fixture(recordingGL().gl).create(), B = deps.battle, s = B.create();
  const shot = {type:'pulse',age:.25,duration:.5,x:-2,y:1,z:2,tx:2,ty:1,tz:2,team:0};
  s.shots = [shot];
  const head = [], beam = [], spot = renderer.spot.bind(renderer), draw = renderer.draw.bind(renderer);
  renderer.spot = (point, rx, ry, ...other) => {
    if (rx === .34 && ry === .34) head.push(point[0]);
    spot(point,rx,ry,...other);
  };
  renderer.draw = (name, pose, ...other) => {
    if (name === 'beam') beam.push(pose[12] + pose[4]/2);
    draw(name,pose,...other);
  };
  for (const alpha of [0,.5,1]) renderer.render(s,0,alpha,1/60);
  assert.ok(head[0] < head[1] && head[1] < head[2]);
  for (let i=0; i<3; i++) assert.ok(Math.abs(head[i] - beam[i]) < 1e-6);
  assert.equal(shot.age,.25);
});
