'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePage } = require('./support/page.js');
const { RecordingGL } = require('./support/recording-gl.js');
const { STRIDE, PART, STRAP_RAIL } = require('../js/mesh.js');
const { BLADE } = require('../js/weather.js');
const P = require('../js/passengers.js');
const R = require('../js/ride.js');
const M = require('../js/math.js');
const C = require('../js/camera.js');
const G = require('../js/signals.js');
const shuttle = require('../js/shuttle.js');
const limits = require('../js/line-speed.js');
const daylight = require('../js/daylight.js');

let initial;
function openingFrame() {
  if(!initial) {
    const gl=new RecordingGL(), page=makePage({gl,capture:false});
    page.run();
    assert.equal(page.id('scene-error').hidden,true);
    initial={gl,page,draws:gl.draws.slice()};
  }
  return initial;
}
function declarations(src,kind) {
  const declarations={};
  const lines=new RegExp('\\b'+kind+'\\s+(?:(lowp|mediump|highp)\\s+)?(float|vec[234]|mat4|sampler2D)\\s+([^;]+);','g');
  for(const [,precision,type,names] of src.matchAll(lines)) {
    for(const name of names.split(',').map(s=>s.trim().replace(/\[\d+\]$/, '[0]'))) declarations[name]=[precision||'',type].join(' ').trim();
  }
  return declarations;
}
test('real shaders expose matching WebGL 1 interfaces and use every bound attribute and uniform', () => {
  const {gl}=openingFrame();
  const vertex=gl.shaders.find(s=>s.type===gl.VERTEX_SHADER).source;
  const fragment=gl.shaders.find(s=>s.type===gl.FRAGMENT_SHADER).source;
  for(const source of [vertex,fragment]) {
    assert.equal((source.match(/void\s+main\s*\(\s*\)/g)||[]).length,1);
    const stack=[];
    for(const char of source) {
      if('({['.includes(char)) stack.push(char);
      if(')}]'.includes(char)) assert.equal(stack.pop(),{')':'(','}':'{',']':'['}[char]);
    }
    assert.equal(stack.length,0); assert.doesNotMatch(source,/\b(undefined|NaN)\b/);
  }
  assert.match(vertex,/gl_Position\s*=/); assert.match(fragment,/gl_FragColor\s*=/);
  assert.match(fragment,/precision mediump float/); assert.match(fragment,/texture2D\s*\(/);
  assert.deepEqual(declarations(vertex,'varying'),declarations(fragment,'varying'));
  assert.ok(Object.keys(declarations(vertex,'varying')).length<=8);
  const attrs=declarations(vertex,'attribute');
  assert.deepEqual([...gl.locations.keys()].sort(),Object.keys(attrs).sort());
  for(const [name,location] of gl.locations) {
    const a=gl.pointers.get(location), type=attrs[name];
    assert.equal(a.size,type==='float'?1:Number(type.at(-1)));
    assert.equal(a.stride,STRIDE*4);
    assert.ok(vertex.indexOf(name)!==vertex.lastIndexOf(name));
  }
  const uniforms={...declarations(vertex,'uniform'),...declarations(fragment,'uniform')};
  assert.deepEqual(Object.keys(gl.uniforms).sort(),Object.keys(uniforms).sort());
  assert.equal(gl.uniforms.uAtlas,0);
});
test('the local power-of-two atlas covers every material, all station names and original platform posters', () => {
  const {page,gl,draws}=openingFrame();
  assert.equal(page.contextRequests[0].kind,'webgl'); assert.equal(page.contextRequests[0].options.alpha,false);
  assert.deepEqual([gl.texture.width,gl.texture.height,gl.texture.mipmaps],[2048,2048,true]);
  assert.equal(gl.parameters.get(gl.TEXTURE_MIN_FILTER),gl.LINEAR_MIPMAP_LINEAR);
  const ids=page.tiles.map(t=>{
    assert.equal(t.width,512); assert.equal(t.height,256);
    return t.y/256*4+t.x/512;
  });
  assert.equal(new Set(ids).size,ids.length);
  for(let i=0;i<32;i++) assert.ok(ids.includes(i),'tile '+i);
  for(const call of draws) for(let i=12;i<call.verts.length;i+=STRIDE) {
    if(!ids.includes(call.verts[i])) assert.fail('scene refers to an unpainted tile');
  }
  R.STATIONS.forEach(s=>{ assert.ok(page.lettering.includes(s.chinese)); assert.ok(page.lettering.includes(s.name)); });
  assert.ok(page.lettering.includes('NIGHT COURT')); assert.ok(page.lettering.includes('TOAST'));
  assert.ok(new Set(page.grain).size>=8);
});
test('opaque surfaces fill depth before glass, with bounded draw calls and framebuffer size', () => {
  const {gl,draws,page}=openingFrame();
  const firstGlass=draws.findIndex(d=>d.glass);
  assert.ok(firstGlass>0 && firstGlass<draws.length);
  assert.ok(draws.slice(0,firstGlass).every(d=>d.depthWrite && !d.glass));
  assert.ok(draws.slice(firstGlass).every(d=>!d.depthWrite && d.glass));
  assert.deepEqual(gl.blend,[gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA]);
  assert.ok(gl.depthWrite && !gl.enabled.has(gl.BLEND));
  assert.ok(draws.length<=30 && draws.length>=16);
  assert.ok(draws.reduce((sum,d)=>sum+d.indices.length/3,0)<60000);
  assert.deepEqual(gl.viewportRect,[0,0,page.scene.width,page.scene.height]);
  assert.equal(draws.filter(d=>d.state.uCab===1).length,2);
});

function gripPosition(x, y, z, hingeZ, swing) {
  const pivotX = Math.sign(x) * STRAP_RAIL.x;
  const dx = x - pivotX, dy = y - STRAP_RAIL.y, dz = z - hingeZ;
  const [c, s, cf, sf] = swing;
  const raised = cf * dy + sf * dz;
  return [pivotX + c * dx - s * raised, STRAP_RAIL.y + s * dx + c * raised, hingeZ - sf * dy + cf * dz];
}

// Apply the recorded vertex uniforms before testing sight lines to moving parts.
function poseMesh(v, state) {
  if (!state.uCab && v[16] < PART.RIDER) return v;
  const moved = v.slice(), angle = state.uBladeAngle;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  for (let i = 0; i < v.length; i += STRIDE) {
    const part = v[i + 16];
    if (part === PART.WIPER) {
      const x = v[i] - BLADE.x, y = v[i + 1] - BLADE.y;
      moved[i] = BLADE.x + x*cos + y*sin;
      moved[i + 1] = BLADE.y - x*sin + y*cos;
    } else if (part === PART.STRAP) {
      moved.set(gripPosition(v[i],v[i+1],v[i+2],v[i+15],state.uSwing),i);
    } else if (part >= PART.RIDER) {
      const slot = part - PART.RIDER, k = slot * 4, pose = state['uRiders[0]'];
      const gait = pose[k + 3], visible = gait ? 1 : 0;
      const turn = slot === P.MAX_WAITING ? -1 : 1;
      const t = M.clamp((v[i + 1] - 0.08) / 0.70, 0, 1);
      const stride = (gait - 1) * Math.sign(v[i + 2]) * 0.20 * (1 - t*t*(3-2*t));
      moved[i] = pose[k] + visible * turn * (v[i] + stride);
      moved[i + 1] = pose[k + 1] + visible * v[i + 1];
      moved[i + 2] = pose[k + 2] + visible * turn * v[i + 2];
    }
  }
  return moved;
}

// A ray query over the uploaded triangles checks actual visibility, including occlusion by the cab.
function rayHit(draws, target, includeGlass=false) {
  const eye=draws[0].state.uEye, direction=M.normalize(M.subtract(target,eye));
  let best=Infinity, result=null;
  for(const {state,verts,indices,glass} of draws) {
    if(glass && !includeGlass) continue;
    const v = poseMesh(verts, state);
    const [c,s]=state.uRotation;
    const unturn=([x,y,z])=>[c*x+s*z,y,-s*x+c*z];
    const [ox,oy,oz]=unturn(M.subtract(eye,state.uOrigin));
    const [dx,dy,dz]=unturn(direction);
    for(let i=0;i<indices.length;i+=3) {
      const a=indices[i]*STRIDE,b=indices[i+1]*STRIDE,e=indices[i+2]*STRIDE;
      const az=v[a+2]+v[a+14]*state.uDoor, ex=v[b]-v[a],ey=v[b+1]-v[a+1],ez=v[b+2]+v[b+14]*state.uDoor-az;
      const fx=v[e]-v[a],fy=v[e+1]-v[a+1],fz=v[e+2]+v[e+14]*state.uDoor-az;
      const px=dy*fz-dz*fy,py=dz*fx-dx*fz,pz=dx*fy-dy*fx;
      const det=ex*px+ey*py+ez*pz;
      if(Math.abs(det)<1e-9) continue;
      const tx=ox-v[a],ty=oy-v[a+1],tz=oz-az, u=(tx*px+ty*py+tz*pz)/det;
      if(u<0||u>1) continue;
      const qx=ty*ez-tz*ey,qy=tz*ex-tx*ez,qz=tx*ey-ty*ex;
      const w=(dx*qx+dy*qy+dz*qz)/det;
      if(w<0||u+w>1) continue;
      const t=(fx*qx+fy*qy+fz*qz)/det;
      // The sky shader pins its depth to the far plane regardless of cube size.
      const distance = state.uSky ? Infinity : t;
      if(t>0.045 && (!result || distance<best)) {
        best=distance; result={tile:v[a+12],color:Array.from(v.subarray(a+6,a+9),n=>Math.round(n*255)),
          cab:Boolean(state.uCab),sky:Boolean(state.uSky),distance,glass,part:v[a+16]};
      }
    }
  }
  return result;
}
function screenPoint(draws,point) {
  const matrix=draws[0].state.uViewProjection,p=[...point,1];
  const clip=[0,1,2,3].map(r=>p.reduce((v,n,k)=>v+n*matrix[k*4+r],0));
  assert.ok(clip[3]>0,'point is in front of camera');
  return clip.slice(0,3).map(x=>x/clip[3]);
}
test('the opening shot can see the station mosaic, hanging platform sign, track and onboard screen', () => {
  const {draws}=openingFrame();
  const sightings=[
    {point:[-3.183,2.51,-7],tile:8,cab:false},
    {point:[2.10,4.24,-7.644],tile:13,cab:false},
    {point:[0.755,0.363,-10],tile:0,cab:false},
    {point:[-0.72,1.66+(1.38-0.58)*0.295/1.02+0.009,-1.38],tile:22,cab:true}
  ];
  for(const {point,tile,cab} of sightings) {
    assert.ok(screenPoint(draws,point).every(n=>n>=-1 && n<=1));
    const hit=rayHit(draws,point);
    assert.ok(hit); assert.equal(hit.tile,tile,'visible tile toward '+point); assert.equal(hit.cab,cab);
  }
});
function rendererFixture() {
  const gl=new RecordingGL(), page=makePage({gl,capture:false,app:false});
  // Atlas painting is exercised above. These tests need only its allocation.
  page.api.surfaces.makeAtlas=()=>({width:2048,height:2048});
  return {gl,page,renderer:page.api.renderer.createRenderer(page.scene),s:R.createRide(),c:C.createCamera()};
}
test('the passenger seat sees the information display and moving grips with two static texture atlases', () => {
  const { gl, page, renderer, s, c } = rendererFixture();
  C.setView(c, 'saloon'); C.advance(c, 5); renderer.render(s, c);
  const firstUploads = gl.uploads, draws = gl.draws.length;
  for (const x of [-1.03, 1.03]) for (const y of [2.85, 3.09]) {
    const corner = [x, y, 0.522];
    assert.ok(screenPoint(gl.draws, corner).every(n => Math.abs(n) < 1));
    assert.equal(rayHit(gl.draws, corner).part, PART.SALOON_SIGN);
  }
  assert.equal(gl.textureUploads, 2); assert.equal(gl.uniforms.uSaloonText, 1);
  const text = gl.textures.get(gl.TEXTURE0+1);
  assert.deepEqual([text.width,text.height,text.mipmaps],[512,512,true]);
  for (const stage of page.api.saloon.stages) {
    assert.ok(page.lettering.includes(stage.english)); assert.ok(page.lettering.includes(stage.chinese));
  }
  const hingeZ = 1.25, grip = [STRAP_RAIL.x, 2.66, hingeZ];
  assert.ok(screenPoint(gl.draws, grip).every(n => Math.abs(n) < 1));
  assert.equal(rayHit(gl.draws, grip).part, PART.STRAP);
  s.swing.side = -0.18; s.swing.rear = -0.20; s.phase = 'closing';
  renderer.render(s, c);
  const pose = gl.uniforms.uSwing, moved = gripPosition(...grip, hingeZ, pose);
  assert.ok(moved[0] < grip[0] && moved[2] < grip[2]);
  assert.equal(rayHit(gl.draws, moved).part, PART.STRAP);
  assert.notEqual(rayHit(gl.draws, grip).part, PART.STRAP);
  assert.deepEqual(gl.uniforms.uPassengerRows,[0, page.api.saloon.message(s).stage.row]);
  assert.equal(gl.uploads, firstUploads); assert.equal(gl.textureUploads, 2); assert.equal(gl.draws.length, draws);
});

test('a seat change on a curve moves the eye independently of the headlight sources and the station row', () => {
  const { gl, renderer, s, c } = rendererFixture();
  Object.assign(s, { position: 169, phase: 'running', berth: null });
  renderer.render(s, c);
  const origin = gl.uniforms.uLampOrigin, eye = gl.uniforms.uEye, uploads = gl.uploads;
  C.setView(c, 'saloon'); C.advance(c, 5); renderer.render(s, c);
  assert.deepEqual(gl.uniforms.uLampOrigin, origin);
  assert.ok(Math.hypot(...M.subtract(gl.uniforms.uEye, eye)) > 4);
  assert.deepEqual(gl.uniforms.uPassengerRows, [1,4]); assert.equal(gl.uploads, uploads);
  assert.equal(gl.textureUploads, 2);
  const fragment = gl.shaders.find(shader => shader.type === gl.FRAGMENT_SHADER).source;
  assert.match(fragment, /position\.xz-uLampOrigin/);
  assert.match(fragment, /texture2D\(uSaloonText,uv\)/);
});
test('the platform camera looks through both moving door windows and into the station when they part', () => {
  const {gl,renderer,s,c}=rendererFixture();
  C.setView(c,'platform'); C.advance(c,5); renderer.render(s,c);
  const point=[1.46,2.2,1.66];
  assert.ok(screenPoint(gl.draws,point).every(n=>Math.abs(n)<1));
  const closed=rayHit(gl.draws,point,true);
  assert.equal(closed.cab,true); assert.equal(closed.glass,true);
  assert.equal(rayHit(gl.draws.filter(d=>!d.state.uCab),point,true).glass,true);
  s.door=1; renderer.render(s,c);
  const open=rayHit(gl.draws,point,true);
  assert.equal(open.cab,false); assert.equal(open.glass,false); assert.ok(open.distance>closed.distance+2);
});
test('streaming reuses resident meshes, frees old buffers and stays local on distant laps', () => {
  const {gl,renderer,s,c}=rendererFixture();
  renderer.render(s,c); const initialUploads=gl.uploads;
  s.position=15.95; renderer.render(s,c); assert.equal(gl.uploads,initialUploads);
  s.position=16; renderer.render(s,c); assert.ok(gl.deletions>0 && gl.uploads<=initialUploads+4);
  for(const pos of [64,220,432,864,1800,2351.99,2352,2352*9000+615]) {
    s.position=pos; renderer.render(s,c);
    assert.ok(gl.buffers.size<=60);
    assert.ok(gl.draws.every(d=>Math.abs(d.state.uOrigin[2])<180));
    assert.ok(gl.draws[0].state.uViewProjection.every(Number.isFinite));
  }
});
test('only the berthed platform and carriage receive the eased door displacement', () => {
  const {gl,renderer,s,c}=rendererFixture();
  s.door=0.25; renderer.render(s,c);
  for(const d of gl.draws) {
    assert.equal(d.state.uDoor,d.state.uCab || d.state.uStation ? 0.15625 : 0);
  }
  s.berth=null; s.door=0; renderer.render(s,c); assert.ok(gl.draws.every(d=>d.state.uDoor===0));
});
test('idle preparation builds one upcoming section and hands it to the renderer at the boundary', () => {
  const {page,gl,renderer,s,c}=rendererFixture(), callbacks=new Map(), built=[];
  let id=0;
  page.win.requestIdleCallback=fn=>{ callbacks.set(++id,fn); return id; };
  page.win.cancelIdleCallback=key=>callbacks.delete(key);
  const build=page.api.world.buildChunk;
  page.api.world.buildChunk=i=>{ built.push(i); return build(i); };
  renderer.render(s,c); assert.equal(built.length,14); assert.equal(callbacks.size,1);
  const uploads=gl.uploads;
  const runIdle=time=>{
    const fn=[...callbacks.values()][0]; callbacks.clear(); fn({timeRemaining:()=>time});
  };
  runIdle(30); assert.equal(built.at(-1),11); assert.equal(gl.uploads,uploads);
  s.position=16; renderer.render(s,c); assert.equal(built.length,15); assert.ok(gl.uploads>uploads);
  runIdle(1); assert.equal(built.length,15);
  s.position=32; renderer.render(s,c); assert.equal(built.at(-1),12); assert.equal(callbacks.size,1);
  renderer.cancelPreparation(); assert.equal(callbacks.size,0);
});
test('the camera resizes for portrait, high-density and temporarily collapsed viewports', () => {
  const {gl,page,renderer,s,c}=rendererFixture();
  page.win.devicePixelRatio=4;
  for(const [w,h] of [[310,465],[3800,2100],[0,0]]) {
    page.scene.clientWidth=w; page.scene.clientHeight=h; renderer.render(s,c);
    assert.ok(page.scene.width>=1 && page.scene.height>=1);
    assert.ok(page.scene.width*page.scene.height<1653000);
    assert.ok(gl.draws[0].state.uViewProjection.every(Number.isFinite));
    if(w>0) assert.ok(Math.abs(page.scene.width/page.scene.height-w/h)<0.004);
  }
});

test('the windscreen has open sight lines to the sky and lit facades on the viaduct, and a roof in the tunnel', () => {
  const { gl, renderer, s, c } = rendererFixture();
  s.position = 190; renderer.render(s, c);
  assert.ok(gl.draws.length <= 30);
  const sky = gl.draws.filter(d => d.state.uSky);
  assert.equal(sky.length, 1); assert.equal(sky[0].glass, false);
  assert.equal(sky[0].indices.length, 36);
  assert.deepEqual(sky[0].state.uOrigin, sky[0].state.uEye);
  const eye = sky[0].state.uEye;
  const inView = (x, y) => {
    const point = [eye[0] + x * 20, eye[1] + y * 20, eye[2] - 20];
    assert.ok(screenPoint(gl.draws, point).every(n => Math.abs(n) < 1));
    return rayHit(gl.draws, point);
  };
  assert.ok(inView(0.18, 0.27).sky, 'clear sky above the forward track');
  const streets = [0.38, 0.58, 0.80, -0.35, -0.57].map(x => inView(x, 0.045));
  assert.ok(streets.some(hit => hit.tile === 29), 'a geometric apartment facade is visible through the glass');
  assert.ok(gl.draws.some(d => d.state.uOutdoor === 1));
  assert.ok(gl.draws.filter(d => d.state.uCab).every(d => d.state.uOutdoor === 1 && !d.state.uSky));
  s.position = 1040; renderer.render(s, c);
  assert.ok(gl.draws.every(d => !d.state.uSky && !d.state.uOutdoor));
  const tunnelEye = gl.draws[0].state.uEye;
  const roof = rayHit(gl.draws, [tunnelEye[0]+3, tunnelEye[1]+5.4, -20]);
  assert.ok(roof && !roof.sky && !roof.cab && roof.distance < 20);
});

test('both moonlit spans render from distant laps without new per-frame sky or city buffers', () => {
  const { gl, renderer, s, c } = rendererFixture();
  for (const span of R.VIADUCTS) {
    s.position = span.start + 33 + 9000 * R.LENGTH;
    renderer.render(s, c);
    assert.ok(gl.draws.some(d => d.state.uSky));
    assert.ok(gl.draws.some(d => d.state.uOutdoor));
    const count = gl.uploads;
    s.position += 1; renderer.render(s, c);
    assert.equal(gl.uploads, count);
    assert.ok(gl.draws.every(d => Math.abs(d.state.uOrigin[2]) < 180));
    assert.ok(gl.draws.reduce((total, d) => total + d.indices.length / 3, 0) < 60000);
  }
});

test('cab daylight fades at the portal while the tunnel and deck retain their own material lighting', () => {
  const { gl, renderer, s, c } = rendererFixture();
  for (const [position, light] of [[68,0], [74,0.15625], [80,0.5], [92,1], [320,0.5], [332,0]]) {
    s.position = position; renderer.render(s, c);
    assert.ok(gl.draws.filter(d => d.state.uCab).every(d => d.state.uOutdoor === light));
    for (const d of gl.draws.filter(d => !d.state.uCab && !d.state.uSky)) {
      const start = position - d.state.uOrigin[2];
      assert.equal(d.state.uOutdoor, R.viaductAt(start) ? 1 : 0);
    }
  }
});

test('the physical desk reads live speed and station from the ride, including the return to Kowloon Tong', () => {
  const { gl, renderer, s, c } = rendererFixture();
  renderer.render(s, c);
  const uploads = gl.uploads;
  for (const [speed, berth, last, digits, station] of [
    [0, 0, 0, 0, 0], [12.4, null, 0, 45, 1], [0, 1, 1, 0, 1], [80/3.6, null, 4, 80, 0]
  ]) {
    Object.assign(s, { speed, berth, last });
    renderer.render(s, c);
    const desk = gl.draws.find(d => d.state.uCab && !d.glass);
    assert.deepEqual(desk.state.uDisplay, [digits, station]);
    assert.equal(gl.uploads, uploads);
  }
  const fragment = gl.shaders.find(shader => shader.type === gl.FRAGMENT_SHADER).source;
  assert.match(fragment, /id == 22\.0\) base = cabDisplay/);
  assert.match(fragment, /vec2\(3\.0,7\.0\)\+glyph/);
});

test('the driver can sight the S board at all five berths and see the rooftop half-court from the front cab', () => {
  const { gl, renderer, s, c } = rendererFixture();
  for (const station of R.STATIONS) {
    s.position = station.at - 10; renderer.render(s, c);
    const point = [-2.435, 2.43, -9.998];
    assert.ok(screenPoint(gl.draws, point).every(n => Math.abs(n) < 1));
    assert.equal(rayHit(gl.draws, point).tile, 30);
  }
  s.position = 153; renderer.render(s, c);
  const point = [R.trackOffset(184) + 13.5, 0.48, s.position - 184];
  assert.ok(screenPoint(gl.draws, point).every(n => Math.abs(n) < 1));
  const court = rayHit(gl.draws, point);
  assert.deepEqual(court.color, [70,145,134]);
  assert.ok(Math.abs(court.distance - Math.hypot(...M.subtract(point, gl.draws[0].state.uEye))) < 0.1);
});

test('the complete loop stays inside the WebGL draw and residency budgets at every streaming boundary', t => {
  const { gl, renderer, s, c } = rendererFixture();
  let peakDraws = 0, peakTriangles = 0, peakBuffers = 0;
  for (let i = 0; i < R.LENGTH / R.CHUNK; i++) {
    s.position = i * R.CHUNK;
    const span = R.viaductAt(s.position);
    if (span) {
      // Include both counter-running cars as well as all streamed scenery.
      s.time = (span === R.VIADUCTS[0] ? 6 : 3) + (span.end + shuttle.BORE + 6 - s.position) / shuttle.SPEED;
    }
    renderer.render(s, c);
    if (span) assert.equal(shuttle.carsAt(s.position, s.time).length, 2);
    const triangles = gl.draws.reduce((sum, d) => sum + d.indices.length / 3, 0);
    assert.ok(gl.draws.length <= 30 && triangles < 60000 && gl.buffers.size <= 60);
    peakDraws = Math.max(peakDraws, gl.draws.length);
    peakTriangles = Math.max(peakTriangles, triangles);
    peakBuffers = Math.max(peakBuffers, gl.buffers.size);
    assert.equal(gl.depthWrite, true);
    assert.equal(gl.enabled.has(gl.BLEND), false);
  }
  t.diagnostic('Loop maxima: ' + peakDraws + ' draws, ' + peakTriangles + ' triangles, ' + peakBuffers + ' resident buffers.');
});

test('the cab sees the amber distant and the red home lenses, and the same mast clears without a mesh upload', () => {
  const { gl, renderer, s, c } = rendererFixture();
  R.command(s, 'signals'); s.target = 80;
  function sight(at, aspect) {
    renderer.render(s, c);
    const point = [R.trackOffset(at-0.008)-2.54, 2.24+aspect*0.365, s.position-at+0.008];
    assert.ok(screenPoint(gl.draws, point).every(v => Math.abs(v) < 1));
    assert.equal(rayHit(gl.draws, point).part, -(aspect+1));
    const origin = s.position - Math.floor(at/R.CHUNK)*R.CHUNK;
    const mast = gl.draws.find(d => d.state.uOrigin[2] === origin && !d.glass);
    assert.equal(mast.state.uAspect, aspect);
  }
  R.advance(s,11.5); sight(88,G.CAUTION);
  R.advance(s,17); assert.equal(s.position,206); sight(216,G.STOP);
  const uploads = gl.uploads;
  R.command(s,'brake'); R.advance(s,8);
  assert.equal(s.position,206); sight(216,G.CLEAR);
  assert.equal(gl.uploads, uploads);
  const vertex = gl.shaders.find(shader => shader.type === gl.VERTEX_SHADER).source;
  assert.match(vertex,/abs\(part\+1\.0\+uAspect\)/);
  assert.match(vertex,/vSurface\.y \*= lit/);
});

test('the passing shuttle is visible nose-first through the windscreen, then through the left window on both spans', () => {
  const { gl, renderer, s, c } = rendererFixture();
  for (const [i, span] of R.VIADUCTS.entries()) {
    const at = (span.end+span.start)/2 - 2 + 4321*R.LENGTH;
    s.time = (i ? 3 : 6) + (span.end + shuttle.BORE + 6 + 4321*R.LENGTH - at) / shuttle.SPEED;
    s.position = at-26; C.setView(c,'front'); C.advance(c,5); renderer.render(s,c);
    const [car] = shuttle.carsAt(s.position,s.time);
    function worldPoint(x,y,z) {
      return [car.x + x*car.cos - z*car.sin, y, s.position-car.at+x*car.sin+z*car.cos];
    }
    const sign = worldPoint(0.2,3.28,4.65);
    assert.ok(screenPoint(gl.draws,sign).every(n => Math.abs(n) < 1));
    assert.equal(rayHit(gl.draws,sign).tile,24);
    const lamp = worldPoint(1.02,1.83,5.056);
    assert.deepEqual(rayHit(gl.draws,lamp).color,[255,237,199]);
    s.position = at-2; C.setView(c,'left'); C.advance(c,5); renderer.render(s,c);
    const pane = worldPoint(1.428,2.62,1.27), uploads = gl.uploads;
    assert.ok(screenPoint(gl.draws,pane).every(n => Math.abs(n) < 1));
    assert.deepEqual(rayHit(gl.draws,pane).color,[166,213,199]);
    const cabGlass = rayHit(gl.draws,pane,true);
    assert.ok(cabGlass.cab && cabGlass.glass);
    s.time += 12; renderer.render(s,c);
    assert.notDeepEqual(rayHit(gl.draws,pane)?.color,[166,213,199]);
    assert.equal(gl.uploads,uploads);
  }
});

test('the platform camera sees the next waiting rider, their crossing, and the gap after the last rider', () => {
  const { gl, renderer, s, c } = rendererFixture();
  C.setView(c, 'platform'); C.advance(c, 3);
  renderer.render(s, c);
  const uploads = gl.uploads;
  const queuePoint = [2.55, 2.39, 2.23];
  assert.ok(screenPoint(gl.draws, queuePoint).every(n => Math.abs(n) < 1));
  assert.equal(rayHit(gl.draws, queuePoint).part, PART.RIDER);
  R.command(s, 'doors'); R.advance(s, R.DOOR_TIME + 0.3);
  renderer.render(s, c);
  const trainDoor = [1.75, 2.38, 2.11];
  const crossing = rayHit(gl.draws, trainDoor, true);
  assert.equal(crossing.part, PART.RIDER); assert.equal(crossing.glass, false);
  R.advance(s, 0.3); renderer.render(s, c);
  assert.equal(rayHit(gl.draws, queuePoint).part, PART.RIDER + 1);
  R.advance(s, 4); renderer.render(s, c);
  assert.equal(s.car.call.boarded, s.car.call.queue.length);
  assert.ok(rayHit(gl.draws, queuePoint).part < PART.RIDER);
  assert.equal(gl.uploads, uploads);
});

test('a queued platform seen on approach keeps the same riders at its mark, including on the next lap', () => {
  const { gl, renderer, s, c } = rendererFixture();
  for (const visit of [1, 5, 45002]) {
    const station = visit % R.STATIONS.length;
    const mark = Math.floor(visit / R.STATIONS.length) * R.LENGTH + R.STATIONS[station].at;
    const call = P.platformCall(visit);
    s.berth = null; s.position = mark - 25;
    renderer.render(s, c);
    const crowd = () => gl.draws.find(d => d.verts[16] === PART.RIDER);
    const fromTrain = crowd().state['uRiders[0]'];
    assert.equal(fromTrain.filter((v, i) => i % 4 === 3 && v > 0).length, call.queue.length);
    assert.equal(crowd().state.uOrigin[2], -25);
    s.berth = station; s.car.call = call; s.position = mark;
    renderer.render(s, c);
    assert.deepEqual(crowd().state['uRiders[0]'], fromTrain);
    assert.equal(crowd().state.uOrigin[2], 0);
  }
});

test('the swept blade moves through the windscreen sight line and uploads wetness without rebuilding any buffers', () => {
  const { gl, renderer, s, c } = rendererFixture();
  renderer.render(s, c);
  const uploads = gl.uploads;
  const angle = BLADE.park + BLADE.arc;
  const point = [BLADE.x - Math.cos(angle), BLADE.y + Math.sin(angle), -1.673];
  assert.ok(screenPoint(gl.draws, point).every(n => Math.abs(n) < 1));
  assert.notEqual(rayHit(gl.draws, point).part, PART.WIPER);
  s.weather.water = 1; s.weather.film.fill(1);
  R.command(s, 'wipe'); R.advance(s, 0.7); renderer.render(s, c);
  assert.equal(rayHit(gl.draws, point).part, PART.WIPER);
  const layer = rayHit(gl.draws, point, true);
  assert.ok(layer.glass && layer.part === PART.WINDSCREEN);
  assert.ok(gl.uniforms.uWeather[1] > 0.8);
  assert.deepEqual(gl.uniforms.uFilmHigh, [0, 0, 0, 0]);
  assert.deepEqual(gl.uniforms.uFilmLow, [0, 0, 0, 0]);
  R.advance(s, 0.7); renderer.render(s, c);
  assert.notEqual(rayHit(gl.draws, point).part, PART.WIPER);
  assert.equal(gl.uploads, uploads);
});

test('both digits of every posted board are on the right of the running track and visible from the cab', () => {
  const { gl, renderer, s, c } = rendererFixture();
  for (const zone of limits.zones) {
    for (const [at, speed] of [[zone.entry, zone.kmh], [zone.release, 80]]) {
      s.position = at - 12 + 1001 * R.LENGTH;
      renderer.render(s, c);
      const tile = gl.draws.find(draw => !draw.glass && !draw.state.uCab &&
        draw.state.uOrigin[2] === s.position - (1001 * R.LENGTH + Math.floor(at / R.CHUNK) * R.CHUNK));
      const uv = [];
      for (let i=0; i<tile.verts.length; i+=STRIDE) {
        if (tile.verts[i+12] === 31) uv.push([tile.verts[i+10], tile.verts[i+11]]);
      }
      assert.equal(uv.length, 8);
      for (const [i, digit] of [...String(speed)].entries()) {
        const point = [R.trackOffset(at-0.009)+2.51+0.32*i, 2.36, -12+0.009];
        assert.ok(screenPoint(gl.draws, point).every(v => Math.abs(v) < 1));
        assert.equal(rayHit(gl.draws, point).tile, 31);
        const [u,v] = uv[4*i];
        assert.ok(Math.abs(u - Number(digit)%5/5) < 1e-6);
        assert.ok(Math.abs(v - (Math.floor(Number(digit)/5)+1)/2) < 1e-6);
      }
    }
  }
});

test('the guard can sight the cab repeater and the platform jamb lamp while both update in existing buffers', () => {
  const { gl, renderer, s, c } = rendererFixture();
  C.setView(c, 'platform'); C.advance(c, 3); renderer.render(s, c);
  const uploads = gl.uploads;
  function sight(expected) {
    renderer.render(s, c);
    const cab = [1.413, 2.48, 0.81], jamb = [1.811, 2.52, 2.90];
    for (const point of [cab, jamb]) {
      assert.ok(screenPoint(gl.draws, point).every(v => Math.abs(v) < 1));
      const hit = rayHit(gl.draws, point);
      assert.equal(hit.part, PART.GUARD_LAMP); assert.equal(hit.cab, point === cab);
    }
    assert.ok(gl.draws.filter(d => d.state.uCab || d.state.uStation).every(d => d.state.uGuardLamp === expected));
    assert.equal(gl.uploads, uploads);
  }
  sight(0); R.command(s, 'guard'); sight(1);
  R.command(s, 'doors'); R.advance(s, 8); R.command(s, 'doors'); R.advance(s, 2);
  sight(2); R.command(s, 'bell'); sight(3); R.command(s, 'doors'); sight(1);
});

test('rain, sky, cab and city share one solar clock and the headlight bearing follows the track without uploads', () => {
  const { gl, renderer, s, c } = rendererFixture();
  s.position = 181; s.weather.rain = true; s.weather.cloud = 1;
  renderer.render(s, c); const uploads = gl.uploads;
  const lights = [];
  for (let i = 0; i < 3; i++) {
    renderer.render(s, c);
    const sun = daylight.sunlight(s.clock), angle = Math.atan(R.trackSlope(s.position));
    assert.deepEqual(gl.uniforms.uHeading, [Math.cos(angle), Math.sin(angle)]);
    assert.ok(gl.draws.some(d => d.state.uSky) && gl.draws.some(d => d.state.uCab));
    for (const draw of gl.draws) {
      assert.deepEqual(draw.state.uSun, sun); assert.equal(draw.state.uWeather[0], 1);
    }
    lights.push(sun[0]); R.command(s, 'shift');
  }
  assert.equal(new Set(lights).size, 3); assert.equal(gl.uploads, uploads);
  const fragment = gl.shaders.find(shader => shader.type === gl.FRAGMENT_SHADER).source;
  assert.match(fragment, /headlights\(vPosition\)/); assert.match(fragment, /windowLight\*\(1\.0-0\.77\*uSun\.x\)/);
});
