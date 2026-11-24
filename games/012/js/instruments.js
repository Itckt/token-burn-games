(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const dep = name => common ? require("./" + name + ".js") : root.OrbitAtlas[name];
  const { bodies, byId } = dep("catalog");
  const { orbits } = dep("physics");
  const { inCalendar, formatUTC } = dep("time");
  const { trailDuration } = dep("encounters"), { TRAIL_MARKS } = dep("geometry");
  const { fillSelect } = dep("controls");
  const { APSIDES, AU_DAY_TO_KM_S, SWEEP_FRACTION, apsisDay, signalRange } = dep("observations");
  function lightTimeText(seconds) {
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600), minutes = Math.floor(total / 60) % 60;
    const pad = n => String(n).padStart(2, "0");
    if (hours) return hours + "h " + pad(minutes) + "m " + pad(total % 60) + "s";
    if (minutes) return minutes + "m " + pad(total % 60) + "s";
    return total + " s";
  }

  function rateText(rateKmS) {
    const rate = Number(rateKmS.toFixed(2));
    return (rate > 0 ? "+" : "") + rate.toFixed(2).replace("-", "−") + " km/s";
  }

  const timeUnits = [[86400, "d"], [3600, "h"], [60, "min"], [1, "s"], [0.001, "ms"]];
  function trailSpacingText(duration) {
    if (duration === 0) return "Calendar start";
    const seconds = duration * 86400 / TRAIL_MARKS;
    const [size, unit] = timeUnits.find(([size]) => seconds >= size) || timeUnits.at(-1);
    return Number((seconds / size).toPrecision(3)) + " " + unit + " per dot";
  }

  function mountInstruments(doc, seek, changed) {
    const get = id => doc.getElementById(id);
    const write = (id, text) => { const node = get(id); if (node.textContent !== text) node.textContent = text; };
    const receiver = get("range-target"), sweepButton = get("toggle-sweeps"), linkButton = get("toggle-link");
    const trails = get("trail-span");
    trails.value = "off";
    let selected = "earth", sweeps = true, link = false, available = false;
    const options = fillSelect(doc, receiver, bodies);
    receiver.value = "mars";

    // Keep the exact simulated instant behind each displayed forecast. Clicking
    // a rounded minute must still land precisely on the extremum.
    const events = Object.keys(APSIDES).map(kind => {
      const button = get("visit-" + kind);
      const event = { kind, button, days: null };
      button.addEventListener("click", () => seek(event.days));
      return event;
    });

    function overlayStatus() {
      const hasOrbit = selected !== "sun";
      sweepButton.disabled = !available || !hasOrbit;
      sweepButton.setAttribute("aria-pressed", String(sweeps && hasOrbit));
      linkButton.disabled = !available;
      linkButton.setAttribute("aria-pressed", String(link));
      get("sweep-key").hidden = !available || !hasOrbit || !sweeps;
      trails.disabled = !available;
      get("trail-key").hidden = !available || trails.value === "off";
    }
    sweepButton.addEventListener("click", () => { sweeps = !sweeps; overlayStatus(); changed(); });
    linkButton.addEventListener("click", () => { link = !link; overlayStatus(); changed(); });
    receiver.addEventListener("change", changed);
    trails.addEventListener("change", () => { overlayStatus(); changed(); });

    function select(id, destination) {
      // Inspecting the destination exchanges the two ends of the same link.
      options.get(selected).disabled = false;
      if (destination && options.has(destination) && destination !== id) receiver.value = destination;
      else if (id === receiver.value) receiver.value = selected;
      options.get(id).disabled = true;
      selected = id;
      const body = byId[id], orbit = orbits[id];
      write("range-from", body.name);
      get("study-data").hidden = !orbit;
      get("study-empty").hidden = Boolean(orbit);
      if (orbit) {
        write("study-body", body.name);
        write("perihelion-distance", (orbit.a * (1 - orbit.e)).toFixed(3) + " AU");
        write("aphelion-distance", (orbit.a * (1 + orbit.e)).toFixed(3) + " AU");
        write("sweep-duration", "Each sector sweeps the same area in " + (orbit.period * SWEEP_FRACTION).toFixed(2)
          + " days. Choose an event to pause there.");
      }
      overlayStatus();
    }
    function update(states, days, direction) {
      const state = states[selected], orbit = orbits[selected];
      if (orbit) {
        write("study-speed", (Math.hypot(...state.velocity) * AU_DAY_TO_KM_S).toFixed(2) + " km/s orbital speed");
        for (const event of events) {
          const target = apsisDay(orbit, days, event.kind, direction);
          write(event.kind + "-label", (direction === 1 ? "Next " : "Previous ") + event.kind);
          if (event.days === target) continue;
          event.days = target;
          event.button.disabled = !inCalendar(target);
          const when = event.button.disabled ? "Outside calendar" : formatUTC(target);
          write(event.kind + "-date", when);
          event.button.title = event.button.disabled ? when : "Pause at " + byId[selected].name + "’s " + event.kind + " · " + when;
        }
      }
      const range = signalRange(state, states[receiver.value]);
      write("range-distance", range.au.toFixed(3) + " AU");
      write("range-delay", lightTimeText(range.lightSeconds));
      write("range-rate", rateText(range.rateKmS));
      if (trails.value !== "off") {
        write("trail-spacing", trailSpacingText(trailDuration(trails.value, selected, receiver.value, days)));
        write("trail-from", byId[selected].name);
        write("trail-to", byId[receiver.value].name);
        get("trail-from").hidden = selected === "sun";
        get("trail-to").hidden = receiver.value === "sun";
      }
    }

    return {
      select, update,
      setAvailable(value) { available = value; overlayStatus(); },
      trailDays(day) { return trails.value === "off" ? 0 : trailDuration(trails.value, selected, receiver.value, day); },
      get trailsOn() { return trails.value !== "off"; },
      get destination() { return receiver.value; },
      get showSweeps() { return sweeps && selected !== "sun"; },
      get linkTarget() { return link ? receiver.value : null; }
    };
  }

  const api = { mountInstruments, lightTimeText, rateText };
  if (common) module.exports = api;
  else (root.OrbitAtlas ||= {}).instruments = api;
})(globalThis);
