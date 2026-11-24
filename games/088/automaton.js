"use strict";

// A classic script works from file://. Node uses the same engine through CommonJS.
const Automaton = (() => {
  const MAX_SIZE = 512;
  const DEFAULTS = Object.freeze({
    rule: 90, width: 127, rows: 64, boundary: "fixed", seed: "single", key: 42,
  });
  const COLORS = Object.freeze({ dead: "#faf9f2", live: "#163e35" });
  const TRANSFORMS = Object.freeze(["mirror", "invert", "both"]);

  function integer(value, min, max, label) {
    const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
    if (!Number.isSafeInteger(number) || number < min || number > max) {
      throw new RangeError(`${label} must be a whole number from ${min} to ${max}.`);
    }
    return number;
  }

  function firstRow(width, seed, key) {
    const row = new Uint8Array(width);
    switch (seed) {
      case "single":
        row[Math.floor(width / 2)] = 1;
        break;
      case "alternating":
        for (let x = 0; x < width; x += 2) row[x] = 1;
        break;
      case "campus":
        for (const quarter of [1, 2, 3]) row[Math.floor(width * quarter / 4)] = 1;
        break;
      case "random": {
        // The high bit of a 32-bit LCG makes a repeatable binary seed, including for key 0.
        let state = key;
        for (let x = 0; x < width; x++) {
          state = (Math.imul(1664525, state) + 1013904223) >>> 0;
          row[x] = state >>> 31;
        }
        break;
      }
      default: {
        if (typeof seed !== "string" || !/^[01]+$/.test(seed)) {
          throw new RangeError("Use a single, alternating, random or campus seed, or enter a pattern of 0s and 1s.");
        }
        if (seed.length > width) throw new RangeError("The seed pattern must fit within the width.");
        const start = Math.floor(width / 2) - Math.floor(seed.length / 2);
        for (let i = 0; i < seed.length; i++) row[start + i] = Number(seed[i]);
      }
    }
    return row;
  }

  function checkedBoundary(value) {
    if (!["fixed", "fixed-on", "wrap"].includes(value)) {
      throw new RangeError("Boundary must be fixed, fixed-on or wrap.");
    }
    return value;
  }

  function forEachNeighbourhood(row, boundary, visit) {
    const width = row.length;
    const outside = Number(boundary === "fixed-on");
    let left = boundary === "wrap" ? row[width - 1] : outside;
    const rightEdge = boundary === "wrap" ? row[0] : outside;
    for (let x = 0; x < width; x++) {
      const right = x + 1 < width ? row[x + 1] : rightEdge;
      const neighbourhood = (left << 2) | (row[x] << 1) | right;
      visit(neighbourhood, x);
      left = row[x];
    }
  }

  function nextRow(row, rule, boundary) {
    const next = new Uint8Array(row.length);
    forEachNeighbourhood(row, boundary, (pattern, x) => {
      next[x] = (rule >> pattern) & 1;
    });
    return next;
  }

  function grow(history, settings) {
    while (history.length < settings.rows) {
      history.push(nextRow(history.at(-1), settings.rule, settings.boundary));
    }
    return { settings, history };
  }

  function simulate(options = {}) {
    const input = { ...DEFAULTS, ...options };
    const rule = integer(input.rule, 0, 255, "Rule");
    const width = integer(input.width, 1, MAX_SIZE, "Width");
    const rows = integer(input.rows, 1, MAX_SIZE, "Row count");
    const key = integer(input.key, 0, 0xffffffff, "Random key");
    const boundary = checkedBoundary(input.boundary);
    const seed = input.seed;
    return grow([firstRow(width, seed, key)], { rule, width, rows, key, boundary, seed });
  }

  function extendRun(run, steps) {
    const count = integer(steps, 1, MAX_SIZE, "Step count");
    const rows = integer(run.history.length + count, 1, MAX_SIZE, "Row count");
    return grow(run.history.slice(), { ...run.settings, rows });
  }

  function ruleTable(rule) {
    const number = integer(rule, 0, 255, "Rule");
    return Array.from({ length: 8 }, (_, i) => ({
      pattern: (7 - i).toString(2).padStart(3, "0"),
      output: (number >> (7 - i)) & 1,
    }));
  }

  function flipBit(rule, pattern) {
    const number = integer(rule, 0, 255, "Rule");
    if (typeof pattern !== "string" || !/^[01]{3}$/.test(pattern)) {
      throw new RangeError("Choose a three-bit neighbourhood, such as 010.");
    }
    return number ^ (1 << Number.parseInt(pattern, 2));
  }

  function transformRule(rule, mode) {
    const number = integer(rule, 0, 255, "Rule");
    if (!TRANSFORMS.includes(mode)) throw new RangeError("Choose mirror, invert or both.");
    const mirror = mode !== "invert";
    const invert = mode !== "mirror";
    let transformed = 0;
    for (let pattern = 0; pattern < 8; pattern++) {
      let source = pattern;
      if (mirror) source = ((pattern & 1) << 2) | (pattern & 2) | (pattern >> 2);
      if (invert) source ^= 7;
      const output = ((number >> source) & 1) ^ Number(invert);
      transformed |= output << pattern;
    }
    return transformed;
  }

  function transformRun({ settings, history }, mode) {
    const rule = transformRule(settings.rule, mode);
    const cells = history[0].slice();
    if (mode !== "invert") cells.reverse();
    let boundary = settings.boundary;
    if (mode !== "mirror") {
      for (let x = 0; x < cells.length; x++) cells[x] ^= 1;
      if (boundary !== "wrap") boundary = boundary === "fixed" ? "fixed-on" : "fixed";
    }
    return simulate({ ...settings, rule, boundary, seed: cells.join("") });
  }

  function rowText(row) {
    return Array.from(row, cell => cell ? "#" : ".").join("");
  }

  function asText(history) {
    return history.map(rowText).join("\n") + "\n";
  }

  function quantity(value, unit) {
    return `${value} ${unit}${value === 1 || value === 1n ? "" : "s"}`;
  }

  function asSvg(history) {
    const width = history[0].length;
    const height = history.length;
    const runs = [];
    // One closed path segment per horizontal run keeps large exports compact.
    for (let y = 0; y < height; y++) {
      const row = history[y];
      let x = 0;
      while (x < width) {
        if (row[x] === 0) { x++; continue; }
        const start = x++;
        while (x < width && row[x] === 1) x++;
        const length = x - start;
        runs.push(`M${start} ${y}h${length}v1h-${length}z`);
      }
    }
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width * 6}" height="${height * 6}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">`,
      `  <title>Elementary cellular automaton, ${quantity(width, "cell")} by ${quantity(height, "row")}</title>`,
      `  <rect width="${width}" height="${height}" fill="${COLORS.dead}"/>`,
      ...(runs.length ? [`  <path fill="${COLORS.live}" d="${runs.join("")}"/>`] : []),
      "</svg>\n",
    ].join("\n");
  }

  return Object.freeze({
    DEFAULTS, COLORS, MAX_SIZE, TRANSFORMS, integer, checkedBoundary,
    simulate, extendRun, forEachNeighbourhood, nextRow, ruleTable, flipBit, transformRule, transformRun,
    rowText, asText, asSvg, quantity,
  });
})();

if (typeof module !== "undefined" && module.exports) module.exports = Automaton;
