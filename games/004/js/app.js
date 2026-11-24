(function () {
  'use strict';
  const F=HarbourFlight, C=HarbourCity;
  const presets = {weather: HarbourWeather, lighting: HarbourAtmosphere.lighting};
  const byId=id=>document.getElementById(id);
  const canvas=byId('harbour'), timeline=byId('timeline');
  const chartCanvas = byId('chart'), chart = new HarbourChart.Chart(chartCanvas);
  const postcard = HarbourPostcard.create(invalidate);
  const lookoutControl = byId('lookout'), lookoutCall = byId('lookout-call');
  const chartCaption = byId('chart-caption');
  const lookoutNames = new Map(Array.from(lookoutControl.options, option => [option.value, option.label]));
  const eventButton = byId('next-event'), eventLabel = byId('event-label');
  const routeButtons=[...document.querySelectorAll('[data-route]')];
  const speedButtons=[...document.querySelectorAll('[data-speed]')];
  const renderControls = [...routeButtons, ...speedButtons, byId('play'), timeline, byId('regenerate'), byId('postcard'),
    ...Object.keys(presets).map(byId), lookoutControl, eventButton, byId('glass')];
  const state=F.createFlight(matchMedia('(prefers-reduced-motion: reduce)').matches);
  const locationSeed=()=>C.readSeed(location.search,location.hash);
  let city=C.generateCity(locationSeed());
  let renderer, request=0, lastStamp=null, lastReadout=-Infinity, dirty=true;
  let quality=1, measuredTime=0, measuredFrames=0, lastSize=[0,0];
  let pointer = null, scrub = null, chartPointer = null;
  const held=new Set();

  function buildCharts() {
    chart.setCity(city);
    byId('regenerate').title = 'Generate a new skyline (G) · Current seed ' + city.seed;
  }
  function updateReadout(shot) {
    const duration=F.routes[state.route].duration;
    const progress=state.time/duration;
    if (!scrub) timeline.value=Math.round(progress*1000);
    timeline.style.setProperty('--progress',(progress*100)+'%');
    const elapsed=F.formatTime(state.time);
    if (byId('elapsed').textContent!==elapsed) byId('elapsed').textContent=elapsed;
    timeline.setAttribute('aria-valuetext',elapsed+' of '+F.formatTime(duration));
    byId('duration').textContent=F.formatTime(duration);
    chart.draw(state, shot, canvas.width / canvas.height);
    if (chartPointer) updateChartCaption();
    const call = HarbourLookouts.call(state.lookout, state.worldTime);
    lookoutCall.hidden = !call;
    if (lookoutCall.textContent !== call) lookoutCall.textContent = call;
    const next = F.nextEvent(state);
    eventButton.hidden = !next;
    if (next && eventLabel.textContent !== next.action) eventLabel.textContent = next.action;
  }
  function updateButtons() {
    const onDeck = F.routes[state.route].onDeck;
    const transport = onDeck ? 'crossing' : 'flight';
    const playback = (state.playing ? 'Pause ' : 'Resume ') + transport;
    document.body.classList.toggle('paused',!state.playing);
    byId('play-label').textContent = playback;
    byId('play').title = playback + ' (Space)';
    byId('flight-label').textContent = state.playing ? (onDeck ? 'ON DECK' : 'IN FLIGHT') : 'PAUSED';
    timeline.setAttribute('aria-label', onDeck ? 'Ferry crossing and harbour time' : 'Camera route position');
    timeline.title = onDeck ? 'Seek the ferry and harbour together' : 'Seek the camera route';
    byId('deck-time').hidden = !onDeck;
    const setActive=(button,active)=>{
      button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active));
    };
    routeButtons.forEach((button,i)=>setActive(button,state.route===i));
    speedButtons.forEach(button=>setActive(button,Number(button.dataset.speed)===state.speed));
    for (const name of Object.keys(presets)) byId(name).value = state[name].id;
    lookoutControl.value = state.lookout;
    updateGlass();
    HarbourChart.routeIcons(routeButtons, state.route); updateReadout(F.camera(state)); invalidate();
  }
  function choose(index) {
    if (F.chooseRoute(state,index)) {
      scrub = null;
      updateButtons();
    }
  }
  function choosePreset(name, id) {
    if (presets[name].select(state[name], id, state.playing && !state.reduced)) {
      byId(name).value = id;
      invalidate();
    }
  }
  function cyclePreset(name) {
    choosePreset(name, nextChoice(Object.keys(presets[name].profiles), state[name].id));
  }
  function chooseLookout(id) {
    if (F.chooseLookout(state, id)) {
      lookoutControl.value = id;
      lookoutCall.setAttribute('aria-live', id === 'landing' || id === 'timehouse' ? 'off' : 'polite');
      invalidate();
    }
  }
  function jumpToEvent() {
    if (F.jumpToEvent(state)) {
      lastStamp = null;
      invalidate();
    }
  }
  function nextChoice(choices, current) {
    return choices[(choices.indexOf(current) + 1) % choices.length];
  }
  function updateGlass() {
    byId('glass-power').textContent = state.glass + '×';
    byId('glass').setAttribute('aria-label', 'Spotting glass, ' + state.glass + '×. Change magnification');
    document.body.classList.toggle('magnified', state.glass > 1);
  }
  function changeGlass() {
    F.cycleGlass(state);
    updateGlass();
    invalidate();
  }
  function updateChartCaption() {
    const id = chartPointer && chart.pick(chartPointer.x, chartPointer.y);
    const caption = lookoutNames.get(id) || 'Harbour chart';
    if (chartCaption.textContent !== caption) chartCaption.textContent = caption;
  }
  function togglePlay() { state.playing=!state.playing; updateButtons(); }
  function resetLook() { state.targetYaw=state.targetPitch=0; invalidate(); }
  function takePostcard() {
    if (!renderer || !postcard.available || postcard.open) return;
    stop();
    try {
      adjustSize();
      // Copy immediately after drawing. WebGL may discard the frame after compositing.
      drawHarbour(F.camera(state));
    } catch (error) { renderFailure(error); return; }
    postcard.show(canvas, F.routes[state.route].name, F.formatTime(state.time), city.seed);
  }
  byId('postcard').addEventListener('click', takePostcard);
  if (!postcard.available) byId('postcard').hidden = byId('postcard-hint').hidden = true;
  routeButtons.forEach((button,i)=>button.addEventListener('click',()=>choose(i)));
  speedButtons.forEach(button=>button.addEventListener('click',()=>{state.speed=Number(button.dataset.speed); updateButtons();}));
  byId('play').addEventListener('click',togglePlay);
  for (const name of Object.keys(presets)) {
    const control = byId(name);
    control.addEventListener('change', () => choosePreset(name, control.value));
  }
  lookoutControl.addEventListener('change', () => chooseLookout(lookoutControl.value));
  byId('glass').addEventListener('click', changeGlass);
  chartCanvas.addEventListener('click', event => {
    if (!renderer) return;
    const id = chart.pick(event.clientX, event.clientY);
    if (id) chooseLookout(id);
  });
  chartCanvas.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || !renderer) return;
    chartPointer = {x:event.clientX, y:event.clientY};
    updateChartCaption();
  });
  chartCanvas.addEventListener('pointerleave', () => {
    chartPointer = null;
    updateChartCaption();
  });
  eventButton.addEventListener('click', jumpToEvent);
  timeline.addEventListener('input', () => {
    F.seek(state, Number(timeline.value) / 1000, scrub?.crossingStart);
    invalidate();
    updateReadout(F.camera(state));
  });
  timeline.addEventListener('pointerdown', event => {
    if (scrub || event.button !== 0) return;
    scrub = {id: event.pointerId, crossingStart: state.worldTime - state.time};
  });
  function finishScrub(event) {
    if (scrub && scrub.id === event.pointerId) {
      scrub = null;
      invalidate();
    }
  }
  window.addEventListener('pointerup', finishScrub);
  window.addEventListener('pointercancel', finishScrub);
  timeline.addEventListener('lostpointercapture', finishScrub);
  canvas.addEventListener('pointerdown',event=>{
    if (event.button!==0 || pointer || !renderer) return;
    pointer={id:event.pointerId,x:event.clientX,y:event.clientY};
    canvas.setPointerCapture(event.pointerId); canvas.focus({preventScroll:true});
  });
  canvas.addEventListener('pointermove',event=>{
    if (!pointer || pointer.id!==event.pointerId) return;
    F.look(state,(pointer.x-event.clientX)*0.0024,(event.clientY-pointer.y)*0.0024);
    pointer.x=event.clientX; pointer.y=event.clientY; invalidate();
  });
  function finishDrag(event) {
    if (pointer && pointer.id === event.pointerId) pointer=null;
  }
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, finishDrag);
  canvas.addEventListener('dblclick',resetLook);
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_) { byId('fullscreen').title='Fullscreen is unavailable in this window'; }
  }
  byId('fullscreen').addEventListener('click',fullscreen);
  if (!document.documentElement.requestFullscreen) {
    byId('fullscreen').hidden=true;
    byId('fullscreen-hint').hidden=true;
  }
  document.addEventListener('fullscreenchange',()=>{
    const on=!!document.fullscreenElement, label=(on ? 'Exit' : 'Enter')+' fullscreen';
    byId('fullscreen').setAttribute('aria-pressed',String(on)); byId('fullscreen').setAttribute('aria-label',label);
    byId('fullscreen').title=label+' (F)'; invalidate();
  });
  function newSkyline() {
    if (renderer) location.hash='seed='+((locationSeed()+1)>>>0);
  }
  byId('regenerate').addEventListener('click',newSkyline);
  window.addEventListener('hashchange',()=>{
    const seed=locationSeed();
    if (city.seed===seed) return;
    city=C.generateCity(seed);
    if (!renderer) return;
    try {
      renderer.setCity(city);
      buildCharts();
      lastStamp=null;
      invalidate();
    } catch (error) { renderFailure(error); }
  });
  window.addEventListener('keydown',event=>{
    if (!renderer || postcard.open || event.ctrlKey || event.metaKey || event.altKey || event.target.matches?.('input,textarea,select,[contenteditable="true"]')) return;
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
      event.preventDefault(); held.add(event.key); queueFrame(); return;
    }
    if (event.repeat) return;
    const key = event.key.toLowerCase();
    if (event.code==='Space') {
      if (event.target.closest?.('button')) return;
      event.preventDefault(); togglePlay();
    } else if (/^[1-4]$/.test(key)) choose(Number(key)-1);
    else if (key==='r') resetLook();
    else if (key==='s') { F.cycleSpeed(state); updateButtons(); }
    else if (key==='g') newSkyline();
    else if (key==='p') takePostcard();
    else if (key==='w') cyclePreset('weather');
    else if (key==='t') cyclePreset('lighting');
    else if (key==='l') chooseLookout(nextChoice(F.lookouts, state.lookout));
    else if (key==='b') changeGlass();
    else if (key==='n') jumpToEvent();
    else if (key==='f' && !byId('fullscreen').hidden) fullscreen();
  });
  window.addEventListener('keyup',event=>held.delete(event.key));
  function clearInput() {
    held.clear();
    pointer = null;
    scrub = null;
    chartPointer = null;
    updateChartCaption();
  }
  window.addEventListener('blur',clearInput);
  window.addEventListener('resize',invalidate);
  function queueFrame() {
    if (renderer && !document.hidden && !postcard.open && !request) request=requestAnimationFrame(frame);
  }
  function invalidate() { dirty=true; queueFrame(); }
  function adjustSize() {
    const size=F.renderSize(canvas.clientWidth,canvas.clientHeight,devicePixelRatio||1,quality);
    if (size[0]!==lastSize[0] || size[1]!==lastSize[1]) {
      renderer.resize(...size); lastSize=size; dirty=true;
    }
  }
  // Resize after sustained frame pressure. Hysteresis avoids reallocating targets on isolated slow frames.
  function measure(dt) {
    if (!state.playing || dt<=0 || dt>1) return;
    measuredTime+=dt; measuredFrames++;
    if (measuredTime<1.6 || measuredFrames<12) return;
    const average=measuredTime/measuredFrames;
    if (average>0.0195) quality=Math.max(0.56,quality-0.12);
    else if (average<0.0176) quality=Math.min(1,quality+0.055);
    measuredTime=0; measuredFrames=0;
  }
  function frame(now) {
    request=0;
    if (!renderer || document.hidden || postcard.open) return;
    try { drawFrame(now); }
    catch (error) { renderFailure(error); }
  }
  function turning() {
    return Math.abs(state.targetYaw-state.yaw)+Math.abs(state.targetPitch-state.pitch)>.00003;
  }
  function drawFrame(now) {
    const dt=lastStamp===null ? 0 : (now-lastStamp)/1000; lastStamp=now;
    measure(dt); adjustSize();
    const step=Math.min(dt,.12)*.74;
    if (held.size) F.look(state,step*(Number(held.has('ArrowRight'))-Number(held.has('ArrowLeft'))),
      step*(Number(held.has('ArrowUp'))-Number(held.has('ArrowDown'))));
    const moving=state.playing || state.transition || turning();
    F.advance(state,dt);
    if (dirty || moving) {
      const shot=F.camera(state);
      drawHarbour(shot);
      const settled = !state.playing && !state.transition && !turning();
      if (dirty || settled || now-lastReadout>90) { updateReadout(shot); lastReadout=now; }
      dirty=false;
    }
    if (state.playing || state.transition || held.size || turning()) queueFrame();
    else lastStamp=null;
  }
  function stop() {
    if (request) cancelAnimationFrame(request);
    request=0; lastStamp=null; clearInput();
  }
  function drawHarbour(shot) {
    renderer.render(shot, state.worldTime, state.weather.values, state.lighting.values, state.magnification);
  }
  function failure(title,detail) {
    stop(); renderer=null; canvas.dataset.status='unavailable';
    byId('error-title').textContent=title; byId('error-detail').textContent=detail;
    byId('error-panel').hidden=false; document.body.classList.add('unavailable');
    byId('render-label').textContent='RENDER OFFLINE';
    renderControls.forEach(control=>{control.disabled=true;});
  }
  function renderFailure(error) {
    if (renderer) renderer.dispose();
    console.error('Nightferry renderer:',error.message);
    if (error.message==='WebGL unavailable') {
      failure('WebGL is unavailable','Enable hardware acceleration in a WebGL-capable browser, then reopen this file to view the harbour.');
    } else {
      failure('The harbour could not be drawn','Your graphics device could not prepare the scene. Try a smaller window and reload the page.');
    }
  }
  function start() {
    try {
      renderer=new HarbourRenderer(canvas,city); lastSize=[0,0]; adjustSize();
      buildCharts();
      drawHarbour(F.camera(state));
      canvas.dataset.status='ready'; byId('error-panel').hidden=true; document.body.classList.remove('unavailable');
      byId('render-label').textContent='LIVE RENDER';
      renderControls.forEach(control=>{control.disabled=false;});
      updateButtons();
    } catch (error) { renderFailure(error); }
  }
  canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault(); failure('Graphics connection interrupted','The flight will return when your browser restores the graphics connection.');
  });
  canvas.addEventListener('webglcontextrestored',start);
  document.addEventListener('visibilitychange',()=>{
    stop(); measuredTime=0; measuredFrames=0; dirty=true;
    queueFrame();
  });
  start();
})();
