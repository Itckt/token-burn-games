(function (root) {
  'use strict';
  const M = root.HarbourMath, F = root.HarbourFlight, C = root.HarbourCity, Quay = root.HarbourQuay;
  const Beacon = root.HarbourBeacon, Cargo = root.HarbourCargo, Cableway = root.HarbourCableway;
  // Plot world x/z. North is negative z. The backing canvas is twice the chart's design size.
  const mapPoint = (x, z) => [84 + x * 0.80, 24 + z * 0.40];
  function line(ctx, points) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.stroke();
  }
  function routeIcons(buttons, selected) {
    const icons = [
      [[[2,14],[6,15],[10,14],[14,15],[18,14],[22,15],[26,14]],[[3,11],[7,12],[11,11],[15,12],[19,11],[24,12]],[[7,9],[11,8],[14,4],[16,9],[21,9]]],
      [[[2,17],[2,10],[7,10],[7,5],[12,5],[12,17]],[[15,17],[15,2],[20,2],[20,13],[24,13],[24,17]],[[9,8],[10,8]],[[17,5],[18,5]],[[17,8],[18,8]]],
      [[[2,16],[8,12],[12,12],[17,8],[21,8],[26,4]],[[2,12],[8,8],[12,8],[17,4],[21,4]],[[3,19],[9,15],[13,15],[18,11],[23,11]]],
      [[[2,13],[26,13],[21,17],[6,17],[2,13]],[[6,12],[6,8],[21,8],[22,12]],[[9,7],[9,4],[18,4],[18,7]],[[10,10],[12,10]],[[15,10],[18,10]]]
    ];
    buttons.forEach((button, i) => {
      const ctx = button.querySelector('canvas').getContext('2d');
      ctx.setTransform(2,0,0,2,0,0); ctx.clearRect(0,0,28,22); ctx.lineWidth = 1.3;
      ctx.strokeStyle = i === selected ? '#ff9a7b' : '#a5b3b3';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      icons[i].forEach(points => line(ctx, points));
    });
  }
  function chartBase(city) {
    const plate = document.createElement('canvas'); plate.width = 336; plate.height = 136;
    const ctx = plate.getContext('2d'); ctx.scale(2,2);
    ctx.fillStyle = '#142126'; ctx.fillRect(0,0,168,68);
    ctx.strokeStyle = '#253338'; ctx.lineWidth = 0.55;
    for (let x = 0; x < 168; x += 14) line(ctx, [[x,0],[x,68]]);
    for (let y = 0; y < 68; y += 13) line(ctx, [[0,y],[168,y]]);
    const shore = [];
    for (let x = -109; x <= 109; x += 2) shore.push(mapPoint(x, C.shoreZ(x)));
    ctx.beginPath(); ctx.moveTo(-4,-2); shore.forEach(p => ctx.lineTo(...p)); ctx.lineTo(172,-2);
    ctx.fillStyle = '#29373a'; ctx.fill();
    ctx.strokeStyle = '#697879'; ctx.lineWidth = 0.7; line(ctx, shore);
    ctx.fillStyle = '#3a4849';
    for (const b of [...city.buildings, ...city.landmarks]) {
      const [x, y] = mapPoint(b.x - b.width / 2, b.z - b.depth / 2);
      if (x < 168 && x > -12 && y > -4) ctx.fillRect(x, y, b.width * 0.7, b.depth * 0.33);
    }
    const near = [];
    for (let x = -110; x < 112; x += 3) near.push(mapPoint(x, 111 + 8*Math.sin(x/22) + 7*Math.cos(x/35)));
    ctx.beginPath(); ctx.moveTo(-5,71); near.forEach(p => ctx.lineTo(...p)); ctx.lineTo(173,71);
    ctx.fillStyle = '#29373a'; ctx.fill(); ctx.strokeStyle = '#59696a'; line(ctx, near);
    const track = [];
    for (let x = -84; x <= 92; x += 4) track.push(mapPoint(x, Quay.trackZ(x)));
    ctx.strokeStyle = '#51827d'; line(ctx, track);
    ctx.fillStyle = '#82a8a0';
    for (const stop of Quay.stops) {
      const [x, y] = mapPoint(stop.x, Quay.trackZ(stop.x));
      ctx.fillRect(x - 0.7, y - 1.5, 1.4, 3);
    }
    const pier = root.HarbourTide.landing;
    const [px, py] = mapPoint(pier.x - pier.width / 2, pier.z - pier.depth / 2);
    ctx.fillStyle = '#c9a371';
    ctx.fillRect(px, py, pier.width * 0.80, pier.depth * 0.40);
    ctx.strokeStyle = ctx.fillStyle;
    line(ctx, [mapPoint(pier.gateX, C.shoreZ(pier.gateX)), mapPoint(pier.gateX, pier.z)]);
    const berth = Cargo.berth;
    const [bx,,bz] = Cargo.point(Cargo.reach, 0);
    ctx.strokeStyle = '#c39465';
    line(ctx, [mapPoint(berth.x, berth.z), mapPoint(bx, bz)]);
    const barge = [[-2.6,6.6],[2.6,6.6],[2.6,-6.6],[-2.6,-6.6],[-2.6,6.6]];
    line(ctx, barge.map(([a,b]) => {
      const [x,,z] = Cargo.point(Cargo.reach + a, 0, b);
      return mapPoint(x, z);
    }));
    const [lx, , lz] = root.HarbourLanterns.origin;
    const [hx, hy] = mapPoint(lx, lz);
    ctx.strokeStyle = '#f2b98e';
    line(ctx, [[hx,hy-2.3], [hx+1.8,hy], [hx,hy+2.3], [hx-1.8,hy], [hx,hy-2.3]]);
    const terminals = Cableway.stations.map(station => mapPoint(station.x, station.z));
    ctx.strokeStyle = '#77938b'; line(ctx, terminals);
    ctx.fillStyle = '#a0b8a8';
    for (const [x, y] of terminals) ctx.fillRect(x - 1.4, y - 1.4, 2.8, 2.8);
    return plate;
  }
  function routePlate(base, routeIndex) {
    const plate = document.createElement('canvas');
    plate.width = base.width; plate.height = base.height;
    const ctx = plate.getContext('2d');
    ctx.drawImage(base, 0, 0); ctx.scale(2, 2);
    const path = [];
    for (let i = 0; i <= 100; i++) {
      const {eye} = F.sampleRoute(routeIndex, F.routes[routeIndex].duration * i / 100);
      path.push(mapPoint(eye[0], eye[2]));
    }
    ctx.strokeStyle = '#dc8169'; ctx.lineWidth = 0.9; ctx.setLineDash([2.5,2]); line(ctx, path);
    return plate;
  }
  function circle(ctx, point, radius, color, filled) {
    ctx.beginPath(); ctx.arc(...point, radius, 0, M.TAU);
    if (filled) { ctx.fillStyle = color; ctx.fill(); }
    else { ctx.strokeStyle = color; ctx.stroke(); }
  }
  function vessel(ctx, boat, color) {
    const [x, y] = mapPoint(boat.x, boat.z);
    const heading = Math.atan2(Math.sin(boat.angle) * 0.4, Math.cos(boat.angle) * 0.8);
    const dx = Math.cos(heading), dy = Math.sin(heading);
    ctx.beginPath(); ctx.moveTo(x + 2.6 * dx, y + 2.6 * dy);
    ctx.lineTo(x - 1.8 * dx - dy, y - 1.8 * dy + dx);
    ctx.lineTo(x - 1.8 * dx + dy, y - 1.8 * dy - dx); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
  }
  class Chart {
    constructor(canvas) { this.canvas = canvas; }
    setCity(city) {
      const base = chartBase(city);
      this.plates = F.routes.map((_, i) => routePlate(base, i));
    }
    pick(clientX, clientY) {
      const {left, top, width, height} = this.canvas.getBoundingClientRect();
      const x = clientX - left, y = clientY - top;
      if (!this.markers || !(width > 0 && height > 0 && x >= 0 && x < width && y >= 0 && y < height)) return null;
      let nearest = null, distance = 9;
      // Use CSS pixels and the last painted chart. A slow frame must not move the hit target.
      for (const [id, [mx, my]] of Object.entries(this.markers)) {
        const d = Math.hypot(mx * width / 168 - x, my * height / 68 - y);
        if (d < distance) { nearest = id; distance = d; }
      }
      return nearest;
    }
    draw(state, shot, aspect) {
      const ctx = this.canvas.getContext('2d');
      ctx.setTransform(1,0,0,1,0,0); ctx.drawImage(this.plates[state.route], 0, 0); ctx.scale(2,2);
      ctx.lineWidth = 0.75;
      const eye = mapPoint(shot.eye[0], shot.eye[2]);
      const time = state.worldTime;
      this.markers = {};
      for (const id of F.lookouts) {
        const point = F.lookoutPoint(id, time);
        if (point) this.markers[id] = mapPoint(point[0], point[2]);
      }
      const [lx,,lz] = Beacon.lamp, [dx, dz] = Beacon.direction(time);
      const beamLength = state.lookout === 'beacon' ? Beacon.waterContact(root.HarbourTide.heightAt(time))[1] : 12;
      const lens = mapPoint(lx, lz);
      ctx.strokeStyle = '#e8c48d';
      line(ctx, [lens, mapPoint(lx + dx * beamLength, lz + dz * beamLength)]);
      circle(ctx, lens, 1.6, '#f1cd91', true);
      const target = this.markers[state.lookout];
      if (target) {
        ctx.strokeStyle = '#9ac9bd88'; ctx.setLineDash([1.3,2]); line(ctx, [eye, target]); ctx.setLineDash([]);
        circle(ctx, target, 4.4, '#a0dfd1', false);
      }
      circle(ctx, this.markers.wheel, 2.0, '#9cdbcc', false);
      const [tx, ty] = this.markers.tram;
      ctx.fillStyle = '#b3e5d4'; ctx.fillRect(tx - 2.3, ty - 0.85, 4.6, 1.7);
      circle(ctx, this.markers.timehouse, 2.1, '#f4d19d', true);
      circle(ctx, this.markers.cableway, 2.0, '#83decc', true);
      circle(ctx, this.markers.cargo, 1.5, '#e5a56a', true);
      vessel(ctx, C.ferryPose(time), '#b8b68e');
      vessel(ctx, C.ferryPose(time, 1), '#a8b8a6');
      vessel(ctx, C.junkPose(time), '#ef9b7e');
      const {forward, right} = M.cameraBasis(shot.eye, shot.aim, shot.up);
      const [width] = F.lensFor(shot.fov, aspect, state.magnification);
      ctx.beginPath(); ctx.moveTo(...eye);
      for (const edge of [-width, width]) {
        const ray = M.normalize(M.add(forward, M.scale(right, edge)));
        ctx.lineTo(...mapPoint(shot.eye[0] + ray[0] * 25, shot.eye[2] + ray[2] * 25));
      }
      ctx.closePath(); ctx.fillStyle = '#ff987a31'; ctx.fill();
      circle(ctx, eye, 4.3, '#ff916c88', false); circle(ctx, eye, 2.1, '#ff9671', true);
    }
  }
  root.HarbourChart = {Chart, routeIcons};
})(globalThis);
