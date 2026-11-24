'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SnakeGame } = require('../game');

function newGame(options = {}) {
  return new SnakeGame({ random: () => 0, ...options });
}

// Lay a known sequence of snacks in free squares immediately ahead of the snake.
function feedToRight(game, count) {
  game.turn('right');
  for (let i = 0; i < count; i++) {
    const { x, y } = game.snake[0];
    game.food = { x: x + 1, y };
    game.tick();
  }
}

test('a round starts stationary with a connected three-cell snake', () => {
  const game = newGame();
  game.tick();
  assert.equal(game.status, 'ready');
  assert.equal(game.score, 0);
  assert.equal(game.best, 0);
  assert.equal(game.tickMs, 200);
  assert.deepEqual(game.snake, [{ x: 14, y: 7 }, { x: 13, y: 7 }, { x: 12, y: 7 }]);
  assert.deepEqual(game.food, { x: 0, y: 0 });
});

test('the board must have integer dimensions and room for a starting snake and snack', () => {
  for (const [width, height] of [[3, 1], [5, 0], [4.5, 2], [6, 1.5], [NaN, 3]]) {
    assert.throws(() => newGame({ width, height }), RangeError);
  }
  assert.doesNotThrow(() => newGame({ width: 4, height: 1 }));
});

test('each free square can receive the first snack with equal probability', () => {
  const expected = [
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }, { x: 4, y: 0 },
    { x: 3, y: 1 }, { x: 4, y: 1 },
  ];
  for (const [index, cell] of expected.entries()) {
    for (const fraction of [0.01, 0.99]) {
      const random = () => (index + fraction) / expected.length;
      assert.deepEqual(newGame({ width: 5, height: 2, random }).food, cell);
    }
  }
});

test('the head advances one square per tick and the body follows', () => {
  const game = newGame({ width: 8, height: 5 });
  game.turn('right');
  assert.equal(game.status, 'running');
  assert.deepEqual(game.snake[0], { x: 4, y: 2 });
  game.tick();
  assert.deepEqual(game.snake, [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }]);
  game.tick();
  assert.deepEqual(game.snake, [{ x: 6, y: 2 }, { x: 5, y: 2 }, { x: 4, y: 2 }]);
  assert.equal(game.score, 0);
});

test('unknown moves and a reversal cannot start a round or reverse a moving snake', () => {
  const game = newGame();
  for (const direction of ['left', 'diagonal', 'constructor', undefined, ['left'], ['up']]) game.turn(direction);
  assert.equal(game.status, 'ready');
  game.turn('down');
  game.tick();
  game.turn('up');
  game.turn('diagonal');
  game.tick();
  assert.deepEqual(game.snake[0], { x: 14, y: 9 });
});

test('two rapid corners are buffered, validated in order and consumed one per tick', () => {
  const game = newGame({ width: 10, height: 7 });
  game.turn('up');
  game.turn('down'); // Opposite the buffered up turn.
  game.turn('up');   // Duplicate key repeat.
  game.turn('left');
  game.turn('down'); // A third corner exceeds the buffer.
  game.tick();
  assert.deepEqual(game.snake[0], { x: 5, y: 2 });
  game.turn('right'); // Opposite the still-buffered left turn.
  game.tick();
  assert.deepEqual(game.snake[0], { x: 4, y: 2 });
  game.tick();
  assert.deepEqual(game.snake[0], { x: 3, y: 2 });
});

test('pausing freezes the board and resumes with the previously buffered turn', () => {
  const game = newGame();
  game.turn('up');
  game.turn('left');
  game.tick();
  const before = structuredClone(game.snake);
  game.togglePause();
  game.turn('down');
  game.tick();
  assert.equal(game.status, 'paused');
  assert.deepEqual(game.snake, before);
  game.togglePause();
  game.tick();
  game.tick();
  assert.deepEqual(game.snake[0], { x: 12, y: 6 });
});

test('eating keeps the tail, scores a point and places the next snack in a free square', () => {
  const game = newGame({ width: 6, height: 1, random: () => 0.5 });
  const initial = structuredClone(game.snake);
  assert.deepEqual(game.food, { x: 4, y: 0 });
  game.togglePause();
  game.tick();
  assert.deepEqual(game.snake, [{ x: 4, y: 0 }, ...initial]);
  assert.equal(game.score, 1);
  assert.equal(game.best, 1);
  assert.equal(game.tickMs, 195);
  assert.deepEqual(game.food, { x: 5, y: 0 });
  game.tick();
  assert.equal(game.score, 2);
  assert.deepEqual(game.food, { x: 0, y: 0 });
});

test('the five-millisecond speed increases stop at a ninety-millisecond tick', () => {
  const game = newGame({ width: 60, height: 1 });
  for (let score = 1; score <= 25; score++) {
    feedToRight(game, 1);
    assert.equal(game.score, score);
    assert.equal(game.tickMs, Math.max(90, 200 - 5 * score));
  }
});

for (const direction of ['up', 'right', 'down', 'left']) {
  test(`crossing the ${direction} boundary ends the round on the last valid board`, () => {
    const game = newGame({ width: 8, height: 5 });
    if (direction === 'left') {
      game.turn('up');
      game.tick();
    }
    game.turn(direction);
    let before;
    for (let i = 0; i <= game.width && game.status === 'running'; i++) {
      before = structuredClone(game.snake);
      game.tick();
    }
    assert.equal(game.status, 'lost');
    assert.equal(game.collision, 'wall');
    assert.deepEqual(game.snake, before);
    const coordinate = ['left', 'right'].includes(direction) ? 'x' : 'y';
    const edge = { up: 0, right: 7, down: 4, left: 0 }[direction];
    assert.equal(game.snake[0][coordinate], edge);
    game.turn('up');
    game.togglePause();
    game.tick();
    assert.equal(game.status, 'lost');
    assert.deepEqual(game.snake, before);
  });
}

test('the head may enter the square the tail vacates on the same tick', () => {
  const game = newGame({ width: 6, height: 4 });
  feedToRight(game, 1);
  for (const direction of ['up', 'left']) {
    game.turn(direction);
    game.tick();
  }
  const oldTail = game.snake.at(-1);
  game.turn('down');
  game.tick();
  assert.equal(game.status, 'running');
  assert.equal(game.snake.length, 4);
  assert.deepEqual(game.snake[0], oldTail);
  assert.equal(new Set(game.snake.map(part => part.y * game.width + part.x)).size, 4);
});

test('entering a body square that stays occupied ends the round', () => {
  const game = newGame({ width: 6, height: 4 });
  feedToRight(game, 2);
  for (const direction of ['up', 'left']) {
    game.turn(direction);
    game.tick();
  }
  const before = structuredClone(game.snake);
  game.turn('down');
  game.tick();
  assert.equal(game.status, 'lost');
  assert.equal(game.collision, 'self');
  assert.deepEqual(game.snake, before);
  assert.equal(game.score, 2);
});

test('filling a board wins without trying to place food on a full grid', () => {
  let draws = 0;
  const random = () => { draws++; return 1 - Number.EPSILON; };
  const game = newGame({ width: 4, height: 2, random });
  for (const direction of ['right', 'up', 'left', 'left', 'left']) {
    const target = game.food;
    const length = game.snake.length;
    game.turn(direction);
    game.tick();
    assert.deepEqual(game.snake[0], target);
    assert.equal(game.snake.length, length + 1);
  }
  assert.equal(game.status, 'won');
  assert.equal(game.score, 5);
  assert.equal(game.best, 5);
  assert.equal(game.food, null);
  assert.equal(draws, 5);
  const fullBoard = structuredClone(game.snake);
  game.togglePause();
  game.turn('down');
  game.tick();
  assert.equal(game.status, 'won');
  assert.deepEqual(game.snake, fullBoard);
});

test('restart clears the previous round and keeps the best across shorter rounds', () => {
  const game = newGame({ width: 8, height: 3 });
  const initial = structuredClone(game.snake);
  feedToRight(game, 2);
  game.turn('up');
  game.turn('left');
  game.restart();
  assert.equal(game.status, 'ready');
  assert.deepEqual(game.snake, initial);
  assert.equal(game.collision, null);
  assert.equal(game.score, 0);
  assert.equal(game.best, 2);
  assert.equal(game.tickMs, 200);
  game.togglePause();
  game.tick();
  assert.deepEqual(game.snake[0], { x: 5, y: 1 });
  feedToRight(game, 1);
  assert.equal(game.best, 2);
  game.tick();
  game.tick();
  assert.equal(game.status, 'lost');
  game.restart();
  assert.equal(game.collision, null);
  assert.equal(game.best, 2);
});

test('a delivery on the last available move wins and closes the order', () => {
  const game = newGame({ mode: 'delivery', arena: 'loop' });
  assert.equal(game.goal, 5);
  assert.equal(game.moveLimit, 84);
  game.turn('right');
  for (let i = 0; i < 79; i++) game.tick(); // Loop along the empty middle row.
  assert.equal(game.bites, 0);
  feedToRight(game, 4);
  assert.equal(game.status, 'running');
  assert.equal(game.moves, 83);
  feedToRight(game, 1);
  assert.equal(game.status, 'won');
  assert.equal(game.moves, 84);
  assert.equal(game.best, 5);
  assert.equal(game.food, null);
  assert.equal(game.chest, null);
  game.tick();
  assert.equal(game.moves, 84);
});

test('the delivery budget counts moves, freezes on pause and scores a final partial delivery', () => {
  const game = newGame({ mode: 'delivery', arena: 'loop' });
  game.tick();
  game.turn('right');
  game.togglePause();
  game.tick();
  assert.equal(game.moves, 0);
  game.togglePause();
  for (let i = 0; i < 83; i++) game.tick();
  assert.equal(game.status, 'running');
  feedToRight(game, 1);
  assert.equal(game.status, 'lost');
  assert.equal(game.collision, null);
  assert.equal(game.moves, 84);
  assert.equal(game.score, 1);
  assert.equal(game.best, 1);
  game.restart();
  assert.equal(game.mode, 'delivery');
  assert.equal(game.moves, 0);
  assert.equal(game.score, 0);
  assert.equal(game.best, 1);
});

test('a delivery on a small board only requests buns that can fit', () => {
  let draws = 0;
  const game = newGame({ mode: 'delivery', width: 4, height: 1, random: () => { draws++; return 0; } });
  assert.equal(game.goal, 1);
  assert.equal(game.moveLimit, 10);
  game.turn('right');
  game.tick();
  assert.equal(game.status, 'won');
  assert.equal(game.moves, 1);
  assert.equal(draws, 1);
});

test('arena and mode changes keep separate records and are locked during a live round', () => {
  const game = newGame();
  feedToRight(game, 2);
  game.cycleMode();
  game.togglePause();
  game.cycleArena();
  game.cycleMode();
  assert.equal(game.arena, 'classic');
  assert.equal(game.mode, 'standard');
  assert.equal(game.status, 'paused');
  game.restart();
  game.cycleMode();
  assert.equal(game.mode, 'delivery');
  assert.equal(game.best, 0);
  feedToRight(game, 1);
  game.restart();
  game.cycleArena();
  assert.equal(game.best, 0);
  game.restart('classic', 'practice');
  assert.equal(game.best, 0);
  game.cycleMode();
  assert.equal(game.best, 2);
  game.cycleMode();
  assert.equal(game.best, 1);
});

test('Loop wraps across all four edges and can collect a bun across the seam', () => {
  const game = newGame({ width: 8, height: 5, arena: 'loop' });
  const route = [['up', 3, 4, 4], ['left', 5, 7, 4], ['down', 1, 7, 0], ['right', 1, 0, 0]];
  for (const [direction, steps, x, y] of route) {
    game.turn(direction);
    for (let i = 0; i < steps; i++) game.tick();
    assert.deepEqual(game.snake[0], { x, y });
    assert.equal(game.status, 'running');
  }
  assert.equal(game.score, 1);
  assert.equal(game.snake.length, 4);
});

test('a wrap into an occupied body cell still ends the round', () => {
  const game = newGame({ width: 6, height: 2, arena: 'loop' });
  game.turn('up');
  game.tick();
  const before = structuredClone(game.snake);
  game.tick();
  assert.equal(game.status, 'lost');
  assert.equal(game.collision, 'self');
  assert.deepEqual(game.snake, before);
});

test('courtyard stalls exclude snacks and stop the head on the last safe board', () => {
  const options = { width: 7, height: 5, arena: 'courtyard' };
  const game = newGame(options);
  assert.equal(game.stalls.length, 4);
  const open = game.goal;
  const draws = new Set();
  for (let i = 0; i < open; i++) {
    const { food } = newGame({ ...options, random: () => (i + 0.5) / open });
    assert.ok(!game.stalls.some(stall => stall.x === food.x && stall.y === food.y));
    draws.add(food.y * game.width + food.x);
  }
  assert.equal(draws.size, 28);
  game.turn('up');
  game.tick();
  game.turn('left');
  game.tick();
  const before = structuredClone(game.snake);
  game.tick();
  assert.equal(game.status, 'lost');
  assert.equal(game.collision, 'stall');
  assert.deepEqual(game.snake, before);
});

test('a chest adds points without spending a bun on the delivery order or increasing speed', () => {
  const game = newGame({ width: 18, height: 3, arena: 'loop', mode: 'delivery' });
  feedToRight(game, 3);
  assert.deepEqual(game.food, { x: 0, y: 0 });
  assert.deepEqual(game.chest, { x: 1, y: 0, movesLeft: 21 });
  game.turn('up');
  game.tick();
  game.turn('left');
  for (let i = 0; i < 11; i++) game.tick();
  assert.deepEqual(game.snake[0], { x: 1, y: 0 });
  assert.equal(game.chest, null);
  assert.equal(game.score, 6);
  assert.equal(game.best, 6);
  assert.equal(game.bites, 3);
  assert.equal(game.tickMs, 185);
  assert.equal(game.status, 'running');
});

test('an untouched chest expires after its last move and freezes during a pause', () => {
  const game = newGame({ width: 18, height: 3, arena: 'loop' });
  feedToRight(game, 3);
  for (let i = 0; i < 20; i++) game.tick();
  assert.equal(game.chest.movesLeft, 1);
  game.togglePause();
  game.tick();
  assert.equal(game.chest.movesLeft, 1);
  game.togglePause();
  game.tick();
  assert.equal(game.chest, null);
  assert.equal(game.score, 3);
});

test('a chest yields the last open square to the winning bun', () => {
  const game = newGame({ width: 4, height: 2, arena: 'loop', random: () => 1 - Number.EPSILON });
  for (const dir of ['right', 'up', 'left']) {
    game.turn(dir);
    game.tick();
  }
  assert.deepEqual(game.chest, { x: 0, y: 0, movesLeft: 6 });
  game.tick();
  assert.equal(game.chest, null);
  assert.deepEqual(game.food, { x: 0, y: 0 });
  game.tick();
  assert.equal(game.status, 'won');
  assert.equal(game.score, 5);
});

test('seeded restarts reproduce multiple bun and chest draws in the same arena', () => {
  const game = newGame({ seed: 0, arena: 'courtyard', random: () => assert.fail('unseeded draw') });
  function opening() {
    const draws = [game.food];
    for (let i = 0; i < 3; i++) {
      feedToRight(game, 1);
      draws.push(game.food);
    }
    assert.ok(game.chest);
    return [...draws, game.chest];
  }
  const first = opening();
  game.restart();
  assert.deepEqual(opening(), first);
});
