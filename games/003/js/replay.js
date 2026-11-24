(function (root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('./battle.js') : root.Rift.battle, common ? require('./math.js') : root.Rift.math);
  if (common) module.exports = api;
  else (root.Rift = root.Rift || {}).replay = api;
})(globalThis, function (B, M) {
  'use strict';

  const CHECKPOINT_STEPS = Math.round(15 / B.STEP);

  function snapshot(match) {
    return {state:JSON.stringify(match), random:match.random.state()};
  }
  function restore(point) {
    const match = JSON.parse(point.state);
    match.random = M.seeded(point.random);
    return match;
  }
  function apply(match, order) {
    if (order.kind === 'deploy') return B.deploy(match, 0, order.lane, order.card);
    if (order.kind === 'guard') return B.guard(match, 0, order.lane);
    if (order.kind === 'coil') return B.placeCoil(match, 0, order.lane, order.socket);
    return {ok:false, error:'Unknown order'};
  }

  class Recording {
    constructor(options, start) {
      this.match = start ? restore(start) : B.create(options);
      this.setup = start ? null : {mode:this.match.mode, deck:[...this.match.deck], seed:this.match.random.state(),
        ai:this.match.ai, opening:options?.opening !== false};
      this.length = 0;
      this.orders = [];
      this.moments = [{step:0, kind:'opening', message:start ? 'Practice position' : 'Opening position'}];
      this.checkpoints = [];
      this.checkpoint();
    }
    checkpoint() {
      this.checkpoints.push({
        step: this.length, nextOrder: this.orders.length, ...snapshot(this.match)
      });
    }
    collectMoments(firstId) {
      const log = this.match.log;
      let count = 0;
      while (count < log.length && log[count].id >= firstId) count++;
      // The feed is newest first. The film lists events in resolution order,
      // including a delivery and its winning result on the same tick.
      while (count > 0) {
        const {kind, message} = log[--count];
        if (kind) this.moments.push({step:this.length, kind, message});
      }
    }
    order(kind, lane, selection) {
      const order = {step:this.length, kind, lane};
      if (kind === 'deploy') order.card = selection;
      if (kind === 'coil') order.socket = selection;
      const firstId = this.match.nextId;
      const result = apply(this.match, order);
      if (result.ok) {
        this.orders.push(order);
        this.collectMoments(firstId);
      }
      return result;
    }
    advance() {
      if (this.match.phase !== 'playing') return;
      const firstId = this.match.nextId;
      B.tick(this.match);
      this.length++;
      this.collectMoments(firstId);
      if (this.length % CHECKPOINT_STEPS === 0 || this.match.phase === 'ended') this.checkpoint();
    }
  }

  class Playback {
    constructor(recording) {
      this.recording = recording;
      this.seek(0);
    }
    get atEnd() { return this.position === this.recording.length; }
    ordersAtPosition() {
      const orders = this.recording.orders;
      while (this.nextOrder < orders.length && orders[this.nextOrder].step === this.position) {
        apply(this.match, orders[this.nextOrder++]);
      }
    }
    advance() {
      this.ordersAtPosition();
      if (this.atEnd) return;
      B.tick(this.match);
      this.position++;
      this.ordersAtPosition();
    }
    takeOver() {
      this.ordersAtPosition();
      if (this.atEnd || this.match.phase !== 'playing') return null;
      // Start a new tape here. Past orders are already reflected in this snapshot.
      return new Recording(undefined, snapshot(this.match));
    }
    seek(step) {
      if (!Number.isFinite(step)) return;
      const target = M.clamp(Math.round(step), 0, this.recording.length);
      // Checkpoints precede any player orders on their boundary tick. Restoring
      // the order cursor preserves two valid commands issued between frames.
      const checkpoint = this.recording.checkpoints.findLast(point => point.step <= target);
      if (!this.match || target < this.position || checkpoint.step > this.position) {
        this.match = restore(checkpoint);
        this.position = checkpoint.step;
        this.nextOrder = checkpoint.nextOrder;
      }
      this.ordersAtPosition();
      while (this.position < target) this.advance();
    }
  }

  return {Recording, Playback};
});
