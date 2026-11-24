(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const math = common ? require("./math.js") : root.Isobar.math;
  const field = common ? require("./field.js") : root.Isobar.field;
  const relief = common ? require("./relief.js") : root.Isobar.relief;
  const lighting = common ? require("./lighting.js") : root.Isobar.lighting;
  const doppler = common ? require("./doppler.js") : root.Isobar.doppler;
  const ui = common ? require("./ui.js") : root.Isobar.ui;
  const MAP_NAMES = { radar: "Rain rate", doppler: "Doppler wind", wind: "Wind field", pressure: "Pressure relief" };

  function mount({ doc, get, all, listen, state, schedule, changed, probePoint, readings }) {
    const imagery = all("[data-imagery]"), layers = all("[data-layer]"), products = all("[data-product]");
    const sites = all("[data-site]"), compare = get("compare-toggle"), divider = get("compare-divider");
    const position = get("compare-position"), lightTime = get("light-time");
    let online = false;

    function colorScale(id, stops, value, tickName) {
      const low = stops[0][value], span = stops.at(-1)[value] - low;
      const fraction = stop => (stop[value] - low) / span * 100 + "%";
      const colors = stops.map(stop => stop.color + " " + fraction(stop));
      get(id).style.setProperty("--ramp", "linear-gradient(to right, " + colors.join(", ") + ")");
      for (const tick of all("[data-" + tickName + "]")) {
        const stop = stops[Number(tick.dataset[tickName])];
        tick.textContent = String(stop[value]);
        tick.style.left = fraction(stop);
      }
    }
    for (const swatch of all("[data-band]")) {
      const band = field.BANDS[Number(swatch.dataset.band)];
      swatch.textContent = String(band.rate);
      swatch.style.setProperty("--echo", band.color);
    }
    colorScale("wind-ramp", field.WIND_STOPS, "speed", "stop");
    colorScale("pressure-ramp", relief.STOPS, "pressure", "isobar");
    colorScale("doppler-ramp", doppler.STOPS, "speed", "velocity");

    function syncLight() {
      const time = lighting.clock(state.lightMinutes), period = lighting.at(state.lightMinutes).period;
      lightTime.value = String(state.lightMinutes);
      lightTime.setAttribute("aria-valuetext", time + ", " + period);
      get("light-reading").textContent = time + " · " + period;
    }

    function syncPosition() {
      position.value = String(state.cloudPercent);
      const percent = state.cloudPercent + "%";
      position.setAttribute("aria-valuetext", percent + " clouds, " + (100 - state.cloudPercent) + "% map");
      get("stage").style.setProperty("--split", percent);
    }

    function syncSite() {
      const antenna = doppler.site(state);
      for (const button of sites) {
        const preset = doppler.SITES[button.dataset.site];
        button.setAttribute("aria-pressed", String(antenna.x === preset.x && antenna.z === preset.z));
      }
      const km = v => (Math.abs(v) * field.KM_PER_UNIT).toFixed(1);
      get("radar-coordinates").textContent = km(antenna.x) + " km " + (antenna.x < 0 ? "W" : "E") + " · " +
        km(antenna.z) + " km " + (antenna.z > 0 ? "S" : "N");
      get("radar-place").disabled = !online || !probePoint();
    }

    function sync() {
      const mode = state.imagery, radar = mode === "radar" || mode === "doppler";
      const split = online && state.comparing, mapOnly = mode !== "cloud" && !state.comparing;
      if (!split && doc.activeElement === position) (online ? compare : get("storm-canvas")).focus({ preventScroll: true });
      const hidingProduct = (!online || !radar) && get("radar-products").contains(doc.activeElement);
      const hidingSite = mode !== "doppler" && get("radar-sites").contains(doc.activeElement);
      if (hidingProduct || hidingSite) {
        const next = online ? imagery.find(button => button.dataset.imagery === (radar ? "radar" : mode)) : get("storm-canvas");
        next.focus({ preventScroll: true });
      }
      for (const button of imagery) {
        button.disabled = !online;
        button.setAttribute("aria-pressed", String(button.dataset.imagery === (radar ? "radar" : mode)));
        ui.drawIcon(button.querySelector("[data-icon]"));
      }
      for (const button of products) button.setAttribute("aria-pressed", String(mode === button.dataset.product));
      for (const name of Object.keys(MAP_NAMES)) get(name + "-key").hidden = !online || mode !== name;
      get("radar-products").hidden = !online || !radar;
      get("radar-sites").hidden = mode !== "doppler";
      get("radial-reading").hidden = mode !== "doppler";
      get("radar-rings").hidden = get("wind-rings").hidden = !state.layers.grid;
      for (const input of layers) input.disabled = mapOnly && input.dataset.layer !== "grid";
      get("layer-note").hidden = !mapOnly;
      lightTime.disabled = !online || mapOnly;
      compare.disabled = !online;
      compare.setAttribute("aria-pressed", String(state.comparing));
      get("stage").dataset.comparing = String(split);
      divider.hidden = get("cloud-markers").hidden = get("compare-map-name").hidden = !split;
      get("compare-map-name").textContent = MAP_NAMES[mode] || "";
      syncSite();
    }

    function select(mode) {
      if (!online || state.imagery === mode) return;
      if (mode === "cloud") state.comparing = false;
      state.imagery = mode;
      sync(); changed();
    }

    function toggleCompare() {
      if (!online) return;
      state.comparing = !state.comparing;
      if (state.comparing && state.imagery === "cloud") state.imagery = "radar";
      sync(); changed();
      if (state.comparing) position.focus({ preventScroll: true });
    }

    function placeSite(point) {
      if (!online || !field.inRange(point)) return;
      state.radarSite = { x: point.x, z: point.z };
      syncSite(); readings(); schedule();
    }

    listen(position, "input", () => {
      const value = Number(position.value);
      if (Number.isFinite(value)) state.cloudPercent = math.clamp(Math.round(value), 0, 100);
      syncPosition(); schedule();
    });
    listen(lightTime, "input", () => {
      const value = Number(lightTime.value);
      if (Number.isFinite(value)) state.lightMinutes = math.clamp(Math.round(value / 15) * 15, 0, lighting.DAY);
      syncLight(); schedule();
    });
    for (const button of imagery) listen(button, "click", () => {
      if (button.dataset.imagery === "radar" && state.imagery === "doppler") return;
      select(button.dataset.imagery);
    });
    for (const button of products) listen(button, "click", () => select(button.dataset.product));
    for (const button of sites) listen(button, "click", () => placeSite(doppler.SITES[button.dataset.site]));
    listen(get("radar-place"), "click", () => placeSite(probePoint()));
    listen(compare, "click", toggleCompare);
    syncPosition(); syncLight(); sync();
    return { select, sync, syncSite, toggleCompare, availability(ready) { online = ready; sync(); } };
  }
  if (common) module.exports = { mount };
  else (root.Isobar ||= {}).imageryPanel = { mount };
})(globalThis);
