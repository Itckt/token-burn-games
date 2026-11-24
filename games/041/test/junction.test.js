'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SnakeGame } = require('../game');
const { main } = require('../snake');
const { terminal, session, frameRows } = require('../test-support/terminal');

// Each approach ends on the inside of a marked border on a 10-by-7 board.
const gates = [
  ['left',  'waaaaa', 'a', { x: 0, y: 2 }, { x: 9, y: 4 }, { x: 8, y: 4 }],
  ['right', 'sdddd',  'd', { x: 9, y: 4 }, { x: 0, y: 2 }, { x: 1, y: 2 }],
  ['up',    'wwwaa',  'w', { x: 3, y: 0 }, { x: 6, y: 6 }, { x: 6, y: 5 }],
  ['down',  'dsss',   's', { x: 6, y: 6 }, { x: 3, y: 0 }, { x: 3, y: 1 }],
];

for (const [direction, approach, key, entrance, exit, beyond] of gates) {
  test(`leaving the ${direction} gate takes one move, eats at the exit and preserves heading`, t => {
    const game = new SnakeGame({ width: 10, height: 7, arena: 'junction', mode: 'practice', random: () => 0 });
    game.food = exit;
    const h = session(t, { game });
    h.press(approach);
    assert.deepEqual(game.snake[0], entrance);
    assert.equal(game.bites, 0);
    h.press(key);
    assert.deepEqual(game.snake.slice(0, 2), [exit, entrance]);
    assert.equal(game.direction, direction);
    assert.equal(game.moves, approach.length + 1);
    assert.equal(game.bites, 1);
    h.press(key);
    assert.deepEqual(game.snake[0], beyond);
    assert.equal(game.status, 'running');
  });
}

test('unmarked Junction walls end the round on the last valid board', t => {
  const game = new SnakeGame({ width: 7, height: 5, arena: 'junction', random: () => 0 });
  const h = session(t, { game });
  h.press('d');
  for (let i = 0; i < 3; i++) h.clock.tick();
  const before = structuredClone(game.snake);
  h.clock.tick();
  assert.equal(game.collision, 'wall');
  assert.deepEqual(game.snake, before);
  assert.equal(h.clock.timers.size, 0);
  assert.match(h.frame(), /Game over.*wall/);
});

test('a gate exit can be the departing tail, but an occupied body segment stops the crossing', () => {
  // The snake joins the two A gates via the middle row.
  for (const solidExit of [false, true]) {
    const game = new SnakeGame({ width: 7, height: 5, arena: 'junction', random: () => 0 });
    game.snake = [
      { x: 0, y: 1 }, ...Array.from({ length: 7 }, (_, x) => ({ x, y: 2 })), { x: 6, y: 3 },
    ];
    if (solidExit) game.snake.push({ x: 5, y: 3 });
    game.direction = 'up';
    const before = structuredClone(game.snake);
    game.turn('left');
    game.tick();
    if (solidExit) {
      assert.equal(game.collision, 'self');
      assert.deepEqual(game.snake, before);
    } else {
      assert.deepEqual(game.snake, [before.at(-1), ...before.slice(0, -1)]);
      assert.equal(game.status, 'running');
    }
  }
});

test('a last-chance chest at a gate exit scores without growing or filling a delivery order', t => {
  const game = new SnakeGame({ width: 10, height: 7, arena: 'junction', mode: 'delivery', random: () => 0 });
  const h = session(t, { game });
  for (const key of 'sdddd') {
    h.press(key);
    h.clock.tick();
  }
  game.chest = { x: 0, y: 2, movesLeft: 1 };
  h.clock.tick();
  assert.deepEqual(game.snake[0], { x: 0, y: 2 });
  assert.equal(game.bites, 0);
  assert.equal(game.score, 3);
  assert.equal(game.chest, null);
  assert.match(h.frame(), /Buns 0\/5   28 moves left/);
  assert.equal(h.clock.next().delay, 200);
});

test('gate markings occupy the border and leave every square playable on a one-row board', t => {
  const game = new SnakeGame({ width: 5, height: 1, arena: 'junction', mode: 'practice', random: () => 0 });
  const h = session(t, { game, color: true });
  assert.deepEqual(frameRows(h.frame()).slice(1, 4), ['+--B-------+', 'Ao o @ *   A', '+------B---+']);
  assert.match(h.frame(), /\x1b\[1;32mA\x1b\[0m/);
  assert.equal(game.goal, 2);
  h.press('dd');
  assert.equal(game.status, 'won');
  assert.equal(game.snake.length, 5);
  assert.equal(game.food, null);
});

test('the CLI opens Junction at 58 by 19 and the example reaches its first bun through B in 11 moves', () => {
  const { input, output, writes } = terminal(58, 19);
  try {
    assert.equal(main(['--mode', 'practice', '--arena', 'junction', '--seed', '2031'], { stdin: input, stdout: output }), 0);
    const rows = () => frameRows(writes.at(-1));
    assert.match(rows()[0], /PRACTICE \/ JUNCTION Seed 2031/);
    assert.equal(rows().length, 19);
    assert.ok(rows().every(row => row.length === 58));
    input.write('h');
    assert.match(rows().at(-2), /Hint  DOWN, 11 moves to \*/);
    input.write('ssssssdddd');
    assert.match(rows().at(-2), /DOWN, 1 move to \*/);
    assert.equal(rows()[15][1 + 2 * 18], '@');
    input.write('s');
    assert.match(rows()[0], /Score 1   Best 1/);
    assert.equal(rows()[2][1 + 2 * 9], '@');
    input.write('u');
    assert.match(rows()[0], /Score 0   Best 1/);
    assert.match(rows().at(-2), /DOWN, 1 move to \*/);
  } finally {
    input.write('q');
    input.destroy();
  }
});
