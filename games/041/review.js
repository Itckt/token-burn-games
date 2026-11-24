'use strict';

const REVIEW_MOVES = 64;

class MoveReview {
  constructor(game) {
    this.frames = [];
    this.index = null;
    this.record(game);
  }

  record(game) {
    this.frames.push(game.snapshot());
    // Keep the board before the oldest retained move as well as its result.
    if (this.frames.length > REVIEW_MOVES + 1) this.frames.shift();
  }

  get current() {
    return this.index === null ? null : this.frames[this.index];
  }

  open() {
    this.index = this.frames.length - 1;
  }

  undo(game) {
    if (game.mode !== 'practice' || this.index !== null || this.frames.length < 2) return false;
    this.frames.pop();
    game.restorePractice(this.frames.at(-1));
    return true;
  }

  navigate(key) {
    const last = this.frames.length - 1;
    switch (key) {
      case 'a': case 'left': this.index = Math.max(0, this.index - 1); break;
      case 'd': case 'right': this.index = Math.min(last, this.index + 1); break;
      case 'home': this.index = 0; break;
      case 'end': this.index = last; break;
      case 'v': this.index = null; break;
      default: return false;
    }
    return true;
  }
}

module.exports = { MoveReview, REVIEW_MOVES };
