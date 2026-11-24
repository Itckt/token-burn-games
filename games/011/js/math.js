(function (root) {
  "use strict";

  const TAU = Math.PI * 2;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const mix = (a, b, t) => a + (b - a) * t;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];

  function normalize(v) {
    const length = Math.hypot(...v);
    return length ? v.map(component => component / length) : [0, 0, 0];
  }

  // Column-major matrices match WebGL's uniformMatrix4fv convention.
  function perspective(fov, aspect, near, far) {
    const f = 1 / Math.tan(fov / 2);
    const depth = near - far;
    return new Float32Array([
      f / aspect, 0, 0, 0,  0, f, 0, 0,
      0, 0, (far + near) / depth, -1,  0, 0, 2 * far * near / depth, 0
    ]);
  }

  function lookAt(eye, target, up = [0, 1, 0]) {
    const back = normalize(eye.map((n, i) => n - target[i]));
    if (dot(back, back) === 0) back[2] = 1;
    const upLength = Math.hypot(...up);
    const parallel = !upLength || Math.abs(dot(up, back)) > 0.99999 * upLength;
    const fallback = Math.abs(back[2]) < 0.9 ? [0, 0, -1] : [0, 1, 0];
    const right = normalize(cross(parallel ? fallback : up, back));
    const vertical = cross(back, right);
    return new Float32Array([
      right[0], vertical[0], back[0], 0,
      right[1], vertical[1], back[1], 0,
      right[2], vertical[2], back[2], 0,
      -dot(right, eye), -dot(vertical, eye), -dot(back, eye), 1
    ]);
  }

  function multiply(a, b) {
    const result = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 4; k++) result[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
      }
    }
    return result;
  }

  function transform(m, x, y, z, w = 1) {
    return [0, 1, 2, 3].map(i => m[i] * x + m[4 + i] * y + m[8 + i] * z + m[12 + i] * w);
  }

  function project(m, point, width, height) {
    const [x, y, z, w] = transform(m, ...point);
    if (w === 0) return { x: 0, y: 0, visible: false };
    return {
      x: (0.5 + 0.5 * x / w) * width,
      y: (0.5 - 0.5 * y / w) * height,
      visible: w > 0 && Math.abs(x) <= w && Math.abs(y) <= w && Math.abs(z) <= w
    };
  }

  const HOME = Object.freeze({ yaw: 0.38, pitch: 0.76, distance: 28.1 });
  const FOV = 28 * Math.PI / 180;
  const splitColumn = (width, percent) => Math.round(width * clamp(percent, 0, 100) / 100);
  const NEAR = 0.25, FAR = 320;
  const makeCamera = () => ({ ...HOME, target: { ...HOME }, mode: "orbit" });

  function viewRay(frame, x, y, width, height) {
    if (!(width > 0 && height > 0 && x >= 0 && x <= width && y >= 0 && y <= height)) return null;
    const half = Math.tan(FOV / 2);
    const horizontal = (2 * x - width) / height * half;
    const vertical = (1 - 2 * y / height) * half;
    return [0, 1, 2].map(i => -frame.back[i] + horizontal * frame.right[i] + vertical * frame.up[i]);
  }

  function seaPoint(frame, x, y, width, height) {
    const ray = viewRay(frame, x, y, width, height);
    if (!ray) return null;
    const distance = -frame.eye[1] / ray[1];
    if (!(distance >= NEAR && distance <= FAR)) return null;
    return { x: frame.eye[0] + distance * ray[0], z: frame.eye[2] + distance * ray[2] };
  }

  function aim(camera, mode) {
    camera.mode = mode;
    if (mode === "overhead") {
      camera.target = { yaw: 0, pitch: Math.PI / 2 - 0.008, distance: 45.2 };
    } else {
      camera.target = { ...HOME };
    }
    // Travel across the shortest arc even after several full turns.
    camera.target.yaw = camera.yaw + Math.atan2(
      Math.sin(camera.target.yaw - camera.yaw), Math.cos(camera.target.yaw - camera.yaw)
    );
  }

  function orbit(camera, dx, dy) {
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return;
    camera.mode = "orbit";
    camera.target.yaw -= dx * 0.006;
    camera.target.pitch = clamp(camera.target.pitch + dy * 0.005, 0.35, Math.PI / 2 - 0.008);
  }

  function zoom(camera, factor) {
    if (factor > 0 && Number.isFinite(factor)) {
      camera.target.distance = clamp(camera.target.distance * factor, 15, 54);
    }
  }

  function easeCamera(camera, dt) {
    const blend = 1 - Math.exp(-11 * Math.max(0, dt));
    for (const key of ["yaw", "pitch", "distance"]) {
      camera[key] = mix(camera[key], camera.target[key], blend);
    }
  }

  function cameraFrame(camera, aspect) {
    const distance = camera.distance * Math.max(1, 1.6 / aspect);
    const cosPitch = Math.cos(camera.pitch);
    const back = [cosPitch * Math.sin(camera.yaw), Math.sin(camera.pitch), cosPitch * Math.cos(camera.yaw)];
    const target = [0, 0, 0];
    const eye = back.map((v, i) => target[i] + v * distance);
    const right = [Math.cos(camera.yaw), 0, -Math.sin(camera.yaw)];
    const up = cross(back, right);
    const vp = multiply(perspective(FOV, aspect, NEAR, FAR), lookAt(eye, target, up));
    return { vp, eye, right, up, back, distance };
  }

  const api = { TAU, clamp, mix, dot, cross, normalize, perspective, lookAt, multiply,
    transform, project, viewRay, seaPoint, splitColumn, HOME, FOV, NEAR, FAR, makeCamera, aim, orbit, zoom, easeCamera, cameraFrame };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.Isobar ||= {}).math = api;
})(globalThis);
