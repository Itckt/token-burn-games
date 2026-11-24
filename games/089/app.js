'use strict';

(() => {
  const get = id => document.getElementById(id);
  const canvas = get('court');
  const ctx = canvas.getContext('2d');
  const feedback = get('feedback');
  if (!ctx) {
    feedback.textContent = 'The court needs 2D canvas support. Run node simulate.js for the terminal view.';
    return;
  }

  const scene = get('scene');
  const elasticity = get('elasticity');
  const drag = get('drag');
  const seedInput = get('draw-seed');
  const forecastBall = get('forecast-ball');
  const forecastStatus = get('forecast-status');
  const impulseBall = get('impulse-ball');
  const materialSurface = get('material-surface');
  const surfaceValue = get('surface-value');
  const pauseOn = get('pause-on');
  const drawTool = get('draw-tool');
  const speed = get('speed');
  const trails = get('trails');
  const vectors = get('vectors');
  const play = get('toggle-play');
  const meters = {
    time: get('sim-time'), count: get('ball-count'), energy: get('energy'),
    ballHits: get('ball-hits'), wallHits: get('wall-hits'), bumperHits: get('bumper-hits'), railHits: get('rail-hits')
  };
  const energyFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const history = new Map();
  const recentImpacts = [];
  const recentCrossings = [];
  let logChanged = true;
  let customStart;
  let activeSeed = CourtScenes.DEFAULT_SEED;
  let forecast = null;
  let targets = [];
  let stopTarget;
  let world;
  let running = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let frameId = null;
  let previousTime = null;
  let accumulator = 0;
  let ticks = 0;
  let aim = null;

  function rememberPositions() {
    for (const b of world.balls) {
      if (!history.has(b.id)) history.set(b.id, []);
      const points = history.get(b.id);
      points.push({ x: b.x, y: b.y });
      if (points.length > 20) points.shift();
    }
  }

  function updateLogs() {
    for (const log of [recentImpacts, recentCrossings]) {
      if (log.length > 6) log.splice(0, log.length - 6);
    }
    logChanged = true;
  }

  function drawEventLog(id, events, describe) {
    const items = events.slice().sort((a, b) => b.time - a.time).map(event => {
      const item = document.createElement('li');
      const time = document.createElement('span');
      time.textContent = event.time.toFixed(3) + ' s';
      const description = document.createElement('span');
      description.textContent = describe(event);
      item.append(time, description);
      return item;
    });
    get(id).replaceChildren(...items);
  }

  function drawLogs() {
    drawEventLog('impact-log', recentImpacts, CourtReport.describeImpact);
    get('impact-empty').hidden = recentImpacts.length > 0;
    drawEventLog('gate-log', recentCrossings, CourtReport.describeCrossing);
    get('gate-totals').replaceChildren(...world.gates.map(gate => {
      const item = document.createElement('li');
      item.textContent = 'G' + gate.id + ' · ' + gate.counts.forward + ' forward / ' + gate.counts.reverse + ' reverse';
      return item;
    }));
    logChanged = false;
  }

  function tick(watchImpacts = false) {
    clearForecast();
    const previousCount = recentImpacts.length;
    const previousCrossings = recentCrossings.length;
    const hit = world.step(CourtPhysics.TICK, {
      impacts: recentImpacts, crossings: recentCrossings, stopOn: watchImpacts ? stopTarget?.matches : undefined
    });
    if (recentImpacts.length !== previousCount || recentCrossings.length !== previousCrossings) updateLogs();
    ticks++;
    if (trails.checked && ticks % 4 === 0) rememberPositions();
    if (hit) {
      setRunning(false, false);
      clearAim();
      get('impact-panel').open = true;
      reportStop(hit);
    }
  }

  function requestFrame() {
    if (frameId === null && !document.hidden) frameId = window.requestAnimationFrame(frame);
  }

  function frame(timestamp) {
    frameId = null;
    if (document.hidden) return;
    if (running && previousTime !== null) {
      const elapsed = Math.min(0.1, Math.max(0, (timestamp - previousTime) / 1000));
      accumulator += elapsed * Number(speed.value);
      while (running && accumulator + 1e-12 >= CourtPhysics.TICK) {
        tick(true);
        accumulator = Math.max(0, accumulator - CourtPhysics.TICK);
      }
    }
    previousTime = running ? timestamp : null;
    CourtView.draw(ctx, world, history, vectors.checked, aim, Math.min(window.devicePixelRatio || 1, 3), forecast);
    meters.time.textContent = world.time.toFixed(3) + ' s';
    meters.count.textContent = String(world.balls.length);
    meters.energy.textContent = energyFormat.format(world.kineticEnergy);
    meters.ballHits.textContent = String(world.ballHits);
    meters.wallHits.textContent = String(world.wallHits);
    meters.bumperHits.textContent = String(world.bumperHits);
    meters.railHits.textContent = String(world.railHits);
    if (logChanged) drawLogs();
    if (running) requestFrame();
  }

  function setRunning(value, redraw = true) {
    if (value) clearForecast();
    running = value;
    previousTime = null;
    accumulator = 0;
    play.dataset.running = String(value);
    get('play-label').textContent = value ? 'Pause' : 'Play';
    const status = get('run-state');
    status.dataset.running = String(value);
    status.textContent = value ? 'Running' : 'Paused';
    if (redraw) requestFrame();
  }

  function singleStep() {
    setRunning(false);
    tick();
  }

  function reportStop(event) {
    feedback.textContent = 'Paused at ' + event.time.toFixed(3) + ' s. ' + CourtReport.describeImpact(event) + '.';
  }

  function nextImpact() {
    setRunning(false);
    clearAim();
    clearForecast();
    const impacts = world.nextImpact(recentCrossings);
    get('impact-panel').open = true;
    if (impacts.length) {
      for (const event of impacts) recentImpacts.push(event);
      updateLogs();
      if (trails.checked) rememberPositions();
      reportStop(impacts[0]);
    } else {
      if (world.balls.every(b => !b.vx && !b.vy)) feedback.textContent = 'All balls are at rest.';
      else if (world.drag) feedback.textContent = 'The remaining drift reaches no impact within the simulation clock.';
      else feedback.textContent = 'The next impact is beyond the simulation clock’s range.';
    }
  }

  function clearAim() {
    if (!aim) return;
    const id = aim.pointerId;
    aim = null;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }

  function clearForecast() {
    if (!forecast) return;
    forecast = null;
    forecastStatus.textContent = '';
    get('clear-forecast').disabled = true;
  }

  function option(value, name) {
    const item = document.createElement('option');
    item.value = value;
    item.textContent = name;
    return item;
  }

  function fillBallChoices(select, buttonId) {
    const selected = Number(select.value);
    select.replaceChildren(...world.balls.map(b => option(String(b.id), 'Ball ' + b.id)));
    select.value = world.balls.length ? String(world.balls[selected - 1]?.id ?? 1) : '';
    select.disabled = get(buttonId).disabled = world.balls.length === 0;
  }

  function showSurfaceValue() {
    const value = world.surfaceRestitution[materialSurface.value];
    surfaceValue.value = value === undefined ? '' : String(value);
    surfaceValue.placeholder = 'Court (' + world.restitution + ')';
    get('surface-status').textContent = '';
  }

  function updateBodyChoices(keepTarget = true) {
    clearForecast();
    fillBallChoices(forecastBall, 'predict-path');
    fillBallChoices(impulseBall, 'apply-impulse');
    forecastStatus.textContent = world.balls.length ? '' : 'Add a ball to forecast its path.';
    targets = CourtReport.impactTargets(world);
    stopTarget = keepTarget ? targets.find(t => t.value === pauseOn.value) : undefined;
    pauseOn.replaceChildren(option('', 'Never'), ...targets.map(t => option(t.value, t.label)));
    pauseOn.value = stopTarget?.value ?? '';
    get('rail-reading').hidden = world.rails.length === 0;
    get('gate-panel').hidden = world.gates.length === 0;
    const selected = materialSurface.value;
    const surfaces = targets.filter(t => t.fixed);
    materialSurface.replaceChildren(...surfaces.map(t => option(t.value, t.label)));
    materialSurface.value = surfaces.some(t => t.value === selected) ? selected : surfaces[0].value;
    showSurfaceValue();
  }

  function setSlider(slider, value) {
    // Imported values can fall between the ordinary 0.05 stops.
    slider.step = Number.isInteger(value * 20) ? '0.05' : 'any';
    slider.value = String(value);
  }

  function showWorld(keepTarget = false) {
    clearAim();
    const preset = CourtScenes.scenes[scene.value];
    const isDraw = scene.value === CourtScenes.DRAW_SCENE;
    get('scene-name').textContent = isDraw ? preset.name + ' · seed ' + activeSeed : preset?.name ?? 'Imported court';
    get('scene-description').textContent = preset?.description ?? 'Reset returns the balls to their imported positions.';
    get('seed-controls').hidden = !isDraw;
    if (isDraw) seedInput.value = String(activeSeed);
    drag.max = String(Math.max(2, world.drag));
    setSlider(drag, world.drag);
    setSlider(elasticity, world.restitution);
    get('drag-value').textContent = world.drag + ' /s';
    get('elasticity-value').textContent = world.restitution.toFixed(2);
    updateBodyChoices(keepTarget);
    get('dimensions').textContent = world.width + ' × ' + world.height + ' u';
    get('surface').style.aspectRatio = world.width + ' / ' + world.height;
    get('bumper-reading').hidden = world.bumpers.length === 0;
    feedback.textContent = '';
    get('impulse-status').textContent = '';
    recentImpacts.length = 0;
    recentCrossings.length = 0;
    logChanged = true;
    history.clear();
    if (trails.checked) rememberPositions();
    previousTime = null;
    accumulator = 0;
    ticks = 0;
    requestFrame();
  }

  function loadScene(keepTarget = false) {
    const value = Number(elasticity.value);
    const dragValue = Number(drag.value);
    if (scene.value === 'custom') {
      world = CourtPhysics.World.fromSnapshot(customStart);
      world.resetMeasurements();
      world.restitution = value;
      world.drag = dragValue;
    } else {
      world = CourtScenes.createScene(scene.value, value, { drag: dragValue, seed: activeSeed });
    }
    showWorld(keepTarget);
  }

  const checkpointText = get('checkpoint-json');
  const checkpointStatus = get('checkpoint-status');
  get('capture-checkpoint').addEventListener('click', () => {
    checkpointText.value = JSON.stringify(CourtScenes.checkpoint({ scene: scene.value, world, seed: activeSeed }), null, 2);
    checkpointStatus.textContent = 'Captured at ' + world.time.toFixed(3) + ' s.';
  });
  get('restore-checkpoint').addEventListener('click', () => {
    let run;
    try {
      run = CourtScenes.readCheckpoint(checkpointText.value);
    } catch (error) {
      checkpointStatus.textContent = error.message;
      return;
    }
    if (run.scene === 'custom') {
      if (!customStart) scene.append(option('custom', 'Imported court'));
      customStart = run.world.snapshot();
    }
    scene.value = run.scene;
    world = run.world;
    if (run.seed !== undefined) activeSeed = run.seed;
    setRunning(false);
    showWorld();
    checkpointStatus.textContent = 'Restored at ' + world.time.toFixed(3) + ' s.';
  });

  function point(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: (event.clientX - rect.left) / rect.width * world.width,
      y: (event.clientY - rect.top) / rect.height * world.height
    };
  }

  function aimAt(event) {
    const end = point(event);
    if (!end) return false;
    if (aim.tool === 'rail' || aim.tool === 'gate') {
      aim.x2 = end.x;
      aim.y2 = end.y;
      return true;
    }
    const dx = end.x - aim.x;
    const dy = end.y - aim.y;
    const distance = Math.hypot(dx, dy);
    const scale = distance > 160 ? 480 / distance : 3;
    aim.vx = dx * scale;
    aim.vy = dy * scale;
    return true;
  }

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || aim) return;
    const start = point(event);
    if (!start) return;
    const { x, y } = start;
    const tool = drawTool.value || 'ball';
    if (tool === 'gate') {
      if (x < 0 || x > world.width || y < 0 || y > world.height) return;
    } else if (!world.canPlace(x, y, tool === 'rail' ? 8 : 20)) {
      feedback.textContent = 'Choose a clear spot with room inside the edge.';
      return;
    }
    aim = tool === 'ball' ? { tool, x, y, radius: 20, vx: 0, vy: 0, pointerId: event.pointerId }
      : { tool, x1: x, y1: y, x2: x, y2: y, pointerId: event.pointerId };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
    feedback.textContent = '';
    requestFrame();
  });
  canvas.addEventListener('pointermove', event => {
    if (!aim || aim.pointerId !== event.pointerId) return;
    aimAt(event);
    requestFrame();
  });
  canvas.addEventListener('pointerup', event => {
    if (!aim || aim.pointerId !== event.pointerId) return;
    const visible = aimAt(event);
    if (!visible) {
      feedback.textContent = 'Placement cancelled while the court was hidden.';
    } else if (aim.tool === 'gate') {
      if (world.canPlaceGate(aim)) {
        const gate = world.addGate(aim);
        get('gate-panel').hidden = false;
        get('gate-panel').open = true;
        logChanged = true;
        feedback.textContent = 'Timing gate G' + gate.id + ' placed.';
      } else {
        feedback.textContent = 'Drag between two distinct points inside the court to place a timing gate.';
      }
    } else if (aim.tool === 'rail') {
      if (world.canPlaceRail(aim)) {
        const rail = world.addRail(aim);
        updateBodyChoices();
        feedback.textContent = 'Rail R' + rail.id + ' placed.';
      } else {
        feedback.textContent = 'Drag between two distinct points along a clear path inside the court.';
      }
    } else if (world.canPlace(aim.x, aim.y, aim.radius)) {
      const b = world.addBall(aim);
      updateBodyChoices();
      feedback.textContent = 'Ball ' + b.id + (aim.vx || aim.vy ? ' launched.' : ' placed.');
    } else {
      feedback.textContent = 'Another ball moved into that spot. Choose a clear spot to launch.';
    }
    clearAim();
    requestFrame();
  });
  for (const type of ['pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(type, event => {
      if (!aim || aim.pointerId !== event.pointerId) return;
      clearAim();
      requestFrame();
    });
  }

  for (const [key, preset] of Object.entries(CourtScenes.scenes)) scene.append(option(key, preset.name));
  scene.value = 'kowloon-six';
  scene.addEventListener('change', () => loadScene());
  pauseOn.addEventListener('change', () => {
    stopTarget = targets.find(t => t.value === pauseOn.value);
  });
  drawTool.addEventListener('change', () => {
    clearAim();
    const hints = {
      rail: 'Drag between two clear points to place a fixed, round-ended rail.',
      gate: 'Drag between two points to time passing ball centers. The arrow marks the forward direction.',
      ball: 'Click an empty spot to place a ball. Drag in the direction of travel to launch it.'
    };
    get('tool-hint').textContent = hints[drawTool.value];
    feedback.textContent = '';
    requestFrame();
  });
  get('deal-court').addEventListener('click', () => {
    try {
      activeSeed = CourtScenes.readSeed(seedInput.value);
    } catch (error) {
      feedback.textContent = error.message;
      return;
    }
    loadScene();
  });
  get('reset').addEventListener('click', () => loadScene(true));
  play.addEventListener('click', () => setRunning(!running));
  get('single-step').addEventListener('click', singleStep);
  get('next-impact').addEventListener('click', nextImpact);
  get('apply-impulse').addEventListener('click', () => {
    const components = [get('impulse-x'), get('impulse-y')].map(input => input.value.trim() ? Number(input.value) : NaN);
    const status = get('impulse-status');
    try {
      const ball = world.applyImpulse(Number(impulseBall.value), ...components);
      status.textContent = 'Ball ' + ball.id + ' velocity (' + ball.vx.toFixed(2) + ', ' + ball.vy.toFixed(2) + ') u/s.';
    } catch (error) {
      status.textContent = error.message;
      return;
    }
    setRunning(false);
    clearAim();
    clearForecast();
  });
  materialSurface.addEventListener('change', showSurfaceValue);
  get('apply-surface').addEventListener('click', () => {
    const value = surfaceValue.value.trim();
    const status = get('surface-status');
    try {
      if (surfaceValue.validity?.badInput) throw new RangeError('Enter a number from 0 to 1.');
      world.setSurfaceRestitution(materialSurface.value, value ? Number(value) : null);
    } catch (error) {
      status.textContent = error.message;
      return;
    }
    clearForecast();
    showSurfaceValue();
    status.textContent = value ? 'Surface elasticity set to ' + surfaceValue.value + '.' : 'Using the court elasticity.';
    requestFrame();
  });
  get('predict-path').addEventListener('click', () => {
    if (!forecastBall.value) return;
    setRunning(false);
    clearAim();
    forecast = world.forecast(Number(forecastBall.value));
    forecastStatus.textContent = CourtReport.describeForecast(forecast);
    get('clear-forecast').disabled = false;
  });
  get('clear-forecast').addEventListener('click', () => {
    clearForecast();
    requestFrame();
  });
  forecastBall.addEventListener('change', () => {
    clearForecast();
    requestFrame();
  });
  get('add-ball').addEventListener('click', () => {
    const b = CourtScenes.addFreeBall(world);
    if (b) updateBodyChoices();
    feedback.textContent = b ? 'Ball ' + b.id + ' added.' : 'No clear spot found for another ball.';
    requestFrame();
  });
  elasticity.addEventListener('input', () => {
    clearForecast();
    world.restitution = Number(elasticity.value);
    surfaceValue.placeholder = 'Court (' + world.restitution + ')';
    get('elasticity-value').textContent = world.restitution.toFixed(2);
    requestFrame();
  });
  drag.addEventListener('input', () => {
    clearForecast();
    world.drag = Number(drag.value);
    get('drag-value').textContent = world.drag + ' /s';
    requestFrame();
  });
  speed.addEventListener('input', () => {
    get('speed-value').textContent = Number(speed.value) + '×';
    previousTime = null;
    requestFrame();
  });
  trails.addEventListener('change', () => {
    history.clear();
    if (trails.checked) rememberPositions();
    requestFrame();
  });
  vectors.addEventListener('change', requestFrame);
  document.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey ||
        event.target.isContentEditable ||
        ['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA', 'SUMMARY', 'A'].includes(event.target.tagName)) return;
    if (event.key === ' ') {
      event.preventDefault();
      setRunning(!running);
    } else if (event.key === '.') {
      event.preventDefault();
      singleStep();
    }
  });
  window.addEventListener('resize', requestFrame);
  document.addEventListener('visibilitychange', () => {
    previousTime = null;
    accumulator = 0;
    requestFrame();
  });
  loadScene();
  setRunning(running);
})();
