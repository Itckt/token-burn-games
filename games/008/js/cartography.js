(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./math"), require("./noise"), require("./terrain"), require("./hydrology"), require("./waterways"));
  else root.FieldAtlas.art = factory(root.FieldAtlas.math, root.FieldAtlas.noise, root.FieldAtlas.terrain, root.FieldAtlas.hydrology, root.FieldAtlas.waterways);
})(globalThis, function (M, N, T, H, W) {
  "use strict";

  // A raster without mesh topology uses the cell centre to resolve saddles.
  // On the survey bed, both the topology and each bend follow the seeded diagonal.
  function contourSegments(values, width, height, level, splits) {
    const segments = [], levelEdges = new Set();
    function connect(a, b) {
      if (a[0] === b[0] && a[1] === b[1]) return;
      if (splits && Number.isInteger(a[0]) && Number.isInteger(a[1]) && Number.isInteger(b[0]) && Number.isInteger(b[1])) {
        const i = a[1] * width + a[0], j = b[1] * width + b[0];
        const edge = Math.min(i, j) * (width * height) + Math.max(i, j);
        if (levelEdges.has(edge)) return;
        levelEdges.add(edge);
      }
      segments.push([a, b]);
    }
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const k = y * width + x;
        const a = values[k], b = values[k + 1], c = values[k + width + 1], d = values[k + width];
        const aa = a >= level, bb = b >= level, cc = c >= level, dd = d >= level;
        if (aa === bb && aa === cc && aa === dd) continue;
        const p = [];
        if (aa !== bb) p.push([x + (level - a) / (b - a), y]);
        if (bb !== cc) p.push([x + 1, y + (level - b) / (c - b)]);
        if (cc !== dd) p.push([x + (level - d) / (c - d), y + 1]);
        if (dd !== aa) p.push([x, y + (level - a) / (d - a)]);
        const split = splits?.[y * (width - 1) + x];
        if (splits && (split ? aa !== cc : bb !== dd)) {
          const t = split ? (level - a) / (c - a) : (level - b) / (d - b);
          const diagonal = [x + (split ? t : 1 - t), y + t];
          connect(p[0], diagonal); connect(diagonal, p[1]);
        } else if (p.length === 4 && (splits ? !split : ((a + b + c + d) / 4 >= level) !== aa)) {
          connect(p[0], p[3]); connect(p[1], p[2]);
        } else {
          connect(p[0], p[1]);
          if (p.length === 4) connect(p[2], p[3]);
        }
      }
    }
    return segments;
  }
  function atlas(world, grid) {
    const sheet = document.createElement("canvas");
    const size = 800, ctx = sheet.getContext("2d");
    if (!ctx) return null;
    sheet.width = sheet.height = size;
    ctx.fillStyle = world.style.mapTint; ctx.fillRect(0, 0, size, size);
    const unit = size / grid.segments;
    // A fixed north-west light makes the relief readable beneath the contours.
    const relief = ["#081b223d", "#081b2229", "#081b2214", null, "#e8e5af10", "#e8e5af22", "#e8e5af36"];
    for (let z = 0; z < grid.segments; z++) {
      for (let x = 0; x < grid.segments; x++) {
        const k = z * grid.side + x;
        const slope = (grid.heights[k + grid.side + 1] - grid.heights[k]) / (Math.SQRT2 * grid.step);
        const shade = relief[M.clamp(Math.round(slope * 3) + 3, 0, 6)];
        if (shade) { ctx.fillStyle = shade; ctx.fillRect(x * unit, z * unit, unit, unit); }
      }
    }
    const { low, high } = T.heightRange(grid);
    for (let level = Math.ceil(low / 2) * 2; level <= high; level += 2) {
      const major = level % 10 === 0;
      ctx.strokeStyle = major ? "#b1be90a8" : "#9ba98578";
      ctx.lineWidth = major ? 1.65 : 1.0; ctx.beginPath();
      for (const [a, b] of contourSegments(grid.heights, grid.side, grid.side, level, grid.splits)) {
        ctx.moveTo(a[0] * unit, a[1] * unit); ctx.lineTo(b[0] * unit, b[1] * unit);
      }
      ctx.stroke();
    }
    return sheet;
  }
  function paintDepth(ctx, grid, level, unit, fill, stroke, includeLevel) {
    const shore = [];
    ctx.beginPath();
    const measured = H.inundation(grid, level, polygon => {
      ctx.moveTo(polygon[0][0] * unit, polygon[0][1] * unit);
      for (let i = 1; i < polygon.length; i++) ctx.lineTo(polygon[i][0] * unit, polygon[i][1] * unit);
      ctx.closePath();
    }, (a, b) => shore.push(a, b), includeLevel);
    ctx.fillStyle = fill; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < shore.length; i += 2) {
      ctx.moveTo(shore[i][0] * unit, shore[i][1] * unit);
      ctx.lineTo(shore[i + 1][0] * unit, shore[i + 1][1] * unit);
    }
    ctx.strokeStyle = stroke; ctx.lineWidth = 1.45; ctx.stroke();
    return measured;
  }
  // Both map layers reuse the contour sheet and paint only when their inputs change.
  function floodMap(base, grid, level, previous) {
    const sheet = base && (previous || document.createElement("canvas"));
    const ctx = sheet?.getContext("2d");
    if (!ctx) return { sheet: null, ...H.inundation(grid, level) };
    if (sheet.width !== base.width || sheet.height !== base.height) {
      sheet.width = base.width; sheet.height = base.height;
    }
    ctx.drawImage(base, 0, 0);
    return { sheet, ...paintDepth(ctx, grid, level, base.width / grid.segments, "#619fa68c", "#b8ded6", false) };
  }
  function depthChart(base, grid, level) {
    const sheet = document.createElement("canvas"), ctx = sheet.getContext("2d");
    if (!ctx) return base;
    sheet.width = base.width; sheet.height = base.height;
    ctx.drawImage(base, 0, 0);
    for (const band of W.BANDS) {
      paintDepth(ctx, grid, level - band.depth, base.width / grid.segments, band.color, "#c6ddd3", band.depth > 0);
    }
    return sheet;
  }
  function mapFrame(w, h, position, overview) {
    if (overview) {
      const tile = Math.min(w, h) * 0.91;
      return { unit: tile / (2 * T.HALF), tile, ox: (w - tile) / 2, oz: (h - tile) / 2 };
    }
    const unit = Math.max(w / (T.HALF * 1.36), h / (2 * T.HALF)), tile = unit * 2 * T.HALF;
    return { unit, tile,
      ox: M.clamp(w * 0.51 - (position[0] + T.HALF) * unit, w - tile, 0),
      oz: M.clamp(h * 0.57 - (position[2] + T.HALF) * unit, h - tile, 0) };
  }
  function mapPoint(frame, x, z) {
    return [frame.ox + (x + T.HALF) * frame.unit, frame.oz + (z + T.HALF) * frame.unit];
  }
  function groundPoint(frame, px, py) {
    const x = (px - frame.ox) / frame.unit - T.HALF, z = (py - frame.oz) / frame.unit - T.HALF;
    // The outermost pixel can round a few ulps beyond the world after projection and inversion.
    if (!(Math.max(Math.abs(x), Math.abs(z)) <= T.HALF + 1e-8)) return null;
    return [M.clamp(x, -T.HALF, T.HALF), M.clamp(z, -T.HALF, T.HALF)];
  }
  function drawCourse(ctx, frame, marks, size) {
    const toMap = (x, z) => mapPoint(frame, x, z);
    const path = marks.route.samples;
    function pin(x, z, label) {
      const [px, py] = toMap(x, z);
      ctx.beginPath(); ctx.arc(px, py, size, 0, M.TAU);
      ctx.fillStyle = "#f0d496"; ctx.fill();
      ctx.strokeStyle = "#3d4938"; ctx.lineWidth = size * 0.18; ctx.stroke();
      ctx.fillStyle = "#263e31"; ctx.fillText(label, px, py);
    }
    ctx.save();
    ctx.font = "bold " + Math.round(size * 1.22) + "px monospace";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.strokeStyle = marks.draft ? "#f1d59875" : marks.runoff ? "#9ae5e0" : "#f1d598";
    ctx.lineWidth = Math.max(1, size * (marks.runoff ? 0.33 : 0.22));
    ctx.setLineDash(marks.runoff ? [] : [size * 0.72, size * 0.48]);
    ctx.beginPath(); ctx.moveTo(...toMap(path[0].x, path[0].z));
    for (let i = 1; i < path.length; i++) ctx.lineTo(...toMap(path[i].x, path[i].z));
    ctx.stroke(); ctx.setLineDash([]);
    if (marks.draft) {
      const { first, cursor } = marks.draft, [x, y] = toMap(...cursor);
      ctx.strokeStyle = "#ffe5a6";
      if (first) {
        ctx.beginPath(); ctx.moveTo(...toMap(...first)); ctx.lineTo(x, y); ctx.stroke();
        pin(...first, "A");
      }
      ctx.beginPath(); ctx.arc(x, y, size, 0, M.TAU);
      ctx.moveTo(x - size * 1.5, y); ctx.lineTo(x + size * 1.5, y);
      ctx.moveTo(x, y - size * 1.5); ctx.lineTo(x, y + size * 1.5); ctx.stroke();
    } else if (marks.flight) {
      const run = marks.flight, next = run.splits.length;
      for (let i = run.course.gates.length - 1; i >= next; i--) {
        const [x, , z] = run.course.gates[i].center;
        if (i === next) pin(x, z, String(i + 1));
        else {
          ctx.beginPath(); ctx.arc(...toMap(x, z), size * 0.60, 0, M.TAU);
          ctx.strokeStyle = "#a3e4d8"; ctx.lineWidth = size * 0.27; ctx.stroke();
        }
      }
    } else {
      const last = path.at(-1), station = marks.station;
      const [x, y] = toMap(station.x, station.z);
      ctx.beginPath(); ctx.arc(x, y, size * 0.52, 0, M.TAU);
      ctx.fillStyle = "#fffbe9"; ctx.fill(); ctx.strokeStyle = "#3d4938"; ctx.stroke();
      pin(path[0].x, path[0].z, "A"); pin(last.x, last.z, "B");
    }
    if (marks.hit) {
      const [x, y] = toMap(marks.hit.x, marks.hit.z), r = size * 1.12;
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
      ctx.strokeStyle = "#20332e"; ctx.lineWidth = size * 0.58; ctx.stroke();
      ctx.strokeStyle = "#ffedbd"; ctx.lineWidth = size * 0.25; ctx.stroke();
    }
    ctx.restore();
  }
  function drawMap(canvas, sheet, camera, marks) {
    const w = canvas.width, h = canvas.height, ctx = canvas.getContext("2d"), p = camera.position;
    const overview = marks?.overview || !!marks?.draft;
    const frame = mapFrame(w, h, p, overview);
    const { unit, tile, ox, oz } = frame;
    ctx.clearRect(0, 0, w, h); ctx.drawImage(sheet, ox, oz, tile, tile);
    ctx.lineWidth = Math.max(0.65, w / 600); ctx.strokeStyle = "#e3e9c02d"; ctx.beginPath();
    const grid = unit * 45, left = Math.max(0, ox), top = Math.max(0, oz);
    const right = Math.min(w, ox + tile), bottom = Math.min(h, oz + tile);
    for (let x = ox + Math.ceil((left - ox) / grid) * grid; x < right; x += grid) {
      ctx.moveTo(x, top); ctx.lineTo(x, bottom);
    }
    for (let y = oz + Math.ceil((top - oz) / grid) * grid; y < bottom; y += grid) {
      ctx.moveTo(left, y); ctx.lineTo(right, y);
    }
    ctx.stroke();
    if (overview) {
      ctx.strokeStyle = "#d7d9af91"; ctx.beginPath();
      ctx.moveTo(ox, oz); ctx.lineTo(right, oz); ctx.lineTo(right, bottom); ctx.lineTo(ox, bottom);
      ctx.closePath(); ctx.stroke();
    }
    if (marks) drawCourse(ctx, frame, marks, Math.max(4, Math.min(w, h) * 0.029));
    const [x, y] = mapPoint(frame, p[0], p[2]);
    const r = Math.max(8, w * 0.033);
    ctx.save(); ctx.translate(x, y); ctx.rotate(camera.yaw);
    const cone = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 3.8);
    cone.addColorStop(0, "#e4bb6f85"); cone.addColorStop(1, "#d8b07505");
    ctx.fillStyle = cone; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, r * 3.8, -2.14, -1.0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#e6c89485"; ctx.lineWidth = Math.max(1, r / 10);
    ctx.beginPath(); ctx.arc(0, 0, r * 1.13, 0, M.TAU); ctx.stroke();
    ctx.fillStyle = "#f5ce83"; ctx.strokeStyle = "#344535"; ctx.lineWidth = r * 0.13;
    ctx.beginPath(); ctx.moveTo(0, -r * 0.83); ctx.lineTo(r * 0.56, r * 0.58); ctx.lineTo(0, r * 0.32);
    ctx.lineTo(-r * 0.56, r * 0.58); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  const posters = {
    alpine: { sky: ["#e4c58c", "#f1dfae"], sun: "#f8e7ab", far: "#9aab8a", mid: "#778e73",
      ridge: "#576f5b", side: "#84936e", low: "#3e5d4c", near: "#284d3b", water: "#9aaf91", snow: "#e1dcc0" },
    canyon: { sky: ["#eab282", "#f6d5a1"], sun: "#fae1a4", far: "#ce9272", mid: "#b87b57",
      ridge: "#a05e45", side: "#ce8b5b", low: "#995c3f", near: "#714a38", water: "#a99066", snow: "#e5b187" },
    fjord: { sky: ["#b8c9d4", "#e0dcce"], sun: "#e8e4d4", far: "#a4b4bc", mid: "#8097aa",
      ridge: "#647c90", side: "#8a9fae", low: "#465f77", near: "#354e60", water: "#98afbb", snow: "#e0e3dc" },
    caldera: { sky: ["#dbb298", "#f4dbac"], sun: "#fff0bf", far: "#ab9890", mid: "#ad7961",
      ridge: "#78594e", side: "#ad8865", low: "#685b47", near: "#464b3c", water: "#80b4aa" }
  };
  // Small original atlas illustrations, drawn at display resolution for sharp preset cards.
  function poster(canvas, id) {
    const palette = posters[id], rng = N.random(N.seedNumber("plate/" + id)), ctx = canvas.getContext("2d");
    const w = 480, h = 140;
    ctx.save(); ctx.scale(canvas.width / w, canvas.height / h);
    function polygon(points, color) {
      ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(...points[0]);
      for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]);
      ctx.closePath(); ctx.fill();
    }
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, palette.sky[0]); sky.addColorStop(1, palette.sky[1]);
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = palette.sun; ctx.beginPath(); ctx.arc(id === "alpine" ? 336 : 107, 34, 16, 0, M.TAU); ctx.fill();
    for (let i = 0; i < 5; i++) {
      const x = rng() * w, y = 10 + rng() * 38;
      polygon([[x-31,y+1],[x-5,y],[x+8,y-2],[x+40,y],[x+54,y+2],[x-22,y+3]], "#fff1cd4a");
    }
    function ridge(line, color) { polygon([...line, [w + 5, h], [-5, h]], color); }
    const far = [];
    for (let x = -10; x <= w + 10; x += 12) far.push([x, 58 + Math.sin(x * 0.035) * 8 + rng() * 10]);
    ridge(far, palette.far);
    if (id === "caldera") {
      ridge([[-5,58],[46,49],[90,33],[128,28],[159,38],[206,46],[247,42],[295,32],
        [333,35],[371,22],[413,27],[453,43],[485,46]], palette.mid);
      ridge([[-5,67],[46,53],[90,40],[128,28],[113,54],[140,62],[205,69],[260,63],
        [309,49],[333,35],[325,53],[359,48],[371,22],[386,49],[448,61],[485,57]], palette.ridge);
      ridge([[-5,70],[54,61],[109,68],[164,77],[225,80],[282,77],[334,66],
        [398,62],[485,71]], palette.side);
      polygon([[-5,76],[73,73],[161,79],[232,83],[330,73],[428,68],[485,74],
        [485,110],[349,122],[178,119],[48,98],[-5,88]], palette.water);
      polygon([[269,89],[293,86],[308,65],[321,79],[330,84],[348,88],[312,92]], palette.ridge);
      polygon([[308,65],[321,79],[330,84],[348,88],[321,87]], palette.mid);
      for (let i = 0; i < 46; i++) {
        ctx.fillStyle = i % 3 ? "#e5e3bd77" : "#577d7659";
        ctx.fillRect(84 + rng() * 164, 84 + rng() * 20, 3 + rng() * 13, 0.8);
      }
      ridge([[-5,71],[37,77],[76,88],[126,103],[190,114],[240,120],[187,123],
        [115,114],[69,111],[-5,92]], palette.low);
      polygon([[480,79],[442,81],[394,92],[360,101],[286,113],[253,122],[324,122],[480,103]], palette.low);
      ridge([[-5,97],[39,102],[87,114],[167,126],[242,136],[315,125],[383,118],[441,105],[485,99]], palette.near);
      ctx.restore();
      return;
    } else if (id === "canyon") {
      ridge([[-5,65],[24,63],[34,44],[79,42],[83,57],[99,59],[110,79],[168,82],[193,73],[207,70],
        [218,42],[266,41],[272,53],[289,54],[298,69],[334,72],[360,62],[371,47],[406,46],[411,60],[480,64]], palette.mid);
      ridge([[-5,50],[39,50],[49,67],[69,69],[79,77],[103,78],[125,96],[199,102],[245,95],[269,80],
        [299,78],[313,52],[332,50],[338,36],[390,35],[398,61],[416,63],[425,80],[480,86]], palette.ridge);
      for (const [x,y,xx,yy] of [[39,50,81,81],[313,52,350,91],[391,35,420,85],[332,50,369,74]]) {
        polygon([[x,y],[x+7,y+15],[xx,yy],[xx-13,yy+3],[x-5,y+25]], palette.side);
      }
    } else {
      const line = id === "fjord"
        ? [[-5,80],[42,55],[65,60],[116,14],[145,39],[168,26],[210,65],[240,79],[280,65],[312,31],[333,46],[364,17],[396,60],[430,37],[482,69]]
        : [[-5,82],[36,67],[60,72],[103,48],[119,54],[169,19],[199,46],[224,36],[263,69],[289,73],[323,55],[352,42],[391,65],[425,53],[484,78]];
      ridge(line, palette.mid);
      for (let i = 1; i < line.length - 1; i++) {
        const [x,y] = line[i], next = line[i+1], prev = line[i-1];
        if (y >= prev[1] || y >= next[1]) continue;
        polygon([[x,y],next,[x+18,94],[x+6,y+26],[x+10,y+23]], palette.ridge);
        if (y < 43) polygon([[x,y],[M.lerp(x,next[0],.41),M.lerp(y,next[1],.41)],
          [x+7,y+9],[x+9,y+15],[x+1,y+10],[x-6,y+15],[x-5,y+10],
          [M.lerp(x,prev[0],.43),M.lerp(y,prev[1],.43)]], palette.snow);
      }
    }
    ridge([[-4,77],[40,73],[72,78],[105,90],[151,95],[179,101],[235,105],[296,100],[331,87],[389,78],[448,82],[484,75]], palette.side);
    ctx.fillStyle = palette.water; ctx.fillRect(0, 101, w, 39);
    for (let i = 0; i < 32; i++) {
      ctx.fillStyle = i % 3 ? "#f4e7ca52" : "#4d62673a"; ctx.fillRect(rng()*w, 102+rng()*38, 4+rng()*31, .8);
    }
    ridge([[-3,84],[44,89],[78,99],[124,103],[153,108],[98,114],[22,112],[-3,117]], palette.low);
    polygon([[w,88],[438,87],[404,94],[355,98],[331,105],[297,108],[333,112],[384,112],[w,105]], palette.low);
    const front = [[-3,103],[53,105],[97,114],[142,121],[210,128],[255,140],[w,140],[-3,145]];
    polygon(front, palette.near);
    polygon([[w,108],[447,111],[416,118],[374,123],[347,129],[326,140],[w,140]], palette.near);
    if (id !== "canyon") {
      function pine(x,y,s,col) {
        polygon([[x,y-s],[x+s*.15,y-s*.60],[x+s*.08,y-s*.59],[x+s*.23,y-s*.31],[x+s*.13,y-s*.30],
          [x+s*.3,y],[x-s*.3,y],[x-s*.13,y-s*.3],[x-s*.23,y-s*.31],[x-s*.08,y-s*.59],[x-s*.15,y-s*.6]],col);
      }
      for (let i = 0; i < 72; i++) {
        const x = rng() * 104, right = i % 3 === 0;
        pine(right ? w-x : x, right ? 112+x*.16 : 106+x*.11, (8+rng()*31)*(1-x/155), palette.near);
      }
    } else {
      for (let i=0; i<28; i++) {
        const x=rng()*94; polygon([[x,106+x*.11],[x+3,99+x*.11],[x+7,103+x*.11],[x+8,107+x*.11]],palette.near);
      }
    }
    ctx.restore();
  }
  return { contourSegments, atlas, floodMap, depthChart, mapFrame, mapPoint, groundPoint, drawMap, poster };
});
