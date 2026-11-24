'use strict';

const CourtGeometry = (() => {
  const RELATIVE_CONTACT_EPS = 1e-11;

  // The discriminant contains products of four lengths/speeds. Change units
  // at the extremes so squaring a slow drift or a fast shot retains precision.
  function quadraticUnit(magnitude) {
    return magnitude > 0 && (magnitude < 1e-70 || magnitude > 1e70) ? magnitude : 1;
  }

  // Solve |relative position + relative velocity * t| = sum of radii.
  function pairTime(a, b, resolvingInstant) {
    const bx = b.vx ?? 0;
    const by = b.vy ?? 0;
    let vx = bx - a.vx;
    let vy = by - a.vy;
    if (vx === 0 && vy === 0) return Infinity;
    let speedUnit = quadraticUnit(Math.max(Math.abs(vx), Math.abs(vy)));
    if (Number.isFinite(speedUnit)) {
      vx /= speedUnit;
      vy /= speedUnit;
    } else {
      // Two finite velocities can have an unrepresentably large difference.
      speedUnit = Math.max(Math.abs(bx), Math.abs(by), Math.abs(a.vx), Math.abs(a.vy));
      vx = bx / speedUnit - a.vx / speedUnit;
      vy = by / speedUnit - a.vy / speedUnit;
    }
    const lengthUnit = quadraticUnit(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), a.radius + b.radius));
    const dx = (b.x - a.x) / lengthUnit;
    const dy = (b.y - a.y) / lengthUnit;
    const approach = -(dx * vx + dy * vy);
    if (approach <= 0) return Infinity;

    const radius = (a.radius + b.radius) / lengthUnit;
    const speedSq = vx * vx + vy * vy;
    const cross = dx * vy - dy * vx;
    const discriminant = radius * radius * speedSq - cross * cross;
    // A tangent trajectory has zero normal speed and needs no impulse.
    if (discriminant <= 0) return Infinity;

    const distance = Math.hypot(dx, dy);
    if (distance <= radius * (1 + RELATIVE_CONTACT_EPS)) {
      // Subtracting two large, similar velocities can leave a tiny inward
      // component after an inelastic impact. Scale to the original operands.
      const dotRoundoff = 16 * Number.EPSILON * (
        Math.abs(dx) * (Math.abs(a.vx / speedUnit) + Math.abs(bx / speedUnit)) +
        Math.abs(dy) * (Math.abs(a.vy / speedUnit) + Math.abs(by / speedUnit))
      );
      if (approach <= dotRoundoff) return Infinity;
      // A small positive gap can take seconds to close at a slow drift.
      // Only group roundoff-sized gaps while resolving a simultaneous impact.
      if (distance <= radius || (resolvingInstant && distance - radius <= 8 * Number.EPSILON * radius)) return 0;
    }
    // This form of the smaller root avoids cancellation near contact.
    return (distance - radius) * (distance + radius) /
      (approach + Math.sqrt(discriminant)) * lengthUnit / speedUnit;
  }

  function segmentAxis({ x1, y1, x2, y2 }) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    return { tx: dx / length, ty: dy / length, length };
  }

  // Vector from a point to the nearest point on the rail's center segment.
  function towardRail(rail, x, y) {
    const { tx, ty, length } = segmentAxis(rail);
    const dx = x - rail.x1, dy = y - rail.y1;
    const along = dx * tx + dy * ty;
    if (along <= 0) return { x: -dx, y: -dy };
    if (along >= length) return { x: rail.x2 - x, y: rail.y2 - y };
    const across = tx * dy - ty * dx;
    return { x: ty * across, y: -tx * across };
  }

  function railDistance(rail, x, y) {
    const offset = towardRail(rail, x, y);
    return Math.hypot(offset.x, offset.y);
  }

  function railSeparation(a, b) {
    // Intersecting interiors can be close even when all four endpoints are far away.
    function straddles(line, segment) {
      const { tx, ty } = segmentAxis(line);
      const side = (x, y) => tx * (y - line.y1) - ty * (x - line.x1);
      return Math.sign(side(segment.x1, segment.y1)) * Math.sign(side(segment.x2, segment.y2)) < 0;
    }
    if (straddles(a, b) && straddles(b, a)) return 0;
    return Math.min(railDistance(a, b.x1, b.y1), railDistance(a, b.x2, b.y2),
      railDistance(b, a.x1, a.y1), railDistance(b, a.x2, a.y2));
  }

  function railTime(ball, rail, resolvingInstant) {
    const { tx, ty } = segmentAxis(rail);
    const dx = ball.x - rail.x1, dy = ball.y - rail.y1;
    const across = tx * dy - ty * dx;
    const radius = ball.radius + rail.radius;
    const unit = quadraticUnit(Math.max(Math.abs(ball.vx), Math.abs(ball.vy)));
    const vx = ball.vx / unit, vy = ball.vy / unit;
    const inward = -Math.sign(across) * (tx * vy - ty * vx);
    const gap = Math.abs(across) - radius;
    const roundoff = 16 * Number.EPSILON * (Math.abs(tx * vy) + Math.abs(ty * vx));
    // The face and cap solve different equations at their shared seam. Allow
    // for rounding in the projected contact point so neither can miss the join.
    function onEndSide(x, y, direction, time) {
      const px = ball.x - x, py = ball.y - y;
      const mx = ball.vx * time, my = ball.vy * time;
      const along = tx * (px + mx) + ty * (py + my);
      const scale = Math.max(Math.abs(px), Math.abs(py), Math.abs(mx), Math.abs(my), radius);
      return direction * along >= -16 * Number.EPSILON * scale;
    }
    let first = Infinity;
    if (inward > 0 && (gap > radius * RELATIVE_CONTACT_EPS || inward > roundoff)) {
      const distance = resolvingInstant && gap <= 8 * Number.EPSILON * radius ? 0 : Math.max(0, gap);
      const time = distance / inward / unit;
      if (Number.isFinite(time) && onEndSide(rail.x1, rail.y1, 1, time) && onEndSide(rail.x2, rail.y2, -1, time)) {
        first = time;
      }
    }

    // Only the outward semicircle of each cap is exposed to the ball.
    function cap(x, y, outward) {
      const time = pairTime(ball, { x, y, radius: rail.radius }, resolvingInstant);
      if (time < first && onEndSide(x, y, outward, time)) first = time;
    }
    cap(rail.x1, rail.y1, -1);
    cap(rail.x2, rail.y2, 1);
    return first;
  }

  // A gate observes the half-open flight (start, end]. A second flight that
  // leaves the line, including after a rebound, cannot count the arrival again.
  function gateCrossing(gate, ball, startX, startY) {
    const { tx, ty, length } = segmentAxis(gate);
    // Use the same origin for either endpoint order so reversing a gate
    // changes only its direction label, even for coincident timing lines.
    const reversed = gate.x1 > gate.x2 || (gate.x1 === gate.x2 && gate.y1 > gate.y2);
    const originX = reversed ? gate.x2 : gate.x1;
    const originY = reversed ? gate.y2 : gate.y1;
    function side(x, y) {
      const a = (x - originX) * ty;
      const b = (y - originY) * tx;
      const roundoff = 8 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b));
      return Math.abs(a - b) <= roundoff ? 0 : a - b;
    }
    const from = side(startX, startY);
    const to = side(ball.x, ball.y);
    if (from === 0 || Math.sign(from) === Math.sign(to)) return null;

    const fraction = to === 0 ? 1 : from / (from - to);
    const x = to === 0 ? ball.x : startX + fraction * (ball.x - startX);
    const y = to === 0 ? ball.y : startY + fraction * (ball.y - startY);
    const along = ((x - originX) * tx + (y - originY) * ty) * (reversed ? -1 : 1);
    const tolerance = 8 * Number.EPSILON * length;
    if (along < -tolerance || along > length + tolerance) return null;

    // Recover the travel time from incoming velocity, even when a slowing
    // ball's position has rounded all the way to its asymptotic stopping point.
    const unit = quadraticUnit(Math.max(Math.abs(ball.vx), Math.abs(ball.vy)));
    const normalSpeed = (ball.vx / unit) * ty - (ball.vy / unit) * tx;
    const travel = -from / normalSpeed / unit;
    if (!Number.isFinite(travel) || travel < 0 || normalSpeed === 0) return null;
    return { x, y, travel, direction: from < 0 ? 'forward' : 'reverse' };
  }

  return { RELATIVE_CONTACT_EPS, quadraticUnit, pairTime, railTime, towardRail, railDistance, railSeparation,
    segmentAxis, gateCrossing };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CourtGeometry;
