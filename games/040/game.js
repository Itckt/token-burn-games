'use strict';

const { KINDS, cellsOf, rotationCandidates, seededRandom, pieceStream } = require('./pieces');
const {
  WIDTH, HEIGHT, STONE, DIG_LAYERS, SURGE_WAVES, LOCKS_PER_WAVE, emptyRow, startingBoard, Surge,
} = require('./well');
const { PracticeHistory, UNDO_LIMIT } = require('./practice');

const LOCK_DELAY = 500;
const MAX_LOCK_RESETS = 15;
const LINE_POINTS = [0, 100, 300, 500, 800];
const MODES = ['endless', 'sprint', 'dig', 'surge', 'practice'];
const SPRINT_LINES = 40;

class Game {
  #bag;
  #surge;
  #practice;
  #fallTime = 0;
  #lockTime = 0;
  #lockResets = 0;
  #previousClearWasQuad = false;

  constructor(random = Math.random, mode = 'endless') {
    if (!MODES.includes(mode)) throw new RangeError(`Unknown game mode: ${mode}`);
    this.mode = mode;
    this.board = startingBoard(mode, random);
    this.score = 0;
    this.lines = 0;
    this.lastClear = null;
    this.stats = { pieces: 0, bestCombo: 0, clears: [0, 0, 0, 0] };
    this.elapsedMs = 0;
    this.status = 'playing';
    this.held = null;
    this.canHold = true;
    this.#surge = mode === 'surge' ? new Surge(random) : null;
    this.#practice = mode === 'practice' ? new PracticeHistory() : null;
    this.#bag = pieceStream(random);
    this.next = this.#draw();
    this.following = [this.#draw(), this.#draw()];
    this.#startTurn();
  }

  get finished() {
    return this.status === 'over' || this.status === 'won';
  }

  get layersLeft() {
    return this.board.filter(row => row.includes(STONE)).length;
  }

  get wave() {
    return this.#surge?.forecast ?? null;
  }

  get undosLeft() {
    return this.#practice?.available ?? 0;
  }

  get elapsedTenths() {
    return Math.floor(this.elapsedMs / 100);
  }

  get level() {
    return 1 + Math.floor(this.lines / 10);
  }

  get fallInterval() {
    return Math.max(80, Math.round(800 * 0.85 ** (this.level - 1)));
  }

  #fits(piece) {
    return cellsOf(piece).every(([x, y]) =>
      x >= 0 && x < WIDTH && y < HEIGHT && (y < 0 || this.board[y][x] === null)
    );
  }

  #spawn(kind) {
    const piece = { kind, rotation: 0, x: 3, y: 0 };
    this.#fallTime = 0;
    this.#lockTime = 0;
    this.#lockResets = 0;
    if (this.#fits(piece)) {
      this.active = piece;
    } else {
      this.#endGame();
    }
  }

  #draw() {
    return this.#practice ? this.#practice.draw(this.#bag) : this.#bag.next().value;
  }

  #spawnNext() {
    const kind = this.next;
    this.next = this.following.shift();
    this.following.push(this.#draw());
    this.#spawn(kind);
  }

  #startTurn() {
    this.#spawnNext();
    if (this.#practice && this.active) {
      this.#practice.startTurn({
        kind: this.active.kind, previousQuad: this.#previousClearWasQuad,
        board: this.board, score: this.score, lines: this.lines, lastClear: this.lastClear,
        stats: this.stats, held: this.held, next: this.next, following: this.following,
      });
    }
  }

  #undo() {
    if (this.undosLeft === 0 || this.status === 'paused') return false;
    const { kind, previousQuad, ...state } = this.#practice.undo();
    Object.assign(this, state);
    this.#previousClearWasQuad = previousQuad;
    this.canHold = true;
    this.status = 'playing';
    this.#spawn(kind);
    return true;
  }

  #endGame(status = 'over') {
    this.active = null;
    this.status = status;
    this.#practice?.finishTurn();
  }

  #grounded() {
    return !this.#fits({ ...this.active, y: this.active.y + 1 });
  }

  landingY() {
    if (!this.active) return null;
    const probe = { ...this.active };
    do {
      probe.y++;
    } while (this.#fits(probe));
    return probe.y - 1;
  }

  #clearRows() {
    const survivors = this.board.filter(row => row.includes(null));
    const count = HEIGHT - survivors.length;
    if (count === 0) {
      this.lastClear = null;
      return 0;
    }

    const combo = (this.lastClear?.combo ?? 0) + 1;
    const backToBack = count === 4 && this.#previousClearWasQuad;
    const comboBonus = 50 * (combo - 1);
    const quadBonus = backToBack ? 400 : 0;
    const points = (LINE_POINTS[count] + comboBonus + quadBonus) * this.level;
    this.lastClear = { count, combo, backToBack, points };
    this.#previousClearWasQuad = count === 4;
    this.stats.clears[count - 1]++;
    this.stats.bestCombo = Math.max(this.stats.bestCombo, combo);
    this.score += points;
    this.lines += count;
    this.board = [...Array.from({ length: count }, emptyRow), ...survivors];
    return count;
  }

  #resultAfterLock(cleared) {
    if (this.#surge) return this.#surge.afterLock(this.board, cleared);
    if (this.mode === 'sprint' && this.lines >= SPRINT_LINES) return 'won';
    if (this.mode === 'dig' && this.layersLeft === 0) return 'won';
    return null;
  }

  #lock() {
    const cells = cellsOf(this.active);
    if (cells.some(([, y]) => y < 0)) {
      this.#endGame();
      return;
    }
    for (const [x, y] of cells) this.board[y][x] = this.active.kind;
    this.stats.pieces++;
    const cleared = this.#clearRows();
    this.canHold = true;
    const result = this.#resultAfterLock(cleared);
    if (result) this.#endGame(result);
    else this.#startTurn();
  }

  #adjust(piece) {
    if (!this.#fits(piece)) return false;
    if (this.#grounded() && this.#lockResets < MAX_LOCK_RESETS) {
      this.#lockTime = 0;
      this.#lockResets++;
    }
    this.active = piece;
    return true;
  }

  #rotate(direction) {
    for (const candidate of rotationCandidates(this.active, direction)) {
      if (this.#adjust(candidate)) return true;
    }
    return false;
  }

  act(action) {
    if (action === 'undo') return this.#undo();
    if (this.finished) return false;
    if (action === 'pause') {
      this.status = this.status === 'playing' ? 'paused' : 'playing';
      return true;
    }
    if (this.status !== 'playing') return false;

    const piece = this.active;
    switch (action) {
      case 'left':
        return this.#adjust({ ...piece, x: piece.x - 1 });
      case 'right':
        return this.#adjust({ ...piece, x: piece.x + 1 });
      case 'cw':
        return this.#rotate(1);
      case 'ccw':
        return this.#rotate(-1);
      case 'soft':
        if (this.#grounded()) return false;
        piece.y++;
        this.#fallTime = 0;
        this.score++;
        return true;
      case 'hard': {
        const y = this.landingY();
        this.score += 2 * (y - piece.y);
        piece.y = y;
        this.#lock();
        return true;
      }
      case 'hold': {
        if (!this.canHold) return false;
        const previous = this.held;
        this.held = piece.kind;
        this.canHold = false;
        if (previous === null) this.#spawnNext();
        else this.#spawn(previous);
        return true;
      }
      default:
        return false;
    }
  }

  // Consume time up to each fall or lock, carrying the remainder to the next event.
  // This gives the same result even if a terminal frame arrives late.
  advance(milliseconds) {
    if (this.#practice || this.status !== 'playing') return false;
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return false;
    const before = this.elapsedTenths;
    let remaining = milliseconds;
    let changed = false;
    while (remaining > 0 && this.status === 'playing') {
      const grounded = this.#grounded();
      const wait = grounded ? LOCK_DELAY - this.#lockTime : this.fallInterval - this.#fallTime;
      const step = Math.min(remaining, wait);
      this.elapsedMs += step;
      remaining -= step;
      if (grounded) this.#lockTime += step;
      else this.#fallTime += step;
      if (step < wait) break;

      if (grounded) {
        this.#lock();
      } else {
        this.active.y++;
        this.#fallTime = 0;
      }
      changed = true;
    }
    return changed || (this.mode !== 'endless' && this.elapsedTenths !== before);
  }
}

module.exports = {
  WIDTH, HEIGHT, LOCK_DELAY, MAX_LOCK_RESETS, KINDS, MODES, SPRINT_LINES, DIG_LAYERS, STONE,
  SURGE_WAVES, LOCKS_PER_WAVE, UNDO_LIMIT,
  cellsOf, seededRandom, pieceStream, Game,
};

if (require.main === module) process.exitCode = require('./terminal').main();
