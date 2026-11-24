'use strict';

const UNDO_LIMIT = 20;

class PracticeHistory {
  #turns = [];
  #current = null;
  #upcoming = [];

  get available() {
    return this.#turns.length;
  }

  draw(bag) {
    const kind = this.#upcoming.shift() ?? bag.next().value;
    this.#current?.draws.push(kind);
    return kind;
  }

  startTurn(state) {
    this.finishTurn();
    this.#current = { state: structuredClone(state), draws: [] };
  }

  finishTurn() {
    if (!this.#current) return;
    this.#turns.push(this.#current);
    if (this.#turns.length > UNDO_LIMIT) this.#turns.shift();
    this.#current = null;
  }

  undo() {
    const turn = this.#turns.pop();
    // A hold in the abandoned turn may also have drawn from the bag. Return
    // those pieces in deal order so even an unseeded game can replay a branch.
    this.#upcoming = turn.draws.concat(this.#current?.draws ?? [], this.#upcoming);
    this.#current = { state: turn.state, draws: [] };
    return structuredClone(turn.state);
  }
}

module.exports = { UNDO_LIMIT, PracticeHistory };
