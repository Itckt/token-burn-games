(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const dep = name => common ? require("./" + name + ".js") : root.OrbitAtlas[name];
  const { planets, bodies, moon, byId } = dep("catalog");
  const earthViewBodies = [...bodies, moon];
  const { moonInScene } = dep("lunar");
  const { orbits, systemAt, YEAR_DAYS } = dep("physics");
  const { Clock, SPEEDS, parseUTCMinute, MIN_DAYS, MAX_DAYS, formatDate } = dep("time");
  const { OrbitCamera, screenBodies, covered, pickBody, labelLayout } = dep("camera");
  const { Renderer } = dep("renderer");
  const { bindGestures, bindDialog } = dep("controls");
  const { mountInstruments } = dep("instruments");
  const { mountObservatory } = dep("observatory");
  const { mountPlanner } = dep("planner");
  const { clamp } = dep("math");
  const integer = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
  const periodText = days => days < 1000 ? days.toFixed(2) + " d" : (days / YEAR_DAYS).toFixed(2) + " yr";

  function mount(doc, win) {
    const get = id => doc.getElementById(id);
    const stage = get("stage"), canvas = get("space"), portrait = get("portrait"), plate = get("specimen");
    const clock = new Clock(), dialog = get("controls-dialog"), timeDialog = get("time-dialog");
    let states = systemAt(clock.days), selected = "earth", showOrbits = true, showLabels = true;
    let width = Math.max(1, stage.clientWidth), height = Math.max(1, stage.clientHeight);
    const camera = new OrbitCamera(width / height);
    let scene = null, preview = null, expanded = false;
    let lastTime = null, lastReadout = -Infinity, frameId = null, points = [], density = 1;
    const cards = new Map(), thumbnails = new Map(), tags = new Map();
    const say = message => { get("announcer").textContent = message; };
    const setText = (id, text) => { if (get(id).textContent !== text) get(id).textContent = text; };
    const pressed = (button, value) => button.setAttribute("aria-pressed", String(value));
    const instruments = mountInstruments(doc, seek, () => { syncPair(); cameraStatus(); readouts(); });
    const observatory = mountObservatory(doc, win, () => ({ days: clock.days, selected }), seek);
    const planner = mountPlanner(doc, win, () => ({ day: clock.days, direction: clock.direction,
      from: selected, to: instruments.destination }), (from, to, day) => seek(day, from, to));

    function syncPair() {
      if (camera.pair) camera.framePair(selected, instruments.destination, states);
    }

    function buildIndex() {
      for (const body of planets) {
        const card = doc.createElement("button");
        card.type = "button";
        card.className = "planet-card";
        card.setAttribute("aria-label", "Inspect " + body.name);
        card.setAttribute("data-body", body.id);
        card.title = body.name + " · select (" + body.order + "), double-click to follow";
        const thumb = doc.createElement("span");
        thumb.className = "planet-thumb placeholder";
        thumb.style.setProperty("--tint", body.tint);
        thumb.setAttribute("aria-hidden", "true");
        const type = doc.createElement("span"), name = doc.createElement("span"), axis = doc.createElement("span");
        type.className = "planet-type";
        name.className = "planet-name";
        axis.className = "planet-axis";
        name.textContent = body.name;
        axis.textContent = orbits[body.id].a.toFixed(2) + " AU";
        type.append(name, axis);
        card.append(thumb, type);
        card.addEventListener("click", () => select(body.id));
        card.addEventListener("dblclick", () => follow(body.id));
        get("planet-list").append(card);
        cards.set(body.id, card);
        thumbnails.set(body.id, thumb);
      }
      for (const body of earthViewBodies) {
        const tag = doc.createElement("button");
        tag.type = "button";
        tag.className = "map-label";
        tag.setAttribute("data-body", body.id);
        tag.setAttribute("aria-label", body === moon ? "Inspect the Moon in the observatory" : "Inspect " + body.name);
        if (body === moon) tag.title = "Open the Moon’s eyepiece";
        tag.tabIndex = body.id === "sun" || body === moon ? 0 : -1;
        tag.textContent = body.name;
        tag.hidden = true;
        tag.addEventListener("click", () => select(body.id));
        tag.addEventListener("dblclick", () => follow(body.id));
        get("map-labels").append(tag);
        tags.set(body.id, tag);
      }
    }

    function paintPortrait() {
      plate.style.setProperty("--tint", byId[selected].tint);
      plate.classList.toggle("fallback", !preview);
      if (preview) preview.portrait(byId[selected], Math.max(1, plate.clientWidth),
        Math.max(1, plate.clientHeight), win.devicePixelRatio || 1);
    }
    function preparePortraits() {
      try {
        preview = new Renderer(portrait, true);
        for (const body of planets) {
          preview.portrait(body, 108, 80);
          const thumb = thumbnails.get(body.id);
          thumb.style.backgroundImage = 'url("' + portrait.toDataURL("image/png") + '")';
          thumb.classList.remove("placeholder");
        }
      } catch (error) {
        preview = null;
        win.console.warn("Planet portraits unavailable.", error.message);
      }
      paintPortrait();
    }

    function readouts() {
      const date = clock.date;
      setText("sim-date", formatDate(date));
      const iso = date.toISOString(), day = iso.slice(0, 10);
      setText("sim-hour", iso.slice(11, 16));
      if (get("sim-date").getAttribute("datetime") !== day) get("sim-date").setAttribute("datetime", day);
      setText("distance", selected === "sun" ? "At origin" : states[selected].distance.toFixed(3) + " AU");
      instruments.update(states, clock.days, clock.direction);
    }
    function cameraStatus() {
      const target = byId[camera.following];
      const framed = byId[camera.framedOrbit];
      const pairName = camera.pair && byId[selected].name + " + " + byId[instruments.destination].name;
      setText("view-name", target ? "Following " + target.name : framed ? framed.name + " orbit" : pairName || "System overview");
      setText("pair-text", camera.pair ? "Exit pair view" : "Frame pair");
      get("frame-pair").disabled = !scene;
      pressed(get("frame-pair"), Boolean(camera.pair));
      const endpoint = camera.pair || instruments.trailsOn ? instruments.destination : instruments.linkTarget;
      for (const [id, tag] of tags) tag.classList.toggle("link-end", id === endpoint);
      if (camera.following !== "earth" && tags.has("moon")) {
        tags.get("moon").hidden = true;
        points = points.filter(point => point.id !== "moon");
      }
      setText("follow-text", target ? "Return to overview" : "Follow " + byId[selected].name);
      pressed(get("follow"), Boolean(target));
      setText("frame-text", framed ? "Exit orbit view" : "Frame orbit");
      get("frame-orbit").title = framed ? "Return to overview (V)" : "Frame the selected orbit (V)";
      get("frame-orbit").disabled = !scene || selected === "sun";
      pressed(get("frame-orbit"), Boolean(framed));
    }
    function updateProfile(destination) {
      const body = byId[selected], isSun = selected === "sun";
      setText("profile-name", body.name);
      setText("family", body.family);
      setText("description", body.description);
      setText("distance-label", isSun ? "System position" : "Sun distance");
      setText("period-label", isSun ? "Rotation period" : "Orbital period");
      setText("period", periodText(isSun ? body.spinDays : orbits[selected].period));
      setText("diameter", integer.format(body.diameter) + " km");
      get("family-dot").style.background = body.tint;
      portrait.setAttribute("aria-label", "Illustrated globe of " + body.name);
      for (const [id, card] of cards) pressed(card, id === selected);
      for (const [id, tag] of tags) tag.classList.toggle("selected", id === selected);
      instruments.select(selected, destination);
      syncPair();
      readouts();
      cameraStatus();
      paintPortrait();
    }
    function select(id, destination) {
      if (id === "moon") { observatory.open(id); return false; }
      if (!Object.hasOwn(byId, id)) return false;
      selected = id;
      if (camera.following) camera.follow(id, states);
      else if (camera.framedOrbit) {
        if (orbits[id]) camera.frameOrbit(id);
        else camera.overview();
      }
      updateProfile(destination);
      say((camera.following ? "Following " : "Selected ") + byId[id].name + ".");
      return true;
    }
    function follow(id) {
      if (!scene || !select(id)) return;
      camera.follow(id, states);
      cameraStatus();
      say("Following " + byId[id].name + ".");
    }
    function overview(reset = false) {
      camera.overview(reset);
      cameraStatus();
      say("System overview.");
    }
    function toggleFollow() {
      if (camera.following) overview();
      else follow(selected);
    }
    function toggleOrbitView() {
      if (!scene || !orbits[selected]) return;
      if (camera.framedOrbit) overview();
      else {
        camera.frameOrbit(selected);
        cameraStatus();
        say("Framing " + byId[selected].name + "’s orbit.");
      }
      focusMap();
    }
    function focusMap() {
      canvas.focus({ preventScroll: true });
      stage.scrollIntoView?.({ block: "nearest" });
    }
    function togglePairView() {
      if (!scene) return;
      if (camera.pair) overview();
      else {
        camera.framePair(selected, instruments.destination, states);
        cameraStatus();
        say("Tracking " + byId[selected].name + " and " + byId[instruments.destination].name + ".");
      }
      focusMap();
    }
    function cycle(step) {
      const index = planets.findIndex(body => body.id === selected);
      const start = index < 0 && step < 0 ? 0 : index;
      select(planets[(start + step + planets.length) % planets.length].id);
    }
    function playbackStatus() {
      const stopped = clock.paused || !scene;
      const moving = clock.direction === 1 ? "Running" : "Rewinding";
      setText("status-text", scene ? (clock.paused ? "Paused" : moving) : "View offline");
      get("run-status").classList.toggle("paused", stopped);
      const label = clock.paused ? "Resume simulation" : "Pause simulation";
      get("play").setAttribute("aria-label", label);
      get("play").title = label + " (Space)";
      get("play-icon").className = clock.paused ? "ico ico-play" : "ico ico-pause";
      get("speed").value = String(clock.speedIndex);
      get("speed").style.setProperty("--progress", (clock.speedIndex / (SPEEDS.length - 1) * 100) + "%");
      const sign = clock.direction === 1 ? "" : "−";
      get("speed").setAttribute("aria-valuetext", clock.speed + (clock.speed === 1 ? " day" : " days")
        + " per second" + (clock.direction === -1 ? " backward" : ""));
      setText("speed-value", sign + clock.speed + " d/s");
      pressed(get("reverse"), clock.direction === -1);
    }
    function togglePlay() {
      if (!scene) return;
      clock.paused = !clock.paused;
      lastTime = null;
      playbackStatus();
      readouts();
    }
    function speed(index) { clock.setSpeed(index); playbackStatus(); }
    function reverse() {
      clock.reverse();
      lastTime = null;
      playbackStatus();
      readouts();
    }
    function clearHits() {
      points = [];
      for (const tag of tags.values()) tag.hidden = true;
      get("selection-marker").hidden = true;
    }
    function seek(days, from, to) {
      if (!clock.seek(days)) return;
      lastTime = null;
      states = systemAt(clock.days);
      clearHits();
      playbackStatus();
      if (from) select(from, to);
      else readouts();
      if (timeDialog.open) timeDialog.close();
      say("Paused at " + formatDate(clock.date) + ", " + clock.date.toISOString().slice(11, 16) + " UTC.");
    }
    function stepDay(step) { seek(clamp(clock.days + step, MIN_DAYS, MAX_DAYS)); }
    function toggleLayer(layer) {
      if (layer === "orbits") showOrbits = !showOrbits;
      else showLabels = !showLabels;
      pressed(get("toggle-orbits"), showOrbits);
      pressed(get("toggle-labels"), showLabels);
      get("map-labels").hidden = !showLabels;
    }
    function measure() {
      width = Math.max(1, stage.clientWidth);
      height = Math.max(1, stage.clientHeight);
      density = win.devicePixelRatio || 1;
      clearHits();
      if (scene) scene.resize(width, height, density);
    }
    function expand() {
      if (!scene) return;
      expanded = !expanded;
      get("stage-panel").classList.toggle("expanded", expanded);
      doc.body.classList.toggle("map-expanded", expanded);
      pressed(get("expand"), expanded);
      const label = expanded ? "Exit expanded map" : "Expand map";
      get("expand").setAttribute("aria-label", label);
      get("expand").title = label;
      measure();
    }
    function labels(view, visibleBodies) {
      points = screenBodies(visibleBodies, states, view, width, height);
      if (showLabels) {
        const visible = new Set();
        for (const box of labelLayout(points, selected, width, height, instruments.showSweeps, instruments.trailsOn)) {
          const tag = tags.get(box.id);
          tag.style.transform = "translate(" + box.x.toFixed(1) + "px," + box.y.toFixed(1) + "px)";
          tag.style.width = box.w + "px";
          tag.hidden = false;
          visible.add(box.id);
        }
        for (const [id, tag] of tags) if (!visible.has(id)) tag.hidden = true;
      }
      const p = points.find(point => point.id === selected);
      const marker = get("selection-marker");
      marker.hidden = !p || covered(p, points) || p.radius > Math.min(width, height) * 0.22;
      if (!marker.hidden) {
        const r = p.radius + 4;
        marker.style.width = marker.style.height = (2 * r).toFixed(1) + "px";
        marker.style.transform = "translate(" + (p.x - r).toFixed(1) + "px," + (p.y - r).toFixed(1) + "px)";
      }
    }
    function queueFrame() {
      if (scene && !doc.hidden && frameId === null) frameId = win.requestAnimationFrame(frame);
    }
    function frame(now) {
      frameId = null;
      if (!scene || doc.hidden) return;
      const dt = lastTime === null ? 0 : Math.max(0, (now - lastTime) / 1000);
      lastTime = now;
      if (density !== (win.devicePixelRatio || 1)) { measure(); paintPortrait(); }
      if (!clock.paused && dt > 0) {
        clock.advance(dt);
        states = systemAt(clock.days);
        if (clock.paused || now - lastReadout >= 125) {
          readouts();
          lastReadout = now;
        }
        if (clock.paused) {
          playbackStatus();
          say("Calendar limit reached. Reverse time or choose another date.");
        }
      }
      const view = camera.step(dt, states, width / height);
      const showMoon = camera.following === "earth";
      if (showMoon && !states.moon) states.moon = moonInScene(clock.days, states.earth);
      scene.scene(states, clock.days, view, { selected, orbits: showOrbits,
        sweeps: instruments.showSweeps, linkTarget: instruments.linkTarget, moon: showMoon && states.moon,
        trailDays: instruments.trailDays(clock.days), destination: instruments.destination });
      labels(view, showMoon ? earthViewBodies : bodies);
      queueFrame();
    }
    function stopFrames() {
      if (frameId !== null) win.cancelAnimationFrame(frameId);
      frameId = null;
      lastTime = null;
    }
    function graphicsState(available) {
      get("graphics-error").hidden = available;
      instruments.setAvailable(available);
      cameraStatus();
      get("map-labels").hidden = !available || !showLabels;
      if (!available) clearHits();
      for (const id of ["play", "reverse", "speed", "follow", "zoom-in", "zoom-out", "home", "expand", "toggle-labels", "toggle-orbits"]) {
        get(id).disabled = !available;
      }
      playbackStatus();
    }
    function prepareScene() {
      try {
        scene = new Renderer(canvas);
        measure();
        graphicsState(true);
        queueFrame();
      } catch (error) {
        scene = null;
        stopFrames();
        get("error-title").textContent = "3D view unavailable";
        get("error-detail").textContent = "This atlas needs WebGL. Enable graphics acceleration in your browser, then reload the page.";
        graphicsState(false);
        win.console.warn("Orbital view unavailable.", error.message);
      }
    }

    const openHelp = bindDialog(doc, dialog, get("help-open"), get("help-close"), get("help-close"));
    const dateInput = get("time-input");
    const openTime = bindDialog(doc, timeDialog, get("time-open"), get("time-close"), dateInput, () => {
      dateInput.value = clock.date.toISOString().slice(0, 16);
      dateInput.setAttribute("aria-invalid", "false");
      get("time-error").hidden = true;
    });
    get("time-form").addEventListener("submit", event => {
      event.preventDefault();
      const days = parseUTCMinute(dateInput.value);
      if (days !== null) { seek(days); return; }
      dateInput.setAttribute("aria-invalid", "true");
      get("time-error").hidden = false;
      dateInput.focus();
    });
    get("step-back").addEventListener("click", () => stepDay(-1));
    get("step-ahead").addEventListener("click", () => stepDay(1));
    get("play").addEventListener("click", togglePlay);
    get("reverse").addEventListener("click", reverse);
    get("speed").addEventListener("input", event => speed(Number(event.target.value)));
    get("toggle-orbits").addEventListener("click", () => toggleLayer("orbits"));
    get("toggle-labels").addEventListener("click", () => toggleLayer("labels"));
    get("follow").addEventListener("click", toggleFollow);
    get("frame-orbit").addEventListener("click", toggleOrbitView);
    get("frame-pair").addEventListener("click", togglePairView);
    get("previous").addEventListener("click", () => cycle(-1));
    get("next").addEventListener("click", () => cycle(1));
    get("home").addEventListener("click", () => overview(true));
    get("zoom-in").addEventListener("click", () => camera.zoomBy(1 / 1.25));
    get("zoom-out").addEventListener("click", () => camera.zoomBy(1.25));
    get("expand").addEventListener("click", expand);
    get("retry").addEventListener("click", () => win.location.reload());

    const cancelGestures = bindGestures(canvas, camera, {
      available: () => Boolean(scene), pick: (x, y) => pickBody(points, x, y), select, follow
    });
    doc.addEventListener("keydown", event => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const modal = [dialog, timeDialog, observatory.dialog, planner.dialog].find(node => node.open);
      if (modal) {
        if (key === "escape" || (modal === dialog && key === "?")) {
          event.preventDefault();
          if (!event.repeat) modal.close();
        }
        return;
      }
      if (event.target.matches?.("input, textarea, select, [contenteditable=true]") && key !== "escape") return;
      if (key === "?") { event.preventDefault(); if (!event.repeat) openHelp(); return; }
      if (key === " " && event.target.closest?.("button")) return;
      if (key === "t" || key === "h" || key === "e") {
        event.preventDefault();
        if (!event.repeat) {
          if (key === "t") openTime();
          else if (key === "h") observatory.open();
          else planner.open();
        }
        return;
      }
      if (key === "," || key === ".") { event.preventDefault(); stepDay(key === "," ? -1 : 1); return; }
      if (/^[1-8]$/.test(key)) { select(planets[Number(key) - 1].id); event.preventDefault(); return; }
      if (!scene) return;
      if (event.repeat && [" ", "f", "o", "l", "r", "v", "p", "s", "m", "escape"].includes(key)) { event.preventDefault(); return; }
      switch (key) {
        case " ": togglePlay(); break;
        case "r": reverse(); break;
        case "[": speed(clock.speedIndex - 1); break;
        case "]": speed(clock.speedIndex + 1); break;
        case "f": toggleFollow(); break;
        case "v": toggleOrbitView(); break;
        case "p": togglePairView(); break;
        case "0": overview(true); break;
        case "o": toggleLayer("orbits"); break;
        case "l": toggleLayer("labels"); break;
        case "s": get("toggle-sweeps").click(); break;
        case "m": get("toggle-link").click(); break;
        case "+": case "=": camera.zoomBy(0.82); break;
        case "-": case "_": camera.zoomBy(1.22); break;
        case "arrowleft": camera.orbit(-13, 0); break;
        case "arrowright": camera.orbit(13, 0); break;
        case "arrowup": camera.orbit(0, 10); break;
        case "arrowdown": camera.orbit(0, -10); break;
        case "escape": if (expanded) expand(); else if (camera.focused) overview(); else return; break;
        default: return;
      }
      event.preventDefault();
    });

    canvas.addEventListener("webglcontextlost", event => {
      event.preventDefault();
      if (expanded) expand();
      cancelGestures();
      scene = null;
      stopFrames();
      get("error-title").textContent = "Graphics connection interrupted";
      get("error-detail").textContent = "The view will resume when WebGL returns. You can also reload the atlas.";
      graphicsState(false);
      readouts();
    });
    canvas.addEventListener("webglcontextrestored", prepareScene);
    portrait.addEventListener("webglcontextlost", event => { event.preventDefault(); preview = null; paintPortrait(); });
    portrait.addEventListener("webglcontextrestored", preparePortraits);
    doc.addEventListener("visibilitychange", () => {
      stopFrames();
      if (doc.hidden) cancelGestures();
      else queueFrame();
    });
    win.addEventListener("resize", () => { measure(); paintPortrait(); });
    if (win.ResizeObserver) {
      const observer = new win.ResizeObserver(entries => {
        if (entries.some(entry => entry.target === stage)) measure();
        if (entries.some(entry => entry.target === plate)) paintPortrait();
      });
      observer.observe(stage);
      observer.observe(plate);
    }
    buildIndex();
    prepareScene();
    preparePortraits();
    updateProfile();
  }

  const api = { mount, periodText };
  if (common) module.exports = api;
  else { root.OrbitAtlas.app = api; mount(root.document, root); }
})(globalThis);
