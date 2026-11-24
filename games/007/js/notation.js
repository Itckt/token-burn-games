"use strict";

var TwistNotation = (function (cube) {
  const MAX_TURNS = 256, MAX_DEPTH = 8, MAX_CHARS = 2048;
  const PRESETS = [
    { name: "Corner loop", text: "R U R′ U′", tip: "Six passes return every sticker to its starting place." },
    { name: "Checkerboard", text: "R2 L2 U2 D2 F2 B2", tip: "Start from solved for a checkerboard on all six faces." },
    { name: "Kowloon shuttle", text: "(R U2 R′ L′ U2 L)2", tip: "Switch hands at each half turn on the up face." },
    { name: "Three corners", text: "[R′ D′ R, U]", tip: "Follow the three corners that change places." }
  ];
  const formatMove = move => move.replace("'", "′");
  function moveName(move) {
    const { face, turns } = cube.describe(move);
    const direction = turns === 2 ? "half turn" : turns < 0 ? "counterclockwise" : "clockwise";
    return cube.FACE[face].name + " face, " + direction;
  }

  // Groups expand as they are read. Check the size before each expansion,
  // so a short nested expression cannot allocate an enormous move list.
  function parse(text) {
    if (typeof text !== "string") throw new TypeError("Enter a sequence of turns.");
    function fail(at, message) {
      const error = new SyntaxError("Character " + (at + 1) + " — " + message);
      error.position = at + 1;
      throw error;
    }
    if (text.length > MAX_CHARS) fail(MAX_CHARS, "use at most " + MAX_CHARS + " characters.");
    let index = 0;

    function requireCapacity(count, at) {
      if (count > MAX_TURNS) fail(at, "the expanded sequence exceeds " + MAX_TURNS + " turns.");
    }
    function appendGroup(moves, group, at) {
      const digitsAt = index;
      while (index < text.length && /[0-9]/.test(text[index])) index++;
      const digits = text.slice(digitsAt, index);
      if (digits.startsWith("0")) fail(digitsAt, "use a positive repeat count without leading zeros.");
      const repeats = digits ? Number(digits) : 1;
      requireCapacity(moves.length + group.length * repeats, at);
      for (let repeat = 0; repeat < repeats; repeat++) moves.push(...group);
    }
    function readParen(at, depth) {
      const group = readSequence(depth, ")");
      if (index === text.length) fail(at, "close this group with a right parenthesis.");
      if (!group.length) fail(at, "add a turn inside this group.");
      index++;
      return group;
    }
    function readBracket(at, depth) {
      const left = readSequence(depth, ",:]");
      const separator = text[index];
      if (index === text.length) fail(at, "close this expression with a right bracket.");
      if (!left.length) fail(index, "add a turn before the separator.");
      if (separator === "]") fail(index, "separate the two parts with a comma or colon.");
      index++;
      const right = readSequence(depth, "]");
      if (index === text.length) fail(at, "close this expression with a right bracket.");
      if (!right.length) fail(index, "add a turn after the separator.");
      index++;
      const commutator = separator === ",";
      requireCapacity(2 * left.length + (commutator ? 2 : 1) * right.length, at);
      const expanded = [...left, ...right, ...cube.inverseSequence(left)];
      if (commutator) expanded.push(...cube.inverseSequence(right));
      return expanded;
    }

    function readSequence(depth, stops) {
      const moves = [];
      while (index < text.length && !stops.includes(text[index])) {
        const at = index, char = text[index++];
        if (/\s/.test(char)) continue;
        if (char === "(" || char === "[") {
          if (depth === MAX_DEPTH) fail(at, "use at most " + MAX_DEPTH + " nested groups.");
          const group = char === "(" ? readParen(at, depth + 1) : readBracket(at, depth + 1);
          appendGroup(moves, group, at);
          continue;
        }
        if (")],:".includes(char)) fail(at, "unexpected '" + char + "' in this sequence.");
        if (!cube.FACES.includes(char)) fail(at, "expected U, R, F, D, L, B or a group.");
        requireCapacity(moves.length + 1, at);
        const suffix = text[index];
        if (suffix === "2") { moves.push(char + "2"); index++; }
        else if (suffix === "'" || suffix === "′" || suffix === "’") { moves.push(char + "'"); index++; }
        else moves.push(char);
      }
      return moves;
    }
    return readSequence(0, "");
  }

  return { parse, formatMove, moveName, PRESETS, MAX_TURNS };
})(typeof module !== "undefined" && module.exports ? require("./cube.js") : TwistCube);

if (typeof module !== "undefined" && module.exports) module.exports = TwistNotation;
