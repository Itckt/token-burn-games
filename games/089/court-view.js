'use strict';

const CourtView = (() => {
  const colors = ['#ffa274', '#f2cd73', '#eaa1aa', '#6dd2b8', '#8fc9e7', '#afa8e2'];
  const turn = Math.PI * 2;

  function markings(ctx, width, height) {
    const unit = Math.min(width / 840, height / 480);
    const surface = ctx.createLinearGradient(0, 0, width, height);
    surface.addColorStop(0, '#224942');
    surface.addColorStop(1, '#163735');
    ctx.fillStyle = surface;
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = unit;
    ctx.strokeStyle = 'rgba(190, 219, 194, 0.09)';
    ctx.beginPath();
    for (let column = 0; column < 21; column++) {
      const x = (column + 0.5) / 21 * width;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let row = 0; row < 12; row++) {
      const y = row / 12 * height;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    ctx.strokeStyle = 'rgba(183, 214, 185, 0.30)';
    ctx.setLineDash([5 * unit, 8 * unit]);
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 68 * unit, 0, turn);
    ctx.stroke();
    for (const x of [0, width]) {
      ctx.beginPath();
      ctx.arc(x, height / 2, 78 * unit, 0, turn);
      ctx.stroke();
    }
    ctx.fillStyle = '#93b0a0';
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, 2.5 * unit, 0, turn);
    ctx.fill();

    ctx.lineWidth = 2 * unit;
    ctx.strokeStyle = '#9cb9a5';
    ctx.beginPath();
    const inset = 3 * unit;
    for (const x of [inset, width - inset]) {
      for (const y of [inset, height - inset]) {
        ctx.moveTo(x + (x === inset ? 13 : -13) * unit, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + (y === inset ? 13 : -13) * unit);
      }
    }
    ctx.stroke();
  }

  function arrow(ctx, x, y, dx, dy, color) {
    const length = Math.hypot(dx, dy);
    if (length < 1) return;
    const tipX = x + dx;
    const tipY = y + dy;
    const nx = dx / length;
    const ny = dy / length;
    const head = Math.min(7, length / 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tipX, tipY);
    ctx.moveTo(tipX - nx * head - ny * head / 2, tipY - ny * head + nx * head / 2);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(tipX - nx * head + ny * head / 2, tipY - ny * head - nx * head / 2);
    ctx.stroke();
  }

  function trail(ctx, ball, points, color) {
    ctx.strokeStyle = color;
    for (let i = 0; i < points.length; i++) {
      const next = points[i + 1] || ball;
      const strength = (i + 1) / points.length;
      ctx.globalAlpha = strength * 0.42;
      ctx.lineWidth = 1 + strength * ball.radius * 0.14;
      ctx.beginPath();
      ctx.moveTo(points[i].x, points[i].y);
      ctx.lineTo(next.x, next.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function disc(ctx, ball, color) {
    const { x, y, radius } = ball;
    ctx.fillStyle = 'rgba(5, 20, 18, 0.34)';
    ctx.beginPath();
    ctx.arc(x + 1.5, y + 3, radius, 0, turn);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, turn);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 241, 0.50)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0, radius - 3.5), 1.05 * Math.PI, 1.70 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = '#203431';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 ' + Math.max(1, Math.round(radius * 0.70)) + 'px "IBM Plex Mono", Consolas, monospace';
    ctx.fillText(String(ball.id).padStart(2, '0'), x, y + 0.5);
  }

  function drawBumper(ctx, { id, x, y, radius }) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, turn);
    ctx.fillStyle = '#102d2a';
    ctx.fill();
    ctx.lineWidth = radius * 0.08;
    ctx.strokeStyle = '#b3c7ad';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.78, 0, turn);
    ctx.lineWidth = radius * 0.035;
    ctx.stroke();
    ctx.fillStyle = '#d4dfcb';
    ctx.font = '600 ' + Math.max(1, Math.round(radius * 0.53)) + 'px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('B' + id, x, y);
  }

  function drawRail(ctx, { id, x1, y1, x2, y2, radius = 8 }, previewColor) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineCap = 'round';
    ctx.lineWidth = 2 * radius;
    ctx.strokeStyle = previewColor ?? '#a8bb9d';
    ctx.stroke();
    ctx.lineWidth = 1.6 * radius;
    ctx.strokeStyle = '#304e45';
    ctx.stroke();
    if (id === undefined) return;
    ctx.fillStyle = '#f2f4dc';
    ctx.font = '600 ' + Math.max(1, Math.round(radius * 1.2)) + 'px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('R' + id, x1 + (x2 - x1) / 2, y1 + (y2 - y1) / 2);
  }

  function drawGate(ctx, gate, unit, color = '#8fe2da') {
    const { id, x1, y1, x2, y2 } = gate;
    ctx.lineWidth = 2 * unit;
    ctx.strokeStyle = color;
    ctx.setLineDash([5 * unit, 5 * unit]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);
    if (x1 === x2 && y1 === y2) return;
    const { tx, ty } = CourtGeometry.segmentAxis(gate);
    const x = x1 + (x2 - x1) / 2, y = y1 + (y2 - y1) / 2;
    arrow(ctx, x, y, 17 * unit * ty, -17 * unit * tx, color);
    if (id === undefined) return;
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = '600 ' + (13 * unit) + 'px Consolas, monospace';
    ctx.fillText('G' + id, x - 14 * unit * ty, y + 14 * unit * tx);
  }

  function drawForecast(ctx, points, unit) {
    ctx.strokeStyle = '#ffe3a2';
    ctx.fillStyle = '#ffe3a2';
    ctx.lineWidth = 2 * unit;
    ctx.setLineDash([6 * unit, 4 * unit]);
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const point of points) {
      if (!point.hits) continue;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 3 * unit, 0, turn);
      ctx.fill();
    }
    const end = points.at(-1);
    ctx.beginPath();
    ctx.arc(end.x, end.y, 6 * unit, 0, turn);
    ctx.stroke();
  }

  function draw(ctx, world, history, vectors, aim, pixelRatio, forecast) {
    const canvas = ctx.canvas;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const width = Math.max(1, Math.round(rect.width * pixelRatio));
    const height = Math.max(1, Math.round(rect.height * pixelRatio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    ctx.setTransform(width / world.width, 0, 0, height / world.height, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    markings(ctx, world.width, world.height);
    const unit = Math.min(world.width / 840, world.height / 480);
    for (const gate of world.gates) drawGate(ctx, gate, unit);
    for (const rail of world.rails) drawRail(ctx, rail);
    for (const bumper of world.bumpers) drawBumper(ctx, bumper);

    for (const b of world.balls) {
      const color = colors[(b.id - 1) % colors.length];
      if (history.has(b.id)) trail(ctx, b, history.get(b.id), color);
      const speed = Math.hypot(b.vx, b.vy);
      if (vectors && speed > 0) {
        const offset = (b.radius + 3) / speed;
        arrow(ctx, b.x + b.vx * offset, b.y + b.vy * offset, b.vx / 4, b.vy / 4, color);
      }
    }
    if (forecast) drawForecast(ctx, forecast.points, unit);
    for (const b of world.balls) disc(ctx, b, colors[(b.id - 1) % colors.length]);
    if (aim?.tool === 'gate') {
      drawGate(ctx, aim, unit, world.canPlaceGate(aim) ? '#8fe2da' : '#ffac8d');
    } else if (aim?.tool === 'rail') {
      drawRail(ctx, aim, world.canPlaceRail(aim) ? '#e4efcc' : '#ffac8d');
    } else if (aim) {
      const clear = world.canPlace(aim.x, aim.y, aim.radius);
      const color = clear ? '#e4efcc' : '#ffac8d';
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(aim.x, aim.y, aim.radius, 0, turn);
      ctx.stroke();
      ctx.setLineDash([]);
      arrow(ctx, aim.x, aim.y, aim.vx / 3, aim.vy / 3, color);
    }
  }

  return { draw };
})();
