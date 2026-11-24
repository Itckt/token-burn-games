'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Game, WIDTH, HEIGHT, STONE, LOCK_DELAY, seededRandom } = require('../game');
const { Surge, emptyRow } = require('../well');

function beforeFirstRise() {
  const game = new Game(seededRandom(852), 'surge');
  for (let i = 0; i < 3; i++) {
    game.active = { kind: 'O', x: -1, y: 0, rotation: 0 };
    game.act('hard');
  }
  assert.equal(game.wave.locksLeft, 1);
  return game;
}

test('the six forecasts match the actual rises, preserve the pile and repeat by seed', () => {
  function course(seed, cancel) {
    const surge = new Surge(seededRandom(seed));
    const board = Array.from({ length: HEIGHT }, emptyRow);
    board[HEIGHT - 1][0] = 'T';
    const gaps = [];
    for (const [wave, size] of [1, 1, 2, 2, 3, 3].entries()) {
      const { gap } = surge.forecast;
      gaps.push(gap);
      assert.ok(gap >= 0 && gap < WIDTH);
      if (wave > 0) assert.notEqual(gap, gaps[wave - 1]);
      assert.deepEqual(surge.forecast, { completed: wave, locksLeft: 4, rows: size, gap });
      const before = structuredClone(board);
      const remaining = cancel ? size - 1 : size;
      for (let lock = 0; lock < 3; lock++) {
        assert.equal(surge.afterLock(board, cancel && lock === 0 ? 1 : 0), null);
        assert.equal(surge.forecast.rows, remaining);
        assert.equal(surge.forecast.locksLeft, 3 - lock);
        assert.deepEqual(board, before);
      }
      assert.equal(surge.afterLock(board, 0), wave === 5 ? 'won' : null);
      const row = Array(WIDTH).fill(STONE);
      row[gap] = null;
      assert.deepEqual(board, [...before.slice(remaining), ...Array(remaining).fill(row)]);
      assert.equal(new Set(board).size, HEIGHT);
    }
    assert.deepEqual(surge.forecast, { completed: 6, locksLeft: 0, rows: 0, gap: null });
    return gaps;
  }
  assert.deepEqual(course(852, true), course(852, false));
  assert.notDeepEqual(course(0, false), course(0xffffffff, false));
});

test('only a committed piece advances a wave, including a gravity lock', () => {
  const game = new Game(seededRandom(41), 'surge');
  const forecast = game.wave;
  game.act('soft');
  game.act('hold');
  game.act('left');
  game.act('pause');
  game.advance(60000);
  assert.equal(game.act('hard'), false);
  assert.equal(game.act('undo'), false);
  game.act('pause');
  game.active = { kind: 'O', x: -1, y: HEIGHT - 2, rotation: 0 };
  game.advance(LOCK_DELAY - 1);
  assert.deepEqual(game.wave, forecast);
  game.advance(1);
  assert.deepEqual(game.wave, { ...forecast, locksLeft: 3 });
  assert.equal(game.elapsedMs, LOCK_DELAY);
  assert.equal(game.stats.pieces, 1);
});

test('the fourth lock can cancel the entire rise and surplus clears expire with the wave', () => {
  const game = beforeFirstRise();
  game.board[0][9] = 'T';
  for (const row of game.board.slice(-2)) {
    row.fill('Z');
    row[5] = null;
  }
  game.active = { kind: 'I', rotation: 1, x: 3, y: HEIGHT - 4 };
  game.act('hard');
  assert.equal(game.status, 'playing');
  assert.equal(game.lines, 2);
  assert.equal(game.lastClear.points, 300);
  assert.equal(game.layersLeft, 0);
  assert.equal(game.board[2][9], 'T');
  assert.equal(game.wave.completed, 1);
  assert.equal(game.wave.rows, 1);
  assert.equal(game.wave.locksLeft, 4);
});

test('a rise that would eject a block ends the round before moving rows or drawing a piece', () => {
  const game = beforeFirstRise();
  game.board[0][9] = 'J';
  game.active = { kind: 'O', x: 6, y: HEIGHT - 2, rotation: 0 };
  const queue = [game.next, ...game.following];
  game.advance(LOCK_DELAY + 3000);
  assert.equal(game.status, 'over');
  assert.equal(game.active, null);
  assert.equal(game.stats.pieces, 4);
  assert.equal(game.elapsedMs, LOCK_DELAY);
  assert.equal(game.layersLeft, 0);
  assert.equal(game.board[0][9], 'J');
  assert.equal(game.board[HEIGHT - 1][7], 'O');
  assert.deepEqual([game.next, ...game.following], queue);
  assert.equal(game.wave.completed, 0);
});

test('a safe rise can still block the next spawn', () => {
  const game = beforeFirstRise();
  game.board[2][4] = 'L';
  game.next = 'O';
  game.active = { kind: 'O', x: 6, y: HEIGHT - 2, rotation: 0 };
  game.act('hard');
  assert.equal(game.status, 'over');
  assert.equal(game.stats.pieces, 4);
  assert.equal(game.board[1][4], 'L');
  assert.equal(game.wave.completed, 1);
  assert.equal(game.layersLeft, 1);
});

test('a multirow rise checks every displaced row, even on the final wave', () => {
  const board = Array.from({ length: HEIGHT }, emptyRow);
  const surge = new Surge(seededRandom(852));
  for (let lock = 0; lock < 20; lock++) surge.afterLock(board, 1);
  for (let lock = 0; lock < 3; lock++) surge.afterLock(board, 0);
  assert.equal(surge.forecast.completed, 5);
  assert.equal(surge.forecast.rows, 3);
  board[2][0] = 'Z';
  const before = structuredClone(board);
  assert.equal(surge.afterLock(board, 0), 'over');
  assert.deepEqual(board, before);
  assert.equal(surge.forecast.completed, 5);
});
