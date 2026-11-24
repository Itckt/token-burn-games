'use strict';

const ARENAS = Object.freeze(['classic', 'loop', 'courtyard', 'junction']);
const DIRECTIONS = {
  up:    { dx: 0,  dy: -1, opposite: 'down' },
  down:  { dx: 0,  dy: 1,  opposite: 'up' },
  left:  { dx: -1, dy: 0,  opposite: 'right' },
  right: { dx: 1,  dy: 0,  opposite: 'left' },
};

function sameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

function inBounds(board, { x, y }) {
  return x >= 0 && x < board.width && y >= 0 && y < board.height;
}

function courtyardStalls(width, height) {
  const stalls = [];
  if (width < 7 || height < 5) return stalls;

  // Four stalls leave the perimeter, middle aisle and starting row open.
  const top = Math.floor((height - 1) / 3);
  const middle = Math.floor(width / 2);
  for (const y of [top, height - 1 - top]) {
    for (let x = Math.floor(width / 6); x < middle - 1; x++) {
      stalls.push({ x, y }, { x: width - 1 - x, y });
    }
  }
  return stalls;
}

function junctionGates(width, height) {
  const leftY = Math.floor((height - 1) / 3);
  const topX = Math.floor((width - 1) / 3);
  return {
    left:  { x: 0, y: leftY, mark: 'A' },
    right: { x: width - 1, y: height - 1 - leftY, mark: 'A' },
    up:    { x: topX, y: 0, mark: 'B' },
    down:  { x: width - 1 - topX, y: height - 1, mark: 'B' },
  };
}

function nextCell(board, from, direction) {
  const { dx, dy, opposite } = DIRECTIONS[direction];
  const gate = board.gates[direction];
  if (gate && sameCell(from, gate)) {
    const { x, y } = board.gates[opposite];
    return { x, y };
  }
  const x = from.x + dx;
  const y = from.y + dy;
  if (board.arena === 'loop') {
    return { x: (x + board.width) % board.width, y: (y + board.height) % board.height };
  }
  return { x, y };
}

module.exports = { ARENAS, DIRECTIONS, sameCell, inBounds, courtyardStalls, junctionGates, nextCell };
