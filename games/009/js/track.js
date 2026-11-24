(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./math.js") : root.FoundryMath);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FoundryTrack = api;
})(globalThis, function (M) {
  "use strict";
  const {add, mul, madd, cross, unit, sub, length, smooth, TAU} = M;
  const LIBRARY = [
    {id: "straight", code: "S", name: "Straight", description: "A level length of track"},
    {id: "ramp", code: "D", name: "Ramp", description: "A smooth slope. Shift-click to build uphill"},
    {id: "left", code: "L", name: "Left bend", description: "A banked quarter-turn to the left"},
    {id: "right", code: "R", name: "Right bend", description: "A banked quarter-turn to the right"},
    {id: "loop", code: "O", name: "Loop", description: "A full vertical loop with a staggered exit"},
    {id: "chicane", code: "Z", name: "S-bend", description: "Two linked curves that shift the lane sideways"},
    {id: "drive", code: "P", name: "Drive strip", description: "Powered rollers build forward speed up to 12 m/s"},
    {id: "brake", code: "B", name: "Brake strip", description: "Brake shoes ease passing marbles toward 4 m/s"},
    {id: "jump", code: "J", name: "Gap jump", description: "An upturned lip launches marbles across a 2 m gap"}
  ];
  const PRESETS = {
    switchback: {name: "Kowloon Switchback", height: 7.1, pieces: ["ramp", "ramp", "loop", "straight", "right", "right", "straight", "chicane"]},
    hairpin: {name: "Golden Hairpin", height: 4.0, pieces: ["ramp", "right", "right", "straight", "left"]},
    empty: {name: "Untitled track", height: 4.0, pieces: []},
    relay: {name: "Lion Rock Relay", height: 4, pieces: ["ramp", "drive", "loop", "brake", "left", "straight", "right"]},
    podium: {name: "Podium Post", height: 4, pieces: ["straight", "jump", "straight", "brake", "left", "straight"]}
  };
  const LIMIT = 48;
  const MIN_HEIGHT = 0.9, MAX_HEIGHT = 12;
  const validHeight = height => Number.isFinite(height) && height >= MIN_HEIGHT && height <= MAX_HEIGHT;
  const RADIUS = 0.38;
  const MAX_LAUNCH_SPEED = 16;
  const STRIPS = {
    drive: {speed: 12, acceleration: 24},
    brake: {speed: 4, acceleration: 26}
  };
  // Unpowered lead at either end of the 4.8 m bed, one sample interval long.
  const STRIP_LEAD = 0.6;
  // Interior of the moulded channel, from left lip to right lip, in metres.
  const PROFILE = [
    [-0.88, 0.56], [-0.88, 0.29], [-0.77, 0.09], [-0.60, 0.018], [-0.40, 0],
    [0.40, 0], [0.60, 0.018], [0.77, 0.09], [0.88, 0.29], [0.88, 0.56]
  ];
  function point(frame, forward = 0, up = 0, side = 0) {
    return madd(madd(madd(frame.p, frame.t, forward), frame.n, up), frame.b, side);
  }
  // Transverse strips close the sawn channel bed and the two thick lips.
  // Winding faces outwards at each end so the exposed jump faces can collide.
  function endFaces(frame, sign) {
    const at = (side, up) => point(frame, 0, up, side);
    const faces = [];
    for (let i = 0; i < PROFILE.length-1; i++) {
      const [a,h] = PROFILE[i], [b,k] = PROFILE[i+1];
      if (b > a) faces.push([at(a,h), at(b,k), at(b,-0.15), at(a,-0.15)]);
    }
    for (const s of [-1,1]) {
      faces.push([at(0.87*s,-0.15), at(0.87*s,0.56), at(1.005*s,0.56), at(0.99*s,-0.13)]);
    }
    for (const face of faces) {
      const normal = cross(sub(face[1],face[0]), sub(face[3],face[0]));
      if (M.dot(normal,frame.t)*sign < 0) face.reverse();
    }
    return faces;
  }
  function piece(type, start) {
    const forward = [Math.cos(start.yaw), 0, Math.sin(start.yaw)];
    const side = [-forward[2], 0, forward[0]];
    const samples = [];
    let landingIndex = 0;
    function sample(x, y, z, tx, ty, tz, nx = 0, ny = 1, nz = 0) {
      const world = (a, b, c) => [forward[0] * a + side[0] * c, b, forward[2] * a + side[2] * c];
      const t = unit(world(tx, ty, tz));
      const b = unit(cross(t, world(nx, ny, nz)));
      const n = unit(cross(b, t));
      const p = add(start.p, world(x, y, z));
      const prev = samples[samples.length - 1];
      samples.push({p, t, b, n, s: prev ? prev.s + length(sub(p, prev.p)) : 0});
    }
    let yaw = start.yaw;
    if (type === "loop") {
      const r = 2.75, lead = 1.45, shift = 2.35;
      sample(0, 0, 0, 1, 0, 0);
      for (let i = 0; i <= 112; i++) {
        const angle = TAU * i / 112, sin = Math.sin(angle), cos = Math.cos(angle);
        sample(lead + r*sin, r*(1-cos), shift*(angle-sin)/TAU,
          r*cos, r*sin, shift*(1-cos)/TAU, -sin, cos, 0);
      }
      sample(lead * 2, 0, shift, 1, 0, 0);
    } else if (type === "left" || type === "right") {
      const sign = type === "left" ? -1 : 1, r = 3.35;
      yaw += sign * Math.PI / 2;
      for (let i = 0; i <= 36; i++) {
        const t = i / 36, a = t * Math.PI / 2;
        const bank = sign * 0.23 * Math.sin(Math.PI*t) ** 2;
        const sin = Math.sin(a), cos = Math.cos(a);
        sample(r*sin, 0, sign*r*(1-cos), cos, 0, sign*sin,
          -sign*sin*Math.sin(bank), Math.cos(bank), cos*Math.sin(bank));
      }
    } else if (type === "ramp" || type === "rise") {
      const up = type === "rise" || start.p[1] <= MIN_HEIGHT + 0.05;
      const dy = up ? 2.55 : -Math.min(3.1, start.p[1] - MIN_HEIGHT);
      for (let i = 0; i <= 42; i++) {
        const t = i / 42;
        sample(6.3*t, dy*smooth(t), 0, 6.3, dy*6*t*(1-t), 0);
      }
    } else if (type === "jump") {
      // Each deck meets its neighbour level. The open span counts towards
      // course distance, so gates and the elevation plot keep the same scale.
      for (let i = 0; i <= 24; i++) {
        const u = i / 24;
        sample(3.2*u, 0.56*u*u, 0, 3.2, 1.12*u, 0);
      }
      landingIndex = samples.length;
      for (let i = 0; i <= 30; i++) {
        const u = i / 30, remaining = 1-u;
        sample(5.2 + 4.2*u, 0.36*remaining*remaining, 0, 4.2, -0.72*remaining, 0);
      }
    } else if (type === "chicane") {
      for (let i = 0; i <= 42; i++) {
        const t = i / 42;
        sample(5.7*t, 0, -2.5*smooth(t), 5.7, 0, -15*t*(1-t));
      }
    } else {
      const lengths = {straight: 3.65, launch: 2.5, finish: 2.65, drive: 4.8, brake: 4.8};
      if (!Object.hasOwn(lengths,type)) throw new RangeError("Unknown track piece: " + type);
      for (let i = 0; i <= 8; i++) sample(lengths[type]*i/8, 0, 0, 1, 0, 0);
    }
    const last = samples[samples.length - 1];
    const decks = landingIndex ? [samples.slice(0, landingIndex), samples.slice(landingIndex)] : [samples];
    return {type, samples, decks, length: last.s, end: {p: last.p.slice(), yaw}};
  }
  function atDistance(section, distance) {
    const f = section.samples;
    if (distance <= 0) return f[0];
    if (distance >= section.length) return f[f.length-1];
    let lo = 0, hi = f.length-1;
    while (hi - lo > 1) {
      const mid = (hi + lo) >> 1;
      if (f[mid].s <= distance) lo = mid;
      else hi = mid;
    }
    const t = (distance-f[lo].s) / (f[hi].s-f[lo].s);
    const axis = unit(M.lerp(f[lo].t, f[hi].t, t));
    const side = unit(cross(axis, M.lerp(f[lo].n, f[hi].n, t)));
    return {p: M.lerp(f[lo].p, f[hi].p, t), t: axis, b: side, n: cross(side, axis), s: distance};
  }
  // A join belongs to the section that starts there. The two end bays are
  // included, so the profile, split gate and editor share one distance axis.
  function sectionIndexAt(sections, distance) {
    if (!sections.length || !Number.isFinite(distance)) return -1;
    const next = sections.findIndex(section => section.startDistance > distance);
    return next < 0 ? sections.length - 1 : Math.max(0, next - 1);
  }
  function build(layout) {
    let pose = {p: [-9, layout.height, -3.8], yaw: 0};
    let courseLength = 0;
    const sections = ["launch", ...layout.pieces, "finish"].map(type => {
      const section = piece(type, pose);
      section.startDistance = courseLength;
      courseLength += section.length;
      pose = section.end;
      return section;
    });
    const launch = sections[0], finish = sections[sections.length-1];
    const releaseAt = 1.86, finishAt = 1.22;
    const halfway = (releaseAt + finish.startDistance + finishAt) / 2;
    const splitSection = sections[sectionIndexAt(sections, halfway)];
    const split = splitSection.split = atDistance(splitSection, halfway - splitSection.startDistance);
    if (splitSection.type === "jump") {
      const [takeoff, landing] = splitSection.decks;
      split.clearance = 2.4;
      split.freeStanding = split.s > takeoff.at(-1).s && split.s < landing[0].s;
    }
    const release = atDistance(launch, releaseAt), flag = atDistance(finish, finishAt);
    const landmarks = [point(release, 0, 1.62), point(flag, 0, 2.4),
      ...[-1, 1].map(side => point(split, 0, split.clearance ?? 1.15, side*1.12))];
    const points = [...landmarks];
    let peak = 0;
    for (const section of sections) for (const f of section.samples) {
      peak = Math.max(peak, f.p[1]);
      points.push(point(f, 0, 0.65, -1.12), point(f, 0, 0.65, 1.12));
    }
    const extents = M.bounds(points);
    extents.min[1] = 0;
    return {sections, launch: release, finish: flag, split, length: courseLength, peak, bounds: extents, landmarks};
  }

  const clone = layout => ({name: layout.name, height: layout.height, pieces: layout.pieces.slice()});
  const validIndex = (index, count) => Number.isInteger(index) && index >= 0 && index < count;
  class Editor {
    constructor(layout = PRESETS.switchback) {
      this.layout = clone(layout);
      this.past = [];
      this.future = [];
    }
    commit(next) {
      this.past.push(this.layout);
      if (this.past.length > 80) this.past.shift();
      this.layout = clone(next);
      this.future.length = 0;
      return true;
    }
    append(type) {
      return this.insert(this.layout.pieces.length, type);
    }
    setHeight(height) {
      return validHeight(height) && height !== this.layout.height && this.commit({...this.layout, height});
    }
    insert(index, type) {
      const current = this.layout.pieces;
      if (current.length >= LIMIT || !validIndex(index, current.length + 1)) return false;
      if (type !== "rise" && !LIBRARY.some(item => item.id === type)) return false;
      const pieces = current.slice();
      pieces.splice(index, 0, type);
      return this.commit({...this.layout, pieces});
    }
    remove(index = this.layout.pieces.length - 1) {
      if (!validIndex(index, this.layout.pieces.length)) return false;
      const pieces = this.layout.pieces.slice();
      pieces.splice(index, 1);
      return this.commit({...this.layout, pieces});
    }
    move(from, to) {
      const current = this.layout.pieces;
      if (!validIndex(from, current.length) || !validIndex(to, current.length)) return false;
      const pieces = current.slice();
      const [piece] = pieces.splice(from, 1);
      pieces.splice(to, 0, piece);
      if (pieces.every((type, i) => type === current[i])) return false;
      return this.commit({...this.layout, pieces});
    }
    load(key) {
      return Object.prototype.hasOwnProperty.call(PRESETS, key) && this.commit(PRESETS[key]);
    }
    undo() {
      if (!this.past.length) return false;
      this.future.push(this.layout);
      this.layout = this.past.pop();
      return true;
    }
    redo() {
      if (!this.future.length) return false;
      this.past.push(this.layout);
      this.layout = this.future.pop();
      return true;
    }
  }
  return {LIBRARY, PRESETS, PROFILE, STRIPS, STRIP_LEAD, LIMIT, RADIUS, MIN_HEIGHT, MAX_HEIGHT, validHeight, MAX_LAUNCH_SPEED,
    point, endFaces, piece, atDistance, sectionIndexAt, build, Editor};
});
