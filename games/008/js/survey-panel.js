(function (A) {
  "use strict";
  const { math: M, terrain: T, survey: Q, hydrology: H, waterways: W, art } = A;
  const metres = value => Math.round(value) + " m";

  function drawProfile(byId, route, kind) {
    const level = route.waterLevel;
    const top = Math.ceil((Math.max(level, route.high) + 2) / 5) * 5;
    const bottom = Math.floor((Math.min(level, route.low) - 2) / 5) * 5;
    const y = h => (88 * (top - h) / (top - bottom)).toFixed(2);
    const datum = y(level);
    const ridge = [], water = ["M0 " + datum];
    let last = route.samples[0];
    for (const s of route.samples) {
      const x = (640 * s.distance / route.length).toFixed(2);
      ridge.push((ridge.length ? "L" : "M") + x + " " + y(s.height));
      if ((s.height - level) * (last.height - level) < 0) {
        const crossing = M.lerp(last.distance, s.distance, (level - last.height) / (s.height - last.height));
        water.push("L" + (640 * crossing / route.length).toFixed(2) + " " + datum);
      }
      water.push("L" + x + " " + y(Math.min(level, s.height)));
      last = s;
    }
    const line = ridge.join(" ");
    byId("profile-ridge").setAttribute("d", line);
    byId("profile-ground").setAttribute("d", line + " L640 88 L0 88 Z");
    byId("profile-water").setAttribute("d", water.join(" ") + " L640 " + datum + " Z");
    byId("profile-datum").setAttribute("y1", datum);
    byId("profile-datum").setAttribute("y2", datum);
    byId("axis-high").textContent = metres(top);
    byId("axis-low").textContent = metres(bottom);
    byId("route-length").textContent = metres(route.length);
    const measures = {
      runoff: ["Drop", metres(route.samples[0].height - route.samples.at(-1).height)],
      passage: ["Least depth", (level - route.high).toFixed(1) + " m"]
    };
    const [label, value] = measures[kind] || ["Ascent", metres(route.ascent)];
    byId("relief-label").textContent = label;
    byId("route-ascent").textContent = value;
    byId("route-wet").textContent = metres(route.submerged);
    return y;
  }

  function bind(byId, { pause, travel, courseChanged, annotations }) {
    const map = byId("survey"), hint = byId("plot-hint"), scope = byId("map-scope");
    const chartButton = byId("depth-chart"), legend = byId("depth-key");
    const mapTools = {
      transect: { button: byId("plot-route"), label: "Plot route", cancel: "Cancel plot" },
      runoff: { button: byId("trace-runoff"), label: "Trace runoff", cancel: "Cancel trace" },
      passage: { button: byId("chart-passage"), label: "Chart passage", cancel: "Cancel passage" }
    };
    const restore = byId("restore-route"), station = byId("station"), launch = byId("fly-route"), sail = byId("cast-off");
    let world, grid, sheet, course, route, profileY, level = T.WATER, distance = 0, enabled = false;
    let draft = null, camera = null, mapPose = "", displayedDistance = -1, overview = false;
    let chart = false, chartSheet = null, waterVisible = true;

    for (const swatch of legend.querySelectorAll("[data-band]")) {
      const i = Number(swatch.dataset.band), band = W.BANDS[i], next = W.BANDS[i + 1];
      swatch.style.setProperty("--swatch", band.color);
      swatch.textContent = next ? band.depth + "–" + next.depth : band.depth + "+";
    }
    function setChart(value) {
      chart = value;
      chartButton.setAttribute("aria-checked", String(chart));
      legend.hidden = !chart || !sheet;
      mapPose = "";
    }
    chartButton.addEventListener("click", () => {
      if (chartButton.disabled) return;
      setChart(!chart);
      refreshCurrentView();
    });

    function syncControls() {
      const active = Boolean(enabled && route);
      for (const [kind, tool] of Object.entries(mapTools)) {
        const selected = draft?.kind === kind;
        tool.button.disabled = !active || !sheet;
        tool.button.textContent = selected ? tool.cancel : tool.label;
        tool.button.setAttribute("aria-pressed", String(selected));
      }
      chartButton.disabled = !active;
      legend.hidden = !chart || !sheet;
      scope.disabled = !active || !sheet;
      scope.hidden = !!draft || !sheet;
      scope.textContent = overview ? "Follow camera" : "Full map";
      map.dataset.view = overview || draft ? "overview" : "follow";
      station.disabled = launch.disabled = restore.disabled = !active || !!draft;
      sail.hidden = course?.kind !== "passage";
      sail.disabled = launch.disabled || sail.hidden || !waterVisible;
      restore.hidden = !course || course.kind === "inlet";
      restore.textContent = world?.id === "caldera" ? "Restore crater route" : "Restore inlet route";
      hint.hidden = !draft;
      map.tabIndex = draft ? 0 : -1;
      map.dataset.plotting = String(!!draft);
      map.setAttribute("aria-label", draft ? mapTools[draft.kind].label + ". Arrow keys move the crosshair. Enter marks a point."
        : "Live topographic map with the flight path and camera heading");
      courseChanged?.(grid, route, active, !!draft);
    }
    const inlet = () => ({ kind: "inlet", points: Q.inletPath(world) });
    const defaultName = () => world.id === "caldera" ? "Crater crossing" : "Inlet traverse";
    const runoff = source => ({ kind: "runoff", source, ...H.traceRunoff(grid, source, level, A.sim.FLIGHT_BOUND) });
    function passage(a, b) {
      const points = W.findPassage(grid, a, b, level, A.sim.FLIGHT_BOUND);
      return points && { kind: "passage", points, waterLevel: level };
    }
    const destinations = { lake: "lake edge", hollow: "closed hollow", edge: "survey edge" };
    function install(next, at = 0) {
      course = next;
      route = Q.buildRoute(grid, next.points, level);
      distance = M.clamp(at, 0, route.length);
      displayedDistance = -1;
      mapPose = "";
      byId("route-name").textContent = next.kind === "runoff" ? "Runoff to " + destinations[next.outlet]
        : next.kind === "transect" ? "Plotted transect" : next.kind === "passage" ? "Skiff passage" : defaultName();
      profileY = drawProfile(byId, route, next.kind);
      syncControls();
    }
    function setSurface(nextWorld, nextGrid, nextSheet, nextLevel, keepCourse) {
      world = nextWorld;
      grid = nextGrid;
      sheet = nextSheet;
      chartSheet = null;
      level = nextLevel;
      if (!keepCourse || !course) {
        draft = null;
        overview = false;
        install(inlet());
      } else {
        const next = course.kind === "runoff" ? runoff(course.source)
          : course.kind === "passage" ? passage(course.points[0], course.points.at(-1)) : course;
        if (next && next.points.length > 1) install(next, distance);
        else {
          const reason = course.kind === "passage" ? "The passage is too shallow at this lake level."
            : "The runoff source has no dry outlet path here.";
          install(inlet());
          pause();
          byId("announcement").textContent = reason + " " + defaultName() + " restored.";
        }
        if (draft?.kind === "passage" && draft.first && !W.afloat(grid, draft.first, level)) {
          draft.first = null;
          prompt();
        }
      }
    }
    function cancelPlot(restoreFocus = false) {
      if (!draft) return;
      const button = mapTools[draft.kind].button;
      draft = null;
      mapPose = "";
      syncControls();
      refreshCurrentView();
      if (restoreFocus) button.focus({ preventScroll: true });
    }
    function seek(value) {
      distance = M.clamp(value, 0, route.length);
    }
    function refresh(view, bearing) {
      camera = view;
      const { hit, flight } = annotations?.() || {};
      const pose = [Math.round(view.position[0] * 8), Math.round(view.position[2] * 8), bearing,
        map.width, map.height, Math.round(distance * 10), flight?.splits.length,
        hit && Math.round(hit.x * 8), hit && Math.round(hit.z * 8)].join("/");
      if (distance === displayedDistance && pose === mapPose) return;
      const s = Q.stationAt(route, distance);
      if (displayedDistance !== distance) {
        const fraction = distance / route.length;
        const coordinate = (640 * fraction).toFixed(2);
        byId("profile-cursor").setAttribute("x1", coordinate);
        byId("profile-cursor").setAttribute("x2", coordinate);
        byId("profile-point").setAttribute("cx", coordinate);
        byId("profile-point").setAttribute("cy", profileY(s.height));
        station.value = String(Math.round(fraction * 1000));
        const sounding = course.kind === "passage" ? (level - s.height).toFixed(1) + " m deep" : metres(s.height) + " elevation";
        const reading = metres(distance) + " along · " + sounding;
        byId("station-readout").textContent = reading;
        station.setAttribute("aria-valuetext", reading);
        displayedDistance = distance;
      }
      if (sheet && pose !== mapPose) {
        if (chart && !chartSheet) chartSheet = art.depthChart(sheet, grid, level);
        art.drawMap(map, chart ? chartSheet : sheet, view, { route, station: s, draft, overview, hit, flight,
          runoff: course.kind === "runoff" });
      }
      mapPose = pose;
    }
    function refreshCurrentView() {
      if (camera) refresh(camera, A.sim.heading(camera.yaw).degrees);
    }
    function limitPoint(point) {
      return point.map(v => M.clamp(v, -A.sim.FLIGHT_BOUND, A.sim.FLIGHT_BOUND));
    }
    function prompt() {
      const point = draft.kind === "runoff" ? "a runoff source on high ground" : draft.first ? "B" : "A";
      const [x, z] = draft.cursor.map(Math.round);
      const where = draft.kind === "passage" ? " in water at least " + W.DRAFT + " m deep" : " on the map";
      hint.textContent = "Mark " + point + where + " or use arrows and Enter. X " + x + " · Z " + z;
    }
    function mark(point) {
      draft.cursor = limitPoint(point);
      mapPose = "";
      let next;
      if (draft.kind === "runoff") {
        next = runoff(draft.cursor);
        if (next.points.length < 2) {
          hint.textContent = next.outlet === "lake" ? "Source is at or below lake level. Choose higher ground."
            : "No downhill path from this vertex. Choose another source.";
          return;
        }
      } else if (draft.kind === "passage" && !W.afloat(grid, draft.cursor, level)) {
        hint.textContent = "Too shallow. Choose water at least " + W.DRAFT + " m deep.";
        return;
      } else if (!draft.first) {
        draft.first = draft.cursor;
        prompt();
        return;
      } else if (Math.hypot(draft.cursor[0] - draft.first[0], draft.cursor[1] - draft.first[1]) < Q.MIN_LEG - 1e-8) {
        hint.textContent = "Place B at least " + Q.MIN_LEG + " m from A.";
        return;
      } else if (draft.kind === "passage") {
        next = passage(draft.first, draft.cursor);
        if (!next) {
          hint.textContent = "No navigable connection to A. Choose B in the same body of water.";
          return;
        }
      } else next = { kind: "transect", points: [draft.first, draft.cursor] };
      draft = null;
      overview = true;
      install(next);
      pause();
      byId("announcement").textContent = (next.kind === "runoff" ? "Runoff traced to " + destinations[next.outlet]
        : next.kind === "passage" ? "Skiff passage charted" : "Transect plotted")
        + ". Length " + metres(route.length) + ".";
      mapTools[next.kind].button.focus({ preventScroll: true });
      refreshCurrentView();
    }
    function begin(kind) {
      if (mapTools[kind].button.disabled) return;
      if (draft?.kind === kind) { cancelPlot(); return; }
      pause();
      if (kind === "passage") setChart(true);
      draft = { kind, first: null, cursor: limitPoint(camera ? [camera.position[0], camera.position[2]] : [0, 0]) };
      mapPose = "";
      syncControls();
      prompt();
      map.focus({ preventScroll: true });
      refreshCurrentView();
    }
    for (const [kind, tool] of Object.entries(mapTools)) tool.button.addEventListener("click", () => begin(kind));
    scope.addEventListener("click", () => {
      if (scope.disabled || draft) return;
      overview = !overview;
      mapPose = "";
      syncControls();
      refreshCurrentView();
    });
    function pick(event) {
      const r = map.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const frame = art.mapFrame(map.width, map.height, null, true);
      return art.groundPoint(frame, (event.clientX - r.left) * map.width / r.width,
        (event.clientY - r.top) * map.height / r.height);
    }
    map.addEventListener("pointermove", event => {
      if (!enabled || !draft) return;
      const point = pick(event);
      if (point) { draft.cursor = limitPoint(point); mapPose = ""; prompt(); }
    });
    map.addEventListener("click", event => {
      if (!enabled || !draft) return;
      const point = pick(event);
      if (point) mark(point);
    });
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    map.addEventListener("keydown", event => {
      if (!enabled || !draft || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
      if (Object.hasOwn(arrows, event.key)) {
        const delta = arrows[event.key], step = event.shiftKey ? 1 : 8;
        draft.cursor = limitPoint(draft.cursor.map((v, i) => v + step * delta[i]));
        mapPose = "";
        prompt();
      } else if (event.key === "Enter" || event.key === " ") {
        if (!event.repeat) mark(draft.cursor);
      } else if (event.key === "Escape") {
        cancelPlot(true);
      } else return;
      event.preventDefault();
    });
    station.addEventListener("input", () => {
      if (station.disabled) return;
      if (!overview) {
        overview = true;
        mapPose = "";
        syncControls();
      }
      seek(route.length * Number(station.value) / 1000);
      pause();
      refreshCurrentView();
    });
    restore.addEventListener("click", () => {
      if (restore.disabled) return;
      install(inlet());
      pause();
      mapTools.transect.button.focus({ preventScroll: true });
      byId("announcement").textContent = defaultName() + " restored.";
    });
    launch.addEventListener("click", () => {
      if (!launch.disabled) travel("tour");
    });
    sail.addEventListener("click", () => {
      if (!sail.disabled) travel("skiff");
    });
    function resize(dpr) {
      const rect = map.getBoundingClientRect(), ratio = Math.min(2, dpr);
      const w = Math.max(1, Math.round(rect.width * ratio)), h = Math.max(1, Math.round(rect.height * ratio));
      if (w === map.width && h === map.height) return;
      map.width = w;
      map.height = h;
      mapPose = "";
    }
    return { setSurface, cancelPlot, seek, refresh, resize,
      setEnabled(value) { enabled = value; syncControls(); },
      setWaterVisible(value) { waterVisible = value; syncControls(); },
      get chart() { return chart; },
      get passage() { return course?.kind === "passage" ? course : null; },
      get runoffPoints() { return course?.kind === "runoff" ? course.points : null; },
      get route() { return route; }, get distance() { return distance; }, get plotting() { return !!draft; } };
  }
  A.surveyPanel = { bind };
})(globalThis.FieldAtlas);
