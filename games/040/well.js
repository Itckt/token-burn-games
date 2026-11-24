'use strict';

const WIDTH = 10;
const HEIGHT = 20;
const STONE = 'stone';
const DIG_LAYERS = 8;
const WAVE_ROWS = [1, 1, 2, 2, 3, 3];
const SURGE_WAVES = WAVE_ROWS.length;
const LOCKS_PER_WAVE = 4;

function emptyRow() {
  return Array(WIDTH).fill(null);
}

function stoneRow(gap) {
  const row = Array(WIDTH).fill(STONE);
  row[gap] = null;
  return row;
}

// Consecutive groups open in different columns. Deal all gaps before play so
// holds and cancelled rows cannot change the course for a given seed.
function stoneGaps(count, random) {
  let gap = Math.floor(random() * WIDTH);
  const gaps = [gap];
  while (gaps.length < count) {
    gap = (gap + 1 + Math.floor(random() * (WIDTH - 1))) % WIDTH;
    gaps.push(gap);
  }
  return gaps;
}

function startingBoard(mode, random) {
  const board = Array.from({ length: HEIGHT }, emptyRow);
  if (mode === 'dig') {
    const gaps = stoneGaps(DIG_LAYERS / 2, random);
    for (let depth = 0; depth < DIG_LAYERS; depth++) {
      board[HEIGHT - DIG_LAYERS + depth] = stoneRow(gaps[Math.floor(depth / 2)]);
    }
  }
  return board;
}

class Surge {
  #gaps;
  #completed = 0;
  #locksLeft = LOCKS_PER_WAVE;
  #rows = WAVE_ROWS[0];

  constructor(random) {
    this.#gaps = stoneGaps(SURGE_WAVES, random);
  }

  get forecast() {
    return {
      completed: this.#completed, locksLeft: this.#locksLeft, rows: this.#rows,
      gap: this.#gaps[this.#completed] ?? null,
    };
  }

  // Resolve the locking piece's clears before raising the floor or spawning.
  afterLock(board, cleared) {
    this.#rows = Math.max(0, this.#rows - cleared);
    this.#locksLeft--;
    if (this.#locksLeft > 0) return null;

    const displaced = board.slice(0, this.#rows);
    if (displaced.some(row => row.some(Boolean))) return 'over';
    board.splice(0, this.#rows);
    for (let i = 0; i < this.#rows; i++) board.push(stoneRow(this.#gaps[this.#completed]));

    this.#completed++;
    this.#rows = WAVE_ROWS[this.#completed] ?? 0;
    if (this.#completed === SURGE_WAVES) return 'won';
    this.#locksLeft = LOCKS_PER_WAVE;
    return null;
  }
}

module.exports = { WIDTH, HEIGHT, STONE, DIG_LAYERS, SURGE_WAVES, LOCKS_PER_WAVE, emptyRow, startingBoard, Surge };
