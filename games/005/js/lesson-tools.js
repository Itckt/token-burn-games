(function (root) {
  'use strict';
  const L = root.CupLesson, S = root.CupStrands, M = root.CupMath;
  const byId = id => document.getElementById(id);

  function mount({mesh, profile}, pauseAt, refresh) {
    const samples = new Map(mesh.strands.filter(s => s.key).map(s => [s.key,s]));
    const choice = byId('strand-choice'), meter = byId('immersion-meter');
    const percentage = byId('immersion-value'), reading = byId('strand-reading');
    const halfDepthTime = L.timeAtGapDepth(profile,L.gapReading(profile,profile.bottom).originalMM/2);
    let curve, sample, inspectingGap = false, tracing = false, lastStep = -1;
    // The guided player can run all five chapters without opening an instrument.
    const immersion = () => curve ??= S.immersionProfile(mesh.strands);
    function setTrace(on) {
      tracing = on;
      byId('trace').setAttribute('aria-pressed', String(on));
      byId('trace-legend').hidden = byId('immersion-reading').hidden = !on;
    }
    function toggleTrace() { setTrace(!tracing); refresh(false); }
    function freezeHeight(height) { setTrace(true); pauseAt(L.timeAtWaterline(height)); }
    function waterline(fraction) { freezeHeight(M.lerp(profile.bottom,profile.top,fraction)); }
    byId('trace').addEventListener('click', toggleTrace);
    byId('water-bottom').addEventListener('click', () => waterline(0));
    byId('water-top').addEventListener('click', () => waterline(1));
    byId('water-half').addEventListener('click', () => freezeHeight(S.heightAtFraction(immersion(),0.5)));
    choice.addEventListener('change', () => {
      sample = samples.get(choice.value);
      inspectingGap = choice.value === 'gap';
      byId('strand-inspection').hidden = !sample && !inspectingGap;
      byId('gap-key').hidden = byId('gap-half').hidden = !inspectingGap;
      byId('gap-half').disabled = halfDepthTime === null;
      refresh(!!sample || inspectingGap);
    });
    byId('strand-packed').addEventListener('click', () => pauseAt(L.steps[4].start));
    byId('strand-loose').addEventListener('click', () => pauseAt(L.looseTime));
    byId('gap-half').addEventListener('click', () => { if (halfDepthTime !== null) pauseAt(halfDepthTime); });

    function decorate(scene) {
      if (tracing && scene.index >= 3) {
        scene.immersed = L.hasPool(scene) ? S.fractionBelow(immersion(),scene.surfaceY) : 0;
      }
      if (sample && scene.index === 4) scene.tracked = S.track(sample,scene.soft);
      if (inspectingGap && scene.index === 4) scene.gap = L.gapReading(profile,scene.bottom);
      return scene;
    }
    function sync(scene) {
      if (scene.index !== lastStep) {
        byId('try-press').hidden = scene.index !== 2;
        byId('try-walls').hidden = byId('try-forces').hidden = scene.index !== 1;
        byId('water-tools').hidden = scene.index < 3;
        byId('strand-tools').hidden = scene.index !== 4;
        lastStep = scene.index;
      }
      byId('lesson-inset').classList.toggle('tracking', !!scene.tracked);
      if (scene.immersed !== undefined) {
        const percent = Math.round(scene.immersed * 1000) / 10;
        const label = percent === 0 && scene.immersed > 0 ? '<0.1%' :
          percent === 100 && scene.immersed < 1 ? '>99.9%' : percent+'%';
        if (meter.getAttribute('aria-valuetext') !== label+' of strand length submerged') {
          percentage.textContent = label;
          meter.value = scene.immersed * 100;
          meter.setAttribute('aria-valuetext', label+' of strand length submerged');
        }
      }
      if (scene.gap) {
        const {reachedMM, originalMM, remainingMM} = scene.gap;
        const text = 'The lowest curl reaches '+root.CupDesign.gapLabel(reachedMM)+' into the original '+originalMM.toFixed(1)+
          ' mm pocket. Clearance to the floor is '+root.CupDesign.gapLabel(remainingMM)+'.';
        if (reading.textContent !== text) reading.textContent = text;
      } else if (scene.tracked) {
        const {heightMM, dropMM} = scene.tracked;
        const difference = Math.abs(dropMM) < 0.05 ? 'at its packed height' :
          Math.abs(dropMM).toFixed(1)+' mm '+(dropMM > 0 ? 'lower' : 'higher')+' than packed';
        const text = 'The marked curl is '+heightMM.toFixed(1)+' mm above the floor, '+difference+'.';
        if (reading.textContent !== text) reading.textContent = text;
      }
    }
    return {decorate, sync, toggleTrace, waterline, get tracing() { return tracing; }};
  }
  root.CupLessonTools = {mount};
})(globalThis);
