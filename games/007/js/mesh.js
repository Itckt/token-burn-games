"use strict";

var TwistMesh = (function (math, cube) {
  const frames = cube.FRAMES;
  const STRIDE = 10;
  const HALF = 0.492, RADIUS = 0.084;
  const empty = () => ({ vertices: [], indices: [] });
  function local(frame, x, y, z) {
    return [0, 1, 2].map(i => frame[0][i] * x + frame[1][i] * y + frame[2][i] * z);
  }
  function vertex(mesh, position, normal, color, gloss) {
    const index = mesh.vertices.length / STRIDE;
    mesh.vertices.push(...position, ...normal, ...color, gloss);
    return index;
  }
  function rgb(hex) {
    return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  }

  // Five ink pixels across, seven rows down. Each home face owns one
  // eight-pixel cell in a single-channel WebGL 1 texture.
  function letterAtlas() {
    const glyphs = {
      U: [17, 17, 17, 17, 17, 17, 14],
      R: [30, 17, 17, 30, 20, 18, 17],
      F: [31, 16, 16, 30, 16, 16, 16],
      D: [30, 17, 17, 17, 17, 17, 30],
      L: [16, 16, 16, 16, 16, 16, 31],
      B: [30, 17, 17, 30, 17, 17, 30]
    };
    const width = 64, height = 8, pixels = new Uint8Array(width * height);
    cube.FACES.forEach((face, cell) => {
      glyphs[face].forEach((bits, row) => {
        for (let col = 0; col < 5; col++) {
          if (bits & (16 >> col)) pixels[(6 - row) * width + cell * 8 + 1 + col] = 255;
        }
      });
    });
    return { width, height, pixels };
  }

  function roundedBox(segments = 4) {
    const mesh = empty(), inner = HALF - RADIUS, coords = [];
    for (let j = 0; j <= segments; j++) coords.push(-HALF + RADIUS * j / segments);
    for (let j = 0; j <= segments; j++) coords.push(inner + RADIUS * j / segments);
    const count = coords.length;
    for (const frame of Object.values(frames)) {
      const start = mesh.vertices.length / STRIDE;
      for (const y of coords) for (const x of coords) {
        const p = local(frame, x, y, HALF);
        const core = p.map(n => math.clamp(n, -inner, inner));
        const normal = math.unit(math.subtract(p, core));
        vertex(mesh, core.map((n, i) => n + normal[i] * RADIUS), normal, [0.065, 0.076, 0.089], 1);
      }
      for (let y = 0; y < count - 1; y++) for (let x = 0; x < count - 1; x++) {
        const i = start + y * count + x;
        mesh.indices.push(i, i + 1, i + count + 1, i, i + count + 1, i + count);
      }
    }
    return mesh;
  }

  function sticker(face, mark = false) {
    const mesh = empty(), frame = frames[face], color = rgb(cube.FACE[face].color);
    const center = vertex(mesh, local(frame, 0, 0, 0.503), frame[2], color, 0.35);
    const outline = [];
    const flat = 0.333, segments = 7;
    for (let corner = 0; corner < 4; corner++) {
      const cx = corner === 0 || corner === 3 ? flat : -flat;
      const cy = corner < 2 ? flat : -flat;
      for (let i = 0; i <= segments; i++) {
        const angle = (corner + i / segments) * Math.PI / 2;
        outline.push([cx, cy, Math.cos(angle), Math.sin(angle)]);
      }
    }
    for (const [cx, cy, x, y] of outline) {
      vertex(mesh, local(frame, cx + x * 0.102, cy + y * 0.102, 0.503), frame[2], color, 0.35);
      vertex(mesh, local(frame, cx + x * 0.114, cy + y * 0.114, 0.494),
        math.unit(local(frame, x * 0.8, y * 0.8, 0.7)), color, 0.55);
    }
    for (let i = 0; i < outline.length; i++) {
      const top = 1 + i * 2, next = 1 + ((i + 1) % outline.length) * 2;
      mesh.indices.push(center, top, next, top, top + 1, next + 1, top, next + 1, next);
    }
    if (mark) {
      // A small three-part maker's mark printed on the upper center tile.
      const ink = color.map(n => n * 0.59);
      const panels = [
        [[0,0.125],[-0.098,0.07],[0,0.014],[0.098,0.07]],
        [[-0.11,0.049],[-0.11,-0.056],[-0.012,-0.113],[-0.012,-0.008]],
        [[0.012,-0.008],[0.012,-0.113],[0.11,-0.056],[0.11,0.049]]
      ];
      for (const panel of panels) {
        const start = mesh.vertices.length / STRIDE;
        for (const [x, y] of panel) vertex(mesh, local(frame, x, y, 0.504), frame[2], ink, 0.3);
        mesh.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
      }
    }
    return mesh;
  }
  function cubeMeshes(pieces) {
    const body = roundedBox(), tiles = {}, marked = sticker("U", true);
    for (const face of cube.FACES) tiles[face] = sticker(face);
    const all = empty(), ranges = [];
    for (const piece of pieces) {
      const first = all.indices.length;
      const parts = [body, ...piece.faces.map(f => f === "U" && piece.faces.length === 1 ? marked : tiles[f])];
      for (const part of parts) {
        const offset = all.vertices.length / STRIDE;
        all.vertices.push(...part.vertices);
        for (const index of part.indices) all.indices.push(offset + index);
      }
      ranges.push({ first, count: all.indices.length - first });
    }
    return { vertices: new Float32Array(all.vertices), indices: new Uint16Array(all.indices), ranges };
  }
  return { STRIDE, HALF, frames, rgb, letterAtlas, roundedBox, sticker, cubeMeshes };
})(typeof module !== "undefined" && module.exports ? require("./math.js") : TwistMath,
   typeof module !== "undefined" && module.exports ? require("./cube.js") : TwistCube);

if (typeof module !== "undefined" && module.exports) module.exports = TwistMesh;
