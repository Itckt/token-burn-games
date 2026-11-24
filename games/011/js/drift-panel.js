(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const drift = common ? require("./drift.js") : root.Isobar.drift;
  const ui = common ? require("./ui.js") : root.Isobar.ui;

  function mount({ get, all, listen, state, schedule, origin, place, showMap }) {
    const choices = all("[data-horizon]"), summary = get("drift-summary"), result = get("drift-result");
    const release = get("drift-release");
    let horizon = 30;

    function plot(launch) {
      const route = drift.trace(launch, horizon);
      state.drift = route;
      const travel = route.reachedEye ? "Within 1 km of the eye after " + route.elapsed.toFixed(1) + " min" :
        route.minutes + " min · " + route.endKm.toFixed(1) + " km from the eye";
      summary.textContent = "T+ " + ui.clock(launch.time) + " · Signal " + launch.signal + " at release · " +
        route.distanceKm.toFixed(1) + " km travelled · " + travel;
      result.hidden = false;
      schedule();
    }

    function clear() {
      state.drift = null;
      result.hidden = true;
      summary.textContent = "Trace a parcel through the wind measured at release.";
      schedule();
    }

    listen(release, "click", () => {
      const point = origin();
      if (!point) return;
      plot(drift.release(state, point));
      showMap();
    });
    for (const button of choices) listen(button, "click", () => {
      horizon = Number(button.dataset.horizon);
      for (const other of choices) other.setAttribute("aria-pressed", String(other === button));
      if (state.drift) plot(state.drift.launch);
    });
    listen(get("drift-inspect"), "click", () => { if (state.drift) place(state.drift.end); });
    listen(get("drift-clear"), "click", () => { release.focus({ preventScroll: true }); clear(); });
    return { clear };
  }
  if (common) module.exports = { mount };
  else (root.Isobar ||= {}).driftPanel = { mount };
})(globalThis);
