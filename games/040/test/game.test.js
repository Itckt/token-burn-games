'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  Game, WIDTH, HEIGHT, KINDS, LOCK_DELAY, MAX_LOCK_RESETS, cellsOf, pieceStream, seededRandom,
  DIG_LAYERS, SPRINT_LINES, STONE,
} = require('../game');

function withPiece(kind, x = 3, y = 0, rotation = 0) {
  const game = new Game(seededRandom(852));
  game.active = { kind, x, y, rotation };
  return game;
}

function blocks(game) {
  return game.board.flat().filter(Boolean).length;
}

function snapshot(game) {
  return structuredClone({ ...game });
}

function readyToClear(count, game = new Game(seededRandom(852))) {
  // A vertical I fills the gap in column five without earning drop points.
  game.active = { kind: 'I', x: 3, y: HEIGHT - 4, rotation: 1 };
  for (const row of game.board.slice(-count)) {
    row.fill('S');
    row[5] = null;
  }
  return game;
}

test('the seven spawn footprints and all four orientations contain the expected cells', () => {
  const spawn = {
    I: ['0,1', '1,1', '2,1', '3,1'], J: ['0,0', '0,1', '1,1', '2,1'],
    L: ['2,0', '0,1', '1,1', '2,1'], O: ['1,0', '2,0', '1,1', '2,1'],
    S: ['1,0', '2,0', '0,1', '1,1'], T: ['1,0', '0,1', '1,1', '2,1'],
    Z: ['0,0', '1,0', '1,1', '2,1'],
  };
  assert.deepEqual(new Set(KINDS), new Set(Object.keys(spawn)));
  for (const kind of KINDS) {
    assert.deepEqual(new Set(cellsOf({ kind }).map(String)), new Set(spawn[kind]));
    for (let rotation = 0; rotation < 4; rotation++) {
      const local = cellsOf({ kind, rotation });
      assert.equal(local.length, 4);
      assert.equal(new Set(local.map(String)).size, 4);
      assert.deepEqual(cellsOf({ kind, rotation, x: -1, y: 7 }), local.map(([x, y]) => [x - 1, y + 7]));
    }
  }
});

test('a seeded deal is repeatable and every group of seven contains one of each piece', () => {
  function deal(seed) {
    const stream = pieceStream(seededRandom(seed));
    return Array.from({ length: 7 * 16 }, () => stream.next().value);
  }
  const sequence = deal(0);
  assert.deepEqual(deal(0), sequence);
  assert.notDeepEqual(deal(0xffffffff), sequence);
  for (let i = 0; i < sequence.length; i += 7) {
    assert.deepEqual(new Set(sequence.slice(i, i + 7)), new Set(KINDS));
  }
});

test('a fresh game deals the first two pieces and has twenty independent empty rows', () => {
  const game = new Game(seededRandom(41));
  const stream = pieceStream(seededRandom(41));
  assert.deepEqual(game.active, { kind: stream.next().value, x: 3, y: 0, rotation: 0 });
  assert.equal(game.next, stream.next().value);
  assert.deepEqual([game.score, game.lines, game.level, game.held, game.canHold, game.status],
    [0, 0, 1, null, true, 'playing']);
  assert.equal(game.board.length, 20);
  assert.equal(new Set(game.board).size, 20);
  assert.ok(game.board.every(row => row.length === 10 && row.every(cell => cell === null)));
});

test('all three previews follow the seeded bags through draws, holds and swaps', () => {
  const game = new Game(seededRandom(852));
  const stream = pieceStream(seededRandom(852));
  const deal = Array.from({ length: 24 }, () => stream.next().value);
  function checkNext(index) {
    assert.deepEqual([game.next, ...game.following], deal.slice(index, index + 3));
  }
  assert.equal(game.active.kind, deal[0]);
  checkNext(1);
  assert.equal(game.act('hold'), true);
  assert.equal(game.active.kind, deal[1]);
  assert.equal(game.act('hold'), false);
  checkNext(2);
  game.act('hard');
  checkNext(3);
  assert.equal(game.act('hold'), true);
  assert.equal(game.active.kind, deal[0]);
  checkNext(3);

  for (let index = 3; index < 18; index++) {
    const side = index % 2 === 0 ? 'left' : 'right';
    for (let move = 0; move < WIDTH; move++) game.act(side);
    game.act('hard');
    assert.equal(game.active.kind, deal[index]);
    checkNext(index + 1);
  }
});

test('horizontal movement stops at both walls and at occupied cells', () => {
  const game = withPiece('O');
  for (let i = 0; i < WIDTH; i++) game.act('left');
  assert.equal(Math.min(...cellsOf(game.active).map(([x]) => x)), 0);
  assert.equal(game.act('left'), false);
  for (let i = 0; i < WIDTH; i++) game.act('right');
  assert.equal(Math.max(...cellsOf(game.active).map(([x]) => x)), WIDTH - 1);
  assert.equal(game.act('right'), false);
  game.board[0][7] = 'J';
  const before = snapshot(game);
  assert.equal(game.act('left'), false);
  assert.deepEqual(snapshot(game), before);
});

test('clockwise and counterclockwise turns are reversible and leave the square fixed', () => {
  for (const kind of KINDS) {
    const game = withPiece(kind, 3, 6);
    const initial = { ...game.active };
    assert.equal(game.act('cw'), kind !== 'O');
    assert.equal(game.active.rotation, kind === 'O' ? 0 : 1);
    game.act('ccw');
    assert.deepEqual(game.active, initial);
    for (let i = 0; i < 4; i++) game.act('ccw');
    assert.deepEqual(game.active, initial);
  }
  const t = withPiece('T');
  t.act('cw');
  assert.deepEqual(new Set(cellsOf(t.active).map(String)), new Set(['5,1', '4,0', '4,1', '4,2']));
});

test('wall kicks work in both directions, including the two-column kick for the I', () => {
  for (const [kind, x] of [['T', -1], ['I', -2]]) {
    for (const [action, rotation] of [['cw', 2], ['ccw', 0]]) {
      const game = withPiece(kind, x, 6, 1);
      assert.equal(game.act(action), true);
      assert.deepEqual(game.active, { kind, x: 0, y: 6, rotation });
    }
  }
});

test('floor kicks lift the piece enough to turn without crossing the floor', () => {
  for (const [kind, x, y] of [['T', 2, 17], ['I', 4, 16]]) {
    const game = withPiece(kind, 3, 18);
    assert.equal(game.act('cw'), true);
    assert.deepEqual(game.active, { kind, x, y, rotation: 1 });
    assert.equal(game.landingY(), y);
  }
});

test('a piece surrounded by settled blocks cannot rotate through them', () => {
  const game = withPiece('T', 3, 8);
  for (const row of game.board.slice(4, 13)) row.fill('Z', 1, 8);
  for (const [x, y] of cellsOf(game.active)) game.board[y][x] = null;
  const before = snapshot(game);
  assert.equal(game.act('cw'), false);
  assert.equal(game.act('ccw'), false);
  assert.deepEqual(snapshot(game), before);
});

test('gravity accumulates elapsed time, and a successful soft drop restarts its interval', () => {
  const game = withPiece('O');
  const interval = game.fallInterval;
  assert.equal(interval, 800);
  assert.equal(game.advance(interval - 1), false);
  assert.equal(game.advance(1), true);
  assert.equal(game.active.y, 1);
  assert.equal(game.score, 0);
  game.advance(interval - 1);
  assert.equal(game.act('soft'), true);
  assert.equal(game.score, 1);
  assert.equal(game.active.y, 2);
  assert.equal(game.advance(interval - 1), false);
  game.advance(1 + interval * 2);
  assert.equal(game.active.y, 5);
  game.board[7][4] = 'J';
  assert.equal(game.act('soft'), false);
  assert.equal(game.score, 1);
});

test('unknown actions and invalid elapsed times leave the round alone', () => {
  const game = withPiece('Z');
  const before = snapshot(game);
  for (const dt of [0, -1, NaN, Infinity, -Infinity, '800', undefined]) {
    assert.equal(game.advance(dt), false);
  }
  assert.equal(game.act('unknown'), false);
  assert.deepEqual(snapshot(game), before);
});

test('hard drop locks exactly at the ghost, scores distance, and advances the preview', () => {
  const game = withPiece('O');
  game.board[14][4] = 'L';
  game.board[17][5] = 'I';
  const before = snapshot(game);
  assert.equal(game.landingY(), 12);
  assert.deepEqual(snapshot(game), before);
  assert.equal(game.act('hard'), true);
  assert.equal(game.score, 24);
  assert.equal(blocks(game), 6);
  for (const [x, y] of [[4, 12], [5, 12], [4, 13], [5, 13]]) assert.equal(game.board[y][x], 'O');
  assert.deepEqual(game.active, { kind: before.next, x: 3, y: 0, rotation: 0 });
});

test('gravity gives a full lock delay after touching the floor', () => {
  const game = withPiece('O', 3, HEIGHT - 3);
  game.advance(game.fallInterval + LOCK_DELAY - 1);
  assert.equal(game.active.y, HEIGHT - 2);
  assert.equal(blocks(game), 0);
  game.advance(1);
  assert.equal(blocks(game), 4);
  assert.equal(game.active.y, 0);
  assert.equal(game.score, 0);
});

test('one late tick matches unevenly spaced frames across multiple locks and spawns', () => {
  const late = new Game(seededRandom(55));
  const normal = new Game(seededRandom(55));
  let remaining = 60317;
  late.advance(remaining);
  const steps = [6, 499, 37, 1421, 203];
  for (let i = 0; remaining > 0; i++) {
    const step = Math.min(remaining, steps[i % steps.length]);
    normal.advance(step);
    remaining -= step;
  }
  assert.ok(blocks(late) >= 8);
  assert.equal(late.status, 'playing');
  assert.deepEqual(snapshot(late), snapshot(normal));
  for (const step of [1, 799, 500, 14001]) {
    assert.equal(late.advance(step), normal.advance(step));
    assert.deepEqual(snapshot(late), snapshot(normal));
  }
});

test('only the first fifteen successful grounded adjustments can renew the lock timer', () => {
  const game = withPiece('O', 3, 18);
  assert.equal(MAX_LOCK_RESETS, 15);
  for (let i = 0; i <= MAX_LOCK_RESETS; i++) {
    game.advance(LOCK_DELAY - 1);
    assert.equal(blocks(game), 0);
    assert.equal(game.act(i % 2 === 0 ? 'left' : 'right'), true);
  }
  game.advance(1);
  assert.equal(blocks(game), 4);
});

test('a successful grounded turn renews the timer while failed adjustments do not', () => {
  const turning = withPiece('T', 3, 18);
  turning.advance(LOCK_DELAY - 1);
  assert.equal(turning.act('cw'), true);
  turning.advance(LOCK_DELAY - 1);
  assert.equal(blocks(turning), 0);
  turning.advance(1);
  assert.equal(blocks(turning), 4);

  const blocked = withPiece('O', -1, 18);
  blocked.advance(LOCK_DELAY - 1);
  for (const action of ['left', 'cw', 'soft']) assert.equal(blocked.act(action), false);
  blocked.advance(1);
  assert.equal(blocks(blocked), 4);
});

test('sliding off a ledge allows the piece to fall again', () => {
  const game = withPiece('O', 3, 10);
  game.board[12][4] = 'I';
  game.advance(LOCK_DELAY - 1);
  game.act('right');
  game.advance(game.fallInterval);
  assert.equal(game.active.y, 11);
  assert.equal(blocks(game), 1);
});

for (const [count, points] of [[1, 100], [2, 300], [3, 500], [4, 800]]) {
  test(`clearing ${count} row(s) awards ${points} points and inserts empty rows at the top`, () => {
    const game = readyToClear(count);
    game.act('hard');
    assert.equal(game.score, points);
    assert.equal(game.lines, count);
    assert.equal(blocks(game), 4 - count);
    assert.equal(game.board.length, HEIGHT);
    assert.equal(new Set(game.board).size, HEIGHT);
    assert.ok(game.board.slice(0, count).every(row => row.every(cell => cell === null)));
  });
}

test('clearing separated rows preserves survivors in their original order', () => {
  const game = withPiece('I', 3, 16, 1);
  for (const y of [16, 18]) {
    game.board[y].fill('Z');
    game.board[y][5] = null;
  }
  game.board[15][1] = 'J';
  game.board[17][2] = 'T';
  game.board[19][3] = 'L';
  game.act('hard');
  assert.equal(game.lines, 2);
  assert.equal(game.board[17][1], 'J');
  assert.equal(game.board[18][2], 'T');
  assert.equal(game.board[19][3], 'L');
  assert.equal(blocks(game), 5);
});

test('a clear uses the level before the clear, then speeds up every ten lines', () => {
  const game = readyToClear(2);
  game.lines = 9;
  game.act('hard');
  assert.deepEqual([game.lines, game.level, game.score, game.fallInterval], [11, 2, 300, 680]);
  const later = readyToClear(1);
  later.lines = 10;
  later.act('hard');
  assert.equal(later.score, 200);
  later.lines = 1000;
  assert.equal(later.fallInterval, 80);
});

test('consecutive four-row clears stack both bonuses at the pre-clear level', () => {
  const game = readyToClear(4);
  game.lines = 6;
  game.act('hard');
  assert.deepEqual(game.lastClear, { count: 4, combo: 1, backToBack: false, points: 800 });
  assert.equal(game.level, 2);

  game.act('hold');
  game.act('pause');
  game.advance(9000);
  game.act('pause');
  readyToClear(4, game);
  game.active.y -= 2;
  game.act('soft');
  game.act('hard');
  assert.deepEqual(game.lastClear, { count: 4, combo: 2, backToBack: true, points: 2500 });
  assert.equal(game.score, 800 + 1 + 2 + 2500);
  assert.equal(game.lines, 14);
});

test('an empty lock breaks the combo, and a smaller clear breaks the four-row bonus', () => {
  const game = readyToClear(4);
  game.act('hard');
  game.active = { kind: 'O', x: -1, y: HEIGHT - 2, rotation: 0 };
  game.act('hard');
  assert.equal(game.lastClear, null);
  assert.equal(game.score, 800);
  readyToClear(4, game).act('hard');
  assert.deepEqual(game.lastClear, { count: 4, combo: 1, backToBack: true, points: 1200 });
  readyToClear(1, game).act('hard');
  assert.deepEqual(game.lastClear, { count: 1, combo: 2, backToBack: false, points: 150 });
  readyToClear(4, game).act('hard');
  assert.deepEqual(game.lastClear, { count: 4, combo: 3, backToBack: false, points: 900 });
  assert.equal(game.score, 3050);
});

test('hold is limited to one use per lock and swapping resets position without consuming the preview', () => {
  const game = new Game(seededRandom(11));
  const original = game.active.kind;
  const firstNext = game.next;
  game.act('left');
  game.act('soft');
  game.act('cw');
  assert.equal(game.act('hold'), true);
  assert.deepEqual(game.active, { kind: firstNext, rotation: 0, x: 3, y: 0 });
  assert.equal(game.held, original);
  assert.equal(game.canHold, false);
  const used = snapshot(game);
  assert.equal(game.act('hold'), false);
  assert.deepEqual(snapshot(game), used);
  game.act('hard');
  assert.equal(game.canHold, true);
  const outgoing = game.active.kind;
  const preview = game.next;
  game.act('hold');
  assert.equal(game.held, outgoing);
  assert.equal(game.next, preview);
  assert.deepEqual(game.active, { kind: original, rotation: 0, x: 3, y: 0 });
  assert.equal(game.canHold, false);
});

test('pausing freezes a partial lock delay, inputs, and the piece supply until resumed', () => {
  const game = withPiece('O', 3, 18);
  game.advance(375);
  game.act('pause');
  const paused = snapshot(game);
  assert.equal(game.status, 'paused');
  assert.equal(game.advance(60000), false);
  for (const action of ['left', 'right', 'cw', 'ccw', 'hold', 'soft', 'hard']) {
    assert.equal(game.act(action), false);
  }
  assert.deepEqual(snapshot(game), paused);
  game.act('pause');
  game.advance(124);
  assert.equal(blocks(game), 0);
  game.advance(1);
  assert.equal(blocks(game), 4);
});

test('clears resolve before checking the spawn area for the next piece', () => {
  const game = withPiece('I', 3, -1);
  game.board[0].fill('J');
  game.board[0].fill(null, 3, 7);
  game.board[1][3] = 'I';
  game.next = 'O';
  game.act('hard');
  assert.equal(game.status, 'playing');
  assert.equal(game.lines, 1);
  assert.equal(game.active.kind, 'O');
});

test('a blocked spawn after a lock or a hold ends the round without overwriting the pile', () => {
  for (const action of ['hard', 'hold']) {
    const game = withPiece('O', 3, 18);
    game.next = 'T';
    game.board[0][4] = 'Z';
    game.act(action);
    assert.equal(game.board[0][4], 'Z');
    assert.equal(blocks(game), action === 'hard' ? 5 : 1);
    assert.equal(game.status, 'over');
    assert.equal(game.active, null);
    assert.equal(game.landingY(), null);
    const final = snapshot(game);
    assert.equal(game.advance(100000), false);
    for (const move of ['pause', 'left', 'soft', 'hold', 'hard']) assert.equal(game.act(move), false);
    assert.deepEqual(snapshot(game), final);
  }
});

test('locking across the ceiling ends the round without writing a partial piece', () => {
  const game = withPiece('T', 3, -1);
  game.board[1][3] = 'L';
  assert.equal(game.landingY(), -1);
  game.advance(LOCK_DELAY);
  assert.equal(game.status, 'over');
  assert.equal(blocks(game), 1);
  assert.equal(game.board[1][3], 'L');
});

test('a Dig seed repeats the deal and eight layers with a different opening in each pair', () => {
  const courses = new Set();
  for (const seed of [0, 1, 852, 0xffffffff]) {
    const game = new Game(seededRandom(seed), 'dig');
    assert.deepEqual(snapshot(game), snapshot(new Game(seededRandom(seed), 'dig')));
    assert.equal(game.layersLeft, 8);
    assert.equal(new Set(game.board).size, HEIGHT);
    assert.ok(game.board.slice(0, -DIG_LAYERS).flat().every(cell => cell === null));
    const holes = [];
    for (const row of game.board.slice(-DIG_LAYERS)) {
      assert.equal(row.length, WIDTH);
      assert.equal(row.filter(cell => cell === STONE).length, WIDTH - 1);
      holes.push(row.indexOf(null));
      assert.notEqual(holes.at(-1), -1);
    }
    for (let i = 0; i < holes.length; i += 2) {
      assert.equal(holes[i], holes[i + 1]);
      if (i > 0) assert.notEqual(holes[i], holes[i - 1]);
    }
    courses.add(holes.join(','));
  }
  assert.ok(courses.size > 1);
});

test('Dig tracks stone separately from lines and lets the piece land in a buried opening', () => {
  const game = new Game(seededRandom(852), 'dig');
  const surface = HEIGHT - DIG_LAYERS;
  game.board[surface - 1].fill('J');
  game.board[surface - 1].fill(null, 3, 7);
  game.active = { kind: 'I', x: 3, y: surface - 2, rotation: 0 };
  game.act('hard');
  assert.equal(game.lines, 1);
  assert.equal(game.layersLeft, DIG_LAYERS);

  const hole = game.board[surface].indexOf(null);
  game.active = { kind: 'I', x: hole - 2, y: 0, rotation: 1 };
  assert.equal(game.landingY(), surface - 2);
  game.act('hard');
  assert.equal(game.lines, 3);
  assert.equal(game.layersLeft, DIG_LAYERS - 2);
  assert.equal(game.status, 'playing');
  assert.equal(game.board[surface + 1][hole], 'I');
});

test('a Sprint finishes on the goal lock before a blocked spawn and discards excess frame time', () => {
  const game = readyToClear(1, new Game(seededRandom(37), 'sprint'));
  game.lines = SPRINT_LINES - 1;
  game.board[0][4] = 'Z'; // After the clear this would block the next O on row one.
  game.next = 'O';
  const queue = [game.next, ...game.following];
  game.advance(LOCK_DELAY - 1);
  assert.equal(game.status, 'playing');
  game.advance(60000);
  assert.equal(game.status, 'won');
  assert.equal(game.active, null);
  assert.equal(game.landingY(), null);
  assert.equal(game.lines, 40);
  assert.equal(game.score, 400);
  assert.equal(game.elapsedMs, LOCK_DELAY);
  assert.equal(game.board[1][4], 'Z');
  assert.deepEqual([game.next, ...game.following], queue);
  const final = snapshot(game);
  for (const action of ['pause', 'hold', 'left', 'right', 'cw', 'ccw', 'soft', 'hard']) {
    assert.equal(game.act(action), false);
  }
  assert.equal(game.advance(800), false);
  assert.deepEqual(snapshot(game), final);
});

test('the whole winning clear counts when Sprint crosses 40, and Endless keeps going', () => {
  for (const mode of ['sprint', 'endless']) {
    const game = readyToClear(4, new Game(seededRandom(37), mode));
    game.lines = 38;
    game.act('hard');
    assert.equal(game.lines, 42);
    assert.equal(game.level, 5);
    assert.equal(game.score, 3200);
    assert.equal(game.status, mode === 'sprint' ? 'won' : 'playing');
  }
});

test('the last Dig layer can clear together with an ordinary row', () => {
  const game = new Game(seededRandom(852), 'dig');
  for (const row of game.board) row.fill(null);
  readyToClear(2, game);
  game.board[HEIGHT - 1].fill(STONE);
  game.board[HEIGHT - 1][5] = null;
  assert.equal(game.layersLeft, 1);
  game.advance(125);
  game.act('hard');
  assert.equal(game.status, 'won');
  assert.equal(game.elapsedMs, 125);
  assert.equal(game.lines, 2);
  assert.equal(game.layersLeft, 0);
  assert.equal(game.score, 300);
  assert.equal(blocks(game), 2);
});

test('challenge clocks stop at a ceiling lock and paused time never enters the result', () => {
  for (const mode of ['sprint', 'dig']) {
    const game = new Game(seededRandom(34), mode);
    game.active = { kind: 'T', x: 3, y: -1, rotation: 0 };
    game.board[1][3] = 'L';
    game.advance(250);
    game.act('pause');
    game.advance(60000);
    game.act('pause');
    game.advance(60000);
    assert.equal(game.status, 'over');
    assert.equal(game.elapsedMs, LOCK_DELAY);
    assert.equal(game.score, 0);
    assert.equal(game.advance(10000), false);
    assert.equal(game.elapsedMs, LOCK_DELAY);
  }
});

test('seeded rounds preserve board bounds, non-overlap, and block counts across drops', () => {
  const moves = ['left', 'right', 'cw', 'ccw', 'soft', 'hold'];
  for (let seed = 0; seed < 20; seed++) {
    const game = new Game(seededRandom(seed));
    const choices = seededRandom(seed + 1000);
    for (let turn = 0; turn < 100 && game.status === 'playing'; turn++) {
      for (let i = 0; i < 8; i++) game.act(moves[Math.floor(choices() * moves.length)]);
      if (!game.active) break;
      const landing = game.landingY();
      assert.ok(landing >= game.active.y);
      const atRest = cellsOf({ ...game.active, y: landing });
      for (const [x, y] of [...cellsOf(game.active), ...atRest]) {
        assert.ok(x >= 0 && x < WIDTH && y < HEIGHT);
        if (y >= 0) assert.equal(game.board[y][x], null);
      }
      assert.ok(atRest.some(([x, y]) => y + 1 === HEIGHT || (y + 1 >= 0 && game.board[y + 1][x] !== null)));
      const before = blocks(game);
      const lines = game.lines;
      game.act('hard');
      const placed = atRest.every(([, y]) => y >= 0) ? 4 : 0;
      assert.equal(blocks(game), before + placed - WIDTH * (game.lines - lines));
      assert.ok(game.board.every(row => row.length === WIDTH && row.includes(null)));
    }
  }
});

test('Practice waits for a hard drop even after the piece touches down', () => {
  const game = new Game(seededRandom(852), 'practice');
  const initial = snapshot(game);
  assert.equal(game.act('undo'), false);
  assert.equal(game.advance(60000), false);
  assert.deepEqual(snapshot(game), initial);
  const distance = game.landingY() - game.active.y;
  for (let i = 0; i < distance; i++) assert.equal(game.act('soft'), true);
  assert.equal(game.act('soft'), false);
  assert.equal(game.advance(60000), false);
  assert.equal(blocks(game), 0);
  assert.equal(game.score, distance);
  assert.equal(game.act('hard'), true);
  assert.equal(blocks(game), 4);
  assert.equal(game.elapsedMs, 0);
  assert.equal(game.act('undo'), true);
  assert.deepEqual(snapshot(game), initial);
});

test('undo returns both the committed draw and a later empty hold in their original order', () => {
  let randomCalls = 0;
  const random = seededRandom(10);
  const game = new Game(() => { randomCalls++; return random(); }, 'practice');
  const reference = new Game(seededRandom(10), 'practice');
  const start = snapshot(game);
  game.act('soft');
  game.act('hard');
  game.act('hold');
  const calls = randomCalls;
  assert.equal(game.act('undo'), true);
  assert.deepEqual(snapshot(game), start);
  // Branch by using the empty hold before the first lock this time.
  for (const action of ['hold', 'left', 'hard', 'hold']) {
    game.act(action);
    reference.act(action);
    assert.deepEqual(snapshot(game), snapshot(reference));
  }
  assert.equal(randomCalls, calls);
  for (let i = 0; i < 10; i++) {
    const side = i % 2 === 0 ? 'left' : 'right';
    for (const round of [game, reference]) {
      for (let n = 0; n < WIDTH; n++) round.act(side);
      round.act('hard');
    }
    assert.deepEqual(snapshot(game), snapshot(reference));
  }
  assert.ok(randomCalls > calls);
});

test('undo recovers combo scoring, the previous four-row clear, and all recap counters', () => {
  const game = new Game(seededRandom(852), 'practice');
  readyToClear(4, game).act('hard');
  const afterQuad = snapshot(game);
  readyToClear(1, game).act('hard');
  assert.equal(game.stats.bestCombo, 2);
  assert.equal(game.act('undo'), true);
  assert.deepEqual(snapshot(game), afterQuad);

  game.active = { kind: 'O', x: -1, y: HEIGHT - 2, rotation: 0 };
  game.act('hard');
  const afterEmptyLock = snapshot(game);
  assert.equal(game.lastClear, null);
  readyToClear(1, game).act('hard');
  game.act('undo');
  assert.deepEqual(snapshot(game), afterEmptyLock);
  readyToClear(4, game).act('hard');
  assert.deepEqual(game.lastClear, { count: 4, combo: 1, backToBack: true, points: 1200 });
  assert.deepEqual(game.stats, { pieces: 3, bestCombo: 1, clears: [0, 0, 0, 2] });
});

test('a blocked hold in Practice can be rewound to the start of that turn', () => {
  const game = new Game(seededRandom(27), 'practice');
  game.active = { kind: 'O', x: -1, y: HEIGHT - 2, rotation: 0 };
  game.board[0][4] = 'L';
  game.next = 'I';
  game.following[0] = 'O';
  game.act('hard'); // The I spawns on row one. The incoming O needs row zero.
  const beforeHold = snapshot(game);
  game.act('hold');
  assert.equal(game.status, 'over');
  assert.equal(game.undosLeft, 2);
  assert.equal(game.stats.pieces, 1);
  assert.equal(game.act('undo'), true);
  assert.equal(game.undosLeft, 1);
  assert.deepEqual(snapshot(game), beforeHold);
  assert.equal(game.act('hold'), true);
  assert.equal(game.status, 'over');
});

test('undo respects a Practice pause and is unavailable in every competitive mode', () => {
  for (const mode of ['endless', 'sprint', 'dig', 'surge', 'practice']) {
    const game = new Game(seededRandom(852), mode);
    game.act('hard');
    game.act('pause');
    const paused = snapshot(game);
    assert.equal(game.act('undo'), false);
    assert.deepEqual(snapshot(game), paused);
    game.act('pause');
    assert.equal(game.act('undo'), mode === 'practice');
  }
});

test('the recap counts locks and clear sizes and preserves the longest combo after a miss', () => {
  const game = new Game(seededRandom(852));
  game.act('hold');
  assert.deepEqual(game.stats, { pieces: 0, bestCombo: 0, clears: [0, 0, 0, 0] });
  for (const count of [1, 2, 3, 4]) {
    game.board.forEach(row => row.fill(null));
    readyToClear(count, game);
    game.advance(LOCK_DELAY);
  }
  game.act('hard');
  readyToClear(2, game).act('hard');
  assert.deepEqual(game.stats, { pieces: 6, bestCombo: 4, clears: [1, 2, 1, 1] });
  assert.equal(game.lastClear.combo, 1);
  assert.equal(game.lines, 12);
  game.active = { kind: 'T', x: 3, y: -1, rotation: 0 };
  game.board[1][3] = 'L';
  game.act('hard');
  assert.equal(game.status, 'over');
  assert.equal(game.stats.pieces, 6);
});
