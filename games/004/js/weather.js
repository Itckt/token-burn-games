(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./atmosphere.js'));
  else root.HarbourWeather = factory(root.HarbourAtmosphere);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (atmosphere) {
  'use strict';
  // Haze density, rainfall, and wind relative to the ordinary harbour breeze.
  const profiles = {moonlit: [0, 0, 0], mist: [1, 0, -0.66], squall: [0.54, 1, 1]};
  return atmosphere.presets(profiles, 'moonlit', 2);
});
