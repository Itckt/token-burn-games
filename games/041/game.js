'use strict';

const { ARENAS, DIRECTIONS, sameCell, inBounds, courtyardStalls, junctionGates, nextCell } = require('./arena');
const START_LENGTH = 3;
const MODES = Object.freeze(['standard', 'delivery', 'practice']);
const DELIVERY_GOAL = 5;
const CHEST_INTERVAL = 3;
const CHEST_POINTS = 3;
const MAX_SEED = 0xffffffff;

function nextChoice(choices, current) {
  return choices[(choices.indexOf(current) + 1) % choices.length];
}

function seededRandom(seed) {
  // A 32-bit linear congruential generator gives each rematch the same draws.
  let state = seed;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / (MAX_SEED + 1);
  };
}

class SnakeGame {
  constructor({ width = 28, height = 14, random = Math.random, arena = 'classic', mode = 'standard', seed } = {}) {
    if (!Number.isInteger(width) || width < 4 || !Number.isInteger(height) || height < 1) {
      throw new RangeError('The board needs at least four columns and one row.');
    }
    if (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED)) {
      throw new RangeError(`The seed must be a whole number from 0 to ${MAX_SEED}.`);
    }
    this.width = width;
    this.height = height;
    this.random = random;
    this.seed = seed;
    this.bestsByMode = new Map(MODES.map(name => [name, new Map()]));
    this.restart(arena, mode);
  }

  restart(arena = this.arena, mode = this.mode) {
    if (!ARENAS.includes(arena)) throw new RangeError(`Choose an arena from ${ARENAS.join(', ')}.`);
    if (!MODES.includes(mode)) throw new RangeError(`Choose a mode from ${MODES.join(', ')}.`);
    this.arena = arena;
    this.mode = mode;
    if (this.seed !== undefined) this.random = seededRandom(this.seed);
    this.drawCursor = mode === 'practice' ? {} : null;
    const x = Math.floor(this.width / 2);
    const y = Math.floor(this.height / 2);
    this.snake = Array.from({ length: START_LENGTH }, (_, index) => ({ x: x - index, y }));
    this.stalls = arena === 'courtyard' ? courtyardStalls(this.width, this.height) : [];
    this.gates = arena === 'junction' ? junctionGates(this.width, this.height) : {};
    this.direction = 'right';
    this.turns = [];
    this.status = 'ready';
    this.collision = null;
    this.moves = 0;
    this.bonusPoints = 0;
    this.chest = null;
    this.food = this.placeFood();
  }

  cycleArena() {
    if (this.canChooseRound) this.restart(nextChoice(ARENAS, this.arena));
  }

  cycleMode() {
    if (this.canChooseRound) this.restart(this.arena, nextChoice(MODES, this.mode));
  }

  get finished() {
    return this.status === 'lost' || this.status === 'won';
  }

  get canChooseRound() {
    return this.status === 'ready' || this.finished;
  }

  get playableCells() {
    return this.width * this.height - this.stalls.length;
  }

  get goal() {
    const growth = this.playableCells - START_LENGTH;
    return this.mode === 'delivery' ? Math.min(DELIVERY_GOAL, growth) : growth;
  }

  get moveLimit() {
    return this.mode === 'delivery' ? 2 * (this.width + this.height) : null;
  }

  get bites() {
    return this.snake.length - START_LENGTH;
  }

  get score() {
    return this.bites + this.bonusPoints;
  }

  get bestByArena() {
    return this.bestsByMode.get(this.mode);
  }

  get best() {
    return this.bestByArena.get(this.arena) ?? 0;
  }

  get tickMs() {
    return Math.max(90, 200 - 5 * this.bites);
  }

  placeFood() {
    return this.randomFreeCell(this.chest);
  }

  nextDraw() {
    if (!this.drawCursor) return this.random();
    // A practice checkpoint holds this cursor. A retry reuses the draw even with Math.random.
    // Old draws fall out of memory with the last checkpoint that can reach them.
    const cursor = this.drawCursor;
    if (!cursor.next) {
      cursor.value = this.random();
      cursor.next = {};
    }
    this.drawCursor = cursor.next;
    return cursor.value;
  }

  randomFreeCell(reserved) {
    const occupied = new Set([...this.snake, ...this.stalls].map(({ x, y }) => y * this.width + x));
    if (reserved) occupied.add(reserved.y * this.width + reserved.x);
    const free = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (!occupied.has(y * this.width + x)) free.push({ x, y });
      }
    }
    return free.length ? free[Math.floor(this.nextDraw() * free.length)] : null;
  }

  snapshot() {
    // Segment coordinates and food are replaced on movement. The array and chest timer are mutable.
    return {
      snake: this.snake.slice(),
      food: this.food,
      chest: this.chest && { ...this.chest },
      direction: this.direction,
      status: this.status,
      collision: this.collision,
      moves: this.moves,
      bites: this.bites,
      bonusPoints: this.bonusPoints,
      score: this.score,
      drawCursor: this.drawCursor,
    };
  }

  restorePractice(frame) {
    this.status = this.status === 'paused' ? 'paused' : frame.status;
    this.snake = frame.snake.slice();
    this.food = frame.food;
    this.chest = frame.chest && { ...frame.chest };
    this.direction = frame.direction;
    this.turns = [];
    this.collision = frame.collision;
    this.moves = frame.moves;
    this.bonusPoints = frame.bonusPoints;
    this.drawCursor = frame.drawCursor;
  }

  turn(direction) {
    if (this.status !== 'ready' && this.status !== 'running') return false;
    if (typeof direction !== 'string' || !Object.hasOwn(DIRECTIONS, direction)) return false;

    // Validate against the last planned turn so two quick corners stay legal.
    const planned = this.turns.at(-1) ?? this.direction;
    if (direction === DIRECTIONS[planned].opposite) return false;
    if (direction !== planned) {
      if (this.turns.length === 2) return false;
      this.turns.push(direction);
    }
    this.status = 'running';
    return true;
  }

  togglePause() {
    if (this.status === 'running') this.status = 'paused';
    else if (this.status === 'ready' || this.status === 'paused') this.status = 'running';
  }

  collisionAt(next, eating) {
    if (!inBounds(this, next)) return 'wall';
    if (this.stalls.some(stall => sameCell(next, stall))) return 'stall';
    // On an ordinary move the tail vacates its cell as the head enters the next one.
    const solidLength = eating ? this.snake.length : this.snake.length - 1;
    if (this.snake.some((part, index) => index < solidLength && sameCell(next, part))) return 'self';
    return null;
  }

  advanceChest(head) {
    if (!this.chest) return;
    if (sameCell(head, this.chest)) {
      this.bonusPoints += CHEST_POINTS;
      this.chest = null;
    } else {
      this.chest.movesLeft--;
      if (this.chest.movesLeft === 0) this.chest = null;
    }
  }

  afterBite() {
    // The final empty square always belongs to the bun needed to win.
    if (this.playableCells - this.snake.length === 1) this.chest = null;
    this.food = this.placeFood();
    if (this.arena !== 'classic' && !this.chest && this.bites % CHEST_INTERVAL === 0) {
      const cell = this.randomFreeCell(this.food);
      if (cell) this.chest = { ...cell, movesLeft: this.width + this.height };
    }
  }

  tick() {
    if (this.status !== 'running') return;
    this.moves++;
    this.direction = this.turns.shift() ?? this.direction;
    const next = nextCell(this, this.snake[0], this.direction);
    const eating = sameCell(next, this.food);
    this.collision = this.collisionAt(next, eating);
    if (this.collision) {
      this.status = 'lost';
      return;
    }

    this.snake.unshift(next);
    if (eating) this.food = null;
    else this.snake.pop();
    this.advanceChest(next);
    if (this.bites === this.goal) {
      this.status = 'won';
      this.chest = null;
    } else if (this.moves === this.moveLimit) {
      this.status = 'lost';
    } else if (eating) {
      this.afterBite();
    }
    if (this.score > this.best) this.bestByArena.set(this.arena, this.score);
  }
}

module.exports = { SnakeGame, ARENAS, MODES, DELIVERY_GOAL, CHEST_INTERVAL, CHEST_POINTS, MAX_SEED };
