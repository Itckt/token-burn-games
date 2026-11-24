(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Atlas.terrain = factory();
})(globalThis, function () {
  'use strict';
  // Heights are measured at the west and east edges. The deck and ramp share a seam.
  const ramp = {west:13, east:28.5, north:21.9, south:24.9, low:0, high:2.55, material:'timber', placeId:'terrace'};
  const deck = {west:ramp.east, east:36.6, north:16.5, south:ramp.south,
    low:ramp.high, high:ramp.high, material:'timber', placeId:'terrace'};
  const pavilion = {west:27.3, east:34.7, north:-28.7, south:-21.3, low:.19, high:.19, material:'stone', placeId:'garden'};

  function surfaceAt(x, z, surfaces = []) {
    return surfaces.find(s => x >= s.west && x <= s.east && z >= s.north && z <= s.south);
  }
  function heightOn(surface, x) {
    return surface.low + (surface.high - surface.low) * (x - surface.west) / (surface.east - surface.west);
  }
  function heightAt(x, z, surfaces) {
    const surface = surfaceAt(x, z, surfaces);
    return surface ? heightOn(surface, x) : 0;
  }
  return {ramp, deck, pavilion, surfaceAt, heightOn, heightAt};
});
