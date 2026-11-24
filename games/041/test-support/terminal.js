'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { SnakeGame } = require('../game');
const { runSession } = require('../snake');

class ManualClock {
  timers = new Set();

  setTimeout(callback, delay) {
    const timer = { callback, delay };
    this.timers.add(timer);
    return timer;
  }

  clearTimeout(timer) {
    this.timers.delete(timer);
  }

  next() {
    assert.equal(this.timers.size, 1, 'the running game should have exactly one pending tick');
    return [...this.timers][0];
  }

  tick() {
    const timer = this.next();
    this.timers.delete(timer);
    timer.callback();
  }
}

function terminal(columns = 80, rows = 24) {
  const input = new PassThrough();
  const modes = [];
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = enabled => {
    modes.push({ enabled, flowing: input.readableFlowing });
    input.isRaw = enabled;
    return input;
  };
  const writes = [];
  const output = Object.assign(new EventEmitter(), {
    columns, rows, isTTY: true,
    write(text) { writes.push(text); return true; },
  });
  return { input, output, writes, modes };
}

function session(t, options = {}) {
  const { input, output, writes, modes } = terminal(options.columns, options.rows);
  if (options.alreadyRaw) input.setRawMode(true);
  if (options.alreadyFlowing) input.resume();
  const game = options.game ?? new SnakeGame({ random: () => 0 });
  const clock = new ManualClock();
  const signals = new EventEmitter();
  const stop = runSession({ input, output, signals, clock, game, color: options.color ?? false });
  t.after(() => { stop(); input.destroy(); });
  const press = keys => input.write(Buffer.from(keys));
  const frame = () => writes.at(-1);
  const resize = (columns, rows) => {
    Object.assign(output, { columns, rows });
    output.emit('resize');
  };
  return { input, output, writes, modes, game, clock, signals, stop, press, frame, resize };
}

function frameRows(frame) {
  return frame.replace(/\x1b\[[\d;]+m/g, '').split(/\x1b\[\d+;\d+H/).slice(1);
}

module.exports = { terminal, session, frameRows };
