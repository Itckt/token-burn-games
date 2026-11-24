'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SnakeGame, ARENAS } = require('../game');
const { findBunRoute } = require('../coach');
const { REVIEW_MOVES } = require('../review');
const { session, frameRows } = require('../test-support/terminal');

function walkRoute(game, route) {
  const bun = game.food;
  const before = game.bites;
  for (const { x, y, direction } of route) {
    assert.equal(game.turn(direction), true);
    game.tick();
    assert.notEqual(game.status, 'lost');
    assert.deepEqual(game.snake[0], { x, y });
  }
  assert.deepEqual(game.snake[0], bun);
  assert.equal(game.bites, before + 1);
}

test('the coach finds a short detour around a market stall', () => {
  for (const [arena, distance] of [['classic', 4], ['courtyard', 6]]) {
    const game = new SnakeGame({ arena, mode: 'practice', width: 7, height: 5, random: () => 0 });
    game.food = { x: 0, y: 1 };
    const route = findBunRoute(game);
    assert.equal(route.length, distance);
    walkRoute(game, route);
  }
});

test('a Loop hint uses the seam and a departing tail can be the only legal first step', () => {
  const loop = new SnakeGame({ arena: 'loop', mode: 'practice', width: 7, height: 5, random: () => 0 });
  loop.turn('up');
  loop.tick();
  loop.tick();
  loop.food = { x: 3, y: 4 };
  const across = findBunRoute(loop);
  assert.deepEqual(across, [{ x: 3, y: 4, direction: 'up' }]);
  walkRoute(loop, across);

  const corner = new SnakeGame({ mode: 'practice', width: 4, height: 3, random: () => 0 });
  corner.snake = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  corner.direction = 'left';
  corner.food = { x: 0, y: 2 };
  const escape = findBunRoute(corner);
  assert.deepEqual(escape, [{ x: 0, y: 1, direction: 'down' }, { x: 0, y: 2, direction: 'down' }]);
  walkRoute(corner, escape);
});

test('suggested routes can be played to the indicated bun across seeded boards in every arena', () => {
  for (const arena of ARENAS) {
    for (const seed of [0, 1, 852, 2031, 4294967295]) {
      const game = new SnakeGame({ mode: 'practice', arena, seed, width: 8, height: 6 });
      for (let i = 0; i < 16; i++) {
        const route = findBunRoute(game);
        if (!route) break;
        walkRoute(game, route);
      }
      assert.ok(game.bites > 0, `missing opening route in ${arena} with seed ${seed}`);
    }
  }
});

test('H overlays a live route while keeping items visible and leaves review boards untouched', t => {
  let draws = 0;
  const game = new SnakeGame({
    width: 9, height: 5, arena: 'courtyard', mode: 'practice', random: () => { draws++; return 0; },
  });
  game.food = { x: 8, y: 2 };
  game.chest = { x: 6, y: 2, movesLeft: 5 };
  const h = session(t, { game, color: true });
  const rows = () => frameRows(h.frame());
  const ready = rows();
  h.press('H');
  assert.ok(rows()[4].includes('@ . C . * '));
  assert.match(rows().at(-2), /Hint  RIGHT, 4 moves to \*.*C \+3 \(5 moves\)/);
  assert.equal(game.status, 'ready');
  h.press('h');
  assert.deepEqual(rows(), ready);
  h.press('hdp');
  assert.match(rows().at(-2), /Paused\. Hint  RIGHT, 3 moves/);
  assert.equal(game.chest.movesLeft, 4);
  const paused = rows();
  h.press('v');
  const review = rows();
  assert.match(review[0], /Move 1\/1/);
  assert.doesNotMatch(review[4], /\./);
  h.press('hu');
  assert.deepEqual(rows(), review);
  h.press('v');
  assert.deepEqual(rows(), paused);
  h.resize(15, 1);
  h.press('uh');
  h.resize(58, 19);
  assert.deepEqual(rows(), paused);
  h.press('r');
  assert.doesNotMatch(rows().at(-2), /Hint/);
  assert.equal(game.moves, 0);
  assert.equal(draws, 2, 'only the initial bun and the restart need random draws');
  assert.equal(h.clock.timers.size, 0);
});

test('an unreachable bun gets an explicit hint without spending a move', t => {
  const game = new SnakeGame({ mode: 'practice', width: 6, height: 1, random: () => 0 });
  const h = session(t, { game });
  h.press('h');
  assert.match(h.frame(), /No clear path to \* yet/);
  assert.equal(game.moves, 0);
  h.press('dddu'); // Walk into the wall, then undo the collision.
  assert.equal(game.moves, 2);
  assert.equal(game.status, 'running');
  assert.match(h.frame(), /No clear path to \* yet/);
  assert.equal(h.clock.timers.size, 0);
});

test('undo restores buns, chest timers and random draws, including the move that filled the board', t => {
  let draws = 0;
  const game = new SnakeGame({
    width: 4, height: 2, arena: 'loop', mode: 'practice',
    random: () => { draws++; return 1 - Number.EPSILON; },
  });
  const h = session(t, { game });
  h.press('dwa'); // Third bite reveals a chest.
  const third = frameRows(h.frame()).slice(1, -1);
  const thirdDraws = draws;
  assert.equal(game.chest.movesLeft, 6);
  h.press('u');
  assert.equal(game.score, 2);
  assert.equal(game.best, 3);
  assert.equal(game.chest, null);
  h.press('a');
  assert.deepEqual(frameRows(h.frame()).slice(1, -1), third);
  assert.equal(draws, thirdDraws);
  h.press('a');
  assert.equal(game.chest, null);
  h.press('u');
  assert.deepEqual(frameRows(h.frame()).slice(1, -1), third);
  h.press('aa');
  assert.equal(game.status, 'won');
  assert.equal(game.food, null);
  const winningBoard = structuredClone(game.snake);
  const winningDraws = draws;
  h.press('u');
  assert.equal(game.moves, 4);
  assert.equal(game.status, 'running');
  assert.deepEqual(game.food, { x: 0, y: 0 });
  assert.match(h.frame(), /Score 4   Best 5/);
  h.press('s');
  assert.equal(game.collision, 'self');
  h.press('u');
  assert.equal(game.collision, null);
  h.press('a');
  assert.equal(game.status, 'won');
  assert.deepEqual(game.snake, winningBoard);
  assert.equal(draws, winningDraws);
  assert.equal(h.clock.timers.size, 0);
});

test('undo can recover both a collected chest and an expired one, including its last move', t => {
  const game = new SnakeGame({ mode: 'practice', arena: 'loop', width: 8, height: 3, seed: 852 });
  const chest = { x: 5, y: 1, movesLeft: 1 };
  game.chest = { ...chest };
  game.food = { x: 7, y: 0 };
  const h = session(t, { game });
  h.press('d');
  assert.match(h.frame(), /Score 3   Best 3/);
  h.press('u');
  assert.equal(game.status, 'ready');
  assert.equal(game.bonusPoints, 0);
  assert.deepEqual(game.chest, chest);
  h.press('w');
  assert.equal(game.chest, null);
  assert.match(h.frame(), /Score 0   Best 3/);
  h.press('puu');
  assert.equal(game.status, 'paused');
  assert.equal(game.moves, 0);
  assert.deepEqual(game.chest, chest);
  h.press('d');
  assert.equal(game.moves, 0);
  h.press(' d');
  assert.equal(game.moves, 1);
  assert.equal(game.score, 3);
  assert.equal(h.clock.timers.size, 0);
});

test('branching after undo uses the same random draw on the new set of free squares', t => {
  function makeGame() {
    const values = [0.65, 0.6];
    return new SnakeGame({
      mode: 'practice', width: 6, height: 4,
      random: () => {
        assert.ok(values.length, 'a retry should reuse its draw');
        return values.shift();
      },
    });
  }
  const reference = session(t, { game: makeGame() });
  const branch = session(t, { game: makeGame() });
  reference.press('wds');
  branch.press('d');
  const firstFood = branch.game.food;
  branch.press('uwds');
  assert.equal(branch.game.bites, 1);
  assert.deepEqual(branch.game.snake, reference.game.snake);
  assert.deepEqual(branch.game.food, reference.game.food);
  assert.notDeepEqual(branch.game.food, firstFood);
  branch.press('pv\x1b[H');
  branch.press('d');
  assert.match(branch.frame(), /Move 1\/3/);
  // Move one of the new route goes up, where the abandoned route went right.
  assert.equal(frameRows(branch.frame())[3][1 + 2 * 3], '@');
});

test('undo restores heading and permits a new turn after a crash', t => {
  const game = new SnakeGame({ mode: 'practice', width: 8, height: 3, random: () => 0 });
  const h = session(t, { game });
  h.press('dww');
  assert.equal(game.collision, 'wall');
  h.press('uu');
  assert.equal(game.direction, 'right');
  h.press('s');
  assert.equal(game.status, 'running');
  assert.deepEqual(game.snake[0], { x: 5, y: 2 });
  assert.equal(game.moves, 2);
});

test('undo stops at the oldest retained board and starts a fresh history after reset', t => {
  const game = new SnakeGame({ mode: 'practice', arena: 'loop', width: 8, height: 3, random: () => 0 });
  const h = session(t, { game });
  h.press('d'.repeat(REVIEW_MOVES + 7));
  h.press('u'.repeat(REVIEW_MOVES + 1));
  assert.equal(game.moves, 7);
  assert.deepEqual(game.snake[0], { x: 3, y: 1 });
  h.press('pv\x1b[H');
  assert.match(h.frame(), /Move 7\/7/);
  h.press('vrdu');
  assert.equal(game.moves, 0);
  assert.equal(game.status, 'ready');
  h.press('u');
  assert.equal(game.moves, 0);
  assert.equal(h.clock.timers.size, 0);
});

test('real-time modes ignore practice controls and keep their tick deadline', t => {
  for (const mode of ['standard', 'delivery']) {
    const h = session(t, { game: new SnakeGame({ mode, arena: 'junction', seed: 2031 }) });
    h.press(' hu');
    h.clock.tick();
    const timer = h.clock.next();
    const before = h.frame();
    h.press('uh');
    assert.equal(h.frame(), before);
    assert.strictEqual(h.clock.next(), timer);
    h.press('puh');
    assert.equal(h.game.status, 'paused');
    assert.equal(h.game.moves, 1);
    assert.equal(h.clock.timers.size, 0);
  }
});
