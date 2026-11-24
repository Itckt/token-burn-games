(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./math.js") : root.FoundryMath, node ? require("./track.js") : root.FoundryTrack,
    node ? require("./trials.js") : root.FoundryTrials, node ? require("./heat.js") : root.FoundryHeat);
  if (node) module.exports = api;
  else root.FoundryPhysics = api;
})(globalThis, function (M, T, Trials, Heats) {
  "use strict";
  const {add, sub, mul, madd, dot, cross, unit, length, clamp} = M;
  const DT = 1/180, GRAVITY = 9.81, MAX_BALLS = 24, R = T.RADIUS;
  const INVERSE_INERTIA = 2.5/(R*R); // Uniform solid sphere, unit mass.
  function triangle(a,b,c) {
    const ab = sub(b,a), ac = sub(c,a);
    const n = unit(cross(ab,ac));
    return {a,b,c,ab,ac,n,plane: dot(n,a),min: a.map((x,k) => Math.min(x,b[k],c[k])),
      max: a.map((x,k) => Math.max(x,b[k],c[k]))};
  }
  // Voronoi-region closest point, including finite edges and vertices.
  function closestPoint(p, f) {
    const {a,b,c,ab,ac} = f;
    const ap = sub(p,a), d1 = dot(ab,ap), d2 = dot(ac,ap);
    if (d1<=0 && d2<=0) return a;
    const bp = sub(p,b), d3 = dot(ab,bp), d4 = dot(ac,bp);
    if (d3>=0 && d4<=d3) return b;
    const vc = d1*d4-d3*d2;
    if (vc<=0 && d1>=0 && d3<=0) return madd(a,ab,d1/(d1-d3));
    const cp = sub(p,c), d5 = dot(ab,cp), d6 = dot(ac,cp);
    if (d6>=0 && d5<=d6) return c;
    const vb = d5*d2-d1*d6;
    if (vb<=0 && d2>=0 && d6<=0) return madd(a,ac,d2/(d2-d6));
    const va = d3*d6-d5*d4;
    if (va<=0 && d4-d3>=0 && d5-d6>=0) return madd(b,sub(c,b),(d4-d3)/((d4-d3)+(d5-d6)));
    const den = 1/(va+vb+vc);
    return madd(madd(a,ab,vb*den),ac,vc*den);
  }
  class Surface {
    constructor(course) {
      this.cells = new Map();
      this.count = 0;
      for (const section of course.sections) {
        const first = section.samples[0];
        const strip = Object.hasOwn(T.STRIPS, section.type)
          ? {type: section.type, ...T.STRIPS[section.type], t: first.t, n: first.n} : null;
        for (const deck of section.decks) this.addDeck(deck, section.length, strip);
        for (let i = 1; i < section.decks.length; i++) {
          const edges = [[section.decks[i-1].at(-1), 1], [section.decks[i][0], -1]];
          for (const [frame,sign] of edges) {
            for (const face of T.endFaces(frame,sign)) this.quad(...face);
          }
        }
      }
      const launch = course.sections[0].samples[0], finish = course.sections.at(-1).samples.at(-1);
      for (const [f,dir,offset] of [[launch,1,-0.055],[finish,-1,-0.27]]) {
        this.quad(T.point(f,offset,-0.02,-dir*0.90),T.point(f,offset,0.68,-dir*0.90),
          T.point(f,offset,0.68,dir*0.90),T.point(f,offset,-0.02,dir*0.90));
      }
    }
    addDeck(samples, sectionLength, strip) {
      let row;
      for (const [i, f] of samples.entries()) {
        const next = T.PROFILE.map(([z,y]) => T.point(f,0,y,z));
        if (row) {
          const mid = (f.s + samples[i-1].s) / 2;
          const active = strip && mid >= T.STRIP_LEAD && mid <= sectionLength - T.STRIP_LEAD;
          for (let j=0; j<row.length-1; j++) {
            const flatBed = T.PROFILE[j][1] === 0 && T.PROFILE[j+1][1] === 0;
            this.quad(row[j],row[j+1],next[j+1],next[j],active && flatBed ? strip : null);
          }
        }
        row = next;
      }
    }
    quad(a,b,c,d,strip = null) {
      const first = triangle(a,b,c), second = triangle(a,c,d);
      if (strip) first.strip = second.strip = strip;
      this.insert(first); this.insert(second);
    }
    insert(f) {
      if (dot(f.n,f.n) < 0.9) return;
      this.count++;
      // Expand static bounds once, so a moving sphere only needs one bucket lookup.
      const lo = f.min.map(v => Math.floor((v-R-0.002)/1.5));
      const hi = f.max.map(v => Math.floor((v+R+0.002)/1.5));
      for (let x=lo[0]; x<=hi[0]; x++) for (let y=lo[1]; y<=hi[1]; y++) for (let z=lo[2]; z<=hi[2]; z++) {
        const key = x+","+y+","+z;
        let bucket = this.cells.get(key);
        if (!bucket) { bucket = []; this.cells.set(key,bucket); }
        bucket.push(f);
      }
    }
    near(p) {
      return this.cells.get(Math.floor(p[0]/1.5)+","+Math.floor(p[1]/1.5)+","+Math.floor(p[2]/1.5)) || [];
    }
  }
  function marble(p, v = [0,0,0], color = 0, number = 0) {
    const q = [0,0,0,1];
    return {p:p.slice(), prev:p.slice(), v:v.slice(), prevSpeed:length(v), spin:[0,0,0], q, prevQ:q, color,
      number, run:Trials.attempt(p, v), age:0, prevAge:0, finishAge:0, tableAge:0, finished:false, onTable:false};
  }
  function staticContact(ball, normal, depth, rebound = 0.07, friction = 0.30) {
    ball.p = madd(ball.p,normal,depth);
    const vn = dot(ball.v,normal);
    if (vn >= 0) return;
    const impulse = -vn*(1+(vn < -1.2 ? rebound : 0));
    ball.v = madd(ball.v,normal,impulse);
    const arm = mul(normal,-R), contactV = add(ball.v,cross(ball.spin,arm));
    const slip = madd(contactV,normal,-dot(contactV,normal));
    const speed = length(slip);
    if (speed < 1e-8) return;
    const tangentImpulse = mul(slip,-Math.min(speed/3.5,friction*impulse)/speed);
    ball.v = add(ball.v,tangentImpulse);
    ball.spin = madd(ball.spin,cross(arm,tangentImpulse),INVERSE_INERTIA);
  }
  function driveContact(ball, strip, dt) {
    const forward = dot(ball.v, strip.t);
    const target = strip.type === "brake" ? clamp(forward, -strip.speed, strip.speed) : Math.max(forward, strip.speed);
    const limit = strip.acceleration * dt;
    const impulse = mul(strip.t, clamp(target - forward, -limit, limit));
    ball.v = add(ball.v, impulse);
    ball.spin = madd(ball.spin, cross(strip.n, impulse), 1/R);
  }
  function surfaceContact(ball, surface, dt = 0) {
    const candidates = surface.near(ball.p);
    let hit = false, strip = null;
    // Prefer face contacts to nearby coplanar internal edges. The deepest contact
    // also remains stable where two strips meet at the walls of the channel.
    for (let iteration=0; iteration<3; iteration++) {
      let depth = 0.000001, normal, face;
      for (const f of candidates) {
        const p = ball.p;
        if (p[0]<f.min[0]-R || p[0]>f.max[0]+R || p[1]<f.min[1]-R ||
            p[1]>f.max[1]+R || p[2]<f.min[2]-R || p[2]>f.max[2]+R) continue;
        const plane = dot(p,f.n)-f.plane;
        if (plane < -0.016 || plane > R-depth) continue;
        const q = closestPoint(p,f), offset = sub(p,q), d2 = dot(offset,offset);
        if (d2 >= (R-depth)*(R-depth)) continue;
        const d = Math.sqrt(d2);
        depth = R-d;
        normal = d>0.0001 ? mul(offset,1/d) : f.n;
        face = f;
      }
      if (!normal) break;
      staticContact(ball,normal,depth);
      if (face.strip && dot(normal, face.strip.n) > 0.96) strip = face.strip;
      hit = true;
    }
    if (strip && dt > 0) driveContact(ball,strip,dt);
    return hit;
  }
  function collideMarbles(a,b, restitution = 0.43) {
    const delta = sub(b.p,a.p), d2 = dot(delta,delta);
    if (d2 >= 4*R*R) return false;
    const distance = Math.sqrt(d2);
    const n = distance>1e-7 ? mul(delta,1/distance) : unit(sub(a.v,b.v),[1,0,0]);
    const push = (2*R-distance)*0.5;
    a.p = madd(a.p,n,-push);
    b.p = madd(b.p,n,push);
    const rel = sub(b.v,a.v), closing = dot(rel,n);
    if (closing < 0) {
      const j = -(1+restitution)*closing/2;
      a.v = madd(a.v,n,-j);
      b.v = madd(b.v,n,j);
      const arm = mul(n,R), otherArm = mul(n,-R);
      const slip = add(madd(rel,n,-closing),sub(cross(b.spin,otherArm),cross(a.spin,arm)));
      const speed = length(slip);
      if (speed > 1e-8) {
        const impulse = mul(slip, -Math.min(speed/7,0.2*j)/speed);
        a.v = sub(a.v,impulse); b.v = add(b.v,impulse);
        a.spin = madd(a.spin,cross(arm,impulse),-INVERSE_INERTIA);
        b.spin = madd(b.spin,cross(otherArm,impulse),INVERSE_INERTIA);
      }
    }
    return true;
  }
  function moveBall(ball, surface, dt) {
    ball.prev = ball.p.slice();
    ball.prevQ = ball.q;
    ball.prevSpeed = length(ball.v);
    ball.prevAge = ball.age;
    ball.age += dt;
    ball.v[1] -= GRAVITY*dt;
    ball.p = madd(ball.p,ball.v,dt);
    let drag = surfaceContact(ball,surface,dt) ? 0.020 : 0.004;
    if (ball.p[1] <= R) {
      staticContact(ball,[0,1,0],R-ball.p[1],0.24,0.42);
      drag = 1.3;
      ball.onTable = true;
    }
    if (ball.finished) { ball.finishAge += dt; drag = 4.5; }
    if (ball.onTable) ball.tableAge += dt;
    const damping = Math.exp(-drag*dt);
    ball.v = mul(ball.v,damping);
    ball.spin = mul(ball.spin,damping);
    ball.q = M.advanceRotation(ball.q,ball.spin,dt);
  }
  class World {
    constructor(course) {
      this.course = course;
      this.surface = new Surface(course);
      this.launchPosition = T.point(course.launch,0,R+0.50,0);
      this._paused = false;
      this.clear();
    }
    clear() {
      this.balls = [];
      this.timing = new Trials.TimingBoard(this.course);
      this.heat = null;
      this.dropped = 0;
      this.accumulator = 0;
    }
    get completed() { return this.timing.completed; }
    get hasWork() { return this.balls.length > 0 || Boolean(this.heat?.pending); }
    get followBall() {
      return this.balls.findLast(ball => ball.run.state === "rolling") || this.balls.at(-1) || null;
    }
    get paused() { return this._paused; }
    set paused(value) {
      if (this._paused && !value) {
        // Resume from the pose that was displayed while the clock was held.
        for (const ball of this.balls) { ball.prev = ball.p.slice(); ball.prevAge = ball.age; ball.prevQ = ball.q; }
      }
      this._paused = Boolean(value);
    }
    canSpawn() {
      return this.balls.length < MAX_BALLS &&
        this.balls.every(b => length(sub(b.p,this.launchPosition)) >= R*2.05);
    }
    release(speed, color) {
      if (!Number.isFinite(speed) || !this.canSpawn()) return null;
      const ball = marble(this.launchPosition,mul(this.course.launch.t,clamp(speed,0,T.MAX_LAUNCH_SPEED)),color,this.dropped+1);
      this.balls.push(ball);
      this.timing.release(ball);
      this.dropped++;
      return ball;
    }
    spawn(speed = 10, color = 0) {
      const idle = !this.hasWork;
      if (!this.release(speed, color)) return false;
      if (idle) this.accumulator = 0;
      return true;
    }
    startHeat(speed = 10, firstColor = 0, colorCount = 3) {
      if (this.heat?.active) return false;
      const plan = Heats.lineup(speed, firstColor, colorCount);
      if (!plan.length) return false;
      if (!this.hasWork) this.accumulator = 0;
      this.heat = new Heats.PaceHeat(plan, this.timing.clock);
      this.dispatchHeat();
      return true;
    }
    dispatchHeat() {
      if (this.heat?.pending) this.heat.dispatch(this.timing.clock, (speed, color) => this.release(speed, color));
    }
    step(dt = DT) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      for (const ball of this.balls) moveBall(ball,this.surface,dt);
      for (let i=0; i<this.balls.length; i++) for (let j=i+1; j<this.balls.length; j++) {
        collideMarbles(this.balls[i],this.balls[j]);
      }
      this.timing.advance(this.balls,dt);
      this.balls = this.balls.filter(b => b.age<Trials.TIME_LIMIT && b.finishAge<1.6 && b.tableAge<4);
      this.dispatchHeat();
    }
    stepFrame() {
      if (!this.paused || !this.hasWork) return false;
      // Three solver ticks make one 1/60 s inspection frame.
      for (let i = 0; i < 3; i++) this.step();
      return true;
    }
    advance(seconds, rate = 1) {
      if (this.paused || !Number.isFinite(seconds) || seconds<=0 || !Number.isFinite(rate) || rate<=0 || rate>1) return 0;
      if (!this.hasWork) { this.accumulator = 0; return 0; }
      this.accumulator += Math.min(seconds,0.1) * rate;
      let steps = 0;
      while (this.hasWork && this.accumulator+1e-12 >= DT) {
        this.step();
        this.accumulator = Math.max(0,this.accumulator-DT);
        steps++;
      }
      if (!this.hasWork) this.accumulator = 0;
      return steps;
    }
    get alpha() { return this.paused ? 1 : clamp(this.accumulator/DT,0,1); }
    position(ball) { return this.paused ? ball.p : M.lerp(ball.prev, ball.p, this.alpha); }
    orientation(ball) { return this.paused ? ball.q : M.mixRotation(ball.prevQ, ball.q, this.alpha); }
    ghost() {
      const {latest, opponent} = this.timing;
      if (!opponent || latest.run.state !== "rolling") return null;
      const age = latest.prevAge + (latest.age-latest.prevAge)*this.alpha;
      return Trials.ghostPosition(opponent,age);
    }
  }
  return {DT,GRAVITY,MAX_BALLS,triangle,closestPoint,Surface,marble,staticContact,surfaceContact,collideMarbles,World};
});
