'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const { SnakeGame } = require('../game');
const { main, runSession } = require('../snake');
const { terminal, session, frameRows } = require('../test-support/terminal');

test('the opening screen centers a readable board, score and controls', t => {
  const h = session(t);
  assert.equal(h.input.isRaw, true);
  assert.equal(h.clock.timers.size, 0);
  assert.match(h.writes[0], /\x1b\[\?1049h\x1b\[\?25l/);
  assert.match(h.frame(), /^\x1b\[2J\x1b\[3;12H/);
  const rows = frameRows(h.frame());
  assert.equal(rows.length, 19);
  for (const line of rows) assert.equal(line.length, 58);
  assert.match(rows[0], /^SNAKE +Score 0   Best 0$/);
  assert.equal(rows[1], '+' + '-'.repeat(56) + '+');
  assert.equal(rows[16], rows[1]);
  assert.equal(rows[2][1], '*');
  assert.equal(rows[2 + 7].slice(1 + 12 * 2, 1 + 15 * 2), 'o o @ ');
  assert.match(rows[17], /Ready.*@.*\*/);
  assert.match(rows[18], /Arrows\/WASD.*Space start.*Q quit/);
});

test('color and plain rendering use the same glyphs and occupy identical columns', t => {
  const plain = session(t);
  const color = session(t, { color: true });
  assert.doesNotMatch(plain.frame(), /\x1b\[[\d;]+m/);
  assert.match(color.frame(), /\x1b\[1;36m@\x1b\[0m/);
  assert.match(color.frame(), /\x1b\[1;33m\*\x1b\[0m/);
  assert.deepEqual(frameRows(color.frame()), frameRows(plain.frame()));
});

test('arrow escape sequences and WASD steer through real keypress decoding', t => {
  const h = session(t);
  h.press('\x1b['); // A terminal may split a single arrow sequence across reads.
  h.press('A');
  const moves = [
    [null, 14, 6], ['a', 13, 6], ['\x1b[B', 13, 7], ['D', 14, 7],
    ['W', 14, 6], ['\x1b[D', 13, 6], ['s', 13, 7], ['\x1b[C', 14, 7],
  ];
  for (const [key, x, y] of moves) {
    if (key !== null) h.press(key);
    h.clock.tick();
    assert.deepEqual(h.game.snake[0], { x, y });
    assert.equal(h.game.status, 'running');
  }
});

test('batched turns and typematic repeats leave the current tick deadline intact', t => {
  const h = session(t);
  h.press(' ');
  const firstTick = h.clock.next();
  h.press('wwwadd');
  assert.strictEqual(h.clock.next(), firstTick);
  assert.deepEqual(h.game.snake[0], { x: 14, y: 7 });
  h.clock.tick();
  assert.deepEqual(h.game.snake[0], { x: 14, y: 6 });
  h.clock.tick();
  assert.deepEqual(h.game.snake[0], { x: 13, y: 6 });
});

test('Space and P pause and resume while unrelated or modified keys do nothing', t => {
  const h = session(t);
  h.press('pax\r\x17'); // P, reverse, unknown, Enter and Ctrl+W while ready.
  assert.equal(h.game.status, 'ready');
  h.press(' ');
  h.press('P');
  assert.equal(h.game.status, 'paused');
  assert.equal(h.clock.timers.size, 0);
  assert.match(h.frame(), /Paused.*Kowloon Tong/);
  h.press('wx');
  h.press(' ');
  h.clock.tick();
  assert.deepEqual(h.game.snake[0], { x: 15, y: 7 });
  h.press(' ');
  assert.equal(h.clock.timers.size, 0);
  h.press('p');
  assert.equal(h.clock.next().delay, 200);
});

test('each bite updates the visible score and next tick, and replay retains the best', t => {
  const game = new SnakeGame({ width: 6, height: 1, random: () => 0.5 });
  const h = session(t, { game });
  h.press('d');
  assert.equal(h.clock.next().delay, 200);
  h.clock.tick();
  assert.equal(h.clock.next().delay, 195);
  assert.match(h.frame(), /Score 1   Best 1/);
  h.clock.tick();
  assert.equal(h.clock.next().delay, 190);
  h.clock.tick();
  assert.equal(h.clock.timers.size, 0);
  assert.match(h.frame(), /Game over.*wall/);
  assert.match(h.frame(), /R play again/);
  h.press(' wp');
  assert.equal(h.game.status, 'lost');
  h.press('R');
  assert.equal(h.game.status, 'ready');
  assert.match(h.frame(), /Score 0   Best 2/);
  h.press(' ');
  assert.equal(h.clock.next().delay, 200);
});

test('steering back into the body shows the collision and stops further movement', t => {
  // This draw puts the first two snacks just ahead of the starting head.
  const game = new SnakeGame({ width: 6, height: 4, random: () => 0.65 });
  const h = session(t, { game });
  h.press('d');
  h.clock.tick();
  h.clock.tick();
  assert.equal(game.score, 2);
  h.press('wa');
  h.clock.tick();
  h.clock.tick();
  const lastBoard = structuredClone(game.snake);
  h.press('s');
  h.clock.tick();
  assert.match(h.frame(), /Game over\. You hit your snake\./);
  assert.match(h.frame(), /Score 2   Best 2/);
  assert.deepEqual(game.snake, lastBoard);
  h.press(' w');
  assert.equal(h.clock.timers.size, 0);
});

test('restarting mid-round cancels the pending tick and discards buffered steering', t => {
  const h = session(t);
  h.press('wa');
  h.clock.tick(); // Up has been applied and left is still buffered.
  assert.deepEqual(h.game.snake[0], { x: 14, y: 6 });
  const previousTick = h.clock.next();
  h.press('r');
  assert.match(h.frame(), /Ready/);
  assert.equal(h.clock.timers.size, 0);
  assert.deepEqual(h.game.snake[0], { x: 14, y: 7 });
  h.press(' ');
  assert.notStrictEqual(h.clock.next(), previousTick);
  h.clock.tick();
  assert.deepEqual(h.game.snake[0], { x: 15, y: 7 });
});

test('filling the last square shows a win and stops the clock until a new round', t => {
  const game = new SnakeGame({ width: 4, height: 1 });
  const h = session(t, { game });
  h.press(' ');
  h.clock.tick();
  assert.match(h.frame(), /Board cleared!/);
  assert.match(h.frame(), /R play again/);
  assert.equal(h.clock.timers.size, 0);
  h.press('r');
  assert.match(h.frame(), /Ready/);
  assert.equal(h.clock.timers.size, 0);
});

test('an undersized window shows a clipped resize hint and accepts quit', t => {
  const h = session(t, { columns: 17, rows: 1 });
  assert.deepEqual(frameRows(h.frame()), ['Resize to 58x19 t']);
  h.press(' wpr');
  assert.equal(h.game.status, 'ready');
  assert.equal(h.clock.timers.size, 0);
  h.press('q');
  assert.equal(h.input.isRaw, false);
});

test('shrinking a running board pauses, and restoring its size waits for resume', t => {
  const h = session(t);
  h.press('w');
  h.clock.tick();
  const before = structuredClone(h.game.snake);
  h.resize(80, 18); // Wide enough but too short.
  assert.equal(h.game.status, 'paused');
  assert.match(h.frame(), /Resize to 58x19/);
  assert.equal(h.clock.timers.size, 0);
  h.press(' p');
  h.resize(57, 24); // Tall enough but too narrow.
  assert.match(h.frame(), /Resize to 58x19/);
  h.resize(58, 19); // Exact fit.
  assert.match(h.frame(), /^\x1b\[2J\x1b\[1;1H/);
  assert.match(h.frame(), /Paused/);
  assert.deepEqual(h.game.snake, before);
  assert.equal(h.clock.timers.size, 0);
  h.press(' ');
  const timer = h.clock.next();
  h.resize(100, 30);
  assert.strictEqual(h.clock.next(), timer);
  h.clock.tick();
  assert.deepEqual(h.game.snake[0], { x: 14, y: 5 });
});

test('a tick detects a too-small screen even before a resize event arrives', t => {
  const h = session(t);
  h.press(' ');
  h.output.columns = 40;
  h.clock.tick();
  assert.equal(h.game.status, 'paused');
  assert.deepEqual(h.game.snake[0], { x: 14, y: 7 });
  assert.equal(h.clock.timers.size, 0);
});

test('a key received before the resize event pauses a newly undersized board', t => {
  const h = session(t);
  h.press('d');
  h.output.columns = 40;
  h.press('w');
  assert.equal(h.game.status, 'paused');
  assert.equal(h.clock.timers.size, 0);
  assert.match(h.frame(), /Resize to 58x19/);
  h.resize(58, 19);
  h.press(' ');
  h.clock.tick();
  assert.deepEqual(h.game.snake[0], { x: 15, y: 7 });
});

const exits = [
  ['Q', h => h.press('Q')],
  ['Ctrl+C', h => h.press('\x03')],
  ['Ctrl+D', h => h.press('\x04')],
  ['end of input', async h => {
    const end = once(h.input, 'end');
    h.input.end();
    await end;
  }],
  ['a closed input stream', h => h.input.emit('close')],
  ['an input stream error', h => h.input.emit('error', new Error('keyboard disconnected'))],
  ...['SIGINT', 'SIGTERM', 'exit'].map(event => [event, h => h.signals.emit(event)]),
];
for (const [name, leave] of exits) {
  test(`${name} cancels movement and restores the terminal exactly once`, async t => {
    const h = session(t);
    h.press(' ');
    await leave(h);
    assert.equal(h.clock.timers.size, 0);
    assert.equal(h.input.readableFlowing, false);
    assert.deepEqual(h.modes.at(-1), { enabled: false, flowing: false });
    assert.equal(h.input.listenerCount('keypress'), 0);
    assert.equal(h.output.listenerCount('resize'), 0);
    assert.deepEqual(h.signals.eventNames(), []);
    assert.match(h.frame(), /\x1b\[\?1049l\x1b\[\?25h$/);
    const count = h.writes.length;
    h.stop();
    h.resize(100, 30);
    assert.equal(h.writes.length, count);
  });
}

test('a session restores pre-existing raw mode and input flow', t => {
  const h = session(t, { alreadyRaw: true, alreadyFlowing: true });
  h.press('q');
  assert.equal(h.input.isRaw, true);
  assert.equal(h.input.readableFlowing, true);
});

for (const event of ['close', 'error']) {
  test(`an output ${event} releases the keyboard and clock without writing to the disconnected terminal`, t => {
    const h = session(t);
    h.press('d');
    h.output.write = () => assert.fail('write after disconnect');
    h.output.emit(event, new Error('terminal disconnected'));
    assert.equal(h.input.isRaw, false);
    assert.equal(h.clock.timers.size, 0);
    assert.equal(h.input.listenerCount('keypress'), 0);
    assert.deepEqual(h.output.eventNames(), []);
    assert.deepEqual(h.signals.eventNames(), []);
  });
}

test('resuming before the resize notification clears the old resize notice', t => {
  const h = session(t);
  h.press('d');
  h.output.columns = 20;
  h.clock.tick();
  assert.match(h.frame(), /Resize to/);
  h.output.columns = 80;
  h.press(' ');
  assert.equal(h.game.status, 'running');
  assert.ok(h.frame().startsWith('\x1b[2J'));
  h.clock.tick();
  assert.ok(!h.frame().startsWith('\x1b[2J'));
});

test('a disconnect during a moving frame cannot start another tick', t => {
  const h = session(t);
  h.press('d');
  h.output.write = () => { h.output.emit('close'); return false; };
  h.clock.tick();
  assert.equal(h.clock.timers.size, 0);
  assert.equal(h.input.isRaw, false);
  assert.equal(h.input.readableFlowing, false);
});

test('a disconnect during either opening write leaves the keyboard released', () => {
  for (const marker of ['?1049h', '\x1b[2J']) {
    const { input, output } = terminal();
    let disconnected = false;
    output.write = text => {
      assert.equal(disconnected, false, 'writes must stop after a disconnect');
      if (text.includes(marker)) {
        disconnected = true;
        output.emit('close');
      }
      return !disconnected;
    };
    try {
      runSession({ input, output, signals: new EventEmitter() });
      assert.equal(disconnected, true);
      assert.equal(input.isRaw, false);
      assert.equal(input.readableFlowing, false);
    } finally {
      input.destroy();
    }
  }
});

test('a failed opening draw restores keyboard mode, cursor and screen', () => {
  const { input, output, writes } = terminal();
  const signals = new EventEmitter();
  const write = output.write;
  output.write = text => {
    if (text.includes('\x1b[2J')) throw new Error('draw failed');
    return write(text);
  };
  try {
    assert.throws(() => runSession({ input, output, signals }), /draw failed/);
    assert.equal(input.isRaw, false);
    assert.match(writes.at(-1), /\x1b\[\?1049l\x1b\[\?25h$/);
    assert.deepEqual(signals.eventNames(), []);
  } finally {
    input.destroy();
  }
});

test('a failed draw during a move releases the keyboard and cancels the session', t => {
  const h = session(t);
  h.press('d');
  const write = h.output.write;
  h.output.write = text => {
    if (text.includes('Score')) throw new Error('draw failed');
    return write(text);
  };
  assert.throws(() => h.clock.tick(), /draw failed/);
  assert.equal(h.clock.timers.size, 0);
  assert.equal(h.input.isRaw, false);
  assert.deepEqual(h.signals.eventNames(), []);
  assert.match(h.frame(), /\x1b\[\?1049l\x1b\[\?25h$/);
});

test('both help flags work with redirected streams and leave the screen untouched', () => {
  for (const flag of ['-h', '--help']) {
    const { output, writes } = terminal();
    output.isTTY = false;
    assert.equal(main([flag], { stdin: {}, stdout: output }), 0);
    assert.match(writes.join(''), /node snake\.js/);
    assert.match(writes.join(''), /arrow keys or WASD/);
    assert.match(writes.join(''), /Junction.*other A/);
    assert.match(writes.join(''), /H toggles a dotted route/);
    assert.match(writes.join(''), /U takes back one Practice move/);
    assert.doesNotMatch(writes.join(''), /\x1b/);
  }
});

test('unsupported arguments report a usage error', () => {
  const { output, writes } = terminal();
  for (const args of [['--unknown'], ['--help', 'extra']]) {
    assert.equal(main(args, { stderr: output }), 2);
    assert.match(writes.at(-1), /node snake\.js --help/);
  }
});

test('interactive play requires both keyboard input and terminal output', () => {
  for (const [inputTTY, outputTTY] of [[false, false], [true, false], [false, true]]) {
    const { output: stderr, writes } = terminal();
    const io = { stdin: { isTTY: inputTTY }, stdout: { isTTY: outputTTY }, stderr };
    assert.equal(main([], io), 1);
    assert.match(writes[0], /interactive terminal/);
    assert.doesNotMatch(writes[0], /\x1b/);
  }
});

test('the normal CLI entry path opens a playable session and releases its keyboard', () => {
  const { input, output, writes } = terminal();
  try {
    assert.equal(main([], { stdin: input, stdout: output }), 0);
    input.write('w');
    assert.match(writes.at(-1), /Space pause/);
    input.write('q');
    assert.equal(input.isRaw, false);
    assert.match(writes.at(-1), /\x1b\[\?25h/);
  } finally {
    input.destroy();
  }
});
