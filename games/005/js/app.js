(function () {
  'use strict';
  const M=globalThis.CupMath, L=globalThis.CupLesson, G=globalThis.CupMeshes, P=globalThis.CupPacking;
  const byId=id=>document.getElementById(id);
  const canvas=byId('scene'), diagram=byId('diagram'), overlay=byId('callouts');
  const help=byId('help'), scrubber=byId('scrubber'), play=byId('play');
  const previous=byId('previous'), next=byId('next');
  const orientation=byId('orientation');
  const callouts=new CupCallouts(overlay,orientation);
  const diameter=byId('diameter'), benchDiagram=byId('bench-diagram');
  const elapsed=byId('elapsed'), playText=byId('play-text'), playIcon=byId('play-icon');
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
  const svgNS='http://www.w3.org/2000/svg';
  const two=n=>String(n).padStart(2,'0');
  const svg=(name,attributes={})=>{
    const node=document.createElementNS(svgNS,name);
    for(const [k,v] of Object.entries(attributes)) node.setAttribute(k,v);
    return node;
  };
  function icon(name) {
    const s=svg('svg',{class:'icon','aria-hidden':'true'});
    s.append(svg('use',{href:'#i-'+name})); return s;
  }
  let state=L.clock(), exterior=false, renderer=null, currentStep=-1;
  const opening=L.scene(0);
  let target=L.camera(opening.yaw,opening.pitch,1), view={...target}, userCamera=false;
  let raf=0, lastStamp=null, lastTimeText='', lastProgress=-1;
  let benchOpen=false, lessonCamera=null;
  const mesh=G.noodles(), specimen={mesh,profile:P.measure(mesh)};
  const playback=CupPlaybackControls.mount(specimen.profile,resetTiming=>{
    if(resetTiming) lastStamp=null;
    syncUI(); invalidate();
  },pauseAt);
  const lessonTools=CupLessonTools.mount(specimen,pauseAt,refreshStudy);
  const investigations=[
    {label:'Scan the air gap',tool:'scan',stop:'gap'},
    {label:'Slice through the block',tool:'scan',stop:'block'},
    {label:'Repeat the bump at ¼×'},
    {label:'Measure the lower pocket',tool:'pour'},
    {label:'Compare the packed curls',tool:'scan',stop:'block'}
  ];
  const bench=CupBench.mount(specimen,reframe=>{
    if(!benchOpen) return;
    refreshStudy(reframe);
  });
  const pointers=new Map();
  const chapters=L.steps.map((s,i)=>{
    const li=document.createElement('li'), button=document.createElement('button');
    button.type='button'; button.className='chapter'; button.dataset.step=i;
    const tile=document.createElement('span'); tile.className='chapter-icon'; tile.append(icon(s.icon));
    const copy=document.createElement('span'); copy.className='chapter-copy';
    const meta=document.createElement('span'); meta.className='chapter-meta';
    meta.textContent=two(i+1)+' / '+L.formatTime(s.start);
    const name=document.createElement('span'); name.className='chapter-name'; name.textContent=s.name;
    copy.append(meta,name); button.append(tile,copy); li.append(button); byId('chapters').append(li);
    button.setAttribute('aria-label','Step '+(i+1)+', '+s.name+', '+L.formatTime(s.start));
    button.addEventListener('click',()=>setClock(L.select(state,i)));
    return button;
  });
  const ticks=Array.from(document.querySelectorAll('.step-ticks i'));
  byId('duration').textContent=L.formatTime(L.duration); scrubber.max=L.duration;
  function currentScene() {
    return benchOpen ? bench.scene : lessonTools.decorate(L.scene(state.time,specimen.profile));
  }
  function refreshStudy(reframe) {
    if(reframe) { setExterior(false); preset(); }
    syncUI(); invalidate();
  }
  function preset(s=currentScene()) {
    const yaw=exterior ? -0.80 : s.yaw;
    target=L.camera(L.nearestAngle(view.yaw,yaw),exterior ? 0.31 : s.pitch,1);
    userCamera=false;
  }
  function drawDiagram(canvas,scene,tracing,force) {
    const drawn=CupDiagram.draw(canvas,scene,tracing,force);
    if(drawn!==undefined) {
      const reading=byId(!renderer ? 'fallback-reading' : canvas===diagram ? 'lesson-reading' : 'bench-reading');
      if(reading.hidden!==drawn) reading.hidden=drawn;
      if(!drawn && reading.textContent!==canvas.getAttribute('aria-label')) {
        reading.textContent=canvas.getAttribute('aria-label');
      }
    }
  }
  function syncUI(scene=currentScene(), forceDiagram=false) {
    if (benchOpen) {
      drawDiagram(benchDiagram,scene,false,forceDiagram);
      return;
    }
    const index=scene.index, step=L.steps[index];
    if(index!==currentStep) {
      currentStep=index;
      byId('step-label').textContent='Step '+two(index+1)+' / '+two(L.steps.length);
      byId('step-title').textContent=step.title; byId('step-caption').textContent=step.caption;
      byId('investigate-text').textContent=investigations[index].label;
      chapters.forEach((b,i)=>i===index ? b.setAttribute('aria-current','step') : b.removeAttribute('aria-current'));
      ticks.forEach((tick,i)=>tick.classList.toggle('on',i<=index));
      previous.disabled=index===0; next.disabled=index===L.steps.length-1;
      if(!userCamera) preset(scene);
    }
    lessonTools.sync(scene);
    const atStop=playback.sync(state,index);
    const title=state.playing ? 'Pause lesson' : state.time===L.duration ? (playback.repeating ? 'Replay step' : 'Replay lesson') :
      atStop ? 'Continue lesson' : 'Play lesson';
    if(playText.textContent!==title) playText.textContent=title;
    const symbol=state.playing ? '#i-pause' : state.time===L.duration ? '#i-reset' : '#i-play';
    if(playIcon.getAttribute('href')!==symbol) playIcon.setAttribute('href',symbol);
    const text=L.formatTime(state.time);
    if(lastTimeText!==text) {
      elapsed.textContent=text; scrubber.setAttribute('aria-valuetext',text+' of '+L.formatTime(L.duration));
      lastTimeText=text;
    }
    // Keep the displayed thumb in the caption's chapter right up to a repeat.
    const tick=Math.min(Math.round(state.time*20)/20,
      state.time===L.duration ? L.duration : step.start+step.duration-0.05);
    if(Number(scrubber.value)!==tick) scrubber.value=tick;
    if(lastProgress!==tick) {
      scrubber.style.setProperty('--progress',(100*tick/L.duration).toFixed(2)+'%');
      lastProgress=tick;
    }
    drawDiagram(diagram,scene,lessonTools.tracing && index>=3,forceDiagram);
  }
  function setClock(value) {
    state=value; lastStamp=null;
    if (benchOpen) setMode(false);
    else { syncUI(currentScene(),true); invalidate(); }
  }
  function invalidate() {
    if(!raf && !document.hidden) raf=requestAnimationFrame(frame);
  }
  function setExterior(whole) {
    exterior=whole;
    byId('cutaway').setAttribute('aria-pressed',String(!whole));
    byId('exterior').setAttribute('aria-pressed',String(whole));
  }
  function changeView(whole) {
    if(!renderer || exterior===whole) return;
    setExterior(whole); preset(); invalidate();
  }
  function handleReset() { if(renderer) { preset(); invalidate(); } }
  byId('cutaway').addEventListener('click',()=>changeView(false));
  byId('exterior').addEventListener('click',()=>changeView(true));
  byId('reset').addEventListener('click',handleReset);
  const togglePlay=()=>setClock(L.toggle(state,playback.repeating));
  play.addEventListener('click',togglePlay);
  previous.addEventListener('click',()=>setClock(L.select(state,currentStep-1)));
  next.addEventListener('click',()=>setClock(L.select(state,currentStep+1)));
  scrubber.addEventListener('input',()=>setClock(L.seek(state,Number(scrubber.value))));

  function setMode(open,experiment) {
    if(open) bench.open(experiment);
    if(open!==benchOpen) {
      benchOpen=open;
      clearPointers();
      if(open) {
        lessonCamera={view:{...view},target:{...target},userCamera,exterior};
        setExterior(false); preset();
      } else {
        ({view,target,userCamera}=lessonCamera);
        setExterior(lessonCamera.exterior);
        lessonCamera=null;
      }
      byId('mode-lesson').setAttribute('aria-pressed',String(!open));
      byId('mode-packing').setAttribute('aria-pressed',String(open));
      byId('lesson-panel').hidden=open; byId('packing-panel').hidden=!open;
      placeDiagrams();
      lastStamp=null;
    }
    syncUI(); invalidate();
  }
  byId('mode-lesson').addEventListener('click',()=>setMode(false));
  byId('mode-packing').addEventListener('click',()=>setMode(true));
  function openBenchStudy(tool,control,settings) {
    setMode(true,{diameter:P.defaultDiameter,tool,...settings});
    byId(control).focus();
  }
  byId('try-press').addEventListener('click',()=>openBenchStudy('press','press-travel'));
  byId('try-walls').addEventListener('click',()=>openBenchStudy('fit','taper',{taper:0}));
  byId('try-forces').addEventListener('click',()=>openBenchStudy('forces','block-mass'));
  byId('step-investigate').addEventListener('click',()=>{
    const action=investigations[currentStep];
    if(action.tool) {
      openBenchStudy(action.tool,action.tool==='scan' ? 'scan-height' : 'dose',{stop:action.stop});
    } else {
      playback.setRate(0.25); playback.setRepeat(true);
      setClock(L.clock(L.steps[currentStep].start,true));
      setExterior(false); preset(); play.focus();
    }
  });

  function pauseAt(time) {
    setClock(L.clock(time));
    setExterior(false); preset(); invalidate();
    (renderer ? canvas : scrubber).focus();
  }
  function inspect(evidence) {
    if(evidence.mode==='packing') {
      setMode(true,{diameter:evidence.diameter,tool:'fit'});
      setExterior(false); preset(); invalidate(); diameter.focus();
    } else if(evidence.waterline!==undefined) lessonTools.waterline(evidence.waterline);
    else pauseAt(evidence.time);
  }
  CupChecks.mount(inspect);

  function frame(stamp) {
    raf=0;
    const dt=lastStamp===null ? 0 : Math.max(0,(stamp-lastStamp)/1000);
    lastStamp=stamp;
    const canPlay=!benchOpen && !help.open;
    if(state.playing && canPlay) state=playback.tick(state,dt);
    const s=currentScene();
    syncUI(s);
    let moving=false;
    if(renderer) {
      if(!userCamera && !exterior && !reduceMotion.matches) target.yaw=L.nearestAngle(view.yaw,s.yaw);
      for(const key of ['yaw','pitch','zoom']) {
        const goal=target[key];
        if(reduceMotion.matches || Math.abs(view[key]-goal)<0.00015) view[key]=goal;
        else { view[key]=M.damp(view[key],goal,13,dt); moving=true; }
      }
      if(renderer.render(view,s,exterior,benchOpen ? 0 : state.time,lessonTools.tracing)) {
        callouts.update(renderer,s,view,exterior);
      }
    }
    if((state.playing && canPlay) || moving) invalidate(); else lastStamp=null;
  }
  function available(on) {
    byId('model-error').hidden=on; overlay.style.display=on ? '' : 'none';
    placeDiagrams();
    orientation.hidden=!on;
    canvas.tabIndex=on ? 0 : -1;
    for(const id of ['cutaway','exterior','reset']) byId(id).disabled=!on;
    document.querySelector('.gesture-help').style.visibility=on ? '' : 'hidden';
  }
  function placeDiagrams() {
    const fallback=byId('fallback-section');
    for(const [drawing,home,active] of [[diagram,byId('lesson-inset'),!benchOpen],[benchDiagram,byId('bench-inset'),benchOpen]]) {
      const enlarged=!renderer && active, parent=enlarged ? fallback : home;
      if(drawing.parentNode!==parent) parent.append(drawing);
      home.hidden=enlarged;
    }
  }
  function startRenderer() {
    try { renderer=new CupRenderer(canvas,specimen); available(true); }
    catch(error) {
      renderer=null; available(false);
      byId('error-detail').textContent='WebGL could not start. You can still use the lesson and the packing bench.';
      console.warn('3D view:',error.message);
    }
    invalidate();
  }
  canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault(); renderer=null; clearPointers(); available(false);
    byId('error-detail').textContent='The graphics connection was interrupted. You can keep exploring in cross section.';
    invalidate();
  });
  canvas.addEventListener('webglcontextrestored',startRenderer);

  function clearPointers() { pointers.clear(); canvas.classList.remove('dragging'); }
  const distance=()=>{
    const [a,b]=pointers.values(); return Math.hypot(a.x-b.x,a.y-b.y);
  };
  canvas.addEventListener('pointerdown',e=>{
    if(!renderer || e.button!==0) return;
    canvas.focus({preventScroll:true});
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove',e=>{
    const old=pointers.get(e.pointerId);
    if(!old || !renderer) return;
    const before=pointers.size===2 ? distance() : 0;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(pointers.size===1) target=L.orbit(target,e.clientX-old.x,e.clientY-old.y);
    else if(pointers.size===2 && before>1) target=L.zoomBy(target,distance()/before);
    userCamera=true; invalidate();
  });
  function release(e) {
    pointers.delete(e.pointerId);
    if(!pointers.size) canvas.classList.remove('dragging');
  }
  for(const name of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(name,release);
  canvas.addEventListener('wheel',e=>{
    if(!renderer) return;
    e.preventDefault();
    const px=e.deltaY*(e.deltaMode===1 ? 16 : e.deltaMode===2 ? canvas.clientHeight : 1);
    target=L.zoomBy(target,Math.exp(-M.clamp(px,-240,240)*0.0017)); userCamera=true; invalidate();
  },{passive:false});

  function openHelp() { if(!help.open) { help.showModal(); byId('help-close').focus(); lastStamp=null; } }
  byId('help-open').addEventListener('click',openHelp);
  byId('help-close').addEventListener('click',()=>help.close());
  help.addEventListener('close',()=>{ lastStamp=null; invalidate(); });
  help.addEventListener('click',e=>{
    if(e.target!==help) return;
    const b=help.getBoundingClientRect();
    if(e.clientX<b.left || e.clientX>b.right || e.clientY<b.top || e.clientY>b.bottom) help.close();
  });
  document.addEventListener('keydown',e=>{
    if(help.open || e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    const k=e.key.toLowerCase();
    if(k===' ' && e.target.closest('button')) return;
    if(e.repeat && [' ','b','c','t','l','o','?'].includes(k)) { e.preventDefault(); return; }
    if(k===' ' && !benchOpen) togglePlay();
    else if(k==='b') setMode(!benchOpen);
    else if(k==='l' && !benchOpen) playback.toggleRepeat();
    else if(k==='o' && !benchOpen) playback.toggleObservations();
    else if(k==='t' && !benchOpen && currentStep>=3) lessonTools.toggleTrace();
    else if(k==='arrowleft' || k==='arrowright') setClock(L.select(state,currentStep+(k==='arrowleft'?-1:1)));
    else if(/^[1-5]$/.test(k)) setClock(L.select(state,Number(k)-1));
    else if(k==='?') openHelp();
    else if(k==='r') handleReset();
    else if(k==='c') changeView(!exterior);
    else if(renderer && ['a','d','w','s','-','_','=','+'].includes(k)) {
      if(k==='a'||k==='d') target=L.camera(target.yaw+(k==='a'?-0.15:0.15),target.pitch,target.zoom);
      else if(k==='w'||k==='s') target=L.camera(target.yaw,target.pitch+(k==='w'?0.08:-0.08),target.zoom);
      else target=L.zoomBy(target,k==='-'||k==='_' ? 1/1.14 : 1.14);
      userCamera=true; invalidate();
    } else return;
    e.preventDefault();
  });
  document.addEventListener('visibilitychange',()=>{
    lastStamp=null;
    if(document.hidden) { clearPointers(); cancelAnimationFrame(raf); raf=0; }
    else invalidate();
  });
  const resize=new ResizeObserver(invalidate);
  for(const element of [byId('stage'),diagram,benchDiagram]) resize.observe(element);
  reduceMotion.addEventListener('change',invalidate);
  if(matchMedia('(pointer: coarse)').matches) document.querySelector('.zoom-hint').textContent='Pinch to zoom';
  startRenderer(); syncUI();
})();
