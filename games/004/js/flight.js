(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./math.js'), require('./weather.js'), require('./atmosphere.js'),
      require('./vessels.js'), require('./lookouts.js'));
  } else root.HarbourFlight = factory(root.HarbourMath, root.HarbourWeather, root.HarbourAtmosphere,
    root.HarbourVessels, root.HarbourLookouts);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M, Weather, Atmosphere, Vessels, Lookouts) {
  'use strict';
  const routes = [
    {name: 'Harbour drift', duration: 120, fov: 51,
      eyes: [[-5, 8.1, 80], [16, 9.4, 77], [36, 11.2, 88], [10, 12, 99], [-25, 9, 95], [-28, 7.1, 83]],
      aims: [[5, 14, -50], [11, 15, -53], [10, 17, -57], [-1, 17, -52], [-4, 14, -51], [1, 13, -49]]},
    {name: 'Neon passage', duration: 96, fov: 55,
      eyes: [[44, 5.8, 30], [60, 7, 23], [74, 8.5, 18], [56, 9.5, 35], [34, 7.5, 40], [27, 6.2, 32]],
      aims: [[24, 14, -23], [36, 15.5, -29], [39, 17, -32], [33, 16, -29], [21, 15, -24], [18, 13, -24]]},
    {name: 'Rooftop glide', duration: 150, fov: 54, overhead: true,
      eyes: [[-65, 50, 49], [-49, 55, 40], [-23, 62, 33], [-3, 65, 44], [-21, 60, 66], [-54, 53, 68]],
      aims: [[2, 15, -65], [8, 19, -66], [19, 20, -77], [23, 18, -75], [8, 15, -60], [2, 13, -57]]},
    {name: 'Ferry deck', duration: Vessels.ferryPeriod, onDeck: true}
  ];
  const speeds = [0.5, 1, 2];
  const glassPowers = [1, 2, 4];
  function lensFor(fov, aspect, power = 1) {
    const vertical = (fov + Math.max(0, 1 - aspect) * 24) * Math.PI / 180;
    const height = Math.tan(vertical / 2) / power;
    return [aspect * height, height];
  }
  function cycleGlass(state) {
    state.glass = glassPowers[(glassPowers.indexOf(state.glass) + 1) % glassPowers.length];
    if (state.reduced || !state.playing) state.magnification = state.glass;
  }
  const lookouts = Lookouts.ids, lookoutPoint = Lookouts.point;
  function nextEvent(state) {
    return Lookouts.next(state.lookout, state.worldTime);
  }
  function jumpToEvent(state) {
    const event = nextEvent(state);
    if (!event) return false;
    state.worldTime = event.time;
    const route = routes[state.route];
    if (route.onDeck) state.time = M.wrap(state.worldTime, route.duration);
    return true;
  }
  function sampleRoute(index, time) {
    const route = routes[index];
    if (route.onDeck) return Vessels.deckView(time);
    const phase = time / route.duration;
    return {eye: M.closedSpline(route.eyes, phase), aim: M.closedSpline(route.aims, phase), fov: route.fov};
  }
  function createFlight(reduceMotion = false) {
    return {route: 0, time: 0, worldTime: 0, playing: !reduceMotion, speed: 1,
      yaw: 0, pitch: 0, targetYaw: 0, targetPitch: 0, transition: null, reduced: reduceMotion,
      lookout: 'route', glass: 1, magnification: 1, weather: Weather.create(), lighting: Atmosphere.lighting.create()};
  }
  function bearing(eye, aim) {
    const [x, y, z] = M.subtract(aim, eye);
    return {yaw: Math.atan2(x, -z), pitch: Math.atan2(y, Math.hypot(x, z)), length: Math.hypot(x, y, z)};
  }
  function aimFrom(eye, yaw, pitch, length) {
    const horizontal = length * Math.cos(pitch);
    return M.add(eye, [horizontal * Math.sin(yaw), length * Math.sin(pitch), -horizontal * Math.cos(yaw)]);
  }
  function routeView(state) {
    const route = routes[state.route];
    const shot = sampleRoute(state.route, route.onDeck ? state.worldTime : state.time);
    const subject = Lookouts.subject(state.lookout);
    if (subject) {
      shot.aim = subject.point(state.worldTime);
      // North stays at the top of the aerial boat view as the junk passes underneath.
      if (state.lookout === 'junk' && route.overhead) shot.up = [0, 0, -1];
      const distance = Math.hypot(...M.subtract(shot.aim, shot.eye));
      shot.fov = M.clamp(2 * Math.atan2(subject.framing, distance) * 180 / Math.PI, 29, 65);
    }
    return shot;
  }
  function blendView(to, {from, elapsed, midDirection}) {
    const ease = M.ease(elapsed / 1.8);
    const blend = (a, b) => a.map((value, i) => M.mix(value, b[i], ease));
    const shot = {eye: blend(from.eye, to.eye), aim: blend(from.aim, to.aim), fov: M.mix(from.fov, to.fov, ease)};
    if (from.up || (to.up && ease > 0)) shot.up = blend(from.up || [0, 1, 0], to.up || [0, 1, 0]);
    if (midDirection && ease > 0) {
      // A fixed middle direction keeps the turn on the same side if the subject
      // moves directly behind or underneath the camera during the blend.
      const a = M.subtract(from.aim, from.eye), b = M.subtract(to.aim, to.eye);
      const start = M.scale(M.normalize(a), (1 - ease) ** 2);
      const middle = M.scale(midDirection, 2 * ease * (1 - ease));
      const end = M.scale(M.normalize(b), ease ** 2);
      const direction = M.normalize(M.add(M.add(start, middle), end));
      shot.aim = M.add(shot.eye, M.scale(direction, M.mix(Math.hypot(...a), Math.hypot(...b), ease)));
    }
    return shot;
  }
  function steer(shot, yaw, pitch) {
    if (!shot.up) {
      const b = bearing(shot.eye, shot.aim);
      shot.aim = aimFrom(shot.eye, b.yaw + yaw, M.clamp(b.pitch + pitch, -1.25, 1.25), b.length);
      return;
    }
    // In the north-up overhead view, drag in screen axes even at the nadir.
    const {forward, right, up} = M.cameraBasis(shot.eye, shot.aim, shot.up);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const turned = M.add(M.scale(forward, c), M.scale(right, s));
    const across = M.subtract(M.scale(right, c), M.scale(forward, s));
    const direction = M.add(M.scale(turned, Math.cos(pitch)), M.scale(up, Math.sin(pitch)));
    const distance = Math.hypot(...M.subtract(shot.aim, shot.eye));
    shot.aim = M.add(shot.eye, M.scale(direction, distance));
    shot.up = M.cross(across, direction);
  }
  function camera(state) {
    const view = routeView(state);
    const shot = state.transition ? blendView(view, state.transition) : view;
    if (state.yaw || state.pitch) steer(shot, state.yaw, state.pitch);
    return shot;
  }
  function transitionFrom(state, from, turnToSubject) {
    state.yaw = state.pitch = state.targetYaw = state.targetPitch = 0;
    state.transition = state.reduced ? null : {from, elapsed: 0};
    if (state.transition && turnToSubject) {
      const to = routeView(state);
      const a = bearing(from.eye, from.aim), b = bearing(to.eye, to.aim);
      const turn = M.wrap(b.yaw - a.yaw + Math.PI, M.TAU) - Math.PI;
      state.transition.midDirection = aimFrom([0, 0, 0], a.yaw + turn / 2, (a.pitch + b.pitch) / 2, 1);
    }
  }
  function chooseRoute(state, index) {
    if (!Number.isInteger(index) || !routes[index] || index === state.route) return false;
    const from = camera(state);
    state.route = index;
    state.time = routes[index].onDeck ? M.wrap(state.worldTime, routes[index].duration) : 0;
    transitionFrom(state, from, state.lookout !== 'route' || !!state.transition?.midDirection);
    return true;
  }
  function chooseLookout(state, subject) {
    if (!lookouts.includes(subject) || subject === state.lookout) return false;
    const from = camera(state);
    state.lookout = subject;
    transitionFrom(state, from, true);
    return true;
  }
  function look(state, yaw, pitch) {
    state.targetYaw = M.clamp(state.targetYaw + yaw / state.magnification, -0.73, 0.73);
    state.targetPitch = M.clamp(state.targetPitch + pitch / state.magnification, -0.39, 0.39);
  }
  function seek(state, fraction, crossingStart = state.worldTime - state.time) {
    if (Number.isFinite(fraction)) {
      const route = routes[state.route], time = M.clamp(fraction, 0, 1) * route.duration;
      // On board the timeline belongs to the vessel. Repeated inputs at the
      // right endpoint must stay on the same lap until playback resumes.
      if (route.onDeck) state.worldTime = crossingStart + time;
      state.time = time;
      state.transition = null;
    }
  }
  function advance(state, delta) {
    const dt = Number.isFinite(delta) ? M.clamp(delta, 0, 0.12) : 0;
    if (state.playing && dt > 0) {
      const route = routes[state.route];
      state.worldTime += dt * state.speed;
      state.time = M.wrap(route.onDeck ? state.worldTime : state.time + dt * state.speed, route.duration);
      Weather.advance(state.weather, dt);
      Atmosphere.lighting.advance(state.lighting, dt);
    }
    if (state.transition) {
      state.transition.elapsed += dt;
      if (state.transition.elapsed >= 1.8) state.transition = null;
    }
    const blend = state.reduced ? 1 : 1 - Math.exp(-12 * dt);
    if (state.magnification !== state.glass) {
      state.magnification = M.mix(state.magnification, state.glass, state.playing ? blend : 1);
      if (Math.abs(state.magnification - state.glass) < 0.001) state.magnification = state.glass;
    }
    state.yaw = M.mix(state.yaw, state.targetYaw, blend);
    state.pitch = M.mix(state.pitch, state.targetPitch, blend);
  }
  function cycleSpeed(state) {
    state.speed = speeds[(speeds.indexOf(state.speed) + 1) % speeds.length];
  }
  function formatTime(seconds) {
    const whole = Math.floor(Math.max(0, seconds));
    return String(Math.floor(whole / 60)).padStart(2, '0') + ':' + String(whole % 60).padStart(2, '0');
  }
  function renderSize(width, height, dpr, quality = 1) {
    const w = Math.max(1, width), h = Math.max(1, height);
    const ratio = Math.min(M.clamp(dpr, 0.75, 1.5), Math.sqrt(1900000 / (w * h))) * M.clamp(quality, 0.55, 1);
    return [Math.max(1, Math.round(w * ratio)), Math.max(1, Math.round(h * ratio))];
  }
  return {routes, speeds, lookouts, lookoutPoint, nextEvent, jumpToEvent, sampleRoute, createFlight, camera, chooseRoute, chooseLookout,
    look, seek, advance, cycleSpeed, cycleGlass, lensFor, formatTime, renderSize};
});
