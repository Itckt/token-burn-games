'use strict';
const {before,test} = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/meshes.js');
const P = require('../js/packing.js');
const L = require('../js/lesson.js');
const S = require('../js/strands.js');
const close = (a,b,epsilon=1e-8) => assert.ok(Math.abs(a-b)<epsilon,a+' vs '+b);
let mesh, profile;
before(() => { mesh=G.noodles(); profile=P.measure(mesh); });

test('the transit pad first spends clearance and then lifts the block, including exact contact', () => {
  for (const taper of [0,0.75,1]) for (let width=72; width<=94; width++) {
    const fit=P.fit(profile,width,taper);
    for (const mm of [NaN,-1,0,fit.gapMM-1e-8,fit.gapMM,fit.gapMM+1e-8,6,8,10]) {
      const pad=P.press(fit,mm);
      close(pad.travelMM,Math.min(8,Math.max(0,mm || 0)));
      close(pad.surfaceY,G.FLOOR+pad.travelMM/P.mmPerUnit);
      close((fit.bottom+pad.lift-pad.surfaceY)*P.mmPerUnit,pad.clearanceMM);
      close(pad.liftMM,pad.lift*P.mmPerUnit);
      assert.equal(pad.touching,pad.travelMM>=fit.gapMM);
      if (pad.touching) close(fit.bottom+pad.lift,pad.surfaceY);
      else assert.equal(pad.liftMM,0);
      assert.ok(fit.top+pad.lift<G.HEIGHT);
    }
  }
});

test('the waterline handles horizontal segments, gaps in height and zero-length samples', () => {
  const curve=S.immersionProfile([
    {path:[[0,0,0],[0,2,0],[2,2,0],[2,2,0]],closed:false},
    {path:[[0,4,0],[0,6,0]],closed:false}
  ]);
  assert.equal(curve.total,6);
  for (const [h,f] of [[-Infinity,0],[undefined,0],[NaN,0],[1,1/6],[2,4/6],[3,4/6],[4,4/6],[5,5/6],[Infinity,1]]) {
    close(S.fractionBelow(curve,h),f);
  }
  for (const [f,h] of [[-1,0],[NaN,0],[1/6,1],[0.5,2],[4/6,2],[5/6,5],[2,6]]) close(S.heightAtFraction(curve,f),h);
  const level=S.immersionProfile([{path:[[0,3,0],[2,3,0]],closed:true}]);
  assert.equal(level.total,4);
  assert.equal(S.heightAtFraction(level,0.5),3);
  assert.equal(S.fractionBelow(level,3),1);
  assert.throws(()=>S.immersionProfile([{path:[[0,0,0],[0,0,0]]}]),RangeError);
  assert.throws(()=>S.immersionProfile([{path:[[0,0,0],[0,Infinity,0]]}]),RangeError);
});

test('the immersion lookup and the half-length stop agree with clipping every centreline segment', () => {
  const curve=S.immersionProfile(mesh.strands);
  function clipped(h) {
    let length=0, submerged=0;
    for (const {path,closed} of mesh.strands) {
      for (let i=0; i<(closed ? path.length : path.length-1); i++) {
        const a=path[i],b=path[(i+1)%path.length],d=Math.hypot(...a.map((v,k)=>v-b[k]));
        const lo=Math.min(a[1],b[1]),hi=Math.max(a[1],b[1]);
        length+=d;
        if (h>=hi) submerged+=d;
        else if (h>lo) submerged+=d*(h-lo)/(hi-lo);
      }
    }
    return submerged/length;
  }
  for (let i=0;i<=30;i++) {
    const h=profile.bottom+(profile.top-profile.bottom)*i/30;
    close(S.fractionBelow(curve,h),clipped(h));
  }
  for (const f of [0.01,0.25,0.5,0.9,0.99]) {
    const h=S.heightAtFraction(curve,f),scene=L.scene(L.timeAtWaterline(h),profile);
    close(scene.surfaceY,h); close(clipped(scene.surfaceY),f);
  }
  assert.ok(profile.wetTop<L.scene(45,profile).surfaceY);
});

test('each tracked mark follows the centre of the same rendered tube ring in every pose', () => {
  const samples=mesh.strands.filter(s=>s.key);
  assert.deepEqual(samples.map(s=>s.key),['lower','middle','crown']);
  for (const strand of samples) {
    assert.ok(strand.firstIndex%3===0 && strand.indexCount%3===0 && strand.firstIndex+strand.indexCount<=mesh.indices.length);
    const first=mesh.indices[strand.firstIndex]+strand.mark*7;
    for (const softness of [0,0.25,0.5,0.9,1]) {
      const mark=S.track(strand,softness), centre=[0,0,0];
      for (let j=first; j<first+7; j++) {
        for (let d=0;d<3;d++) centre[d]+=(mesh.vertices[j*G.STRIDE+d]*(1-softness)+mesh.hydrated[j*6+d]*softness)/7;
      }
      mark.point.forEach((v,d)=>close(v,centre[d],1e-6));
      close(mark.heightMM,(centre[1]-G.FLOOR)*P.mmPerUnit,1e-5);
      close(mark.dropMM,mark.packedMM-mark.heightMM);
    }
    assert.deepEqual(S.track(strand,NaN),S.track(strand,-1));
    assert.deepEqual(S.track(strand,2),S.track(strand,1));
  }
});

test('the captioned cross section bounds every intermediate pose against actual blended vertices', () => {
  for (const time of [36,36.75,38,39.5,41.75,L.looseTime,45]) {
    const scene=L.scene(time,profile);
    let low=Infinity,high=-Infinity;
    for (let j=0;j<mesh.hydrated.length/6;j++) {
      const y=mesh.vertices[j*G.STRIDE+1]*(1-scene.soft)+mesh.hydrated[j*6+1]*scene.soft;
      low=Math.min(low,y); high=Math.max(high,y);
    }
    close(scene.bottom,low); close(scene.top,high);
  }
});
