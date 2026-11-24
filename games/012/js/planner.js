(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const dep = name => common ? require("./" + name + ".js") : root.OrbitAtlas[name];
  const { bodies, byId } = dep("catalog"), { clamp } = dep("math");
  const { MIN_DAYS, MAX_DAYS, dateAt, formatDate, formatUTC } = dep("time");
  const { validPair, encounterWindow, encounterPlan, rangeAt } = dep("encounters");
  const { FieldLog } = dep("fieldlog"), { bindDialog, fillSelect } = dep("controls");
  const { rateText } = dep("instruments");
  const au = value => value.toFixed(3) + " AU";

  function mountPlanner(doc, win, snapshot, visit) {
    const get = id => doc.getElementById(id);
    const dialog = get("encounter-dialog"), first = get("encounter-from"), second = get("encounter-to");
    const slider = get("encounter-cursor"), name = get("note-name");
    fillSelect(doc, first, bodies);
    const destinations = fillSelect(doc, second, bodies);
    let from, to, day, plan, direction, eventButtons = [], log;

    function height(distance) { return 100 * (plan.high - distance) / (plan.high - plan.low); }
    function fraction(instant) { return (instant - plan.start) / (plan.end - plan.start); }

    function preview(instant) {
      day = clamp(instant, plan.start, plan.end);
      const { au: distance, rateKmS } = rangeAt(from, to, day);
      const time = formatUTC(day), x = fraction(day) * 100 + "%";
      get("encounter-guide").style.left = x;
      get("encounter-dot").style.left = x;
      get("encounter-dot").style.top = height(distance) + "%";
      get("encounter-time").textContent = time;
      get("encounter-time").setAttribute("datetime", dateAt(day).toISOString());
      get("encounter-range").textContent = au(distance);
      get("encounter-rate").textContent = rateText(rateKmS);
      slider.value = String(Math.round(1000 * fraction(day)));
      slider.setAttribute("aria-valuetext", time + " · " + au(distance));
      for (const event of eventButtons) event.button.setAttribute("aria-pressed", String(event.day === day));
    }

    function drawChart() {
      const edge = plan.curve.map(point => [100 * fraction(point.day), height(point.au)]);
      const points = offset => edge.map(([x, y]) => x.toFixed(3) + "% " + (y + offset).toFixed(3) + "%");
      get("encounter-fill").style.clipPath = "polygon(0% 100%, " + points(0).join(",") + ", 100% 100%)";
      get("encounter-line").style.clipPath = "polygon(" + points(-0.8).concat(points(0.8).reverse()).join(",") + ")";
      get("encounter-high").textContent = au(plan.high);
      get("encounter-low").textContent = au(plan.low);
      const axisLabel = day => plan.end - plan.start < 1 ? dateAt(day).toISOString().slice(11, 19) + " UTC" : formatDate(dateAt(day));
      get("window-start").textContent = axisLabel(plan.start);
      get("window-end").textContent = axisLabel(plan.end);
      get("encounter-prev").disabled = plan.start <= MIN_DAYS;
      get("encounter-next").disabled = plan.end >= MAX_DAYS;
      eventButtons = plan.events.map(event => {
        const button = doc.createElement("button"), title = doc.createElement("strong"), time = doc.createElement("span");
        button.type = "button";
        title.textContent = event.kind + " · " + au(event.au);
        time.textContent = formatUTC(event.day);
        button.append(title, time);
        button.addEventListener("click", () => preview(event.day));
        return { day: event.day, button };
      });
      get("encounter-events").replaceChildren(...eventButtons.map(item => item.button));
      get("encounter-empty").hidden = eventButtons.length > 0;
    }

    function explore(origin, destination, instant, sign) {
      from = origin;
      to = destination;
      first.value = from;
      second.value = to;
      for (const [id, option] of destinations) option.disabled = id === from;
      direction = sign;
      plan = encounterPlan(from, to, encounterWindow(from, to, instant, direction));
      drawChart();
      preview(instant);
    }
    first.addEventListener("change", () => explore(first.value, first.value === to ? from : to, day, direction));
    second.addEventListener("change", () => {
      if (validPair(from, second.value)) explore(from, second.value, day, direction);
      else second.value = to;
    });
    slider.addEventListener("input", () => preview(plan.start + (plan.end - plan.start) * Number(slider.value) / 1000));
    get("encounter-prev").addEventListener("click", () => explore(from, to, plan.start, -1));
    get("encounter-next").addEventListener("click", () => explore(from, to, plan.end, 1));
    get("encounter-apply").addEventListener("click", () => { dialog.close(); visit(from, to, day); });

    function logStatus(message = "") {
      const storage = log.storage ? "Field notes are stored in this browser." : "Field notes are in memory for this session.";
      get("note-status").textContent = (message ? message + " " : "") + storage;
    }
    function showNotes(message) {
      log.refresh();
      const rows = log.entries.map(note => {
        const li = doc.createElement("li"), recall = doc.createElement("button"), remove = doc.createElement("button");
        const title = doc.createElement("strong"), detail = doc.createElement("span");
        recall.type = remove.type = "button";
        title.textContent = note.name;
        detail.textContent = byId[note.from].name + " / " + byId[note.to].name + " · " + formatUTC(note.day);
        recall.className = "note-recall";
        recall.append(title, detail);
        recall.addEventListener("click", () => {
          explore(note.from, note.to, note.day, direction);
          name.value = note.name;
          logStatus("Previewing " + note.name + ".");
        });
        remove.className = "note-remove";
        remove.textContent = "Remove";
        remove.setAttribute("aria-label", "Remove " + note.name);
        remove.addEventListener("click", () => { log.remove(note); showNotes("Note removed."); name.focus(); });
        li.append(recall, remove);
        return li;
      });
      get("note-list").replaceChildren(...rows);
      get("note-count").textContent = String(rows.length);
      logStatus(message);
    }
    get("note-form").addEventListener("submit", event => {
      event.preventDefault();
      const title = name.value.trim() || byId[from].name + " / " + byId[to].name;
      log.save(from, to, day, title);
      name.value = "";
      showNotes("Saved " + title + ".");
    });
    win.addEventListener("storage", () => { if (dialog.open && log) showNotes(); });
    const open = bindDialog(doc, dialog, get("encounter-open"), get("encounter-close"), first, () => {
      const current = snapshot();
      explore(current.from, current.to, current.day, current.direction);
      if (!log) {
        let storage;
        try { storage = win.localStorage; } catch { /* Local files can have restricted storage. */ }
        log = new FieldLog(storage);
      }
      name.value = "";
      showNotes();
    });
    return { dialog, open };
  }

  const api = { mountPlanner };
  if (common) module.exports = api;
  else (root.OrbitAtlas ||= {}).planner = api;
})(globalThis);
