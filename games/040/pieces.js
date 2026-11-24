'use strict';

// Each square grid rotates around its center. The square piece stays fixed.
const layouts = {
  I: ['....', '####', '....', '....'],
  J: ['#..', '###', '...'],
  L: ['..#', '###', '...'],
  O: ['.##.', '.##.', '....', '....'],
  S: ['.##', '##.', '...'],
  T: ['.#.', '###', '...'],
  Z: ['##.', '.##', '...'],
};
const KINDS = Object.keys(layouts);
const shapes = {};

for (const [kind, grid] of Object.entries(layouts)) {
  let cells = [];
  for (const [y, row] of grid.entries()) {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '#') cells.push([x, y]);
    }
  }
  shapes[kind] = [];
  for (let turn = 0; turn < 4; turn++) {
    shapes[kind].push(cells);
    if (kind !== 'O') cells = cells.map(([x, y]) => [grid.length - 1 - y, x]);
  }
}

// Clockwise kick offsets indexed by the starting rotation, with y growing down.
// For a counterclockwise turn, traverse the reverse transition and negate its offsets.
const regularKicks = [
  [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
];
const lineKicks = [
  [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
];

function cellsOf({ kind, rotation = 0, x = 0, y = 0 }) {
  return shapes[kind][rotation].map(([dx, dy]) => [x + dx, y + dy]);
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function* pieceStream(random) {
  for (;;) {
    const bag = [...KINDS];
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    yield* bag;
  }
}

// Try the rotation in place before the wall and floor kicks for this transition.
function* rotationCandidates(piece, direction) {
  if (piece.kind === 'O') return;
  const rotation = (piece.rotation + direction + 4) % 4;
  const kicks = piece.kind === 'I' ? lineKicks : regularKicks;
  const from = direction === 1 ? piece.rotation : rotation;
  for (const [dx, dy] of kicks[from]) {
    yield { ...piece, rotation, x: piece.x + direction * dx, y: piece.y + direction * dy };
  }
}

module.exports = { KINDS, cellsOf, rotationCandidates, seededRandom, pieceStream };
