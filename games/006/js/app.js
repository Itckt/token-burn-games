(function () {
  'use strict';
  const { ride: R, math, camera: C, instruments, icons, weather, signals, shuttle, boarding, daylight, comfort } = Nightline;
  const { byId, write } = Nightline.dom;
  const scene = byId('scene'), guide = byId('guide');
  const ride = R.createRide(), camera = C.createCamera();
  const soundContext = window.AudioContext || window.webkitAudioContext;
  const sound = Nightline.audio.createAudio(soundContext);
  const controls = Array.from(document.querySelectorAll('[data-action]'));
  const views = ['front', 'platform', 'left', 'saloon'].map(preset => ({ preset, button: byId('view-' + preset) }));
  const soundButton = byId('sound'), fullscreenButton = byId('fullscreen');
  const heldKeys = new Set();
  const refreshPanel = instruments.bind(ride, camera);
  let renderer = null, frameId = null, previousTime = null, hudTime = -Infinity;
  let dirty = true, hadShuttle = false, skyRefreshAt = 0, soundOn = false, audioRevision = 0, pointer = null, noticeTimer;
  function notify(message) {
    const el = byId('notice');
    clearTimeout(noticeTimer);
    el.textContent = message;
    el.hidden = !message;
    if (message) noticeTimer = setTimeout(() => { el.hidden = true; }, 2700);
  }
  function refreshHUD() { refreshPanel(Boolean(renderer)); }

  function viewButtons() {
    for (const { preset, button } of views) button.setAttribute('aria-pressed', String(camera.preset === preset));
  }
  function queueFrame() {
    if (frameId === null && renderer && !document.hidden && !guide.open) frameId = requestAnimationFrame(frame);
  }
  function invalidate() { dirty = true; queueFrame(); }
  function setView(preset) { C.setView(camera, preset); viewButtons(); refreshHUD(); queueFrame(); }
  function stopFrames() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null; previousTime = null;
  }
  function syncAudio() { sound.update(ride, !renderer || document.hidden || guide.open); }
  function lookDirection() { return Number(heldKeys.has('ArrowRight')) - Number(heldKeys.has('ArrowLeft')); }

  function frame(now) {
    frameId = null;
    const dt = previousTime === null ? 0 : math.clamp((now - previousTime) / 1000, 0, 0.10);
    previousTime = now;
    const { position, door, phase, time } = ride;
    const occupied = signals.secondsToClear(ride) > 0;
    const weatherWasActive = weather.active(ride.weather), crossing = ride.car.call.crossing;
    const wasSwinging = comfort.active(ride.swing);
    R.advance(ride, dt);
    const turn = lookDirection();
    const turning = turn !== 0 && turn * camera.goalYaw < Math.PI;
    if (turning && dt) { C.pan(camera, turn * dt * 1.65, 0); viewButtons(); }
    const looking = C.advance(camera, dt);
    const weatherActive = !ride.paused && weather.active(ride.weather);
    const swinging = !ride.paused && comfort.active(ride.swing);
    const cabActivity = ride.time !== time &&
      (weatherWasActive || weatherActive || crossing || ride.car.call.crossing || wasSwinging || swinging);
    const traffic = shuttle.carsAt(ride.position, ride.time);
    const passing = ride.time !== time && (hadShuttle || traffic.length > 0);
    hadShuttle = traffic.length > 0;
    const signalChanged = occupied !== (signals.secondsToClear(ride) > 0);
    const skyChanged = ride.berth === null && ride.time >= skyRefreshAt && R.openAir(position) > 0;
    if (dirty || looking || position !== ride.position || door !== ride.door || phase !== ride.phase || cabActivity || passing || signalChanged || skyChanged) {
      renderer.render(ride, camera, traffic);
      skyRefreshAt = ride.time + daylight.SECONDS_PER_MINUTE;
      dirty = false;
    }
    const driving = !ride.paused && boarding.active(ride);
    const needsFrame = driving || weatherActive || swinging || turning || C.moving(camera);
    const nearBoard = R.gaugePosition(ride) !== null;
    if (now - hudTime >= (nearBoard ? 1000 / 30 : 100) || phase !== ride.phase || !needsFrame) {
      refreshHUD(); syncAudio(); hudTime = now;
    }
    if (needsFrame) queueFrame();
    else previousTime = null;
  }

  function dispatch(action) {
    if (!renderer || document.hidden || guide.open) return;
    if (action === 'center') { setView('front'); return; }
    if (action === 'leftView') { setView('left'); return; }
    if (action === 'saloon') { setView('saloon'); return; }
    if (action === 'view') { setView(camera.preset === 'platform' ? 'front' : 'platform'); return; }
    notify(R.command(ride, action));
    if (['signals', 'shift', 'guard', 'bell', 'doors'].includes(action)) dirty = true;
    if (action === 'pause') previousTime = null;
    refreshHUD(); syncAudio(); queueFrame();
  }
  function releasePointer() {
    const id = pointer?.id;
    pointer = null;
    if (id !== undefined && scene.hasPointerCapture(id)) scene.releasePointerCapture(id);
    scene.classList.remove('dragging');
  }
  function releaseInput() {
    heldKeys.clear();
    controls.forEach(el => el.classList.remove('pressed'));
    releasePointer();
  }
  function toggleGuide() {
    if (guide.open) { guide.close(); return; }
    releaseInput(); guide.showModal(); stopFrames(); syncAudio();
  }
  byId('guide-open').addEventListener('click', toggleGuide);
  byId('guide-close').addEventListener('click', () => guide.close());
  guide.addEventListener('close', () => { previousTime = null; syncAudio(); invalidate(); });
  guide.addEventListener('click', e => {
    if (e.target !== guide) return;
    const box = guide.getBoundingClientRect();
    if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) guide.close();
  });
  function focusCab(e) { if (e.detail > 0) scene.focus({ preventScroll: true }); }
  for (const { preset, button } of views) button.addEventListener('click', e => { setView(preset); focusCab(e); });
  controls.forEach(button => button.addEventListener('click', e => {
    dispatch(button.dataset.action); focusCab(e);
  }));
  const dutyChoice = byId('duty-select');
  let pickingByPointer = false;
  dutyChoice.addEventListener('pointerdown', () => { pickingByPointer = true; });
  for (const event of ['keydown', 'blur', 'pointercancel']) {
    dutyChoice.addEventListener(event, () => { pickingByPointer = false; });
  }
  dutyChoice.addEventListener('change', () => {
    if (renderer && !document.hidden && !guide.open) {
      const message = R.selectDuty(ride, dutyChoice.value);
      notify(message);
      if (!message && pickingByPointer) scene.focus({ preventScroll: true });
    }
    pickingByPointer = false;
    refreshHUD();
  });
  window.addEventListener('keydown', e => {
    if (document.hidden || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
    if (e.target.closest?.('input') || e.target.closest?.('select')) return;
    const action = R.keyAction(e.code);
    if (!action) return;
    if (action === 'help' || (action === 'dismiss' && guide.open)) {
      e.preventDefault();
      if (!e.repeat) toggleGuide();
      return;
    }
    if (!renderer || guide.open || action === 'dismiss') return;
    // Keep native keyboard activation for controls reached by Tab.
    if (action === 'brake' && (e.target.closest?.('button') || e.target.closest?.('summary'))) return;
    e.preventDefault();
    if (e.repeat && action !== 'faster' && action !== 'slower') return;
    heldKeys.add(e.code);
    if (action === 'left' || action === 'right') { queueFrame(); return; }
    controls.filter(el => el.dataset.action === action).forEach(el => el.classList.add('pressed'));
    dispatch(action);
  });
  window.addEventListener('keyup', e => {
    const action = R.keyAction(e.code);
    if (!heldKeys.delete(e.code)) return;
    if (action === 'left' || action === 'right') { if (lookDirection()) queueFrame(); return; }
    if (![...heldKeys].some(code => R.keyAction(code) === action)) {
      controls.filter(el => el.dataset.action === action).forEach(el => el.classList.remove('pressed'));
    }
  });
  scene.addEventListener('pointerdown', e => {
    if (!renderer || e.button !== 0 || pointer) return;
    scene.focus({ preventScroll: true });
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
    scene.setPointerCapture(e.pointerId);
    scene.classList.add('dragging');
  });
  scene.addEventListener('pointermove', e => {
    if (!pointer || pointer.id !== e.pointerId) return;
    const sensitivity = 2.15 / Math.max(180, scene.clientHeight);
    C.pan(camera, (e.clientX - pointer.x) * sensitivity, (pointer.y - e.clientY) * sensitivity);
    pointer.x = e.clientX; pointer.y = e.clientY;
    viewButtons(); queueFrame();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    scene.addEventListener(name, e => { if (pointer?.id === e.pointerId) releasePointer(); });
  }
  window.addEventListener('blur', releaseInput);
  document.addEventListener('visibilitychange', () => {
    releaseInput(); stopFrames(); syncAudio();
    if (!document.hidden) invalidate();
  });

  function soundLabel() {
    write('sound-label', soundOn ? 'Sound on' : 'Sound off');
    soundButton.setAttribute('aria-pressed', String(soundOn));
    soundButton.setAttribute('aria-label', soundOn ? 'Mute sound' : 'Enable sound');
    icons.draw(soundButton.querySelector('canvas'), soundOn ? 'sound' : 'muted');
  }
  soundButton.addEventListener('click', async e => {
    const revision = ++audioRevision;
    soundOn = !soundOn; soundLabel(); focusCab(e);
    try { await sound.setEnabled(soundOn); }
    catch {
      if (revision !== audioRevision) return;
      soundOn = false; sound.setEnabled(false);
      soundLabel(); notify('Audio is unavailable in this browser.');
    }
    syncAudio();
  });
  fullscreenButton.disabled = !document.documentElement.requestFullscreen || document.fullscreenEnabled === false;
  fullscreenButton.addEventListener('click', async e => {
    focusCab(e);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { notify('Fullscreen is unavailable in this window.'); }
  });
  document.addEventListener('fullscreenchange', () => {
    const label = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen';
    fullscreenButton.setAttribute('aria-label', label); fullscreenButton.title = label;
    icons.draw(fullscreenButton.querySelector('canvas'), document.fullscreenElement ? 'collapse' : 'expand');
    invalidate();
  });

  function availability(message) {
    byId('scene-error').hidden = Boolean(renderer);
    if (message) write('error-detail', message);
    for (const el of [...controls, ...views.map(view => view.button)]) el.disabled = !renderer;
    soundButton.disabled = !renderer || !soundContext;
    if (!soundContext) soundButton.title = 'Audio is unavailable in this browser.';
    refreshHUD(); syncAudio();
  }
  function startRenderer() {
    try {
      renderer = Nightline.renderer.createRenderer(scene);
      availability(); invalidate();
    } catch {
      renderer = null;
      availability('Enable WebGL or hardware acceleration in your browser, then reopen this page.');
    }
  }
  scene.addEventListener('webglcontextlost', e => {
    e.preventDefault(); releaseInput(); stopFrames();
    if (renderer) renderer.cancelPreparation();
    renderer = null;
    availability('The graphics connection was interrupted. Your ride will resume here when it returns.');
  });
  scene.addEventListener('webglcontextrestored', startRenderer);
  const drawIcons = () => document.querySelectorAll('[data-icon]').forEach(el => icons.draw(el));
  window.addEventListener('resize', () => { drawIcons(); invalidate(); });
  if (window.ResizeObserver) new ResizeObserver(invalidate).observe(scene);
  drawIcons();
  startRenderer();
})();
