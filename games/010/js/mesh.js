/* Meshes are plain indexed triangles. Batches use 16-bit indices on WebGL 1. */
(function () {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./math.js') : PocketPlaces.math;
  const TAU = Math.PI * 2;
  const STRIDE = 14;
  const parts = {fixed:0, fanBlade:1, teaSurface:2, catBody:3, catLeft:4, catRight:5, radioNeedle:6, radioLamp:7,
    blindCloth:8, blindHem:9, toastNear:10, toastFar:11, tillDrawer:12, tillTens:13, tillOnes:14};
  const empty = () => ({positions: [], normals: [], uvs: [], indices: []});

  function vertex(mesh, p, n, u = 0, v = 0) {
    mesh.positions.push(...p); mesh.normals.push(...n); mesh.uvs.push(u, v);
    return mesh.positions.length / 3 - 1;
  }

  function panel(width, height) {
    const m = empty(), x = width/2, y = height/2;
    for (const [a,b,u,v] of [[-x,-y,0,1],[x,-y,1,1],[x,y,1,0],[-x,y,0,0]]) {
      vertex(m, [a,b,0], [0,0,1], u, v);
    }
    m.indices.push(0,1,2,0,2,3);
    return m;
  }

  function box(width, height, depth, radius = 0) {
    const m = empty(), half = [width/2,height/2,depth/2];
    const r = M.clamp(radius, 0, Math.min(...half)*.98);
    const axes = [[1,2,0,1],[2,1,0,-1],[2,0,1,1],[0,2,1,-1],[0,1,2,1],[1,0,2,-1]];
    function stops(h) { return r ? [-h,-h+r, h-r,h] : [-h,h]; }
    for (const [a,b,c,sign] of axes) {
      const xs = stops(half[a]), ys = stops(half[b]), start = m.positions.length/3;
      for (const y of ys) for (const x of xs) {
        const p = [0,0,0], n = [0,0,0];
        p[a] = x; p[b] = y; p[c] = sign*half[c]; n[c] = sign;
        if (r) {
          const core = p.map((v,i) => M.clamp(v,-half[i]+r,half[i]-r));
          const normal = M.unit(M.sub(p,core));
          vertex(m, M.add(core,M.scale(normal,r)),normal);
        } else vertex(m,p,n);
      }
      for (let j=0;j<ys.length-1;j++) for (let i=0;i<xs.length-1;i++) {
        const k = start + j*xs.length+i;
        m.indices.push(k,k+1,k+xs.length+1,k,k+xs.length+1,k+xs.length);
      }
    }
    return m;
  }

  function cap(mesh, ring, y, top) {
    const normal = [0,top ? 1 : -1,0], center = vertex(mesh,[0,y,0],normal);
    const rim = ring.map(i => vertex(mesh,mesh.positions.slice(i*3,i*3+3),normal));
    for (let i=0;i<rim.length;i++) {
      const next = rim[(i+1)%rim.length];
      mesh.indices.push(center,top ? next : rim[i],top ? rim[i] : next);
    }
  }

  // Revolve an ordered list of [radius, height] pairs. Returning down the
  // inside of a vessel makes a hollow rim with inward-facing normals.
  function lathe(profile, sides = 24, capped = true) {
    if (profile.length < 2 || sides < 3 || !Number.isInteger(sides)) throw new RangeError('Invalid lathe');
    const m = empty(), rings = [];
    for (let j=0;j<profile.length;j++) {
      const [r,y] = profile[j], prev = profile[Math.max(0,j-1)], next = profile[Math.min(profile.length-1,j+1)];
      const dr = next[0]-prev[0], dy = next[1]-prev[1], ring = [];
      for (let i=0;i<sides;i++) {
        const a = i*TAU/sides, c = Math.cos(a), s = Math.sin(a);
        ring.push(vertex(m,[r*c,y,r*s],M.unit([dy*c,-dr,dy*s])));
      }
      rings.push(ring);
      if (!j) continue;
      for (let i=0;i<sides;i++) {
        const k = (i+1)%sides, lower = rings[j-1];
        if (profile[j-1][0] > 0) m.indices.push(lower[i],ring[i],lower[k]);
        if (r > 0) m.indices.push(lower[k],ring[i],ring[k]);
      }
    }
    if (capped && profile[0][0] > 0) cap(m,rings[0],profile[0][1],false);
    if (capped && profile.at(-1)[0] > 0) cap(m,rings.at(-1),profile.at(-1)[1],true);
    return m;
  }

  function cylinder(bottom, top, height, sides = 24) {
    return lathe([[bottom,-height/2],[top,height/2]],sides);
  }

  function ellipsoid(rx, ry, rz, sides = 20, bands = 10) {
    if (Math.min(rx,ry,rz)<=0 || !Number.isInteger(bands) || bands<2) throw new RangeError('Invalid ellipsoid');
    const profile = [];
    for (let j=0;j<=bands;j++) {
      const a = -Math.PI/2 + j*Math.PI/bands;
      profile.push([j===0 || j===bands ? 0 : Math.cos(a), Math.sin(a)]);
    }
    const m = lathe(profile,sides,false);
    for (let i=0;i<m.positions.length;i+=3) {
      const x = m.positions[i], y = m.positions[i+1], z = m.positions[i+2];
      m.positions[i]=x*rx; m.positions[i+1]=y*ry; m.positions[i+2]=z*rz;
      const normal = M.unit([x/rx,y/ry,z/rz]);
      m.normals[i] = normal[0]; m.normals[i+1] = normal[1]; m.normals[i+2] = normal[2];
    }
    return m;
  }

  function roundedSlab(width, height, depth, radius, bevel = .025, steps = 5) {
    const m = empty(), r = M.clamp(radius,.001,Math.min(width,depth)*.499);
    const b = M.clamp(bevel,0,Math.min(height*.49,r*.95)), h = height/2;
    const rings = b ? [[-h,b,0,-1],[-h+b*.293,b*.293,.7071,-.7071],[-h+b,0,1,0],
      [h-b,0,1,0],[h-b*.293,b*.293,.7071,.7071],[h,b,0,1]] : [[-h,0,1,0],[h,0,1,0]];
    const corners = [[1,1],[-1,1],[-1,-1],[1,-1]];
    const paths = [];
    for (const [y,inset,horizontal,vertical] of rings) {
      const ring = [];
      corners.forEach(([sx,sz],corner) => {
        for (let i=0;i<=steps;i++) {
          const a = (corner+i/steps)*Math.PI/2, c = Math.cos(a), s = Math.sin(a);
          ring.push(vertex(m,[sx*(width/2-r)+(r-inset)*c,y,sz*(depth/2-r)+(r-inset)*s],
            [c*horizontal,vertical,s*horizontal]));
        }
      });
      if (paths.length) {
        const prev = paths.at(-1);
        for (let i=0;i<ring.length;i++) {
          const j = (i+1)%ring.length;
          m.indices.push(prev[i],ring[i],prev[j],prev[j],ring[i],ring[j]);
        }
      }
      paths.push(ring);
    }
    cap(m,paths[0],-h,false); cap(m,paths.at(-1),h,true);
    return m;
  }

  function tube(points, radius, sides = 8) {
    points = points.filter((p,i) => i===0 || Math.hypot(...M.sub(p,points[i-1]))>1e-9);
    if (points.length<2 || !(radius>0) || !Number.isInteger(sides) || sides<3) {
      throw new RangeError('A tube needs a path, a positive radius and three sides');
    }
    const m = empty();
    let previousNormal;
    points.forEach((point,j) => {
      const next = points[Math.min(j+1,points.length-1)];
      let tangent = M.unit(M.sub(next,points[Math.max(j-1,0)]));
      if (!Math.hypot(...tangent)) tangent = M.unit(M.sub(next,point));
      const reference = previousNormal && Math.abs(M.dot(previousNormal,tangent)) < .9999
        ? previousNormal : (Math.abs(tangent[1]) < .85 ? [0,1,0] : [1,0,0]);
      const normal = M.unit(M.sub(reference,M.scale(tangent,M.dot(reference,tangent))));
      const binormal = M.cross(tangent,normal);
      previousNormal = normal;
      for (let i=0;i<sides;i++) {
        const a = i*TAU/sides;
        const dir = M.add(M.scale(normal,Math.cos(a)),M.scale(binormal,Math.sin(a)));
        vertex(m,M.add(point,M.scale(dir,radius)),dir);
      }
      if (j) for (let i=0;i<sides;i++) {
        const a = (j-1)*sides+i, b = (j-1)*sides+(i+1)%sides;
        m.indices.push(a,b,a+sides,b,b+sides,a+sides);
      }
    });
    return m;
  }

  function rgb(hex) {
    const value = parseInt(hex.replace('#',''),16);
    return [(value>>16)/255,((value>>8)&255)/255,(value&255)/255];
  }

  class Batcher {
    constructor(limit = 65535) {
      this.limit = Math.min(limit,65535);
      this.chunks = []; this.data = []; this.indices = [];
    }
    add(mesh, matrix, color, id = 0, gloss = .1, region, part = parts.fixed) {
      const count = mesh.positions.length/3;
      if (count > this.limit) throw new RangeError('Single mesh exceeds the batch limit');
      if (this.data.length/STRIDE + count > this.limit) this.flush();
      const start = this.data.length/STRIDE, p = mesh.positions, n = mesh.normals, m = matrix;
      const a = Array.from(m.slice(0,3)), b = Array.from(m.slice(4,7)), c = Array.from(m.slice(8,11));
      const col0 = M.cross(b,c), col1 = M.cross(c,a), col2 = M.cross(a,b);
      const sign = M.dot(a,col0) < 0 ? -1 : 1;
      const [r,g,blue] = typeof color === 'string' ? rgb(color) : color;
      for (let i=0;i<count;i++) {
        const k = i*3, x = p[k], y = p[k+1], z = p[k+2], nx = n[k], ny = n[k+1], nz = n[k+2];
        const dx = col0[0]*nx+col1[0]*ny+col2[0]*nz, dy = col0[1]*nx+col1[1]*ny+col2[1]*nz,
          dz = col0[2]*nx+col1[2]*ny+col2[2]*nz, inv = sign/(Math.hypot(dx,dy,dz)||1);
        const u = region ? region[0]+mesh.uvs[i*2]*(region[2]-region[0]) : .999;
        const v = region ? region[1]+mesh.uvs[i*2+1]*(region[3]-region[1]) : .999;
        this.data.push(m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],
          m[2]*x+m[6]*y+m[10]*z+m[14],dx*inv,dy*inv,dz*inv,r,g,blue,u,v,id,gloss,part);
      }
      if (sign < 0) {
        for (let i=0;i<mesh.indices.length;i+=3) {
          this.indices.push(start+mesh.indices[i],start+mesh.indices[i+2],start+mesh.indices[i+1]);
        }
      } else {
        for (const i of mesh.indices) this.indices.push(start+i);
      }
    }
    flush() {
      if (!this.indices.length) return;
      this.chunks.push({vertices:new Float32Array(this.data),indices:new Uint16Array(this.indices)});
      this.data = []; this.indices = [];
    }
    finish() { this.flush(); return this.chunks; }
  }

  const api = {STRIDE, parts, panel, box, lathe, cylinder, ellipsoid, roundedSlab, tube, rgb, Batcher};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else PocketPlaces.mesh = api;
})();
