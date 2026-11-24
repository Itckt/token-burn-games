(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const { radians, clamp, wrap, add, subtract, scale, dot, cross, normalize, perspective,
    lookAt, multiply, project } = common ? require("./math.js") : root.OrbitAtlas.math;
  const { byId } = common ? require("./catalog.js") : root.OrbitAtlas.catalog;
  const { orbits } = common ? require("./physics.js") : root.OrbitAtlas.physics;

  const FOV = radians(28);
  const HOME = Object.freeze({ yaw: 2.12, pitch: 0.46, zoom: 1 });
  const halfFovTangent = Math.tan(FOV / 2);
  function overviewPitch(aspect) {
    const ratio = 1.85 / aspect;
    return Math.atan(Math.tan(HOME.pitch) * clamp(ratio ** (ratio > 1 ? 1.05 : 1.6), 0.30, 3.2));
  }
  function fitDistance(aspect, pitch = overviewPitch(aspect)) {
    const horizontalFit = Math.hypot(24, 30.9 / (halfFovTangent * aspect));
    const verticalFit = 28 * Math.cos(pitch) + 28 * Math.sin(pitch) / (halfFovTangent * 1.125) + 3.7;
    return Math.max(horizontalFit, verticalFit);
  }
  const shortestAngle = difference => wrap(difference + Math.PI) - Math.PI;

  function pairBearing(a, b) {
    return Math.atan2(a[2] - b[2], b[0] - a[0]);
  }

  function pairFit(pair, states, center, aspect, direction, right, up) {
    const vertical = halfFovTangent * 0.8, horizontal = halfFovTangent * aspect * 0.84;
    let distance = 0;
    for (const id of pair) {
      const delta = subtract(states[id].position, center);
      const radius = byId[id].radius * (id === "saturn" ? 2.28 : 1);
      // Tangency to each frustum plane, including the depth of the nearer endpoint.
      const xFit = (Math.abs(dot(delta, right)) + radius * Math.hypot(1, horizontal)) / horizontal;
      const yFit = (Math.abs(dot(delta, up)) + radius * Math.hypot(1, vertical)) / vertical;
      distance = Math.max(distance, dot(delta, direction) + Math.max(xFit, yFit));
    }
    return distance;
  }

  class OrbitCamera {
    constructor(aspect = 1.8) {
      this.following = null;
      this.framedOrbit = null;
      this.pair = null;
      this.previousPairFit = null;
      this.goal = { ...HOME };
      this.savedOverview = { ...HOME };
      this.yaw = HOME.yaw;
      this.pitch = HOME.pitch;
      this.distance = fitDistance(aspect);
      this.center = [0, 0, 0];
      this.offset = [0, 0, 0];
      this.overviewBlend = 1;
    }
    orbit(dx, dy) {
      this.goal.yaw = wrap(this.goal.yaw - dx * 0.006);
      this.goal.pitch = clamp(this.goal.pitch + dy * 0.006, -1.43, 1.43);
    }
    zoomBy(factor) {
      if (!(Number.isFinite(factor) && factor > 0)) return;
      this.goal.zoom = clamp(this.goal.zoom * factor, this.following ? 0.34 : 0.12, 3.5);
    }
    get focused() { return Boolean(this.following || this.framedOrbit || this.pair); }
    beginFocus(target) {
      if (!this.focused) this.savedOverview = { ...this.goal };
      this.following = null;
      this.framedOrbit = null;
      this.pair = null;
      this.previousPairFit = null;
      this.offset = subtract(this.center, target);
    }
    follow(id, states) {
      if (!Object.hasOwn(byId, id) || !states[id] || this.following === id) return;
      this.beginFocus(states[id].position);
      this.following = id;
      this.goal.zoom = 1;
    }
    frameOrbit(id) {
      if (!Object.hasOwn(orbits, id) || this.framedOrbit === id) return;
      const orbit = orbits[id];
      // Center the ellipse rather than its focus and lay its long axis across
      // the view. Leave a little inclination so the rest of the system has depth.
      this.orbitCenter = scale(orbit.peri, -orbit.e * byId[id].track);
      this.beginFocus(this.orbitCenter);
      this.framedOrbit = id;
      this.goal = { yaw: Math.atan2(-orbit.peri[2], orbit.peri[0]), pitch: 1.36, zoom: 1 };
    }
    framePair(from, to, states) {
      if (from === to || ![from, to].every(id => (id === "sun" || Object.hasOwn(orbits, id)) && states[id])) return;
      if (this.pair?.includes(from) && this.pair.includes(to)) return;
      const a = states[from].position, b = states[to].position;
      this.beginFocus(scale(add(a, b), 0.5));
      this.pair = [from, to];
      this.bearing = pairBearing(a, b);
      const turn = shortestAngle(this.bearing - this.yaw);
      const yaw = this.bearing + (Math.abs(turn) > Math.PI / 2 ? Math.PI : 0);
      this.goal = { yaw, pitch: 0.48, zoom: 1 };
    }
    overview(reset = false) {
      if (!this.focused && !reset) return;
      this.offset = this.center.slice();
      this.following = null;
      this.framedOrbit = null;
      this.pair = null;
      this.previousPairFit = null;
      this.goal = { ...(reset ? HOME : this.savedOverview) };
    }
    step(seconds, states, aspect) {
      const dt = Math.max(0, seconds);
      const smooth = 1 - Math.exp(-7 * dt);
      const body = byId[this.following];
      const framed = byId[this.framedOrbit];
      let target = body ? states[body.id].position : framed ? this.orbitCenter : [0, 0, 0];
      if (this.pair) {
        const a = states[this.pair[0]].position, b = states[this.pair[1]].position;
        target = scale(add(a, b), 0.5);
        const bearing = pairBearing(a, b);
        this.goal.yaw = wrap(this.goal.yaw + shortestAngle(bearing - this.bearing));
        this.bearing = bearing;
      }
      this.offset = scale(this.offset, 1 - smooth);
      this.center = add(target, this.offset);
      this.yaw += shortestAngle(this.goal.yaw - this.yaw) * smooth;
      this.pitch += (this.goal.pitch - this.pitch) * smooth;
      const homePitch = overviewPitch(aspect), homeDistance = fitDistance(aspect, homePitch);
      this.overviewBlend += ((this.focused ? 0 : 1) - this.overviewBlend) * smooth;

      const pitch = clamp(this.pitch + (homePitch - HOME.pitch) * this.overviewBlend, -1.43, 1.43);
      const cp = Math.cos(pitch);
      const direction = [cp * Math.sin(this.yaw), Math.sin(pitch), cp * Math.cos(this.yaw)];
      const right = normalize(cross([0, 1, 0], direction));
      const vertical = cross(direction, right);
      const roll = -0.135 * this.overviewBlend;
      const up = add(scale(vertical, Math.cos(roll)), scale(right, Math.sin(roll)));
      let desiredDistance = homeDistance;
      if (body) desiredDistance = body.radius * (body.id === "saturn" ? 15 : 10.5);
      if (framed) {
        const halfAngle = Math.atan(halfFovTangent * Math.min(1, aspect));
        desiredDistance = (framed.track + framed.radius) * 1.1 / Math.sin(halfAngle);
      }
      if (this.pair) {
        desiredDistance = pairFit(this.pair, states, target, aspect, direction, cross(up, direction), up);
        // Ease the handoff and user zoom independently of changes to separation or viewport.
        if (this.previousPairFit !== null) this.distance *= desiredDistance / this.previousPairFit;
        this.previousPairFit = desiredDistance;
      }
      this.distance *= Math.exp(Math.log(desiredDistance * this.goal.zoom / this.distance) * smooth);
      const eye = add(this.center, scale(direction, this.distance));
      const projection = perspective(FOV, aspect, 0.045, Math.max(450, this.distance + 200));
      // Center the apparent ellipse: the near half of a perspective orbit looks larger.
      const depthSpan = byId.neptune.track * Math.cos(homePitch);
      const heightSpan = byId.neptune.track * Math.sin(homePitch);
      projection[9] = -depthSpan * heightSpan * this.overviewBlend
        / ((homeDistance * homeDistance - depthSpan * depthSpan) * halfFovTangent);
      const matrix = multiply(projection, lookAt(eye, this.center, up));
      return { eye, center: this.center, matrix, projection, direction, up,
        focalLength: 1 / Math.tan(FOV / 2), distance: this.distance };
    }
  }

  function screenBodies(bodies, states, view, width, height) {
    const result = [];
    for (const body of bodies) {
      const p = project(states[body.id].position, view.matrix, width, height);
      if (!p) continue;
      const radius = body.radius * view.focalLength * height / (2 * p.depth);
      if (p.x < -radius || p.y < -radius || p.x > width + radius || p.y > height + radius) continue;
      result.push({ ...p, id: body.id, radius });
    }
    return result;
  }

  function covered(point, points) {
    return points.some(near => near.depth < point.depth
      && Math.hypot(near.x - point.x, near.y - point.y) + point.radius <= near.radius);
  }

  function pickBody(points, x, y) {
    let hit = null, best = Infinity;
    for (const point of points) {
      const d = Math.hypot(point.x - x, point.y - y);
      if (d > Math.max(10, point.radius + 3)) continue;
      if (covered(point, points)) continue;
      // A visible disk takes precedence over the extra touch margin of its neighbor.
      const rank = d <= point.radius ? point.depth : 1e6 + d;
      if (rank < best) { best = rank; hit = point.id; }
    }
    return hit;
  }

  // Reserve the stage controls, map key and visible disks before placing text.
  function labelLayout(points, selected, width, height, showKey = false, showTrails = false) {
    const placed = [];
    const keyHeight = (showKey ? 56 : 40) + (showTrails ? 18 : 0);
    const sorted = points.slice().sort((a, b) => (b.id === selected) - (a.id === selected)
      || a.depth - b.depth);
    const occupied = [
      { x: 0, y: 0, w: Math.min(177, width * 0.6), h: 49 },
      { x: width - 58, y: 0, w: 58, h: 55 },
      { x: 0, y: height - keyHeight, w: Math.min(235, width * 0.6), h: keyHeight },
      { x: width - 112, y: height - 50, w: 112, h: 50 }
    ];
    const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x
      && a.y < b.y + b.h && a.y + a.h > b.y;
    for (const p of points) {
      occupied.push({ x: p.x - p.radius, y: p.y - p.radius, w: 2 * p.radius, h: 2 * p.radius });
    }
    for (const p of sorted) {
      if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue;
      if (covered(p, points)) continue;
      const w = byId[p.id].name.length * 7 + 15, h = 21, gap = p.radius + 5;
      const options = [
        [p.x + gap, p.y - h], [p.x - gap - w, p.y - h], [p.x + gap, p.y + 1],
        [p.x - gap - w, p.y + 1], [p.x - w / 2, p.y - gap - h], [p.x - w / 2, p.y + gap]
      ];
      for (const [x, y] of options) {
        const box = { x, y, w, h };
        if (x < 4 || y < 4 || x + w > width - 4 || y + h > height - 4) continue;
        if (occupied.some(other => overlaps(box, other))) continue;
        occupied.push(box);
        placed.push({ ...box, id: p.id });
        break;
      }
    }
    return placed;
  }

  const api = { FOV, HOME, fitDistance, OrbitCamera, screenBodies, covered, pickBody, labelLayout };
  if (common) module.exports = api;
  else (root.OrbitAtlas ||= {}).camera = api;
})(globalThis);
