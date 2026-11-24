(function (root) {
  'use strict';
  const G = root.CupMeshes, P = root.CupPacking, D = root.CupDesign;
  const byId = id => document.getElementById(id);
  const headings = {
    fit: ['Where will it catch?', 'Change the block size or straighten the walls. The opening and the depth of the cup stay fixed.'],
    forces: ['What carries the weight?', 'Model the two sides as smooth, symmetric supports. Each wall pushes perpendicular to its slope. Change the mass or give the block a floor seat.'],
    scan: ['What crosses this slice?', 'Move the violet sheet up the cup. The plan view traces the dry noodles where they cross it.'],
    pour: ['How much fits below?', 'Add water to the lower pocket. The meter stops when the pool reaches the lowest dry curl.'],
    press: ['Can a knock reach the curls?', 'Raise a flat test pad from the floor. Compare your block with a 72 mm floor-seated block under the same push.'],
    finder: ['Which blocks meet the brief?', 'Set the water volume needed under the dry block and the space needed above it. Each dot represents one available diameter.']
  };
  const scanNotes = {
    'Cup floor':'The sheet lies on the cup floor. The block is suspended above it.',
    'Floor contact':'The lowest curl touches the floor at this height.',
    'Air pocket':'Here the sheet passes under every curl. Only the cup wall meets it.',
    'Above the block':'The sheet has cleared the highest dry curl.',
    'Noodle contours':'Each gold outline follows a cut through a strand. The spaces between outlines are open.',
    'Between strands':'The sheet crosses no strand interiors at this height.'
  };
  function write(id, text) {
    const node = byId(id);
    if (node.textContent !== text) node.textContent = text;
  }
  function readings(first, a, second, b, result) {
    write('reading-one', first); write('bench-gap', a);
    write('reading-two', second); write('bench-support', b);
    write('bench-result', result);
  }

  function mount(specimen, changed) {
    const diameter = byId('diameter'), height = byId('scan-height'), dose = byId('dose');
    const travel = byId('press-travel'), taperControl = byId('taper');
    const pocketGoal = byId('pocket-goal'), roomGoal = byId('room-goal');
    const dry = root.CupLesson.scene(0);
    let tool = 'fit', fit = P.fit(specimen.profile), scene, heightMM = 50, amountML = 50, travelMM = 6;
    let mapping = false, sizes, measuredTaper;

    function showFit() {
      byId('wall-map').setAttribute('aria-pressed', String(mapping));
      if (mapping) {
        const map = D.wallMap(specimen.mesh,fit);
        scene.contactMap = map;
        readings('Closest wall gap', D.gapLabel(map.closestMM), 'Within '+D.closeMM+' mm', map.closeCount+' of '+D.sectors+' arcs',
          (fit.onFloor ? 'The floor supports this block. ' : 'A curl meets the wall at the seating height. ')+
          'Each arc shows the smallest horizontal gap measured in that part of the cup.');
        return;
      }
      readings('Clearance below', fit.gapMM.toFixed(1)+' mm', 'Supported by', fit.onFloor ? 'Cup floor' : 'Sloping wall',
        fit.taper === 0 ? 'The cup is as wide at the floor as at the rim. The block slides all the way down.' :
          fit.onFloor ? 'This block fits through the taper all the way to the floor.' :
          'The edges meet the taper before the block reaches the floor.');
    }
    function showForces() {
      const mass = byId('block-mass');
      const f = D.supportForces(fit,Number(mass.value));
      scene.forces = f;
      mass.value = f.massG;
      write('mass-value',f.massG+' g');
      mass.setAttribute('aria-valuetext',f.massG+' grams');
      readings('Downward weight', f.weightN.toFixed(2)+' N', fit.onFloor ? 'Floor reaction' : 'Push from each wall',
        f.reactionN.toFixed(2)+' N', fit.onFloor ?
          'The floor carries the full weight. The walls supply no upward force in this fit.' :
          'Each wall supplies '+f.upN.toFixed(2)+' N upward. Those components add, and the two inward pushes cancel.');
    }
    // Keep a selectable plane inside a pocket thinner than a 1 mm detent.
    function scanStep() {
      return fit.gapMM > 0 && fit.gapMM <= 1 ? 10 ** Math.floor(Math.log10(fit.gapMM/2)) : 1;
    }
    function showScan() {
      const step = scanStep();
      const scan = root.CupSlices.scan(specimen.mesh, fit, Math.round(heightMM/step)*step);
      scene.scan = scan;
      heightMM = scan.heightMM;
      height.step = step;
      height.value = heightMM;
      write('scan-value', scan.heightLabel);
      height.setAttribute('aria-valuetext', scan.heightLabel+' above the floor, '+scan.region.toLowerCase());
      byId('scan-gap').disabled = fit.onFloor;
      readings('Inside width', (2 * scan.radius * P.mmPerUnit).toFixed(1)+' mm', 'At this height', scan.region, scanNotes[scan.region]);
    }
    function showPour() {
      const meter = P.meteredPour(fit, amountML);
      amountML = meter.amountML;
      scene.meter = meter;
      scene.surfaceY = meter.surfaceY;
      scene.water = meter.surfaceY - G.FLOOR;
      // Whole-mL detents, with an exact fractional last dose at first contact.
      dose.max = Math.ceil(meter.capacityML);
      dose.value = amountML === meter.capacityML ? dose.max : Math.round(amountML);
      dose.disabled = byId('pour-empty').disabled = byId('pour-full').disabled = fit.onFloor;
      const added = Number.isInteger(amountML) ? amountML : amountML.toFixed(1);
      write('dose-value', added+' mL');
      dose.setAttribute('aria-valuetext', added+' mL, water depth '+meter.depthMM.toFixed(1)+' mm');
      const airMM = fit.gapMM - meter.depthMM;
      const remaining = airMM < 0.1 ? 'Less than 0.1' : airMM.toFixed(1);
      const result = fit.onFloor ? 'The lowest curl rests on the floor. A steeper wall or a wider block can open a pocket.' :
        amountML === 0 ? 'The pocket is empty. Add water to measure how much it holds.' :
        amountML === meter.capacityML ? 'The surface just touches the underside. A further pour would rise among the curls.' :
        remaining+' mm of air still separates the pool from the lowest curl.';
      readings('Pocket capacity', meter.capacityML.toFixed(1)+' mL', 'Water depth', meter.depthMM.toFixed(1)+' mm', result);
    }
    function showPress() {
      const press = P.press(fit, travelMM);
      const floorFit = P.fit(specimen.profile,P.minDiameter,fit.taper);
      travelMM = press.travelMM;
      scene.press = press;
      scene.reference = {fit:floorFit, press:P.press(floorFit, travelMM)};
      scene.lift = press.lift;
      scene.bottom += press.lift;
      scene.top += press.lift;
      travel.value = travelMM.toFixed(1);
      write('press-value', travelMM.toFixed(1)+' mm');
      const touch = byId('press-touch');
      touch.disabled = fit.gapMM > P.maxPressMM;
      touch.title = touch.disabled ? 'First contact is beyond the 8 mm pad travel' : 'Stop exactly at the lowest curl';
      const status = press.liftMM > 0 ? 'The pad carries the block upward.' :
        press.touching ? 'First contact. The pad just meets the lowest curl.' : 'The block stays on the wall. There is still air above the pad.';
      travel.setAttribute('aria-valuetext', travelMM.toFixed(1)+' mm. '+status);
      readings('Clearance left', D.gapLabel(press.clearanceMM), 'Block lift', D.gapLabel(press.liftMM), status);
    }
    function showFinder() {
      if (measuredTaper !== fit.taper) {
        sizes = D.measureSizes(specimen.profile,fit.taper);
        measuredTaper = fit.taper;
      }
      const brief = D.findFits(sizes,Number(pocketGoal.value),Number(roomGoal.value));
      scene.brief = brief;
      const {matches, pocketML, roomMM} = brief;
      write('pocket-goal-value', pocketML+' mL');
      write('room-goal-value', roomMM+' mm');
      pocketGoal.setAttribute('aria-valuetext', pocketML+' millilitres minimum');
      roomGoal.setAttribute('aria-valuetext', roomMM+' millimetres minimum');
      const matchRange = !matches.length ? 'No matching sizes' : matches.length === 1 ? matches[0].diameter+' mm only' :
        matches[0].diameter+'–'+matches.at(-1).diameter+' mm match';
      write('fit-matches', matchRange);
      byId('apply-fit').disabled = !matches.length;
      const current = sizes.find(s => s.diameter === fit.diameter);
      const missing = [];
      if (current.capacityML < pocketML) missing.push('a larger pocket');
      if (current.headroomMM < roomMM) missing.push('more room above the block');
      const result = missing.length ? 'The '+fit.diameter+' mm block needs '+missing.join(' and ')+'.' :
        'The '+fit.diameter+' mm block meets both targets.';
      readings('Pocket capacity', current.capacityML.toFixed(1)+' mL', 'Room above', current.headroomMM.toFixed(1)+' mm', result);
    }
    const instruments = {fit:showFit, forces:showForces, scan:showScan, pour:showPour, press:showPress, finder:showFinder};
    function update() {
      scene = {...dry, fit, bottom:fit.bottom, top:fit.top, yaw:0.16, pitch:0.25};
      diameter.value = fit.diameter;
      write('diameter-value', fit.diameter+' mm');
      diameter.setAttribute('aria-valuetext', fit.diameter+' mm, '+fit.gapMM.toFixed(1)+' mm clearance');
      const degrees = Math.atan(G.wallSlope * fit.taper) * 180 / Math.PI;
      taperControl.value = Math.round(fit.taper * 100);
      write('taper-value', degrees.toFixed(1)+'°');
      taperControl.setAttribute('aria-valuetext', degrees.toFixed(1)+' degrees from vertical');
      write('packing-title', headings[tool][0]);
      write('bench-copy', headings[tool][1]);
      for (const name of Object.keys(instruments)) {
        byId('tool-'+name).setAttribute('aria-pressed', String(name === tool));
        byId(name+'-controls').hidden = tool !== name;
      }
      byId('bench-inset').classList.toggle('scanning', tool === 'scan');
      byId('bench-inset').classList.toggle('pressing', tool === 'press');
      byId('bench-inset').classList.toggle('finding', tool === 'finder');
      byId('bench-inset').classList.toggle('mapping', tool === 'fit' && mapping);
      byId('bench-inset').classList.toggle('forces', tool === 'forces');
      instruments[tool]();
    }
    function setHeight(stop) {
      const mm = stop === 'gap' ? fit.gapMM / 2 : (0.5 * (fit.bottom + fit.top) - G.FLOOR) * P.mmPerUnit;
      heightMM = mm;
    }
    function open({diameter:width, tool:instrument = tool, stop, taper = 1} = {}) {
      // Lesson links describe a particular specimen. Ordinary bench visits
      // retain the learner's current cup, block and instrument.
      if (width !== undefined) {
        fit = P.fit(specimen.profile,Math.round(width),taper);
        mapping = false;
      }
      tool = instrument;
      if (stop) setHeight(stop);
      update();
    }

    function refit(width, taper) {
      fit = P.fit(specimen.profile,Math.round(width),taper);
      update(); changed(false);
    }
    for (const name of Object.keys(instruments)) byId('tool-'+name).addEventListener('click', () => {
      if (tool === name) return;
      open({tool:name}); changed(true);
    });
    diameter.addEventListener('input', () => refit(Number(diameter.value),fit.taper));
    taperControl.addEventListener('input', () => refit(fit.diameter,Number(taperControl.value)/100));
    byId('block-mass').addEventListener('input', () => { update(); changed(false); });
    byId('wall-map').addEventListener('click', () => { mapping = !mapping; update(); changed(mapping); });
    for (const goal of [pocketGoal,roomGoal]) goal.addEventListener('input', () => { update(); changed(false); });
    byId('apply-fit').addEventListener('click', () => {
      const first = scene.brief?.matches[0];
      if (first) refit(first.diameter,fit.taper);
    });
    height.addEventListener('input', () => { heightMM = Number(height.value); update(); changed(false); });
    for (const stop of ['gap','block']) byId('scan-'+stop).addEventListener('click', () => {
      setHeight(stop); update(); changed(false);
    });
    dose.addEventListener('input', () => { amountML = Number(dose.value); update(); changed(false); });
    byId('pour-empty').addEventListener('click', () => { amountML = 0; update(); changed(false); });
    byId('pour-full').addEventListener('click', () => { amountML = P.volumeBelow(fit.bottom,fit.taper); update(); changed(false); });
    function push(mm) { travelMM = mm; update(); changed(false); }
    travel.addEventListener('input', () => push(Number(travel.value)));
    byId('press-rest').addEventListener('click', () => push(0));
    byId('press-touch').addEventListener('click', () => { if (fit.gapMM <= P.maxPressMM) push(fit.gapMM); });
    byId('press-peak').addEventListener('click', () => push(P.maxPressMM));
    return {open, get scene() { return scene; }};
  }
  root.CupBench = {mount};
})(globalThis);
