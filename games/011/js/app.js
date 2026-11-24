(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const math = common ? require("./math.js") : root.Isobar.math;
  const storm = common ? require("./storm.js") : root.Isobar.storm;
  const cycle = common ? require("./lifecycle.js") : root.Isobar.lifecycle;
  const renderer = common ? require("./renderer.js") : root.Isobar.renderer;
  const ui = common ? require("./ui.js") : root.Isobar.ui;
  const gestures = common ? require("./gestures.js") : root.Isobar.gestures;
  const instruments = common ? require("./instruments.js") : root.Isobar.instruments;
  const stationPanel = common ? require("./station-panel.js") : root.Isobar.stationPanel;
  const sectionPanel = common ? require("./section-panel.js") : root.Isobar.sectionPanel;
  const notebook = common ? require("./notebook.js") : root.Isobar.notebook;
  const notebookPanel = common ? require("./notebook-panel.js") : root.Isobar.notebookPanel;

  function mount(doc, win) {
    const get = id => doc.getElementById(id);
    const all = selector => Array.from(doc.querySelectorAll(selector));
    const canvas = get("storm-canvas"), stage = get("stage"), viewport = get("viewport");
    const viewportSlider = get("viewport-signal"), signalSliders = [get("signal"), viewportSlider];
    const dialog = get("help-dialog"), pause = get("pause"), expand = get("expand");
    const viewButtons = all("[data-view]"), speedButtons = all("[data-speed]"), icons = all("[data-icon]");
    const stageButtons = all("[data-stage]"), cycleSlider = get("cycle-time");
    const state = storm.makeState(), camera = math.makeCamera();
    if (win.matchMedia("(prefers-reduced-motion: reduce)").matches) state.playing = false;
    let history = ui.makeHistory(state.strength), cycleStage = null;
    const listeners = [];
    let graphics = null, raf = null, lastTimestamp = null, lastMetrics = -Infinity;
    let width = 1, height = 1, pixelRatio = 1, lastYaw = NaN, lastPitch = NaN;
    let suspended = false, destroyed = false, previousFocus = null, resizeObserver = null;
    let fullscreenPending = false;

    function listen(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      listeners.push(() => target.removeEventListener(type, handler, options));
    }

    const tools = instruments.mount({ doc, get, all, listen, state, schedule, resize });
    const station = stationPanel.mount({ get, listen, state, probe: tools });
    const section = sectionPanel.mount({ doc, get, all, listen, state, schedule, resize, openProbe: tools.openAt });
    notebookPanel.mount({ win, get, all, listen,
      capture: () => notebook.capture(state, tools.observationPoint(), Boolean(cycleStage)),
      inspect(pose, point) { loadPose(pose); tools.openAt(point); }
    });
    get("cycle-chapters").style.gridTemplateColumns = cycle.STAGES.map(s => (s.end - s.start) + "fr").join(" ");

    function schedule() {
      if (!destroyed && graphics && !doc.hidden && !suspended && raf === null) raf = win.requestAnimationFrame(frame);
    }

    function stopFrames() {
      if (raf !== null) win.cancelAnimationFrame(raf);
      raf = null;
      lastTimestamp = null;
    }

    function updateMetrics() {
      ui.record(history, state.strength, state.time, cycleStage ? cycle.readingsAt : undefined);
      const current = storm.readings(state.strength, state.time);
      for (const key of ["wind", "rain", "pressure"]) {
        get(key + "-value").textContent = current[key].toFixed(key === "rain" ? 1 : 0);
        const series = history.samples.map(sample => sample[key]);
        series[series.length - 1] = current[key];
        ui.sparkline(get(key + "-chart"), series, key === "wind" ? 4.0 : 1.35);
      }
      tools.readings(current);
      section.readings();
      if (cycleStage) syncCyclePosition();
    }

    function syncCyclePosition() {
      const time = cycleStage ? state.time : 0;
      const name = cycleStage ? cycleStage.name : "Manual control";
      cycleSlider.value = time.toFixed(1);
      cycleSlider.setAttribute("aria-valuetext", time.toFixed(1) + " seconds, " + (cycleStage || cycle.STAGES[0]).name);
      get("cycle-stage").textContent = name;
      get("cycle-position").textContent = ui.clock(time) + " / " + ui.clock(cycle.DURATION);
      get("cycle-plot").dataset.active = String(Boolean(cycleStage));
      get("cycle-plot").style.setProperty("--cursor", (time / cycle.DURATION * 100) + "%");
      for (const button of stageButtons) {
        button.setAttribute("aria-current", cycle.STAGES[Number(button.dataset.stage)] === cycleStage ? "step" : "false");
      }
    }

    function applyPose(pose) {
      const signalChanged = state.signal !== pose.signal;
      cycleStage = pose.stage || null;
      state.time = pose.time;
      state.signal = pose.signal;
      state.strength = pose.strength;
      state.phase = pose.phase;
      state.rainTravel = pose.rainTravel;
      if (signalChanged) syncSignal();
    }

    function loadPose(pose, play = false) {
      if (!pose) return;
      station.finish("Finished before time change");
      applyPose(pose);
      state.playing = play && Boolean(graphics);
      history = ui.makeHistory(state.strength, state.time, cycleStage ? cycle.readingsAt : undefined);
      lastTimestamp = null;
      if (!cycleStage) syncCyclePosition();
      syncPlayback(); updateMetrics(); syncClock(); schedule();
    }

    function seekCycle(seconds, play = false) { loadPose(cycle.at(seconds), play); }

    function leaveCycle() {
      cycleStage = null;
      if (doc.activeElement === get("cycle-exit")) get("cycle-play").focus({ preventScroll: true });
      syncCyclePosition();
      syncPlayback();
    }

    function syncClock() {
      const time = "T+ " + ui.clock(state.time);
      if (get("model-time").textContent !== time) get("model-time").textContent = time;
    }

    function stepStorm(dt) {
      if (!state.playing) return false;
      const until = state.time + dt * state.speed;
      if (!cycleStage) {
        station.advance(until, false);
        storm.advance(state, dt);
        return false;
      }
      const pose = cycle.at(until);
      station.advance(pose.time, true);
      applyPose(pose);
      if (pose.time < cycle.DURATION) return false;
      state.playing = false;
      station.finish("Life cycle finished");
      syncPlayback();
      return true;
    }

    function frame(timestamp) {
      raf = null;
      if (!graphics || doc.hidden || suspended || destroyed) return;
      const dt = lastTimestamp === null ? 0 : math.clamp((timestamp - lastTimestamp) / 1000, 0, 0.08);
      lastTimestamp = timestamp;
      const ended = stepStorm(dt);
      math.easeCamera(camera, dt);
      if ((win.devicePixelRatio || 1) !== pixelRatio) resize();
      const view = math.cameraFrame(camera, width / height);
      graphics.render(state, view);
      tools.project(view, width, height);
      if (lastYaw !== camera.yaw || lastPitch !== camera.pitch) {
        ui.compass(get("compass"), camera);
        lastYaw = camera.yaw; lastPitch = camera.pitch;
      }
      syncClock();
      if (ended || timestamp - lastMetrics >= 160) { updateMetrics(); lastMetrics = timestamp; }
      const moving = ["yaw", "pitch", "distance"].some(key => Math.abs(camera[key] - camera.target[key]) > 0.0001);
      if (state.playing || moving) schedule(); else lastTimestamp = null;
    }

    function resize() {
      const bounds = stage.getBoundingClientRect();
      width = Math.max(1, bounds.width); height = Math.max(1, bounds.height);
      pixelRatio = win.devicePixelRatio || 1;
      if (graphics) graphics.resize(width, height, pixelRatio);
      lastYaw = NaN;
      icons.forEach(ui.drawIcon);
      ui.cycleCurve(get("cycle-curve"));
      station.controls(); station.chart();
      updateMetrics();
      schedule();
    }

    function buttonIcon(button, name, label, shortcut) {
      const icon = button.querySelector("[data-icon]");
      icon.dataset.icon = name;
      button.setAttribute("aria-label", label);
      button.title = label + " (" + shortcut + ")";
      ui.drawIcon(icon);
    }

    function syncPlayback() {
      station.controls(Boolean(graphics));
      const status = graphics ? (state.playing ? "running" : "paused") : "offline";
      get("system-state").dataset.state = status;
      get("status-text").textContent = { running: "Simulation running", paused: "Simulation paused", offline: "Graphics offline" }[status];
      pause.disabled = !graphics;
      buttonIcon(pause, state.playing ? "pause" : "play", state.playing ? "Pause simulation" : "Resume simulation", "Space");
      const cyclePlaying = cycleStage && state.playing;
      const label = !cycleStage ? "Play life cycle" : cyclePlaying ? "Pause life cycle" :
        state.time === cycle.DURATION ? "Replay life cycle" : "Resume life cycle";
      const cyclePlay = get("cycle-play"), icon = cyclePlay.querySelector("[data-icon]");
      cyclePlay.disabled = !graphics;
      get("cycle-play-label").textContent = label;
      icon.dataset.icon = cyclePlaying ? "pause" : "play";
      ui.drawIcon(icon);
      get("cycle-exit").hidden = !cycleStage;
      for (const button of speedButtons) button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === state.speed));
    }

    function syncSignal() {
      const name = storm.LEVELS[state.signal - 1];
      for (const slider of signalSliders) {
        slider.value = String(state.signal);
        slider.style.setProperty("--fill", storm.normalized(state.signal) * 100 + "%");
        slider.setAttribute("aria-valuetext", state.signal + " of 10, " + name);
      }
      const digits = String(state.signal).padStart(2, "0");
      get("signal-output").textContent = digits;
      get("viewport-signal-output").textContent = digits + " / 10";
      get("level-name").textContent = name;
      get("signal-down").disabled = state.signal === 1;
      get("signal-up").disabled = state.signal === 10;
    }

    function changeSignal(value) {
      if (!Number.isFinite(Number(value))) return;
      const takeover = Boolean(cycleStage);
      if (!storm.setSignal(state, value) && !takeover) return;
      if (takeover) leaveCycle();
      if (!graphics || (takeover && !state.playing)) state.strength = storm.normalized(state.signal);
      syncSignal();
      updateMetrics();
      schedule();
    }

    function togglePlayback() {
      if (!graphics) return;
      if (cycleStage && state.time === cycle.DURATION) { seekCycle(0, true); return; }
      state.playing = !state.playing;
      lastTimestamp = null;
      syncPlayback(); updateMetrics(); schedule();
    }

    function syncView() {
      for (const button of viewButtons) {
        button.setAttribute("aria-pressed", String(button.dataset.view === camera.mode));
        ui.drawIcon(button.querySelector("[data-icon]"));
      }
    }

    function chooseView(mode) { math.aim(camera, mode); syncView(); schedule(); }
    function turn(dx, dy) {
      const previous = camera.mode;
      math.orbit(camera, dx, dy);
      if (camera.mode !== previous) syncView();
      schedule();
    }
    function magnify(factor) { math.zoom(camera, factor); schedule(); }

    function syncExpanded() {
      const expanded = doc.fullscreenElement === viewport || viewport.classList.contains("is-expanded");
      if (!expanded && doc.activeElement === viewportSlider) expand.focus({ preventScroll: true });
      get("viewport-signal-control").hidden = !expanded;
      buttonIcon(expand, expanded ? "shrink" : "expand", expanded ? "Exit expanded view" : "Expand viewport", "F");
      expand.setAttribute("aria-pressed", String(expanded));
      resize();
    }

    async function toggleExpanded() {
      if (fullscreenPending) return;
      fullscreenPending = true;
      const exitingNative = doc.fullscreenElement === viewport;
      try {
        if (exitingNative) await doc.exitFullscreen();
        else if (viewport.classList.contains("is-expanded")) viewport.classList.remove("is-expanded");
        else if (viewport.requestFullscreen) await viewport.requestFullscreen();
        else viewport.classList.add("is-expanded");
      } catch {
        if (!exitingNative && !destroyed && !doc.fullscreenElement) viewport.classList.add("is-expanded");
      } finally {
        fullscreenPending = false;
        if (!destroyed) syncExpanded();
      }
    }

    function openHelp() {
      if (dialog.open) return;
      previousFocus = doc.activeElement;
      dialog.showModal();
      get("help-close").focus();
      icons.forEach(ui.drawIcon);
    }

    function reportGraphics(title, detail) {
      get("graphics-title").textContent = title;
      get("graphics-detail").textContent = detail;
      get("graphics-message").hidden = false;
      tools.availability(false);
      syncPlayback();
    }

    function startGraphics() {
      if (graphics || destroyed) return;
      try {
        graphics = renderer.makeRenderer(canvas);
      } catch (error) {
        const missing = error.message === "WebGL is unavailable";
        reportGraphics(missing ? error.message : "The 3D view could not start",
          "Open this file in a browser with WebGL and hardware acceleration enabled, then reload the page.");
        if (!missing) win.console.warn("Isobar graphics initialization:", error.message);
        return;
      }
      get("graphics-message").hidden = true;
      tools.availability(true);
      lastTimestamp = null;
      syncPlayback(); resize();
    }

    for (const slider of signalSliders) listen(slider, "input", () => changeSignal(slider.value));
    listen(get("signal-down"), "click", () => changeSignal(state.signal - 1));
    listen(get("signal-up"), "click", () => changeSignal(state.signal + 1));
    for (const checkbox of all("[data-layer]")) {
      listen(checkbox, "change", () => {
        state.layers[checkbox.dataset.layer] = checkbox.checked;
        tools.syncImagery(); schedule();
      });
    }
    for (const button of speedButtons) {
      listen(button, "click", () => { state.speed = Number(button.dataset.speed); syncPlayback(); schedule(); });
    }
    for (const button of viewButtons) listen(button, "click", () => chooseView(button.dataset.view));
    listen(get("reset-view"), "click", () => chooseView("orbit"));
    listen(pause, "click", togglePlayback);
    listen(get("cycle-play"), "click", () => { if (cycleStage) togglePlayback(); else seekCycle(0, true); });
    listen(get("cycle-exit"), "click", leaveCycle);
    listen(cycleSlider, "input", () => seekCycle(Number(cycleSlider.value)));
    for (const button of stageButtons) {
      listen(button, "click", () => seekCycle(cycle.STAGES[Number(button.dataset.stage)].start));
    }
    listen(expand, "click", toggleExpanded);
    listen(doc, "fullscreenchange", syncExpanded);
    listen(get("help-open"), "click", openHelp);
    listen(get("help-close"), "click", () => dialog.close());
    listen(dialog, "close", () => { if (previousFocus) previousFocus.focus({ preventScroll: true }); });
    listen(dialog, "click", event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });

    listen(doc, "keydown", event => {
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      const key = event.key.toLowerCase();
      if (dialog.open) {
        if (key === "escape" || key === "?") { event.preventDefault(); if (!event.repeat) dialog.close(); }
        return;
      }
      const target = event.target;
      if (target.isContentEditable || target.tagName === "TEXTAREA" || (target.tagName === "INPUT" && !["range", "checkbox"].includes(target.type))) return;
      if (target.tagName === "INPUT" && (key.startsWith("arrow") || key === " ")) return;
      if (key === " " && target.tagName === "BUTTON") return;
      if (event.repeat && [" ", "f", "?", "p", "v", "g", "i", "x", "b", "c"].includes(key)) { event.preventDefault(); return; }
      if (tools.probing() && target === canvas && event.shiftKey && key.startsWith("arrow")) {
        const east = Number(key === "arrowright") - Number(key === "arrowleft");
        const north = Number(key === "arrowup") - Number(key === "arrowdown");
        tools.nudge(east, north); event.preventDefault(); return;
      }
      switch (key) {
        case "arrowup": changeSignal(state.signal + 1); break;
        case "arrowdown": changeSignal(state.signal - 1); break;
        case " ": togglePlayback(); break;
        case "a": turn(-12, 0); break;
        case "d": turn(12, 0); break;
        case "w": turn(0, 12); break;
        case "s": turn(0, -12); break;
        case "+": case "=": magnify(0.89); break;
        case "-": magnify(1 / 0.89); break;
        case "o": case "r": chooseView("orbit"); break;
        case "t": chooseView("overhead"); break;
        case "p": tools.toggleProbe(); break;
        case "v": tools.imagery(state.imagery === "radar" ? "cloud" : "radar"); break;
        case "g": tools.imagery(state.imagery === "wind" ? "cloud" : "wind"); break;
        case "i": tools.imagery(state.imagery === "pressure" ? "cloud" : "pressure"); break;
        case "b": tools.imagery(state.imagery === "doppler" ? "cloud" : "doppler"); break;
        case "c": tools.toggleCompare(); break;
        case "x": section.toggle(); break;
        case "f": toggleExpanded(); break;
        case "?": openHelp(); break;
        case "escape":
          if (!viewport.classList.contains("is-expanded")) return;
          viewport.classList.remove("is-expanded"); syncExpanded(); break;
        default: return;
      }
      event.preventDefault();
    });

    const cancelGestures = gestures.bind(canvas, listen, {
      available: () => Boolean(graphics), probing: tools.probing, turn, magnify, pageHeight: () => height,
      pick(x, y) {
        const rect = stage.getBoundingClientRect();
        const view = math.cameraFrame(camera, width / height);
        tools.pick(view, x - rect.left, y - rect.top, rect.width, rect.height);
      }
    });

    listen(canvas, "webglcontextlost", event => {
      event.preventDefault();
      stopFrames();
      cancelGestures();
      if (graphics) graphics.dispose();
      graphics = null;
      reportGraphics("Graphics connection interrupted", "The storm will resume when the browser restores its WebGL context.");
    });
    listen(canvas, "webglcontextrestored", startGraphics);
    listen(doc, "visibilitychange", () => { if (doc.hidden) { cancelGestures(); stopFrames(); } else schedule(); });
    listen(win, "blur", cancelGestures);
    listen(win, "resize", resize);
    if (win.ResizeObserver) {
      resizeObserver = new win.ResizeObserver(resize);
      resizeObserver.observe(stage);
    }

    function destroy() {
      destroyed = true;
      stopFrames();
      if (resizeObserver) resizeObserver.disconnect();
      listeners.forEach(remove => remove());
      if (graphics) graphics.dispose();
      graphics = null;
    }
    listen(win, "pagehide", event => {
      if (!event.persisted) { destroy(); return; }
      suspended = true; cancelGestures(); stopFrames();
    });
    listen(win, "pageshow", () => { suspended = false; schedule(); });
    syncSignal(); syncCyclePosition(); resize(); startGraphics();
    return { state, camera, destroy };
  }

  if (common) module.exports = { mount };
  else { root.Isobar.app = { mount }; mount(root.document, root); }
})(globalThis);
