'use strict';

const CourtPhysics = (() => {
  const TICK = 1 / 120;
  const FORECAST_SECONDS = 2;
  const MAX_FORECAST_INSTANTS = 128;
  const { RELATIVE_CONTACT_EPS, quadraticUnit, pairTime, railTime, towardRail, railDistance, railSeparation, gateCrossing } =
    typeof module !== 'undefined' && module.exports ? require('./court-geometry.js') : CourtGeometry;
  const wallNormals = {
    left: { x: -1, y: 0 }, right: { x: 1, y: 0 },
    top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }
  };

  function positive(value) {
    return Number.isFinite(value) && value > 0;
  }

  function validCount(value) {
    return Number.isSafeInteger(value) && value >= 0;
  }

  function validateRestitution(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError('Restitution must be between 0 and 1.');
    }
  }

  function firstContact(world, limit) {
    let first = null;
    function consider(time, a, kind, b = null, wall = null) {
      if (!Number.isFinite(time)) return;
      // Linear drag only permits undamped travel times strictly below 1 / drag.
      if (time * world.drag >= 1) return;
      // A root at a tick endpoint can round a few ulps beyond the budget.
      if (time > limit && time - limit > 8 * Number.EPSILON * limit) return;
      const bounded = Math.max(0, Math.min(time, limit));
      if (!first || bounded < first.time) {
        first = { time: bounded, a, kind, b, wall };
      }
    }

    const balls = world.balls;
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      if (a.vx < 0) consider((a.radius - a.x) / a.vx, a, 'wall', null, 'left');
      if (a.vx > 0) {
        const right = world.width - a.radius;
        consider((right - a.x) / a.vx, a, 'wall', null, 'right');
      }
      if (a.vy < 0) consider((a.radius - a.y) / a.vy, a, 'wall', null, 'top');
      if (a.vy > 0) {
        const bottom = world.height - a.radius;
        consider((bottom - a.y) / a.vy, a, 'wall', null, 'bottom');
      }
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        consider(pairTime(a, b, limit === 0), a, 'ball', b);
      }
      for (const bumper of world.bumpers) {
        consider(pairTime(a, bumper, limit === 0), a, 'bumper', bumper);
      }
      for (const rail of world.rails) {
        consider(railTime(a, rail, limit === 0), a, 'rail', rail);
      }
    }
    return first;
  }

  function snapWall(position, displacement, radius, extent) {
    const edge = displacement < 0 ? radius : extent - radius;
    return Math.abs(position - edge) <= 8 * Number.EPSILON * Math.abs(displacement) ? edge : position;
  }

  // With uniform linear drag every free path is straight. Its displacement is
  // initial velocity times travelTime, so all contact searches use one clock.
  function travelTime(seconds, drag) {
    if (!drag || drag * seconds < Number.EPSILON) return seconds;
    return -Math.expm1(-drag * seconds) / drag;
  }

  function clockTime(travel, drag) {
    if (!drag || drag * travel < Number.EPSILON) return travel;
    return -Math.log1p(-drag * travel) / drag;
  }

  function dampedSpeed(start, end, speed, drag, factor) {
    const decayed = speed * factor;
    // A sub-ulp displacement can leave the center unchanged while the ball
    // still has measurable velocity. In that case no range was consumed.
    if (start === end) return decayed;
    // Rounding a position toward its stopping point must not create extra
    // range on the next flight. At the representable stopping point, settle.
    const stop = start + speed / drag;
    const remainingSpeed = (stop - end) * drag;
    return speed > 0 ? Math.max(0, Math.min(decayed, remainingSpeed))
      : Math.min(0, Math.max(decayed, remainingSpeed));
  }

  function measureGates(world, ball, startX, startY, seconds, readings) {
    for (const gate of world.gates) {
      const crossing = gateCrossing(gate, ball, startX, startY);
      if (!crossing || crossing.travel * world.drag >= 1) continue;
      gate.counts[crossing.direction]++;
      if (!readings) continue;
      const elapsed = Math.min(seconds, clockTime(crossing.travel, world.drag));
      const factor = Math.exp(-world.drag * elapsed);
      readings.push({
        time: elapsed, type: 'gate', gateId: gate.id, ballId: ball.id,
        x: crossing.x, y: crossing.y, direction: crossing.direction,
        vx: ball.vx * factor, vy: ball.vy * factor
      });
    }
  }

  function advance(world, travel, flight, crossings, atContact) {
    const { seconds } = flight;
    const speedFactor = Math.exp(-world.drag * seconds);
    const readings = crossings && world.gates.length ? [] : undefined;
    for (const ball of world.balls) {
      const dx = ball.vx * travel;
      const dy = ball.vy * travel;
      const startX = ball.x;
      const startY = ball.y;
      ball.x += dx;
      ball.y += dy;
      // A corner arrival can round just inside the second wall after travel.
      if (atContact) {
        ball.x = snapWall(ball.x, dx, ball.radius, world.width);
        ball.y = snapWall(ball.y, dy, ball.radius, world.height);
      }
      if (world.gates.length && (ball.x !== startX || ball.y !== startY)) {
        measureGates(world, ball, startX, startY, seconds, readings);
      }
      if (world.drag && seconds > 0) {
        ball.vx = dampedSpeed(startX, ball.x, ball.vx, world.drag, speedFactor);
        ball.vy = dampedSpeed(startY, ball.y, ball.vy, world.drag, speedFactor);
      }
    }
    if (readings?.length) {
      readings.sort((a, b) => a.time - b.time || a.ballId - b.ballId || a.gateId - b.gateId);
      // Add the large absolute clock only once, after ordering the local times.
      for (const reading of readings) {
        reading.time = reading.time === seconds ? flight.end : Math.min(flight.end, flight.start + (flight.offset + reading.time));
        crossings.push(reading);
      }
    }
  }

  // Points out of the moving ball, toward the surface it struck.
  function contactNormal({ a, b, kind, wall }) {
    if (wall) return wallNormals[wall];
    const offset = kind === 'rail' ? towardRail(b, a.x, a.y) : { x: b.x - a.x, y: b.y - a.y };
    const distance = Math.hypot(offset.x, offset.y);
    return { x: offset.x / distance, y: offset.y / distance };
  }

  function bounce(world, hit) {
    const { a, b, wall } = hit;
    const restitution = hit.kind === 'ball' ? world.restitution
      : world.surfaceRestitution[hit.kind + ':' + (wall ?? b.id)] ?? world.restitution;
    const { x: nx, y: ny } = contactNormal(hit);
    if (wall) {
      if (nx) {
        a.x = nx < 0 ? a.radius : world.width - a.radius;
        a.vx = -a.vx * restitution;
      } else {
        a.y = ny < 0 ? a.radius : world.height - a.radius;
        a.vy = -a.vy * restitution;
      }
      return;
    }
    const unit = quadraticUnit(Math.max(Math.abs(a.vx), Math.abs(a.vy), Math.abs(b.vx ?? 0), Math.abs(b.vy ?? 0)));
    const ax = a.vx / unit, ay = a.vy / unit;
    function setNormalSpeed(ball, vx, vy, normal) {
      const tangent = vy * nx - vx * ny;
      ball.vx = (normal * nx - tangent * ny) * unit;
      ball.vy = (normal * ny + tangent * nx) * unit;
    }
    const an = ax * nx + ay * ny;
    if (hit.kind !== 'ball') {
      setNormalSpeed(a, ax, ay, -restitution * an);
      return;
    }
    const bx = b.vx / unit, by = b.vy / unit;
    const bn = bx * nx + by * ny;
    const scale = Math.max(a.mass, b.mass);
    const ma = a.mass / scale, mb = b.mass / scale;
    const total = ma + mb;
    // Interpolate the inelastic and elastic normal velocities. This retains
    // tiny rebounds around a stationary center of mass and exact elastic swaps.
    const common = (1 - restitution) * ((ma * an + mb * bn) / total);
    const elasticA = ((ma - mb) * an + 2 * mb * bn) / total;
    const elasticB = ((mb - ma) * bn + 2 * ma * an) / total;
    setNormalSpeed(a, ax, ay, common + restitution * elasticA);
    setNormalSpeed(b, bx, by, common + restitution * elasticB);
  }

  // Project onto the velocities allowed by all fixed surfaces in a jam.
  // In 2D the closest feasible velocity is the original, a tangent, or zero.
  function constrainedVelocity(vx, vy, normals) {
    const allowed = (x, y, own) => normals.every(n => n === own || x * n.x + y * n.y <= 0);
    if (allowed(vx, vy)) return { x: vx, y: vy };
    let best = { x: 0, y: 0 };
    let bestSpeed = 0;
    for (const n of normals) {
      const speed = -vx * n.y + vy * n.x;
      const x = -speed * n.y;
      const y = speed * n.x;
      if (Math.abs(speed) > bestSpeed && allowed(x, y, n)) {
        best = { x, y };
        bestSpeed = Math.abs(speed);
      }
    }
    return best;
  }

  // Only persistent, zero-time contact chains reach this fallback.
  function settleJam(hit, contacts) {
    const group = new Set([hit.a]);
    for (const ball of group) {
      for (const { a, b, kind } of contacts.values()) {
        if (kind !== 'ball') continue;
        if (a === ball) group.add(b);
        if (b === ball) group.add(a);
      }
    }
    let massScale = 0;
    for (const b of group) massScale = Math.max(massScale, b.mass);
    let mass = 0, vx = 0, vy = 0;
    for (const ball of group) {
      const weight = ball.mass / massScale;
      mass += weight;
      vx += weight * ball.vx;
      vy += weight * ball.vy;
    }
    vx /= mass;
    vy /= mass;
    const normal = contactNormal(hit);
    let straight = true;
    const fixedNormals = [];
    for (const c of contacts.values()) {
      if (!group.has(c.a)) continue;
      const n = contactNormal(c);
      if (Math.abs(n.x * normal.y - n.y * normal.x) > 1e-12) straight = false;
      if (c.kind !== 'ball') fixedNormals.push(n);
    }
    const velocity = constrainedVelocity(vx, vy, fixedNormals);
    const normalSpeed = velocity.x * normal.x + velocity.y * normal.y;
    for (const ball of group) {
      if (straight) {
        const tangent = -ball.vx * normal.y + ball.vy * normal.x;
        ball.vx = normalSpeed * normal.x - tangent * normal.y;
        ball.vy = normalSpeed * normal.y + tangent * normal.x;
      } else {
        ball.vx = velocity.x;
        ball.vy = velocity.y;
      }
    }
  }

  function recordImpact(world, hit, time, impacts) {
    world[hit.kind + 'Hits']++;
    if (!impacts) return;

    const { x: nx, y: ny } = contactNormal(hit);
    const event = {
      time, type: hit.kind, ballId: hit.a.id,
      x: hit.a.x + nx * hit.a.radius, y: hit.a.y + ny * hit.a.radius
    };
    if (hit.wall) {
      event.wall = hit.wall;
      if (nx) event.x = nx < 0 ? 0 : world.width;
      if (ny) event.y = ny < 0 ? 0 : world.height;
    } else if (hit.kind === 'ball') {
      event.otherBallId = hit.b.id;
    } else {
      event[hit.kind + 'Id'] = hit.b.id;
    }
    impacts.push(event);
  }

  // A corner or a Newton's cradle can need several impulses at one time.
  // Both fixed ticks and next-impact stepping resolve the whole instant.
  function resolveInstant(world, first, time, impacts) {
    const contacts = new Map();
    let impulses = 0;
    let hit = first;
    do {
      const key = [hit.a.id, hit.kind, hit.wall ?? hit.b.id].join('/');
      const repeated = contacts.has(key);
      if (!repeated) {
        contacts.set(key, hit);
        recordImpact(world, hit, time, impacts);
      }
      if (++impulses > 8 * contacts.size + 48 && repeated) {
        settleJam(hit, contacts);
        impulses = 0;
      } else {
        bounce(world, hit);
      }
      hit = firstContact(world, 0);
    } while (hit);
    return contacts;
  }

  function validateDuration(world, seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(world.time + seconds)) {
      throw new RangeError('Step duration must be a nonnegative finite number within the simulation clock.');
    }
  }

  // Run until the budget ends or the observer stops at a resolved instant.
  // An unbounded search with no reachable impact leaves the court in place.
  function evolve(world, seconds, { impacts, afterImpact, crossings } = {}) {
    const start = world.time;
    let elapsed = 0;
    let remaining = seconds;
    while (remaining > 0) {
      const travel = travelTime(remaining, world.drag);
      const hit = firstContact(world, travel);
      if (!hit && !Number.isFinite(remaining)) break;
      const duration = hit ? Math.min(remaining, clockTime(hit.time, world.drag)) : remaining;
      const time = duration === remaining ? start + seconds : start + (elapsed + duration);
      if (!Number.isFinite(time)) break;
      const flight = { start, offset: elapsed, seconds: duration, end: time };
      advance(world, hit?.time ?? travel, flight, crossings, Boolean(hit));
      if (!hit) break;
      const contacts = resolveInstant(world, hit, time, impacts);
      elapsed += duration;
      remaining -= duration;
      if (afterImpact) {
        world.time = time;
        if (!afterImpact(world.time, contacts)) return remaining === 0;
      }
    }
    if (Number.isFinite(seconds)) world.time = start + seconds;
    return true;
  }

  function insideCourt(world, x, y, radius, tolerance) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !positive(radius) ||
        radius * 2 >= Math.min(world.width, world.height)) return false;
    const inset = radius * (1 - tolerance);
    return x >= inset && x <= world.width - inset && y >= inset && y <= world.height - inset;
  }

  function hasSpace(world, x, y, radius, tolerance) {
    if (!insideCourt(world, x, y, radius, tolerance)) return false;
    const clear = body => Math.hypot(x - body.x, y - body.y) >= (radius + body.radius) * (1 - tolerance);
    return world.balls.every(clear) && world.bumpers.every(clear) &&
      world.rails.every(rail => railDistance(rail, x, y) >= (radius + rail.radius) * (1 - tolerance));
  }

  function railFits(world, rail, tolerance) {
    const { x1, y1, x2, y2, radius } = rail;
    if (!insideCourt(world, x1, y1, radius, tolerance) || !insideCourt(world, x2, y2, radius, tolerance) ||
        !positive(Math.hypot(x2 - x1, y2 - y1))) return false;
    const clear = body => railDistance(rail, body.x, body.y) >= (radius + body.radius) * (1 - tolerance);
    return world.balls.every(clear) && world.bumpers.every(clear) &&
      world.rails.every(other => railSeparation(rail, other) >= (radius + other.radius) * (1 - tolerance));
  }

  function placeBall(world, { x, y, radius, vx, vy, mass }, tolerance) {
    if (!Number.isFinite(vx) || !Number.isFinite(vy) || !positive(mass)) {
      throw new RangeError('Velocity must be finite and mass must be positive and finite.');
    }
    if (!hasSpace(world, x, y, radius, tolerance)) {
      throw new RangeError('A ball needs a clear spot inside the court and room to move.');
    }
    const ball = { id: world.balls.length + 1, x, y, vx, vy, radius, mass };
    world.balls.push(ball);
    return ball;
  }

  function placeBumper(world, { x, y, radius }, tolerance) {
    if (!hasSpace(world, x, y, radius, tolerance)) {
      throw new RangeError('A bumper needs a clear spot inside the court.');
    }
    const bumper = Object.freeze({ id: world.bumpers.length + 1, x, y, radius });
    world.bumpers.push(bumper);
    return bumper;
  }

  function placeRail(world, { x1, y1, x2, y2, radius }, tolerance) {
    const rail = { id: world.rails.length + 1, x1, y1, x2, y2, radius };
    if (!railFits(world, rail, tolerance)) {
      throw new RangeError('A rail needs two distinct ends and a clear path inside the court.');
    }
    world.rails.push(Object.freeze(rail));
    return rail;
  }

  function gateFits(world, { x1, y1, x2, y2 }) {
    const inside = (x, y) => Number.isFinite(x) && Number.isFinite(y) &&
      x >= 0 && x <= world.width && y >= 0 && y <= world.height;
    return inside(x1, y1) && inside(x2, y2) && positive(Math.hypot(x2 - x1, y2 - y1));
  }

  function placeGate(world, { x1, y1, x2, y2, counts = { forward: 0, reverse: 0 } }) {
    if (!gateFits(world, { x1, y1, x2, y2 })) {
      throw new RangeError('A timing gate needs two distinct endpoints inside the court.');
    }
    if (!validCount(counts?.forward) || !validCount(counts?.reverse)) {
      throw new RangeError('Invalid timing gate counts.');
    }
    const gate = Object.freeze({ id: world.gates.length + 1, x1, y1, x2, y2,
      counts: { forward: counts.forward, reverse: counts.reverse } });
    world.gates.push(gate);
    return gate;
  }

  function validateCrossings(crossings) {
    if (crossings !== undefined && !Array.isArray(crossings)) throw new TypeError('Expected a gate crossing array.');
  }

  function velocityAfterImpulse(velocity, impulse, mass) {
    const delta = impulse / mass;
    if (Number.isFinite(delta)) return velocity + delta;
    // The final velocity can fit even when a large opposing impulse / mass overflows.
    return 2 * (velocity / 2 + (impulse / 2) / mass);
  }

  function ballEnergy({ mass, vx, vy }) {
    const halfMass = mass / 2;
    const speedSq = vx * vx + vy * vy;
    const minNormal = 2 ** -1022;
    if (Number.isFinite(speedSq) && speedSq >= minNormal && halfMass >= minNormal) {
      return halfMass * speedSq;
    }
    // A finite energy may involve a speed whose square cannot be represented.
    const scale = Math.sqrt(mass) * Math.SQRT1_2;
    return (vx * scale) ** 2 + (vy * scale) ** 2;
  }

  class World {
    constructor({ width = 840, height = 480, restitution = 1, drag = 0 } = {}) {
      if (!positive(width) || !positive(height)) {
        throw new RangeError('Court dimensions must be positive finite numbers.');
      }
      this.width = width;
      this.height = height;
      this.restitution = restitution;
      this.drag = drag;
      this.balls = [];
      this.bumpers = [];
      this.rails = [];
      this.gates = [];
      this._surfaceRestitution = Object.freeze({});
      this.resetMeasurements();
    }

    resetMeasurements() {
      this.time = 0;
      this.ballHits = 0;
      this.wallHits = 0;
      this.bumperHits = 0;
      this.railHits = 0;
      for (const gate of this.gates) {
        gate.counts.forward = 0;
        gate.counts.reverse = 0;
      }
    }

    get restitution() {
      return this._restitution;
    }

    set restitution(value) {
      validateRestitution(value);
      this._restitution = value;
    }

    get surfaceRestitution() {
      return this._surfaceRestitution;
    }

    setSurfaceRestitution(surface, value) {
      const match = typeof surface === 'string' && /^(wall|bumper|rail):([^:]+)$/.exec(surface);
      if (!match) throw new RangeError('Unknown fixed surface: ' + surface);
      const [, kind, key] = match;
      const exists = kind === 'wall' ? Object.hasOwn(wallNormals, key)
        : /^[1-9]\d*$/.test(key) && Number(key) <= (kind === 'rail' ? this.rails : this.bumpers).length;
      if (!exists) throw new RangeError('Unknown fixed surface: ' + surface);
      const overrides = { ...this.surfaceRestitution };
      if (value === null) delete overrides[surface];
      else {
        validateRestitution(value);
        overrides[surface] = value;
      }
      this._surfaceRestitution = Object.freeze(overrides);
    }

    get drag() {
      return this._drag;
    }

    set drag(value) {
      if (!Number.isFinite(value) || value < 0) {
        throw new RangeError('Linear drag must be a nonnegative finite number.');
      }
      this._drag = value;
    }

    canPlace(x, y, radius) {
      return hasSpace(this, x, y, radius, 0);
    }

    addBall({ x, y, radius = 20, vx = 0, vy = 0, mass = (radius / 20) ** 2 }) {
      return placeBall(this, { x, y, radius, vx, vy, mass }, 0);
    }

    addBumper({ x, y, radius = 25 }) {
      return placeBumper(this, { x, y, radius }, 0);
    }

    canPlaceRail({ x1, y1, x2, y2, radius = 8 }) {
      return railFits(this, { x1, y1, x2, y2, radius }, 0);
    }

    addRail({ x1, y1, x2, y2, radius = 8 }) {
      return placeRail(this, { x1, y1, x2, y2, radius }, 0);
    }

    canPlaceGate(segment) {
      return gateFits(this, segment);
    }

    addGate({ x1, y1, x2, y2 }) {
      return placeGate(this, { x1, y1, x2, y2 });
    }

    applyImpulse(ballId, jx, jy) {
      const ball = this.balls[ballId - 1];
      if (!Number.isSafeInteger(ballId) || !ball) throw new RangeError('Choose an existing ball ID for the impulse.');
      if (!Number.isFinite(jx) || !Number.isFinite(jy)) throw new RangeError('Impulse components must be finite numbers.');
      const vx = velocityAfterImpulse(ball.vx, jx, ball.mass);
      const vy = velocityAfterImpulse(ball.vy, jy, ball.mass);
      if (!Number.isFinite(vx) || !Number.isFinite(vy)) throw new RangeError('The impulse exceeds the velocity range.');
      Object.assign(ball, { vx, vy });
      return ball;
    }

    step(seconds = TICK, impacts, stopOn) {
      validateDuration(this, seconds);
      let crossings;
      // Keep step(seconds, impactArray, predicate) for existing callers.
      // Named options let a caller request either stream independently.
      if (impacts && typeof impacts === 'object' && !Array.isArray(impacts) &&
          ['impacts', 'crossings', 'stopOn'].some(key => Object.hasOwn(impacts, key))) {
        if (stopOn !== undefined) throw new TypeError('Specify stopOn in the step options.');
        ({ impacts, crossings, stopOn } = impacts);
      }
      if (impacts !== undefined && !Array.isArray(impacts)) throw new TypeError('Expected an impact array.');
      validateCrossings(crossings);
      if (stopOn === undefined) {
        evolve(this, seconds, { impacts, crossings });
        return;
      }
      if (typeof stopOn !== 'function') throw new TypeError('Expected an impact predicate.');
      const events = impacts ?? [];
      let next = events.length;
      let match;
      function afterImpact() {
        while (next < events.length) {
          const event = events[next++];
          if (event.type !== 'gate' && stopOn(event)) {
            match = event;
            return false;
          }
        }
        return true;
      }
      evolve(this, seconds, { impacts: events, afterImpact, crossings });
      return match;
    }

    nextImpact(crossings) {
      validateCrossings(crossings);
      const impacts = [];
      evolve(this, Infinity, { impacts, afterImpact: () => false, crossings });
      return impacts;
    }

    forecast(ballId, seconds = FORECAST_SECONDS) {
      if (!Number.isSafeInteger(ballId) || ballId < 1 || ballId > this.balls.length) {
        throw new RangeError('Choose an existing ball ID to forecast.');
      }
      validateDuration(this, seconds);
      const copy = World.fromSnapshot(this.snapshot());
      const ball = copy.balls[ballId - 1];
      const points = [];
      function mark(time, hits = 0) {
        const last = points.at(-1);
        if (last && last.time === time && last.x === ball.x && last.y === ball.y) last.hits += hits;
        else points.push({ time, x: ball.x, y: ball.y, hits });
      }
      mark(copy.time);
      let instants = 0;
      function afterImpact(time, contacts) {
        let hits = 0;
        for (const { a, b } of contacts.values()) {
          if (a === ball || b === ball) hits++;
        }
        if (hits) mark(time, hits);
        return ++instants < MAX_FORECAST_INSTANTS;
      }
      const complete = evolve(copy, seconds, { afterImpact });
      mark(copy.time);
      return { ballId, complete, points };
    }

    get kineticEnergy() {
      return this.balls.reduce((energy, ball) => energy + ballEnergy(ball), 0);
    }

    snapshot() {
      const state = {
        width: this.width, height: this.height, restitution: this.restitution,
        time: this.time, ballHits: this.ballHits, wallHits: this.wallHits,
        kineticEnergy: this.kineticEnergy, balls: this.balls.map(ball => ({ ...ball }))
      };
      if (this.drag) state.drag = this.drag;
      if (this.bumpers.length) {
        state.bumpers = this.bumpers.map(bumper => ({ ...bumper }));
        state.bumperHits = this.bumperHits;
      }
      if (this.rails.length) {
        state.rails = this.rails.map(rail => ({ ...rail }));
        state.railHits = this.railHits;
      }
      if (this.gates.length) state.gates = this.gates.map(gate => ({ ...gate, counts: { ...gate.counts } }));
      if (Object.keys(this.surfaceRestitution).length) state.surfaceRestitution = { ...this.surfaceRestitution };
      return state;
    }

    static fromSnapshot(state) {
      if (!state || !Array.isArray(state.balls) || !positive(state.width) || !positive(state.height) ||
          !Number.isFinite(state.restitution)) throw new RangeError('Invalid checkpoint court.');
      const { time, ballHits, wallHits, bumpers = [], bumperHits = 0, rails = [], railHits = 0, gates = [] } = state;
      if (!Number.isFinite(time) || time < 0 || !Array.isArray(bumpers) || !Array.isArray(rails) || !Array.isArray(gates) ||
          ![ballHits, wallHits, bumperHits, railHits].every(validCount) ||
          (!bumpers.length && bumperHits > 0) || (!rails.length && railHits > 0)) {
        throw new RangeError('Invalid checkpoint time or impact counts.');
      }

      const world = new World(state);
      // Numerical contact positions can differ from exact tangency by a few ulps.
      // Keep the original coordinates so continuing a run introduces no drift.
      function restore(records, place) {
        for (const [i, record] of records.entries()) {
          if (record?.id !== i + 1) throw new RangeError('Checkpoint IDs must start at 1 and be in order.');
          place(world, record, RELATIVE_CONTACT_EPS);
        }
      }
      restore(bumpers, placeBumper);
      restore(rails, placeRail);
      restore(state.balls, placeBall);
      restore(gates, placeGate);
      if (state.surfaceRestitution !== undefined) {
        const overrides = state.surfaceRestitution;
        if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
          throw new RangeError('Invalid checkpoint surface restitution.');
        }
        for (const [surface, value] of Object.entries(overrides)) {
          validateRestitution(value);
          world.setSurfaceRestitution(surface, value);
        }
      }
      Object.assign(world, { time, ballHits, wallHits, bumperHits, railHits });
      return world;
    }
  }

  return { World, TICK, FORECAST_SECONDS, ballEnergy };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CourtPhysics;
