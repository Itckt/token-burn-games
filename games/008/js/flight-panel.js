(function (A) {
  "use strict";
  const { math: M, relay: R, survey: Q } = A;

  function bindProbe(byId) {
    const button = byId("probe"), box = byId("probe-reading"), viewer = byId("viewer");
    let selected = false, enabled = false, hit = null, lastGrid, lastPose;
    function sync() {
      button.disabled = !enabled;
      button.setAttribute("aria-pressed", String(selected));
      box.hidden = !enabled || !selected;
      viewer.dataset.probe = String(!box.hidden);
      lastPose = null;
      hit = null;
    }
    button.addEventListener("click", () => {
      if (!enabled) return;
      selected = !selected;
      sync();
    });
    function read(camera, grid, level) {
      if (box.hidden) return;
      const pose = [...camera.position, camera.yaw, camera.pitch, level];
      if (lastGrid === grid && lastPose && pose.every((v, i) => v === lastPose[i])) return;
      lastGrid = grid;
      lastPose = pose;
      hit = A.probe.cast(grid, camera.position, M.direction(camera.yaw, camera.pitch), level);
      const surface = byId("probe-surface"), detail = byId("probe-detail");
      if (!hit) {
        surface.textContent = "Beyond the survey";
        detail.textContent = "Aim at ground or open water.";
        return;
      }
      const elev = hit.bed.toFixed(1) + " m", range = Math.round(hit.distance) + " m range";
      const slope = hit.aspect ? Math.round(hit.slope) + "° " + hit.aspect : "level";
      surface.textContent = hit.kind === "water" ? "Water · " + hit.depth.toFixed(1) + " m deep" : "Ground · " + elev;
      detail.textContent = (hit.kind === "water" ? "Bed " + elev : "Slope " + slope) + " · " + range;
    }
    return { read, setEnabled(value) { enabled = value; sync(); }, get active() { return selected && enabled; },
      get hit() { return hit; } };
  }

  function bindRelay(byId, launch) {
    const start = byId("relay-start"), end = byId("relay-end"), again = byId("relay-again");
    const hud = byId("relay-hud"), record = byId("relay-record"), viewer = byId("viewer");
    let grid, route, course, run = null, best = null, enabled = false, drafting = false, requested = false;
    function sync() {
      const short = route && route.length < Q.MIN_LEG - 1e-8;
      start.disabled = !enabled || drafting || !route || short;
      hud.hidden = !enabled || !run;
      again.hidden = !run?.finished;
      end.textContent = run?.finished ? "Close" : "End relay";
      viewer.dataset.relay = String(!hud.hidden && !run?.finished);
      byId("relay-action").textContent = run && !run.finished ? "Restart relay" : "Start relay";
      record.textContent = short ? "A relay needs at least " + Q.MIN_LEG + " m of route."
        : best ? "Course best " + R.formatTime(best.at(-1)) + " · " + best.length + (best.length === 1 ? " gate" : " gates")
        : "Fly the gold gates along this route.";
    }
    function configure(nextGrid, nextRoute, available, plotting) {
      if (route !== nextRoute) {
        if (run && !run.finished) byId("announcement").textContent = "Course changed. Start a new relay on the updated route.";
        grid = nextGrid;
        route = nextRoute;
        course = run = best = null;
      }
      enabled = available;
      drafting = plotting;
      sync();
    }
    function stop() {
      requested = false;
      if (!run) return;
      run = null;
      sync();
    }
    function begin() {
      if (start.disabled) return;
      course ||= R.buildCourse(grid, route);
      launch(course.launch);
      run = R.start(course);
      byId("relay-split").textContent = "Move to start";
      byId("announcement").textContent = "Gate relay ready. Fly through the gold ring.";
      sync();
      refresh({ position: course.launch.position, yaw: course.launch.yaw });
    }
    function requestStart() {
      if (!start.disabled) requested = true;
    }
    function takeRequest() {
      const pending = requested;
      requested = false;
      return pending;
    }
    start.addEventListener("click", requestStart);
    again.addEventListener("click", requestStart);
    end.addEventListener("click", () => {
      stop();
      byId("world").focus({ preventScroll: true });
    });
    function advance(from, to, dt) {
      const previous = run.splits.length;
      R.advance(run, from, to, dt);
      const passed = run.splits.length;
      if (passed === previous) return;
      const time = R.formatTime(run.splits.at(-1));
      let split = "Split " + time;
      if (best) {
        const delta = run.splits.at(-1) - best[passed - 1];
        split += " (" + (delta < 0 ? "−" : "+") + Math.abs(delta).toFixed(1) + " s)";
      }
      byId("relay-split").textContent = split;
      if (run.finished) {
        const faster = !best || run.elapsed < best.at(-1);
        if (faster) best = run.splits.slice();
        byId("relay-guidance").textContent = faster ? "New course best" : "Course best " + R.formatTime(best.at(-1));
        sync();
      }
      byId("announcement").textContent = (run.finished ? "Relay complete in " : "Gate " + passed + " cleared in ") + time + ".";
    }
    function refresh(camera) {
      if (!run || hud.hidden) return;
      const i = run.splits.length, count = course.gates.length;
      byId("relay-clock").textContent = R.formatTime(run.elapsed);
      byId("relay-gate").textContent = run.finished ? "Relay complete" : "Gate " + (i + 1) + " of " + count;
      if (run.finished) return;
      const [dx, dy, dz] = M.subtract(course.gates[i].center, camera.position);
      const angle = M.wrap(Math.atan2(dx, -dz) - camera.yaw + Math.PI, M.TAU) - Math.PI;
      const turn = Math.abs(angle) < 0.19 ? "ahead" : Math.abs(angle) > 2.6 ? "behind" : angle < 0 ? "left" : "right";
      const rise = Math.abs(dy) < 2 ? "level" : (dy > 0 ? "climb " : "drop ") + Math.round(Math.abs(dy)) + " m";
      byId("relay-guidance").textContent = Math.round(Math.hypot(dx, dy, dz)) + " m " + turn + " · " + rise;
      if (run.started && !i) byId("relay-split").textContent = best ? "Best " + R.formatTime(best.at(-1)) : "First split ahead";
    }
    return { configure, takeRequest, begin, advance, refresh, stop, get flight() { return run && !run.finished ? run : null; } };
  }
  A.flightPanel = { bindProbe, bindRelay };
})(globalThis.FieldAtlas);
