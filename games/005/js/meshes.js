(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'));
  else root.CupMeshes = factory(root.CupMath);
})(globalThis, function (M) {
  'use strict';
  const {TAU, unit, cross, dot, sub, mul, add, lerp} = M;
  const HEIGHT = 2.64, BASE = 0.90, RIM = 1.31, WALL = 0.052, FLOOR = 0.135;
  const BLOCK_BOTTOM = 1.07, BLOCK_TOP = 1.77;
  const EDGE_L = -0.22, EDGE_R = 1.66;
  const STRIDE = 11;
  const wallSlope = (RIM - BASE) / HEIGHT;
  // The packing bench varies the slope about the rim. The foil and opening
  // therefore fit every cup, including the straight-sided limit.
  const radiusAt = (y, taper = 1) => RIM + (y - HEIGHT) * wallSlope * taper;
  const innerRadiusAt = (y, taper = 1) => radiusAt(y, taper) - WALL;
  // Contact flattens the tips of protruding dry curls against the lining.
  // Keep the free specimen for measuring different fits on the packing bench.
  function seatedPoint(point) {
    const [x,y,z] = point, r = Math.hypot(x,z), limit = innerRadiusAt(y);
    const scale = r > limit ? limit/r : 1;
    return [x*scale,y,z*scale];
  }
  const polar = (r,y,a) => [r*Math.sin(a),y,r*Math.cos(a)];
  const cream = [0.97,0.91,0.78], cutPaper = [0.98,0.87,0.65];
  const white = [1,1,1];

  class Builder {
    constructor() { this.vertices = []; this.indices = []; this.hydrated = []; }
    vertex(p,n,c = white, uv = [0,0], wetPoint, wetNormal) {
      const index = this.vertices.length / STRIDE;
      this.vertices.push(...p,...n,...c,...uv);
      if (wetPoint) this.hydrated.push(...wetPoint,...wetNormal);
      return index;
    }
    tri(a,b,c) { this.indices.push(a,b,c); }
    quad(a,b,c,d) { this.indices.push(a,b,c,a,c,d); }
    finish() {
      const count = this.vertices.length / STRIDE;
      if (count > 65536) throw new RangeError('Mesh exceeds a 16-bit index buffer');
      if (this.indices.some(index => !Number.isInteger(index) || index < 0 || index >= count)) {
        throw new RangeError('Triangle index is outside the vertex buffer');
      }
      const mesh = {vertices:new Float32Array(this.vertices), indices:new Uint16Array(this.indices)};
      if (this.hydrated.length) {
        if (this.hydrated.length !== this.vertices.length / STRIDE * 6) {
          throw new RangeError('Each dry vertex needs a matching hydrated vertex');
        }
        mesh.hydrated = new Float32Array(this.hydrated);
      }
      return mesh;
    }
  }
  function pathTangents(points, closed) {
    if (points.some(p => !p || p.length !== 3 || !p.every(Number.isFinite))) {
      throw new RangeError('Tube points must have three finite coordinates');
    }
    return points.map((point,i) => {
      const last = points.length-1;
      const before = i===0 ? (closed ? last : 0) : i-1;
      const after = i===last ? (closed ? 0 : last) : i+1;
      if (after!==i && point.every((v,k) => v===points[after][k])) {
        throw new RangeError('A tube segment must have length');
      }
      const tangent = unit(sub(points[after],points[before]));
      if (dot(tangent,tangent) === 0) throw new RangeError('Tube tangent must have a direction');
      return tangent;
    });
  }
  function tube(b, path, r, color, sides = 8, closed = false, wetPath) {
    const count = path.length;
    if (count < (closed ? 3 : 2) || !Number.isFinite(r) || !(r > 0) || !Number.isInteger(sides) || sides < 3 ||
        (wetPath && wetPath.length !== count)) throw new RangeError('Invalid tube');
    const tangents = pathTangents(path,closed), wetTangents = wetPath && pathTangents(wetPath,closed);
    const rings = [];
    let normal;
    for (let i = 0; i < count; i++) {
      const t = tangents[i];
      if (!normal || Math.abs(dot(normal,t)) > 0.98) {
        normal = unit(cross(t,Math.abs(t[1]) < 0.8 ? [0,1,0] : [1,0,0]));
      } else normal = unit(sub(normal,mul(t,dot(normal,t))));
      const binormal = cross(t,normal), ring = [];
      let wetNormal, wetBinormal;
      if (wetPath) {
        const tangent = wetTangents[i];
        // Rotate the dry frame onto the new tangent without twisting the strand.
        const axis = cross(t,tangent), cosine = dot(t,tangent);
        const turn = cross(axis,normal);
        wetNormal = cosine < -0.99999 ? normal :
          unit(add(add(normal,turn),mul(cross(axis,turn),1/(1+cosine))));
        wetBinormal = cross(tangent,wetNormal);
      }
      for (let j = 0; j < sides; j++) {
        const angle = TAU*j/sides;
        const c = Math.cos(angle), s = Math.sin(angle);
        const n = add(mul(normal,c),mul(binormal,s));
        const wn = wetPath && add(mul(wetNormal,c),mul(wetBinormal,s));
        const wp = wetPath && add(wetPath[i],mul(wn,r*1.09));
        ring.push(b.vertex(add(path[i],mul(n,r)),n,color,[i/(count-1),j/sides],wp,wn));
      }
      rings.push(ring);
    }
    // Match frames at a closed seam even when parallel transport accumulated twist.
    let offset = 0;
    if (closed) {
      const v = rings[count-1][0]*STRIDE;
      let best = -Infinity;
      for (let j=0;j<sides;j++) {
        const u = rings[0][j]*STRIDE;
        const alignment = [3,4,5].reduce((sum,k) => sum+b.vertices[v+k]*b.vertices[u+k],0);
        if (alignment > best) { best = alignment; offset = j; }
      }
    }
    for (let i=0; i<(closed ? count : count-1); i++) {
      const next=(i+1)%count, shift=next===0 ? offset : 0;
      for (let j=0;j<sides;j++) b.quad(rings[i][j],rings[i][(j+1)%sides],
        rings[next][(j+1+shift)%sides],rings[next][(j+shift)%sides]);
    }
    if (!closed) {
      for (const end of [0,count-1]) {
        const n = mul(tangents[end],end===0 ? -1 : 1);
        const wn = wetPath && mul(wetTangents[end],end===0 ? -1 : 1);
        const center = b.vertex(path[end],n,color,undefined,wetPath && wetPath[end],wn);
        const cap = rings[end].map(v => b.vertex(b.vertices.slice(v*STRIDE,v*STRIDE+3),n,color,
          undefined,wetPath && b.hydrated.slice(v*6,v*6+3),wn));
        for (let j=0;j<sides;j++) {
          const a=cap[j], c=cap[(j+1)%sides];
          if (end === 0) b.tri(center,c,a); else b.tri(center,a,c);
        }
      }
    }
  }
  function surface(b, levels, from, to, segments, inside, tint) {
    const rings = levels.map(([y,r],k) => {
      const lower = levels[Math.max(0,k-1)], upper = levels[Math.min(levels.length-1,k+1)];
      const slope = (upper[1]-lower[1])/(upper[0]-lower[0]);
      return Array.from({length:segments+1},(_,i) => {
        const a = lerp(from,to,i/segments);
        const n = mul(unit([Math.sin(a),-slope,Math.cos(a)]),inside ? -1 : 1);
        return b.vertex(polar(r,y,a),n,tint(y,a),[a/TAU+0.5,y/HEIGHT]);
      });
    });
    for (let k=0;k<rings.length-1;k++) for (let i=0;i<segments;i++) {
      const a=rings[k][i], c=rings[k][i+1], d=rings[k+1][i+1], e=rings[k+1][i];
      if (inside) b.quad(a,e,d,c); else b.quad(a,c,d,e);
    }
  }
  function disc(b,r,y,color,up=true,segments=84,bands=1) {
    const n=[0,up?1:-1,0], center=b.vertex([0,y,0],n,color,[0.5,0.5]);
    let previous;
    for(let band=1;band<=bands;band++) {
      const fraction=band/bands;
      const ring=Array.from({length:segments},(_,i) => {
        const a=TAU*i/segments;
        return b.vertex(polar(r*fraction,y,a),n,color,[0.5+0.5*fraction*Math.sin(a),0.5+0.5*fraction*Math.cos(a)]);
      });
      for(let i=0;i<segments;i++) {
        const j=(i+1)%segments;
        if (!previous) {
          if (up) b.tri(center,ring[i],ring[j]); else b.tri(center,ring[j],ring[i]);
        } else if (up) b.quad(previous[i],ring[i],ring[j],previous[j]);
        else b.quad(previous[j],ring[j],ring[i],previous[i]);
      }
      previous=ring;
    }
  }
  function paperSection(from,to) {
    const outer=new Builder(), inner=new Builder(), trim=new Builder();
    const levels=[0.10,0.16,0.46,0.90,1.09,1.4,1.78,2.15,HEIGHT];
    surface(outer,levels.map(y=>[y,radiusAt(y)]),from,to,84,false,()=>white);
    surface(inner,levels.map(y=>[y,radiusAt(y)-WALL]),from,to,84,true,(y,a) => {
      const shade = 0.79+0.19*y/HEIGHT+0.026*Math.cos(a);
      return mul([0.98,0.89,0.72],shade);
    });
    const bead = (r,y,size,c) => {
      const points=Array.from({length:93},(_,i)=>polar(r,y,lerp(from,to,i/92)));
      tube(trim,points,size,c,12);
    };
    bead(RIM-WALL*0.36,HEIGHT,0.052,cream);
    bead(RIM-0.008,HEIGHT-0.066,0.012,[0.86,0.77,0.60]);
    bead(BASE+0.012,0.114,0.030,cream);
    return {outer:outer.finish(),inner:inner.finish(),trim:trim.finish()};
  }
  function cutEdges() {
    const b=new Builder();
    for(const a of [EDGE_L,EDGE_R]) {
      const n=mul([Math.cos(a),0,-Math.sin(a)],a===EDGE_L ? 1 : -1);
      const vert=(y,d) => b.vertex(polar(radiusAt(y)-d,y,a),n,d<WALL*0.36 ? cream : cutPaper);
      for (const [d0,d1] of [[0,0.014],[0.014,WALL]]) {
        for(const [low,high] of [[0.1,0.16],[0.16,0.46],[0.46,HEIGHT]]) {
          const ids=[vert(low,d0),vert(low,d1),vert(high,d1),vert(high,d0)];
          if (a===EDGE_R) ids.reverse();
          b.quad(...ids);
        }
      }
    }
    return b.finish();
  }
  function base() {
    const b=new Builder();
    surface(b,[[0.035,BASE-0.015],[0.065,BASE+0.005],[FLOOR,BASE+0.015]],
      0,TAU,96,false,()=>cream);
    // Rings inside the rim let the floor bend across its area during transit.
    disc(b,BASE+0.015,FLOOR,[0.85,0.77,0.63],true,84,8);
    disc(b,BASE-0.015,0.035,cream,false);
    return b.finish();
  }
  function lid() {
    // A uniformly thin foil sheet rolls back over a small bend at the rear lip.
    // Its two faces have separate normals and surface finishes.
    const b=new Builder(), r=RIM-0.042, hinge=-0.64, bend=0.19, angle=2.79;
    const rings=[];
    function point(x,z,face,u,v) {
      const d=Math.max(0,z-hinge), a=Math.min(d/bend,angle);
      const tail=Math.max(0,d-bend*angle);
      const pz=z<=hinge ? z : hinge+bend*Math.sin(a)+tail*Math.cos(a);
      const py=HEIGHT+0.023+bend*(1-Math.cos(a))+tail*Math.sin(a);
      const ripple=0.006*Math.sin(8*x+z*2)*M.smooth(0.1,1.3,d);
      const n=[0,Math.cos(a)*face,-Math.sin(a)*face];
      const p=[x,py+ripple+n[1]*0.007,pz+n[2]*0.007];
      return b.vertex(p,n,face>0 ? [0.79,0.32,0.12] : [0.94,0.88,0.72],[u,v]);
    }
    // A radial fan avoids zero-area triangles at the ends of a circular sheet.
    for(const face of [1,-1]) {
      rings.length=0;
      const center=point(0,0,face,0.5,0.5);
      const bands=32, segments=80;
      for(let i=1;i<=bands;i++) {
        const ring=[];
        for(let j=0;j<segments;j++) {
          const a=TAU*j/segments, q=i/bands;
          const x=r*q*Math.sin(a), z=r*q*Math.cos(a);
          ring.push(point(x,z,face,0.5+0.5*x/r,0.5+0.5*z/r));
        }
        for(let j=0;j<segments;j++) {
          const k=(j+1)%segments;
          if(i===1) {
            if(face>0) b.tri(center,ring[j],ring[k]); else b.tri(center,ring[k],ring[j]);
          } else {
            const prev=rings[i-2];
            if(face>0) b.quad(prev[j],ring[j],ring[k],prev[k]);
            else b.quad(prev[k],ring[k],ring[j],prev[j]);
          }
        }
        rings.push(ring);
      }
    }
    return b.finish();
  }
  function noodles(seed=117) {
    const b=new Builder(), rand=M.random(seed), strands=[];
    const noodleColor=()=>{
      const t=rand();
      return [0.89+0.09*t,0.60+0.16*t,0.27+0.13*t];
    };
    function addStrand(path,wet,radius,closed,key) {
      const firstIndex=b.indices.length;
      tube(b,path,radius,noodleColor(),7,closed,wet);
      const strand={path,closed};
      if(key) {
        // Mark the point facing into the cutaway. Its index stays fixed as the
        // strand softens, so the two readings always refer to the same curl.
        const facing=p=>0.48*p[0]+p[2];
        const mark=path.reduce((best,p,i)=>facing(p)>facing(path[best]) ? i : best,0);
        Object.assign(strand,{key,wet,mark,firstIndex,indexCount:b.indices.length-firstIndex});
      }
      strands.push(strand);
    }
    // Interwoven crimped strands around the sides of the pressed cake.
    for(let layer=0;layer<8;layer++) {
      const p=layer/7, h=lerp(BLOCK_BOTTOM+0.06,BLOCK_TOP-0.05,p);
      const phase=rand()*TAU, phase2=rand()*TAU, waves=14+Math.floor(rand()*4);
      const path=[], wet=[];
      for(let i=0;i<240;i++) {
        const t=TAU*i/240, w=waves*t+phase+0.75*Math.sin(3*t+phase2);
        const a=t+0.019*Math.sin(w)+0.003*Math.sin(2*w);
        const r=radiusAt(h)-WALL-0.074+0.033*Math.cos(w+0.4)+0.022*Math.sin(5*t+phase);
        const y=h+0.056*Math.sin(w+0.6)+0.036*Math.sin(3*t+phase2);
        path.push(polar(r,y,a));
        const wetY=lerp(0.57,1.64,p)+0.16*Math.sin(2*t+phase2)+0.12*Math.sin(4*t+phase);
        const wetR=(radiusAt(wetY)-WALL-0.07)*(0.88+0.10*Math.cos(3*t+phase2));
        wet.push(polar(wetR,wetY,t+0.046*Math.sin(8*t+phase)));
      }
      addStrand(path,wet,0.041+0.004*rand(),true,layer===0 ? 'lower' : layer===4 ? 'middle' : null);
    }
    // Wavy chords cover the upper and lower faces. Crossing layers close up
    // sight lines through the cake while leaving the strands individually legible.
    for(const [h,direction,rows,wetHeight] of [
      [BLOCK_BOTTOM+0.055,1.1,14,0.60],[BLOCK_TOP-0.072,1.83,16,1.22],[BLOCK_TOP+0.007,0.42,17,1.66]
    ]) {
      const ca=Math.cos(direction), sa=Math.sin(direction), r=radiusAt(h)-WALL-0.105;
      for(let j=0;j<rows;j++) {
        const lane=lerp(-0.965,0.965,(j+0.5)/rows)*r, half=Math.sqrt(r*r-lane*lane);
        const phase=rand()*TAU, f=13+rand()*2, path=[], wet=[];
        const samples=Math.max(18,Math.ceil(half*76));
        for(let i=0;i<=samples;i++) {
          const t=i/samples, x=lerp(-half,half,t);
          const envelope=Math.min(1,Math.sin(Math.PI*t)*5);
          const w=f*x+phase+0.6*Math.sin(4*x+phase);
          const z=lane+envelope*(0.065*Math.sin(w)+0.031*Math.sin(5*x+phase));
          const y=h+envelope*(0.036*Math.cos(w)+0.022*Math.sin(4*x+phase));
          path.push([ca*x+sa*z,y,-sa*x+ca*z]);
          const wetY=wetHeight+0.12*Math.sin(phase)+0.18*Math.sin(x*3.2+phase);
          const wetZ=lane+envelope*0.15*Math.sin(7*x+phase);
          const shrink=Math.min(1,(radiusAt(wetY)-WALL-0.07)/Math.hypot(x,wetZ));
          wet.push([(ca*x+sa*wetZ)*shrink,wetY,(-sa*x+ca*wetZ)*shrink]);
        }
        addStrand(path,wet,0.043+rand()*0.006,false,rows===17 && j===13 ? 'crown' : null);
      }
    }
    return {...b.finish(),strands};
  }
  function kernel(b,center,size,angle,color) {
    // A rounded, lightly irregular cube for freeze-dried vegetables.
    const ca=Math.cos(angle),sa=Math.sin(angle),rings=[];
    const turn=(x,y,z)=>[ca*x+sa*z,y,-sa*x+ca*z];
    const e=0.53, sp=(x,p)=>Math.sign(x)*Math.pow(Math.abs(x),p);
    for(let k=1;k<6;k++) {
      const lat=Math.PI*(k/6-0.5), ring=[];
      for(let j=0;j<12;j++) {
        const a=j*TAU/12, q=[Math.cos(lat)*Math.cos(a),Math.sin(lat),Math.cos(lat)*Math.sin(a)];
        const p=turn(...q.map((v,i)=>sp(v,e)*size[i]));
        const n=unit(turn(...q.map((v,i)=>sp(v,2-e)/size[i])));
        ring.push(b.vertex(add(center,p),n,color));
      }
      if(k>1) for(let j=0;j<12;j++) b.quad(rings[k-2][j],ring[j],ring[(j+1)%12],rings[k-2][(j+1)%12]);
      rings.push(ring);
    }
    const top=b.vertex(add(center,[0,size[1],0]),[0,1,0],color);
    const bottom=b.vertex(add(center,[0,-size[1],0]),[0,-1,0],color);
    for(let j=0;j<12;j++) {
      b.tri(top,rings[4][(j+1)%12],rings[4][j]);
      b.tri(bottom,rings[0][j],rings[0][(j+1)%12]);
    }
  }
  function toppings(seed=33) {
    const b=new Builder(), rand=M.random(seed), placed=[];
    for(let attempt=0;attempt<300 && placed.length<36;attempt++) {
      const a=rand()*TAU, r=Math.sqrt(rand())*0.96, x=Math.sin(a)*r, z=Math.cos(a)*r;
      if (placed.some(p=>Math.hypot(p[0]-x,p[1]-z)<0.16)) continue;
      const i=placed.length, h=BLOCK_TOP+0.072+rand()*0.03;
      const first=b.vertices.length;
      placed.push([x,z]);
      if(i%4===0) {
        const path=[], angle=rand()*TAU, lean=rand()*0.7, radius=0.048+rand()*0.016;
        for(let k=0;k<18;k++) {
          const t=TAU*k/18, u=radius*Math.cos(t), v=radius*Math.sin(t);
          path.push([x+u*Math.cos(angle)-v*Math.sin(angle),h+v*lean,z+u*Math.sin(angle)+v*Math.cos(angle)]);
        }
        tube(b,path,0.020,[0.32,0.53,0.14],7,true);
      } else {
        const colors=[[0.26,0.42,0.13],[0.86,0.29,0.105],[0.97,0.73,0.20],[0.37,0.55,0.17]];
        kernel(b,[x,h,z],[0.052+rand()*0.028,0.026+rand()*0.016,0.032+rand()*0.025],rand()*TAU,colors[i%4]);
      }
      // Light scallion rings float up. The heavier pieces settle among the curls.
      const rise=i%4===0 ? 0.32 : -0.24-0.17*Math.sin(i);
      for(let j=first;j<b.vertices.length;j+=STRIDE) {
        b.hydrated.push(b.vertices[j]*0.97,b.vertices[j+1]+rise,b.vertices[j+2]*0.97,
          b.vertices[j+3],b.vertices[j+4],b.vertices[j+5]);
      }
    }
    return b.finish();
  }
  function water() {
    const b=new Builder(), c=[0.43,0.69,0.66];
    surface(b,[[0,1],[1,1]],EDGE_L,EDGE_R,66,false,()=>c);
    disc(b,1,1,[0.65,0.84,0.78],true,96);
    return b.finish();
  }
  function effects() {
    const stream=new Builder(), seep=new Builder(), steam=new Builder(), shadow=new Builder();
    const p=Array.from({length:45},(_,i)=>[0.012*Math.sin(i*0.17),i/44,0.008*Math.cos(i*0.24)]);
    tube(stream,p,0.031,[0.68,0.84,0.79],10);
    for(const [x,z] of [[0.19,0.68],[0.53,0.39],[0.67,0.57]]) {
      const path=Array.from({length:17},(_,i)=>{
        const t=i/16;
        return [x+0.017*Math.sin(t*3+x*7),t,z+0.018*t*t];
      });
      tube(seep,path,0.014,[0.39,0.67,0.66],7);
    }
    for(let j=0;j<3;j++) {
      const line=[];
      for(let i=0;i<=30;i++) {
        const t=i/30;
        line.push([0.32*j-0.25+0.055*Math.sin(t*7+j),t*0.90,0.13*j+0.03*Math.sin(t*4)]);
      }
      tube(steam,line,0.010,[0.98,0.97,0.92],6);
    }
    const q=[[-3.8,0,-3.8],[-3.8,0,3.8],[3.8,0,3.8],[3.8,0,-3.8]].map(p=>shadow.vertex(p,[0,1,0]));
    shadow.quad(...q);
    const sheet=new Builder();
    disc(sheet,1,0,white);
    return {stream:stream.finish(),seep:seep.finish(),steam:steam.finish(),shadow:shadow.finish(),sheet:sheet.finish()};
  }
  function buildModel(noodleMesh = noodles()) {
    const cut=paperSection(EDGE_R,TAU+EDGE_L), fill=paperSection(EDGE_L,EDGE_R);
    return {shell:cut.outer, lining:cut.inner, lip:cut.trim, completeShell:fill.outer,
      completeLining:fill.inner, completeLip:fill.trim, edges:cutEdges(), base:base(),
      lid:lid(), noodles:noodleMesh, toppings:toppings(), water:water(), ...effects()};
  }
  // A callout follows the same vertex in both poses, including during a scrub.
  function strandAnchor(mesh,point) {
    let closest=0, distance=Infinity;
    for(let i=0;i<mesh.vertices.length;i+=STRIDE) {
      const dx=mesh.vertices[i]-point[0], dy=mesh.vertices[i+1]-point[1], dz=mesh.vertices[i+2]-point[2];
      const squared=dx*dx+dy*dy+dz*dz;
      if(squared<distance) { distance=squared; closest=i; }
    }
    const wet=closest/STRIDE*6;
    return {dry:mesh.vertices.slice(closest,closest+3),wet:mesh.hydrated.slice(wet,wet+3)};
  }
  return {HEIGHT,BASE,RIM,WALL,FLOOR,BLOCK_BOTTOM,BLOCK_TOP,EDGE_L,EDGE_R,STRIDE,wallSlope,radiusAt,innerRadiusAt,seatedPoint,polar,
    Builder,tube,surface,disc,paperSection,cutEdges,base,lid,noodles,kernel,toppings,water,buildModel,strandAnchor};
});
