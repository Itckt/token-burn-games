(function () {
  'use strict';

  const node = typeof module !== 'undefined' && module.exports;
  const { clamp } = node ? require('./math.js') : Nightline.math;
  const route = node ? require('./route.js') : Nightline.route;
  const service = node ? require('./service.js') : Nightline.service;
  const passengers = node ? require('./passengers.js') : Nightline.passengers;
  const traction = node ? require('./traction.js') : Nightline.traction;
  const weather = node ? require('./weather.js') : Nightline.weather;
  const signals = node ? require('./signals.js') : Nightline.signals;
  const recorder = node ? require('./recorder.js') : Nightline.recorder;
  const lineSpeed = node ? require('./line-speed.js') : Nightline.lineSpeed;
  const boarding = node ? require('./boarding.js') : Nightline.boarding;
  const daylight = node ? require('./daylight.js') : Nightline.daylight;
  const comfort = node ? require('./comfort.js') : Nightline.comfort;
  const duties = node ? require('./duties.js') : Nightline.duties;
  const { STATIONS, legLength, nextStation } = route;
  const { MAX_KMH, brakingLimit } = lineSpeed;
  const ACCEL = 1.10, BRAKE = 1.36, STOP_BRAKE = 2.50;
  const { DOOR_TIME, DWELL_TIME } = boarding;

  const LEVEL_RANGE = 8, LEVEL_SPEED = 1.25, BERTH_EPSILON = 0.0002;

  function createRide() {
    return { position: 0, speed: 0, target: 0, berth: 0, last: 0, nextMark: STATIONS[1].at,
      phase: 'ready', door: 0, dwell: 0, hardBrake: false, paused: false, time: 0, fraction: 0,
      manual: false, protection: false, alignment: null, sheet: service.createSheet(), recording: null,
      signalled: false, signalBrake: false, limits: false, lineBrake: false,
      guard: boarding.createGuard(), clock: daylight.createClock(),
      duty: 'free', quality: comfort.createLog(), swing: comfort.createSwing(),
      coasting: false, meter: traction.createMeter(), car: passengers.createCar(), weather: weather.createWeather() };
  }

  function selectDuty(s, card) {
    if (s.paused) return 'Resume the ride to change duty.';
    if (s.berth === null) return 'Choose a duty while berthed at a station.';
    if (typeof card !== 'string' || !Object.hasOwn(duties.cards, card)) return 'Choose a listed duty.';
    s.duty = card;
    return '';
  }

  function command(s, action) {
    if (action === 'pause') { s.paused = !s.paused; return ''; }
    if (s.paused) return 'Resume the ride to use the controls.';
    if (action === 'rain') { s.weather.rain = !s.weather.rain; return ''; }
    if (action === 'wipe') { weather.wipe(s.weather); return ''; }
    if (action === 'shift') { daylight.nextShift(s.clock); return ''; }
    if (action === 'guard') return boarding.toggle(s);
    if (action === 'bell') return boarding.ring(s);
    if (action === 'limits') {
      if (s.berth === null) return 'Change line speed supervision while berthed at a station.';
      s.limits = !s.limits;
      return '';
    }
    if (action === 'signals') {
      if (s.berth === null) return 'Change signal working while berthed at a station.';
      s.signalled = !s.signalled;
      return '';
    }
    if (action === 'mode') {
      if (s.berth === null) return 'Change stopping mode while berthed at a station.';
      s.manual = !s.manual;
      return '';
    }
    if (s.alignment) return 'Levelling at the stop board. Doors and traction are locked.';
    switch (action) {
      case 'faster': s.coasting = false; s.target = Math.min(MAX_KMH, s.target + 10); s.hardBrake = false; break;
      case 'slower': s.coasting = false; s.target = Math.max(0, s.target - 10); break;
      case 'brake': s.coasting = false; s.target = 0; s.hardBrake = s.speed > 0; break;
      case 'coast':
        if (s.berth !== null || !s.target) return 'Select a target and depart before coasting.';
        s.coasting = !s.coasting;
        break;
      case 'doors': return boarding.doors(s);
      default: return '';
    }
    return '';
  }

  function bookedTime(s) {
    return signals.booked(s.last, s.signalled) + (s.limits ? lineSpeed.allowance(s.last, s.signalled) : 0);
  }

  function arrive(s, error = null, atLimit = false) {
    s.position = s.nextMark;
    s.speed = 0;
    s.hardBrake = false;
    s.coasting = false;
    s.meter.power = 0;
    s.protection = false;
    s.signalBrake = false;
    s.lineBrake = false;
    const trace = recorder.advance(s.recording, s, true);
    const entry = service.recordArrival(s.sheet, s.last, s.time, error, atLimit, s.meter,
      { booked: bookedTime(s), trace, arrivalClock: daylight.clockLabel(s.clock), quality: s.quality });
    entry.duty = duties.result(s.duty, entry);
    s.recording = null;
    s.alignment = null;
    s.last = nextStation(s.last);
    s.berth = s.last;
    s.car.call = passengers.platformCall(s.sheet.count);
    s.guard.opened = false;
    s.guard.cleared = false;
    s.nextMark += legLength(s.last);
    s.phase = 'opening';
  }

  function startAlignment(s, error, atLimit) {
    s.speed = 0; s.target = 0; s.hardBrake = false; s.protection = false;
    s.coasting = false;
    if (Math.abs(error) <= BERTH_EPSILON) { arrive(s, error, atLimit); return; }
    // For smoothstep, peak speed is 1.5d/T and peak acceleration is 6d/T².
    const distance = Math.abs(error);
    const duration = Math.max(0.5, 1.5 * distance / LEVEL_SPEED, Math.sqrt(6 * distance / ACCEL));
    s.alignment = { error, atLimit, elapsed: 0, duration };
    s.phase = 'aligning';
  }

  function align(s, dt) {
    const a = s.alignment;
    const before = s.speed, position = s.position;
    a.elapsed += dt;
    const t = Math.min(1, a.elapsed / a.duration);
    s.position = s.nextMark + a.error * (1 - t * t * (3 - 2 * t));
    s.speed = Math.abs(a.error) * 6 * t * (1 - t) / a.duration;
    measureTravel(s, before, Math.abs(s.position - position), dt, -Math.sign(a.error));
    if (t === 1) arrive(s, a.error, a.atLimit);
  }

  function measureTravel(s, before, distance, dt, direction = 1, freewheel = false) {
    traction.measure(s.meter, passengers.load(s.car), before, s.speed, distance, dt, s.coasting);
    comfort.travel(s, before, distance, dt, direction, freewheel);
  }

  function requestedSpeed(s, dt) {
    if (s.coasting) return Math.max(0, s.speed - traction.resistance(s.speed) * dt);
    return s.speed + clamp(s.target / 3.6 - s.speed, -(s.hardBrake ? STOP_BRAKE : BRAKE) * dt, ACCEL * dt);
  }

  function run(s, dt) {
    const remaining = s.nextMark - s.position, previous = s.speed;
    const requested = requestedSpeed(s, dt);
    const brake = s.manual ? STOP_BRAKE : BRAKE;
    const endDistance = Math.max(0, remaining + (s.manual ? LEVEL_RANGE : 0));
    const allowed = brakingLimit(endDistance, previous, brake, dt);
    s.protection = s.manual && !s.hardBrake && requested > allowed + 1e-9;
    s.speed = Math.min(requested, allowed);
    const curveLimit = s.limits ? lineSpeed.speedLimit(s.position, previous, BRAKE, dt) : Infinity;
    s.lineBrake = s.speed > curveLimit + 1e-9;
    s.speed = Math.min(s.speed, curveLimit);
    const signalDistance = signals.stopDistance(s);
    s.signalBrake = false;
    if (Number.isFinite(signalDistance)) {
      const limit = brakingLimit(signalDistance, previous, BRAKE, dt);
      s.signalBrake = s.speed > limit + 1e-9;
      s.speed = Math.min(s.speed, limit);
    }
    if (s.speed <= 0) { s.speed = 0; s.hardBrake = false; }
    const distance = Math.min(endDistance, signalDistance, (previous + s.speed) * 0.5 * dt);
    s.position += distance;
    // Finish the last fraction of a millimetre only when this tick can bring
    // the train to rest within its brake rate. Meter the complete deceleration.
    if (endDistance - distance <= BERTH_EPSILON && previous <= brake * dt + 1e-9) s.speed = 0;
    measureTravel(s, previous, distance, dt, 1, s.coasting && s.speed === requested);
    const error = s.position - s.nextMark;
    if (s.manual) {
      if (error >= LEVEL_RANGE - BERTH_EPSILON && s.speed === 0) {
        s.position = s.nextMark + LEVEL_RANGE;
        startAlignment(s, LEVEL_RANGE, true);
      } else if (s.speed === 0 && (!s.target || s.coasting) && error >= -LEVEL_RANGE) {
        startAlignment(s, error, false);
      }
    } else if (s.speed === 0 && error >= -BERTH_EPSILON) {
      arrive(s);
    }
  }

  function step(s, dt) {
    s.time += dt;
    weather.advance(s.weather, dt, s.position);
    if (s.berth !== null) {
      if (!boarding.canDepart(s)) {
        if (s.phase !== 'ready') boarding.advance(s, dt);
        comfort.swing(s.swing, 0, 0, dt);
        return;
      }
      s.phase = 'running'; s.berth = null;
      s.sheet.departedAt = s.time - dt;
      s.meter = traction.createMeter();
      s.quality = comfort.createLog();
      s.recording = recorder.begin(s);
    }
    daylight.advance(s.clock);
    if (s.alignment) align(s, dt);
    else run(s, dt);
    if (s.recording) recorder.advance(s.recording, s);
  }

  function advance(s, seconds) {
    if (s.paused || !Number.isFinite(seconds) || seconds <= 0) return;
    const ticks = s.fraction + seconds * 60;
    const n = Math.floor(ticks + 1e-10);
    if (!Number.isSafeInteger(n)) return;
    s.fraction = Math.max(0, ticks - n);
    for (let i = 0; i < n; i++) step(s, 1 / 60);
  }

  function driveState(s) {
    if (s.paused) return 'Paused';
    if (s.berth !== null) {
      if (s.guard.enabled && s.phase === 'ready') return s.guard.cleared ? 'Right away' : 'Guard hold';
      return s.phase === 'ready' ? 'Ready' : 'Boarding';
    }
    if (s.alignment) return 'Levelling';
    if (s.speed === 0 && signals.stopDistance(s) < BERTH_EPSILON) return 'Signal hold';
    if (s.signalBrake) return 'Signal brake';
    if (s.protection) return 'Protection';
    if (s.hardBrake) return 'Braking';
    if (s.lineBrake) {
      const slowing = s.meter.power < 0 && s.speed * 3.6 > lineSpeed.zones[s.last].kmh + 0.05;
      return slowing ? 'Line brake' : 'Line limit';
    }
    if (s.speed < 0.001 && (!s.target || s.coasting)) return 'Stopped';
    if (!s.manual && s.target && s.speed * s.speed / (2 * BRAKE) + 1 >= s.nextMark - s.position) return 'Arriving';
    if (s.coasting) return 'Coasting';
    if (s.speed * 3.6 < s.target - 0.2) return 'Powering';
    if (s.speed * 3.6 > s.target + 0.2) return 'Braking';
    return 'Cruising';
  }

  function doorState(s) {
    return ({ opening: 'Opening', dwell: 'Open', closing: 'Closing' })[s.phase] || 'Closed';
  }

  function distanceLabel(metres) {
    return metres >= 1000 ? (metres / 1000).toFixed(2) + ' km' : Math.max(0, Math.round(metres)) + ' m';
  }

  function brakeOffset(s) { return s.speed * s.speed / (2 * STOP_BRAKE) - (s.nextMark - s.position); }

  function gaugePosition(s) {
    if (!s.manual || s.phase !== 'running') return null;
    const offset = brakeOffset(s);
    return offset < -12 ? null : clamp(offset / 12, -1, 1);
  }

  function brakeCue(s) {
    if (s.alignment) return 'Levelling · ' + service.markLabel(s.alignment.error, s.alignment.atLimit);
    if (s.berth !== null) return 'Aim within ' + service.MARK_TOLERANCE + ' m of the stop board';
    const remaining = s.nextMark - s.position;
    if (s.protection) return 'Overrun protection braking';
    if (!s.speed && (!s.target || s.coasting)) return 'Move up · ' + distanceLabel(remaining) + ' to the board';
    const margin = -brakeOffset(s);
    if (s.hardBrake) return 'Braking · ' + Math.abs(margin).toFixed(1) + ' m ' + (margin >= 0 ? 'short' : 'long');
    if (margin <= service.MARK_TOLERANCE) return 'Brake now';
    return 'Brake in ' + (margin < 10 ? margin.toFixed(1) + ' m' : distanceLabel(margin));
  }

  const keys = new Map(Object.entries({
    ArrowUp: 'faster', KeyW: 'faster', ArrowDown: 'slower', KeyS: 'slower', Space: 'brake',
    KeyD: 'doors', KeyP: 'pause', ArrowLeft: 'left', ArrowRight: 'right', KeyR: 'center',
    KeyV: 'view', KeyM: 'mode', KeyH: 'help', Slash: 'help', Escape: 'dismiss',
    KeyC: 'coast', KeyT: 'rain', KeyX: 'wipe', KeyG: 'signals', KeyL: 'leftView',
    KeyZ: 'limits', KeyJ: 'guard', KeyB: 'bell', KeyN: 'shift', KeyI: 'saloon'
  }));
  function keyAction(code) { return keys.get(code) || ''; }

  const api = { ...route, MAX_KMH, DOOR_TIME, DWELL_TIME, LEVEL_RANGE, createRide, command, selectDuty, advance,
    driveState, doorState, distanceLabel, keyAction, brakeCue, brakeOffset, gaugePosition, bookedTime };
  if (node) module.exports = api;
  else Nightline.ride = api;
})();
