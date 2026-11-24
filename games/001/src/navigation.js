(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./collision.js'));
  else root.Atlas.navigation = factory(root.Atlas.collision);
})(globalThis, function (collision) {
  'use strict';
  const {canStand, canWalk} = collision;
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  function lengthFrom(from, points) {
    let total = 0;
    for (const point of points) {
      total += distance(from, point);
      from = point;
    }
    return total;
  }
  function distanceToLeg(point, a, b) {
    const dx = b[0] - a[0], dz = b[1] - a[1], lengthSq = dx * dx + dz * dz;
    const t = lengthSq ? Math.max(0, Math.min(1, ((point[0]-a[0])*dx + (point[1]-a[1])*dz) / lengthSq)) : 0;
    return Math.hypot(point[0] - a[0] - t*dx, point[1] - a[1] - t*dz);
  }

  // A metre lattice is built only when the first obstructed route is requested.
  // Store clear edges as well as clear cells: a thin railing can fit between two cells.
  class WalkingGrid {
    constructor(world) {
      this.world = world;
      const {west, east, north, south} = world.bounds;
      this.width = Math.ceil(east - west);
      this.height = Math.ceil(south - north);
      this.x0 = west + .5;
      this.z0 = north + .5;
      this.free = new Uint8Array(this.width * this.height);
      this.edges = new Uint8Array(this.free.length);
      this.steps = [-1, 1, -this.width, this.width];
      for (let id = 0; id < this.free.length; id++) {
        const [x, z] = this.point(id);
        if (!canStand(x, z, world)) continue;
        this.free[id] = 1;
        if (id % this.width && this.free[id-1] && canWalk(x, z, x-1, z, world)) {
          this.edges[id] |= 1;
          this.edges[id-1] |= 2;
        }
        const above = id - this.width;
        if (above >= 0 && this.free[above] && canWalk(x, z, x, z-1, world)) {
          this.edges[id] |= 4;
          this.edges[above] |= 8;
        }
      }
    }
    point(id) {
      return [this.x0 + id % this.width, this.z0 + Math.floor(id / this.width)];
    }
    connectors([x, z]) {
      const col = Math.round(x - this.x0), row = Math.round(z - this.z0);
      const hits = [], limit = Math.max(this.width, this.height);
      // An off-grid start can be tucked between a post and a wall. Search farther
      // if its immediate neighbours are all on the other side of the obstruction.
      for (let ring = 0; ring <= limit && (ring <= 2 || !hits.length); ring++) {
        for (let j = Math.max(0, row-ring); j <= Math.min(this.height-1, row+ring); j++) {
          for (let i = Math.max(0, col-ring); i <= Math.min(this.width-1, col+ring); i++) {
            if (Math.max(Math.abs(i-col), Math.abs(j-row)) !== ring) continue;
            const id = j*this.width + i;
            if (this.free[id] && canWalk(x, z, this.x0+i, this.z0+j, this.world)) hits.push(id);
          }
        }
      }
      return hits.sort((a,b) => distance([x,z], this.point(a)) - distance([x,z], this.point(b)));
    }
    search(from, to) {
      const starts = this.connectors(from), goals = new Set(this.connectors(to));
      if (!starts.length || !goals.size) return null;
      const parent = new Int32Array(this.free.length).fill(-1);
      const queue = Array.from(starts);
      for (const id of starts) parent[id] = id;
      for (let head = 0; head < queue.length; head++) {
        const id = queue[head];
        if (goals.has(id)) {
          const path = [to];
          for (let n = id; ; n = parent[n]) {
            path.push(this.point(n));
            if (n === parent[n]) break;
          }
          return path.reverse();
        }
        for (let dir = 0; dir < 4; dir++) {
          if (!(this.edges[id] & (1 << dir))) continue;
          const next = id + this.steps[dir];
          if (parent[next] !== -1) continue;
          parent[next] = id;
          queue.push(next);
        }
      }
      return null;
    }
  }
  class Planner {
    constructor(world) {
      this.world = world;
      this.grid = null;
    }
    clear(a, b) { return canWalk(...a, ...b, this.world); }
    find(from, to) {
      if (this.clear(from, to)) return [to];
      if (!canStand(...from, this.world) || !canStand(...to, this.world)) return null;
      if (!this.grid) this.grid = new WalkingGrid(this.world);
      const cells = this.grid.search(from, to);
      if (!cells) return null;
      const turns = [];
      let anchor = from;
      for (let i = 1; i < cells.length; i++) {
        if (!this.clear(anchor, cells[i])) {
          anchor = cells[i-1];
          turns.push(anchor);
        }
      }
      turns.push(to);
      return turns;
    }
  }
  class WalkingRoute {
    constructor(planner, from, place, preview, destination = place.stamp.at) {
      this.planner = planner;
      this.place = place;
      this.destination = destination;
      this.anchor = from;
      this.points = preview.slice();
    }
    update(from) {
      const points = this.points;
      if (!points || distanceToLeg(from, this.anchor, points[0]) > 2 ||
          !this.planner.clear(from, points[0])) {
        this.points = this.planner.find(from, this.destination);
        this.anchor = from;
      } else {
        while (points.length > 1 && this.planner.clear(from, points[1])) {
          points.shift();
          this.anchor = from;
        }
      }
      return this.points;
    }
  }
  return {Planner, WalkingRoute, lengthFrom};
});
