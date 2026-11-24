"use strict";

// Pointer capture keeps drags continuous outside the canvas. Only an unmoved,
// single-pointer release can turn a face.
function bindTwistViewport(canvas, orbit, turnFace, invalidate, trackPiece) {
  const points = new Map();
  const dragThreshold = 5;
  let dragged = false;

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || y < 0 || x > 1 || y > 1 || !rect.width || !rect.height) return;
    const hit = orbit.hit(2 * x - 1, 1 - 2 * y, rect.width / rect.height);
    if (!hit) return;
    if (event.altKey && trackPiece) trackPiece(hit);
    else if (hit.exterior !== false) turnFace(hit.face, event.shiftKey);
  }

  canvas.addEventListener("pointerdown", event => {
    if (event.button !== 0 || points.size >= 2) return;
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    points.set(event.pointerId, {
      x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY
    });
    dragged = points.size > 1;
    canvas.classList.toggle("dragging", dragged);
  });

  canvas.addEventListener("pointermove", event => {
    const point = points.get(event.pointerId);
    if (!point) return;
    const dx = event.clientX - point.x, dy = event.clientY - point.y;
    const startDx = event.clientX - point.startX, startDy = event.clientY - point.startY;
    point.x = event.clientX;
    point.y = event.clientY;
    if (points.size === 2) {
      const other = [...points.values()].find(p => p !== point);
      const before = Math.hypot(point.x - dx - other.x, point.y - dy - other.y);
      const after = Math.hypot(point.x - other.x, point.y - other.y);
      if (before >= 2 && after >= 2) orbit.zoomBy(before / after);
    } else if (dragged) {
      orbit.drag(dx, dy);
    } else {
      if (Math.hypot(startDx, startDy) < dragThreshold) return;
      dragged = true;
      canvas.classList.add("dragging");
      orbit.drag(startDx, startDy);
    }
    invalidate();
  });

  function forget(event) {
    points.delete(event.pointerId);
    if (!points.size) {
      dragged = false;
      canvas.classList.remove("dragging");
    }
  }
  canvas.addEventListener("pointerup", event => {
    const point = points.get(event.pointerId);
    if (!point) return;
    if (points.size === 1 && !dragged &&
        Math.hypot(event.clientX - point.startX, event.clientY - point.startY) < dragThreshold) {
      pick(event);
    }
    forget(event);
  });
  canvas.addEventListener("pointercancel", forget);
  canvas.addEventListener("lostpointercapture", forget);
  canvas.addEventListener("blur", () => {
    points.clear();
    dragged = false;
    canvas.classList.remove("dragging");
  });
  canvas.addEventListener("wheel", event => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    orbit.zoom(event.deltaY * unit);
    invalidate();
  }, { passive: false });
  canvas.addEventListener("keydown", event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    switch (event.key) {
      case "ArrowLeft": orbit.drag(-15, 0); break;
      case "ArrowRight": orbit.drag(15, 0); break;
      case "ArrowUp": orbit.drag(0, 12); break;
      case "ArrowDown": orbit.drag(0, -12); break;
      case "+": case "=": orbit.zoom(-120); break;
      case "-": case "_": orbit.zoom(120); break;
      case "Home": orbit.reset(); break;
      default: return;
    }
    event.preventDefault();
    invalidate();
  });
}

if (typeof module !== "undefined" && module.exports) module.exports = bindTwistViewport;
