"use strict";

// Sticker directions and positions stay integral after every committed turn.
function createTwistCube(math) {
  const FACES = ["U", "R", "F", "D", "L", "B"];
  const FACE = {
    U: { axis: 1, side: 1, normal: [0, 1, 0], color: "#ffcf65", name: "Up" },
    R: { axis: 0, side: 1, normal: [1, 0, 0], color: "#ff806d", name: "Right" },
    F: { axis: 2, side: 1, normal: [0, 0, 1], color: "#729fff", name: "Front" },
    D: { axis: 1, side: -1, normal: [0, -1, 0], color: "#f4ede0", name: "Down" },
    L: { axis: 0, side: -1, normal: [-1, 0, 0], color: "#80d7a7", name: "Left" },
    B: { axis: 2, side: -1, normal: [0, 0, -1], color: "#b49af4", name: "Back" }
  };
  const ALL_MOVES = FACES.flatMap(face => [face, face + "2", face + "'"]);
  const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const STARTER = ["R", "U", "F'", "L", "D2", "B'", "R2", "U'"];
  // Local right, up and outward directions, looking straight at each face.
  // The unfolded net and the raised 3D stickers share these frames.
  const FRAMES = Object.fromEntries(FACES.map(face => {
    const normal = FACE[face].normal;
    const up = face === "U" ? [0, 0, -1] : face === "D" ? [0, 0, 1] : [0, 1, 0];
    return [face, [math.cross(up, normal), up, normal]];
  }));

  function create() {
    return math.lattice.map(slot => ({
      home: slot.slice(), pos: slot.slice(), basis: IDENTITY.slice(),
      faces: FACES.filter(f => slot[FACE[f].axis] === FACE[f].side)
    }));
  }

  function clone(pieces) {
    return pieces.map(p => ({ home: p.home.slice(), pos: p.pos.slice(),
      basis: p.basis.slice(), faces: p.faces.slice() }));
  }

  function describe(move) {
    if (typeof move !== "string" || !/^[URFDLB](2|')?$/.test(move)) {
      throw new RangeError("Unknown cube turn: " + move);
    }
    const face = move[0];
    const { axis, side } = FACE[face];
    const turns = move[1] === "2" ? 2 : move[1] === "'" ? -1 : 1;
    return { face, turns, axis, side, quarter: -side * turns };
  }

  function rotate(vector, axis, quarter) {
    let [x, y, z] = vector;
    const count = ((quarter % 4) + 4) % 4;
    for (let i = 0; i < count; i++) {
      if (axis === 0) [y, z] = [-z, y];
      else if (axis === 1) [x, z] = [z, -x];
      else [x, y] = [-y, x];
    }
    return [x || 0, y || 0, z || 0];
  }

  function turnLayer(pieces, { axis, side, quarter }) {
    for (const p of pieces) {
      if (p.pos[axis] !== side) continue;
      p.pos = rotate(p.pos, axis, quarter);
      for (let i = 0; i < 9; i += 3) {
        const rotated = rotate(p.basis.slice(i, i + 3), axis, quarter);
        for (let j = 0; j < 3; j++) p.basis[i + j] = rotated[j];
      }
    }
    return pieces;
  }

  function turn(pieces, move) {
    return turnLayer(pieces, describe(move));
  }

  function apply(pieces, moves) {
    const layers = [...moves].map(describe);
    for (const layer of layers) turnLayer(pieces, layer);
    return pieces;
  }

  function stickerNormal(piece, face) {
    const { axis, side } = FACE[face];
    return piece.basis.slice(axis * 3, axis * 3 + 3).map(n => (n * side) || 0);
  }

  function stickerCell(piece, sticker) {
    const normal = stickerNormal(piece, sticker);
    const face = FACES.find(f => normal[FACE[f].axis] === FACE[f].side);
    const [right, up] = FRAMES[face];
    const row = 1 - math.dot(piece.pos, up), col = 1 + math.dot(piece.pos, right);
    return { face, index: 3 * row + col };
  }

  function facelets(pieces) {
    const faces = Object.fromEntries(FACES.map(face => [face, new Array(9)]));
    for (const piece of pieces) {
      for (const sticker of piece.faces) {
        const { face, index } = stickerCell(piece, sticker);
        faces[face][index] = sticker;
      }
    }
    return faces;
  }

  function isSolved(pieces) {
    return pieces.every(p => p.faces.every(f => {
      const { axis, side } = FACE[f];
      return stickerNormal(p, f)[axis] === side;
    }));
  }

  function inverse(move) {
    const { face, turns } = describe(move);
    return turns === 2 ? move : turns === 1 ? face + "'" : face;
  }

  function inverseSequence(moves) {
    return moves.slice().reverse().map(inverse);
  }

  function simplify(moves) {
    const result = [];
    for (const move of moves) {
      const { face, turns } = describe(move);
      const last = result[result.length - 1];
      if (!last || last[0] !== face) {
        result.push(move);
        continue;
      }
      result.pop();
      const sum = (describe(last).turns + turns + 4) % 4;
      if (sum) result.push(face + ["", "", "2", "'"][sum]);
    }
    return result;
  }

  function scramble(length = 20, random = Math.random) {
    if (!Number.isInteger(length) || length < 0) throw new RangeError("Invalid scramble length");
    function pick(options) {
      const sample = random();
      if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new RangeError("Expected a random sample in [0, 1).");
      return options[Math.floor(sample * options.length)];
    }
    const moves = [];
    let lastAxis = -1;
    for (let i = 0; i < length; i++) {
      const choices = FACES.filter(face => FACE[face].axis !== lastAxis);
      const face = pick(choices);
      moves.push(face + pick(["", "'", "2"]));
      lastAxis = FACE[face].axis;
    }
    // An alternating-axis sequence can still be an identity. Changing only
    // its last turn preserves the length, axes and number of random samples.
    if (length && isSolved(apply(create(), moves))) {
      const last = moves[length - 1];
      moves[length - 1] = last.length === 1 ? last + "2" : last[0];
    }
    return moves;
  }

  // Each slot is listed in cyclic sticker order. Its first sticker defines orientation.
  const CORNERS = ["URF", "UFL", "ULB", "UBR", "DFR", "DLF", "DBL", "DRB"];
  const EDGES = ["UR", "UF", "UL", "UB", "DR", "DF", "DL", "DB", "FR", "FL", "BL", "BR"];
  function slotMap(slots) {
    return new Map(slots.map((slot, i) => {
      const pos = [0, 0, 0];
      for (const f of slot) pos[FACE[f].axis] = FACE[f].side;
      return [pos.join(","), i];
    }));
  }
  const cornerSlots = slotMap(CORNERS);
  const edgeSlots = slotMap(EDGES);

  function slotName(position) {
    const key = position.join(",");
    return CORNERS[cornerSlots.get(key)] || EDGES[edgeSlots.get(key)];
  }

  // Convert a hit on a lattice face into the identity of the corner or edge
  // occupying that cell. The same identity remains valid after another turn.
  function pieceAtSurface(pieces, { face, point, slot }) {
    const position = slot || point.map(value => math.clamp(Math.round(value), -1, 1));
    if (!slot) position[FACE[face].axis] = FACE[face].side;
    const piece = pieces.find(p => p.pos.every((value, i) => value === position[i]));
    return piece ? slotName(piece.home) ?? null : null;
  }

  function inspectPiece(pieces, name) {
    if (!CORNERS.includes(name) && !EDGES.includes(name)) return null;
    const piece = pieces.find(p => slotName(p.home) === name);
    return { piece, slot: slotName(piece.pos),
      stickers: Array.from(name, home => ({ home, ...stickerCell(piece, home) })) };
  }

  function coordinates(pieces) {
    const state = { cp: [], co: [], ep: [], eo: [] };
    for (const p of pieces) {
      if (p.faces.length === 1) continue;
      const corner = p.faces.length === 3;
      const slots = corner ? cornerSlots : edgeSlots;
      const names = corner ? CORNERS : EDGES;
      const slot = slots.get(p.pos.join(","));
      const id = slots.get(p.home.join(","));
      const normal = stickerNormal(p, names[id][0]);
      const orientation = [...names[slot]].findIndex(f => normal[FACE[f].axis] === FACE[f].side);
      (corner ? state.cp : state.ep)[slot] = id;
      (corner ? state.co : state.eo)[slot] = orientation;
    }
    return state;
  }

  const MOVE_STATES = ALL_MOVES.map(move => coordinates(turn(create(), move)));
  return { FACES, FACE, FRAMES, ALL_MOVES, MOVE_STATES, STARTER, create, clone, describe, rotate, turn, apply,
    stickerNormal, facelets, isSolved, inverse, inverseSequence, simplify, scramble, coordinates,
    CORNERS, EDGES, inspectPiece, pieceAtSurface };
}

var TwistCube = createTwistCube(typeof module !== "undefined" && module.exports ? require("./math.js") : TwistMath);
if (typeof module !== "undefined" && module.exports) module.exports = TwistCube;
