(function () {
  'use strict';
  const {radio,sim}=PocketPlaces;
  function mount(onTune) {
    const byId=id=>document.getElementById(id);
    const play=byId('radio-power'), volume=byId('radio-volume'), status=byId('radio-status'), quiet=byId('radio-quiet');
    const Audio=window.AudioContext || window.webkitAudioContext;
    const buffers=new Map();
    let station=0, wanted=false, away=false, inspecting=false, edition=0;
    let context=null, gain=null, source=null, failure='';

    function display() {
      const tuned=radio.stations[station], dial=radio.dialPosition(station);
      byId('radio-name').textContent=tuned.name;
      byId('radio-frequency').textContent=tuned.frequency+' FM';
      byId('radio-needle').style.left=(12+76*dial)+'%';
      play.textContent=wanted ? 'Switch off' : 'Listen';
      play.setAttribute('aria-pressed',String(wanted));
      quiet.hidden=!wanted || inspecting;
      play.disabled=volume.disabled=!Audio;
      status.textContent=!Audio ? 'Audio playback is unavailable in this browser.' :
        failure || (source ? 'On air' : wanted ? 'Tuning in…' : 'Radio off');
      onTune(dial,Boolean(source));
    }
    function disconnect() {
      if (source) { source.stop(); source.disconnect(); source=null; }
    }
    function setVolume() {
      if (gain) gain.gain.setTargetAtTime((Number(volume.value)/100)**2,context.currentTime,.018);
    }
    async function update() {
      const current=++edition;
      disconnect();
      display();
      try {
        if (!wanted || away || document.hidden) {
          if (context) await context.suspend();
          return;
        }
        if (!context || context.state==='closed') {
          context=new Audio();
          gain=null;
        }
        if (!gain) {
          const master=context.createGain();
          master.connect(context.destination);
          master.gain.value=(Number(volume.value)/100)**2;
          gain=master;
        }
        await context.resume();
        if (edition!==current) {
          if (!wanted || away || document.hidden) await context.suspend();
          return;
        }
        if (!buffers.has(station)) {
          const rate=22050, wave=radio.synthesize(radio.stations[station],rate);
          const buffer=context.createBuffer(1,wave.length,rate);
          buffer.getChannelData(0).set(wave);
          buffers.set(station,buffer);
        }
        const next=context.createBufferSource();
        next.buffer=buffers.get(station); next.loop=true;
        next.connect(gain);
        try { next.start(); } catch (error) { next.disconnect(); throw error; }
        source=next;
      } catch {
        if (edition!==current) return;
        if (wanted && !away && !document.hidden) {
          wanted=false;
          failure='Playback could not start. Choose Listen to try again.';
          if (context) context.suspend().catch(()=>{});
        }
      }
      if (edition===current) display();
    }
    function tune(delta) {
      station=sim.cycleIndex(station,delta,radio.stations.length);
      failure='';
      update();
    }
    play.addEventListener('click',()=>{ wanted=!wanted; failure=''; update(); });
    quiet.addEventListener('click',()=>{
      if (document.activeElement===quiet) byId('ticket-toggle').focus({preventScroll:true});
      wanted=false; update();
    });
    byId('station-prev').addEventListener('click',()=>tune(-1));
    byId('station-next').addEventListener('click',()=>tune(1));
    volume.addEventListener('input',setVolume);
    document.addEventListener('visibilitychange',update);
    window.addEventListener('pagehide',()=>{ away=true; update(); });
    window.addEventListener('pageshow',()=>{ if (away) { away=false; update(); } });
    display();
    return {inspect(active) {
      inspecting=active;
      byId('radio-panel').hidden=!active;
      quiet.hidden=!wanted || active;
    }};
  }
  PocketPlaces.radioPlayer={mount};
})();
