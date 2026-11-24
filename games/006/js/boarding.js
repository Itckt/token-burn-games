(function () {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const passengers = node ? require('./passengers.js') : Nightline.passengers;
  const DOOR_TIME = 1.4, DWELL_TIME = 5;

  function createGuard() { return { enabled: false, opened: false, cleared: false, bells: 0 }; }
  function pending(car) {
    const { call } = car;
    return Boolean(call.crossing || car.destinations[call.station] ||
      (call.boarded < call.queue.length && passengers.load(car) < passengers.CAPACITY));
  }
  function canDepart(s) {
    return s.phase === 'ready' && s.target > 0 && (!s.guard.enabled || s.guard.cleared);
  }
  function active(s) {
    if (s.berth === null) return true;
    if (s.phase === 'ready') return canDepart(s);
    return s.phase !== 'dwell' || !s.guard.enabled || pending(s.car);
  }
  function toggle(s) {
    if (s.berth === null) return 'Change guard working while berthed at a station.';
    s.guard.enabled = !s.guard.enabled;
    s.guard.cleared = false;
    if (s.phase === 'dwell') s.dwell = DWELL_TIME;
    return '';
  }
  function doors(s) {
    if (s.berth === null) return 'Doors unlock when the train is berthed.';
    const closing = s.phase === 'opening' || s.phase === 'dwell';
    if (s.guard.enabled && closing && (s.phase === 'opening' || pending(s.car))) {
      return 'Keep the doors open until the passenger exchange is complete.';
    }
    s.guard.cleared = false;
    s.phase = closing ? 'closing' : 'opening';
    return '';
  }
  function readyToRing(s) {
    return s.berth !== null && s.phase === 'ready' && s.door === 0 && s.guard.opened && !pending(s.car);
  }
  function ring(s) {
    if (!s.guard.enabled) return 'Switch on guard working at a station to use the departure bell.';
    if (s.berth === null) return 'The departure bell is available at a station.';
    if (!readyToRing(s)) return 'Open for passengers, then close and lock the doors before ringing.';
    if (!s.guard.cleared) { s.guard.cleared = true; s.guard.bells++; }
    return '';
  }
  function lamp(s) {
    if (!s.guard.enabled || s.berth === null) return 0;
    if (s.guard.cleared) return 3;
    return readyToRing(s) ? 2 : 1;
  }
  function instruction(s) {
    if (s.berth === null) return 'Doors locked in motion';
    if (s.phase === 'opening') return 'Doors opening';
    if (s.phase === 'dwell') return pending(s.car) ? 'Passengers crossing' : 'Exchange complete · D to close';
    if (s.phase === 'closing') return 'Doors closing';
    if (s.guard.cleared) return s.target ? 'Right away' : 'Right away · select a speed';
    return readyToRing(s) ? 'Doors proved · B to dispatch' : 'D to open for passengers';
  }

  function advance(s, dt) {
    const guarded = s.guard.enabled;
    passengers.exchange(s.car, dt, s.phase === 'dwell' ? (guarded ? Infinity : s.dwell) : 0);
    if (s.phase === 'opening') {
      s.door = Math.min(1, s.door + dt / DOOR_TIME);
      if (s.door >= 1 - 1e-9) {
        s.door = 1; s.phase = 'dwell'; s.dwell = DWELL_TIME; s.guard.opened = true;
      }
    } else if (s.phase === 'dwell' && !guarded) {
      s.dwell = Math.max(0, s.dwell - dt);
      if (s.dwell < 1e-9) { s.dwell = 0; s.phase = 'closing'; }
    } else if (s.phase === 'closing') {
      s.door = Math.max(0, s.door - dt / DOOR_TIME);
      if (s.door < 1e-9) { s.door = 0; s.phase = 'ready'; }
    }
  }
  const api = { DOOR_TIME, DWELL_TIME, createGuard, canDepart, active, toggle, doors, ring, lamp, instruction, advance };
  if (node) module.exports = api;
  else Nightline.boarding = api;
})();
