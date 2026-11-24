'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { Game, WIDTH, HEIGHT, STONE, MODES, UNDO_LIMIT, cellsOf, seededRandom } = require('../game');
const { FRAME_COLUMNS, FRAME_ROWS, renderFrame } = require('../screen');
const { main, startSession } = require('../terminal');

function fakeTerminal({ columns = 80, rows = 24, raw = false } = {}) {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.isRaw = raw;
  stdin.setRawMode = value => { stdin.isRaw = value; };
  function sink() {
    return Object.assign(new EventEmitter(), {
      chunks: [],
      write(chunk) { this.chunks.push(chunk); return true; },
    });
  }
  const stdout = Object.assign(sink(), { columns, rows, isTTY: true });
  return Object.assign(new EventEmitter(), { stdin, stdout, stderr: sink(), env: {} });
}

// Exercise readline's real byte decoder. Only the terminal and clock are simulated.
function session(t, { mode = 'endless', ...options } = {}) {
  const io = fakeTerminal(options);
  let time = 0;
  let scheduled;
  let game;
  const stop = startSession({
    input: io.stdin, output: io.stdout, signals: io, color: false,
    createGame() { game = new Game(seededRandom(852), mode); return game; },
    now: () => time,
    timers: {
      setInterval(fn) { scheduled = fn; return 1; },
      clearInterval() { scheduled = undefined; },
    },
  });
  t.after(stop);
  return {
    io, stop,
    get game() { return game; },
    get frame() { return io.stdout.chunks.at(-1); },
    get running() { return Boolean(scheduled); },
    press(bytes) { io.stdin.write(bytes); },
    elapse(ms) { time += ms; },
    tick() { scheduled(); },
    resize(columns, rows) {
      Object.assign(io.stdout, { columns, rows });
      io.stdout.emit('resize');
    },
  };
}

function glyph(frame, x, y) {
  return frame.split('\n')[y + 1].slice(1 + 2 * x, 3 + 2 * x);
}

test('the monochrome frame fits the minimum terminal and distinguishes pile, piece, and ghost', () => {
  const game = new Game(seededRandom(852));
  game.active = { kind: 'T', x: 3, y: 5, rotation: 0 };
  game.board[18][4] = 'L';
  const before = structuredClone({ ...game });
  const frame = renderFrame(game);
  const rows = frame.split('\n');
  assert.equal(rows.length, FRAME_ROWS);
  assert.ok(rows.every(row => row.length <= FRAME_COLUMNS));
  assert.ok(rows.slice(1, -1).every(row => row[0] === '|' && row[WIDTH * 2 + 1] === '|'));
  assert.match(rows[0], /^\+-{20}\+ +KOWLOON STACK$/);
  assert.match(rows.at(-1), /^\+-{20}\+/);
  assert.match(frame, /Score  0/);
  assert.match(frame, /Lines  0 +Level  1/);
  assert.doesNotMatch(frame, /\x1b/);
  for (const [x, y] of cellsOf(game.active)) assert.equal(glyph(frame, x, y), '[]');
  for (const [x, y] of cellsOf({ ...game.active, y: 16 })) assert.equal(glyph(frame, x, y), '..');
  assert.equal(glyph(frame, 4, 18), '##');
  assert.equal(glyph(frame, 0, 0), '  ');
  assert.deepEqual({ ...game }, before);
});

test('active blocks win over overlapping ghost cells, and pieces above the ceiling are clipped', () => {
  const game = new Game(seededRandom(852));
  game.active = { kind: 'O', x: 3, y: 17, rotation: 0 };
  let frame = renderFrame(game);
  for (const y of [17, 18]) assert.equal(glyph(frame, 4, y), '[]');
  assert.equal(glyph(frame, 4, 19), '..');
  game.active = { kind: 'T', x: 3, y: -1, rotation: 0 };
  frame = renderFrame(game);
  for (const x of [3, 4, 5]) assert.equal(glyph(frame, x, 0), '[]');
  assert.equal(frame.split('\n').length, HEIGHT + 2);
});

test('next and hold previews show the actual shapes and indicate a used hold', () => {
  const game = new Game(seededRandom(12));
  const emptyHold = renderFrame(game).split('\n')[6].slice(37);
  assert.equal(emptyHold.trim(), '--');
  game.next = 'T';
  game.held = 'I';
  game.canHold = false;
  const rows = renderFrame(game).split('\n').map(row => row.padEnd(FRAME_COLUMNS));
  assert.match(rows[5], /NEXT +HOLD \(used\)/);
  assert.deepEqual(rows.slice(6, 8).map(row => row.slice(25, 33)), ['  []    ', '[][][]  ']);
  assert.deepEqual(rows.slice(6, 8).map(row => row.slice(37, 45)), ['        ', '[][][][]']);
});

test('the second and third previews show the queued shapes and stone has its own glyph', () => {
  const game = new Game(seededRandom(852), 'dig');
  game.following = ['L', 'O'];
  const frame = renderFrame(game);
  const rows = frame.split('\n').map(row => row.padEnd(FRAME_COLUMNS));
  assert.match(rows[8], /2ND +3RD/);
  assert.deepEqual(rows.slice(9, 11).map(row => row.slice(25, 33)), ['    []  ', '[][][]  ']);
  assert.deepEqual(rows.slice(9, 11).map(row => row.slice(37, 45)), ['  [][]  ', '  [][]  ']);
  for (const [y, row] of game.board.entries()) {
    for (const [x, cell] of row.entries()) {
      if (cell === STONE) assert.equal(glyph(frame, x, y), '==');
    }
  }
  assert.match(frame, /Dig  0\/8 +0:00\.0/);
  assert.match(frame, /== stone/);
  assert.equal(renderFrame(game, true).replace(/\x1b\[[;\d]+m/g, ''), frame);
  assert.ok(rows.every(row => row.length === FRAME_COLUMNS));
});

test('winning Sprint shows the capped goal, final time and clear bonuses in the minimum frame', () => {
  const game = new Game(seededRandom(852), 'sprint');
  game.lines = 34;
  game.elapsedMs = 62399;
  for (const row of game.board.slice(-8)) {
    row.fill('Z');
    row[5] = null;
  }
  for (let i = 0; i < 2; i++) {
    game.active = { kind: 'I', x: 3, y: HEIGHT - 4, rotation: 1 };
    game.act('hard');
  }
  const frame = renderFrame(game);
  assert.match(frame, /Sprint  40\/40 +1:02\.3/);
  assert.match(frame, /Lines  42 +Level  5/);
  assert.match(frame, /4 rows  \+5000/);
  assert.match(frame, /Combo 2 +Back-to-back/);
  assert.match(frame, /SPRINT COMPLETE/);
  assert.match(frame, /R to play again/);
  assert.equal(renderFrame(game, true).replace(/\x1b\[[;\d]+m/g, ''), frame);
  assert.ok(frame.split('\n').every(row => row.length <= FRAME_COLUMNS));
});

test('large line and level totals remain readable without wrapping the well', () => {
  const game = new Game();
  game.lines = 99999;
  const rows = renderFrame(game).split('\n');
  assert.ok(rows.every(row => row.length <= FRAME_COLUMNS));
  assert.match(rows[3], /Lines  99999$/);
  assert.match(rows[4], /Level  10000$/);
});

test('color preserves the plain layout and pause and game over show their respective controls', () => {
  const game = new Game(seededRandom(77));
  for (const status of ['playing', 'paused', 'over']) {
    game.status = status;
    if (status === 'over') game.active = null;
    const plain = renderFrame(game);
    const color = renderFrame(game, true);
    assert.match(color, /\x1b\[[;\d]+m/);
    assert.equal(color.replace(/\x1b\[[;\d]+m/g, ''), plain);
    if (status === 'paused') {
      assert.match(plain, /PAUSED/);
      assert.match(plain, /P to resume/);
    } else if (status === 'over') {
      assert.match(plain, /GAME OVER/);
      assert.match(plain, /R to play again/);
    }
  }
});

test('raw arrow sequences, letter aliases, and space operate the game without Enter', t => {
  const live = session(t);
  const expected = new Game(seededRandom(852));
  for (const [bytes, action] of [
    ['A', 'left'], ['d', 'right'], ['\x1b[D', 'left'], ['\x1b[C', 'right'],
    ['w', 'cw'], ['X', 'cw'], ['\x1b[A', 'cw'], ['z', 'ccw'],
    ['s', 'soft'], ['\x1b[B', 'soft'], ['c', 'hold'], [' ', 'hard'],
    ['P', 'pause'], [' ', 'hard'], ['p', 'pause'],
  ]) {
    live.press(bytes);
    expected.act(action);
    assert.deepEqual({ ...live.game }, { ...expected }, JSON.stringify(bytes));
  }
  const before = structuredClone({ ...live.game });
  for (const key of ['?', 'r', '\x10', '\x1bd']) live.press(key);
  assert.deepEqual({ ...live.game }, before);
});

test('a split arrow sequence is decoded as one move', t => {
  const live = session(t);
  const x = live.game.active.x;
  live.press('\x1b[');
  live.press('D');
  assert.equal(live.game.active.x, x - 1);
});

test('the session advances during idle ticks and accounts for time before pause and resume', t => {
  const live = session(t);
  const frames = live.io.stdout.chunks.length;
  live.elapse(799);
  live.tick();
  assert.equal(live.io.stdout.chunks.length, frames);
  live.elapse(1);
  live.tick();
  assert.equal(live.game.active.y, 1);
  assert.ok(live.io.stdout.chunks.length > frames);
  live.elapse(799);
  live.press('p');
  assert.match(live.frame, /PAUSED/);
  live.elapse(60000);
  live.press('p');
  assert.equal(live.game.active.y, 1);
  live.elapse(1);
  live.tick();
  assert.equal(live.game.active.y, 2);
});

test('when a key arrives exactly at lock time it acts on the newly spawned piece', t => {
  const live = session(t);
  live.game.active = { kind: 'O', x: 3, y: 18, rotation: 0 };
  const preview = live.game.next;
  live.elapse(500);
  live.press('a');
  assert.equal(live.game.active.kind, preview);
  assert.equal(live.game.active.x, 2);
  assert.equal(live.game.board[19][4], 'O');
  assert.equal(live.game.board[19][5], 'O');
});

test('shrinking suspends inputs and gravity, and enlarging resumes from the same fraction of a tick', t => {
  const live = session(t);
  live.elapse(350);
  live.resize(FRAME_COLUMNS - 1, FRAME_ROWS);
  assert.match(live.frame, /Resize to 52x22/);
  live.elapse(8000);
  live.tick();
  live.press(' ');
  live.press('p');
  assert.equal(live.game.status, 'playing');
  assert.equal(live.game.active.y, 0);
  assert.equal(live.game.score, 0);
  live.elapse(18000);
  live.resize(FRAME_COLUMNS, FRAME_ROWS);
  assert.match(live.frame, /\x1b\[1;1H/);
  assert.match(live.frame, /KOWLOON STACK/);
  live.elapse(449);
  live.tick();
  assert.equal(live.game.active.y, 0);
  live.elapse(1);
  live.tick();
  assert.equal(live.game.active.y, 1);
  live.press('p');
  live.resize(FRAME_COLUMNS, FRAME_ROWS - 1);
  live.resize(FRAME_COLUMNS, FRAME_ROWS);
  assert.equal(live.game.status, 'paused');
});

test('the race clock updates in tenths and freezes for both pause and a too-small terminal', t => {
  const live = session(t, { mode: 'sprint' });
  const startFrames = live.io.stdout.chunks.length;
  live.elapse(99);
  live.tick();
  assert.equal(live.io.stdout.chunks.length, startFrames);
  live.elapse(1);
  live.tick();
  assert.match(live.frame, /0:00\.1/);
  live.elapse(175);
  live.press('p');
  live.elapse(10000);
  live.resize(26, 10);
  live.press('p');
  live.elapse(40000);
  live.resize(FRAME_COLUMNS, FRAME_ROWS);
  assert.equal(live.game.elapsedMs, 275);
  assert.match(live.frame, /PAUSED/);
  live.press('p');
  live.elapse(325);
  live.resize(26, 10);
  live.elapse(60000);
  live.tick();
  live.resize(FRAME_COLUMNS, FRAME_ROWS);
  assert.match(live.frame, /0:00\.6/);
  live.elapse(200);
  live.tick();
  assert.equal(live.game.elapsedMs, 800);
  assert.equal(live.game.active.y, 1);
});

test('a game started in a tiny terminal clips its resize message and still accepts quit', t => {
  const live = session(t, { columns: 7, rows: 1 });
  assert.equal(live.frame.replace(/\x1b\[[;\d]*[A-Za-z]/g, ''), 'Resize ');
  live.press('q');
  assert.equal(live.running, false);
});

test('a round played to game over can be restarted with fresh scores, hold, board, and bag', t => {
  const live = session(t);
  const fresh = structuredClone({ ...live.game });
  live.press('c');
  for (let i = 0; i < 50 && live.game.status === 'playing'; i++) live.press(' ');
  assert.equal(live.game.status, 'over');
  assert.match(live.frame, /GAME OVER/);
  assert.ok(live.game.score > 0);
  live.press('p');
  assert.equal(live.game.status, 'over');
  live.press('R');
  assert.deepEqual({ ...live.game }, fresh);
  assert.doesNotMatch(live.frame, /GAME OVER/);
});

test('a seeded Dig can be won and retried entirely through raw keyboard input', t => {
  const live = session(t, { mode: 'dig', columns: FRAME_COLUMNS, rows: FRAME_ROWS });
  const start = structuredClone({ ...live.game });
  // A complete seed-852 route. Each group positions one piece before Space locks it.
  const placements = [
    'cxd cddd xdddd a aaa xd xaaaaa xa xaaa ddd',
    'a zdd cxaaa zd dddd cza xaaaaa cdddd cdd aa',
    'dddd xa xd zaa xdddd xxd aaaa cxa czdddd cxxdd',
  ].join(' ').split(' ');
  for (const keys of placements) {
    live.elapse(50);
    live.press(keys + ' ');
  }
  assert.equal(live.game.status, 'won');
  assert.equal(live.game.layersLeft, 0);
  assert.equal(live.game.lines, 18);
  assert.equal(live.game.score, 4120);
  assert.match(live.frame, /Dig  8\/8 +0:01\.5/);
  assert.match(live.frame, /DIG COMPLETE/);
  assert.match(live.frame, /R to play again/);
  const win = live.frame;
  live.elapse(60000);
  live.tick();
  live.press(' cp');
  assert.equal(live.frame, win);
  live.press('R');
  assert.deepEqual({ ...live.game }, start);
  assert.match(live.frame, /Dig  0\/8 +0:00\.0/);
});

test('quit, Ctrl+C, signals, and input closure restore the terminal and release all session handles', t => {
  for (const event of ['Q', '\x03', 'SIGINT', 'SIGTERM', 'exit', 'end', 'close']) {
    const live = session(t);
    const { stdin, stdout } = live.io;
    assert.equal(stdin.isRaw, true);
    assert.match(stdout.chunks[0], /\x1b\[\?1049h\x1b\[\?25l/);
    if (event.length === 1) live.press(event);
    else if (event === 'end' || event === 'close') stdin.emit(event);
    else live.io.emit(event);
    assert.equal(live.running, false, event);
    assert.equal(stdin.isRaw, false);
    assert.equal(stdin.isPaused(), true);
    assert.equal(stdin.listenerCount('keypress'), 0);
    assert.equal(stdout.listenerCount('resize'), 0);
    for (const signal of ['SIGINT', 'SIGTERM', 'exit']) assert.equal(live.io.listenerCount(signal), 0);
    assert.match(live.frame, /\x1b\[\?25h\x1b\[\?1049l/);
    const count = stdout.chunks.length;
    live.stop();
    assert.equal(stdout.chunks.length, count);
  }
});

test('a terminal already in raw mode stays in raw mode on exit', t => {
  const live = session(t, { raw: true });
  live.press('q');
  assert.equal(live.io.stdin.isRaw, true);
});

test('quit stops the session-owned read before restoring cooked terminal input', t => {
  const io = fakeTerminal();
  const setRawMode = io.stdin.setRawMode;
  let pausedAtRestore;
  io.stdin.setRawMode = raw => {
    if (!raw) pausedAtRestore = io.stdin.isPaused();
    setRawMode(raw);
  };
  const stop = startSession({ input: io.stdin, output: io.stdout, signals: io });
  t.after(stop);
  io.stdin.write('q');
  assert.equal(pausedAtRestore, true);
  assert.equal(io.stdin.isRaw, false);
});

test('quitting leaves an already-flowing input stream available to its other listener', t => {
  const io = fakeTerminal();
  const received = [];
  io.stdin.on('data', chunk => received.push(chunk.toString()));
  const stop = startSession({ input: io.stdin, output: io.stdout, signals: io });
  t.after(stop);
  io.stdin.write('q');
  assert.equal(io.stdin.isRaw, false);
  assert.equal(io.stdin.readableFlowing, true);
  io.stdin.write('after the round');
  assert.deepEqual(received, ['q', 'after the round']);
});

test('startup errors release raw mode and restore the screen', () => {
  const io = fakeTerminal();
  const write = io.stdout.write.bind(io.stdout);
  io.stdout.write = chunk => {
    if (chunk.startsWith('\x1b[2J')) throw new Error('display unavailable');
    return write(chunk);
  };
  assert.throws(() => startSession({ input: io.stdin, output: io.stdout, signals: io }), /display unavailable/);
  assert.equal(io.stdin.isRaw, false);
  assert.equal(io.stdin.isPaused(), true);
  assert.match(io.stdout.chunks.at(-1), /\x1b\[\?1049l/);
});

test('CLI help works with redirected streams and leaves them in ordinary text mode', () => {
  for (const flag of ['--help', '-h']) {
    const io = fakeTerminal();
    io.stdin.isTTY = false;
    io.stdout.isTTY = false;
    assert.equal(main([flag], io), 0);
    assert.match(io.stdout.chunks.join(''), /Usage: node game\.js/);
    assert.match(io.stdout.chunks.join(''), /--mode NAME +endless \(default\), sprint, dig, surge, practice/);
    assert.match(io.stdout.chunks.join(''), /U rewinds one turn/);
    assert.doesNotMatch(io.stdout.chunks.join(''), /\x1b/);
    assert.equal(io.stderr.chunks.length, 0);
    assert.equal(io.stdin.isRaw, false);
  }
});

test('CLI mode selection reaches the seeded game and rejects missing or unknown modes before setup', t => {
  for (const mode of MODES) {
    const io = fakeTerminal();
    t.after(() => io.emit('SIGTERM'));
    assert.equal(main(['--seed', '852', '--mode', mode, '--no-color'], io), 0);
    const expected = renderFrame(new Game(seededRandom(852), mode));
    for (const line of expected.split('\n')) assert.ok(io.stdout.chunks.at(-1).includes('\x1b[K' + line));
    io.stdin.write('q');
    assert.equal(io.stdin.isRaw, false);
  }
  for (const args of [['--mode'], ['--mode', ''], ['--mode', 'unknown'], ['--mode', '--seed', '852']]) {
    const io = fakeTerminal();
    assert.equal(main(args, io), 2);
    assert.match(io.stderr.chunks.join(''), /--mode.*endless, sprint, dig/);
    assert.equal(io.stdout.chunks.length, 0);
    assert.equal(io.stdin.isRaw, false);
  }
});

test('invalid options and out-of-range, missing, or malformed seeds give a usage error', () => {
  for (const args of [
    ['--other'], ['--seed'], ['--seed', ''], ['--seed', '-1'], ['--seed', '1.2'],
    ['--seed', 'abc'], ['--seed', '4294967296'], ['--seed', '--no-color'],
  ]) {
    const io = fakeTerminal();
    assert.equal(main(args, io), 2);
    assert.match(io.stderr.chunks.join(''), /Unknown option|--seed needs an integer/);
    assert.equal(io.stdout.chunks.length, 0);
    assert.equal(io.stdin.isRaw, false);
  }
});

test('piped input, redirected output, and input without raw mode exit before screen setup', () => {
  for (const missing of ['input', 'output', 'rawMode']) {
    const io = fakeTerminal();
    if (missing === 'input') io.stdin.isTTY = false;
    if (missing === 'output') io.stdout.isTTY = false;
    if (missing === 'rawMode') delete io.stdin.setRawMode;
    assert.equal(main([], io), 1);
    assert.match(io.stderr.chunks.join(''), /interactive terminal/);
    assert.equal(io.stdout.chunks.length, 0);
  }
});

test('CLI accepts both seed limits, honors monochrome settings, and repeats a seeded round', t => {
  for (const [seed, extraArgs, env, color] of [
    [0, [], {}, true],
    [4294967295, ['--no-color'], {}, false],
    [852, [], { NO_COLOR: '1' }, false],
  ]) {
    const io = fakeTerminal();
    io.env = env;
    t.after(() => io.emit('SIGTERM'));
    assert.equal(main(['--seed', String(seed), ...extraArgs], io), 0);
    const frame = io.stdout.chunks.at(-1);
    const expected = renderFrame(new Game(seededRandom(seed)), color);
    for (const line of expected.split('\n')) assert.ok(frame.includes('\x1b[K' + line));
    assert.equal(/\x1b\[[;\d]*m/.test(frame), color);
    for (let i = 0; i < 50 && !io.stdout.chunks.at(-1).includes('GAME OVER'); i++) io.stdin.write(' ');
    assert.match(io.stdout.chunks.at(-1), /GAME OVER/);
    io.stdin.write('r');
    // Startup also clears the screen. The board itself is identical on restart.
    assert.equal(io.stdout.chunks.at(-1), frame.replace('\x1b[2J', ''));
    io.stdin.write('q');
    assert.equal(io.stdin.isRaw, false);
  }
});

test('the Surge forecast marks the displayed column and removes the marker when fully cancelled', () => {
  const game = new Game(() => 0.999, 'surge');
  let frame = renderFrame(game);
  assert.match(frame, /Surge  0\/6 +0:00\.0/);
  assert.match(frame.split('\n').at(-1), /^\+-{18}\^\^\+ +In 4 locks  \+1 row  gap 10$/);
  assert.ok(frame.split('\n').every(row => row.length <= FRAME_COLUMNS));
  assert.equal(renderFrame(game, true).replace(/\x1b\[[;\d]+m/g, ''), frame);
  game.active = { kind: 'I', x: 3, y: HEIGHT - 4, rotation: 1 };
  game.board[HEIGHT - 1].fill('Z');
  game.board[HEIGHT - 1][5] = null;
  game.act('hard');
  frame = renderFrame(game);
  assert.match(frame.split('\n').at(-1), /^\+-{20}\+ +Wave blocked +3 locks left$/);
});

test('a seed-852 Surge survives six waves through the keyboard, freezes its result and restarts', t => {
  const live = session(t, { mode: 'surge', columns: FRAME_COLUMNS, rows: FRAME_ROWS });
  const start = structuredClone({ ...live.game });
  const forecast = live.game.wave;
  const placements = [
    ['aaaa', 'a', 'ddd', 'zddddd'], ['aa', 'd', 'ddd', 'xxaa'],
    ['aaa', 'xaaaaa', 'x', 'xxddd'], ['xxd', 'ddd', 'za', 'aaaa'],
    ['d', 'xdddd', 'xdddd', 'a'], ['zddd', '', 'xxdd', 'xdddd'],
  ];
  for (const [index, wave] of placements.entries()) {
    for (const moves of wave) {
      live.elapse(100);
      live.press(moves + ' ');
      assert.ok(renderFrame(live.game).split('\n').every(line => line.length <= FRAME_COLUMNS));
    }
    assert.equal(live.game.wave.completed, index + 1);
    assert.equal(live.game.layersLeft, [0, 1, 2, 4, 4, 5][index]);
  }
  assert.equal(live.game.status, 'won');
  assert.equal(live.game.lines, 8);
  assert.equal(live.game.score, 1738);
  assert.match(live.frame, /SURGE COMPLETE/);
  assert.match(live.frame, /Surge  6\/6 +0:02\.4/);
  assert.match(live.frame, /Pieces locked  24/);
  const won = live.frame;
  live.elapse(60000);
  live.tick();
  live.press('u pc');
  assert.equal(live.frame, won);
  live.press('R');
  assert.deepEqual({ ...live.game }, start);
  assert.deepEqual(live.game.wave, forecast);
});

test('Practice can undo twenty turns across bags and replay every original preview and score', t => {
  const live = session(t, { mode: 'practice', columns: FRAME_COLUMNS, rows: FRAME_ROWS });
  const moves = [
    'dddd', 'aaa', '', 'xd', 'xaaaaa', 'ddd', 'aaa', 'aaa', 'xaa', 'x', 'xdddd', 'dd',
    'xxdd', 'xdddd', 'aa', 'aa', 'xa', 'ddd', 'xxaa', 'xd', 'dd', 'a', 'aa', 'xddd',
  ];
  const states = [structuredClone({ ...live.game })];
  for (const move of moves) {
    live.elapse(60000);
    live.press(move + ' ');
    states.push(structuredClone({ ...live.game }));
  }
  assert.equal(live.game.elapsedMs, 0);
  assert.equal(live.game.stats.pieces, moves.length);
  assert.equal(live.game.undosLeft, UNDO_LIMIT);
  assert.match(live.frame, /U undo +20 available/);
  const oldest = moves.length - UNDO_LIMIT;
  for (let i = moves.length - 1; i >= oldest; i--) {
    live.press('U');
    assert.deepEqual({ ...live.game }, states[i]);
  }
  live.press('u');
  assert.equal(live.game.undosLeft, 0);
  assert.deepEqual({ ...live.game }, states[oldest]);
  for (let i = oldest; i < moves.length; i++) {
    live.press(moves[i] + ' ');
    assert.deepEqual({ ...live.game }, states[i + 1]);
  }
});

test('Practice offers a recoverable top-out and R starts a fresh history', t => {
  const live = session(t, { mode: 'practice' });
  const initial = structuredClone({ ...live.game });
  let last;
  for (let i = 0; i < 50 && !live.game.finished; i++) {
    last = structuredClone({ ...live.game });
    live.press(' ');
  }
  assert.equal(live.game.status, 'over');
  assert.match(live.frame, /U to undo/);
  const over = structuredClone({ ...live.game });
  live.press('u');
  assert.deepEqual({ ...live.game }, last);
  live.press(' ');
  assert.deepEqual({ ...live.game }, over);
  live.press('r');
  assert.deepEqual({ ...live.game }, initial);
  assert.equal(live.game.undosLeft, 0);
});

test('the pause recap shows active time and clear counts, then gives the controls back', t => {
  const live = session(t);
  live.game.active = { kind: 'I', x: 3, y: HEIGHT - 4, rotation: 1 };
  for (const row of live.game.board.slice(-2)) {
    row.fill('T');
    row[5] = null;
  }
  live.elapse(299);
  live.press(' p');
  assert.match(live.frame, /PAUSED/);
  assert.match(live.frame, /ROUND STATS/);
  assert.match(live.frame, /Time played +0:00\.2/);
  assert.match(live.frame, /Pieces locked +1/);
  assert.match(live.frame, /Best combo +1/);
  assert.match(live.frame, /Doubles +1/);
  for (const label of ['Singles', 'Triples', 'Quads']) assert.match(live.frame, new RegExp(label + ' +0'));
  assert.doesNotMatch(live.frame, /CONTROLS/);
  const recap = live.frame;
  live.elapse(30000);
  live.tick();
  live.press(' u');
  assert.equal(live.frame, recap);
  live.press('p');
  assert.match(live.frame, /CONTROLS/);
  assert.doesNotMatch(live.frame, /ROUND STATS/);
  assert.equal(live.game.elapsedMs, 299);
});

test('input errors, output errors and output closure release raw mode and the frame timer', t => {
  for (const [stream, event] of [['stdin', 'error'], ['stdout', 'error'], ['stdout', 'close']]) {
    const live = session(t);
    const { stdin, stdout } = live.io;
    const frames = stdout.chunks.length;
    live.io[stream].emit(event, new Error('terminal disconnected'));
    assert.equal(live.running, false);
    assert.equal(stdin.isRaw, false);
    assert.equal(stdin.isPaused(), true);
    assert.equal(stdin.listenerCount('keypress'), 0);
    assert.equal(stdin.listenerCount('error'), 0);
    for (const name of ['resize', 'close', 'error']) assert.equal(stdout.listenerCount(name), 0);
    if (stream === 'stdout') assert.equal(stdout.chunks.length, frames);
    else assert.match(live.frame, /\x1b\[\?25h\x1b\[\?1049l/);
  }
});

test('a redraw failure during play releases the terminal before reporting the error', t => {
  const live = session(t);
  const { stdin, stdout } = live.io;
  const write = stdout.write.bind(stdout);
  stdout.write = chunk => {
    if (chunk.includes('\x1b[K')) throw new Error('redraw failed');
    return write(chunk);
  };
  live.elapse(800);
  assert.throws(() => live.tick(), /redraw failed/);
  assert.equal(stdin.isRaw, false);
  assert.equal(live.running, false);
  assert.match(live.frame, /\x1b\[\?25h\x1b\[\?1049l/);
});
