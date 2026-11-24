"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../js/math.js"), P = require("../js/physics.js"), C = require("../js/camera.js");
const { bodies, planets, byId } = require("../js/catalog.js");
function near(a, b, tolerance = 1e-9) { assert.ok(Math.abs(a - b) < tolerance, a + " differs from " + b); }
function vectorNear(a, b, tolerance) { a.forEach((v, i) => near(v, b[i], tolerance)); }

test("catalog contains the Sun and eight ordered, independently scaled planets", () => {
  assert.deepEqual(planets.map(p => p.id), ["mercury","venus","earth","mars","jupiter","saturn","uranus","neptune"]);
  assert.equal(bodies.length, 9);
  planets.forEach((p, i) => {
    assert.equal(p.order, i + 1);
    assert.equal(byId[p.id], p);
    assert.ok(Object.isFrozen(p.elements));
    assert.ok(p.diameter > 0 && p.radius > 0 && p.spinDays !== 0);
    if (i) assert.ok(p.track > planets[i-1].track && p.elements[0] > planets[i-1].elements[0]);
  });
});

test("Kepler solver has a small residual across circular, eccentric and near-parabolic orbits", () => {
  for (const e of [0,0.01,0.2056,0.83,0.995,0.9999999]) {
    for (const mean of [-1000,-27,-Math.PI,-2,-1e-7,0,1e-10,0.1,2,Math.PI,831]) {
      const E = P.eccentricAnomaly(mean, e), m = M.wrap(mean + Math.PI) - Math.PI;
      near(E - e * Math.sin(E), m, 1.2e-13);
    }
  }
  for (const e of [-0.1,1,1.2,NaN]) assert.throws(() => P.eccentricAnomaly(1, e), RangeError);
  assert.throws(() => P.eccentricAnomaly(Infinity, 0.1), RangeError);
});

test("a known circular orbit has the expected position and tangent at quarter periods", () => {
  const o = P.compileOrbit([1,0,0,0,0,0]);
  vectorNear(P.orbitalState(o,0).position,[1,0,0]);
  vectorNear(P.orbitalState(o,o.period/4).position,[0,0,-1]);
  vectorNear(P.orbitalState(o,o.period/2).velocity,[0,0,M.TAU/o.period]);
  vectorNear(P.orbitalState(o,-o.period/4).position,[0,0,1]);
});

test("the ascending node, orbital inclination and periapsis orient the ellipse in 3D", () => {
  const o = P.compileOrbit([2,0.2,90,90,90,90]);
  vectorNear(P.pointOnOrbit(o,0),[0,0,-1.6]);
  near(P.pointOnOrbit(o,Math.PI/2)[1],2*Math.sqrt(0.96));
  for (const orbit of Object.values(P.orbits)) {
    near(M.dot(orbit.peri,orbit.tangent),0);
    near(Math.hypot(...orbit.peri),1);
    near(Math.hypot(...orbit.tangent),1);
  }
});

test("periods follow Kepler's third law and match familiar orbital years", () => {
  for (const o of Object.values(P.orbits)) near((o.period/P.YEAR_DAYS)**2 / o.a**3,1);
  near(P.orbits.earth.period,365.26,0.01);
  near(P.orbits.mercury.period,87.97,0.02);
  near(P.orbits.jupiter.period/P.YEAR_DAYS,11.87,0.02);
  near(P.orbits.neptune.period/P.YEAR_DAYS,164.9,0.15);
});

test("physical orbital energy and angular momentum are conserved over the orbit", () => {
  for (const o of Object.values(P.orbits)) {
    const expectedH = Math.sqrt(P.MU * o.a * (1 - o.e**2));
    for (const fraction of [-2.5,-0.1,0,0.25,0.37,0.67,1.4,123.5]) {
      const state = P.orbitalState(o,o.period*fraction);
      near(Math.hypot(...state.position),state.distance);
      near(M.dot(state.velocity,state.velocity)/2 - P.MU/state.distance,-P.MU/(2*o.a),1e-13);
      near(Math.hypot(...M.cross(state.position,state.velocity)),expectedH,1e-13);
      assert.ok(state.distance >= o.a*(1-o.e)-1e-10 && state.distance <= o.a*(1+o.e)+1e-10);
    }
  }
});

test("perihelion is faster than aphelion and equal time sweeps equal area", () => {
  const o = P.compileOrbit([1,0.4,0,0,0,0]);
  const a = P.orbitalState(o,0), b = P.orbitalState(o,o.period/2);
  near(a.distance,0.6); near(b.distance,1.4);
  near(Math.hypot(...a.velocity)/Math.hypot(...b.velocity),1.4/0.6);
  near(M.cross(a.position,a.velocity)[1]/2,M.cross(b.position,b.velocity)[1]/2);
});

test("velocities match finite differences, and whole orbits close after long time jumps", () => {
  for (const o of Object.values(P.orbits)) {
    const t = 381, dt = 0.0002, state = P.orbitalState(o,t);
    const derivative = M.scale(M.subtract(P.orbitalState(o,t+dt).position,P.orbitalState(o,t-dt).position),1/(2*dt));
    vectorNear(state.velocity,derivative,5e-9);
    vectorNear(P.orbitalState(o,t+10000*o.period).position,state.position,2e-9);
  }
});

test("screen-scale mapping preserves anomalies and keeps the physical AU readout", () => {
  const states = P.systemAt(P.START_DAYS);
  assert.deepEqual(states.sun.position,[0,0,0]);
  for (const p of planets) {
    const o = P.orbits[p.id], s = P.orbitalState(o,P.START_DAYS);
    near(states[p.id].distance,s.distance);
    vectorNear(states[p.id].position,M.scale(s.position,p.track/o.a));
  }
});

test("clock starts at a repeatable UTC epoch and respects speed, pause and input bounds", () => {
  const c = new P.Clock();
  assert.equal(c.date.toISOString(),"2026-01-01T00:00:00.000Z");
  near(c.speed,1);
  c.advance(1);
  assert.equal(c.date.toISOString(),"2026-01-02T00:00:00.000Z");
  c.setSpeed(99); near(c.speed,100);
  const day = c.days; c.advance(0.5); near(c.days,day+50);
  c.paused = true; c.advance(1234); near(c.days,day+50);
  c.setSpeed(-3); near(c.speed,0.1);
  c.setSpeed(NaN); near(c.speed,0.1);
  c.paused = false; c.advance(-1); c.advance(Infinity); c.advance(NaN);
  near(c.days,day+50);
  c.advance(10); near(c.days,day+51);
});

test("analytical positions agree across different frame rates and clock partitions", () => {
  const slow = new P.Clock(0), fast = new P.Clock(0);
  slow.setSpeed(5); fast.setSpeed(5);
  slow.advance(60);
  for (let i = 0; i < 3600; i++) fast.advance(1/60);
  for (const p of planets) vectorNear(P.systemAt(slow.days)[p.id].position,P.systemAt(fast.days)[p.id].position);
});

test("opening camera frames every planet at phone, desktop and expanded-map aspects", () => {
  const states = P.systemAt(P.START_DAYS);
  for (const aspect of [0.7,1,1.4,1.8,2,2.7,3.6]) {
    const cam = new C.OrbitCamera(aspect), width = aspect * 420, height = 420;
    const view = cam.step(0,states,aspect), points = C.screenBodies(bodies,states,view,width,height);
    assert.equal(points.length,bodies.length);
    for (const p of points) assert.ok(p.x >= p.radius && p.y >= p.radius
      && p.x <= width-p.radius && p.y <= height-p.radius, p.id + " clipped at " + aspect);
  }
});

test("the overview centers full orbit paths and uses the available map width", () => {
  const states = P.systemAt(P.START_DAYS);
  for (const aspect of [0.7, 1, 1.4, 1.8, 2, 2.7, 3.6]) {
    const view = new C.OrbitCamera(aspect).step(0, states, aspect);
    const projected = planets.flatMap(planet => Array.from({ length: 160 }, (_, i) => {
      const point = P.pointOnOrbit(P.orbits[planet.id], M.TAU * i / 160, planet.track);
      return M.project(point, view.matrix, 1, 1);
    }));
    assert.ok(projected.every(p => p && p.x > 0.025 && p.x < 0.975 && p.y > 0.025 && p.y < 0.975));
    const xs = projected.map(p => p.x), ys = projected.map(p => p.y);
    assert.ok(Math.max(...xs) - Math.min(...xs) > 0.71, "Narrow overview at aspect " + aspect);
    near((Math.max(...ys) + Math.min(...ys)) / 2, 0.5, 0.035);
  }
});

test("drag and zoom converge independently of frame rate and stay within camera limits", () => {
  const states = P.systemAt(0);
  const a = new C.OrbitCamera(2), b = new C.OrbitCamera(2);
  for (const cam of [a,b]) {
    cam.orbit(-9000,9999); cam.zoomBy(0.00001); cam.zoomBy(NaN);
    near(cam.goal.pitch,1.43); near(cam.goal.zoom,0.12);
  }
  a.step(1,states,2);
  for (let i=0;i<60;i++) b.step(1/60,states,2);
  near(a.distance,b.distance,1e-8); near(a.yaw,b.yaw); near(a.pitch,b.pitch);
  a.zoomBy(10000); near(a.goal.zoom,3.5);
  a.orbit(0,-9999); near(a.goal.pitch,-1.43);
});

test("follow transitions continuously, then locks to every moving target at maximum speed", () => {
  const cam = new C.OrbitCamera(2);
  let states = P.systemAt(500);
  for (const body of bodies) {
    const initialCenter = cam.center.slice();
    cam.follow(body.id,states);
    assert.equal(cam.following,body.id);
    cam.step(0,states,2);
    vectorNear(cam.center,initialCenter);
    cam.step(6,states,2);
    for (let tick=1;tick<=4;tick++) {
      states = P.systemAt(500+tick*100/60);
      const view = cam.step(1/60,states,2);
      vectorNear(cam.center,states[body.id].position,1e-9);
      const p = M.project(states[body.id].position,view.matrix,800,400);
      near(p.x,400,0.002); near(p.y,200,0.002);
    }
    assert.ok(cam.distance > body.radius*3);
  }
});

test("return restores the saved overview and reset restores the opening orientation", () => {
  const cam = new C.OrbitCamera(1.8), states = P.systemAt(0);
  cam.orbit(29,41); cam.zoomBy(0.64);
  const saved = {...cam.goal};
  cam.follow("earth",states); cam.orbit(-40,20); cam.zoomBy(0.5);
  cam.follow("mars",states); cam.follow("invalid",states);
  assert.equal(cam.following,"mars");
  cam.overview(); assert.deepEqual(cam.goal,saved);
  cam.step(8,states,1.8); vectorNear(cam.center,[0,0,0]);
  cam.overview(true); assert.deepEqual(cam.goal,C.HOME);
});

test("picking prioritizes the nearest visible disk and provides a small touch margin", () => {
  const points = [{ id:"sun",x:20,y:20,radius:8,depth:10 },{ id:"earth",x:20,y:20,radius:4,depth:4 },
    { id:"mars",x:36,y:20,radius:2,depth:2 }];
  assert.equal(C.pickBody(points,20,20),"earth");
  assert.equal(C.pickBody(points,27,20),"sun");
  assert.equal(C.pickBody(points,41,20),"mars");
  assert.equal(C.pickBody(points,90,90),null);
});

test("map labels respect viewport edges, visible bodies, foreground occlusion and each other", () => {
  const points = [
    {id:"earth",x:170,y:85,radius:9,depth:5},{id:"mars",x:185,y:90,radius:6,depth:6},
    {id:"sun",x:294,y:87,radius:23,depth:4},{id:"venus",x:290,y:85,radius:2,depth:9},
    {id:"mercury",x:4,y:150,radius:3,depth:7}
  ];
  const layout = C.labelLayout(points,"earth",340,200);
  assert.ok(layout.length >= 3);
  assert.ok(layout.some(p=>p.id==="earth"));
  assert.ok(!layout.some(p=>p.id==="venus"));
  layout.forEach((a,i)=>{
    assert.ok(a.x>=0 && a.y>=0 && a.x+a.w<=340 && a.y+a.h<=200);
    for (const b of layout.slice(i+1)) assert.ok(a.x+a.w<=b.x || b.x+b.w<=a.x || a.y+a.h<=b.y || b.y+b.h<=a.y);
  });
});

test("fully occulted disks cannot steal a touch in the foreground body's margin", () => {
  const front = { id: "venus", x: 100, y: 100, radius: 4, depth: 2 };
  const behind = { id: "mars", x: 102, y: 100, radius: 2, depth: 12 };
  for (const points of [[front, behind], [behind, front]]) {
    assert.ok(C.covered(behind, points));
    assert.equal(C.pickBody(points, 107, 100), "venus");
    assert.ok(!C.labelLayout(points, "mars", 400, 300).some(box => box.id === "mars"));
  }
});

test("the study camera fits the whole selected orbit on phones, wide maps and after resizing", () => {
  const states = P.systemAt(P.START_DAYS), camera = new C.OrbitCamera(1.8);
  for (const body of planets) {
    const orbit = P.orbits[body.id];
    const center = camera.center.slice();
    camera.frameOrbit(body.id);
    camera.step(0, states, 1.8);
    vectorNear(camera.center, center);
    for (const aspect of [0.65, 1.8, 3.6]) {
      const view = camera.step(8, states, aspect);
      vectorNear(camera.center, M.scale(orbit.peri, -body.track * orbit.e));
      for (let i = 0; i < 64; i++) {
        const position = P.pointOnOrbit(orbit, i * M.TAU / 64, body.track);
        const p = M.project(position, view.matrix, 1, 1);
        assert.ok(p && p.x > 0.025 && p.x < 0.975 && p.y > 0.025 && p.y < 0.975);
      }
    }
  }
});

test("handoffs between orbit framing and following retain the originally saved overview", () => {
  const camera = new C.OrbitCamera(2), states = P.systemAt(0);
  camera.orbit(-22, 15);
  camera.zoomBy(0.75);
  const saved = { ...camera.goal };
  camera.frameOrbit("mercury");
  camera.frameOrbit("sun");
  camera.frameOrbit("constructor");
  assert.equal(camera.framedOrbit, "mercury");
  camera.follow("earth", states);
  camera.follow("__proto__", states);
  assert.equal(camera.framedOrbit, null);
  assert.equal(camera.following, "earth");
  camera.frameOrbit("mars");
  assert.equal(camera.following, null);
  camera.overview();
  assert.equal(camera.framedOrbit, null);
  assert.deepEqual(camera.goal, saved);
});
