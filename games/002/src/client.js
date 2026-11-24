(() => {
  "use strict";
  const { game: G, deck: Deck, effects: FX, controls: { Controls, movementKeys }, view, hud: { Hud, element } } = Slipwake;
  const canvas = document.getElementById("arena");
  const hud = new Hud();
  const menus = new Slipwake.menus.Menus(hud.ui);
  const input = new Controls();
  let loadout = Deck.starter;
  const newMatch = (mode="skirmish") => G.createMatch({mode, loadout, seed: Math.floor(Math.random() * 4294967296)});
  let match = newMatch(), effects = FX.create();
  let tape = null, review = null;
  let renderer = null, panel = null, guideFromPause = false, sheetFrom = null, sheetTrigger = null;
  let pointer = null, tapAim = null, pointerId = null, lastEvent = 0;
  let frameId = null, lastFrame = null, accumulated = 0;

  // All sounds are short oscillator envelopes, created after a user opts in.
  class Sound {
    constructor() {
      this.available = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.enabled = false;
      this.voices = 0;
      if (!this.available) {
        hud.ui.audio.disabled = true;
        hud.ui.audio.title = "Sound unavailable in this browser";
        hud.ui.audio.setAttribute("aria-label", hud.ui.audio.title);
      }
    }
    toggle() {
      if (!this.available) return;
      try {
        if (!this.context) {
          this.context = new this.available();
          this.volume = this.context.createGain();
          this.volume.connect(this.context.destination);
        }
        this.enabled = !this.enabled;
        this.volume.gain.value = this.enabled ? 0.32 : 0;
        if (this.enabled && this.context.state === "suspended") {
          this.context.resume().catch(() => {
            this.enabled = false;
            this.volume.gain.value = 0;
            hud.sound(false);
          });
        }
      } catch {
        this.enabled = false;
      }
      hud.sound(this.enabled);
      if (this.enabled) this.tone(470, 680, 0.08, 0.16, "sine");
    }
    tone(from, to, duration, level, wave) {
      if (!this.enabled || this.voices >= 9) return;
      const ctx = this.context, t = ctx.currentTime;
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      oscillator.type = wave;
      oscillator.frequency.setValueAtTime(from,t);
      oscillator.frequency.exponentialRampToValueAtTime(to,t+duration);
      gain.gain.setValueAtTime(0.0001,t);
      gain.gain.exponentialRampToValueAtTime(level,t+0.006);
      gain.gain.exponentialRampToValueAtTime(0.0001,t+duration);
      oscillator.connect(gain);
      gain.connect(this.volume);
      this.voices++;
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.voices--; };
      oscillator.start(t);
      oscillator.stop(t+duration);
    }
    play(e) {
      if (!this.enabled) return;
      switch (e.type) {
        case "shot": this.tone(e.team ? 280 : 405,95,0.075,e.source === 0 ? 0.15 : 0.045,"triangle"); break;
        case "hit": if (e.source === 0 || e.victim === 0) this.tone(e.victim === 0 ? 150 : 850,310,0.075,0.18,"sine"); break;
        case "ko": this.tone(e.team ? 740 : 220,e.team ? 1100 : 85,0.22,0.22,"triangle"); break;
        case "dash": this.tone(190,610,0.11,0.13,"triangle"); break;
        case "pulse": this.tone(165,52,0.25,0.24,"sine"); break;
        case "respawn": if (e.source === 0) this.tone(350,720,0.22,0.18,"sine"); break;
        case "fork": this.tone(590,120,0.17,0.17,"triangle"); break;
        case "repair": this.tone(415,830,0.16,0.12,"sine"); break;
        case "net": case "intercept": this.tone(680,390,0.09,0.10,"sine"); break;
        case "rally": this.tone(525,690,0.13,0.13,"triangle"); break;
        case "relayPickup": this.tone(410,610,0.16,0.13,"sine"); break;
        case "relayDrop": this.tone(490,240,0.18,0.12,"triangle"); break;
        case "delivery": this.tone(e.team ? 560 : 455,e.team ? 310 : 910,0.38,0.20,"triangle"); break;
        case "relayPass": this.tone(390,690,0.12,0.12,"sine"); break;
        case "relayCatch": this.tone(660,e.intercepted ? 320 : 850,0.14,0.14,"triangle"); break;
        case "signalShift": this.tone(570,950,0.22,0.13,"sine"); break;
        case "signalPoint": this.tone(e.team ? 355 : 580,e.team ? 295 : 710,0.07,0.075,"sine"); break;
        case "bank": case "ricochet": this.tone(780,440,0.08,0.13,"triangle"); break;
        case "haul": this.tone(460,160,0.17,0.16,"triangle"); break;
        case "focus": this.tone(760,550,0.09,0.11,"triangle"); break;
        case "supplyInbound": this.tone(470,660,0.18,0.12,"sine"); break;
        case "supplyCollect": this.tone(480,880,0.19,0.14,"sine"); break;
        case "vane": this.tone(340,600,0.11,0.10,"sine"); break;
        case "boltReturn": this.tone(640,1080,0.14,0.14,"triangle"); break;
        case "freightDock": this.tone(e.team ? 510 : 415,e.team ? 300 : 830,0.36,0.18,"sine"); break;
      }
    }
  }
  const sound = new Sound();

  function clearInput() {
    input.clear();
    if (pointerId !== null && canvas.hasPointerCapture?.(pointerId)) canvas.releasePointerCapture(pointerId);
    pointer = null;
    tapAim = null;
    pointerId = null;
    accumulated = 0;
    lastFrame = null;
  }
  function requestFrame() {
    if (renderer && frameId === null && !document.hidden) frameId = requestAnimationFrame(frame);
  }
  function cancelFrame() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
  }
  function deploy() {
    if (panel || match.phase !== "ready") return;
    G.start(match);
    tape = new Slipwake.tape.Recorder(match);
    hud.ui.deploy.hidden = hud.ui.deployment.hidden = true;
    hud.ui.announcer.textContent = hud.ui["mode-name"].textContent + " started. " + hud.ui["round-brief"].textContent + ".";
    canvas.focus({preventScroll:true});
    lastFrame = null;
    requestFrame();
  }
  function resetRound(mode) {
    clearInput();
    match = newMatch(mode);
    tape = review = null;
    effects = FX.create();
    lastEvent = 0;
    panel = null;
    menus.dismiss();
    hud.reset(match);
    requestFrame();
  }
  function replay() {
    resetRound(match.mode);
    deploy();
  }
  function lobby() {
    resetRound(match.mode);
    hud.ui.deployment.hidden = hud.ui.deploy.hidden = false;
    hud.ui["pick-"+match.mode].focus({preventScroll:true});
  }
  function suspend() {
    if (match.phase === "playing" || match.phase === "ready") G.pause(match);
    clearInput();
    requestFrame();
  }
  function resume() {
    if (match.phase === "paused") G.pause(match);
    panel = null;
    menus.dismiss();
    canvas.focus({preventScroll:true});
    lastFrame = null;
    requestFrame();
  }
  function pauseMenu() {
    suspend();
    panel = "pause";
    menus.modal("Round paused", [element("p","","The clock is stopped. Both crews will pick up where you left them.")],
      [["Return to yard",resume],["Field guide",guide],["Crew sheet",crewSheet],["Restart round",replay],["Choose mode",lobby]]);
  }
  function closeSheet() {
    if (sheetFrom === "result") showResult();
    else if (sheetFrom === "pause") pauseMenu();
    else {
      resume();
      if (sheetTrigger === hud.ui["crew-sheet"]) sheetTrigger.focus({preventScroll:true});
    }
    sheetFrom = sheetTrigger = null;
  }
  function crewSheet() {
    if (panel === "crew") { closeSheet(); return; }
    if (!renderer || (panel && panel !== "pause" && panel !== "result")) return;
    sheetFrom = panel;
    sheetTrigger = document.activeElement;
    if (match.phase !== "ended") suspend();
    panel = "crew";
    const back = sheetFrom === "result" ? "Back to result" : sheetFrom === "pause" ? "Back to pause" : "Return to yard";
    menus.crewSheet(match,[[back,closeSheet]]);
  }
  function closeEditor() {
    resume();
    hud.ui.deployment.hidden = hud.ui.deploy.hidden = false;
    hud.ui["edit-deck"].focus({preventScroll:true});
  }
  function editDeck() {
    if (!renderer || panel || match.phase !== "ready") return;
    suspend();
    panel = "deck";
    menus.editDeck(loadout, draft => {
      loadout = draft.slice();
      match.deck = Deck.create(loadout);
      hud.deck.update(match);
      closeEditor();
    },closeEditor);
  }
  function closeGuide() {
    if (guideFromPause) pauseMenu();
    else resume();
  }
  function guide() {
    if (!renderer || match.phase === "ended" || (panel && panel !== "pause" && panel !== "guide")) return;
    if (panel === "guide") { closeGuide(); return; }
    guideFromPause = panel === "pause";
    suspend();
    panel = "guide";
    menus.guide(match,[[guideFromPause ? "Back to pause" : "Return to yard",closeGuide]]);
  }
  function togglePause() {
    if (panel === "review") { showResult(); return; }
    if (panel === "crew") { closeSheet(); return; }
    if (!renderer || match.phase === "ended") return;
    if (panel === "deck") closeEditor();
    else if (panel === "guide") closeGuide();
    else if (panel === "pause") resume();
    else pauseMenu();
  }
  function dispatchEvents() {
    lastEvent = G.eventsSince(match,lastEvent,e => {
      FX.emit(effects,e);
      sound.play(e);
      hud.consume(match,e);
    });
    tape?.capture(match);
  }
  function showReview() {
    if (panel !== "result" || !tape) return;
    panel = "review";
    review = new Slipwake.review.Review(tape,match,menus,showResult,requestFrame);
  }
  function showResult() {
    const fromReview = panel === "review";
    clearInput();
    review = null;
    panel = "result";
    menus.result(match,replay,lobby,crewSheet,showReview,fromReview);
  }
  function frame(timestamp) {
    frameId = null;
    if (!renderer) return;
    if (panel === "review") { review.frame(timestamp); return; }
    if (lastEvent !== match.sequence) dispatchEvents();
    // Bound catch-up after a stall. Background tabs and menus accrue no match time.
    const dt = lastFrame === null ? 0 : Math.max(0,Math.min(0.10,(timestamp-lastFrame)/1000));
    lastFrame = timestamp;
    const aim = pointer ? renderer.pick(pointer.x,pointer.y,match.actors) : null;
    if (match.phase === "playing") {
      accumulated += dt;
      while (accumulated+1e-9 >= G.RULES.step && match.phase === "playing") {
        FX.step(effects,G.RULES.step);
        const controls = input.sample(view.YAW,input.tap && tapAim ? tapAim : aim);
        tapAim = null;
        G.step(match,controls);
        dispatchEvents();
        accumulated -= G.RULES.step;
      }
    }
    const passAim = pointer && match.relay?.carrier === 0 ? renderer.pick(pointer.x,pointer.y,match.actors,true) : null;
    renderer.render(match,effects,dt,aim,passAim);
    hud.update(match,renderer);
    if (match.phase === "ended" && !panel) showResult();
    if (match.phase === "playing" || match.phase === "ready") requestFrame();
  }
  function point(e) {
    const bounds = canvas.getBoundingClientRect();
    const x = e.clientX-bounds.left, y = e.clientY-bounds.top;
    pointer = x>=0 && x<bounds.width && y>=0 && y<bounds.height ? {x,y} : null;
  }
  function markUnderPointer(e) {
    if (!renderer || panel || match.phase !== "playing" || !match.actors[0].hp) return;
    e.preventDefault();
    point(e);
    if (pointer) input.focusTarget = renderer.pickRunner(pointer.x,pointer.y,match.actors)?.id ?? null;
  }
  function pressPointer(e) {
    if (!renderer || panel || e.isPrimary === false) return;
    if (e.button === 2) { markUnderPointer(e); return; }
    if (e.button !== 0) return;
    e.preventDefault();
    if (match.phase === "ready") deploy();
    if (match.phase !== "playing") return;
    canvas.focus({preventScroll:true});
    point(e);
    tapAim = pointer && renderer.pick(pointer.x,pointer.y,match.actors);
    pointerId = e.pointerId;
    canvas.setPointerCapture?.(pointerId);
    input.trigger();
  }
  canvas.addEventListener("pointerdown", pressPointer);
  canvas.addEventListener("pointermove", e => {
    if (panel || e.isPrimary === false || (pointerId !== null && pointerId !== e.pointerId)) return;
    // With a chorded mouse, the second press and first release arrive as
    // pointermove. Ordinary movement has button -1 and only updates the aim.
    if ((e.buttons & 3) === 3 && (e.button === 0 || e.button === 2)) pressPointer(e);
    else if ((e.buttons & 2) && !(e.buttons & 1) && e.button === 0) release(e);
    else point(e);
  });
  canvas.addEventListener("pointerleave", () => {
    if (pointerId === null) pointer = null;
  });
  function release(e) {
    if (pointerId !== e.pointerId) return;
    input.held = false;
    pointerId = null;
    point(e);
  }
  window.addEventListener("pointerup", release);
  function cancelPointer(e) {
    if (pointerId !== e.pointerId) return;
    release(e);
    input.tap = false;
    tapAim = pointer = null;
  }
  canvas.addEventListener("lostpointercapture", cancelPointer);
  window.addEventListener("pointercancel", cancelPointer);
  canvas.addEventListener("contextmenu", e => e.preventDefault());

  hud.ui.deploy.addEventListener("click", deploy);
  hud.ui["edit-deck"].addEventListener("click", editDeck);
  hud.ui["crew-sheet"].addEventListener("click", crewSheet);
  hud.ui.vane.addEventListener("click",() => {
    if (!renderer || panel || hud.ui.vane.disabled || match.phase!=="playing") return;
    input.press("KeyF");
    canvas.focus({preventScroll:true});
  });
  for (const mode of Object.keys(G.MODES)) {
    hud.ui["pick-"+mode].addEventListener("click",() => {
      if (!renderer || panel || match.phase !== "ready") return;
      if (match.mode !== mode) resetRound(mode);
      canvas.focus({preventScroll:true});
    });
  }
  hud.deck.slots.forEach(({button},slot) => button.addEventListener("click",() => {
    if (!renderer || panel || button.disabled || match.phase !== "playing") return;
    input.card(slot);
    canvas.focus({preventScroll:true});
  }));
  hud.ui.pause.addEventListener("click", togglePause);
  document.getElementById("guide").addEventListener("click", guide);
  hud.ui.audio.addEventListener("click", e => {
    sound.toggle();
    if (e.detail && !panel) canvas.focus({preventScroll:true});
  });
  window.addEventListener("keydown", e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (panel && e.key === "Tab") {
      const controls = Array.from(hud.ui.dialog.querySelectorAll("button,input")).filter(node => !node.disabled);
      const first = controls[0], last = controls.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (!renderer || e.repeat) return;
    if (e.code === "KeyM") { sound.toggle(); return; }
    if (e.code === "KeyC") { e.preventDefault(); crewSheet(); return; }
    if (e.code === "Escape") { e.preventDefault(); togglePause(); return; }
    if (e.key === "?" || e.code === "Slash") { e.preventDefault(); guide(); return; }
    if (panel) return;
    if (e.target?.tagName === "BUTTON" && (e.code === "Space" || e.code === "Enter")) return;
    if (e.code === "Enter") { e.preventDefault(); deploy(); return; }
    if (e.code === "KeyQ" && match.phase === "playing" && match.relay?.carrier === 0) {
      e.preventDefault();
      const actor = match.actors[0], aim = pointer && renderer.pick(pointer.x,pointer.y,match.actors,true);
      input.press(e.code,aim || [actor.x+Math.sin(actor.yaw),0,actor.z+Math.cos(actor.yaw)]);
      return;
    }
    if (["Digit1","Digit2","KeyR","KeyF"].includes(e.code) && match.phase === "playing") {
      e.preventDefault();
      if (e.code === "KeyR") {
        const ground = pointer && renderer.pick(pointer.x,pointer.y);
        input.press(e.code,ground || [match.actors[0].x,0,match.actors[0].z]);
      } else input.press(e.code);
      return;
    }
    if (movementKeys.includes(e.code) || e.code === "Space" || e.code === "KeyE") {
      e.preventDefault();
      if (match.phase === "ready") deploy();
      input.press(e.code);
    }
  });
  window.addEventListener("keyup", e => input.keys.delete(e.code));
  window.addEventListener("resize", requestFrame);
  function leaveField() {
    if (panel === "review") review.setPlaying(false);
    else if (renderer && match.phase === "playing") pauseMenu();
    else clearInput();
  }
  window.addEventListener("blur", leaveField);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { leaveField(); cancelFrame(); }
    else { lastFrame = null; requestFrame(); }
  });

  function graphicsError(error) {
    renderer = null;
    suspend();
    cancelFrame();
    panel = "error";
    hud.ui.deploy.hidden = hud.ui.deployment.hidden = true;
    const missing = error.message === "WebGL is unavailable";
    menus.modal(missing ? "WebGL unavailable" : "Graphics unavailable",
      [element("p","","Relay Yard needs WebGL to draw its 3D arena. Enable graphics acceleration in your browser settings, then reload this file.")],
      [["Reload arena",() => window.location.reload()]]);
  }
  canvas.addEventListener("webglcontextlost", e => {
    e.preventDefault();
    review?.setPlaying(false);
    renderer = null;
    suspend();
    cancelFrame();
    panel = "lost";
    menus.modal("Graphics interrupted", [element("p","","Your round is saved in this tab while the graphics context reconnects.")],
      [["Reload arena",() => window.location.reload()]]);
  });
  function openArena(restoring) {
    try {
      renderer = new view.Renderer(canvas);
    } catch (error) {
      graphicsError(error);
      return;
    }
    if (restoring) {
      if (match.phase === "ended") showResult();
      else pauseMenu();
    } else {
      // The portrait is cosmetic on devices that allow only one WebGL context.
      try { view.portrait(document.getElementById("portrait")); } catch { /* The crew crest is already painted. */ }
    }
    requestFrame();
  }
  canvas.addEventListener("webglcontextrestored", () => openArena(true));
  hud.reset(match);
  openArena(false);
})();
