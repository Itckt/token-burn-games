(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./math"));
  else root.FieldAtlas.weather = factory(root.FieldAtlas.math);
})(globalThis, function (M) {
  "use strict";

  // The two weights drive mist and rainfall in every pass, including the lake reflection.
  const profiles = { clear: [0, 0], mist: [1, 0], squall: [0.56, 1] };
  const FADE_SECONDS = 2.4;
  function create() {
    return { name: "clear", weights: [0, 0], from: [0, 0], seconds: FADE_SECONDS };
  }
  function select(state, name) {
    if (!Object.hasOwn(profiles, name)) throw new RangeError("Unknown weather");
    if (name === state.name) return;
    state.name = name;
    state.from = state.weights.slice();
    state.seconds = 0;
  }
  function advance(state, seconds) {
    if (state.seconds >= FADE_SECONDS || !(seconds > 0)) return;
    state.seconds = Math.min(FADE_SECONDS, state.seconds + seconds);
    const target = profiles[state.name], blend = M.smoothstep(0, FADE_SECONDS, state.seconds);
    for (let i = 0; i < target.length; i++) {
      state.weights[i] = state.seconds === FADE_SECONDS ? target[i] : M.lerp(state.from[i], target[i], blend);
    }
  }
  return { create, select, advance, FADE_SECONDS };
});
