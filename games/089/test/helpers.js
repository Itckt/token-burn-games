'use strict';

const assert = require('node:assert/strict');

function near(actual, expected, tolerance = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    actual + ' should be close to ' + expected);
}

function assertGeometry(w) {
  for (const [i, a] of w.balls.entries()) {
    assert.ok([a.x, a.y, a.vx, a.vy].every(Number.isFinite));
    assert.ok(a.x >= a.radius - 1e-7 && a.x <= w.width - a.radius + 1e-7, 'horizontal bounds');
    assert.ok(a.y >= a.radius - 1e-7 && a.y <= w.height - a.radius + 1e-7, 'vertical bounds');
    for (const b of [...w.balls.slice(i + 1), ...w.bumpers]) {
      assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= a.radius + b.radius - 1e-7,
        'ball ' + a.id + ' overlaps body ' + b.id);
    }
    for (const rail of w.rails) {
      const dx = rail.x2 - rail.x1, dy = rail.y2 - rail.y1;
      const projection = ((a.x - rail.x1) * dx + (a.y - rail.y1) * dy) / (dx * dx + dy * dy);
      const t = Math.max(0, Math.min(1, projection));
      const distance = Math.hypot(a.x - (rail.x1 + t * dx), a.y - (rail.y1 + t * dy));
      assert.ok(distance >= a.radius + rail.radius - 1e-7, 'ball ' + a.id + ' overlaps rail ' + rail.id);
    }
  }
}

module.exports = { near, assertGeometry };
