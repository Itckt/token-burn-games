'use strict';

const { emitKeypressEvents } = require('node:readline');
const { SnakeGame } = require('./game');
const { MoveReview } = require('./review');
const { drawScreen, fits } = require('./screen');

const MOVE_KEYS = {
  w: 'up', a: 'left', s: 'down', d: 'right',
  up: 'up', left: 'left', down: 'down', right: 'right',
};
const EXIT_EVENTS = ['SIGINT', 'SIGTERM', 'exit'];

function runSession({
  input = process.stdin,
  output = process.stdout,
  signals = process,
  clock = globalThis,
  game = new SnakeGame(),
  color = !Object.hasOwn(process.env, 'NO_COLOR'),
} = {}) {
  const wasRaw = Boolean(input.isRaw);
  const wasFlowing = input.readableFlowing === true;
  let review = new MoveReview(game);
  let hintEnabled = false;
  let lastColumns;
  let lastRows;
  let timer = null;
  let enteredScreen = false;
  let closed = false;
  const onTick = sessionHandler(tick);
  const onResize = sessionHandler(() => redraw(true));
  const onKey = sessionHandler(handleKey);

  function sessionHandler(handler) {
    return (...args) => {
      if (closed) return;
      try {
        handler(...args);
      } catch (error) {
        stop();
        throw error;
      }
    };
  }

  function cancelTick() {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  }

  function redraw(clear = false) {
    const tooSmall = !fits(game, output);
    if (tooSmall && game.status === 'running') game.togglePause();
    const sizeChanged = output.columns !== lastColumns || output.rows !== lastRows;
    lastColumns = output.columns;
    lastRows = output.rows;
    const showHint = hintEnabled && !review.current && canHint();
    drawScreen(game, output, color, clear || sizeChanged || tooSmall, review.current, showHint);
    if (closed || game.status !== 'running' || game.mode === 'practice') cancelTick();
    else if (timer === null) timer = clock.setTimeout(onTick, game.tickMs);
  }

  function advance() {
    game.tick();
    review.record(game);
    redraw();
  }

  function tick() {
    timer = null;
    if (fits(game, output)) advance();
    else redraw(true);
  }

  function outputDisconnected() {
    enteredScreen = false;
    stop();
  }

  function stop() {
    if (closed) return;
    closed = true;
    cancelTick();
    input.off('keypress', onKey);
    input.off('end', stop);
    input.off('close', stop);
    input.off('error', stop);
    output.off('resize', onResize);
    output.off('close', outputDisconnected);
    output.off('error', outputDisconnected);
    for (const event of EXIT_EVENTS) signals.off(event, stop);
    // Stop the pending console read before changing keyboard mode on Windows.
    input.pause();
    try {
      if (Boolean(input.isRaw) !== wasRaw) input.setRawMode(wasRaw);
    } finally {
      try {
        if (enteredScreen) output.write('\x1b[0m\x1b[?1049l\x1b[?25h');
      } finally {
        if (wasFlowing) input.resume();
      }
    }
  }

  function newRound(key) {
    if (key === 'r') game.restart();
    else if (key === 'm') game.cycleArena();
    else if (key === 'g') game.cycleMode();
    else return;
    if (game.status === 'ready') {
      review = new MoveReview(game);
      hintEnabled = false;
      redraw(true);
    }
  }

  function canHint() {
    return game.mode === 'practice' && !game.finished;
  }

  function steer(direction) {
    const previous = game.status;
    if (!game.turn(direction)) return;
    if (game.mode === 'practice') advance();
    else if (game.status !== previous) redraw();
  }

  function command(name) {
    const previous = game.status;
    switch (name) {
      case 'u':
        if (review.undo(game)) redraw();
        return;
      case 'h':
        if (canHint()) {
          hintEnabled = !hintEnabled;
          redraw();
        }
        return;
      case 'v':
        if (previous === 'paused' || game.finished) {
          review.open();
          redraw(true);
        }
        return;
      case 'space': case 'p':
        if (name === 'p' && previous === 'ready') return;
        game.togglePause();
        if (game.status !== previous) redraw();
        return;
      default:
        newRound(name);
    }
  }

  function handleKey(_text, key = {}) {
    const name = key.name;
    if (key.ctrl || key.meta) {
      if (key.ctrl && (name === 'c' || name === 'd')) stop();
    } else if (name === 'q') {
      stop();
    } else if (!fits(game, output)) {
      redraw(true);
    } else if (review.current) {
      if (review.navigate(name)) redraw(name === 'v');
    } else if (Object.hasOwn(MOVE_KEYS, name)) {
      steer(MOVE_KEYS[name]);
    } else {
      command(name);
    }
  }

  try {
    for (const event of EXIT_EVENTS) signals.once(event, stop);
    input.once('end', stop);
    input.once('close', stop);
    input.once('error', stop);
    output.on('resize', onResize);
    output.once('close', outputDisconnected);
    output.once('error', outputDisconnected);
    emitKeypressEvents(input);
    input.on('keypress', onKey);
    input.setRawMode(true);
    enteredScreen = true;
    output.write('\x1b[?1049h\x1b[?25l');
    // Either opening write can report a disconnect before it returns.
    if (!closed) redraw(true);
    if (!closed) input.resume();
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}

module.exports = { runSession };
