(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'));
  else root.HarbourLanterns = factory(root.HarbourMath);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';
  const origin = [4, 45, -17];
  const names = ['Twin Sails', 'Three Currents', 'Night Bloom'];
  const hold = 10, travel = 6, leg = hold + travel, period = leg * names.length;
  const perStroke = 24, count = perStroke * 3, STRIDE = 14;
  const colors = [[1, 0.76, 0.39], [1, 0.39, 0.27], [0.39, 0.90, 0.83]];
  const nextFormation = time => M.nextOccurrence(time, leg);

  function cue(time) {
    const elapsed = M.wrap(time, period);
    const index = Math.floor(elapsed / leg), next = (index + 1) % names.length;
    const t = M.clamp((elapsed - index * leg - hold) / travel, 0, 1);
    const ease = M.ease(t);
    const weights = [0, 0, 0];
    weights[index] = 1 - ease;
    weights[next] = ease;
    return {weights, label: t === 0 ? names[index] : 'Forming ' + names[next]};
  }

  // Walk the perimeter by length so long spars and short gunwales have the
  // same lamp spacing. Each stroke is closed without duplicating its first lamp.
  function outline(points) {
    const edges = points.map((p, i) => {
      const next = points[(i + 1) % points.length];
      return {p, next, length: Math.hypot(next[0] - p[0], next[1] - p[1])};
    });
    const length = edges.reduce((sum, edge) => sum + edge.length, 0);
    return Array.from({length: perStroke}, (_, i) => {
      let d = length * i / perStroke;
      for (const edge of edges) {
        if (d <= edge.length) return edge.p.map((value, k) => M.mix(value, edge.next[k], d / edge.length));
        d -= edge.length;
      }
      return points[0].slice();
    });
  }
  const sails = [
    [[-11, -1.8], [-6.3, -5.9], [5.5, -5.9], [11, -1.3], [4, -2.8], [-5.8, -2.8]],
    [[0.65, -1.5], [0.65, 8.1], [4.6, 5.3], [8.9, -0.7]],
    [[-8.7, -1.55], [-1.0, 5.8], [-1.0, -1.55]]
  ].flatMap(outline);
  function poses(index) {
    const stroke = Math.floor(index / perStroke), u = (index % perStroke) / (perStroke - 1);
    const [sx, sy] = sails[index];
    const angle = M.TAU * index / count;
    const radius = 6.2 + 2.65 * Math.cos(5 * (angle - Math.PI / 2));
    const wave = M.TAU * (1.13 * u + stroke * 0.13);
    return [
      [sx, sy, stroke === 0 ? 0.4 : 1.3 * Math.sin(Math.PI * u)],
      [M.mix(-11.3, 11.3, u), (stroke - 1) * 4.1 + 1.85 * Math.sin(wave), 1.9 * Math.cos(wave)],
      [1.12 * radius * Math.cos(angle), radius * Math.sin(angle), 1.8 * Math.cos(5 * angle)]
    ];
  }
  function buildMesh() {
    const vertices = new Float32Array(count * 4 * STRIDE), indices = new Uint16Array(count * 6);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let lamp = 0; lamp < count; lamp++) {
      const anchors = poses(lamp).flat(), color = colors[Math.floor(lamp / perStroke)];
      const first = lamp * 4;
      corners.forEach((corner, i) => vertices.set([...anchors, ...corner, ...color], (first + i) * STRIDE));
      indices.set([first, first + 1, first + 2, first, first + 2, first + 3], lamp * 6);
    }
    return [{vertices, indices}];
  }
  return {origin, names, hold, travel, period, count, STRIDE, cue, nextFormation, poses, buildMesh};
});
