"use strict";

(function () {
  const cube = TwistCube;
  const session = new TwistSession.Session();
  const orbit = new TwistMath.Orbit();
  const byId = id => document.getElementById(id);
  const canvas = byId("cube-canvas"), stage = byId("stage"), guide = byId("guide");
  const speed = byId("speed"), solveButton = byId("solve");
  const { formatMove, moveName } = TwistNotation;
  const faceButtons = new Map();
  let turnSuffix = "";
  let stickerLetters = false;
  let renderer = null;
  let frameId = null, previousTime = null, sizeChanged = true, dirty = true;
  let shownRevision = -1;
  let storage;
  try { storage = window.localStorage; } catch { /* Local-file storage can be restricted. */ }
  const planner = createTwistPlanner(session, changed);
  const updateTimeline = bindTwistTimeline(session, byId, changed);
  const updateEditor = bindTwistEditor(session, byId, changed, focusPuzzle);
  const net = bindTwistNet(session, byId, turnFace, invalidate);
  const updateTrials = bindTwistTrials(session, byId, changed, focusPuzzle, storage);
  const updateCoach = bindTwistCoach(session, byId, changed, focusPuzzle, net.selectPiece);
  const updateCheckpoints = bindTwistCheckpoints(session, byId, storage, (moves, name) => {
    replacePosition(moves, name);
    focusPuzzle();
  });

  function focusPuzzle() {
    const target = byId("render-error").hidden ? canvas : byId("cube-net");
    target.focus();
  }

  function makeSwatch() {
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.setAttribute("aria-hidden", "true");
    return swatch;
  }

  function turnFace(face, reverse) {
    const move = face + (turnSuffix || (reverse ? "'" : ""));
    if (session.manual(move)) changed();
  }

  function updateTurnButtons() {
    byId("prime").setAttribute("aria-pressed", String(turnSuffix === "'"));
    byId("half").setAttribute("aria-pressed", String(turnSuffix === "2"));
    for (const [face, button] of faceButtons) {
      const move = face + turnSuffix;
      button.lastElementChild.textContent = formatMove(move);
      button.title = face + " · " + moveName(move);
      button.setAttribute("aria-label", button.title);
    }
  }
  function toggleModifier(suffix) {
    turnSuffix = turnSuffix === suffix ? "" : suffix;
    updateTurnButtons();
    net.refresh(turnSuffix);
  }

  for (const face of cube.FACES) {
    const spec = cube.FACE[face], button = document.createElement("button");
    button.className = "face-button";
    button.style.setProperty("--face", spec.color);
    button.append(makeSwatch(), document.createElement("span"));
    button.addEventListener("click", event => turnFace(face, event.shiftKey));
    byId("face-grid").append(button);
    faceButtons.set(face, button);

    const entry = document.createElement("span"), letter = document.createElement("b");
    entry.className = "guide-face";
    entry.style.setProperty("--face", spec.color);
    letter.textContent = face;
    entry.append(makeSwatch(), letter, spec.name);
    byId("guide-faces").append(entry);
  }
  updateTurnButtons();

  function refresh() {
    if (shownRevision === session.revision) return;
    shownRevision = session.revision;
    const mode = session.mode, playing = session.playing;
    const idleState = session.trialActive ? (session.trial.startedAt === null ? "Inspecting" : "Timing") :
      (session.solved ? "Solved" : "Mixed");
    const state = { idle: idleState, planning: "Planning", manual: "Turning",
      undo: "Undoing", scrambling: "Scrambling", solving: session.paused ? "Paused" : "Solving",
      algorithm: session.paused ? "Paused" : "Playing" }[mode];
    byId("puzzle-state").textContent = state;
    byId("state-dot").className = "state-dot" + (mode !== "idle" || session.trialActive ? " working" : session.solved ? " solved" : "");
    byId("turn-count").textContent = String(session.history.length).padStart(2, "0");
    byId("last-turn").textContent = session.history.length ? formatMove(session.history.at(-1)) : "—";
    byId("solve-label").textContent = playing ? (session.paused ? "Resume" : "Pause") : mode === "planning" ? "Finding moves…" : "Auto-solve";
    byId("solve-icon").setAttribute("href", playing && !session.paused ? "#i-pause" : "#i-play");
    solveButton.disabled = !playing && (!session.canStartSequence || session.solved);
    byId("scramble").disabled = !session.canStartSequence;
    byId("undo").disabled = !session.canStartSequence || !session.history.length;
    speed.disabled = session.trialActive;
    byId("speed-value").textContent = session.trialActive ? "Trial pace" : session.speed + "×";
    for (const button of faceButtons.values()) button.disabled = mode !== "idle" && mode !== "manual";
    updateTimeline();
    updateEditor();
    net.refresh(turnSuffix);
    updateTrials();
    updateCoach();
    updateCheckpoints();
    const announcement = "Puzzle state: " + state + ".";
    if (byId("announcement").textContent !== announcement) byId("announcement").textContent = announcement;
  }

  const axes = ["x", "y", "z"].map(axis => {
    const group = byId("axis-" + axis);
    return { line: group.querySelector("line"), label: group.querySelector("text") };
  });
  function updateAxes(view) {
    axes.forEach(({ line, label }, index) => {
      const x = view[index * 4], y = -view[index * 4 + 1];
      line.setAttribute("x1", 31);
      line.setAttribute("y1", 32);
      line.setAttribute("x2", 31 + x * 18);
      line.setAttribute("y2", 32 + y * 18);
      label.setAttribute("x", 31 + x * 26);
      label.setAttribute("y", 32 + y * 26);
    });
  }

  function schedule() {
    if (frameId === null && !document.hidden) frameId = window.requestAnimationFrame(frame);
  }
  function invalidate() {
    dirty = true;
    schedule();
  }
  function changed() {
    refresh();
    invalidate();
  }
  function frame(time) {
    frameId = null;
    const elapsed = previousTime === null ? 0 : Math.min(80, Math.max(0, time - previousTime));
    previousTime = time;
    const turning = session.tick(elapsed), orbiting = orbit.step(elapsed);
    if (renderer && (dirty || sizeChanged || turning || orbiting)) {
      if (sizeChanged) renderer.resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio);
      const camera = orbit.frame(canvas.width / canvas.height);
      renderer.draw(session.pieces, session.active, camera, stickerLetters, net.trackedPiece);
      if (dirty || sizeChanged || orbiting) updateAxes(camera.view);
    }
    dirty = false;
    sizeChanged = false;
    refresh();
    if ((session.active && !session.paused) || orbiting) schedule();
    else previousTime = null;
  }
  function resized() {
    sizeChanged = true;
    invalidate();
  }
  window.addEventListener("resize", resized);
  if ("ResizeObserver" in window) new ResizeObserver(resized).observe(stage);
  document.addEventListener("visibilitychange", () => {
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    frameId = previousTime = null;
    if (!document.hidden) resized();
  });

  function renderError(message) {
    renderer = null;
    byId("sticker-letters").disabled = byId("explode-view").disabled = true;
    byId("render-error-text").textContent = message;
    byId("render-error").hidden = false;
  }
  function initializeGraphics() {
    try {
      renderer = new TwistRenderer(canvas, session.pieces);
      byId("sticker-letters").disabled = byId("explode-view").disabled = false;
      byId("render-error").hidden = true;
      resized();
    } catch {
      renderError("WebGL could not start. Enable hardware acceleration in your browser and reopen this file. You can still use the face controls and move history.");
    }
  }
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    renderError("The browser lost its graphics context. Your puzzle is saved in this session while the 3D view reconnects.");
  });
  canvas.addEventListener("webglcontextrestored", initializeGraphics);
  byId("explode-view").addEventListener("click", () => {
    const expanded = !orbit.goal.spread;
    orbit.setExploded(expanded, window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    byId("explode-view").setAttribute("aria-pressed", String(expanded));
    invalidate();
  });
  byId("sticker-letters").addEventListener("click", () => {
    stickerLetters = !stickerLetters;
    byId("sticker-letters").setAttribute("aria-pressed", String(stickerLetters));
    invalidate();
  });
  bindTwistViewport(canvas, orbit, (face, reverse) => {
    if (renderer && session.mode === "idle") turnFace(face, reverse);
  }, invalidate, hit => {
    if (renderer && !session.active?.progress) net.trackHit(hit);
  });

  function toggleSolve() {
    if (session.playing) {
      session.togglePause();
      changed();
    } else planner.request();
  }
  function scramble() { if (session.scramble()) changed(); }
  function undo() { if (session.undo()) changed(); }
  byId("scramble").addEventListener("click", scramble);
  solveButton.addEventListener("click", toggleSolve);
  byId("undo").addEventListener("click", undo);
  function replacePosition(moves, label) {
    if (session.mode === "planning") planner.release();
    session.load(moves, label);
    changed();
  }
  byId("reset-cube").addEventListener("click", () => replacePosition([], "Free play"));
  byId("prime").addEventListener("click", () => toggleModifier("'"));
  byId("half").addEventListener("click", () => toggleModifier("2"));
  speed.addEventListener("input", () => {
    const index = Number(speed.value), value = TwistSession.SPEEDS[index];
    session.setSpeed(value);
    speed.setAttribute("aria-valuetext", value + " times");
    speed.style.setProperty("--fill", 100 * index / (TwistSession.SPEEDS.length - 1) + "%");
    changed();
  });

  function resetView() { orbit.reset(); invalidate(); }
  byId("reset-view").addEventListener("click", resetView);
  function expandView(expanded) {
    stage.classList.toggle("expanded", expanded);
    document.body.classList.toggle("expanded-view", expanded);
    const button = byId("expand-view");
    button.setAttribute("aria-pressed", String(expanded));
    button.setAttribute("aria-label", expanded ? "Collapse viewport" : "Expand viewport");
    button.title = expanded ? "Collapse viewport (Esc)" : "Expand viewport";
    byId("expand-icon").setAttribute("href", expanded ? "#i-shrink" : "#i-expand");
    if (expanded) canvas.focus({ preventScroll: true });
    else button.focus({ preventScroll: true });
    resized();
  }
  byId("expand-view").addEventListener("click", () => expandView(!stage.classList.contains("expanded")));
  byId("net-shortcut").addEventListener("click", event => {
    event.preventDefault();
    if (stage.classList.contains("expanded")) expandView(false);
    byId("cube-net").focus();
  });
  byId("nav-simulator").addEventListener("click", () => focusPuzzle());
  byId("guide-open").addEventListener("click", () => guide.showModal());
  byId("guide-close").addEventListener("click", () => guide.close());
  guide.addEventListener("click", event => {
    if (event.target !== guide) return;
    const box = guide.getBoundingClientRect();
    if (event.clientX < box.left || event.clientX > box.right ||
        event.clientY < box.top || event.clientY > box.bottom) guide.close();
  });

  document.addEventListener("keydown", event => {
    if (guide.open || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
    if (stage.classList.contains("expanded")) {
      if (event.key === "Escape") { event.preventDefault(); expandView(false); return; }
      if (event.key === "Tab") {
        const end = byId(byId("render-error").hidden ? "expand-view" : "net-shortcut");
        if (event.shiftKey && event.target === canvas) { event.preventDefault(); end.focus(); }
        if (!event.shiftKey && event.target === end) { event.preventDefault(); canvas.focus(); }
        return;
      }
    }
    if (event.target.isContentEditable || event.target.closest("input, textarea, select")) return;
    const key = event.key.toUpperCase();
    let action;
    if (cube.FACES.includes(key)) action = () => turnFace(key, event.shiftKey);
    else if (key === "2") action = () => toggleModifier("2");
    else if (key === "S") action = scramble;
    else if (key === "Z") action = undo;
    else if (key === "HOME") action = resetView;
    else if (key === " " && !event.target.closest("button, a")) action = toggleSolve;
    else return;
    event.preventDefault();
    if (!event.repeat) action();
  });

  initializeGraphics();
  changed();
})();
