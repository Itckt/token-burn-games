(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./quay.js'), require('./vessels.js'),
    require('./lanterns.js'), require('./tide.js'), require('./beacon.js'), require('./cargo.js'), require('./cableway.js'), require('./timehouse.js'));
  else root.HarbourLookouts = factory(root.HarbourQuay, root.HarbourVessels, root.HarbourLanterns, root.HarbourTide,
    root.HarbourBeacon, root.HarbourCargo, root.HarbourCableway, root.HarbourTimehouse);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Quay, Vessels, Lanterns, Tide, Beacon, Cargo, Cableway, Timehouse) {
  'use strict';
  const above = (pose, height) => [pose.x, pose.y + height, pose.z];
  const stationCall = car => car.at ? 'At ' + car.at : 'To ' + car.next;
  const subjects = {
    wheel: {framing: 23, point: () => above(Quay.wheel, 0)},
    tram: {framing: 12, point: time => above(Quay.tramPose(time), 2.1),
      call: time => stationCall(Quay.tramPose(time)),
      next: time => ({time: Quay.nextArrival(time), action: 'Next stop'})},
    junk: {framing: 12, point: time => above(Vessels.junkPose(time), 4.1)},
    lanterns: {framing: 22, point: () => Lanterns.origin.slice(), call: time => Lanterns.cue(time).label,
      next: time => ({time: Lanterns.nextFormation(time), action: 'Next formation'})},
    landing: {framing: 17, point: time => [Tide.landing.x, Tide.heightAt(time) + Tide.landing.freeboard + 1, Tide.landing.z],
      call(time) {
        const tide = Tide.reading(time);
        return tide.label + ' · ' + tide.level;
      },
      next(time) {
        const at = Tide.nextTurn(time);
        return {time: at, action: Tide.heightAt(at) > 0 ? 'See high tide' : 'See low tide'};
      }},
    beacon: {framing: 11, point: () => [Beacon.lamp[0], 6.5, Beacon.lamp[2]],
      call: time => 'Lens bearing · ' + Beacon.sector(time),
      next(time) {
        const at = Beacon.nextBearing(time);
        return {time: at, action: 'Sweep to ' + Beacon.sector(at)};
      }},
    cargo: {framing: 18,
      point(time) {
        const rig = Cargo.transfer(time);
        // Keep both the trolley and the box in frame at the low, close ferry rail.
        return [rig.x, (rig.bottom + Cargo.rail) / 2, rig.z];
      },
      call: time => Cargo.transfer(time).label,
      next: time => ({time: Cargo.nextSetDown(time), action: 'Next delivery'})},
    cableway: {framing: 10, point: time => above(Cableway.car(time), 1.65),
      call: time => stationCall(Cableway.car(time)),
      next: time => ({time: Cableway.nextArrival(time), action: 'Next platform'})},
    timehouse: {framing: 19, point: () => [Timehouse.center[0], 13.6, Timehouse.center[2]],
      call(time) {
        const clock = Timehouse.reading(time);
        return clock.label + ' · ' + clock.signal;
      },
      next: time => ({time: Timehouse.nextDrop(time), action: 'Next ball drop'})}
  };
  function subject(id) { return Object.hasOwn(subjects, id) ? subjects[id] : null; }
  const ids = ['route', ...Object.keys(subjects)];
  const point = (id, time) => subject(id)?.point(time) ?? null;
  const call = (id, time) => subject(id)?.call?.(time) ?? '';
  const next = (id, time) => subject(id)?.next?.(time) ?? null;
  return {ids, subject, point, call, next};
});
