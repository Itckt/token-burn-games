(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const field = common ? require("./field.js") : root.Isobar.field;
  const math = common ? require("./math.js") : root.Isobar.math;
  const relief = common ? require("./relief.js") : root.Isobar.relief;
  const doppler = common ? require("./doppler.js") : root.Isobar.doppler;
  const imageryPanel = common ? require("./imagery-panel.js") : root.Isobar.imageryPanel;
  const driftPanel = common ? require("./drift-panel.js") : root.Isobar.driftPanel;
  const ui = common ? require("./ui.js") : root.Isobar.ui;

  function mount({ doc, get, all, listen, state, schedule, resize }) {
    const toggle = get("probe-toggle"), tray = get("probe-tray"), placements = all("[data-probe]");
    const eye = get("eye-marker"), marker = get("probe-marker"), hint = get("probe-hint");
    const cloudEye = get("cloud-eye"), cloudProbe = get("cloud-probe");
    let active = false, online = false, point = null;
    const probePoint = () => active ? point : null;
    const maps = imageryPanel.mount({ doc, get, all, listen, state, schedule, probePoint, readings,
      changed() { placementHint(); resize(); } });
    const drift = driftPanel.mount({ get, all, listen, state, schedule, origin: probePoint, place,
      showMap() { if (state.imagery === "cloud") maps.select("wind"); } });

    function readings(current) {
      if (!active) return;
      const local = field.sample(state, point, current);
      get("probe-location").textContent = ui.stationLabel(local);
      get("probe-wind").textContent = local.wind.toFixed(0);
      get("probe-rain").textContent = local.rain.toFixed(1);
      get("probe-pressure").textContent = local.pressure.toFixed(0);
      get("probe-flow").textContent = local.flowBearing === null ? "—" : ui.degrees(local.flowBearing);
      if (state.imagery === "doppler") {
        get("probe-radial").textContent = doppler.reading(doppler.velocity(point, doppler.site(state), local.wind));
      }
    }

    function placementHint() {
      hint.textContent = !online ? "Use a placement button to sample the storm." : state.comparing ?
        "Tap either view to sample its surface." : state.imagery === "pressure" ?
        "Tap the pressure surface to move the probe." : "Tap the sea to move the probe.";
    }

    function place(next) {
      if (!active) return;
      if (!field.inRange(next)) {
        hint.textContent = "Choose a point within 120 km of the eye.";
        return;
      }
      point = next;
      placementHint();
      readings();
      schedule();
    }

    function nudge(east, north) {
      const x = point.x + east * 5 / field.KM_PER_UNIT, z = point.z - north * 5 / field.KM_PER_UNIT;
      const scale = field.RANGE / Math.max(field.RANGE, Math.hypot(x, z));
      place({ x: x * scale, z: z * scale });
    }

    function setProbe(open, next = point) {
      active = open;
      point = next;
      if (!active) {
        if (tray.contains(doc.activeElement)) toggle.focus({ preventScroll: true });
        if (state.drift) drift.clear();
      }
      toggle.setAttribute("aria-pressed", String(active));
      tray.hidden = !active;
      marker.hidden = !active || !online;
      get("storm-canvas").dataset.probing = String(active);
      if (active && !point) point = field.preset("wall", state);
      maps.syncSite();
      placementHint();
      resize();
    }

    function availability(ready) {
      online = ready;
      if (!online) { eye.style.opacity = "0"; marker.hidden = true; }
      maps.availability(ready);
      placementHint();
    }

    function position(element, view, world, width, height, terrain) {
      const pixel = math.project(view.vp, world, width, height);
      element.style.transform = "translate(" + pixel.x.toFixed(2) + "px," + pixel.y.toFixed(2) + "px)";
      return terrain ? relief.visible(terrain, view, world, pixel, width, height) : pixel.visible;
    }

    function projectMarkers(mode, eyeLabel, probeLabel, view, width, height) {
      const mapped = mode !== "cloud";
      const terrain = mode === "pressure" ? relief.surface(state) : null;
      const showEye = mapped || state.layers.clouds;
      const eyeHeight = terrain ? relief.vertexHeight(terrain, 0, 0) : mapped ? 0 : 0.95;
      const separate = !active || Math.hypot(point.x, point.z) > 0.8;
      eyeLabel.style.opacity = showEye && separate && position(eyeLabel, view, [0, eyeHeight, 0], width, height, terrain) ? "1" : "0";
      const probeHeight = active && terrain ? relief.height(terrain, point.x, point.z) : 0;
      probeLabel.hidden = !active || !position(probeLabel, view, [point.x, probeHeight, point.z], width, height, terrain);
    }

    function project(view, width, height) {
      projectMarkers(state.imagery, eye, marker, view, width, height);
      if (state.comparing) projectMarkers("cloud", cloudEye, cloudProbe, view, width, height);
    }

    function pick(view, x, y, width, height) {
      const pixels = get("storm-canvas").width;
      const cloudSide = state.comparing && (state.cloudPercent === 100 || x / width * pixels < math.splitColumn(pixels, state.cloudPercent));
      place(!cloudSide && state.imagery === "pressure" ? relief.pick(relief.surface(state), view, x, y, width, height) :
        math.seaPoint(view, x, y, width, height));
    }

    for (const button of placements) listen(button, "click", () => place(field.preset(button.dataset.probe, state)));
    const toggleProbe = () => setProbe(!active);
    listen(toggle, "click", toggleProbe);
    return { probing: () => active, toggleProbe, openAt: next => setProbe(true, next),
      observationPoint: () => active ? point : { x: 0, z: 0 },
      imagery: maps.select, syncImagery: maps.sync, toggleCompare: maps.toggleCompare, availability, place, pick, nudge, readings, project };
  }

  if (common) module.exports = { mount };
  else (root.Isobar ||= {}).instruments = { mount };
})(globalThis);
