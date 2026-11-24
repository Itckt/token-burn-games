/* Weather and traffic run on café time, which pauses when the page is hidden. */
(function () {
  'use strict';
  const skies = {
    afternoon: {rain:0, night:0},
    shower: {rain:1, night:0},
    evening: {rain:0, night:1}
  };
  const modes = Object.keys(skies);
  function createLight() {
    return {mode:'afternoon', ...skies.afternoon};
  }
  function setLight(light, mode, instant = false) {
    if (!modes.includes(mode)) return;
    light.mode = mode;
    if (instant) Object.assign(light,skies[mode]);
  }
  function stepLight(light, dt) {
    if (!Number.isFinite(dt) || dt<=0) return;
    const target = skies[light.mode], ease = 1-Math.exp(-6*dt);
    for (const channel of ['rain','night']) {
      const gap = target[channel]-light[channel];
      light[channel] += gap*ease;
      if (Math.abs(gap)<.001) light[channel]=target[channel];
    }
  }

  // The bus clears the last sash before reappearing beyond the first one.
  const bus = {width:.166, top:.698, height:.255, period:36};
  function busLeft(time) {
    const phase = ((time+8)%bus.period+bus.period)%bus.period;
    return -.20 + phase*.045;
  }
  const api = {modes, createLight, setLight, stepLight, bus, busLeft};
  if (typeof module==='object' && module.exports) module.exports=api;
  else PocketPlaces.street=api;
})();
