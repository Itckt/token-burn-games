(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const section = common ? require("./section.js") : root.Isobar.section;
  const field = common ? require("./field.js") : root.Isobar.field;
  const math = common ? require("./math.js") : root.Isobar.math;
  const ui = common ? require("./ui.js") : root.Isobar.ui;

  function mount({ doc, get, all, listen, state, resize, schedule, openProbe }) {
    const settings = state.section;
    const tray = get("section-tray"), button = get("section-toggle");
    const bearing = get("section-bearing"), distance = get("section-distance");
    const buttons = all("[data-metric]"), values = new Float64Array(section.COUNT);
    let metric = "wind", sampled = "";

    function readings() {
      if (!settings.enabled) return;
      const key = [state.time, state.phase, state.strength, settings.bearing, metric].join("/");
      if (sampled !== key) {
        section.profile(state, section.axis(settings.bearing), metric, values);
        sampled = key;
      }
      const style = field.METRICS[metric], km = settings.distance;
      const index = (km + section.LIMIT_KM) / section.STEP_KM;
      const forward = ui.cardinal(settings.bearing), reverse = ui.cardinal(settings.bearing + 180);
      const location = km ? Math.abs(km) + " km " + (km > 0 ? forward : reverse) : "Eye";
      const reading = location + " · " + style.label + " " + values[index].toFixed(style.digits) + " " + style.unit;
      const angle = ui.degrees(settings.bearing) + " " + forward;
      get("section-reading").textContent = reading;
      distance.setAttribute("aria-valuetext", reading);
      get("section-angle").textContent = angle;
      bearing.setAttribute("aria-valuetext", angle);
      bearing.style.setProperty("--fill", settings.bearing / 355 * 100 + "%");
      get("section-start").textContent = section.LIMIT_KM + " km " + reverse;
      get("section-end").textContent = section.LIMIT_KM + " km " + forward;
      get("profile-unit").textContent = "Surface " + style.label.toLowerCase() + " (" + style.unit + ")";
      get("profile-min").textContent = String(style.min);
      get("profile-max").textContent = String(style.max);
      ui.profileCurve(get("profile-curve"), values, style, index);
    }

    function toggle() {
      settings.enabled = !settings.enabled;
      if (!settings.enabled && tray.contains(doc.activeElement)) button.focus({ preventScroll: true });
      tray.hidden = !settings.enabled;
      button.setAttribute("aria-expanded", String(settings.enabled));
      resize();
    }

    function bindRange(input, name, min, max, step) {
      listen(input, "input", () => {
        const n = Number(input.value);
        if (Number.isFinite(n)) settings[name] = math.clamp(Math.round(n / step) * step, min, max);
        input.value = String(settings[name]);
        readings();
        schedule();
      });
    }
    bindRange(bearing, "bearing", 0, 355, 5);
    bindRange(distance, "distance", -section.LIMIT_KM, section.LIMIT_KM, section.STEP_KM);
    for (const choice of buttons) listen(choice, "click", () => {
      metric = choice.dataset.metric;
      for (const other of buttons) other.setAttribute("aria-pressed", String(other === choice));
      readings();
    });
    listen(get("section-probe"), "click", () => openProbe(section.pointAt(section.axis(settings.bearing), settings.distance)));
    listen(button, "click", toggle);
    return { readings, toggle };
  }
  if (common) module.exports = { mount };
  else (root.Isobar ||= {}).sectionPanel = { mount };
})(globalThis);
