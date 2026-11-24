(function () {
  'use strict';
  const {sim,world,art,renderer,street,fan,tea,seating,shopCat,radio} = PocketPlaces;
  const byId = id => document.getElementById(id);
  const canvas=byId('scene'), stage=byId('stage'), viewer=byId('viewer');
  const orbit=byId('orbit'), pins=byId('pins'), expand=byId('expand');
  const guide=byId('guide'), popover=byId('field-popover');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const compact = window.matchMedia('(max-width: 760px)');
  const view = sim.createView(!motion.matches);
  const light = street.createLight(), lightButtons = street.modes.map(mode=>byId('light-'+mode));
  const lens = byId('lens'), lensPrev = byId('lens-prev'), lensNext = byId('lens-next');
  const fanSpeed=byId('fan-speed');
  const seatMenu=byId('seat-view'), standUp=byId('stand-up');
  const controls = [orbit,pins,expand,lens,lensPrev,lensNext,fanSpeed,seatMenu,standUp,...lightButtons,byId('zoom-in'),byId('zoom-out'),byId('reset')];
  const room=world.createRoom();
  let selected=0, allPins=false, expanded=false, returnFocus=null;
  let gl=null, engine=null, scene=null, atlas=null, camera=null, seat=null;
  let width=1, height=1, frame=0, lastTime=null, sceneTime=0;
  let hover=0, pendingHover=null, lastPick=-Infinity;
  let overviewAuto=true;
  const visit=PocketPlaces.catVisit.mount(room.cat,world.notes,()=>motion.matches || !engine,()=>{
    if (motion.matches && view.lens.subject===visit.slip.closeup) sim.settle(view);
    clearHover(); startFrame();
  });
  const notes=world.notes.map(note=>note.id===shopCat.id ? visit.slip : note);
  let sightline=null;
  const seatPins=new Map();
  const catalog=PocketPlaces.catalog.mount(notes,inspect,(eye,point,id)=>{
    sightline ||= PocketPlaces.sightlines.build(scene.batches);
    // A seat's eye never moves as the guest looks around. Only the cat can
    // change its pin position, and it receives a new center as it walks.
    const last=seatPins.get(id);
    if (last?.eye===eye && last.point===point) return last.visible;
    const visible=sightline(eye,point,id);
    seatPins.set(id,{eye,point,visible});
    return visible;
  },room);
  const counter=PocketPlaces.counter.mount(()=>bench.close());
  const bench=PocketPlaces.teaBench.mount(()=>{
    counter.close();
    if (seat) takeSeat('');
    select(0);
    if (engine && !view.lens.subject) frameSelection();
  },(order,stir)=>{
    room.drink=tea.appearance(order);
    room.pouredAt=stir && !motion.matches ? sceneTime : -Infinity;
    startFrame();
  });
  const postcard=PocketPlaces.postcard.mount(()=>{
    let illustrated=!engine || gl.isContextLost();
    // A WebGL canvas without preserveDrawingBuffer must be copied immediately after drawing.
    if (!illustrated) {
      camera=currentCamera();
      engine.draw(camera,sceneTime,0,light,room);
      illustrated=gl.isContextLost();
    }
    return {source:illustrated ? byId('portrait') : canvas, illustrated, mode:light.mode,
      closeup:Boolean(view.lens.subject), seat:seat?.place.name, note:notes[selected]};
  },pauseForDialog,opener=>{
    const target=opener===canvas && !engine ? catalog.cards[selected] : opener;
    target.focus({preventScroll:true}); startFrame();
  });
  const radioPlayer=PocketPlaces.radioPlayer.mount((dial,playing)=>{
    room.tuning.dial=dial; room.tuning.playing=playing; startFrame();
  });
  const tableService=PocketPlaces.tableService.mount(room,()=>{
    if (!engine || motion.matches) world.moveFixtures(room,0,true);
    catalog.illustrate(selected); clearHover(); startFrame();
  });

  function setPressed(button,pressed) { button.setAttribute('aria-pressed',String(pressed)); }
  function label(button,text) { button.setAttribute('aria-label',text); button.title=text; }
  function syncOrbit() {
    setPressed(orbit,view.auto);
    byId('orbit-glyph').setAttribute('href',view.auto ? '#i-pause' : '#i-play');
    orbit.title=(view.auto ? 'Pause' : 'Start')+' auto-orbit (Space)';
  }
  function syncZoom() {
    const zoom=(seat || view).targetZoom;
    byId('zoom-in').disabled = !engine || zoom >= sim.LIMITS.maxZoom;
    byId('zoom-out').disabled = !engine || zoom <= sim.LIMITS.minZoom;
  }
  function currentCamera() {
    return seat ? seating.camera(seat,width,height) : sim.camera(view,width,height);
  }
  function takeSeat(id) {
    const previous=seat;
    seat=seating.sit(id);
    if (seat && view.lens.subject) sim.leaveFocus(view,true);
    seatMenu.value=seat?.place.id || '';
    byId('seat-wide').textContent=seat ? 'Diorama view' : 'Take a seat';
    standUp.hidden=!seat; orbit.hidden=Boolean(seat);
    byId('turn-hint').textContent=seat ? 'Drag to look around' : 'Drag to orbit';
    canvas.setAttribute('aria-label',(seat ? seat.place.name+'. Drag or use arrow keys to look around.' :
      '3D café. Drag or use arrow keys to orbit.')+' Select objects in the scene or object index.');
    if (previous && document.activeElement===standUp) canvas.focus({preventScroll:true});
    popover.hidden=true;
    refreshCameraControls();
  }
  for (const place of seating.places) {
    const option=document.createElement('option');
    option.value=place.id; option.textContent=place.name; seatMenu.append(option);
  }
  seatMenu.addEventListener('change',()=>takeSeat(seatMenu.value));
  standUp.addEventListener('click',()=>takeSeat(''));
  function clearHover() {
    if (hover) startFrame();
    hover=0; pendingHover=null; canvas.dataset.hovering='false';
  }
  function syncLens() {
    const active=Boolean(view.lens.subject);
    setPressed(lens,active);
    byId('lens-label').textContent=active ? 'Wide view' : 'Close-up';
    label(lens,active ? 'Return to your wide view (C)' : 'Look closer at '+notes[selected].title+' (C)');
    lensPrev.hidden=lensNext.hidden=!active;
  }
  function frameSelection() {
    if (seat) takeSeat('');
    sim.focusOn(view,notes[selected].closeup,motion.matches);
    refreshCameraControls();
  }
  function refreshCameraControls() {
    syncOrbit(); syncLens(); syncZoom(); clearHover(); startFrame();
  }
  function toggleLens() {
    if (view.lens.subject) {
      sim.leaveFocus(view,motion.matches);
      refreshCameraControls();
      popover.hidden=true;
    } else {
      frameSelection();
      popover.hidden=!(expanded || compact.matches);
    }
  }
  function changeLight(mode) {
    street.setLight(light,mode,motion.matches);
    stage.dataset.light=light.mode;
    lightButtons.forEach((button,i)=>setPressed(button,street.modes[i]===light.mode));
    startFrame();
  }
  function placeMarkers() { catalog.position(camera,width,height,selected,allPins); }
  function select(index,fromScene=false) {
    selected=sim.cycleIndex(index,0,notes.length);
    const note=notes[selected];
    tableService.inspect(note.id);
    if (!engine || motion.matches) world.moveFixtures(room,0,true);
    catalog.show(selected);
    byId('cat-panel').hidden=note.id!==shopCat.id;
    radioPlayer.inspect(note.id===radio.id);
    popover.hidden=!(fromScene && (expanded || compact.matches));
    if (view.lens.subject && view.lens.subject!==note.closeup) frameSelection();
    syncLens();
    placeMarkers(); startFrame();
  }
  function inspect(index,fromScene=false) {
    select(index,fromScene);
    counter.inspect(notes[selected]);
  }
  function setFan(mode) {
    fan.setSpeed(room.fan,mode,motion.matches);
    byId('fan-label').textContent=mode[0].toUpperCase()+mode.slice(1);
    label(fanSpeed,'Counter fan '+mode+'. Change speed (B)');
    startFrame();
  }
  function cycleFan() {
    const index=sim.cycleIndex(fan.modes.indexOf(room.fan.mode),1,fan.modes.length);
    setFan(fan.modes[index]);
  }
  fanSpeed.addEventListener('click',cycleFan);
  byId('postcard-open').addEventListener('click',()=>postcard.open(byId('postcard-open')));
  select(0);
  syncOrbit();
  setFan(room.fan.mode);
  changeLight(light.mode);
  lightButtons.forEach((button,i)=>button.addEventListener('click',()=>changeLight(street.modes[i])));
  lens.addEventListener('click',toggleLens);
  lensPrev.addEventListener('click',()=>select(selected-1,true));
  lensNext.addEventListener('click',()=>select(selected+1,true));
  byId('previous').addEventListener('click',()=>select(selected-1));
  byId('next').addEventListener('click',()=>select(selected+1));
  byId('popover-close').addEventListener('click',()=>{ popover.hidden=true; canvas.focus({preventScroll:true}); });
  function pauseForDialog() { gesture.cancel(); stopFrames(); }
  byId('guide-open').addEventListener('click',()=>{ guide.showModal(); pauseForDialog(); });
  byId('guide-close').addEventListener('click',()=>guide.close());
  guide.addEventListener('close',()=>{ byId('guide-open').focus({preventScroll:true}); startFrame(); });
  for (const dialog of [guide,byId('postcard-dialog')]) {
    dialog.addEventListener('click',event=>{
      if (event.target!==dialog) return;
      const b=dialog.getBoundingClientRect();
      if (event.clientX<b.left || event.clientX>b.right || event.clientY<b.top || event.clientY>b.bottom) dialog.close();
    });
  }

  function resize() {
    if (!engine) return;
    const rect=stage.getBoundingClientRect();
    width=Math.max(1,rect.width); height=Math.max(1,rect.height);
    const [w,h]=renderer.bufferSize(width,height,window.devicePixelRatio,engine.viewportLimit);
    if (canvas.width!==w) canvas.width=w;
    if (canvas.height!==h) canvas.height=h;
    camera=currentCamera();
    clearHover(); placeMarkers(); startFrame();
  }
  function toggleExpanded(value) {
    if (value===expanded) return;
    if (value) returnFocus=document.activeElement;
    expanded=value;
    viewer.classList.toggle('is-expanded',value);
    document.body.classList.toggle('expanded',value);
    for (const e of document.querySelectorAll('.masthead, .intro, .ticket-wrap, .catalog')) e.inert=value;
    if (value) {
      viewer.setAttribute('role','dialog'); viewer.setAttribute('aria-modal','true');
    } else {
      viewer.removeAttribute('role'); viewer.removeAttribute('aria-modal'); popover.hidden=true;
    }
    setPressed(expand,value); label(expand,value ? 'Restore page view' : 'Expand view');
    byId('expand-glyph').setAttribute('href',value ? '#i-collapse' : '#i-expand');
    resize();
    if (value) canvas.focus({preventScroll:true});
    else if (!postcard.isOpen()) (returnFocus || expand).focus({preventScroll:true});
  }
  function toggleOrbit() {
    sim.setOrbit(view,!view.auto);
    if (!view.lens.subject) overviewAuto=view.auto;
    syncOrbit(); startFrame();
  }
  function manualCameraChanged() {
    if (!seat && !view.lens.subject) overviewAuto=false;
    popover.hidden=true; syncOrbit(); clearHover(); startFrame();
  }
  function rotate(dx,dy) {
    if (seat) seating.turn(seat,dx,dy); else sim.rotate(view,dx,dy);
    manualCameraChanged();
  }
  function zoom(factor) { sim.zoomBy(seat || view,factor); syncZoom(); clearHover(); startFrame(); }
  function reset() {
    if (seat) takeSeat('');
    overviewAuto=true;
    sim.resetView(view,!motion.matches,motion.matches);
    popover.hidden=true; refreshCameraControls();
  }
  orbit.addEventListener('click',toggleOrbit);
  pins.addEventListener('click',()=>{
    allPins=!allPins;
    setPressed(pins,allPins);
    pins.title=allPins ? 'Hide other object pins' : 'Show object pins';
    placeMarkers();
  });
  expand.addEventListener('click',()=>toggleExpanded(!expanded));
  byId('zoom-in').addEventListener('click',()=>zoom(1.16));
  byId('zoom-out').addEventListener('click',()=>zoom(1/1.16));
  byId('reset').addEventListener('click',reset);

  function readObject(x,y) {
    if (!engine || !camera) return 0;
    const rect=canvas.getBoundingClientRect();
    const pixel=sim.pickPixel(x-rect.left,y-rect.top,rect.width,rect.height,gl.drawingBufferWidth,gl.drawingBufferHeight);
    return pixel ? engine.pick(camera,...pixel) : 0;
  }
  function startFrame() {
    if (engine && !frame && !document.hidden && !guide.open && !postcard.isOpen()) frame=window.requestAnimationFrame(render);
  }
  function stopFrames() {
    if (frame) window.cancelAnimationFrame(frame);
    frame=0; lastTime=null;
  }
  function render(now) {
    frame=0;
    if (!engine || document.hidden) return;
    const dt=sim.step(seat || view,lastTime===null ? 0 : (now-lastTime)/1000);
    lastTime=now;
    if (!motion.matches) {
      sceneTime+=dt;
      street.stepLight(light,dt);
      fan.step(room.fan,dt);
      visit.step(dt);
      world.moveFixtures(room,dt);
    }
    // Pick against the last displayed camera, before advancing this frame.
    if (pendingHover && now-lastPick>=95) {
      hover=readObject(pendingHover.x,pendingHover.y);
      canvas.dataset.hovering=String(hover>0); pendingHover=null; lastPick=now;
    } else if (!seat && view.auto && hover && now-lastPick>600) clearHover();
    camera=currentCamera();
    engine.draw(camera,sceneTime,hover,light,room);
    placeMarkers();
    byId('needle').setAttribute('transform','rotate('+((seat || view).yaw*180/Math.PI).toFixed(2)+' 16 16)');
    if (!motion.matches || sim.cameraMoving(seat || view) || pendingHover) startFrame();
    else lastTime=null;
  }
  const gesture=PocketPlaces.gestures.attach(canvas,{
    available:()=>Boolean(engine && !guide.open && !postcard.isOpen()), rotate, zoom, clearHover,
    startPinch() { if (!seat) sim.setOrbit(view,false); manualCameraChanged(); },
    hover(x,y) { pendingHover={x,y}; startFrame(); },
    tap(x,y) {
      const id=readObject(x,y), index=notes.findIndex(note=>note.id===id);
      if (index>=0) inspect(index,true);
      else popover.hidden=true;
    }
  });

  const heldKeys={
    arrowleft:()=>rotate(13,0), arrowright:()=>rotate(-13,0),
    arrowup:()=>rotate(0,12), arrowdown:()=>rotate(0,-12),
    '+':()=>zoom(1.16), '=':()=>zoom(1.16), '-':()=>zoom(1/1.16), '_':()=>zoom(1/1.16),
    r:reset, home:reset
  };
  const pressedKeys={
    ' ':()=>seat ? takeSeat('') : toggleOrbit(),
    v:()=>takeSeat(seating.places[seating.places.indexOf(seat?.place)+1]?.id || ''),
    f:()=>toggleExpanded(!expanded), c:toggleLens, b:cycleFan, p:()=>postcard.open(canvas),
    w:()=>changeLight(street.modes[sim.cycleIndex(street.modes.indexOf(light.mode),1,street.modes.length)])
  };
  canvas.addEventListener('keydown',e=>{
    if (!engine || guide.open || postcard.isOpen() || e.altKey || e.ctrlKey || e.metaKey) return;
    const key=e.key.toLowerCase();
    if (Object.hasOwn(heldKeys,key)) heldKeys[key]();
    else if (Object.hasOwn(pressedKeys,key)) { if (!e.repeat) pressedKeys[key](); }
    else if (/^[0-9]$/.test(key)) {
      const slip=key==='0' ? 10 : Number(key);
      if (slip>notes.length) return;
      if (!e.repeat) inspect(slip-1,true);
    }
    else return;
    e.preventDefault();
  });
  document.addEventListener('keydown',e=>{
    if (postcard.isOpen() || guide.open) return;
    if (e.key==='Escape' && expanded) { toggleExpanded(false); e.preventDefault(); }
    else if (e.key==='Escape') popover.hidden=true;
  });
  document.addEventListener('visibilitychange',()=>{
    if (document.hidden) { stopFrames(); gesture.cancel(); }
    else startFrame();
  });
  motion.addEventListener('change',()=>{
    const automatic=overviewAuto && !motion.matches;
    if (view.lens.overview) view.lens.overview.auto=automatic;
    const runOrbit=!view.lens.subject && automatic;
    if (view.auto!==runOrbit) sim.setOrbit(view,runOrbit);
    if (motion.matches) {
      visit.settle();
      world.moveFixtures(room,0,true);
      sim.settle(view); if (seat) sim.settle(seat);
      street.setLight(light,light.mode,true);
      fan.setSpeed(room.fan,room.fan.mode,true); room.pouredAt=-Infinity;
    }
    syncOrbit(); startFrame();
  });
  window.addEventListener('resize',resize);
  if (window.ResizeObserver) new window.ResizeObserver(resize).observe(stage);

  function unavailable(title,reason) {
    engine=null; camera=null;
    visit.settle();
    world.moveFixtures(room,0,true);
    stopFrames(); gesture.cancel();
    if (expanded) toggleExpanded(false);
    const focus=document.activeElement;
    const needsFocus=controls.includes(focus) || catalog.markers.includes(focus) || focus===canvas || focus===byId('popover-close');
    byId('error-title').textContent=title; byId('error-copy').textContent=reason;
    byId('scene-error').hidden=false; popover.hidden=true;
    canvas.tabIndex=-1;
    for (const button of controls) button.disabled=true;
    if (needsFocus && !postcard.isOpen()) catalog.cards[selected].focus({preventScroll:true});
    placeMarkers();
  }
  function initialize() {
    try {
      gl=canvas.getContext('webgl',{alpha:true,antialias:true,depth:true,premultipliedAlpha:true});
      if (!gl) {
        unavailable('WebGL is unavailable','Enable WebGL and hardware acceleration to see the café. The object index lets you read the illustrated slips and fill counter tickets.');
        return;
      }
      scene ||= world.makeScene(); atlas ||= art.makeAtlas();
      engine=renderer.createRenderer(gl,scene,atlas);
      byId('scene-error').hidden=true;
      canvas.tabIndex=0;
      for (const button of controls) button.disabled=false;
      syncZoom(); resize(); engine.draw(camera,sceneTime,hover,light,room);
      startFrame();
    } catch (error) {
      if (engine && !gl.isContextLost()) engine.dispose();
      console.error('Café renderer:',error);
      unavailable('The 3D view could not start','Check that hardware acceleration is enabled and reload this file. The object index and its order slips are still available.');
    }
  }
  canvas.addEventListener('webglcontextlost',e=>{
    e.preventDefault();
    unavailable('Graphics connection interrupted','The café will reopen when the graphics context returns. You can browse the order slips while it recovers.');
  });
  canvas.addEventListener('webglcontextrestored',initialize);
  initialize();
})();
