'use strict';

const CourtReport = (() => {
  const { railDistance } = typeof module !== 'undefined' && module.exports
    ? require('./court-geometry.js') : CourtGeometry;

  function describeImpact(event) {
    const ball = 'Ball ' + event.ballId;
    if (event.type === 'wall') return ball + ' hit the ' + event.wall + ' wall';
    if (event.type === 'bumper') return ball + ' hit bumper ' + event.bumperId;
    if (event.type === 'rail') return ball + ' hit rail ' + event.railId;
    return ball + ' hit ball ' + event.otherBallId;
  }

  function describeCrossing(event) {
    return 'Ball ' + event.ballId + ' crossed G' + event.gateId + ' ' + event.direction +
      ' at ' + Math.hypot(event.vx, event.vy).toFixed(2) + ' u/s';
  }

  function impactTargets(world) {
    const targets = [
      { value: 'any', label: 'Any impact', matches: () => true },
      { value: 'pair', label: 'Any ball pair', matches: e => e.type === 'ball' }
    ];
    for (const wall of ['left', 'right', 'top', 'bottom']) {
      targets.push({ value: 'wall:' + wall, label: 'Wall · ' + wall, fixed: true, matches: e => e.wall === wall });
    }
    for (const { id } of world.balls) {
      targets.push({ value: 'ball:' + id, label: 'Ball ' + id,
        matches: e => e.ballId === id || e.otherBallId === id });
    }
    for (const { id } of world.bumpers) {
      targets.push({ value: 'bumper:' + id, label: 'Bumper B' + id, fixed: true, matches: e => e.bumperId === id });
    }
    for (const { id } of world.rails) {
      targets.push({ value: 'rail:' + id, label: 'Rail R' + id, fixed: true, matches: e => e.railId === id });
    }
    return targets;
  }

  function describeForecast({ ballId, complete, points }) {
    const end = points.at(-1);
    const hits = points.reduce((total, point) => total + point.hits, 0);
    return 'Ball ' + ballId + ' reaches (' + end.x.toFixed(1) + ', ' + end.y.toFixed(1) +
      ') at ' + end.time.toFixed(3) + ' s after ' + hits + (hits === 1 ? ' impact.' : ' impacts.') +
      (complete ? '' : ' The forecast stopped at the collision limit.');
  }

  function renderAscii(world, name) {
    const columns = 72;
    const rows = 20;
    const cellWidth = world.width / columns;
    const cellHeight = world.height / rows;
    const grid = Array.from({ length: rows }, (_, row) => {
      const line = Array(columns).fill(' ');
      if (row % 2 === 0) line[columns / 2] = ':';
      return line;
    });

    function paint(x1, y1, x2, y2, mark, contains) {
      const left = Math.max(0, Math.floor(x1 / cellWidth));
      const right = Math.min(columns - 1, Math.floor(x2 / cellWidth));
      const top = Math.max(0, Math.floor(y1 / cellHeight));
      const bottom = Math.min(rows - 1, Math.floor(y2 / cellHeight));
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          if (contains((x + 0.5) * cellWidth, (y + 0.5) * cellHeight)) grid[y][x] = mark;
        }
      }
    }

    function disc({ x, y, radius }, mark) {
      paint(x - radius, y - radius, x + radius, y + radius, mark,
        (cx, cy) => Math.hypot(cx - x, cy - y) <= radius);
    }

    function label(body, text) {
      const row = Math.min(rows - 1, Math.floor(body.y / cellHeight));
      const center = Math.floor(body.x / cellWidth);
      const left = Math.max(0, Math.min(columns - text.length, center - Math.floor(text.length / 2)));
      for (let i = 0; i < text.length; i++) grid[row][left + i] = text[i];
    }

    function segment(body, radius, mark) {
      const { x1, x2, y1, y2 } = body;
      paint(Math.min(x1, x2) - radius, Math.min(y1, y2) - radius,
        Math.max(x1, x2) + radius, Math.max(y1, y2) + radius, mark,
        (x, y) => railDistance(body, x, y) <= radius);
    }
    function segmentLabel(body, prefix) {
      label({ x: body.x1 + (body.x2 - body.x1) / 2, y: body.y1 + (body.y2 - body.y1) / 2 }, prefix + body.id);
    }

    for (const gate of world.gates) segment(gate, Math.hypot(cellWidth, cellHeight) / 2, '.');
    for (const rail of world.rails) segment(rail, rail.radius, '=');
    for (const bumper of world.bumpers) disc(bumper, '#');
    for (const ball of world.balls) disc(ball, 'o');
    for (const gate of world.gates) segmentLabel(gate, 'G');
    for (const rail of world.rails) segmentLabel(rail, 'R');
    for (const bumper of world.bumpers) label(bumper, 'B' + bumper.id);
    for (const ball of world.balls) label(ball, ball.id.toString(36).toUpperCase());
    const edge = '+' + '-'.repeat(columns) + '+';
    const counts = 'Time ' + world.time.toFixed(2) + ' s  |  Balls ' + world.balls.length +
      '  |  Ball hits ' + world.ballHits + '  |  Wall hits ' + world.wallHits;
    return [
      'Impulse Court | ' + name,
      edge, ...grid.map(line => '|' + line.join('') + '|'), edge,
      counts + (world.bumpers.length ? '  |  Bumper hits ' + world.bumperHits : '') +
        (world.rails.length ? '  |  Rail hits ' + world.railHits : ''),
      'Kinetic energy ' + world.kineticEnergy.toFixed(2) + (world.drag ? '  |  Linear drag ' + world.drag + ' /s' : ''),
      ...world.gates.map(g => 'G' + g.id + ' crossings  |  Forward ' + g.counts.forward + '  |  Reverse ' + g.counts.reverse),
      ...Object.entries(world.surfaceRestitution).map(([surface, e]) => 'Surface elasticity  |  ' + surface + ' = ' + e),
      ...(world.balls.length > 9 ? ['Ball labels use base 36 (A = 10, Z = 35, 10 = 36).'] : [])
    ].join('\n');
  }

  return { describeImpact, describeCrossing, describeForecast, impactTargets, renderAscii };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CourtReport;
