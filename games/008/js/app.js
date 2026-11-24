(function (A) {
  "use strict";
  const { terrain: T, sim: S, art, weather: W, survey: Q } = A;
  const byId = id => document.getElementById(id);
  const canvas = byId("world"), survey = byId("survey"), viewer = byId("viewer");
  const seed = byId("seed"), slider = byId("hour"), guide = byId("guide");
  const presets = [...document.querySelectorAll("[data-preset]")];
  const weatherButtons = [...document.querySelectorAll("[data-weather]")];
  const modes = ["orbit", "fly", "skiff", "tour"];
  const graphicsControls = [seed, slider, ...presets, ...weatherButtons, ...["generate", "dice", "cycle", "water", "trees", "shadows",
    ...modes, "tour-play"].map(byId)];
  const layers = { water: true, trees: true, shadows: true, level: T.WATER };
  const weather = W.create();
  let renderer = null, landscape = null, uploadedSurface = null, camera = null, pending = null, preset = "alpine";
  let hour = S.START_HOUR, cycling = true, displayedMinute = -1, playing = false;
  let frame = null, previousTime = null, elapsed = 0, lastHud = -Infinity;
  let frames = 0, sampleSeconds = 0, quality = 1, fastSamples = 0;
  let blurred = false, syncMotionClock = false;
  let pendingLaunch = false;
  const probe = A.flightPanel.bindProbe(byId);
  const relay = A.flightPanel.bindRelay(byId, flyToPose);
  const basin = A.basinPanel.bind(byId, changeWeathering);
  const panel = A.surveyPanel.bind(byId, {
    pause: pauseTour, courseChanged: relay.configure, annotations: () => ({ hit: probe.hit, flight: relay.flight }),
    travel(mode) { changeMode(mode); viewer.scrollIntoView({ block: "nearest" }); }
  });
  const study = A.observatoryPanel.bind(byId, {
    scene: () => ({ world: landscape.world, grid: landscape.grid, camera, hour, level: layers.water ? layers.level : null,
      route: panel.route, distance: panel.distance }),
    holdMinute, visit: flyToPose, clearInput: pauseForDialog
  });
  const dialogOpen = () => guide.open || study.open;
  const navigation = A.navigation.bindNavigation(canvas, byId("touch-flight"), {
    getCamera: () => camera, enabled: () => renderer && !document.hidden && !dialogOpen() && !panel.plotting,
    switchMode: changeMode, resetView, togglePlayback
  });

  function updateSkiffButton() {
    const skiff = byId("skiff");
    skiff.disabled = !renderer || !landscape || !layers.water;
    skiff.title = layers.water ? "Launch the survey skiff" : "Show water to launch the skiff";
  }
  function updateMode() {
    const mode = camera?.mode || "orbit", touring = mode === "tour";
    const touch = window.matchMedia("(any-pointer: coarse)").matches;
    viewer.dataset.mode = mode;
    for (const id of modes) byId(id).setAttribute("aria-pressed", String(mode === id));
    updateSkiffButton();
    const pad = byId("touch-flight");
    pad.hidden = (mode !== "fly" && mode !== "skiff") || !renderer;
    for (const button of pad.querySelectorAll("[data-key]")) {
      if (button.dataset.key === "KeyA") button.setAttribute("aria-label", mode === "skiff" ? "Steer left" : "Move left");
      if (button.dataset.key === "KeyD") button.setAttribute("aria-label", mode === "skiff" ? "Steer right" : "Move right");
    }
    byId("tour-play").hidden = !touring;
    byId("tour-progress").hidden = !touring;
    if (!touring && renderer) byId("live-label").textContent = "Live view";
    const finished = panel.route && panel.distance >= panel.route.length;
    const action = playing ? "Pause" : finished ? "Replay" : "Resume";
    byId("tour-play").textContent = action;
    const hints = {
      orbit: touch ? "Drag to orbit · Pinch to zoom" : "Drag to orbit · Scroll to zoom",
      fly: touch ? "Drag to look · Arrows to fly" : "Drag to look · WASD to fly",
      skiff: touch ? "Arrows to steer and power" : "W/S power · A/D steer",
      tour: touch ? "Tap Fly to take over" : "Space to " + action.toLowerCase() + " · F to take over"
    };
    byId("camera-hint").textContent = hints[mode];
  }
  function changeMode(mode) {
    if (!camera || !renderer) return;
    pendingLaunch = false;
    if (mode === "skiff") {
      if (!layers.water) return;
      if (pending || basin.level !== layers.level) { pendingLaunch = true; return; }
      if (!S.boardSkiff(camera, landscape.grid, layers.level, panel.passage?.points)) {
        const message = "Skiff needs " + A.waterways.DRAFT + " m of water. Raise the lake level.";
        byId("live-label").textContent = byId("announcement").textContent = message;
        return;
      }
    }
    relay.stop();
    panel.cancelPlot();
    navigation.clear();
    S.setMode(camera, mode);
    playing = mode === "tour";
    if (playing) {
      if (panel.distance >= panel.route.length) panel.seek(0);
      followRoute(0);
    }
    lastHud = -Infinity;
    updateMode();
    canvas.focus({ preventScroll: true });
  }
  function pauseTour() {
    relay.stop();
    navigation.clear();
    playing = false;
    lastHud = -Infinity;
    updateMode();
  }
  function flyToPose(pose) {
    changeMode("fly");
    camera.position = pose.position.slice();
    camera.yaw = camera.targetYaw = pose.yaw;
    camera.pitch = camera.targetPitch = pose.pitch;
    syncMotionClock = true;
    viewer.scrollIntoView({ block: "nearest" });
  }
  function togglePlayback() {
    if (camera?.mode !== "tour") return;
    if (playing) pauseTour();
    else changeMode("tour");
  }
  function followRoute(dt) {
    if (playing && !dialogOpen()) panel.seek(panel.distance + Q.FLIGHT_SPEED * dt);
    const pose = Q.flightPose(panel.route, panel.distance);
    camera.position = pose.position;
    camera.yaw = camera.targetYaw = pose.yaw;
    camera.pitch = camera.targetPitch = pose.pitch;
    if (playing && panel.distance >= panel.route.length) {
      playing = false;
      updateMode();
    }
  }
  function resetView() {
    if (!landscape) return;
    relay.stop();
    navigation.clear();
    playing = false;
    panel.cancelPlot();
    panel.seek(0);
    camera = S.homeCamera(landscape.world.style);
    pendingLaunch = false;
    lastHud = -Infinity;
    updateMode();
  }
  for (const id of modes) byId(id).addEventListener("click", () => changeMode(id));
  byId("tour-play").addEventListener("click", togglePlayback);
  for (const button of weatherButtons) {
    button.addEventListener("click", () => {
      W.select(weather, button.dataset.weather);
      for (const option of weatherButtons) option.setAttribute("aria-pressed", String(button === option));
    });
  }

  function updateClock() {
    const minute = S.minuteOfDay(hour);
    if (minute === displayedMinute) return;
    displayedMinute = minute;
    const formatted = S.formatHour(hour);
    slider.value = String(minute);
    slider.style.setProperty("--progress", (minute / 1439 * 100) + "%");
    slider.setAttribute("aria-valuetext", formatted);
    byId("clock").textContent = formatted;
    byId("light-icon").setAttribute("href", minute >= 360 && minute < 1080 ? "#i-sun" : "#i-moon");
  }
  function setCycle(enabled) {
    cycling = enabled;
    byId("cycle").setAttribute("aria-checked", String(enabled));
  }
  function holdMinute(minute) {
    hour = minute / 60;
    setCycle(false);
    updateClock();
  }
  slider.addEventListener("input", () => holdMinute(Number(slider.value)));
  byId("cycle").addEventListener("click", () => setCycle(!cycling));
  for (const name of ["water", "trees", "shadows"]) {
    byId(name).addEventListener("click", () => {
      if (byId(name).disabled) return;
      layers[name] = !layers[name];
      byId(name).setAttribute("aria-checked", String(layers[name]));
      if (name === "water") {
        panel.setWaterVisible(layers.water);
        if (!layers.water && camera?.mode === "skiff") changeMode("fly");
        updateSkiffButton();
      }
    });
  }

  function resize() {
    if (!renderer) return;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    const dpr = window.devicePixelRatio || 1;
    const ratio = quality * Math.min(dpr, 1.5, Math.sqrt(1440000 / (w * h)));
    renderer.resize(w * ratio, h * ratio);
    panel.resize(dpr);
    lastHud = -Infinity;
  }
  window.addEventListener("resize", resize);
  if (window.ResizeObserver) {
    const observer = new ResizeObserver(resize);
    observer.observe(byId("scene"));
    observer.observe(byId("map-view"));
  }
  function updateHud(time) {
    if (time - lastHud < 90) return;
    lastHud = time;
    const [x, y, z] = camera.position, bearing = S.heading(camera.yaw);
    const coord = value => (Math.round(value) < 0 ? "−" : "+") + String(Math.abs(Math.round(value))).padStart(3, "0");
    byId("map-x").textContent = coord(x);
    byId("map-z").textContent = coord(z);
    byId("map-alt").textContent = Math.round(y) + " m";
    byId("compass-needle").setAttribute("transform", "rotate(" + bearing.degrees + " 26 26)");
    byId("compass").setAttribute("aria-label", "Camera heading " + bearing.degrees + "° " + bearing.cardinal);
    if (camera.mode === "tour") {
      const covered = Math.round(panel.distance) + " / " + Math.round(panel.route.length) + " m";
      byId("live-label").textContent = (playing && !dialogOpen() ? "Tour · " : "Tour paused · ") + covered;
      const progress = byId("tour-progress");
      progress.value = panel.distance / panel.route.length;
      progress.setAttribute("aria-valuetext", covered);
    } else if (camera.mode === "skiff") {
      const depth = (layers.level - landscape.grid.surfaceAt(x, z)).toFixed(1);
      const speed = Math.round(3.6 * camera.skiffSpeed) + " km/h";
      byId("live-label").textContent = "Skiff · " + (camera.skiffLimit || speed) + " · " + depth + " m deep";
    }
    probe.read(camera, landscape.grid, layers.water ? layers.level : null);
    relay.refresh(camera);
    panel.refresh(camera, bearing.degrees);
  }
  function updateFrameRate(dt) {
    if (dt <= 0) return;
    sampleSeconds += dt;
    frames++;
    if (sampleSeconds < 1.25) return;
    const fps = frames / sampleSeconds;
    byId("fps").textContent = Math.round(fps) + " fps";
    fastSamples = fps >= 58 ? fastSamples + 1 : 0;
    const oldQuality = quality;
    if (fps < 49) quality = Math.max(0.56, quality - 0.12);
    else if (fastSamples >= 6) {
      quality = Math.min(1, quality + 0.06);
      fastSamples = 0;
    }
    if (quality !== oldQuality) resize();
    frames = sampleSeconds = 0;
  }
  function requestFrame() {
    if (frame === null && renderer && !document.hidden) frame = window.requestAnimationFrame(tick);
  }
  function stopFrames() {
    if (frame !== null) window.cancelAnimationFrame(frame);
    frame = previousTime = null;
    frames = sampleSeconds = fastSamples = 0;
    navigation.clear();
  }
  function queueWorld(request) {
    pending = request;
    study.setEnabled(false);
    byId("loading").hidden = false;
    byId("scene").setAttribute("aria-busy", "true");
    requestFrame();
  }
  function generate(id) {
    if (!renderer) return;
    preset = id;
    seed.value = T.cleanSeed(seed.value);
    queueWorld({ id, seed: seed.value, weathering: basin.weathering, reset: true });
  }
  function changeWeathering() {
    if (pending) pending.weathering = basin.weathering;
    else if (landscape) {
      const { world } = landscape;
      queueWorld({ id: world.id, seed: world.seed, weathering: basin.weathering, reset: false });
    }
  }
  function matchesWorld(request) {
    return landscape && landscape.world.id === request.id && landscape.world.seed === request.seed;
  }
  function matchesSurface(request) {
    return matchesWorld(request) && landscape.weathering === request.weathering;
  }
  function uploadSurface(surface) {
    if (uploadedSurface === surface) return;
    renderer.loadWorld(surface.world, surface.grid, surface.items);
    uploadedSurface = surface;
  }
  function surveySurface(surface, keepCourse) {
    layers.level = basin.level;
    const flood = art.floodMap(surface.contours, surface.grid, layers.level, surface.floodSheet);
    surface.floodSheet = flood.sheet;
    basin.showFlood(flood);
    panel.setSurface(surface.world, surface.grid, flood.sheet, layers.level, keepCourse);
    updateMode();
    lastHud = -Infinity;
  }
  function applyWorld() {
    const next = pending;
    if (!matchesSurface(next)) {
      const sameWorld = matchesWorld(next);
      const world = sameWorld ? landscape.world : T.createWorld(next.seed, next.id);
      const original = sameWorld ? landscape.original : T.buildGrid(world);
      const grid = A.erosion.weatherGrid(original, next.weathering);
      const items = T.scatter(world, grid);
      const contours = survey.getContext("2d") ? art.atlas(world, grid) : null;
      const surface = { world, original, grid, items, contours, weathering: next.weathering };
      uploadSurface(surface);
      landscape = surface;
      surveySurface(landscape, sameWorld);
    }
    if (next.reset) resetView();
    const style = landscape.world.style;
    byId("place-name").textContent = style.name;
    byId("region-name").textContent = style.region;
    for (const button of presets) button.setAttribute("aria-pressed", String(button.dataset.preset === next.id));
    byId("loading").hidden = true;
    byId("scene").setAttribute("aria-busy", "false");
    if (next.reset) byId("announcement").textContent = style.name + " ready. Seed " + next.seed + ".";
    pending = null;
    study.setEnabled(true);
    previousTime = null;
    frames = sampleSeconds = 0;
  }
  function tick(time) {
    frame = null;
    if (!renderer || document.hidden) return;
    try {
      const startRelay = relay.takeRequest();
      const board = pendingLaunch;
      if (pending) applyWorld();
      uploadSurface(landscape);
      if (layers.level !== basin.level) surveySurface(landscape, true);
      if (board) changeMode("skiff");
      if (startRelay) relay.begin();
      const dt = previousTime === null ? 0 : Math.max(0, (time - previousTime) / 1000);
      previousTime = time;
      elapsed += dt;
      hour = S.advanceClock(hour, dt, cycling);
      W.advance(weather, dt);
      if (camera.mode === "tour") followRoute(syncMotionClock ? 0 : dt);
      else {
        const run = relay.flight;
        const from = run && camera.position.slice(), passed = run?.splits.length;
        const flightDt = dialogOpen() || (run && (blurred || syncMotionClock)) ? 0 : dt;
        const afloat = camera.mode === "skiff";
        S.stepCamera(camera, navigation.keys, flightDt, landscape.grid, layers.water, layers.level);
        if (afloat && camera.mode === "fly") {
          navigation.clear();
          updateMode();
          byId("announcement").textContent = "The skiff ran out of depth. Fly controls are active.";
        }
        if (run) {
          relay.advance(from, camera.position, flightDt);
          if (run.finished || run.splits.length !== passed) lastHud = -Infinity;
        }
      }
      syncMotionClock = dialogOpen();
      layers.probe = probe.active;
      layers.chart = panel.chart;
      layers.nextGate = relay.flight?.splits.length ?? 0;
      renderer.setRunoff(landscape.grid, panel.runoffPoints);
      renderer.setGates(relay.flight?.course.gates ?? null);
      renderer.setPassage(panel.passage);
      renderer.render(camera, hour, elapsed, layers, weather.weights);
      if (!renderer.shadowsAvailable && !byId("shadows").disabled) {
        const toggle = byId("shadows");
        toggle.disabled = true;
        toggle.title = "Ridge shadows are unavailable on this graphics device";
        toggle.setAttribute("aria-checked", "false");
        byId("shadows-unavailable").hidden = false;
      }
      updateClock();
      study.refresh();
      updateHud(time);
      updateFrameRate(dt);
      requestFrame();
    } catch (error) {
      showError("3D view unavailable", error.message);
    }
  }
  byId("seed-form").addEventListener("submit", event => { event.preventDefault(); generate(preset); });
  function limitInput(event) {
    if (event.isComposing) return;
    const limited = T.limitSeed(seed.value);
    if (seed.value !== limited) seed.value = limited;
  }
  seed.addEventListener("input", limitInput);
  seed.addEventListener("compositionend", limitInput);
  byId("dice").addEventListener("click", () => {
    const prefix = T.PRESETS[preset].seedPrefix + "-";
    const roll = Math.floor(Math.random() * 1000000);
    const label = number => prefix + String(number).padStart(6, "0");
    seed.value = label(roll) === seed.value ? label((roll + 1) % 1000000) : label(roll);
    generate(preset);
  });
  for (const button of presets) {
    button.addEventListener("click", () => generate(button.dataset.preset));
    const thumb = button.querySelector("canvas");
    if (thumb.getContext("2d")) art.poster(thumb, button.dataset.preset);
  }

  function pauseForDialog() {
    navigation.clear();
    syncMotionClock = true;
  }
  function showGuide() {
    pauseForDialog();
    guide.showModal();
    byId("guide-close").focus();
  }
  window.addEventListener("blur", () => { blurred = true; });
  window.addEventListener("focus", () => { blurred = false; syncMotionClock = true; });
  byId("probe").addEventListener("click", () => { lastHud = -Infinity; });
  byId("guide-open").addEventListener("click", showGuide);
  byId("guide-close").addEventListener("click", () => guide.close());
  guide.addEventListener("click", event => {
    if (event.target !== guide) return;
    const r = guide.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) guide.close();
  });
  const fullscreen = byId("fullscreen");
  function syncFullscreen() {
    const expanded = document.fullscreenElement === viewer || viewer.classList.contains("expanded");
    fullscreen.title = expanded ? "Exit fullscreen" : "Enter fullscreen";
    fullscreen.setAttribute("aria-label", fullscreen.title);
    fullscreen.setAttribute("aria-pressed", String(expanded));
    document.body.classList.toggle("expanded-view", viewer.classList.contains("expanded"));
    resize();
  }
  fullscreen.addEventListener("click", async () => {
    if (viewer.classList.contains("expanded")) viewer.classList.remove("expanded");
    else if (document.fullscreenElement) await document.exitFullscreen();
    else {
      try { await viewer.requestFullscreen(); }
      catch { viewer.classList.add("expanded"); }
    }
    syncFullscreen();
    canvas.focus({ preventScroll: true });
  });
  document.addEventListener("fullscreenchange", syncFullscreen);
  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
    if (event.key === "Escape" && dialogOpen()) {
      event.preventDefault();
      if (study.open) study.close(); else guide.close();
      return;
    }
    if (A.navigation.editing(event.target) || study.open) return;
    if (event.key === "?" && !event.repeat) {
      event.preventDefault();
      if (guide.open) guide.close();
      else showGuide();
    } else if (event.key === "Escape") {
      if (panel.plotting) {
        panel.cancelPlot(true);
      } else if (viewer.classList.contains("expanded")) {
        viewer.classList.remove("expanded");
        syncFullscreen();
      }
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopFrames();
    else requestFrame();
  });

  function showError(title, detail) {
    stopFrames();
    renderer?.dispose();
    renderer = null;
    uploadedSurface = null;
    for (const control of graphicsControls) control.disabled = true;
    panel.setEnabled(false);
    study.setEnabled(false);
    probe.setEnabled(false);
    basin.setEnabled(false);
    byId("scene-error").hidden = false;
    byId("error-title").textContent = title;
    byId("error-detail").textContent = detail;
    byId("scene").setAttribute("aria-busy", "false");
    byId("loading").hidden = true;
    byId("touch-flight").hidden = true;
    byId("tour-progress").hidden = true;
    byId("live-label").textContent = "View paused";
    byId("fps").textContent = "Paused";
  }
  function startGraphics() {
    if (renderer) return;
    try {
      renderer = A.createRenderer(canvas);
      resize();
      if (!landscape && !pending) generate(preset);
      for (const control of graphicsControls) control.disabled = false;
      byId("shadows").setAttribute("aria-checked", String(layers.shadows));
      byId("shadows").title = "Show shadows cast by the survey terrain";
      byId("shadows-unavailable").hidden = true;
      study.setEnabled(!!landscape && !pending);
      panel.setEnabled(true);
      probe.setEnabled(true);
      basin.setEnabled(true);
      byId("scene-error").hidden = true;
      byId("live-label").textContent = "Live view";
      byId("fps").textContent = "— fps";
      updateMode();
      requestFrame();
    } catch (error) {
      showError("3D view unavailable", error.message);
    }
  }
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    showError("Graphics paused", "The browser lost its WebGL context. Your flight will resume when graphics return.");
  });
  canvas.addEventListener("webglcontextrestored", startGraphics);
  updateClock();
  startGraphics();
})(globalThis.FieldAtlas);
