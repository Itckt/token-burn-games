(function (root) {
  "use strict";
  function bind(canvas, {available, orbit, zoom, pick}) {
    const pointers = new Map();
    const separation = () => {
      const [a, b] = pointers.values();
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    function reset() {
      pointers.clear();
      canvas.classList.remove("dragging");
    }
    canvas.addEventListener("pointerdown", event => {
      if (!available() || event.button !== 0 || pointers.size >= 2) return;
      canvas.focus({preventScroll: true});
      canvas.setPointerCapture(event.pointerId);
      const {clientX: x, clientY: y} = event;
      pointers.set(event.pointerId, {x, y, startX: x, startY: y, tap: true});
      if (pointers.size === 2) for (const p of pointers.values()) p.tap = false;
      canvas.classList.add("dragging");
    });
    canvas.addEventListener("pointermove", event => {
      const p = pointers.get(event.pointerId);
      if (!p) return;
      const x = event.clientX, y = event.clientY;
      if (p.tap && Math.hypot(x-p.startX, y-p.startY) <= 5) return;
      const distance = pointers.size === 2 ? separation() : 0;
      const dx = x-p.x, dy = y-p.y;
      p.x = x; p.y = y; p.tap = false;
      if (pointers.size === 1) orbit(dx, dy);
      else if (distance > 2 && separation() > 2) zoom(distance / separation());
    });
    function end(event) {
      const p = pointers.get(event.pointerId);
      if (!p) return;
      pointers.delete(event.pointerId);
      canvas.classList.toggle("dragging", pointers.size > 0);
      if (event.type !== "pointerup" || !p.tap || !available()) return;
      const x = event.clientX, y = event.clientY;
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x-p.startX, y-p.startY) > 5) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const u = (x-rect.left)/rect.width, v = (y-rect.top)/rect.height;
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) pick(2*u-1, 1-2*v);
    }
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(name, end);
    canvas.addEventListener("wheel", event => {
      if (!available()) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
      zoom(Math.exp(FoundryMath.clamp(event.deltaY * unit, -300, 300) * 0.0014));
    }, {passive: false});
    return {reset};
  }
  root.FoundrySceneInput = {bind};
})(globalThis);
