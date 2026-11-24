(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const dep = name => common ? require("./" + name + ".js") : root.OrbitAtlas[name];
  const { byId } = dep("catalog"), { clamp } = dep("math");
  const { MIN_DAYS, MAX_DAYS, formatDate } = dep("time");
  const { sites, targets, degrees, observerAt, observe, chartPoint, localDate, dayWindow, dayPlan } = dep("sky");
  const { bindDialog, fillSelect } = dep("controls"), { Renderer } = dep("renderer");
  const pad = n => String(n).padStart(2, "0");
  const clockText = date => pad(date.getUTCHours()) + ":" + pad(date.getUTCMinutes());
  const angleText = angle => Number(degrees(angle).toFixed(1)) + "°";
  const bearings = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

  function mountObservatory(doc, win, snapshot, applyTime) {
    const get = id => doc.getElementById(id);
    const dialog = get("observatory-dialog"), station = get("sky-site"), target = get("sky-target");
    const slider = get("sky-minute"), disk = get("sky-map"), canvas = get("eyepiece"), well = get("eyepiece-well");
    const markers = new Map();
    let site = sites[0], day, span, observation, planKey, renderer, graphicsTried = false;
    let eventButtons = [];
    fillSelect(doc, station, sites);
    station.value = site.id;
    fillSelect(doc, target, targets);
    for (const body of targets) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "sky-point";
      button.setAttribute("data-name", body.name);
      button.style.setProperty("--tint", body.tint);
      button.addEventListener("click", () => { target.value = body.id; refresh(); });
      disk.append(button);
      markers.set(body.id, button);
    }

    function paintEyepiece() {
      if (!dialog.open || !observation) return;
      if (!graphicsTried) {
        graphicsTried = true;
        try { renderer = new Renderer(canvas, true); }
        catch (error) { win.console.warn("Eyepiece unavailable.", error.message); }
      }
      canvas.hidden = !renderer;
      get("eyepiece-error").hidden = Boolean(renderer);
      if (renderer) renderer.eyepiece(byId[target.value], day, observation,
        Math.max(1, well.clientWidth), Math.max(1, well.clientHeight), win.devicePixelRatio || 1);
    }
    function updateChart() {
      const observer = observerAt(day, site);
      let count = 0;
      for (const body of targets) {
        const sight = observe(body.id, observer), button = markers.get(body.id);
        const point = chartPoint(sight.altitude, sight.azimuth);
        const active = target.value === body.id;
        if (active) observation = sight;
        button.hidden = !point;
        button.setAttribute("aria-pressed", String(active));
        if (point) {
          count++;
          button.style.left = (50 + point.x*50) + "%";
          button.style.top = (50 + point.y*50) + "%";
          button.classList.toggle("label-left", point.x > 0.35);
          button.title = body.name + " · altitude " + angleText(sight.altitude);
          button.setAttribute("aria-label", button.title);
        }
        if (body.id === "sun") {
          const altitude = degrees(sight.altitude);
          const light = altitude >= 0 ? "Daylight" : altitude >= -18 ? "Twilight" : "Night";
          disk.className = "sky-disk " + light.toLowerCase();
          get("sky-light").textContent = light;
        }
      }
      get("sky-visible").textContent = chartPoint(observation.altitude, observation.azimuth)
        ? count + " of " + targets.length + " above the horizon"
        : byId[target.value].name + " below horizon · " + count + " targets up";
      const azimuth = degrees(observation.azimuth);
      get("sky-alt").textContent = angleText(observation.altitude);
      get("sky-az").textContent = Math.abs(Math.cos(observation.altitude)) < 1e-8 ? "—"
        : (Number(azimuth.toFixed(1)) % 360) + "° " + bearings[Math.round(azimuth/45) % 8];
      const phase = observation.illuminated === null ? "Self-luminous" : (100 * observation.illuminated).toFixed(1) + "%";
      get("sky-phase").textContent = phase;
      get("sky-phase-name").hidden = !observation.phaseName;
      get("sky-phase-name").textContent = observation.phaseName;
      get("sky-elongation").textContent = observation.illuminated === null ? "—" : angleText(observation.elongation);
      const arcseconds = degrees(observation.diameter) * 3600;
      get("sky-size").textContent = arcseconds >= 60 ? (arcseconds / 60).toFixed(1) + "′" : arcseconds.toFixed(1) + "″";
      canvas.setAttribute("aria-label", byId[target.value].name + " from " + site.name + " · " + phase);
      paintEyepiece();
    }

    function buildPlan() {
      const plan = dayPlan(target.value, site, span);
      const edge = plan.curve.map(p => (100*(p.day - span.start)/(span.end - span.start)).toFixed(3)
        + "% " + (50 - degrees(p.altitude)*50/90).toFixed(3) + "%");
      get("altitude-fill").style.clipPath = "polygon(0% 100%, " + edge.join(", ") + ", 100% 100%)";
      const ticks = Array.from({ length: 5 }, (_, i) => {
        const mark = doc.createElement("span");
        mark.textContent = i === 4 && span.end === span.midnight + 1 ? "24:00"
          : clockText(localDate(span.start + (span.end - span.start)*i/4, site));
        return mark;
      });
      get("hour-ticks").replaceChildren(...ticks);
      eventButtons = plan.events.map(event => {
        const button = doc.createElement("button"), label = doc.createElement("strong"), time = doc.createElement("span");
        button.type = "button";
        label.textContent = event.kind;
        time.textContent = clockText(localDate(event.day, site));
        button.append(label, time);
        button.title = "Preview " + byId[target.value].name + " at " + event.kind.toLowerCase()
          + " · " + time.textContent + " · altitude " + angleText(event.altitude);
        button.addEventListener("click", () => { day = event.day; refresh(); });
        return { button, day: event.day };
      });
      get("sky-events").replaceChildren(...eventButtons.map(e => e.button));
      let note = "Rise and set use the center of the disk at a level horizon. Transit is the upper meridian crossing.";
      if (!plan.events.some(e => e.kind !== "Transit")) {
        note = byId[target.value].name + (plan.curve[0].altitude >= 0 ? " stays above" : " stays below")
          + " the horizon throughout this observing window.";
      }
      get("plan-note").textContent = note;
    }
    function refresh() {
      span = dayWindow(day, site);
      const key = [site.id, target.value, span.midnight].join("/");
      if (key !== planKey) { buildPlan(); planKey = key; }
      const local = localDate(day, site);
      const time = clockText(local) + (site.hours ? " UTC+" + site.hours : " UTC");
      get("sky-date").textContent = formatDate(local);
      get("sky-time").textContent = time;
      slider.min = String(span.firstMinute);
      slider.max = String(span.lastMinute);
      slider.value = String(local.getUTCHours()*60 + local.getUTCMinutes());
      slider.setAttribute("aria-valuetext", time);
      get("altitude-cursor").style.left = clamp(100*(day - span.start)/(span.end - span.start), 0, 100) + "%";
      get("sky-prev").disabled = span.start <= MIN_DAYS;
      get("sky-next").disabled = span.end >= MAX_DAYS;
      for (const e of eventButtons) e.button.setAttribute("aria-pressed", String(e.day === day));
      updateChart();
    }
    station.addEventListener("change", () => { site = sites.find(place => place.id === station.value); refresh(); });
    target.addEventListener("change", refresh);
    slider.addEventListener("input", () => {
      day = clamp(span.midnight + Number(slider.value) / 1440, span.start, span.end);
      refresh();
    });
    function step(amount) { day = clamp(day + amount, MIN_DAYS, MAX_DAYS); refresh(); }
    get("sky-prev").addEventListener("click", () => step(-1));
    get("sky-next").addEventListener("click", () => step(1));
    get("sky-apply").addEventListener("click", () => { dialog.close(); applyTime(day); });
    const open = bindDialog(doc, dialog, get("sky-open"), get("sky-close"), target, preferred => {
      const current = snapshot();
      day = current.days;
      target.value = preferred || (current.selected === "earth" ? "moon" : current.selected);
      refresh();
    });
    canvas.addEventListener("webglcontextlost", event => {
      event.preventDefault();
      graphicsTried = true;
      renderer = null;
      paintEyepiece();
    });
    canvas.addEventListener("webglcontextrestored", () => { graphicsTried = false; paintEyepiece(); });
    if (win.ResizeObserver) new win.ResizeObserver(paintEyepiece).observe(well);
    else win.addEventListener("resize", paintEyepiece);
    return { dialog, open };
  }

  const api = { mountObservatory };
  if (common) module.exports = api;
  else (root.OrbitAtlas ||= {}).observatory = api;
})(globalThis);
