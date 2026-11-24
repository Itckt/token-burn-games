(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const { readings } = common ? require("./storm.js") : root.Isobar.storm;
  const { TAU } = common ? require("./math.js") : root.Isobar.math;
  const cycle = common ? require("./lifecycle.js") : root.Isobar.lifecycle;
  const iconCache = new WeakMap();

  function surface(canvas, width, height) {
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const physicalW = Math.max(1, Math.round((canvas.clientWidth || width) * dpr));
    const physicalH = Math.max(1, Math.round((canvas.clientHeight || height) * dpr));
    if (canvas.width !== physicalW) canvas.width = physicalW;
    if (canvas.height !== physicalH) canvas.height = physicalH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.setTransform(physicalW / width, 0, 0, physicalH / height, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return ctx;
  }

  function drawIcon(canvas) {
    const name = canvas.dataset.icon;
    const color = root.getComputedStyle(canvas).color;
    const key = [name, color, canvas.clientWidth, canvas.clientHeight, root.devicePixelRatio].join("/");
    if (iconCache.get(canvas) === key) return;
    const ctx = surface(canvas, 24, 24);
    if (!ctx) return;
    iconCache.set(canvas, key);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.68;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    function line(...points) {
      ctx.beginPath();
      ctx.moveTo(points[0], points[1]);
      for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
      ctx.stroke();
    }
    function circle(x, y, radius, fill = false) {
      ctx.beginPath(); ctx.arc(x, y, radius, 0, TAU);
      if (fill) ctx.fill(); else ctx.stroke();
    }
    function cloud(height) {
      ctx.beginPath(); ctx.moveTo(6.3, height);
      ctx.bezierCurveTo(0.8, height, 1.1, height - 8, 6.8, height - 8);
      ctx.bezierCurveTo(8.1, height - 14, 16.6, height - 13.6, 17.9, height - 7.6);
      ctx.bezierCurveTo(23.5, height - 7.1, 22.9, height, 17.8, height);
      ctx.closePath(); ctx.stroke();
    }
    switch (name) {
      case "isobar":
        for (let arm = 0; arm < 3; arm++) {
          ctx.beginPath();
          for (let side = 0; side < 2; side++) {
            for (let k = 0; k <= 38; k++) {
              const t = (side ? 38 - k : k) / 38;
              const angle = arm * TAU / 3 + 3.03 * t;
              const thick = (0.22 + 2.05 * Math.pow(Math.sin(Math.PI * t), 0.72)) * (side ? -1 : 1);
              const r = 2.0 + 9.2 * t + thick;
              const x = 12 + r * Math.cos(angle), y = 12 - r * Math.sin(angle);
              if (!side && !k) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
          }
          ctx.closePath(); ctx.fill();
        }
        break;
      case "keyboard":
        ctx.strokeRect(2, 5.5, 20, 13);
        for (let row = 0; row < 2; row++) for (let col = 0; col < 5; col++) ctx.fillRect(5 + col * 3.1, 8 + row * 3, 1.5, 1.3);
        line(8, 15.7, 16, 15.7); break;
      case "pin":
        ctx.beginPath(); ctx.moveTo(12, 21);
        ctx.bezierCurveTo(10.5, 18.6, 4.8, 12.8, 4.8, 9);
        ctx.bezierCurveTo(4.8, -0.3, 19.2, -0.3, 19.2, 9);
        ctx.bezierCurveTo(19.2, 12.8, 13.5, 18.6, 12, 21); ctx.stroke();
        circle(12, 8.8, 2.1); break;
      case "focus":
        line(3, 8, 3, 3, 8, 3); line(16, 3, 21, 3, 21, 8);
        line(21, 16, 21, 21, 16, 21); line(8, 21, 3, 21, 3, 16); circle(12, 12, 2, true); break;
      case "pause":
        ctx.fillRect(6.5, 4.5, 3.5, 15); ctx.fillRect(14, 4.5, 3.5, 15); break;
      case "play":
        ctx.beginPath(); ctx.moveTo(7, 4.7); ctx.lineTo(19.5, 12); ctx.lineTo(7, 19.3); ctx.closePath(); ctx.fill(); break;
      case "expand":
        line(4, 9, 4, 4, 9, 4); line(15, 4, 20, 4, 20, 9);
        line(20, 15, 20, 20, 15, 20); line(9, 20, 4, 20, 4, 15); break;
      case "shrink":
        line(4, 9, 9, 9, 9, 4); line(15, 4, 15, 9, 20, 9);
        line(20, 15, 15, 15, 15, 20); line(9, 20, 9, 15, 4, 15); break;
      case "orbit":
        ctx.beginPath(); ctx.ellipse(12, 12, 10, 5, -0.47, 0, TAU); ctx.stroke(); circle(12, 12, 2.1, true); break;
      case "overhead":
        circle(12, 12, 7.4); circle(12, 12, 1.8, true);
        line(12, 2, 12, 5); line(12, 19, 12, 22); line(2, 12, 5, 12); line(19, 12, 22, 12); break;
      case "radar":
        circle(12, 12, 8.8); circle(12, 12, 4.9);
        line(12, 12, 18.1, 5.9); circle(8.4, 14.5, 1.35, true); break;
      case "flow":
        line(2, 9, 7, 9, 13, 5, 20, 5); line(17, 2, 20, 5, 17, 8);
        line(3, 15, 8, 15, 14, 11, 21, 11); line(8, 20, 13, 17, 20, 17); break;
      case "relief":
        for (let i = 0; i < 3; i++) {
          ctx.beginPath(); ctx.ellipse(12, 12 + i, 10 - 3.4 * i, 7.7 - 2.7 * i, -0.22, 0, TAU); ctx.stroke();
        }
        break;
      case "recorder":
        ctx.strokeRect(2.5, 4.5, 19, 15); line(4.5, 14, 8, 14, 10, 8, 13, 16, 15, 11, 19, 11); break;
      case "compare":
        ctx.strokeRect(2.5, 5, 19, 14); line(12, 3, 12, 21); line(6, 12, 9, 12); line(15, 12, 18, 12); break;
      case "section":
        line(2, 18, 7, 9, 10, 13, 14, 6, 22, 18, 2, 18);
        line(12, 3, 12, 8); line(12, 11, 12, 15); line(12, 18, 12, 21); break;
      case "book":
        ctx.strokeRect(5, 3, 15, 18); line(3, 7, 7, 7); line(3, 12, 7, 12); line(3, 17, 7, 17);
        line(10, 8, 16, 8); line(10, 12, 15, 12); break;
      case "reset":
        ctx.beginPath(); ctx.arc(12.5, 12.3, 7.5, -2.59, 2.48); ctx.stroke();
        line(4.3, 3.8, 4.3, 9.4, 10, 9.4); break;
      case "plus": line(12, 5, 12, 19); line(5, 12, 19, 12); break;
      case "minus": line(5, 12, 19, 12); break;
      case "cloud": cloud(17.8); break;
      case "rain": cloud(14.6); line(8, 17.6, 6.9, 20.3); line(13, 17.6, 11.9, 20.3); line(18, 17.6, 16.9, 20.3); break;
      case "grid":
        ctx.strokeRect(3.5, 3.5, 17, 17); line(9.2, 3.5, 9.2, 20.5); line(14.8, 3.5, 14.8, 20.5);
        line(3.5, 9.2, 20.5, 9.2); line(3.5, 14.8, 20.5, 14.8); break;
      case "wind":
        ctx.beginPath(); ctx.moveTo(3, 9); ctx.lineTo(13.2, 9); ctx.bezierCurveTo(18.4, 9, 17.2, 1.3, 12.9, 4.5); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(5.5, 12.5); ctx.lineTo(18, 12.5); ctx.bezierCurveTo(23.4, 12.5, 22, 4.7, 18.3, 7.7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(3, 16); ctx.lineTo(12.1, 16); ctx.bezierCurveTo(18.1, 16, 15.9, 23, 12.6, 19.4); ctx.stroke(); break;
      case "pressure":
        ctx.beginPath(); ctx.arc(12, 13.5, 8.6, 2.46, 0.69 + TAU); ctx.stroke();
        line(12, 13.5, 16.4, 8.6); circle(12, 13.5, 1.8, true); line(7.6, 19.4, 16.4, 19.4); break;
      case "clock": circle(12, 12, 8.7); line(12, 6.4, 12, 12.2, 15.8, 14.6); break;
      case "close": line(6, 6, 18, 18); line(18, 6, 6, 18); break;
      case "signal":
        for (let i = 0; i < 4; i++) ctx.fillRect(3 + i * 5, 15.4 - i * 3.3, 2.8, 4 + i * 3.3);
        break;
    }
  }

  function compass(canvas, camera) {
    const ctx = surface(canvas, 46, 54);
    if (!ctx) return;
    const angle = Math.atan2(Math.sin(camera.yaw), Math.cos(camera.yaw) * Math.sin(camera.pitch));
    ctx.save(); ctx.translate(23, 31); ctx.rotate(angle);
    ctx.lineWidth = 0.8; ctx.strokeStyle = "#829798a8";
    ctx.beginPath(); ctx.arc(0, 0, 12.5, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-15, 0); ctx.lineTo(15, 0); ctx.stroke();
    ctx.fillStyle = "#c5ef83";
    ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(3.2, 1.6); ctx.lineTo(-3.2, 1.6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#93a5a5"; ctx.beginPath(); ctx.moveTo(0, 14); ctx.lineTo(3.2, 1.6); ctx.lineTo(-3.2, 1.6); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.font = "9px Consolas, monospace"; ctx.fillStyle = "#d9e5d0"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("N", 23 + 21 * Math.sin(angle), 31 - 21 * Math.cos(angle));
  }

  const HISTORY_LENGTH = 54, SAMPLE_INTERVAL = 0.48;
  function makeHistory(strength, time = 0, sampleAt = t => readings(strength, t)) {
    return { last: time, samples: Array.from({ length: HISTORY_LENGTH }, (_, i) =>
      sampleAt(time - (HISTORY_LENGTH - 1 - i) * SAMPLE_INTERVAL)) };
  }

  function record(history, strength, time, sampleAt = t => readings(strength, t)) {
    if (!Number.isFinite(time)) return;
    const count = Math.min(HISTORY_LENGTH, Math.floor((time - history.last) / SAMPLE_INTERVAL));
    if (count === HISTORY_LENGTH) history.last = time - count * SAMPLE_INTERVAL;
    for (let i = 0; i < count; i++) {
      history.last += SAMPLE_INTERVAL;
      history.samples.shift();
      history.samples.push(sampleAt(history.last));
    }
  }

  function cycleCurve(canvas) {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const ctx = surface(canvas, width, height);
    if (!ctx) return;
    ctx.strokeStyle = "#354235"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2);
    for (const stage of cycle.STAGES) {
      const x = width * stage.start / cycle.DURATION;
      ctx.moveTo(x, 0); ctx.lineTo(x, height);
    }
    ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, height - 4);
    for (let i = 1; i <= 120; i++) {
      const strength = cycle.at(i * cycle.DURATION / 120).strength;
      ctx.lineTo(width * i / 120, height - 4 - strength * (height - 8));
    }
    ctx.strokeStyle = "#b4d590"; ctx.lineWidth = 1.7; ctx.stroke();
    ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath();
    const fill = ctx.createLinearGradient(0, 0, 0, height);
    fill.addColorStop(0, "#93bd6b55"); fill.addColorStop(1, "#789b5615");
    ctx.fillStyle = fill; ctx.fill();
  }

  function sparkline(canvas, series, minimumSpan) {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const ctx = surface(canvas, width, height);
    if (!ctx) return;
    const color = root.getComputedStyle(canvas).color;
    const lo = Math.min(...series), hi = Math.max(...series);
    const span = Math.max(minimumSpan, hi - lo) * 1.18;
    const centre = (lo + hi) * 0.5;
    const x = i => 2 + (width - 6) * i / (series.length - 1);
    const y = i => height * 0.5 - (series[i] - centre) / span * (height - 7);
    ctx.strokeStyle = color; ctx.lineWidth = 0.7; ctx.globalAlpha = 0.20; ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(0, height - 2); ctx.lineTo(width, height - 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(x(0), y(0));
    for (let i = 1; i < series.length; i++) ctx.lineTo(x(i), y(i));
    const last = series.length - 1;
    ctx.lineWidth = 1.4; ctx.lineJoin = "round"; ctx.globalAlpha = 0.95; ctx.stroke();
    ctx.lineTo(x(last), height); ctx.lineTo(x(0), height); ctx.closePath();
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, color); gradient.addColorStop(1, "transparent");
    ctx.globalAlpha = 0.19; ctx.fillStyle = gradient; ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x(last), y(last), 2.2, 0, TAU); ctx.fill();
  }

  function filledCurve(ctx, count, x, y, bottom, color) {
    ctx.beginPath(); ctx.moveTo(x(0), y(0));
    for (let i = 1; i < count; i++) ctx.lineTo(x(i), y(i));
    ctx.strokeStyle = color; ctx.lineWidth = 1.8; ctx.stroke();
    ctx.lineTo(x(count - 1), bottom); ctx.lineTo(x(0), bottom); ctx.closePath();
    const fill = ctx.createLinearGradient(0, 0, 0, bottom);
    fill.addColorStop(0, color + "50"); fill.addColorStop(1, color + "09");
    ctx.fillStyle = fill; ctx.fill();
  }

  function stationTrace(canvas, samples, span, ceiling) {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height || !samples.length) return;
    const ctx = surface(canvas, width, height);
    if (!ctx) return;
    const x = i => 3 + (width - 6) * samples[i].elapsed / span;
    const y = i => 3 + (height - 6) * (1 - samples[i].rain / ceiling);
    ctx.strokeStyle = "#34463f"; ctx.lineWidth = 0.7; ctx.beginPath();
    for (const fraction of [0.25, 0.5, 0.75]) {
      ctx.moveTo(0, height * fraction); ctx.lineTo(width, height * fraction);
      ctx.moveTo(width * fraction, 0); ctx.lineTo(width * fraction, height);
    }
    ctx.stroke();
    filledCurve(ctx, samples.length, x, y, height, "#89c9dc");
    const last = samples.length - 1;
    ctx.fillStyle = "#d2f6fa"; ctx.beginPath(); ctx.arc(x(last), y(last), 2.7, 0, TAU); ctx.fill();
  }

  function profileCurve(canvas, series, metric, cursor) {
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const ctx = surface(canvas, width, height);
    if (!ctx) return;
    // Track the centre of the overlaid range input's 14px thumb at both ends.
    const inset = Math.min(7, width / 2);
    const x = i => inset + (width - 2 * inset) * i / (series.length - 1);
    const y = i => 4 + (height - 8) * (metric.max - series[i]) / (metric.max - metric.min);
    ctx.lineWidth = 1; ctx.strokeStyle = "#344235";
    ctx.beginPath();
    for (const fraction of [0.25, 0.5, 0.75]) {
      const column = x(fraction * (series.length - 1));
      ctx.moveTo(column, 0); ctx.lineTo(column, height);
    }
    ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
    filledCurve(ctx, series.length, x, y, height, metric.color);
    ctx.strokeStyle = "#f0cb87"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x(cursor), 0); ctx.lineTo(x(cursor), height); ctx.stroke();
    ctx.fillStyle = "#ffdfaa"; ctx.beginPath(); ctx.arc(x(cursor), y(cursor), 3, 0, TAU); ctx.fill();
  }

  function degrees(bearing) {
    return String(Math.round(bearing) % 360).padStart(3, "0") + "°";
  }

  function cardinal(bearing) {
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(bearing / 45) % 8];
  }

  function stationLabel(local) {
    const azimuth = local.bearing === null || local.km < 0.05 ? "" : " · " + degrees(local.bearing);
    return local.zone + " · " + local.km.toFixed(1) + " km" + azimuth;
  }

  function clock(time) {
    const total = Math.floor(Math.max(0, time));
    const pair = n => String(n).padStart(2, "0");
    const minutes = Math.floor(total / 60);
    return (minutes >= 60 ? pair(Math.floor(minutes / 60)) + ":" : "") + pair(minutes % 60) + ":" + pair(total % 60);
  }

  const api = { drawIcon, compass, HISTORY_LENGTH, SAMPLE_INTERVAL, makeHistory, record, sparkline, cycleCurve,
    profileCurve, stationTrace, degrees, cardinal, stationLabel, clock };
  if (common) module.exports = api;
  else (root.Isobar ||= {}).ui = api;
})(globalThis);
