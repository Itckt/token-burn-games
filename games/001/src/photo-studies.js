(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./simulation.js'), require('./collision.js'));
  else root.Atlas.studies = factory(root.Atlas.math, root.Atlas.sim, root.Atlas.collision);
})(globalThis, function (M, sim, collision) {
  'use strict';
  const PREFIX = 'campus-atlas.study.v1.';
  const RADIUS = 1.45;
  function atLookout(state, world) {
    return world.places.find(({study,view:[x,z]}) => study &&
      Math.hypot(state.x-x,state.z-z) <= RADIUS && collision.canWalk(state.x,state.z,x,z,world));
  }
  function framingCue(delta, yaw, pitch, zoom, aspect) {
    const {forward,right,up} = M.basis(yaw,pitch);
    const depth = M.dot(delta,forward), horizontal=M.dot(delta,right), vertical=M.dot(delta,up);
    if (depth <= 0) {
      // Looking down from the correct bearing can also put a high subject
      // behind the near plane. Turning sideways would send it farther away.
      if (delta[0]*Math.sin(yaw)-delta[2]*Math.cos(yaw)>0) return vertical < 0 ? 'Tilt down' : 'Tilt up';
      return horizontal < 0 ? 'Turn left toward the subject' : 'Turn right toward the subject';
    }
    // Normalized device coordinates. The middle third of the viewfinder uses
    // the same vertical lens and drawing-buffer aspect as the exposed frame.
    const halfHeight = depth*M.lensScale(zoom);
    const x = horizontal/(halfHeight*aspect), y = vertical/halfHeight;
    if (Math.max(Math.abs(x),Math.abs(y)) <= 1/3) return '';
    if (Math.abs(x) > Math.abs(y)) return x < 0 ? 'Pan left' : 'Pan right';
    return y < 0 ? 'Tilt down' : 'Tilt up';
  }
  function assess(state, world, zoom, aspect) {
    if (!(Number.isFinite(aspect) && aspect > 0)) return null;
    const place = atLookout(state,world);
    if (!place) return null;
    const study = place.study;
    let cue;
    if (study.light === 'day' && state.light > .02) cue = state.night ? 'Use daylight (N)' : 'Waiting for daylight';
    else if (study.light === 'night' && state.light < .98) cue = state.night ? 'Waiting for nightfall' : 'Use night lighting (N)';
    else if (study.rain && !state.weather.shower) cue = 'Use a rain shower (R)';
    else if (study.rain && state.weather.wet < .55) cue = 'Waiting for rain';
    else if (study.zoom !== zoom) cue = 'Set the lens to '+study.zoom+'×';
    else cue = framingCue(M.sub(study.target,sim.eyePosition(state,world)),state.yaw,state.pitch,zoom,aspect);
    return {place,ready:!cue,cue:cue || 'In frame · take postcard'};
  }
  return {PREFIX, RADIUS, atLookout, framingCue, assess};
});
