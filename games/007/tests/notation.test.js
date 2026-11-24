"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cube = require("../js/cube.js");
const { parse, formatMove, PRESETS, MAX_TURNS } = require("../js/notation.js");

test("the editor reads compact or spaced notation, typographic primes and nested repeated groups", () => {
  assert.deepEqual(parse("  \t\n"), []);
  assert.deepEqual(parse("R2UF′\nD’ L'\tB"), ["R2", "U", "F'", "D'", "L'", "B"]);
  const group = ["R", "U'", "R", "U'", "F2"];
  assert.deepEqual(parse("((RU′)2 F2)2(B)"), [...group, ...group, "B"]);
  assert.deepEqual(parse(cube.ALL_MOVES.map(formatMove).join("")), cube.ALL_MOVES);
});

test("bad notation identifies the offending character, including unmatched and empty groups", () => {
  for (const [source, position] of [
    ["R X", 3], ["R2′", 3], ["r", 1], ["(F2", 1], ["U)", 2], ["D( )", 2],
    ["(U)0", 4], ["(U)02", 4], ["R3", 2], ["R′′", 3], ["(R) 2", 5], ["F\n,L", 3]
  ]) {
    assert.throws(() => parse(source), error => error instanceof SyntaxError &&
      error.position === position && error.message.includes("Character " + position), source);
  }
  assert.throws(() => parse(null), TypeError);
});

test("commutators and conjugates invert whole operands and compose with groups, primes and repeats", () => {
  assert.deepEqual(parse("F\n[L,U]"), ["F", "L", "U", "L'", "U'"]);
  assert.deepEqual(parse("[ RU′ : F2 ]"), ["R", "U'", "F2", "U", "R'"]);
  assert.deepEqual(parse("[R U,F′ L]"), ["R", "U", "F'", "L", "U'", "R'", "L'", "F"]);
  const inner = ["R", "U", "R'", "U'"];
  const nested = [...inner, "F2", ...cube.inverseSequence(inner)];
  assert.deepEqual(parse("[[R,U]:F2]2"), [...nested, ...nested]);
  assert.deepEqual(parse("([R:(F L)2] U)2"), parse("(R F L F L R′ U)2"));
});

test("bracket errors point to extra delimiters, missing operands, mismatches and unclosed groups", () => {
  for (const [text, position] of [
    ["[R]", 3], ["[ R", 1], ["[R:U", 1], ["[,U]", 2], ["[R, ]", 5], ["[R:U,L]", 5],
    ["[R,,U]", 4], ["[R,U:F]", 5], ["[R,U)", 5], ["([R,U]", 1], ["[R,(U]", 6],
    ["[R:U]0", 6], ["F [R,U]02", 8], ["U]", 2], ["R:F", 2], ["[R,U] 3", 7]
  ]) {
    assert.throws(() => parse(text), e => e instanceof SyntaxError && e.position === position, text);
  }
});

test("bracket expansion enforces the same depth and turn budget before allocating any repeat", () => {
  assert.equal(parse("[R,U]64").length, MAX_TURNS);
  assert.equal(parse("[R:(U)254]").length, MAX_TURNS);
  assert.equal(parse("(".repeat(7) + "[R:U]" + ")".repeat(7)).length, 3);
  for (const text of ["[R,U]65", "[(R)128,U]", "[R:(U)255]", "[R:U]" + "9".repeat(300), "U[R,U]64"]) {
    assert.throws(() => parse(text), /256 turns/, text);
  }
  assert.throws(() => parse("(".repeat(8) + "[R,U]" + ")".repeat(8)), /nested/);
});

test("notation accepts the exact expansion and nesting limits and rejects oversized input before expansion", () => {
  assert.deepEqual(parse("((R)16)16"), Array(MAX_TURNS).fill("R"));
  assert.deepEqual(parse("(".repeat(8) + "B" + ")".repeat(8)), ["B"]);
  for (const text of ["((R)16)16U", "U((R)16)16", "(F)" + "9".repeat(400), "R".repeat(MAX_TURNS + 1)]) {
    assert.throws(() => parse(text), /256 turns/);
  }
  assert.throws(() => parse("(".repeat(9) + "B" + ")".repeat(9)), /nested/);
  assert.throws(() => parse(" ".repeat(2049)), /2048 characters/);
});

test("each example can be played and inverted from a mixed position without changing the source moves", () => {
  const start = cube.apply(cube.create(), cube.STARTER);
  for (const preset of PRESETS) {
    const moves = parse(preset.text), first = moves.slice(), inverse = cube.inverseSequence(moves);
    assert.deepEqual(cube.apply(cube.clone(start), [...moves, ...inverse]), start);
    assert.deepEqual(cube.inverseSequence(inverse), first);
    assert.deepEqual(moves, first);
  }
  assert.deepEqual(cube.apply(cube.clone(start), parse("(" + PRESETS[0].text + ")6")), start);
  const checkerboard = cube.facelets(cube.apply(cube.create(), parse(PRESETS[1].text)));
  for (const [face, stickers] of Object.entries(checkerboard)) {
    assert.deepEqual(stickers.filter((_, i) => i % 2 === 0), Array(5).fill(face));
    assert.equal(new Set(stickers.filter((_, i) => i % 2)).size, 1);
    assert.notEqual(stickers[1], face);
  }
});
