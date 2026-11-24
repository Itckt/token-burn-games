(function (root) {
  'use strict';
  const L = root.CupLesson, O = root.CupObservations;
  const byId = id => document.getElementById(id);

  function mount(profile, changed, pauseAt) {
    const speed = byId('speed'), repeatButton = byId('repeat'), observe = byId('observe');
    const panel = byId('observation'), mark = byId('observation-mark'), visit = byId('visit-stop');
    const stops = O.forSpecimen(profile);
    let rate = 1, repeat = false, observing = false, active = null, held = false;

    function setRate(value) {
      rate = L.playbackRate(value);
      speed.value = String(rate);
    }
    function setRepeat(on) {
      repeat = on;
      repeatButton.setAttribute('aria-pressed',String(on));
    }
    function toggleRepeat() { setRepeat(!repeat); changed(false); }
    function toggleObservations() {
      observing = !observing;
      observe.setAttribute('aria-pressed',String(observing));
      panel.hidden = mark.hidden = !observing;
      active = null;
      changed(true);
    }
    function sync(state, index) {
      if (!observing) return false;
      const stop = stops[index];
      const atStop = !state.playing && state.time === stop.time;
      if (active !== stop || held !== atStop) {
        const hundredths = Math.round(stop.time*100);
        const time = L.formatTime(hundredths/100)+'.'+String(hundredths % 100).padStart(2,'0');
        byId('stop-time').textContent = time;
        byId('stop-title').textContent = stop.title;
        byId('stop-note').textContent = atStop ? stop.note : '';
        visit.disabled = atStop;
        mark.style.left = (100*stop.time/L.duration)+'%';
        panel.classList.toggle('at-stop',atStop);
        active = stop;
        held = atStop;
      }
      return atStop;
    }
    function tick(state, dt) {
      return observing ? O.advance(state,dt,rate,repeat,stops) : L.tick(state,dt,rate,repeat);
    }
    setRate(1);
    speed.addEventListener('change', () => { setRate(Number(speed.value)); changed(true); });
    repeatButton.addEventListener('click',toggleRepeat);
    observe.addEventListener('click',toggleObservations);
    visit.addEventListener('click', () => { if (active) pauseAt(active.time); });
    return {setRate, setRepeat, toggleRepeat, toggleObservations, sync, tick, get repeating() { return repeat; }};
  }
  root.CupPlaybackControls = {mount};
})(globalThis);
