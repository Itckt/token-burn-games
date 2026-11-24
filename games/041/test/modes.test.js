'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SnakeGame } = require('../game');
const { REVIEW_MOVES } = require('../review');
const { main } = require('../snake');
const { terminal, session, frameRows } = require('../test-support/terminal');

test('practice takes one step per legal steering key and never starts a timer', t => {
  const h = session(t);
  h.press('gg');
  assert.match(h.frame(), /PRACTICE/);
  assert.match(h.frame(), /Arrows\/WASD step/);
  h.press('a');
  assert.equal(h.game.status, 'ready');
  h.press('d\x1b[Aa'); // Right, up, then left, with no clock ticks between them.
  assert.equal(h.game.moves, 3);
  assert.deepEqual(h.game.snake[0], { x: 14, y: 6 });
  h.press('dvgm'); // Reverse, review and reconfiguration are unavailable here.
  assert.equal(h.game.moves, 3);
  assert.equal(h.game.mode, 'practice');
  assert.equal(h.game.arena, 'classic');
  assert.equal(h.clock.timers.size, 0);
  h.press('pwa');
  assert.equal(h.game.status, 'paused');
  assert.equal(h.game.moves, 3);
  h.press('p');
  h.press('a');
  assert.equal(h.game.moves, 4);
  assert.equal(h.clock.timers.size, 0);
  h.press('r ');
  assert.equal(h.game.status, 'running');
  assert.equal(h.game.moves, 0);
  assert.equal(h.clock.timers.size, 0);
});

test('Delivery displays the remaining order and ends exactly when its move budget runs out', t => {
  const game = new SnakeGame({ width: 6, height: 3, arena: 'loop', mode: 'delivery', random: () => 0 });
  const h = session(t, { game });
  assert.match(h.frame(), /5 buns in 18 moves/);
  h.press('d');
  for (let i = 0; i < 17; i++) h.clock.tick();
  assert.match(h.frame(), /Buns 0\/5   1 move left/);
  h.resize(30, 8);
  h.resize(80, 24);
  assert.match(h.frame(), /Paused\. Buns 0\/5   1 move left/);
  assert.equal(h.clock.timers.size, 0);
  h.press(' ');
  h.clock.tick();
  assert.equal(h.clock.timers.size, 0);
  assert.match(h.frame(), /Out of moves\. Delivered 0 of 5 buns\./);
  h.press('v');
  assert.match(h.frame(), /REVIEW  Move 18\/18/);
  assert.match(h.frame(), /Out of moves/);
  h.press('vG');
  assert.equal(game.mode, 'practice');
  assert.equal(game.arena, 'loop');
  assert.equal(game.moves, 0);
});

test('the seeded lunch run in the README has a playable 51-move finish', t => {
  const game = new SnakeGame({ mode: 'delivery', arena: 'courtyard', seed: 852 });
  const h = session(t, { game });
  const routeToEachBun = ['dddddddddd', 'waaaaaas', 'aaaaawwwwaaw', 'dddddd', 'ddddddddsssssss'];
  for (const [index, route] of routeToEachBun.entries()) {
    for (const key of route) {
      h.press(key);
      h.clock.tick();
    }
    assert.equal(game.bites, index + 1);
  }
  assert.match(h.frame(), /Delivery complete! 5 buns in 51 moves\./);
  assert.equal(h.clock.timers.size, 0);
});

test('a collision on the delivery deadline shows the collision that ended the round', t => {
  const game = new SnakeGame({ width: 6, height: 2, arena: 'loop', mode: 'delivery', random: () => 0 });
  const h = session(t, { game });
  h.press('d');
  for (let i = 0; i < 14; i++) h.clock.tick();
  h.press('w');
  h.clock.tick();
  h.clock.tick(); // The second upward move wraps into the neck.
  assert.equal(game.moves, game.moveLimit);
  assert.match(h.frame(), /Game over\. You hit your snake/);
  assert.equal(h.clock.timers.size, 0);
});

test('review restores earlier boards, bun counts and chest timers without changing the live round', t => {
  let draws = 0;
  const game = new SnakeGame({
    width: 4, height: 2, arena: 'loop', mode: 'delivery',
    random: () => { draws++; return 1 - Number.EPSILON; },
  });
  const h = session(t, { game, color: true });
  const board = () => frameRows(h.frame()).slice(1, -2);
  const boards = [board()];
  for (const key of ['d', 'w', 'a', 'a']) {
    h.press(key);
    h.clock.tick();
    boards.push(board());
  }
  h.press('p');
  const paused = frameRows(h.frame());
  const pausedDraws = draws;
  h.press('v');
  assert.match(h.frame(), /REVIEW  Move 4\/4/);
  assert.match(h.frame(), /V return/);
  h.press('\x1b[D');
  assert.deepEqual(board(), boards[3]);
  assert.match(h.frame(), /Score 3   Best 4/);
  assert.match(h.frame(), /Buns 3\/5   9 moves left   C \+3 \(6 moves\)/);
  h.press(' rgmpw'); // Other game controls cannot edit a historical board.
  assert.match(h.frame(), /REVIEW  Move 3\/4/);
  h.press('\x1b[H');
  h.press('a');
  assert.match(h.frame(), /REVIEW  Move 0\/4/);
  assert.deepEqual(board(), boards[0]);
  h.press('d\x1b[C');
  assert.deepEqual(board(), boards[2]);
  h.resize(12, 1);
  h.press('d');
  h.resize(58, 19);
  assert.match(h.frame(), /REVIEW  Move 2\/4/);
  h.press('\x1b[F');
  h.press('d');
  assert.deepEqual(board(), boards[4]);
  h.press('v');
  assert.deepEqual(frameRows(h.frame()), paused);
  assert.equal(draws, pausedDraws);
  assert.equal(game.status, 'paused');
  assert.equal(game.moves, 4);
  assert.equal(h.clock.timers.size, 0);
  h.press(' ');
  assert.equal(h.clock.next().delay, 180);
  h.clock.tick();
  assert.match(h.frame(), /Delivery complete! 5 buns in 5 moves/);
  assert.equal(h.clock.timers.size, 0);
  h.press('v');
  assert.match(h.frame(), /REVIEW  Move 5\/5/);
  assert.match(h.frame(), /Delivery complete!/);
  h.press('q');
  assert.equal(h.input.isRaw, false);
});

test('review limits long rounds to the latest 64 moves and clears history on restart', t => {
  const game = new SnakeGame({ width: 8, height: 5, arena: 'loop', mode: 'practice', random: () => 0 });
  const h = session(t, { game });
  const total = REVIEW_MOVES + 7;
  h.press('d'.repeat(total));
  h.press('pv\x1b[H');
  assert.ok(h.frame().includes(`Move 7/${total}`));
  h.press('a');
  assert.ok(h.frame().includes(`Move 7/${total}`));
  h.press('\x1b[F');
  assert.ok(h.frame().includes(`Move ${total}/${total}`));
  h.press('vr pv');
  assert.match(h.frame(), /REVIEW  Move 0\/0/);
  h.press('ad');
  assert.match(h.frame(), /REVIEW  Move 0\/0/);
});

test('review includes the collision move and returns to the result screen', t => {
  const game = new SnakeGame({ width: 7, height: 5, arena: 'courtyard', mode: 'practice', seed: 852 });
  const h = session(t, { game });
  h.press('waa');
  assert.match(h.frame(), /Game over\. You hit a market stall/);
  const result = frameRows(h.frame());
  h.press('v');
  assert.match(h.frame(), /REVIEW  Move 3\/3/);
  h.press('a');
  assert.match(h.frame(), /REVIEW  Move 2\/3/);
  assert.doesNotMatch(h.frame(), /Game over/);
  h.press('v');
  assert.deepEqual(frameRows(h.frame()), result);
  assert.equal(game.status, 'lost');
  h.press('m');
  assert.equal(game.arena, 'junction');
  h.press('m');
  assert.equal(game.arena, 'classic');
  assert.equal(game.mode, 'practice');
  assert.equal(game.status, 'ready');
});

test('returning from review preserves the next buffered turn', t => {
  const h = session(t);
  h.press('wa');
  h.clock.tick();
  h.press('pva'); // The review cursor is now on the starting board.
  h.press('v ');
  h.clock.tick();
  assert.deepEqual(h.game.snake[0], { x: 13, y: 6 });
  assert.equal(h.game.moves, 2);
});

test('the requested terminal size still fits after the score gains a digit', t => {
  const game = new SnakeGame({ width: 7, height: 5, arena: 'courtyard', mode: 'practice', seed: 4294967295 });
  const h = session(t, { game, columns: 20, rows: 10 });
  const [, columns] = /Resize to (\d+)x10/.exec(h.frame());
  h.resize(Number(columns), 10);
  for (const key of 'dddwwaaaaa') {
    const { x, y } = game.snake[0];
    const dx = { d: 1, w: 0, a: -1 }[key];
    game.food = { x: x + dx, y: key === 'w' ? y - 1 : y };
    h.press(key);
  }
  assert.equal(game.status, 'running');
  assert.match(h.frame(), /Score 10   Best 10/);
  assert.equal(frameRows(h.frame())[0].length, Number(columns));
});

test('the CLI combines mode, arena and seed at the documented minimum terminal size', () => {
  const { input, output, writes } = terminal(58, 19);
  try {
    const args = ['--seed', '4294967295', '--mode', 'practice', '--arena', 'courtyard'];
    assert.equal(main(args, { stdin: input, stdout: output }), 0);
    const rows = frameRows(writes.at(-1));
    assert.match(rows[0], /PRACTICE \/ COURTYARD.*Seed 4294967295/);
    assert.match(rows.join(''), /#/);
    assert.equal(rows.length, 19);
    assert.ok(rows.every(row => row.length === 58));
    input.write('d');
    assert.match(writes.at(-1), /Space pause/);
  } finally {
    input.write('q');
    input.destroy();
  }
});

test('invalid, duplicate and missing CLI option values produce actionable usage errors', () => {
  const cases = [
    [['--mode', 'rush'], /standard, delivery, practice/],
    [['--mode', 'delivery', '--mode', 'standard'], /only once/],
    [['--mode'], /needs a value/],
    [['--arena', '--seed', '0'], /needs a value/],
    [['--arena', 'stairs'], /classic, loop, courtyard/],
    [['--seed', '0.5'], /whole number/],
    [['--seed', '-1'], /whole number/],
    [['--seed', '4294967296'], /4294967295/],
  ];
  for (const [args, expected] of cases) {
    const { writes, output } = terminal();
    assert.equal(main(args, { stderr: output }), 2);
    assert.match(writes[0], expected);
    assert.match(writes[0], /--help/);
  }
});
