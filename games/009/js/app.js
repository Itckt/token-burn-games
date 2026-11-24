(function () {
  "use strict";
  const M = FoundryMath, T = FoundryTrack, P = FoundryPhysics;
  const {Renderer, FINISHES} = FoundryRender;
  const {byId, setText, finishFor} = FoundryPanels;
  const canvas = byId("scene"), help = byId("help"), speed = byId("speed");
  const editor = new T.Editor(), camera = new FoundryCamera.Orbit();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let course = T.build(editor.layout), world = new P.World(course);
  let renderer = null, frameId = null, lastTime = null, lastVisibleCount = 0;
  let axisYaw, axisPitch, drawnView;
  let color = 0, toastTimer, openMenu, playbackRate = 1, orbitName = "Isometric";
  camera.setCourse(course);
  const builder = FoundryBuildPanel.mount({editor, rebuild, requestFrame, toast});
  builder.setCourse(course);
  const player = new FoundryReplay.Player();
  const review = FoundryReplayPanel.mount(player, {toggle: toggleReplay, play: pause, seek: seekReplay});
  const timing = FoundryPanels.timing(() => world, requestFrame);
  const heatPanel = FoundryPanels.paceHeat(startHeat);
  const tabs = FoundryPanels.benchTabs(refreshTrials);
  const blueprints = FoundryPanels.blueprints(() => editor.layout, layout => {
    editor.commit(layout);
    rebuild(layout.name + " opened");
  });

  function toast(message) {
    const el = byId("toast");
    el.textContent = message;
    el.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("visible"), 2000);
  }

  const swatches = FINISHES.map((finish, index) => {
    const button = document.createElement("button");
    button.className = "swatch";
    button.title = finish.name;
    button.setAttribute("aria-label", finish.name);
    button.setAttribute("aria-pressed", String(index === color));
    const bead = document.createElement("span");
    bead.className = "bead";
    bead.style.setProperty("--ball", "#" + finish.hex);
    button.append(bead);
    button.addEventListener("click", () => {
      swatches[color].setAttribute("aria-pressed", "false");
      color = index;
      button.setAttribute("aria-pressed", "true");
      setText("color-name", finish.name);
      refreshTrials();
      requestFrame();
    });
    byId("swatches").append(button);
    return button;
  });
  document.querySelectorAll("[data-icon]").forEach(FoundryIcons.draw);

  const rateButtons = Array.from(document.querySelectorAll("[data-rate]"));
  for (const button of rateButtons) button.addEventListener("click", () => {
    playbackRate = Number(button.dataset.rate);
    for (const item of rateButtons) item.setAttribute("aria-pressed", String(item === button));
    updateControls();
    requestFrame();
  });
  function refreshTrials() {
    if (byId("trials-panel").hidden) return;
    const reviewing = Boolean(player.record);
    timing.refresh(reviewing);
    heatPanel.refresh(world, Number(speed.value), color, Boolean(renderer), reviewing);
    review.refresh(world.timing.lastReplay, Boolean(renderer));
  }
  function updateCounts() {
    setText("in-play", world.balls.filter(ball => !ball.finished).length);
    setText("finished", world.completed);
    byId("clear").disabled = !renderer || (world.dropped === 0 && !world.heat);
    const canStep = player.record ? !player.playing && player.time < player.record.time : world.paused && world.hasWork;
    byId("step-frame").disabled = !renderer || !canStep;
    refreshTrials();
  }
  function updateControls() {
    const count = editor.layout.pieces.length;
    setText("track-name", editor.layout.name);
    byId("track-name").title = editor.layout.name;
    setText("piece-count", count + (count === 1 ? " piece" : " pieces"));
    setText("track-length", course.length.toFixed(1) + " m");
    builder.refresh(Boolean(renderer));
    for (const button of rateButtons) button.disabled = !renderer;
    byId("undo").disabled = !renderer || editor.past.length === 0;
    byId("redo").disabled = !renderer || editor.future.length === 0;
    for (const id of ["drop", "pause", "fit", "zoom-in", "zoom-out", "view-toggle"]) byId(id).disabled = !renderer;
    const pause = byId("pause"), icon = pause.querySelector("[data-icon]");
    const action = world.paused ? "Resume" : "Pause";
    pause.setAttribute("aria-pressed", String(world.paused));
    pause.setAttribute("aria-label", action + " simulation");
    pause.title = action + " simulation (P)";
    const glyph = world.paused ? "play" : "pause";
    if (icon.dataset.icon !== glyph) {
      icon.dataset.icon = glyph;
      FoundryIcons.draw(icon);
    }
    const live = playbackRate === 1 ? "Physics live" : "Physics live · " + playbackRate + "×";
    let state = world.paused ? "Physics paused" : live;
    if (player.record) state = player.playing ? "Replay playing" : "Replay paused";
    setText("sim-state", renderer ? state : "3D offline");
    review.transport(Boolean(renderer));
    updateViewLabel();
    byId("status-dot").classList.toggle("paused", player.record ? !player.playing : world.paused);
    byId("status-dot").classList.toggle("offline", !renderer);
    updateCounts();
  }
  function updateSpeed() {
    setText("speed-value", speed.value);
    speed.style.setProperty("--fill", (Number(speed.value) / Number(speed.max) * 100) + "%");
    refreshTrials();
  }
  speed.addEventListener("input", updateSpeed);
  updateSpeed();

  function requestFrame() {
    if (renderer && !document.hidden && frameId === null) frameId = requestAnimationFrame(frame);
  }
  function stopFrames() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    lastTime = null;
  }
  function liveScene(dt) {
    const previousScore = world.completed, previousCount = world.balls.length, previousDrops = world.dropped;
    world.advance(dt, playbackRate);
    if (camera.following) followRunner();
    const balls = world.balls.map(ball => ({p: world.position(ball), q: world.orientation(ball), color: ball.color}));
    if (world.canSpawn()) {
      const queued = world.heat?.entries[world.heat.next];
      balls.push({p: world.launchPosition, color: queued?.color ?? color});
    }
    const running = world.hasWork && !world.paused;
    const rosterChanged = previousCount !== world.balls.length || previousDrops !== world.dropped;
    if (rosterChanged) renderer.dirty = true;
    if (previousScore !== world.completed || rosterChanged) updateCounts();
    else if (running) refreshTrials();
    announceFinish(previousScore);
    return {balls, running, moving: running && world.balls.length > 0, ghost: timing.ghostEnabled ? world.ghost() : null};
  }
  function replayScene(dt) {
    const playing = player.playing;
    player.advance(Math.min(dt, 0.1) * playbackRate);
    const ball = FoundryReplay.pose(player.record, player.time);
    if (camera.following) camera.follow(ball.p);
    runnerReadout(ball, ball.p, ball.speed);
    review.cursor();
    if (player.playing !== playing) {
      renderer.dirty = true;
      updateControls();
    }
    return {balls: [ball], running: player.playing, moving: player.playing, ghost: null};
  }
  function frame(now) {
    frameId = null;
    if (!renderer || document.hidden) return;
    const dt = lastTime === null ? 0 : Math.max(0, (now - lastTime) / 1000);
    lastTime = now;
    const scene = player.record ? replayScene(dt) : liveScene(dt);
    const view = camera.update(dt, reducedMotion.matches);
    if (scene.balls.length !== lastVisibleCount) renderer.dirty = true;
    lastVisibleCount = scene.balls.length;
    renderer.render(view, scene.balls, now, scene.moving, scene.ghost, builder.selectedSection);
    drawnView = view;
    if (axisYaw !== camera.yaw || axisPitch !== camera.pitch) {
      FoundryIcons.axis(byId("axis"), view);
      axisYaw = camera.yaw;
      axisPitch = camera.pitch;
    }
    if (scene.running || camera.moving()) requestFrame();
    else lastTime = null;
  }
  function announceFinish(previousScore) {
    if (world.completed !== previousScore) {
      const result = world.timing.recent[0];
      toast("#" + result.number + " finished in " + result.time.toFixed(3) + " s" +
        (world.completed === 3 ? " · Milk tea break?" : ""));
    }
  }
  function resizeScene(immediate = false) {
    if (!renderer) return;
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    // Limit fragment work on large HiDPI displays while retaining crisp edges.
    const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(1800000 / (w * h)));
    const width = Math.max(1, Math.round(w * ratio)), height = Math.max(1, Math.round(h * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    if (immediate || w !== camera.width || h !== camera.height) camera.resize(w, h, immediate);
    requestFrame();
  }
  function graphicsError(title, detail) {
    stopFrames();
    sceneInput.reset();
    drawnView = null;
    renderer = null;
    setText("error-title", title);
    setText("error-detail", detail);
    byId("gl-error").hidden = false;
    updateControls();
  }
  function startGraphics() {
    if (renderer) return;
    try {
      renderer = new Renderer(canvas);
      renderer.previews(builder.cards);
      renderer.course(course);
      byId("gl-error").hidden = true;
      resizeScene(camera.width === 1 && camera.height === 1);
      updateControls();
    } catch (error) {
      if (error.message === "WebGL is unavailable") {
        graphicsError(error.message, "Enable hardware acceleration in your browser settings, then retry the 3D view.");
      } else {
        graphicsError("3D view could not start", "The graphics driver could not prepare the workshop. " + error.message);
      }
    }
  }
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    graphicsError("3D view interrupted", "Your track and marbles are held here while the graphics connection recovers.");
  });
  canvas.addEventListener("webglcontextrestored", startGraphics);
  byId("retry").addEventListener("click", startGraphics);
  window.addEventListener("resize", () => resizeScene());
  if (typeof ResizeObserver === "function") new ResizeObserver(() => resizeScene()).observe(canvas);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { stopFrames(); sceneInput.reset(); }
    else requestFrame();
  });

  function rebuild(message, selected = -1) {
    const resetRun = world.dropped > 0 || Boolean(world.heat), paused = world.paused;
    course = T.build(editor.layout);
    player.close();
    drawnView = null;
    world = new P.World(course);
    world.paused = paused;
    lastTime = null;
    camera.setCourse(course);
    if (!camera.following) camera.fit();
    if (renderer) renderer.course(course);
    builder.setCourse(course, selected);
    updateControls();
    toast(message + (resetRun ? " · run reset" : ""));
    requestFrame();
  }
  function undo() { if (renderer && editor.undo()) rebuild("Edit undone"); }
  function redo() { if (renderer && editor.redo()) rebuild("Edit restored"); }
  byId("undo").addEventListener("click", undo);
  byId("redo").addEventListener("click", redo);

  function drop() {
    if (!renderer || player.record) return;
    const idle = !world.hasWork;
    if (!world.spawn(Number(speed.value), color)) {
      return toast(world.balls.length >= P.MAX_BALLS ? "All marble slots are in play" : "Launch gate occupied");
    }
    if (idle) lastTime = null;
    renderer.dirty = true;
    if (world.paused) toast("Marble staged · resume to roll");
    updateCounts();
    requestFrame();
  }
  function startHeat() {
    if (!renderer || player.record) return;
    const idle = !world.hasWork;
    if (!world.startHeat(Number(speed.value), color, FINISHES.length)) return;
    if (idle) lastTime = null;
    renderer.dirty = true;
    tabs.showTrials();
    updateCounts();
    requestFrame();
  }
  function stepFrame() {
    if (player.record) {
      if (!player.playing) seekReplay(player.time + 1/60);
      return;
    }
    const score = world.completed;
    if (!renderer || !world.stepFrame()) return;
    renderer.dirty = true;
    announceFinish(score);
    updateCounts();
    requestFrame();
  }
  function pause() {
    if (!renderer) return;
    if (player.record) player.toggle();
    else world.paused = !world.paused;
    playbackChanged();
  }
  function playbackChanged() {
    lastTime = null;
    if (renderer) renderer.dirty = true;
    updateControls();
    requestFrame();
  }
  function toggleReplay() {
    if (player.record) {
      const restoreFocus = byId("replay-transport").contains(document.activeElement);
      player.close();
      playbackChanged();
      if (restoreFocus) (byId("trials-panel").hidden ? canvas : byId("review-run")).focus();
    } else if (renderer && world.timing.lastReplay) {
      player.open(world.timing.lastReplay);
      tabs.showTrials();
      playbackChanged();
      const play = byId("replay-play");
      (play.disabled ? byId("replay-exit") : play).focus();
    }
  }
  function seekReplay(time) {
    if (!renderer || !player.record) return;
    player.seek(time);
    playbackChanged();
  }
  function clear() {
    if (!renderer) return;
    world.clear();
    player.close();
    playbackChanged();
    toast("Marbles and scores cleared");
  }
  byId("drop").addEventListener("click", drop);
  byId("pause").addEventListener("click", pause);
  byId("clear").addEventListener("click", clear);
  byId("step-frame").addEventListener("click", stepFrame);

  function updateViewLabel() {
    setText("view-name", camera.following ? "Follow marble" : orbitName);
    byId("follow-readout").hidden = !renderer || (!camera.following && !player.record);
  }
  function runnerReadout(ball, position, speed) {
    setText("follow-runner", ball ? "#" + ball.number + " " + finishFor(ball.color).name : "Release gate");
    setText("follow-speed", speed.toFixed(1) + " m/s");
    setText("follow-height", position[1].toFixed(1) + " m high");
  }
  function followRunner() {
    const ball = world.followBall;
    const position = ball ? world.position(ball) : world.launchPosition;
    camera.follow(position, ball?.v);
    runnerReadout(ball, position, ball ? M.length(ball.v) : 0);
  }
  function follow() {
    if (player.record) camera.follow(FoundryReplay.position(player.record, player.time));
    else followRunner();
    updateViewLabel();
    requestFrame();
  }
  function zoom(factor) { camera.zoom(factor); requestFrame(); }
  function fit() { camera.fit(); updateViewLabel(); requestFrame(); }
  function orbit(dx, dy) {
    camera.orbit(dx, dy);
    orbitName = "Free orbit";
    updateViewLabel();
    requestFrame();
  }
  byId("zoom-in").addEventListener("click", () => zoom(0.82));
  byId("zoom-out").addEventListener("click", () => zoom(1 / 0.82));
  byId("fit").addEventListener("click", fit);
  const sceneInput = FoundrySceneInput.bind(canvas, {
    available: () => Boolean(renderer), orbit, zoom,
    pick(x, y) {
      if (!drawnView) return;
      const section = renderer.pick(drawnView, x, y);
      builder.selectSection(section);
      if (section >= 0) tabs.showBuild();
    }
  });

  function closeMenu(restoreFocus = false) {
    if (!openMenu) return;
    const {menu, toggle} = openMenu;
    openMenu = null;
    menu.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    if (restoreFocus) toggle.focus();
  }
  for (const name of ["layouts", "view"]) {
    const toggle = byId(name + "-toggle"), menu = byId(name + "-menu");
    toggle.addEventListener("click", () => {
      const opening = menu.hidden;
      closeMenu();
      if (opening) {
        openMenu = {toggle, menu};
        menu.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        menu.querySelector("button").focus();
      }
    });
    for (const option of menu.querySelectorAll("button")) {
      option.addEventListener("click", () => {
        closeMenu(true);
        if (option.dataset.layout && editor.load(option.dataset.layout)) {
          rebuild(editor.layout.name + " opened");
        } else if (option === byId("blueprint-open")) {
          blueprints.open();
        } else if (option.dataset.view === "follow") {
          follow();
        } else if (camera.preset(option.dataset.view)) {
          orbitName = option.textContent;
          updateViewLabel();
          requestFrame();
        }
      });
    }
  }
  function dismissOutside(event) {
    if (openMenu && !openMenu.menu.contains(event.target) && !openMenu.toggle.contains(event.target)) closeMenu();
  }
  document.addEventListener("pointerdown", dismissOutside);
  document.addEventListener("focusin", dismissOutside);
  function showHelp() { closeMenu(); if (!help.open) help.showModal(); }
  byId("help-open").addEventListener("click", showHelp);
  byId("help-close").addEventListener("click", () => help.close());
  help.addEventListener("click", event => { if (event.target === help) help.close(); });

  const hotkeys = {
    " ": () => player.record ? pause() : drop(), p: pause, c: clear, r: toggleReplay,
    g: timing.toggleGhost, backspace: builder.remove, f: fit,
    h: startHeat, ".": stepFrame, v: () => camera.following ? fit() : follow(),
    "+": () => zoom(0.82), "=": () => zoom(0.82), "-": () => zoom(1 / 0.82),
    arrowleft: () => orbit(-12, 0), arrowright: () => orbit(12, 0),
    arrowup: () => orbit(0, 10), arrowdown: () => orbit(0, -10)
  };
  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || event.isComposing || help.open || byId("blueprints").open) return;
    const key = event.key.toLowerCase();
    if (openMenu) {
      if (key === "escape") { event.preventDefault(); closeMenu(true); }
      if (key === "arrowup" || key === "arrowdown") {
        event.preventDefault();
        const options = Array.from(openMenu.menu.querySelectorAll("button"));
        const next = options.indexOf(document.activeElement) + (key === "arrowup" ? -1 : 1);
        options[(next + options.length) % options.length].focus();
      }
      return;
    }
    const target = event.target;
    if (key === "escape" && player.record) { event.preventDefault(); toggleReplay(); return; }
    if (target === byId("replay-scrub") && player.record && [" ", "p", "r", "."].includes(key) &&
        !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      if (!event.repeat) hotkeys[key]();
      return;
    }
    if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || event.altKey) return;
    if (event.ctrlKey || event.metaKey) {
      if (key === "z" || key === "y") {
        event.preventDefault();
        if (key === "y" || event.shiftKey) redo(); else undo();
      }
      return;
    }
    if (key === "?") { event.preventDefault(); showHelp(); return; }
    if (!renderer || (key === " " && target.closest && target.closest("button"))) return;
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code) || /^([1-9])$/.exec(key);
    if (digit && Number(digit[1]) <= T.LIBRARY.length) {
      event.preventDefault();
      if (!event.repeat) builder.insert(Number(digit[1]) - 1, event.shiftKey);
    } else if (Object.hasOwn(hotkeys, key)) {
      event.preventDefault();
      if (!event.repeat || key.startsWith("arrow") || ["+", "=", "-"].includes(key)) hotkeys[key]();
    }
  });
  startGraphics();
})();
