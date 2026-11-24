(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./math.js") : root.FoundryMath, node ? require("./track.js") : root.FoundryTrack);
  if (node) module.exports = api;
  else root.FoundryMesh = api;
})(globalThis, function (M, T) {
  "use strict";
  const {add, sub, mul, madd, cross, unit, dot, length} = M;
  const X = [1,0,0], Y = [0,1,0], Z = [0,0,1];
  const color = hex => [0, 2, 4].map(i => parseInt(hex.slice(i, i+2), 16) / 255);
  const pigment = (floor, rim, side, base) => [floor, rim, side, base].map(color);
  const teal = pigment("3e8b81", "8ac3a8", "34756b", "29574f");
  const orange = pigment("df7445", "ffad70", "d06238", "aa5236");
  const honey = pigment("e4af40", "fbd37a", "d89a32", "b28132");
  const paints = {straight: teal, ramp: orange, rise: orange, left: honey, right: honey,
    loop: teal, chicane: orange, launch: orange, finish: teal,
    drive: pigment("347d82", "c3e6bf", "32666b", "254c52"),
    brake: pigment("ab6162", "efbb91", "934f52", "6b4646"),
    jump: pigment("567c99", "a6cedb", "456780", "375366")};
  const metal = color("436659"), dark = color("2c4840"), foot = color("567568");
  const zinc = color("c7c9ac"), ivory = color("f5ebca"), rubber = color("313f36");
  const p = T.point;

  class Builder {
    constructor() { this.vertices = []; this.indices = []; }
    vertex(pos, normal, rgb) {
      this.vertices.push(...pos, ...normal, ...rgb);
      return this.vertices.length / 9 - 1;
    }
    quad(a, b, c, d, rgb, normal) {
      const n = normal || unit(cross(sub(b, a), sub(d, a)));
      const i = this.vertex(a, n, rgb);
      this.vertex(b, n, rgb); this.vertex(c, n, rgb); this.vertex(d, n, rgb);
      this.indices.push(i, i+1, i+2, i, i+2, i+3);
    }
    finish() {
      if (this.vertices.length / 9 > 65535) throw new RangeError("Mesh exceeds a 16-bit index buffer");
      return {vertices: new Float32Array(this.vertices), indices: new Uint16Array(this.indices)};
    }
  }
  function box(g, center, axes, sizes, rgb) {
    for (let k = 0; k < 3; k++) {
      const a = mul(axes[(k+1)%3], sizes[(k+1)%3]/2);
      const b = mul(axes[(k+2)%3], sizes[(k+2)%3]/2);
      for (const sign of [-1,1]) {
        const face = madd(center, axes[k], sizes[k]*sign/2);
        const h = mul(a, sign);
        g.quad(sub(sub(face,h),b), sub(add(face,h),b), add(add(face,h),b), add(sub(face,h),b),
          rgb, mul(axes[k], sign));
      }
    }
  }
  function bar(g, a, b, width, depth, rgb, side = Z) {
    const axis = unit(sub(b, a));
    if (length(axis) === 0) return;
    const x = unit(cross(axis, Math.abs(dot(axis,side)) > 0.98 ? X : side));
    box(g, M.lerp(a,b,0.5), [x,axis,cross(x,axis)], [width,length(sub(b,a)),depth], rgb);
  }
  function cylinder(g, a, b, r, rgb, sides = 12) {
    const axis = unit(sub(b,a));
    const u = unit(cross(axis, Math.abs(axis[1]) > 0.9 ? Z : Y)), v = cross(axis,u);
    const ring = [];
    for (let i=0; i<=sides; i++) {
      const angle = i*M.TAU/sides;
      const n = add(mul(u,Math.cos(angle)),mul(v,Math.sin(angle)));
      const pa = madd(a,n,r), pb = madd(b,n,r);
      ring.push([pa,pb]);
      const idx = g.vertex(pa,n,rgb);
      g.vertex(pb,n,rgb);
      if (i) g.indices.push(idx-2,idx,idx+1,idx-2,idx+1,idx-1);
    }
    for (let end=0; end<2; end++) {
      const normal = mul(axis, end ? 1 : -1);
      const center = g.vertex(end ? b : a,normal,rgb);
      for (const pair of ring) g.vertex(pair[end],normal,rgb);
      for (let i=0; i<sides; i++) {
        const v0 = center+i+1, v1 = v0+1;
        g.indices.push(center, end ? v0 : v1, end ? v1 : v0);
      }
    }
  }
  function sphere(longitude = 36, latitude = 24) {
    const g = new Builder();
    for (let j=0; j<=latitude; j++) {
      const phi = Math.PI*j/latitude;
      for (let i=0; i<=longitude; i++) {
        const theta = M.TAU*i/longitude;
        const n = [Math.sin(phi)*Math.cos(theta), Math.cos(phi), Math.sin(phi)*Math.sin(theta)];
        const index = g.vertex(n,n,[1,1,1]);
        if (i && j) {
          const prev = index-longitude-1;
          if (j !== 1) g.indices.push(prev-1,prev,index-1);
          if (j !== latitude) g.indices.push(index-1,prev,index);
        }
      }
    }
    return g.finish();
  }
  function channel(g, type, samples) {
    const profile = [...T.PROFILE, [1.005,0.56], [1.045,0.50], [0.99,-0.12], [0.79,-0.22],
      [-0.79,-0.22], [-0.99,-0.12], [-1.045,0.50], [-1.005,0.56]];
    const [floor,rim,side,base] = paints[type];
    for (let j=0; j<profile.length; j++) {
      const [a,h] = profile[j], [b,k] = profile[(j+1)%profile.length];
      const rgb = j<9 ? floor : [rim,rim,side,base,base,base,side,rim,rim][j-9];
      let prev;
      for (const f of samples) {
        const n = unit(sub(mul(f.n,b-a),mul(f.b,k-h)));
        const i = g.vertex(p(f,0,h,a),n,rgb);
        g.vertex(p(f,0,k,b),n,rgb);
        if (prev !== undefined) g.indices.push(prev,prev+1,i+1,prev,i+1,i);
        prev = i;
      }
    }
    for (const [f,sign] of [[samples[0],-1],[samples.at(-1),1]]) {
      for (const face of T.endFaces(f,sign)) g.quad(...face,side,mul(f.t,sign));
    }
  }
  function collar(g, f) {
    const axes = [f.t,f.n,f.b];
    box(g,p(f,0,-0.21,0),axes,[0.24,0.14,2.05],dark);
    for (const s of [-1,1]) {
      box(g,p(f,0,0.085,s*1.006),axes,[0.24,0.49,0.095],metal);
      cylinder(g,p(f,0,0.17,s*1.05),p(f,0,0.17,s*1.075),0.063,zinc,8);
    }
  }
  function stand(g, f) {
    const top = f.p[1]-0.22;
    if (top < 0.16) return;
    const b = unit([f.b[0],0,f.b[2]], Z), t = cross(Y,b);
    const axes = [t,Y,b];
    const base = [f.p[0],0,f.p[2]];
    const at = (a,h,c) => add(madd(madd(base,t,a),b,c),[0,h,0]);
    box(g,at(0,0.085,0),axes,[0.64,0.17,2.10],foot);
    box(g,at(0,top-0.05,0),axes,[0.36,0.21,1.94],dark);
    for (const s of [-1,1]) {
      const bottom = at(0,0.15,s*0.68), cap = at(0,top,s*0.59);
      bar(g,bottom,cap,0.23,0.19,metal,b);
      cylinder(g,at(0,0.17,s*0.91),at(0,0.205,s*0.91),0.073,zinc,8);
    }
    if (top > 1.65) {
      bar(g,at(0,0.30,-0.67),at(0,top-0.32,0.61),0.12,0.12,foot,b);
      if (top > 3.6) bar(g,at(0,0.30,0.67),at(0,top-0.32,-0.61),0.12,0.12,foot,b);
      box(g,at(0,top*0.52,0),axes,[0.20,0.13,1.42],metal);
    }
  }
  function arrow(g, f) {
    for (const s of [-1,1]) {
      g.quad(p(f,-0.23,0.019,s*0.26),p(f,-0.12,0.019,s*0.26),p(f,0.16,0.019,0),
        p(f,0.05,0.019,0),ivory,f.n);
    }
  }
  function stripHardware(g, section) {
    const drive = section.type === "drive";
    const f = T.atDistance(section, section.length / 2), axes = [f.t,f.n,f.b];
    const bed = section.length - 2*T.STRIP_LEAD;
    box(g,p(f,0,0.006,0),axes,[bed,0.012,0.80],dark);
    for (const side of [-1,1]) {
      box(g,p(f,0,0.57,side*0.95),axes,[bed,0.08,0.13],paints[section.type][1]);
      for (const x of [-bed/2+0.18,bed/2-0.18]) {
        box(g,p(f,x,0.36,side*1.02),axes,[0.28,0.32,0.16],metal);
        cylinder(g,p(f,x,0.38,side*1.08),p(f,x,0.38,side*1.13),0.08,zinc,10);
      }
    }
    for (let x = -1.4; x <= 1.41; x += 0.7) {
      const mark = T.atDistance(section, section.length/2+x);
      if (drive) arrow(g,mark);
      else {
        box(g,p(mark,-0.07,0.018,0),axes,[0.095,0.012,0.71],ivory);
        box(g,p(mark,0.08,0.018,0),axes,[0.055,0.012,0.71],paints.brake[1]);
      }
    }
  }
  function timingGate(g, f) {
    const axes = [f.t,f.n,f.b], enamel = color("42748c"), lens = color("b6f4db");
    const extra = (f.clearance ?? 1.15) - 1.15;
    for (const side of [-1,1]) {
      if (f.freeStanding) {
        const tip = p(f,0,0.25,side*0.98), foot = [tip[0], 0.1, tip[2]];
        bar(g,foot,tip,0.15,0.15,metal,f.b);
        box(g,foot,[X,Y,Z],[0.43,0.2,0.43],dark);
      }
      box(g,p(f,0,0.51+extra/2,side*0.98),axes,[0.21,0.81+extra,0.17],enamel);
      box(g,p(f,0,0.93+extra,side*0.98),axes,[0.28,0.15,0.24],ivory);
      box(g,p(f,0,0.76+extra,side*0.883),axes,[0.11,0.10,0.06],lens);
    }
    if (!f.freeStanding) for (const x of [-0.065,0.065]) box(g,p(f,x,0.035,0),axes,[0.052,0.012,1.12],enamel);
  }
  function jumpHardware(g, section, miniature) {
    const [takeoff, landing] = section.decks;
    for (const [edge, inward] of [[takeoff.at(-1), -1], [landing[0], 1]]) {
      const frame = T.atDistance(section, edge.s + inward*0.24);
      collar(g, frame);
      if (!miniature) stand(g, frame);
      for (let i = 0; i < 6; i++) {
        box(g,p(frame,0,0.022,(i-2.5)*0.18),[frame.t,frame.n,frame.b],
          [0.16,0.015,0.18],i%2 ? dark : honey[1]);
      }
    }
    arrow(g,T.atDistance(section,takeoff.at(-1).s-1));
  }
  function flag(g, f) {
    cylinder(g,p(f,0,0.06,-0.985),p(f,0,2.26,-0.985),0.051,dark);
    cylinder(g,p(f,0,2.24,-0.985),p(f,0,2.32,-0.985),0.075,zinc);
    const flagPoint = (x,y) => p(f,x,2.21-y-0.065*x,-0.985+0.085*Math.sin(x*6));
    for (let i=0; i<5; i++) for (let j=0; j<3; j++) {
      const x=i*0.222, y=j*0.222;
      g.quad(flagPoint(x,y),flagPoint(x+0.222,y),flagPoint(x+0.222,y+0.222),
        flagPoint(x,y+0.222),(i+j)%2 ? ivory : dark,f.b);
    }
  }
  function sectionMesh(section, miniature = false) {
    const g = new Builder(), f0 = section.samples[0], last = section.samples.at(-1);
    for (const deck of section.decks) channel(g,section.type,deck);
    collar(g, T.atDistance(section,0.16));
    if (section.type === "jump") jumpHardware(g,section,miniature);
    const powered = Object.hasOwn(T.STRIPS, section.type);
    if (powered) stripHardware(g,section);
    if (miniature) {
      collar(g,T.atDistance(section,section.length-0.16));
      return g.finish();
    }
    if (section.type === "loop") {
      stand(g,T.atDistance(section,0.64));
      stand(g,T.atDistance(section,section.length-0.63));
      // Outside-facing cradles leave the opening of the loop unobstructed.
      for (const idx of [24,90]) {
        const f = section.samples[idx], contact = p(f,0,-0.26,-0.66);
        const ground = [contact[0]-0.35*f.n[0],0.14,contact[2]-0.25];
        bar(g,ground,contact,0.17,0.23,metal);
        box(g,[ground[0],0.075,ground[2]],[X,Y,Z],[0.67,0.15,0.68],foot);
        collar(g,f);
      }
      arrow(g,T.atDistance(section,0.85));
    } else {
      stand(g,T.atDistance(section,section.type === "finish" ? section.length-0.42 : 0.42));
      if (["right","left","chicane"].includes(section.type)) stand(g,T.atDistance(section,section.length*0.62));
      if (section.type === "ramp" || section.type === "rise") {
        const a = T.atDistance(section,0.42), b = T.atDistance(section,section.length-0.1);
        for (const s of [-1,1]) {
          const low = p(a,0,0,0.64*s);
          low[1] = 0.20;
          bar(g,low,p(b,0,-0.29,0.62*s),0.13,0.15,foot,a.b);
        }
      }
      if (!powered && !["launch","finish","jump"].includes(section.type)) arrow(g,T.atDistance(section,section.length*0.54));
    }
    if (section.type === "launch") {
      box(g,p(f0,-0.16,0.20,0),[f0.t,f0.n,f0.b],[0.21,0.83,2.06],paints.launch[2]);
      // A slotted cream backplate and two small shoulder guards form the magazine.
      for (let i=-2; i<=2; i++) {
        box(g,p(f0,-0.163,0.63,i*0.32),[f0.t,f0.n,f0.b],[0.222,0.06,0.18],ivory);
      }
      for (const s of [-1,1]) box(g,p(f0,0.63,0.60,s*0.958),[f0.t,f0.n,f0.b],[1.2,0.085,0.12],ivory);
      // The open release gate frames the suspended marble at the head of the run.
      for (const s of [-1,1]) {
        bar(g,p(f0,1.63,0.48,0.95*s),p(f0,1.63,1.52,0.88*s),0.15,0.14,metal,f0.b);
      }
      box(g,p(f0,1.63,1.54,0),[f0.t,f0.n,f0.b],[0.24,0.14,1.90],ivory);
    }
    if (section.type === "finish") {
      flag(g,T.atDistance(section,0.93));
      const f = T.atDistance(section,1.22);
      for (let i=0; i<6; i++) for (let j=0; j<2; j++) {
        const z = (i-3)*0.19, x=j*0.19;
        g.quad(p(f,x,0.029,z),p(f,x,0.029,z+0.19),p(f,x+0.19,0.029,z+0.19),
          p(f,x+0.19,0.029,z),(i+j)%2 ? ivory : dark,f.n);
      }
      box(g,p(last,-0.07,0.22,0),[last.t,last.n,last.b],[0.20,0.85,2.05],paints.finish[2]);
      box(g,p(last,-0.20,0.30,0),[last.t,last.n,last.b],[0.14,0.34,1.72],rubber);
    }
    if (section.split) timingGate(g,section.split);
    return g.finish();
  }
  function ground() {
    const g = new Builder();
    g.quad([-1600,0,-1600],[-1600,0,1600],[1600,0,1600],[1600,0,-1600],[1,1,1],Y);
    return g.finish();
  }
  return {Builder, box, bar, cylinder, sphere, sectionMesh, ground, color, paints};
});
