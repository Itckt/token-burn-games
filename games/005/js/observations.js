(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./lesson.js'), require('./meshes.js'), require('./packing.js'));
  } else root.CupObservations = factory(root.CupLesson, root.CupMeshes, root.CupPacking);
})(globalThis, function (L, G, P) {
  'use strict';

  function forSpecimen(profile) {
    const gap = L.gapReading(profile,profile.bottom);
    const underside = gap.originalMM.toFixed(1)+' mm';
    const seatMM = (profile.contact[1]-G.FLOOR)*P.mmPerUnit;
    const bump = L.scene(L.bumpTime,profile);
    const floorRise = (L.floorAt(L.gapProbe.x,bump.baseFlex)-G.FLOOR)*P.mmPerUnit;
    const halfway = gap.originalMM > 0 ? L.timeAtGapDepth(profile,gap.originalMM/2) : null;
    const lastTime = halfway ?? L.looseTime;
    const last = L.gapReading(profile,L.scene(lastTime,profile).bottom);
    return [
      {time:L.steps[0].start + L.steps[0].duration/2, title:'The empty pocket',
        note:'Follow the bracket from the floor to the lowest dry curl. It spans '+underside+' of air.'},
      {time:L.seatTime, title:'Back on the taper',
        note:'The block has settled again. Its outer curl meets the lining '+seatMM.toFixed(1)+' mm above the floor.'},
      {time:L.bumpTime, title:'The floor flexes',
        note:'During this knock, the base rises '+floorRise.toFixed(1)+' mm at the bracket. The block stays seated above it.'},
      {time:L.timeAtWaterline(profile.bottom), title:'First contact with the pool',
        note:'The pool has risen '+underside+' above the floor. Water now meets the lowest curl from beneath.'},
      {time:lastTime, title:halfway === null ? 'The loosened block' : 'Halfway into the old gap',
        note:'The lowest curl has reached '+last.reachedMM.toFixed(1)+' mm into the original pocket. There is still '+last.remainingMM.toFixed(1)+' mm below it.'}
    ];
  }

  function advance(state, seconds, rate, repeat, stops) {
    if (!state.playing || !Number.isFinite(seconds) || seconds <= 0) return state;
    const {index,step} = L.at(state.time);
    const next = repeat ? stops[index] : stops.find(stop => stop.time > state.time);
    if (next) {
      // Resuming exactly on a stop must allow a complete lap before a repeat.
      const wrap = repeat && next.time <= state.time;
      const target = next.time + (wrap ? step.duration : 0);
      if (state.time + seconds * L.playbackRate(rate) >= target) return L.clock(next.time);
    }
    return L.tick(state,seconds,rate,repeat);
  }
  return {forSpecimen, advance};
});
