(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const { clamp } = common ? require("./math.js") : root.OrbitAtlas.math;

  function fillSelect(doc, select, items) {
    const options = new Map();
    for (const item of items) {
      const option = doc.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      select.append(option);
      options.set(item.id, option);
    }
    return options;
  }

  function bindDialog(doc, dialog, opener, closer, firstFocus, prepare) {
    let previousFocus;
    function open(...args) {
      if (dialog.open) return;
      previousFocus = doc.activeElement;
      dialog.showModal();
      if (prepare) prepare(...args);
      firstFocus.focus();
    }
    opener.addEventListener("click", () => open());
    closer.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
      const canRestore = previousFocus && previousFocus !== doc.body && previousFocus.isConnected !== false
        && !previousFocus.disabled && !previousFocus.hidden && !previousFocus.closest?.("[hidden]");
      (canRestore ? previousFocus : opener).focus();
    });
    dialog.addEventListener("click", event => {
      if (event.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
    });
    return open;
  }

  function bindGestures(canvas, camera, { available, pick, select, follow }) {
    const pointers = new Map();
    function pointerDistance() {
      const [a, b] = pointers.values();
      return Math.hypot(a.x - b.x, a.y - b.y);
    }
    function hit(event) {
      const rect = canvas.getBoundingClientRect();
      return pick(event.clientX - rect.left, event.clientY - rect.top);
    }
    const traveled = (p, x, y) => Math.hypot(x - p.startX, y - p.startY) > 3;
    canvas.addEventListener("pointerdown", event => {
      if (!available() || event.button !== 0) return;
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      const x = event.clientX, y = event.clientY;
      pointers.set(event.pointerId, { x, y, startX: x, startY: y, moved: false });
      if (pointers.size > 1) for (const p of pointers.values()) p.moved = true;
      canvas.classList.add("dragging");
    });
    canvas.addEventListener("pointermove", event => {
      const p = pointers.get(event.pointerId);
      if (!p) return;
      const two = pointers.size === 2, before = two ? pointerDistance() : 0;
      const dx = event.clientX - p.x, dy = event.clientY - p.y;
      p.x = event.clientX; p.y = event.clientY;
      if (traveled(p, p.x, p.y)) p.moved = true;
      if (two) {
        const after = pointerDistance();
        if (before > 1 && after > 1) camera.zoomBy(before / after);
      } else if (pointers.size === 1 && p.moved) camera.orbit(dx, dy);
    });
    function finish(event) {
      const p = pointers.get(event.pointerId);
      if (!p) return;
      pointers.delete(event.pointerId);
      if (!pointers.size) canvas.classList.remove("dragging");
      if (event.type === "pointerup" && !p.moved && !traveled(p, event.clientX, event.clientY)) {
        const id = hit(event);
        if (id) select(id);
      }
    }
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(type, finish);
    canvas.addEventListener("dblclick", event => {
      const id = available() && hit(event);
      if (id) follow(id);
    });
    canvas.addEventListener("wheel", event => {
      if (!available()) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
      camera.zoomBy(Math.exp(clamp(event.deltaY * unit * 0.0013, -0.7, 0.7)));
    }, { passive: false });
    return function cancelGestures() {
      for (const id of pointers.keys()) {
        if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
      }
      pointers.clear();
      canvas.classList.remove("dragging");
    };
  }

  const api = { bindDialog, bindGestures, fillSelect };
  if (common) module.exports = api;
  else (root.OrbitAtlas ||= {}).controls = api;
})(globalThis);
