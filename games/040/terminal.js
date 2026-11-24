'use strict';

const { performance } = require('node:perf_hooks');
const { emitKeypressEvents } = require('node:readline');
const {
  Game, MODES, SPRINT_LINES, DIG_LAYERS, SURGE_WAVES, LOCKS_PER_WAVE, UNDO_LIMIT, seededRandom,
} = require('./game');
const { FRAME_COLUMNS, FRAME_ROWS, renderFrame } = require('./screen');

const ACTIONS = {
  a: 'left', left: 'left', d: 'right', right: 'right',
  w: 'cw', x: 'cw', up: 'cw', z: 'ccw',
  s: 'soft', down: 'soft', space: 'hard', c: 'hold', p: 'pause', u: 'undo',
};

const HELP = `Kowloon Stack - a real-time falling-block game

Usage: node game.js [--mode NAME] [--seed NUMBER] [--no-color]

  --mode NAME     endless (default), ${MODES.slice(1).join(', ')}
  --seed NUMBER   Repeat this mode's deal and board (integer from 0 to 4294967295)
  --no-color      Use monochrome blocks
  -h, --help      Show this help

Sprint races to ${SPRINT_LINES} lines. In Dig, clear all ${DIG_LAYERS} stone rows marked ==.
In Surge, survive ${SURGE_WAVES} waves of stone. A wave rises after every ${LOCKS_PER_WAVE} locks.
Each row you clear cancels one incoming row. ^^ marks the next opening.
Practice waits for Space to lock. U rewinds one turn, up to ${UNDO_LIMIT} turns back.
Move with A/D or Left/Right. Turn with W/X/Up (clockwise) or Z (counterclockwise).
S/Down soft drops, Space hard drops, and C holds a piece.
P pauses for round stats. Press it again to resume.
Press R after a win or game over to play again. Q or Ctrl+C quits.
`;

function viewport(output) {
  const columns = output.columns ?? 80;
  const rows = output.rows ?? 24;
  return { columns, rows, fits: columns >= FRAME_COLUMNS && rows >= FRAME_ROWS };
}

function startSession({
  input = process.stdin, output = process.stdout, signals = process,
  createGame = () => new Game(), color = true,
  now = () => performance.now(), timers = globalThis,
} = {}) {
  let game = createGame();
  let view = viewport(output);
  let previous = now();
  let timer;
  let stopped = false;
  let enteredScreen = false;
  const originalRaw = Boolean(input.isRaw);
  const wasFlowing = input.readableFlowing === true;

  function draw(clear = false) {
    let top = 1;
    let left = 1;
    let lines;
    if (view.fits) {
      top += Math.floor((view.rows - FRAME_ROWS) / 2);
      left += Math.floor((view.columns - FRAME_COLUMNS) / 2);
      lines = renderFrame(game, color).split('\n');
    } else {
      lines = [`Resize to ${FRAME_COLUMNS}x${FRAME_ROWS} to play`, 'Q to quit']
        .slice(0, view.rows).map(line => line.slice(0, view.columns));
    }
    const frame = lines.map((line, i) => `\x1b[${top + i};${left}H\x1b[K${line}`).join('');
    try {
      output.write((clear ? '\x1b[2J' : '') + frame);
    } catch (error) {
      stop();
      throw error;
    }
  }

  // Settle time before handling input or a resize, even between two display ticks.
  function advanceClock() {
    const at = now();
    const elapsed = at - previous;
    previous = at;
    return view.fits && game.advance(elapsed);
  }

  function tick() {
    if (advanceClock()) draw();
  }

  function resize() {
    advanceClock();
    view = viewport(output);
    draw(true);
  }

  function keypress(_text, key) {
    if (!key) return;
    if ((key.ctrl && key.name === 'c') || (!key.ctrl && !key.meta && key.name === 'q')) {
      stop();
      return;
    }
    if (key.ctrl || key.meta || !view.fits) return;
    const changed = advanceClock();
    if (game.finished && key.name === 'r') {
      game = createGame();
      draw();
    } else if (game.act(ACTIONS[key.name]) || changed) {
      draw();
    }
  }

  function outputClosed() {
    enteredScreen = false;
    stop();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    timers.clearInterval(timer);
    input.off('keypress', keypress);
    input.off('end', stop);
    input.off('close', stop);
    input.off('error', stop);
    output.off('resize', resize);
    output.off('close', outputClosed);
    output.off('error', outputClosed);
    signals.off('SIGINT', stop);
    signals.off('SIGTERM', stop);
    signals.off('exit', stop);
    try {
      // Cancel our read while the terminal is still raw. On Windows, doing
      // this after switching back to cooked mode can interrupt the parent shell.
      if (!wasFlowing) input.pause();
      if (!input.destroyed && Boolean(input.isRaw) !== originalRaw) input.setRawMode(originalRaw);
    } finally {
      if (enteredScreen && !output.destroyed) output.write('\x1b[0m\x1b[?25h\x1b[?1049l');
    }
  }

  try {
    input.setRawMode(true);
    emitKeypressEvents(input);
    input.on('keypress', keypress);
    input.once('end', stop);
    input.once('close', stop);
    input.once('error', stop);
    output.on('resize', resize);
    output.once('close', outputClosed);
    output.once('error', outputClosed);
    signals.once('SIGINT', stop);
    signals.once('SIGTERM', stop);
    signals.once('exit', stop);
    input.resume();
    enteredScreen = true;
    output.write('\x1b[?1049h\x1b[?25l');
    if (!stopped) draw(true);
    if (!stopped) timer = timers.setInterval(tick, 32);
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}

function main(args = process.argv.slice(2), io = process) {
  if (args.includes('-h') || args.includes('--help')) {
    io.stdout.write(HELP);
    return 0;
  }

  let seed;
  let mode = 'endless';
  let color = !io.env.NO_COLOR && io.env.TERM !== 'dumb';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--no-color') {
      color = false;
    } else if (args[i] === '--mode') {
      mode = args[++i];
      if (!MODES.includes(mode)) {
        io.stderr.write(`--mode needs one of ${MODES.join(', ')}.\n`);
        return 2;
      }
    } else if (args[i] === '--seed') {
      const value = args[++i];
      if (!/^\d+$/.test(value) || Number(value) > 0xffffffff) {
        io.stderr.write('--seed needs an integer from 0 to 4294967295.\n');
        return 2;
      }
      seed = Number(value);
    } else {
      io.stderr.write(`Unknown option: ${args[i]}. Run node game.js --help for usage.\n`);
      return 2;
    }
  }

  if (!io.stdin.isTTY || !io.stdout.isTTY || typeof io.stdin.setRawMode !== 'function') {
    io.stderr.write('Kowloon Stack needs an interactive terminal. Run node game.js at a terminal prompt.\n');
    return 1;
  }
  startSession({
    input: io.stdin, output: io.stdout, signals: io,
    color,
    createGame: () => new Game(seed === undefined ? Math.random : seededRandom(seed), mode),
  });
  return 0;
}

module.exports = { main, startSession };
