(function () {
  'use strict';
  const { byId, write, element } = Nightline.dom;
  const { STATIONS } = Nightline.route;
  const { clockLabel, timingLabel, markLabel } = Nightline.service;

  function arrivalRow(entry) {
    const row = element('tr', ''), station = element('th', '', STATIONS[entry.to].name);
    station.setAttribute('scope', 'row');
    const timing = timingLabel(entry.seconds, entry.booked);
    row.append(station, element('td', '', clockLabel(entry.seconds)),
      element('td', '', clockLabel(entry.booked)), element('td', timing === 'On time' ? 'on-time' : '', timing),
      element('td', '', markLabel(entry.error, entry.atLimit)),
      element('td', '', entry.drawn.toFixed(2)), element('td', '', entry.returned.toFixed(2)),
      element('td', '', entry.arrivalClock || '—'));
    return row;
  }

  function plot(canvas, points) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio);
    const g = canvas.getContext('2d');
    g.scale(canvas.width / w, canvas.height / h);
    const duration = points.at(-1).tick || 1;
    const x = p => w * p.tick / duration;
    const y = kmh => 3 + (h - 6) * (1 - kmh / Nightline.ride.MAX_KMH);
    g.setLineDash([]); g.strokeStyle = '#334349'; g.lineWidth = 1;
    for (const kmh of [0, 40, 80]) {
      g.beginPath(); g.moveTo(0, y(kmh)); g.lineTo(w, y(kmh)); g.stroke();
    }
    g.beginPath(); g.moveTo(0, y(0));
    for (const p of points) g.lineTo(x(p), y(p.speed));
    g.lineTo(w, y(0)); g.closePath();
    const fill = g.createLinearGradient(0,0,0,h);
    fill.addColorStop(0,'rgba(118,198,178,.35)'); fill.addColorStop(1,'rgba(118,198,178,.04)');
    g.fillStyle = fill; g.fill();
    g.beginPath(); g.moveTo(0, y(points[0].speed));
    for (const p of points) g.lineTo(x(p), y(p.speed));
    g.strokeStyle = '#a7e0cb'; g.lineWidth = 2; g.stroke();
    function steps(field, dash, ink) {
      g.beginPath(); g.moveTo(0, y(points[0][field]));
      for (let i = 1; i < points.length; i++) {
        g.lineTo(x(points[i]), y(points[i-1][field])); g.lineTo(x(points[i]), y(points[i][field]));
      }
      g.setLineDash(dash); g.strokeStyle = ink; g.lineWidth = 1.5; g.stroke();
    }
    steps('target', [5,4], '#e5bd79');
    if (points[0].limit !== undefined) steps('limit', [2,3], '#aebcf3');
  }
  function clockAt(tick) {
    const tenths = Math.round(tick / 6);
    return clockLabel(tenths / 10) + '.' + tenths % 10;
  }

  function bind(sheet) {
    const selector = byId('trace-leg'), slider = byId('trace-sample'), canvas = byId('trace-plot');
    let lastCount = -1, entry = null, pinned = false;
    function draw() {
      if (entry && byId('run-sheet').open) plot(canvas, entry.trace);
    }
    function inspect() {
      if (!entry) return;
      const p = entry.trace[Number(slider.value)], last = entry.trace.at(-1);
      byId('trace-cursor').style.left = (last.tick ? 100 * p.tick / last.tick : 0) + '%';
      write('trace-time', clockAt(p.tick));
      const power = Math.round(p.power);
      const reading = Math.round(p.metres) + ' m · ' + Math.round(p.speed) + ' km/h · target ' +
        p.target + ' km/h · ' + (power > 0 ? '+' : '') + power + ' kW' +
        (p.limit === undefined ? '' : ' · limit ' + p.limit + ' km/h');
      write('trace-reading', reading);
      slider.setAttribute('aria-valuetext', clockAt(p.tick) + ' · ' + reading);
    }
    function select(next) {
      selector.value = String(next.number);
      if (entry === next) return;
      entry = next;
      const points = entry.trace;
      byId('trip-review').hidden = !entry.quality;
      if (entry.quality) write('review-forces', Nightline.duties.forces(entry.quality));
      byId('review-duty').hidden = !entry.duty;
      if (entry.duty) {
        const { card, passed, detail } = entry.duty;
        write('review-duty', Nightline.duties.cards[card] + ' · ' + (passed ? 'Completed' : 'Missed') +
          (card === 'smooth' ? '' : ' · ' + detail));
      }
      byId('trace-limit').hidden = points[0].limit === undefined;
      slider.max = String(points.length - 1);
      let peak = 0;
      for (let i = 1; i < points.length; i++) if (points[i].speed > points[peak].speed) peak = i;
      slider.value = String(peak);
      write('trace-end', clockAt(points.at(-1).tick));
      inspect(); draw();
    }
    selector.addEventListener('change', () => {
      const selected = sheet.entries.find(run => String(run.number) === selector.value);
      if (selected?.trace?.length) { pinned = selected.number !== sheet.count; select(selected); }
    });
    slider.addEventListener('input', () => { pinned = true; inspect(); });
    byId('run-sheet').addEventListener('toggle', draw);
    if (window.ResizeObserver) new ResizeObserver(draw).observe(canvas);
    else window.addEventListener('resize', draw);

    return function refresh() {
      if (lastCount === sheet.count) return;
      lastCount = sheet.count;
      const latest = sheet.entries[0], body = byId('sheet-rows');
      body.textContent = ''; selector.textContent = '';
      const recorded = sheet.entries.filter(run => run.trace?.length);
      for (const run of sheet.entries) {
        body.append(arrivalRow(run));
      }
      for (const run of recorded) {
        const option = element('option', '', run.number + ' · ' + STATIONS[run.from].name + ' → ' + STATIONS[run.to].name);
        option.value = String(run.number); selector.append(option);
      }
      const count = sheet.count + (sheet.count === 1 ? ' stop' : ' stops');
      write('sheet-summary', latest ? count + ' · ' + STATIONS[latest.to].name + ' · ' +
        timingLabel(latest.seconds, latest.booked) : count);
      byId('sheet-empty').hidden = Boolean(latest);
      byId('sheet-results').hidden = !latest; byId('cab-recorder').hidden = !recorded.length;
      pinned = pinned && recorded.includes(entry);
      if (recorded.length) select(pinned ? entry : recorded[0]);
      else entry = null;
    };
  }
  Nightline.runSheet = { bind };
})();
