'use strict';
const {before, test} = require('node:test');
const assert = require('node:assert/strict');
const {createPage} = require('./support/page.cjs');

let page, renderer, canvas, gl, L, G;
before(() => {
  page = createPage({rendererOnly: true, dpr: 3});
  gl = page.gl;
  canvas = page.byId('scene');
  renderer = new page.context.CupRenderer(canvas);
  L = page.context.CupLesson;
  G = page.context.CupMeshes;
});

function render(time, exterior = false, s = L.scene(time), trace = false) {
  const view = L.camera(exterior ? -0.8 : s.yaw, exterior ? 0.31 : s.pitch, 1);
  renderer.render(view,s,exterior,time,trace);
  const names = new Map(Object.entries(renderer.buffers).map(([k,b]) => [b.i,k]));
  return Object.fromEntries(gl.draws.map(d => [names.get(d.indices),d]));
}

function declarations(source, storage) {
  const entries = [];
  const pattern = /\b(attribute|uniform|varying)\s+(?:(lowp|mediump|highp)\s+)?(\w+)\s+([^;]+);/g;
  for (const [,kind,precision,type,names] of source.matchAll(pattern)) {
    if (kind !== storage) continue;
    const base = type==='int' ? 'int' : 'float';
    const inherited = source.match(new RegExp('precision (\\w+) ' + base + ';'))[1];
    for (const name of names.split(',')) entries.push([name.trim(),[type,precision || inherited]]);
  }
  return new Map(entries);
}

test('both precision variants have balanced GLSL ES 1.00 sources and matching link interfaces', () => {
  const failLink = createPage({rendererOnly: true, medium: true, failLink: true});
  assert.throws(() => new failLink.context.CupRenderer(failLink.byId('scene')),/link failure/);
  for (const [graphics, precision] of [[gl,'highp'],[failLink.gl,'mediump']]) {
    const [vert,frag] = graphics.shaders.map(s => s.source);
    for (const source of [vert,frag]) {
      assert.match(source,new RegExp('precision ' + precision + ' float;'));
      assert.equal([...source.matchAll(/\bvoid\s+main\s*\(\s*\)\s*\{/g)].length,1);
      const brackets = [];
      for (const char of source) {
        if ('({['.includes(char)) brackets.push(char);
        if (')}]'.includes(char)) assert.equal(brackets.pop(),{')':'(', '}':'{', ']':'['}[char]);
      }
      assert.equal(brackets.length,0);
      assert.doesNotMatch(source,/\b(asm|class|union|enum|typedef|template|namespace|using|cast|sizeof|input|output|partition|superp|packed|row_major)\b/);
      assert.doesNotMatch(source,/\b(NaN|undefined|Infinity)\b|#version\s+300/);
    }
    assert.match(vert,/\bgl_Position\s*=/);
    assert.match(frag,/\bgl_FragColor\s*=/);
    assert.match(frag,/\btexture2D\s*\(/);
    const varyings = declarations(vert,'varying');
    assert.deepEqual(declarations(frag,'varying'),varyings);
    assert.ok(varyings.size <= 8);
    assert.ok(declarations(vert,'attribute').size <= 8);
    const shared = declarations(vert,'uniform');
    for (const [name,type] of declarations(frag,'uniform')) {
      if (shared.has(name)) assert.deepEqual(type,shared.get(name),name);
    }
  }
});

test('the printed wrapper is a local power-of-two texture with mipmaps and a repeating seam', () => {
  const tex = gl.texture, c = tex.image;
  for (const dimension of [c.width,c.height]) assert.ok(dimension>0 && (dimension & (dimension-1))===0);
  assert.ok(c.ink.text.includes('CURL') && c.ink.text.includes('CLUB'));
  assert.equal(c.ink.stackDepth,0);
  assert.equal(tex[gl.TEXTURE_WRAP_S],gl.REPEAT);
  assert.equal(tex[gl.TEXTURE_WRAP_T],gl.CLAMP_TO_EDGE);
  assert.equal(tex[gl.TEXTURE_MIN_FILTER],gl.LINEAR_MIPMAP_LINEAR);
  assert.ok(tex.mipmaps);
  assert.equal(gl.textureUploads,1);
});

test('the renderer draws the cut edges or the missing sleeve panels for each view', () => {
  const cut = render(0), exterior = render(0,true);
  for (const name of ['base','shell','lining','lip','lid','noodles','toppings','shadow']) {
    assert.ok(cut[name] && exterior[name],name);
  }
  assert.ok(cut.edges && !exterior.edges);
  for (const name of ['completeShell','completeLining','completeLip']) {
    assert.ok(!cut[name] && exterior[name],name);
  }
  assert.equal(cut.noodles.uniforms.uSoft,0);
  assert.ok(!cut.water && !cut.seep && !cut.steam);
  assert.deepEqual(gl.clearRGBA,[0,0,0,0]);
  assert.ok(gl.enabled.has(gl.DEPTH_TEST));
});

test('the lift, seat highlight and floor flex are applied to the intended meshes', () => {
  let draw = render(11);
  assert.ok(draw.noodles.uniforms.uModel[13] > 0.34);
  assert.deepEqual(draw.noodles.uniforms.uModel,draw.toppings.uniforms.uModel);
  assert.equal(draw.shell.uniforms.uModel[13],0);
  assert.equal(draw.lining.uniforms.uSeat,1);
  draw = render(18);
  assert.ok(draw.base.uniforms.uFlex>0.01);
  assert.equal(draw.noodles.uniforms.uFlex,0);
  assert.deepEqual(draw.shell.uniforms.uModel,draw.noodles.uniforms.uModel);
});

test('pouring, trickling, immersion and relaxation reach the GPU at the right times', () => {
  const first = render(27);
  assert.ok(first.stream && first.seep && first.water && !first.steam);
  assert.ok(first.seep.uniforms.uModel[5]>0 && first.seep.uniforms.uModel[13]>G.FLOOR);
  assert.equal(first.water.uniforms.uWater,L.scene(27).water);
  const last = render(45);
  assert.ok(last.steam && last.water && !last.seep && !last.stream);
  assert.equal(last.noodles.uniforms.uSoft,1);
  assert.equal(last.toppings.uniforms.uSoft,1);
  const food = renderer.buffers.noodles;
  assert.equal(food.pose.data.length/6,food.v.data.length/G.STRIDE);
});

test('transparent passes preserve opaque depth and restore write state each frame', () => {
  for (const time of [27,33,41]) {
    const draws = render(time);
    for (const [name,call] of Object.entries(draws)) {
      const transparent = ['shadow','water','stream','seep','steam'].includes(name);
      assert.equal(call.blended,transparent,name);
      assert.equal(call.depthWrite,!transparent,name);
      if (name!=='shadow') assert.ok(call.culled);
    }
    assert.ok(gl.depthWrite && !gl.enabled.has(gl.BLEND));
    assert.ok(gl.draws.indexOf(draws.water) > gl.draws.indexOf(draws.noodles));
  }
});

test('the pour enters from above the frame and lands first on the cake and then on the pool', () => {
  for (const t of [27,33]) {
    const s = L.scene(t), draw = render(t);
    const matrix = draw.stream.uniforms.uModel, math = page.context.CupMath;
    for (const [localY,worldY] of [[0,Math.max(G.BLOCK_TOP+0.06,s.surfaceY)],[1,10.8]]) {
      const point = math.transform(matrix,[0,localY,0]);
      const expected = L.pourPosition(s,worldY);
      assert.ok(expected.every((v,i) => Math.abs(v-point[i])<1e-5));
      if (localY===1) assert.ok(renderer.screen(point)[1]<0);
      else assert.ok(Math.hypot(point[0],point[2])<G.radiusAt(point[1])-G.WALL);
    }
  }
});

test('all five camera presets frame the complete cup and lid at desktop and phone sizes', () => {
  for (const [w,h] of [[850,468],[320,327],[260,320]]) {
    Object.assign(canvas,{clientWidth:w,clientHeight:h});
    for (const {start} of L.steps) {
      for (const exterior of [false,true]) {
        render(start,exterior);
        for (const name of ['lid','lip','base','noodles']) {
          const data = renderer.buffers[name].v.data;
          for (let i=0; i<data.length; i+=G.STRIDE*4) {
            const [x,y,z] = renderer.screen(data.subarray(i,i+3),name==='noodles');
            assert.ok(x>4 && x<w-4 && y>4 && y<h-4 && z>-1 && z<1,name+' at '+w+'px and '+start+'s');
          }
        }
      }
    }
  }
  Object.assign(canvas,{clientWidth:800,clientHeight:440});
  render(0);
});

test('the attached noodle label uses the same interpolated pose and model matrix as the shader', () => {
  for (const time of [0,11,18,39,45]) {
    render(time);
    const s = L.scene(time), {dry,wet} = renderer.anchor;
    const point = Array.from(dry,(value,i) => value*(1-s.soft)+wet[i]*s.soft);
    const expected = renderer.screen(point,true);
    renderer.strandScreen(s.soft).forEach((v,i) => assert.ok(Math.abs(v-expected[i])<0.0001));
  }
});

test('animation uses static buffer uploads, bounded draw calls and capped device pixel density', () => {
  const uploads = gl.uploads, textures = gl.textureUploads;
  for (let t=0; t<=45; t+=0.25) {
    render(t,Math.floor(t)%2===0);
    assert.ok(gl.draws.length <= 16);
    assert.ok(gl.draws.reduce((sum,d) => sum+d.count/3,0) < 115000);
  }
  assert.deepEqual(gl.viewportArgs,[0,0,Math.round(canvas.clientWidth*1.8),Math.round(canvas.clientHeight*1.8)]);
  assert.equal(gl.uploads,uploads);
  assert.equal(gl.textureUploads,textures);
  assert.equal(gl.pointers.get(gl.attributes.get('aUV')).offset,36);
});

test('a zero-sized stage skips its draw and resizes correctly when space becomes available', () => {
  canvas.clientWidth = 0;
  const last = gl.draws;
  render(20);
  assert.equal(gl.draws,last);
  canvas.clientWidth = 612;
  render(20);
  assert.equal(renderer.width,612);
  assert.equal(canvas.width,Math.round(612*1.8));
});

test('resizing the test block moves the food and contact line while the cup stays fixed', () => {
  const P=page.context.CupPacking, M=page.context.CupMath;
  const profile=renderer.dryProfile, uploads=gl.uploads, textures=gl.textureUploads;
  const sleeve=render(0).shell.uniforms.uModel;
  for (const diameter of [94,72,88,76,77,94]) {
    const fit=P.fit(profile,diameter), s={...L.scene(0),fit};
    const calls=render(0,false,s,true), matrix=calls.noodles.uniforms.uModel;
    assert.deepEqual(calls.shell.uniforms.uModel,sleeve);
    assert.deepEqual(matrix,calls.toppings.uniforms.uModel);
    assert.equal(calls.noodles.uniforms.uSoft,0);
    assert.equal(calls.noodles.uniforms.uTrace,0);
    assert.ok(!calls.water && !calls.steam);
    const [x,y,z]=M.transform(matrix,profile.contact);
    assert.ok(Math.abs(y-fit.contactY)<1e-6);
    assert.ok(Math.abs(Math.atan2(x,z)-(G.EDGE_R+0.015))<1e-6);
    assert.equal(calls.lining.uniforms.uSeat,Number(!fit.onFloor));
    assert.equal(calls.lining.uniforms.uSeatY,fit.contactY);
    assert.equal(calls.lining.uniforms.uUnderside,fit.bottom);
    if (!fit.onFloor) assert.ok(Math.abs(Math.hypot(x,z)-(G.radiusAt(y)-G.WALL))<1e-6);
    assert.equal(calls.noodles.uniforms.uModel[5],Math.fround(fit.scale));
    assert.ok(Math.abs(M.transform(matrix,[0,profile.bottom,0])[1]-fit.bottom)<1e-6);
  }
  assert.equal(gl.uploads,uploads);
  assert.equal(gl.textureUploads,textures);
});

test('immersion tracing shades noodle fragments against the drawn mean surface and leaves toppings visible', () => {
  const uploads=gl.uploads, profile=renderer.dryProfile;
  for (const [time,enabled,expect] of [[18,true,0],[25,true,1],[30,false,0],[30,true,1],[45,true,1],[0,false,0]]) {
    const s=L.scene(time,profile), calls=render(time,false,s,enabled);
    assert.equal(calls.noodles.uniforms.uTrace,expect);
    assert.equal(calls.toppings.uniforms.uTrace,0);
    if (calls.water) {
      assert.equal(calls.water.uniforms.uTrace,expect);
      assert.equal(calls.water.uniforms.uWater,calls.noodles.uniforms.uWater);
      assert.ok(calls.water.blended && !calls.water.depthWrite);
    }
    assert.equal(gl.draws.length,Object.keys(calls).length);
  }
  const [vert,frag]=gl.shaders.map(shader=>shader.source);
  assert.match(vert,/\(1\.0-uTrace\)\*top/);
  assert.match(frag,/uWater-vPosition\.y/);
  assert.match(frag,/smoothstep\(-0\.008,0\.008,depth\)/);
  assert.equal(gl.uploads,uploads);
});

test('the scan sheet and strand highlight use the measured plane in cup coordinates', () => {
  const P=page.context.CupPacking, S=page.context.CupSlices, fit=P.fit(renderer.dryProfile,88);
  const mesh={vertices:renderer.buffers.noodles.v.data,indices:renderer.buffers.noodles.i.data};
  const uploads=gl.uploads, textures=gl.textureUploads;
  for (const height of [0,17,51,100,51]) {
    const scan=S.scan(mesh,fit,height);
    const calls=render(0,false,{...L.scene(0),fit,scan});
    assert.ok(calls.sheet && !calls.toppings && !calls.water);
    for (const name of ['sheet','noodles','shell','lining']) assert.equal(calls[name].uniforms.uScanY,scan.height);
    assert.ok(calls.sheet.blended && !calls.sheet.depthWrite && !calls.sheet.culled);
    assert.equal(calls.sheet.uniforms.uMaterial,8);
    assert.ok(gl.draws.indexOf(calls.sheet)>gl.draws.indexOf(calls.noodles));
    const m=calls.sheet.uniforms.uModel;
    for (const index of [0,10]) assert.equal(m[index],Math.fround(scan.radius));
    assert.equal(m[13],Math.fround(scan.height));
    assert.equal(calls.noodles.uniforms.uModel[5],Math.fround(fit.scale));
    assert.ok(gl.depthWrite && !gl.enabled.has(gl.BLEND));
  }
  const plain=render(0);
  assert.ok(!plain.sheet && plain.toppings && plain.noodles.uniforms.uScanY===-1);
  assert.equal(gl.uploads,uploads); assert.equal(gl.textureUploads,textures);
  const frag=gl.shaders[1].source;
  assert.match(frag,/abs\(vPosition\.y-uScanY\)/);
});

test('the metered surface rises from the floor, stays flat at first contact and clears on exit', () => {
  const P=page.context.CupPacking, uploads=gl.uploads;
  for (const [width,amount] of [[72,100],[88,0],[88,1],[94,50],[77,1000],[94,1000]]) {
    const fit=P.fit(renderer.dryProfile,width), meter=P.meteredPour(fit,amount);
    const scene={...L.scene(0),fit,meter,surfaceY:meter.surfaceY,water:meter.surfaceY-G.FLOOR};
    const draws=render(0,false,scene,true);
    assert.equal(Boolean(draws.water),meter.amountML>0);
    assert.ok(!draws.stream && !draws.seep && !draws.steam && !draws.sheet);
    assert.equal(draws.noodles.uniforms.uTrace,0);
    if (draws.water) {
      const u=draws.water.uniforms;
      assert.equal(u.uRipple,0);
      assert.equal(u.uWaterBase,G.FLOOR);
      assert.ok(Math.abs(u.uWaterBase+u.uWater-meter.surfaceY)<1e-9);
      assert.ok(u.uWaterBase+u.uWater<=fit.bottom+1e-9);
      assert.ok(draws.water.blended && !draws.water.depthWrite);
    }
  }
  const lesson=render(30).water.uniforms;
  assert.equal(lesson.uRipple,1); assert.equal(lesson.uWaterBase,L.poolBase);
  assert.equal(gl.uploads,uploads);
});
