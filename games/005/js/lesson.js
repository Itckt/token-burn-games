(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'),require('./meshes.js'),require('./packing.js'));
  else root.CupLesson = factory(root.CupMath,root.CupMeshes,root.CupPacking);
})(globalThis, function (M,G,P) {
  'use strict';
  const steps = [
    {name:'The air gap', title:'A deliberate gap', icon:'section', duration:8,
      caption:'The dry noodle block sits partway up the cup. Look beneath it and you’ll find a pocket of air between the noodles and the base.'},
    {name:'The snug fit', title:'Held by the taper', icon:'fit', duration:9,
      caption:'The cup gets narrower toward the base. The block settles where its edges meet the sloping walls, which hold it in place without a shelf.'},
    {name:'In transit', title:'Space for a bump', icon:'transit', duration:8,
      caption:'On a bumpy ride to Kowloon Tong, the snug fit keeps the block from rattling. The air gap gives the base room to flex before it hits the brittle noodles.'},
    {name:'The pour', title:'Water fills the gap', icon:'pour', duration:11,
      caption:'Hot water passes through and around the curls, filling the pocket below. As the level rises, water reaches the block from underneath as well as above.'},
    {name:'The steep', title:'Room to loosen', icon:'steam', duration:9,
      caption:'As the strands absorb water, they soften and slip apart. Watch the lower curls settle into the space that held air at the start.'}
  ];
  let duration = 0;
  steps.forEach(step => {
    step.start = duration;
    duration += step.duration;
    Object.freeze(step);
  });
  Object.freeze(steps);
  const pour = steps[3], fillDepth = 2.04, fillEnd = 0.85, poolBase = G.FLOOR + 0.01;
  const nominal = {bottom:G.BLOCK_BOTTOM, top:G.BLOCK_TOP, wetBottom:0.31, wetTop:1.90};
  const seatFraction = 0.75;
  const seatTime = steps[1].start + seatFraction * steps[1].duration;
  const bumpTime = steps[2].start + 1.02;
  const gapProbe = Object.freeze({x:0.38,z:0.68});
  const steep = steps[4], softEnd = 0.88;
  const looseTime = steep.start + steep.duration * softEnd;
  const safeTime = t => Number.isFinite(t) ? M.clamp(t, 0, duration) : 0;
  function at(t) {
    const time = safeTime(t);
    const index = steps.findIndex((s, i) => time < s.start+s.duration || i === steps.length-1);
    const step = steps[index];
    return {time, index, step, local:time-step.start, fraction:(time-step.start)/step.duration};
  }
  function scene(t, profile) {
    const {index, local, fraction:p} = at(t);
    const fit = index === 1 && p < seatFraction ? Math.sin(Math.PI*M.smooth(0,seatFraction,p)) : 0;
    const bump = index === 2 ? Math.pow(Math.max(0,Math.sin(p*Math.PI*4)), 5) * Math.sin(local*17) : 0;
    const fill = index === 3 ? M.smooth(0,fillEnd,p) : Number(index > 3);
    const soft = index === 4 ? M.smooth(0,softEnd,p) : 0;
    const lift = 0.36*fit;
    const bounds = P.posedBounds(profile || nominal, soft);
    const bottom = bounds.bottom + lift, top = bounds.top + lift;
    const water = fill*fillDepth;
    const surfaceY = poolBase+water;
    const stream = index === 3 ? M.smooth(0,0.07,p)*(1-M.smooth(0.72,0.91,p)) : 0;
    return {
      index, fraction:p, lift, bump, bottom, top, seatY:profile?.contact?.[1] ?? 1.43,
      water, surfaceY, stream,
      seep:stream*M.smooth(0.025,0.12,p)*(1-M.smooth(bottom-0.28,bottom,surfaceY)),
      steam:M.smooth(0.5,0.96,fill), soft,
      baseFlex:Math.abs(bump)*0.12,
      yaw:[M.lerp(0.035,0.22,M.smooth(0,1,p)),0.22,0.08,0.16,0.24][index],
      pitch:[0.305,0.26,0.22,0.43,0.49][index]
    };
  }
  // Invert the same fill curve used by the renderer. Return the first time the
  // mean water surface reaches the requested section of the cup.
  const inverseSmooth = value => 0.5 - Math.sin(Math.asin(1 - 2 * M.clamp(value,0,1)) / 3);
  function timeAtWaterline(height) {
    const depth = M.clamp(((Number.isFinite(height) ? height : G.FLOOR) - poolBase) / fillDepth, 0, 1);
    return pour.start + pour.duration * fillEnd * inverseSmooth(depth);
  }
  function gapReading(profile, bottom) {
    const packedY = profile.bottom;
    const originalMM = (packedY - G.FLOOR) * P.mmPerUnit;
    const reachedMM = M.clamp((packedY - bottom) * P.mmPerUnit, 0, originalMM);
    return {packedY, originalMM, reachedMM, remainingMM:originalMM-reachedMM};
  }
  // Each mesh vertex moves linearly in softness. The first vertex to cross
  // this height can be found among the precomputed lower-bound candidates.
  function timeAtGapDepth(profile, depthMM) {
    const originalMM = (profile.bottom - G.FLOOR) * P.mmPerUnit;
    if (!Number.isFinite(depthMM) || depthMM < 0 || depthMM > originalMM) return null;
    if (depthMM === 0) return steep.start;
    const candidates = profile.limits?.lower ?? [[profile.bottom,profile.wetBottom ?? profile.bottom]];
    let first = Infinity;
    for (const [dry,wet] of candidates) {
      const endMM = (profile.bottom-wet)*P.mmPerUnit;
      if (endMM < depthMM || dry <= wet) continue;
      const startMM = (profile.bottom-dry)*P.mmPerUnit;
      first = Math.min(first,(depthMM-startMM)/(endMM-startMM));
    }
    return Number.isFinite(first) ? steep.start + steep.duration * softEnd * inverseSmooth(first) : null;
  }
  function floorAt(x, flex) {
    return G.FLOOR + flex * (1 - G.FLOOR / 0.46) * (0.35 + 0.65 * M.smooth(-0.72,0.55,x));
  }
  function hasPool(scene) { return scene.water > (scene.meter ? 0 : 0.002); }
  function section(scene) {
    const {bottom,top} = scene.press ? scene : scene.fit || scene;
    const depth = scene.surfaceY;
    let pool = 'Dry pocket';
    if (hasPool(scene)) {
      if (depth < bottom - 1e-7) pool = 'Below block';
      else if (depth < top - 1e-7) pool = 'At lower curls';
      else pool = 'Block covered';
    }
    return {bottom, top, pool};
  }
  function clock(time = 0, playing = false) {
    time = safeTime(time);
    return {time, playing:!!playing && time < duration};
  }
  function pourPosition(scene, height) {
    const contact=Math.max(G.BLOCK_TOP+0.06,scene.surfaceY);
    const y=height===undefined ? contact : height;
    return [0.48+0.30*(y-contact),y,0.52];
  }
  const rates = Object.freeze([0.25, 0.5, 1, 2]);
  const playbackRate = value => rates.includes(value) ? value : 1;
  function tick(state, seconds, rate = 1, repeat = false) {
    if (!state.playing || !Number.isFinite(seconds) || seconds <= 0) return state;
    const speed = playbackRate(rate);
    if (repeat) {
      const {step, local} = at(state.time);
      const advance = (seconds % (step.duration / speed)) * speed;
      const time = step.start + (local + advance) % step.duration;
      // Rounding an offset a fraction of an ULP below the boundary can land
      // exactly on the next chapter. Keep the repeated interval half-open.
      return clock(time < step.start + step.duration ? time : step.start, true);
    }
    return clock(Math.min(duration, state.time + seconds * speed), true);
  }
  function toggle(state, repeat = false) {
    return state.time >= duration ? clock(repeat ? steps.at(-1).start : 0,true) : clock(state.time,!state.playing);
  }
  function seek(state, time) { return clock(time, state.playing); }
  function select(state, index) {
    const i = M.clamp(Math.trunc(index) || 0, 0, steps.length-1);
    return seek(state, steps[i].start);
  }
  function formatTime(t) {
    const s = Math.floor(Math.max(0, Number.isFinite(t) ? t : 0));
    return Math.floor(s/60) + ':' + String(s % 60).padStart(2,'0');
  }
  const limits = Object.freeze({minPitch:0.03, maxPitch:1.08, minZoom:0.72, maxZoom:1.65});
  function camera(yaw, pitch, zoom) {
    return {yaw, pitch:M.clamp(pitch,limits.minPitch,limits.maxPitch),
      zoom:M.clamp(zoom,limits.minZoom,limits.maxZoom)};
  }
  function orbit(view, dx, dy) { return camera(view.yaw-dx*0.008, view.pitch+dy*0.006, view.zoom); }
  function zoomBy(view, factor) { return camera(view.yaw, view.pitch, view.zoom*factor); }
  function nearestAngle(from, to) { return from + Math.atan2(Math.sin(to-from), Math.cos(to-from)); }
  return {steps, duration, seatTime, bumpTime, looseTime, gapProbe, at, scene, section, floorAt, timeAtWaterline, gapReading, timeAtGapDepth, pourPosition, poolBase, hasPool, clock, rates, playbackRate, tick, toggle, seek, select, formatTime, limits,
    camera, orbit, zoomBy, nearestAngle};
});
