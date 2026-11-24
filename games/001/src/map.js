(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Atlas.map = factory();
})(globalThis, function () {
  'use strict';

  // The plan stays north-up. One world unit represents one metre.
  function layout(bounds, width, height) {
    const scale = Math.min(width / (bounds.east - bounds.west + 10),
      height / (bounds.south - bounds.north + 10));
    return {
      scale,
      cx: width / 2 - (bounds.east + bounds.west) * scale / 2,
      cy: height / 2 - (bounds.south + bounds.north) * scale / 2
    };
  }
  function project(plan, x, z) {
    return [plan.cx + x * plan.scale, plan.cy + z * plan.scale];
  }
  function pickPlace(plan, places, px, py, radius = 15) {
    let nearest = null, best = radius;
    for (const place of places) {
      const [x, y] = project(plan, ...place.point);
      const distance = Math.hypot(px - x, py - y);
      if (distance <= best) {
        nearest = place;
        best = distance;
      }
    }
    return nearest;
  }

  const daylight = {
    land: '#dee2ca', grid: '#cbd2b9', ground: '#e7dfc8', edge: '#adad91',
    path: '#f7f0d9', border: '#cebea0', bed: '#c6d2a9', tree: '#b4c69c',
    treeEdge: '#9bae86', building: '#d6af8e', roof: '#b78e71', copper: '#9aafa0',
    water: '#84b7ad', mark: '#476657', paper: '#fff8e7', active: '#9e5439', cone: 'rgba(172,88,51,.19)'
  };
  const night = {
    land: '#30463e', grid: '#394e43', ground: '#48574a', edge: '#64715d',
    path: '#65735e', border: '#536354', bed: '#4c6650', tree: '#46624d',
    treeEdge: '#526f55', building: '#8b7964', roof: '#695f50', copper: '#718d7c',
    water: '#35645e', mark: '#d8dec4', paper: '#263e34', active: '#edb480', cone: 'rgba(253,199,132,.22)'
  };

  function circle(ctx, x, y, r, fill, stroke) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  }
  function line(ctx, x1, y1, x2, y2, color) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  function drawGround(ctx, world, plan, width, height, c) {
    ctx.fillStyle = c.land;
    ctx.fillRect(0, 0, width, height);
    const grid = 10 * plan.scale;
    ctx.lineWidth = 0.55;
    for (let x = plan.cx % grid; x < width; x += grid) line(ctx, x, 0, x, height, c.grid);
    for (let y = plan.cy % grid; y < height; y += grid) line(ctx, 0, y, width, y, c.grid);

    ctx.save();
    ctx.translate(plan.cx, plan.cy);
    ctx.scale(plan.scale, plan.scale);
    function rect(x, z, w, d, fill, stroke) {
      ctx.fillStyle = fill;
      ctx.fillRect(x - w / 2, z - d / 2, w, d);
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.strokeRect(x - w / 2, z - d / 2, w, d);
      }
    }
    ctx.lineWidth = 0.65 / plan.scale;
    const b = world.bounds;
    rect((b.east + b.west) / 2, (b.south + b.north) / 2, b.east - b.west,
      b.south - b.north, c.ground, c.edge);
    for (const p of world.paths) rect(p.x, p.z, p.w, p.d, c.border);
    for (const p of world.paths) rect(p.x, p.z, p.w - 0.7, p.d - 0.7, c.path);
    for (const pool of world.pools || []) rect(pool.x, pool.z, pool.w, pool.d, c.water, c.edge);
    circle(ctx, 0.5, -5.2, 3.5, c.path, c.border);
    for (const bed of world.beds) rect(bed.x, bed.z, bed.w, bed.d, c.bed, c.edge);
    for (const tree of world.trees) circle(ctx, tree.x, tree.z, tree.r * 0.83, c.tree, c.treeEdge);
    for (const bld of world.buildings) {
      const {x, z, w, d, id} = bld;
      const color = ['tower', 'hall', 'pavilion'].includes(id) ? c.copper : c.building;
      rect(x + 0.6, z + 0.75, w, d, c.border);
      rect(x, z, w, d, color, c.roof);
      if (w > 7 && d > 7) {
        ctx.strokeStyle = c.roof;
        ctx.strokeRect(x - w / 2 + 1.3, z - d / 2 + 1.3, w - 2.6, d - 2.6);
      }
    }
    for (const s of world.surfaces || []) {
      if (s.material !== 'timber') continue;
      const x = (s.west+s.east)/2, z = (s.north+s.south)/2;
      rect(x,z,s.east-s.west,s.south-s.north,c.building,c.roof);
      for (let u=s.west+1; u<s.east; u+=1.4) line(ctx,u,s.north,u,s.south,c.roof);
    }
    ctx.restore();
  }
  function drawHeading(ctx, plan, state, c, large) {
    const [x, y] = project(plan, state.x, state.z);
    const r = large ? 6.7 : 4.8;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(state.yaw);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, large ? 27 : 18, -Math.PI / 2 - 0.52, -Math.PI / 2 + 0.52);
    ctx.closePath();
    ctx.fillStyle = c.cone;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.55);
    ctx.lineTo(r * 0.86, r);
    ctx.lineTo(0, r * 0.57);
    ctx.lineTo(-r * 0.86, r);
    ctx.closePath();
    ctx.fillStyle = c.active;
    ctx.strokeStyle = c.paper;
    ctx.lineWidth = large ? 1.8 : 1.3;
    ctx.lineJoin = 'round';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  function drawRoute(ctx, plan, state, points, palette, large) {
    if (!points || !points.length) return;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(...project(plan, state.x, state.z));
    for (const point of points) ctx.lineTo(...project(plan, ...point));
    ctx.lineWidth = large ? 5 : 3.5;
    ctx.strokeStyle = palette.paper;
    ctx.stroke();
    ctx.lineWidth = large ? 2.6 : 1.7;
    ctx.strokeStyle = palette.active;
    ctx.stroke();
    const [x, y] = project(plan, ...points[points.length-1]);
    ctx.translate(x,y);
    ctx.rotate(Math.PI/4);
    const size = large ? 6.5 : 4;
    ctx.fillStyle = palette.active;
    ctx.fillRect(-size/2,-size/2,size,size);
    ctx.lineWidth = 1;
    ctx.strokeStyle = palette.paper;
    ctx.strokeRect(-size/2,-size/2,size,size);
    ctx.restore();
  }

  class CampusMap {
    constructor(canvas, world, large = false) {
      this.canvas = canvas;
      this.world = world;
      this.large = large;
      this.underlay = canvas.ownerDocument.createElement('canvas');
      this.plan = null;
    }
    draw(state, selectedId, route, markers = this.world.places) {
      const canvas = this.canvas;
      const width = canvas.clientWidth, height = canvas.clientHeight;
      if (width < 1 || height < 1) return;
      const ratio = Math.min(2, canvas.ownerDocument.defaultView.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
      const c = state.night ? night : daylight;
      if (!this.plan || this.width !== width || this.height !== height ||
          canvas.width !== w || canvas.height !== h || this.palette !== c) {
        canvas.width = this.underlay.width = w;
        canvas.height = this.underlay.height = h;
        this.plan = layout(this.world.bounds, width, height);
        this.width = width;
        this.height = height;
        this.palette = c;
        const base = this.underlay.getContext('2d');
        base.setTransform(w / width, 0, 0, h / height, 0, 0);
        drawGround(base, this.world, this.plan, width, height, c);
        base.fillStyle = c.mark;
        base.textAlign = 'left';
        base.textBaseline = 'middle';
        base.font = 'bold 9px sans-serif';
        base.fillText('N', 7, 9);
        line(base, 10, 15, 10, 23, c.mark);
        if (this.large) {
          const len = 10 * this.plan.scale;
          base.lineWidth = 1.2;
          line(base, 9, height - 8, 9 + len, height - 8, c.mark);
          for (const x of [9, 9 + len]) line(base, x, height - 11, x, height - 7, c.mark);
          base.fillText('10 m', 9, height - 17);
        }
      }
      const ctx = canvas.getContext('2d');
      ctx.setTransform(w / width, 0, 0, h / height, 0, 0);
      ctx.drawImage(this.underlay, 0, 0, width, height);
      drawRoute(ctx, this.plan, state, route, c, this.large);
      for (const [i, place] of markers.entries()) {
        const [x, y] = project(this.plan, ...place.point);
        const selected = place.id === selectedId;
        const r = this.large ? (selected ? 9.5 : 7.5) : (selected ? 3.5 : 2.4);
        ctx.lineWidth = this.large ? 1.5 : 1;
        circle(ctx, x, y, r, selected ? c.active : c.mark, c.paper);
        if (this.large) {
          ctx.fillStyle = c.paper;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = 'bold 10px sans-serif';
          ctx.fillText(String(i + 1), x, y + 0.5);
        }
      }
      drawHeading(ctx, this.plan, state, c, this.large);
    }
    pick(clientX, clientY) {
      if (!this.plan) return null;
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return pickPlace(this.plan, this.world.places,
        (clientX - rect.left) * this.width / rect.width,
        (clientY - rect.top) * this.height / rect.height);
    }
  }
  return {layout, project, pickPlace, drawRoute, CampusMap};
});
