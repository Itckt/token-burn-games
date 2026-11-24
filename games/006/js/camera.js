(function () {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const { clamp } = node ? require('./math.js') : Nightline.math;

  const views = new Map([
    ['front', [0, 0]], ['platform', [2.28, -0.10]], ['left', [-1.43, -0.025]], ['saloon', [0.29, 0.11]]
  ]);
  function createCamera() {
    return { yaw: 0, pitch: 0, seat: 0, goalYaw: 0, goalPitch: 0, goalSeat: 0, preset: 'front' };
  }

  function setView(c, preset) {
    c.preset = views.has(preset) ? preset : 'front';
    [c.goalYaw, c.goalPitch] = views.get(c.preset);
    c.goalSeat = c.preset === 'saloon' ? 1 : 0;
  }

  function pan(c, yaw, pitch) {
    if (!yaw && !pitch) return;
    c.goalYaw = clamp(c.goalYaw + yaw, -Math.PI, Math.PI);
    c.goalPitch = clamp(c.goalPitch + pitch, -0.91, 0.76);
    c.preset = 'free';
  }

  function advance(c, seconds) {
    const blend = -Math.expm1(-10 * seconds);
    const previousYaw = c.yaw, previousPitch = c.pitch, previousSeat = c.seat;
    let turn = c.goalYaw - c.yaw;
    if (c.preset !== 'free' && Math.abs(turn) > Math.PI) turn -= Math.sign(turn) * 2 * Math.PI;
    c.yaw += turn * blend;
    if (Math.abs(c.yaw) > Math.PI) c.yaw -= Math.sign(c.yaw) * 2 * Math.PI;
    c.pitch += (c.goalPitch - c.pitch) * blend;
    c.seat += (c.goalSeat - c.seat) * blend;
    if (Math.abs(c.goalYaw - c.yaw) < 0.00005) c.yaw = c.goalYaw;
    if (Math.abs(c.goalPitch - c.pitch) < 0.00005) c.pitch = c.goalPitch;
    if (Math.abs(c.goalSeat - c.seat) < 0.00005) c.seat = c.goalSeat;
    return previousYaw !== c.yaw || previousPitch !== c.pitch || previousSeat !== c.seat;
  }

  function moving(c) { return c.yaw !== c.goalYaw || c.pitch !== c.goalPitch || c.seat !== c.goalSeat; }
  function eye(c, sway, bob, trackX, cos, sin) {
    const x = -0.12 - 0.92 * c.seat + sway, z = 4.50 * c.seat;
    return [trackX + x * cos - z * sin, 2.465 - 0.16 * c.seat + bob, x * sin + z * cos];
  }
  const api = { createCamera, setView, pan, advance, moving, eye };
  if (node) module.exports = api;
  else Nightline.camera = api;
})();
