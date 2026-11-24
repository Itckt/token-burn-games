'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makePage } = require('./support/page.js');

function until(page, predicate, frames = 900) {
  for (let i = 0; i < frames && !predicate(); i++) page.run(1, 100);
  assert.ok(predicate(), 'reached the requested cab display');
}
function depart(page) {
  for (let i = 0; i < 8; i++) page.key('ArrowUp');
  page.key('ArrowUp','keyup');
}

test('keyboard and panel operate the same block, including an idle cab, a paused hold and a zero-target release', () => {
  const p = makePage(); p.run();
  const button = p.id('signal-toggle'), cue = p.id('signal-cue');
  assert.ok(cue.hidden);
  button.fire('click',{detail:1}); p.run();
  assert.ok(p.samples.at(-1).ride.signalled, 'stationary scene redraws its distant signal');
  assert.equal(p.frames.size,0); assert.equal(cue.dataset.aspect,'1');
  assert.match(cue.textContent,/216 m/); assert.equal(p.id('booked-time').textContent,'1:04');
  p.key('KeyG'); assert.equal(button.getAttribute('aria-pressed'),'false');
  p.key('KeyG','keyup'); p.key('KeyG'); p.key('KeyG','keydown',{repeat:true});
  assert.equal(button.getAttribute('aria-pressed'),'true');
  p.key('KeyM'); depart(p);
  until(p,() => p.id('drive-state').textContent === 'Signal brake');
  assert.equal(cue.dataset.aspect,'2'); assert.equal(p.id('brake-cue').hidden,true);
  button.fire('click'); assert.match(p.id('notice').textContent,/while berthed/);
  until(p,() => p.id('drive-state').textContent === 'Signal hold');
  assert.equal(p.id('door-state').textContent,'Closed');
  p.key('KeyP'); p.run();
  const hold = cue.textContent; assert.match(hold,/clears in/);
  p.run(1,60000); p.key('KeyP'); p.run(); assert.equal(cue.textContent,hold);
  p.key('Space'); until(p,() => cue.dataset.aspect === '0');
  assert.equal(p.id('target-value').textContent,'0');
  assert.equal(p.id('drive-state').textContent,'Stopped'); assert.equal(p.samples.at(-1).ride.position,206);
  assert.equal(p.id('brake-cue').hidden,false); assert.equal(p.id('sheet-summary').textContent,'0 stops');
  p.key('KeyW'); p.run(5,100); assert.ok(p.samples.at(-1).ride.position > 206);
  const offline = makePage({capture:false});
  assert.ok(offline.id('signal-toggle').disabled && offline.id('view-left').disabled);
});

test('a passing shuttle animates outside a stopped carriage, freezes on suspension and leaves the renderer idle between trains', () => {
  const p = makePage(); p.run(); depart(p);
  p.key('KeyL'); assert.equal(p.id('view-left').getAttribute('aria-pressed'),'true');
  const sample = () => p.samples.at(-1);
  until(p,() => sample().ride.position >= 85); p.key('Space');
  until(p,() => p.id('drive-state').textContent === 'Stopped');
  const at = sample().ride.position;
  assert.equal(sample().traffic.length,2);
  const first = sample().traffic[0].at;
  p.run(4,100);
  assert.equal(sample().ride.position,at); assert.ok(sample().traffic[0].at < first - 4);
  for (const suspension of ['guide','graphics','hidden']) {
    const before = sample();
    if (suspension === 'guide') p.key('KeyH');
    if (suspension === 'graphics') p.scene.fire('webglcontextlost');
    if (suspension === 'hidden') { p.doc.hidden=true; p.doc.fire('visibilitychange'); }
    p.run(1,60000); assert.equal(sample(),before);
    if (suspension === 'guide') p.key('Escape');
    if (suspension === 'graphics') p.scene.fire('webglcontextrestored');
    if (suspension === 'hidden') { p.doc.hidden=false; p.doc.fire('visibilitychange'); }
    p.run();
    assert.deepEqual(sample().traffic,before.traffic);
    assert.equal(sample().ride.recording.tick,before.ride.recording.tick);
  }
  until(p,() => sample().traffic.length === 0);
  const frames = p.samples.length; p.run(15,100); assert.equal(p.samples.length,frames);
  until(p,() => sample().traffic.length > 0);
  assert.equal(sample().ride.position,at);
  p.id('view-front').fire('click'); p.id('view-left').fire('click',{detail:1});
  assert.equal(p.id('view-left').getAttribute('aria-pressed'),'true'); assert.equal(p.doc.activeElement,p.scene);
});

test('the run sheet plots a driven leg and scrubs real coasting and arrival samples with native keyboard control', () => {
  const p = makePage(); p.run(); depart(p);
  assert.equal(p.id('cab-recorder').hidden,true);
  until(p,() => p.samples.at(-1).ride.position >= 100); p.key('KeyC');
  until(p,() => !p.id('cab-recorder').hidden); p.key('Space');
  const entry = p.samples.at(-1).ride.sheet.entries[0], points = entry.trace;
  const select = p.id('trace-leg'), slider = p.id('trace-sample'), canvas = p.id('trace-plot');
  assert.match(select.children[0].textContent,/Kowloon Tong → Campus Gate/);
  assert.equal(slider.max,String(points.length-1));
  assert.equal(p.lines.length,0,'a collapsed chart sleeps');
  canvas.clientWidth = 600; canvas.clientHeight = 102;
  p.id('run-sheet').open = true; p.id('run-sheet').fire('toggle');
  const speed = p.lines.find(line => line.ink === '#a7e0cb'), target = p.lines.find(line => line.dash?.length);
  assert.deepEqual(speed.points.at(-1),[600,99]); assert.deepEqual(target.dash,[5,4]);
  assert.ok(speed.points.some(([x,y])=>x > 0 && x < 600 && y < 45));
  assert.ok(target.points.every(([,y])=>y===3));
  const draws = p.lines.length;
  select.focus(); assert.equal(p.key('ArrowUp').defaultPrevented,false);
  slider.focus(); assert.equal(p.key('ArrowLeft').defaultPrevented,false);
  assert.equal(p.key('Space').defaultPrevented,false);
  const coast = points.findIndex(point=>point.speed>5 && point.power===0);
  slider.value=String(coast); slider.fire('input');
  assert.match(slider.getAttribute('aria-valuetext'),/target 80 km\/h · 0 kW/);
  assert.equal(parseInt(p.id('trace-reading').textContent),Math.round(points[coast].metres));
  assert.equal(parseFloat(p.id('trace-cursor').style.left),100*points[coast].tick/points.at(-1).tick);
  slider.value=slider.max; slider.fire('input');
  assert.equal(p.id('trace-reading').textContent,'432 m · 0 km/h · target 80 km/h · 0 kW');
  assert.equal(p.id('trace-time').textContent,p.id('trace-end').textContent);
  assert.equal(p.lines.length,draws,'scrubbing only moves the cursor');
  assert.equal(p.id('target-value').textContent,'0');
});

test('a run under inspection keeps its cursor across arrivals and falls back to the latest when it leaves history', () => {
  const p = makePage({app:false}), R = p.api.ride, s = R.createRide();
  const refresh = p.api.runSheet.bind(s.sheet), select = p.id('trace-leg'), slider = p.id('trace-sample');
  refresh();
  for (let i=0; i<8; i++) R.command(s,'faster');
  function arrive(n) {
    while (s.sheet.count < n) R.advance(s,0.1);
    refresh();
  }
  arrive(1); slider.value='3'; slider.fire('input');
  const reading = p.id('trace-reading').textContent;
  arrive(2); assert.equal(select.value,'1'); assert.equal(slider.value,'3');
  assert.equal(p.id('trace-reading').textContent,reading);
  select.value='2'; select.fire('change'); arrive(3); assert.equal(select.value,'3');
  select.value='1'; select.fire('change'); assert.match(select.children.at(-1).textContent,/Campus Gate/);
  arrive(5); assert.equal(select.value,'1'); assert.equal(select.children.length,5);
  arrive(6); assert.equal(select.value,'6'); assert.equal(select.children.length,5);
  assert.ok(select.children.every(option=>option.value !== '1'));
  assert.match(select.children[0].textContent,/6 · Kowloon Tong → Campus Gate/);
});
