(function () {
  'use strict';
  const {campus, sim, weather, FieldGuide, FieldCamera, studies, postcard, soundscape, render} = globalThis.Atlas;
  const byId = id => document.getElementById(id);
  const canvas = byId('campus'), guide = byId('guide-dialog'), help = byId('help-dialog');
  const places = campus.places, state = sim.makeState(places[0].view);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarsePointer = window.matchMedia('(pointer: coarse)');
  const movement = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
  const keys = new Set(), keyboard = new Set(), pad = new Map();
  let world, renderer, fieldGuide;
  let current = places[0], bearing = -1;
  let walking = false, hadLock = false, drag = null, toastTimer;
  let frameId = null, previousTime = null, lastHud = -Infinity, dirty = true, hudPending = false;
  let blurred = false;
  const camera = new FieldCamera(document, {stop:stopWalking, expose, invalidate, notify:toast,
    record:(place, sheet, frame)=>fieldGuide.sections.record(place,sheet,frame)});
  const panels = [guide, help, camera.review];
  const sound = new soundscape.Soundscape(window.AudioContext || window.webkitAudioContext, message => {
    byId('sound').setAttribute('aria-pressed',String(sound.enabled));
    if (message) toast(message);
    invalidate();
  });
  const openDialog = () => panels.find(dialog => dialog.open);

  function toast(words) {
    const el = byId('toast');
    clearTimeout(toastTimer);
    el.textContent = words;
    el.classList.add('visible');
    toastTimer = setTimeout(() => el.classList.remove('visible'), 2600);
  }
  function placeNumber(place) {
    return String(places.indexOf(place) + 1).padStart(2, '0');
  }
  function placeNote(place) {
    if (state.weather.shower) return place.showerNote;
    return state.night && place.nightNote ? place.nightNote : place.note;
  }
  function currentPlace() {
    return sim.nearest(state,places,current.id,world.surfaces);
  }
  function updateHud(force) {
    const place = currentPlace();
    if (force || place !== current) {
      current = place;
      byId('place-title').textContent = place.name;
      byId('place-note').textContent = placeNote(place);
      byId('place-index').textContent = placeNumber(place) + ' / ' + String(places.length).padStart(2, '0');
    }
    const heading = sim.bearing(state.yaw);
    if (force || heading.degrees !== bearing) {
      bearing = heading.degrees;
      byId('bearing').textContent = String(bearing).padStart(3, '0') + '°';
      byId('direction').textContent = heading.label;
      byId('needle').style.transform = 'rotate(' + -bearing + 'deg)';
    }
    byId('cover').hidden = !state.weather.shower || !weather.coverAt(state.x, state.z, world.shelters);
    const lookout=studies.atLookout(state,world), prompt=byId('lookout-camera');
    prompt.hidden=!lookout;
    if (lookout) prompt.setAttribute('aria-label','Frame '+lookout.study.name+' with the field camera');
    fieldGuide.update(current.id);
  }
  function schedule() {
    if (frameId === null && renderer && !document.hidden) frameId = requestAnimationFrame(frame);
  }
  function invalidate() {
    dirty = true;
    sound.setPaused(blurred || document.hidden || !renderer || !!openDialog());
    schedule();
  }
  function cancelFrame() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    previousTime = null;
  }
  function frame(time) {
    frameId = null;
    if (previousTime !== null && time <= previousTime) {
      previousTime = time;
      schedule();
      return;
    }
    const dt = previousTime === null ? 1 / 60 : (time - previousTime) / 1000;
    const prevX=state.x, prevZ=state.z;
    const cameraChanged = sim.step(state, keys, dt, world, reducedMotion.matches, camera.zoom);
    const weatherChanged = weather.step(state.weather, dt, reducedMotion.matches, blurred || !!openDialog());
    const changed = cameraChanged || weatherChanged;
    hudPending = hudPending || cameraChanged || dirty;
    try {
      if (dirty || changed) {
        if (changed && previousTime !== null) renderer.measureFrame(dt);
        renderer.draw(state, camera.zoom);
        if (camera.active && !camera.review.open) camera.showStudy(studies.assess(state,world,camera.zoom,renderer.aspect));
      }
      sound.update(state,world,Math.hypot(state.x-prevX,state.z-prevZ),keys.has('ShiftLeft') || keys.has('ShiftRight'));
      if (hudPending && (dirty || !cameraChanged || time - lastHud >= 50)) {
        updateHud(dirty);
        hudPending = false;
        lastHud = time;
      }
    } catch (error) {
      displayFailure('The campus view was interrupted',
        'The browser could not finish drawing the scene. Try rebuilding the view.', error);
      return;
    }
    previousTime = time;
    dirty = false;
    if (changed) schedule();
    else previousTime = null;
  }

  function readKeys() {
    keys.clear();
    for (const code of keyboard) keys.add(code);
    for (const code of pad.values()) keys.add(code);
    schedule();
  }
  function releaseDrag() {
    const id = drag?.id;
    drag = null;
    if (id !== undefined && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  function stopWalking() {
    walking = false;
    hadLock = false;
    keyboard.clear();
    pad.clear();
    keys.clear();
    releaseDrag();
    state.vx = state.vz = state.bob = 0;
    state.aimYaw = state.yaw;
    state.aimPitch = state.pitch;
    document.body.classList.remove('is-walking');
    byId('walk-label').textContent = 'Start walking';
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    invalidate();
  }
  function dragHint() {
    if (walking && !document.pointerLockElement) toast('Drag the view or use the arrow keys to look.');
  }
  function startWalking() {
    if (!renderer || openDialog() || camera.active || walking) return;
    walking = true;
    canvas.focus({preventScroll: true});
    document.body.classList.add('is-walking');
    byId('walk-label').textContent = 'Stop walking';
    if (!coarsePointer.matches) {
      if (canvas.requestPointerLock) {
        try {
          const pending = canvas.requestPointerLock();
          if (pending) pending.catch(dragHint);
        } catch { dragHint(); }
      } else dragHint();
    }
    invalidate();
  }
  function setNight(value) {
    state.night = value;
    document.body.classList.toggle('night', value);
    byId('day').setAttribute('aria-pressed', String(!value));
    byId('night').setAttribute('aria-pressed', String(value));
    invalidate();
  }
  function toggleShower() {
    state.weather.shower = !state.weather.shower;
    byId('weather').setAttribute('aria-pressed', String(state.weather.shower));
    invalidate();
  }
  function toggleCamera() {
    if (!renderer || openDialog()) return;
    if (camera.active) camera.leave();
    else camera.enter();
  }
  function expose(zoom) {
    if (!renderer) return;
    try {
      renderer.draw(state,zoom);
      const study=studies.assess(state,world,zoom,renderer.aspect);
      const lookout=study?.ready ? study.place : null;
      return postcard.caption(lookout || currentPlace(),state,zoom,lookout);
    } catch (error) {
      displayFailure('The campus view was interrupted','The browser could not draw this view. Try rebuilding the scene.',error);
    }
  }
  function openPanel(dialog) {
    if (openDialog() || (dialog === guide && !renderer)) return;
    if (camera.active) camera.leave();
    else stopWalking();
    if (dialog === guide) fieldGuide.open(currentPlace());
    else dialog.showModal();
    invalidate();
  }
  function setPlace(place) {
    current = place;
    sim.setView(state, place.view);
  }
  for (const dialog of panels) {
    dialog.addEventListener('close', invalidate);
    dialog.querySelector('.close-button').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientY < r.top ||
          event.clientX > r.right || event.clientY > r.bottom) dialog.close();
    });
  }
  byId('walk').addEventListener('click', () => walking ? stopWalking() : startWalking());
  byId('day').addEventListener('click', () => setNight(false));
  byId('night').addEventListener('click', () => setNight(true));
  byId('weather').addEventListener('click', toggleShower);
  byId('sound').addEventListener('click', () => sound.setEnabled(!sound.enabled));
  byId('camera').addEventListener('click', toggleCamera);
  byId('lookout-camera').addEventListener('click', toggleCamera);
  byId('help').addEventListener('click', () => openPanel(help));
  for (const id of ['guide', 'mini-map-button']) byId(id).addEventListener('click', () => openPanel(guide));
  byId('reset').addEventListener('click', () => {
    if (camera.active) camera.leave();
    else stopWalking();
    fieldGuide.clearRoute();
    current = places[0];
    sim.setView(state, current.view);
    toast('Back at Banyan Court');
  });

  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing || e.defaultPrevented) return;
    const panel = openDialog();
    if (panel) {
      if (e.key === 'Escape' || (panel === guide && e.code === 'KeyM') ||
          (panel === help && e.key === '?')) {
        e.preventDefault();
        if (!e.repeat) panel.close();
      }
      return;
    }
    if (e.key === '?') {
      e.preventDefault();
      if (!e.repeat) openPanel(help);
      return;
    }
    if (!renderer) return;
    if (movement.has(e.code)) {
      if (camera.active && !e.code.startsWith('Arrow')) return;
      // Shift still participates in normal keyboard focus traversal.
      if (!e.code.startsWith('Shift')) e.preventDefault();
      if (!keyboard.has(e.code)) {
        keyboard.add(e.code);
        readKeys();
      }
      return;
    }
    if (e.repeat) return;
    const sceneFocus = e.target === canvas || e.target === document.body || e.target === document.documentElement;
    if (e.code === 'KeyC') toggleCamera();
    else if (e.code === 'KeyV') sound.setEnabled(!sound.enabled);
    else if (e.code === 'KeyN') setNight(!state.night);
    else if (e.code === 'KeyR') toggleShower();
    else if (camera.active) {
      if (!camera.shortcut(e,sceneFocus)) return;
    } else if (e.code === 'KeyE') fieldGuide.collect();
    else if (e.code === 'KeyF') fieldGuide.advance();
    else if (e.code === 'KeyX') fieldGuide.cancel();
    else if (e.code === 'KeyM') openPanel(guide);
    else if (e.key === 'Escape') stopWalking();
    else if (e.key === 'Enter' && sceneFocus) {
      walking ? stopWalking() : startWalking();
    } else return;
    e.preventDefault();
  });
  document.addEventListener('keyup', e => {
    if (keyboard.delete(e.code)) readKeys();
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) {
      releaseDrag();
      if (!walking) document.exitPointerLock();
      else hadLock = true;
    } else if (hadLock) stopWalking();
  });
  document.addEventListener('pointerlockerror', dragHint);
  document.addEventListener('mousemove', e => {
    if (document.pointerLockElement === canvas && walking) {
      sim.look(state, e.movementX, e.movementY);
      schedule();
    }
  });
  canvas.addEventListener('pointerdown', e => {
    if (!renderer || openDialog() || drag || document.pointerLockElement === canvas || e.button !== 0) return;
    e.preventDefault();
    canvas.focus({preventScroll: true});
    drag = {id: e.pointerId, x: e.clientX, y: e.clientY};
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    sim.look(state, e.clientX - drag.x, e.clientY - drag.y, (e.pointerType === 'touch' ? 0.005 : 0.003)/camera.zoom);
    drag.x = e.clientX;
    drag.y = e.clientY;
    schedule();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, e => { if (drag?.id === e.pointerId) releaseDrag(); });
  }
  for (const button of byId('touch-pad').querySelectorAll('button')) {
    button.addEventListener('pointerdown', e => {
      if (!walking) return;
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      pad.set(e.pointerId, button.dataset.key);
      readKeys();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, e => { if (pad.delete(e.pointerId)) readKeys(); });
    }
  }
  window.addEventListener('blur', () => { blurred = true; stopWalking(); });
  window.addEventListener('focus', () => { blurred = false; invalidate(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopWalking(); cancelFrame(); }
    else invalidate();
  });
  window.addEventListener('resize', invalidate);
  reducedMotion.addEventListener('change', invalidate);

  function available(value) {
    byId('unavailable').hidden = value;
    byId('retry').hidden = false;
    document.body.classList.toggle('unavailable', !value);
    for (const id of ['day', 'night', 'weather', 'walk', 'reset', 'guide', 'mini-map-button','camera']) byId(id).disabled = !value;
    byId('sound').disabled = !value || !sound.Context;
    if (!sound.Context) byId('sound').title = 'Campus sound is unavailable in this browser';
  }
  function displayFailure(title, words, error) {
    renderer?.dispose();
    renderer = null;
    if (camera.active) camera.leave();
    stopWalking();
    cancelFrame();
    if (guide.open) guide.close();
    available(false);
    byId('error-title').textContent = title;
    byId('error-message').textContent = words;
    if (error) console.error(title, error);
  }
  function initialize() {
    try {
      const options = {alpha: false, antialias: true, depth: true, stencil: false};
      const gl = canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options);
      if (!gl) {
        displayFailure('WebGL is unavailable', 'This campus needs WebGL to draw its 3D view. Enable graphics acceleration in your browser or open index.html in another WebGL-capable browser.');
        return;
      }
      if (gl.isContextLost()) {
        graphicsPaused();
        return;
      }
      if (!world) world = campus.create();
      if (!fieldGuide) fieldGuide = new FieldGuide(document, world, state, {
        walk: startWalking, travel(place) { setPlace(place); startWalking(); },
        frame(place) { setPlace(place); camera.enter(); }, notify: toast, invalidate
      });
      renderer = new render.Renderer(canvas, world, gl);
      available(true);
      invalidate();
    } catch (error) {
      displayFailure('The 3D view could not start',
        'The browser could not prepare the campus graphics. Try again or use a browser with WebGL enabled.', error);
    }
  }
  function graphicsPaused() {
    displayFailure('Graphics paused', 'The graphics context was interrupted. Your walk will resume here when the browser restores it.');
    byId('retry').hidden = true;
  }
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    graphicsPaused();
  });
  canvas.addEventListener('webglcontextrestored', initialize);
  byId('retry').addEventListener('click', initialize);
  initialize();
})();
