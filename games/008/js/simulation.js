(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./math"), require("./terrain"), require("./waterways"));
  else root.FieldAtlas.sim = factory(root.FieldAtlas.math, root.FieldAtlas.terrain, root.FieldAtlas.waterways);
})(globalThis, function (M, T, W) {
  "use strict";

  const START_HOUR = 16.5, DAY_SECONDS = 720, FOV = 52 * Math.PI / 180;
  const FLIGHT_BOUND = T.HALF - 3;
  const SKIFF_EYE = 2.2;
  const FOCUS = [-7, 31, -51];
  function homeCamera(style) {
    const delta = M.subtract(FOCUS, style.start), distance = Math.hypot(...delta);
    const yaw = Math.atan2(delta[0], -delta[2]), pitch = Math.asin(delta[1] / distance);
    return { mode: "orbit", position: style.start.slice(), focus: FOCUS.slice(), yaw, pitch,
      orbitYaw: yaw, orbitPitch: pitch, targetYaw: yaw, targetPitch: pitch,
      distance, targetDistance: distance, velocity: [0, 0, 0], skiffSpeed: 0, skiffLimit: "" };
  }
  function setMode(camera, mode) {
    if (!["orbit", "fly", "tour", "skiff"].includes(mode)) throw new RangeError("Unknown camera mode");
    if (camera.mode === mode) return;
    if (mode === "orbit") {
      camera.pitch = M.clamp(camera.pitch, -1.27, -0.065);
      camera.orbitPitch = camera.pitch;
      camera.orbitYaw = camera.yaw;
      const f = M.direction(camera.yaw, camera.pitch);
      camera.distance = camera.targetDistance = Math.min(camera.distance, 96);
      camera.focus = camera.position.map((v, i) => v + f[i] * camera.distance);
    }
    camera.targetYaw = camera.yaw;
    camera.targetPitch = camera.pitch;
    camera.velocity = [0, 0, 0];
    camera.skiffSpeed = 0;
    camera.skiffLimit = "";
    camera.mode = mode;
  }
  function turn(camera, yaw, pitch) {
    camera.targetYaw += yaw;
    camera.targetPitch = M.clamp(camera.targetPitch + pitch, camera.mode === "orbit" ? -1.27 : -1.48,
      camera.mode === "orbit" ? -0.055 : 1.48);
  }
  function zoom(camera, units) {
    if (camera.mode === "orbit") camera.targetDistance = M.clamp(camera.targetDistance * Math.exp(units * 0.001), 28, 235);
  }
  function boardSkiff(camera, grid, level, passage) {
    const from = [camera.position[0], camera.position[2]];
    const berth = W.nearestLaunch(grid, passage ? passage[0] : from, level, FLIGHT_BOUND);
    if (!berth) return false;
    let yaw = camera.yaw;
    if (passage) yaw = Math.atan2(passage[1][0] - berth[0], berth[1] - passage[1][1]);
    else if (!W.afloat(grid, from, level)) {
      const { dx, dz } = grid.facetAt(...berth);
      if (dx || dz) yaw = Math.atan2(-dx, dz);
    }
    setMode(camera, "skiff");
    camera.skiffSpeed = 0;
    camera.skiffLimit = "";
    camera.position = [berth[0], level + SKIFF_EYE, berth[1]];
    camera.yaw = camera.targetYaw = yaw;
    camera.pitch = camera.targetPitch = -0.09;
    return true;
  }
  function stepSkiff(camera, keys, dt, grid, level) {
    const p = camera.position;
    p[1] = level + SKIFF_EYE;
    if (!dt) return;
    const drive = Number(keys.has("KeyW")) - Number(keys.has("KeyS"));
    const target = drive < 0 ? -5 : drive * 12;
    const response = 2.6, gain = -Math.expm1(-response * dt);
    const distance = target * dt + (camera.skiffSpeed - target) * gain / response;
    camera.skiffSpeed += (target - camera.skiffSpeed) * gain;
    camera.skiffLimit = "";
    if (Math.abs(distance) < 1e-10) return;
    const a = [p[0], p[2]], delta = [Math.sin(camera.yaw) * distance, -Math.cos(camera.yaw) * distance];
    const end = T.surveyInterval(a, delta, 0, 1, FLIGHT_BOUND)[1];
    const b = a.map((v, axis) => M.clamp(v + end * delta[axis], -FLIGHT_BOUND, FLIGHT_BOUND));
    const fraction = W.clearFraction(grid, a, b, level);
    p[0] = M.lerp(a[0], b[0], fraction);
    p[2] = M.lerp(a[1], b[1], fraction);
    if (fraction < 1 || end < 1) {
      camera.skiffSpeed = 0;
      camera.skiffLimit = fraction < 1 ? "Draft limit" : "Survey edge";
    }
  }
  function stepCamera(camera, keys, elapsed, grid, showWater = true, waterLevel = T.WATER) {
    if (camera.mode === "tour") return;
    if (camera.mode === "skiff" && (!showWater || !W.afloat(grid, [camera.position[0], camera.position[2]], waterLevel))) {
      setMode(camera, "fly");
    }
    const dt = M.clamp(elapsed, 0, 0.1), lookSpeed = dt * 1.15;
    const skiff = camera.mode === "skiff";
    const rightTurn = keys.has("ArrowRight") || (skiff && keys.has("KeyD"));
    const leftTurn = keys.has("ArrowLeft") || (skiff && keys.has("KeyA"));
    turn(camera, (rightTurn - leftTurn) * lookSpeed,
      ((+keys.has("ArrowUp")) - (+keys.has("ArrowDown"))) * lookSpeed);
    const closer = keys.has("Equal") || keys.has("NumpadAdd");
    const farther = keys.has("Minus") || keys.has("NumpadSubtract");
    if (closer || farther) zoom(camera, (farther - closer) * 1050 * dt);
    const ease = 1 - Math.exp(-14 * dt);
    const orbit = camera.mode === "orbit";
    camera.yaw = M.lerp(orbit ? camera.orbitYaw : camera.yaw, camera.targetYaw, ease);
    camera.pitch = M.lerp(orbit ? camera.orbitPitch : camera.pitch, camera.targetPitch, ease);
    camera.distance = M.lerp(camera.distance, camera.targetDistance, ease);
    if (skiff) { stepSkiff(camera, keys, dt, grid, waterLevel); return; }
    const f = M.direction(camera.yaw, camera.pitch), p = camera.position;
    if (orbit) {
      camera.orbitYaw = camera.yaw;
      camera.orbitPitch = camera.pitch;
      for (let i = 0; i < 3; i++) p[i] = camera.focus[i] - f[i] * camera.distance;
    } else {
      const forward = (+keys.has("KeyW")) - (+keys.has("KeyS"));
      const strafe = (+keys.has("KeyD")) - (+keys.has("KeyA"));
      const climb = (+(keys.has("KeyE") || keys.has("Space"))) - (+keys.has("KeyQ"));
      const right = [Math.cos(camera.yaw), 0, Math.sin(camera.yaw)];
      const dir = M.normalize([f[0] * forward + right[0] * strafe,
        f[1] * forward + climb, f[2] * forward + right[2] * strafe]);
      const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight")) ? 67 : 26;
      const response = 7.2, decay = Math.exp(-response * dt);
      // Analytic integral of the damped velocity gives consistent travel at different frame rates.
      for (let i = 0; i < 3; i++) {
        const goal = dir[i] * speed, difference = camera.velocity[i] - goal;
        p[i] += goal * dt + difference * (1 - decay) / response;
        camera.velocity[i] = goal + difference * decay;
      }
    }
    for (const axis of [0, 2]) {
      if (Math.abs(p[axis]) > FLIGHT_BOUND) {
        p[axis] = M.clamp(p[axis], -FLIGHT_BOUND, FLIGHT_BOUND);
        camera.velocity[axis] = 0;
      }
    }
    const floor = Math.max(showWater ? waterLevel : -Infinity, grid.surfaceAt(p[0], p[2])) + 2.0;
    if (p[1] < floor || p[1] > 235) {
      p[1] = M.clamp(p[1], floor, 235);
      camera.velocity[1] = 0;
    }
    // Aim from the collision-corrected eye. The requested orbit angles keep easing independently.
    if (orbit) {
      const [dx, dy, dz] = M.subtract(camera.focus, p);
      camera.yaw = Math.atan2(dx, -dz);
      camera.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
  }
  const advanceClock = (hour, seconds, running) => M.wrap(hour + (running ? seconds * 24 / DAY_SECONDS : 0), 24);
  const minuteOfDay = hour => Math.floor(M.wrap(hour, 24) * 60 + 1e-7) % 1440;
  function formatHour(hour) {
    const minutes = minuteOfDay(hour);
    return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
  }
  function sunDirection(hour) {
    const angle = M.TAU * (M.wrap(hour, 24) - 6) / 24;
    return M.normalize([-0.41 * Math.cos(angle) - 0.055, 0.58 * Math.sin(angle), -0.95]);
  }
  function lighting(hour) {
    const sun = sunDirection(hour);
    const day = M.smoothstep(-0.12, 0.13, sun[1]);
    const warmth = 1 - M.smoothstep(0.055, 0.48, Math.abs(sun[1]));
    const nightHigh = [0.034, 0.072, 0.125], nightLow = [0.16, 0.23, 0.29];
    const high = M.mixColor(nightHigh, M.mixColor([0.46, 0.69, 0.77], [0.65, 0.73, 0.74], warmth), day);
    const low = M.mixColor(nightLow, M.mixColor([0.85, 0.89, 0.83], [0.98, 0.83, 0.65], warmth), day);
    return { sun, day, warmth, high, low };
  }
  function heading(yaw) {
    const degrees = M.wrap(Math.round(yaw * 180 / Math.PI), 360);
    return { degrees, cardinal: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(degrees / 45) % 8] };
  }
  return { START_HOUR, DAY_SECONDS, FOV, FLIGHT_BOUND, SKIFF_EYE, homeCamera, setMode, turn, zoom, boardSkiff, stepCamera,
    advanceClock, minuteOfDay, formatHour, sunDirection, lighting, heading };
});
