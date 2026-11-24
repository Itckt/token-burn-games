(function (A) {
  "use strict";
  const S = A.sim;
  const movement = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "Space",
    "ShiftLeft", "ShiftRight", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
    "Equal", "Minus", "NumpadAdd", "NumpadSubtract"]);
  const helm = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

  function editing(target) {
    return target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName);
  }

  function bindNavigation(canvas, pad, { getCamera, enabled, switchMode, resetView, togglePlayback }) {
    const keys = new Set(), keyboard = new Set(), buttons = new Map(), pointers = new Map();
    const activeCamera = () => enabled() ? getCamera() : null;
    function updateKeys() {
      keys.clear();
      for (const code of keyboard) keys.add(code);
      for (const code of buttons.values()) keys.add(code);
    }
    function clear() {
      keyboard.clear();
      buttons.clear();
      pointers.clear();
      keys.clear();
      canvas.classList.remove("dragging");
      const camera = getCamera();
      if (camera) {
        camera.velocity.fill(0);
        camera.skiffSpeed = 0;
        camera.skiffLimit = "";
        camera.targetYaw = camera.mode === "orbit" ? camera.orbitYaw : camera.yaw;
        camera.targetPitch = camera.mode === "orbit" ? camera.orbitPitch : camera.pitch;
        camera.targetDistance = camera.distance;
      }
    }
    window.addEventListener("blur", clear);
    document.addEventListener("focusin", event => { if (editing(event.target)) clear(); });
    document.addEventListener("keydown", event => {
      const camera = activeCamera();
      if (!camera || event.defaultPrevented || editing(event.target) || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return;
      if (event.code === "KeyF" || event.code === "KeyR") {
        event.preventDefault();
        if (!event.repeat) {
          if (event.code === "KeyF") switchMode(camera.mode === "fly" ? "orbit" : "fly");
          else resetView();
        }
      } else if (camera.mode === "tour") {
        if (event.code === "Space" && event.target?.tagName !== "BUTTON") {
          event.preventDefault();
          if (!event.repeat) togglePlayback();
        }
      } else if (movement.has(event.code)) {
        if (camera.mode === "skiff" && !helm.has(event.code)) return;
        if (event.code === "Space" && (event.target?.tagName === "BUTTON" || camera.mode === "orbit")) return;
        if (!event.code.startsWith("Shift")) event.preventDefault();
        keyboard.add(event.code);
        keys.add(event.code);
      }
    });
    document.addEventListener("keyup", event => {
      if (keyboard.delete(event.code)) updateKeys();
    });

    function separation() {
      const [a, b] = pointers.values();
      return Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    }
    canvas.addEventListener("pointerdown", event => {
      const camera = activeCamera();
      if (!camera || camera.mode === "tour" || event.button !== 0) return;
      event.preventDefault();
      canvas.focus({ preventScroll: true });
      canvas.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.classList.add("dragging");
    });
    canvas.addEventListener("pointermove", event => {
      const previous = pointers.get(event.pointerId), camera = activeCamera();
      if (!previous || !camera) return;
      const before = pointers.size === 2 ? separation() : 0;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (before) {
        S.zoom(camera, 1000 * Math.log(before / separation()));
      } else if (pointers.size === 1) {
        S.turn(camera, (event.clientX - previous.x) * 0.004, (previous.y - event.clientY) * 0.004);
      }
    });
    function endDrag(event) {
      pointers.delete(event.pointerId);
      if (!pointers.size) canvas.classList.remove("dragging");
    }
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) canvas.addEventListener(type, endDrag);
    canvas.addEventListener("wheel", event => {
      const camera = activeCamera();
      if (!camera || camera.mode !== "orbit") return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
      S.zoom(camera, event.deltaY * unit);
    }, { passive: false });

    for (const button of pad.querySelectorAll("[data-key]")) {
      button.addEventListener("pointerdown", event => {
        const mode = activeCamera()?.mode;
        if ((mode !== "fly" && mode !== "skiff") || event.button !== 0) return;
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        buttons.set(event.pointerId, button.dataset.key);
        updateKeys();
      });
      function release(event) {
        if (buttons.delete(event.pointerId)) updateKeys();
      }
      for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) button.addEventListener(type, release);
    }
    return { keys, clear };
  }
  A.navigation = { bindNavigation, editing };
})(globalThis.FieldAtlas);
