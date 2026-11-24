"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cube = require("../js/cube.js");
const { Session, SPEEDS } = require("../js/session.js");
const { close, seeded } = require("./helpers.js");

test("the starter mix is playable immediately and reset creates a fresh solved cube", () => {
  const s = new Session();
  assert.deepEqual(s.history, cube.STARTER);
  assert.notEqual(s.history, cube.STARTER);
  assert.deepEqual(s.pieces, cube.apply(cube.create(), cube.STARTER));
  assert.equal(s.mode, "idle");
  assert.equal(s.solved, false);
  s.reset();
  assert.deepEqual(s.pieces, cube.create());
  assert.deepEqual(s.history, []);
  assert.equal(s.solved, true);
  assert.equal(s.requestSolve(), null);
  assert.equal(s.undo(), false);
  assert.equal(s.tick(500), false);
});

test("a turn eases through fractional angles and commits its integer state at the boundary", () => {
  const s = new Session([]);
  s.manual("F'");
  s.tick(132.5);
  close(s.active.angle, Math.PI / 2 * 0.15625);
  assert.deepEqual(s.pieces, cube.create());
  assert.deepEqual(s.history, []);
  s.tick(132.5);
  close(s.active.progress, 0.5);
  close(s.active.angle, Math.PI / 4);
  s.tick(265);
  assert.deepEqual(s.pieces, cube.turn(cube.create(), "F'"));
  assert.deepEqual(s.history, ["F'"]);
  assert.equal(s.active, null);
  assert.equal(s.mode, "idle");
});

test("rapid manual input is ordered, bounded and carried across a late frame", () => {
  const s = new Session([]);
  const moves = cube.scramble(16, seeded(32));
  for (const m of moves) assert.equal(s.manual(m), true);
  assert.equal(s.manual("U"), false);
  assert.equal(s.scramble(), false);
  assert.equal(s.requestSolve(), null);
  assert.equal(s.undo(), false);
  s.tick(900);
  assert.ok(s.cursor >= 1);
  assert.ok(s.active.progress > 0);
  assert.ok(s.manual("U"));
  s.tick(20000);
  assert.deepEqual(s.history, [...moves, "U"]);
  assert.deepEqual(s.pieces, cube.apply(cube.create(), s.history));
  assert.equal(s.active, null);
});

test("the slider changes the remaining duration without moving the current angle", () => {
  const s = new Session([]);
  s.manual("D2");
  s.tick(530 * 1.25 / 2);
  close(s.active.progress, 0.5);
  const angle = s.active.angle;
  for (const v of SPEEDS) { s.setSpeed(v); assert.equal(s.active.angle, angle); }
  assert.equal(s.speed, 2);
  assert.throws(() => s.setSpeed(0), RangeError);
  assert.equal(s.tick(0), false);
  assert.equal(s.tick(-20), false);
  assert.equal(s.tick(NaN), false);
  s.tick(530 * 1.25 / 4);
  assert.equal(s.active, null);
  assert.deepEqual(s.history, ["D2"]);
});

test("undo animates one inverse and removes one recorded turn, including a half turn", () => {
  const s = new Session(["B'", "L2"]);
  assert.ok(s.undo());
  assert.equal(s.active.move, "L2");
  assert.equal(s.manual("F"), false);
  assert.equal(s.history.length, 2);
  s.tick(1000);
  assert.deepEqual(s.pieces, cube.turn(cube.create(), "B'"));
  assert.ok(s.undo());
  assert.equal(s.active.move, "B");
  s.tick(1000);
  assert.equal(s.solved, true);
  assert.deepEqual(s.history, []);
});

test("scramble plays 20 new turns from solved and reset cancels an in-flight layer", () => {
  const s = new Session();
  s.setSpeed(1.5);
  const expected = cube.scramble(20, seeded(73));
  assert.ok(s.scramble(seeded(73)));
  assert.equal(s.mode, "scrambling");
  assert.deepEqual(s.history, []);
  assert.deepEqual(s.pieces, cube.create());
  assert.deepEqual(s.plan, expected);
  assert.equal(s.requestSolve(), null);
  s.tick(4000);
  assert.deepEqual(s.history, expected);
  assert.deepEqual(s.pieces, cube.apply(cube.create(), expected));
  assert.equal(s.mode, "idle");
  s.manual("F2");
  s.tick(150);
  s.reset();
  s.tick(2000);
  assert.deepEqual(s.pieces, cube.create());
  assert.equal(s.speed, 1.5);
  assert.equal(s.solution, null);
});

test("stale solver replies and canceled plans cannot overwrite a later puzzle", () => {
  const s = new Session(["U"]);
  const old = s.requestSolve();
  assert.deepEqual(old.state, cube.coordinates(cube.turn(cube.create(), "U")));
  assert.equal(s.cancelPlanning(old.ticket - 1), false);
  assert.equal(s.requestSolve(), null);
  assert.equal(s.manual("U'"), false);
  assert.equal(s.cancelPlanning(old.ticket), true);
  const second = s.requestSolve();
  assert.equal(s.receiveSolution(old.ticket, ["U'"]), false);
  s.reset();
  assert.equal(s.receiveSolution(second.ticket, ["U'"]), false);
  assert.equal(s.mode, "idle");
  assert.equal(s.solved, true);
});

test("a route is validated on a copy before starting, and redundant neighboring turns combine", () => {
  const s = new Session(["R'"]), before = cube.clone(s.pieces), { ticket } = s.requestSolve();
  for (const bad of [[], ["U"], ["X"]]) assert.throws(() => s.receiveSolution(ticket, bad));
  assert.deepEqual(s.pieces, before);
  assert.equal(s.mode, "planning");
  assert.ok(s.receiveSolution(ticket, ["R'", "R2"]));
  assert.deepEqual(s.solution, ["R"]);
  s.tick(1000);
  assert.ok(s.solved);
  assert.equal(s.mode, "idle");
  assert.deepEqual(s.history, ["R'", "R"]);
});

test("pause freezes mid-turn, next step finishes exactly one move, and resume solves", () => {
  const s = new Session(["R", "U", "F2"]);
  const { ticket } = s.requestSolve();
  s.receiveSolution(ticket, ["F2", "U'", "R'"]);
  assert.equal(s.stepOnce(), false);
  s.tick(100);
  assert.ok(s.togglePause());
  const frozen = { ...s.active };
  assert.equal(s.tick(10000), false);
  assert.deepEqual(s.active, frozen);
  assert.ok(s.stepOnce());
  s.tick(10000);
  assert.equal(s.cursor, 1);
  assert.equal(s.active.progress, 0);
  assert.equal(s.active.move, "U'");
  assert.equal(s.paused, true);
  assert.equal(s.history.length, 4);
  s.togglePause();
  s.tick(10000);
  assert.equal(s.cursor, 3);
  assert.equal(s.mode, "idle");
  assert.ok(s.solved);
  assert.equal(s.stepOnce(), false);
  assert.equal(s.togglePause(), false);
  s.undo();
  s.tick(1000);
  assert.equal(s.solved, false);
  assert.equal(s.solution, null);
});

test("an algorithm owns its sequence, validates it atomically and uses the current cube as its start", () => {
  const s = new Session(), original = cube.clone(s.pieces);
  assert.equal(s.playAlgorithm([]), false);
  assert.equal(s.playAlgorithm("RU"), false);
  assert.throws(() => s.playAlgorithm(["F", "u"]), RangeError);
  assert.deepEqual(s.pieces, original);
  assert.equal(s.source, "Starter mix");
  assert.deepEqual(s.history, cube.STARTER);
  const draft = ["R", "R", "B2"];
  assert.ok(s.playAlgorithm(draft));
  draft.fill("F");
  assert.equal(s.playAlgorithm(["U"]), false);
  assert.equal(s.scramble(), false);
  assert.equal(s.undo(), false);
  assert.equal(s.requestSolve(), null);
  assert.equal(s.manual("L"), false);
  s.tick(10000);
  assert.equal(s.mode, "idle");
  assert.deepEqual(s.plan, ["R", "R", "B2"]);
  assert.deepEqual(s.history, [...cube.STARTER, "R", "R", "B2"]);
  assert.deepEqual(s.pieces, cube.apply(original, ["R", "R", "B2"]));
});

test("scrubbing any solution or algorithm reconstructs the exact turn boundary in both directions", () => {
  for (const kind of ["algorithm", "solving"]) {
    const s = new Session(), moves = cube.inverseSequence(cube.STARTER);
    if (kind === "algorithm") s.playAlgorithm(moves);
    else s.receiveSolution(s.requestSolve().ticket, moves);
    s.tick(185);
    assert.ok(s.active.progress > 0);
    const before = { ...s.active };
    for (const invalid of [-1, moves.length + 1, 1.5, NaN, "2"]) assert.equal(s.seek(invalid), false);
    assert.deepEqual(s.active, before);
    for (const target of [0, moves.length, 3, 7, 1, 1, 0, moves.length]) {
      assert.ok(s.seek(target));
      const expected = [...cube.STARTER, ...moves.slice(0, target)];
      assert.deepEqual(s.history, expected);
      assert.deepEqual(s.pieces, cube.apply(cube.create(), expected));
      assert.equal(s.solved, cube.isSolved(s.pieces));
      if (target === moves.length) {
        assert.equal(s.mode, "idle");
        assert.equal(s.active, null);
      } else {
        assert.equal(s.mode, kind);
        assert.ok(s.paused);
        assert.equal(s.active.move, moves[target]);
        assert.equal(s.active.angle, 0);
      }
    }
    assert.ok(s.seek(2));
    assert.ok(s.stepOnce());
    s.tick(10000);
    assert.equal(s.cursor, 3);
    assert.ok(s.paused);
    s.togglePause();
    s.tick(10000);
    assert.ok(s.solved);
    assert.deepEqual(s.history, [...cube.STARTER, ...moves]);
  }
});

test("keeping a partial playback position branches at the last commit and provides a valid solver history", () => {
  const s = new Session(["F2"]);
  s.playAlgorithm(["R", "D2", "B'"]);
  s.tick(730);
  assert.equal(s.cursor, 1);
  assert.ok(s.active.progress > 0);
  assert.ok(s.endPlayback());
  assert.equal(s.active, null);
  assert.equal(s.mode, "idle");
  assert.equal(s.seek(0), false);
  assert.equal(s.endPlayback(), false);
  assert.deepEqual(s.history, ["F2", "R"]);
  assert.ok(s.manual("L'"));
  s.tick(800);
  const request = s.requestSolve();
  assert.ok(s.receiveSolution(request.ticket, cube.inverseSequence(s.history)));
  s.tick(10000);
  assert.ok(s.solved);
  assert.ok(s.seek(0));
  s.reset();
  assert.equal(s.seek(1), false);
  assert.equal(s.playing, false);
  assert.deepEqual(s.history, []);
});

test("free play and a new solver request retire a finished review, and a malformed reply remains recoverable", () => {
  for (const action of ["manual", "undo", "scramble", "requestSolve"]) {
    const s = new Session([]);
    s.playAlgorithm(["F'"]);
    s.tick(1000);
    assert.ok(s[action](...(action === "manual" ? ["D"] : [])));
    assert.equal(s.seek(0), false);
    if (action === "requestSolve") {
      for (const route of ["F", null, [undefined]]) assert.throws(() => s.receiveSolution(s.ticket, route));
      assert.deepEqual(s.history, ["F'"]);
      assert.equal(s.mode, "planning");
      assert.ok(s.receiveSolution(s.ticket, ["F"]));
    }
  }
});

test("failed loads and invalid scramble samples preserve the puzzle, history and pending solver ticket", () => {
  const s = new Session(), before = cube.clone(s.pieces), request = s.requestSolve();
  for (const invalid of ["RU", ["R", "bad"]]) assert.throws(() => s.load(invalid, "Mix"));
  assert.equal(s.mode, "planning");
  assert.ok(s.cancelPlanning(request.ticket));
  for (const invalid of [-0.1, 1, NaN, Infinity, "0"]) {
    let calls = 0;
    assert.throws(() => s.scramble(() => ++calls === 4 ? invalid : 0.5), RangeError);
    assert.deepEqual(s.pieces, before);
    assert.deepEqual(s.history, cube.STARTER);
    assert.equal(s.source, "Starter mix");
  }
});

test("fractional frame intervals commit exactly on quarter- and half-turn boundaries at every speed", () => {
  for (const speed of SPEEDS) {
    for (const divisions of [6, 10, 30, 60, 120]) {
      const s = new Session([]);
      s.setSpeed(speed);
      s.playAlgorithm(["F", "U2", "B'"]);
      for (const [index, base] of [530, 662.5].entries()) {
        for (let i = 0; i < divisions; i++) s.tick(base / speed / divisions);
        assert.equal(s.cursor, index + 1);
        assert.equal(s.active.progress, 0);
      }
      s.tick(530 / speed - 0.001);
      assert.equal(s.cursor, 2);
      s.tick(0.001);
      assert.equal(s.mode, "idle");
      assert.deepEqual(s.history, ["F", "U2", "B'"]);
    }
  }
});
