(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const recorder = common ? require("./recorder.js") : root.Isobar.recorder;
  const field = common ? require("./field.js") : root.Isobar.field;
  const ui = common ? require("./ui.js") : root.Isobar.ui;

  function mount({ get, listen, state, probe }) {
    const button = get("station-record"), download = get("station-export"), status = get("station-status");
    let log = null, site = "", online = false;
    const recording = () => Boolean(log && !log.reason);

    function controls(ready = online) {
      online = ready;
      const active = recording();
      button.disabled = !online && !active;
      button.dataset.recording = String(active);
      button.textContent = active ? "Stop recording" : (log ? "New log at " : "Record at ") + (probe.probing() ? "probe" : "eyewall");
      let message = online ? "One sample per model second for up to two minutes." : "Recording needs WebGL playback.";
      if (log) {
        const activity = log.reason || (!online ? "Waiting for graphics" : state.playing ? "Recording" : "Waiting for playback");
        message = activity + " · " + site + " at release · T+ " + ui.clock(log.start);
      }
      if (status.textContent !== message) status.textContent = message;
    }

    function chart() {
      if (!log) return;
      const samples = log.samples, last = samples.at(-1);
      const span = Math.max(10, Math.ceil(last.elapsed / 10) * 10);
      const ceiling = Math.max(5, 5 * Math.ceil(Math.max(...samples.map(s => s.rain)) / 5));
      get("station-scale").textContent = String(ceiling);
      get("station-span").textContent = span + " s";
      get("station-rate").textContent = last.rain.toFixed(1);
      get("station-elapsed").textContent = last.elapsed.toFixed(1) + " s · " + samples.length + (samples.length === 1 ? " sample" : " samples");
      get("station-total").textContent = last.depth.toFixed(3);
      get("station-peak").textContent = log.peakWind.toFixed(1);
      get("station-low").textContent = log.lowPressure.toFixed(1);
      ui.stationTrace(get("station-chart"), samples, span, ceiling);
    }

    function publish() {
      download.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(recorder.csv(log)));
      download.hidden = false;
      controls();
    }

    function finish(reason) {
      if (!recording()) return;
      recorder.finish(log, state, reason);
      chart(); publish();
    }

    function advance(until, inCycle) {
      if (!recording()) return;
      const count = log.samples.length;
      recorder.advance(log, state, until, inCycle);
      if (count !== log.samples.length) chart();
      if (log.reason) publish();
    }

    listen(button, "click", () => {
      if (recording()) { finish(); return; }
      if (!online) return;
      const point = probe.probing() ? probe.observationPoint() : field.preset("wall", state);
      log = recorder.start(state, point);
      site = ui.stationLabel(field.sample(state, point));
      download.hidden = true;
      get("station-sheet").hidden = false;
      controls(); chart();
    });
    return { controls, chart, advance, finish };
  }
  if (common) module.exports = { mount };
  else (root.Isobar ||= {}).stationPanel = { mount };
})(globalThis);
