(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'));
  else root.HarbourAtmosphere = factory(root.HarbourMath);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';

  // Both controls can be interrupted or changed while the harbour is paused.
  function presets(profiles, initial, duration) {
    function create() {
      return {id: initial, values: profiles[initial].slice(), from: null, elapsed: 0};
    }
    function select(state, id, animate) {
      if (!Object.hasOwn(profiles, id) || (state.id === id && (animate || !state.from))) return false;
      state.id = id;
      state.elapsed = 0;
      state.from = animate ? state.values.slice() : null;
      if (!animate) state.values = profiles[id].slice();
      return true;
    }
    function advance(state, seconds) {
      if (!state.from || !Number.isFinite(seconds) || seconds <= 0) return;
      state.elapsed = Math.min(duration, state.elapsed + seconds);
      const t = state.elapsed / duration;
      const target = profiles[state.id];
      if (t === 1) {
        state.from = null;
        state.values = target.slice();
      } else {
        const ease = M.ease(t);
        state.values = state.from.map((value, i) => M.mix(value, target[i], ease));
      }
    }
    return {profiles, create, select, advance};
  }

  // Weights of western twilight and eastern dawn. The remainder is moonlight.
  const lighting = presets({midnight: [0, 0], blue: [1, 0], dawn: [0, 1]}, 'midnight', 3);
  return {presets, lighting};
});
