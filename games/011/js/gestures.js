(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const { clamp } = common ? require("./math.js") : root.Isobar.math;

  function bind(canvas, listen, { available, probing, pick, turn, magnify, pageHeight }) {
    const pointers = new Map();
    const tapSlop = 5;
    function span() {
      const [a, b] = pointers.values();
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
    listen(canvas, "pointerdown", event => {
      if (!available() || event.button !== 0 || pointers.size >= 2) return;
      const x = event.clientX, y = event.clientY;
      const tap = probing() && pointers.size === 0;
      for (const p of pointers.values()) p.tap = false;
      pointers.set(event.pointerId, { x, y, startX: x, startY: y, tap });
      canvas.setPointerCapture(event.pointerId);
      canvas.focus({ preventScroll: true });
    });
    listen(canvas, "pointermove", event => {
      const p = pointers.get(event.pointerId);
      if (!p) return;
      const x = event.clientX, y = event.clientY;
      const two = pointers.size === 2, before = two ? span() : 0;
      let dx = x - p.x, dy = y - p.y;
      p.x = x; p.y = y;
      if (p.tap) {
        dx = x - p.startX; dy = y - p.startY;
        if (Math.hypot(dx, dy) <= tapSlop) return;
        p.tap = false;
      }
      if (two) {
        const after = span();
        if (after > 2 && before > 2) magnify(before / after);
      } else {
        turn(dx, dy);
      }
    });
    listen(canvas, "pointerup", event => {
      const p = pointers.get(event.pointerId);
      pointers.delete(event.pointerId);
      if (p && p.tap && probing() && Math.hypot(event.clientX - p.startX, event.clientY - p.startY) <= tapSlop) {
        pick(event.clientX, event.clientY);
      }
    });
    for (const type of ["pointercancel", "lostpointercapture"]) {
      listen(canvas, type, event => pointers.delete(event.pointerId));
    }
    listen(canvas, "wheel", event => {
      if (!available()) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageHeight() : 1;
      magnify(Math.exp(clamp(event.deltaY * unit, -260, 260) * 0.00135));
    }, { passive: false });
    return () => pointers.clear();
  }

  if (common) module.exports = { bind };
  else (root.Isobar ||= {}).gestures = { bind };
})(globalThis);
