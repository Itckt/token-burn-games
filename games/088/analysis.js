"use strict";

const AtlasAnalysis = (() => {
  const { integer, checkedBoundary, MAX_SIZE, quantity, simulate, forEachNeighbourhood, nextRow } =
    typeof module !== "undefined" && module.exports ? require("./automaton.js") : Automaton;
  const MAX_BASIN_WIDTH = 12;
  const defaultBasinWidth = width => width <= MAX_BASIN_WIDTH ? width : 8;

  function analyzeHistory(history) {
    const firstSeen = new Map();
    let cycle = null;
    const activity = history.map((row, generation) => {
      const previous = history[generation - 1];
      let live = 0, changed = 0;
      for (let x = 0; x < row.length; x++) {
        live += row[x];
        if (previous && previous[x] !== row[x]) changed++;
      }
      if (cycle === null) {
        const key = row.join("");
        if (firstSeen.has(key)) {
          const start = firstSeen.get(key);
          cycle = { start, repeat: generation, period: generation - start };
        } else {
          firstSeen.set(key, generation);
        }
      }
      return { live, changed: previous ? changed : null };
    });
    return { activity, cycle };
  }

  function describeCycle(cycle, rows) {
    if (!cycle) return `No repeated row in ${quantity(rows, "generation")}.`;
    const kind = cycle.period === 1 ? "fixed point, period 1" : `period ${cycle.period}`;
    return `Generation ${cycle.repeat} repeats generation ${cycle.start} (${kind}).`;
  }

  function describeChange(changed, generation) {
    if (changed === null) return "Seed row.";
    return `${quantity(changed, "cell")} changed since generation ${generation - 1}.`;
  }

  function compareSeedFlip({ settings, history }, column = Math.floor(settings.width / 2)) {
    const cell = integer(column, 0, settings.width - 1, "Seed cell");
    const flipped = history[0].slice();
    flipped[cell] ^= 1;
    const seed = flipped.join("");
    const alternate = simulate({ ...settings, seed });
    const differences = history.map((row, g) => row.map((bit, x) => bit ^ alternate.history[g][x]));
    const distances = differences.map(row => row.reduce((sum, bit) => sum + bit, 0));
    const first = distances.indexOf(0);
    return { cell, seed, differences, distances, firstAgreement: first === -1 ? null : first };
  }

  function describeAgreement(firstAgreement, rows) {
    if (firstAgreement === null) return `No agreement in ${quantity(rows, "generation")}.`;
    return `The runs agree from generation ${firstAgreement}.`;
  }

  function parseObservations(text) {
    if (typeof text !== "string" || !text.trim()) throw new RangeError("Enter at least one observed row.");
    const words = text.trim().split(/\r\n?|\n|\//).map(word => word.trim());
    integer(words.length, 1, MAX_SIZE, "Observed row count");
    const width = integer(words[0].length, 1, MAX_SIZE, "Observed width");
    return words.map((word, i) => {
      if (!/^[01]+$/.test(word)) throw new RangeError(`Observed row ${i + 1} must contain only 0 and 1.`);
      if (word.length !== width) throw new RangeError(`Observed row ${i + 1} must have ${quantity(width, "cell")}.`);
      return Uint8Array.from(word, Number);
    });
  }

  // Keep two masks per prefix so scrubbing can undo evidence as well as add it.
  // A bit present in both masks means that neighbourhood had conflicting outputs.
  function ruleEvidence(history, boundary) {
    checkedBoundary(boundary);
    let off = 0, on = 0;
    return history.map((row, g) => {
      if (g > 0) {
        forEachNeighbourhood(history[g - 1], boundary, (pattern, x) => {
          if (row[x]) on |= 1 << pattern;
          else off |= 1 << pattern;
        });
      }
      return { off, on };
    });
  }

  function matchingRules({ off, on }) {
    const rules = [];
    for (let rule = 0; rule <= 255; rule++) {
      if ((rule & off) === 0 && (rule & on) === on) rules.push(rule);
    }
    let outputs = "";
    for (let pattern = 7; pattern >= 0; pattern--) {
      const bit = 1 << pattern;
      if (off & on & bit) outputs += "!";
      else if (on & bit) outputs += "1";
      else if (off & bit) outputs += "0";
      else outputs += "?";
    }
    return { outputs, rules };
  }

  function mapBasins(rule, width, boundary) {
    rule = integer(rule, 0, 255, "Rule");
    width = integer(width, 1, MAX_BASIN_WIDTH, "Basin width");
    checkedBoundary(boundary);
    const states = 2 ** width;
    const bits = state => state.toString(2).padStart(width, "0");
    const successor = new Uint16Array(states);
    for (let state = 0; state < states; state++) {
      const next = nextRow(Uint8Array.from(bits(state), Number), rule, boundary);
      successor[state] = next.reduce((word, cell) => (word << 1) | cell, 0);
    }

    const unseen = -1, onPath = -2;
    const basinOf = new Int16Array(states).fill(unseen);
    const depth = new Uint16Array(states);
    const basins = [];
    for (let seed = 0; seed < states; seed++) {
      if (basinOf[seed] !== unseen) continue;
      const path = [];
      let state = seed;
      while (basinOf[state] === unseen) {
        basinOf[state] = onPath;
        path.push(state);
        state = successor[state];
      }
      if (basinOf[state] === onPath) {
        const cycle = path.splice(path.indexOf(state));
        const representative = Math.min(...cycle);
        for (const member of cycle) basinOf[member] = basins.length;
        basins.push({ representative, period: cycle.length, size: 0, maxSteps: 0, example: representative });
      }
      // The walk has reached a classified state. Classify its tail in reverse.
      for (let i = path.length - 1; i >= 0; i--) {
        const member = path[i];
        const next = successor[member];
        basinOf[member] = basinOf[next];
        depth[member] = depth[next] + 1;
      }
    }
    for (let seed = 0; seed < states; seed++) {
      const basin = basins[basinOf[seed]];
      basin.size++;
      if (depth[seed] > basin.maxSteps) {
        basin.maxSteps = depth[seed];
        basin.example = seed;
      }
    }
    basins.sort((a, b) => b.size - a.size || a.representative - b.representative);
    return basins.map(basin => ({
      ...basin, representative: bits(basin.representative), example: bits(basin.example),
    }));
  }

  // A pair (left, centre) steps to (centre, right) when its triplet emits the
  // requested target bit. Keep next pairs in binary order for the sample search.
  function pairTransitions(rule) {
    const edges = Array.from({ length: 2 }, () => Array.from({ length: 4 }, () => []));
    for (let triplet = 0; triplet < 8; triplet++) {
      edges[(rule >> triplet) & 1][triplet >> 1].push(triplet & 3);
    }
    return edges;
  }

  function suffixCounts(target, edges, acceptsEnd) {
    const ways = new Array(target.length + 1);
    ways[target.length] = Array.from({ length: 4 }, (_, pair) => BigInt(acceptsEnd(pair)));
    for (let x = target.length - 1; x >= 0; x--) {
      ways[x] = edges[target[x]].map(nextPairs =>
        nextPairs.reduce((sum, next) => sum + ways[x + 1][next], 0n));
    }
    return ways;
  }

  function samplePaths(target, edges, ways, start, limit) {
    const samples = [];
    function visit(x, pair, prefix) {
      if (x === target.length) {
        samples.push(prefix);
        return;
      }
      for (const next of edges[target[x]][pair]) {
        if (samples.length === limit) break;
        if (ways[x + 1][next] === 0n) continue;
        // The final transition checks the outside bit. It adds no seed cell.
        visit(x + 1, next, x + 1 === target.length ? prefix : prefix + (next & 1));
      }
    }
    visit(0, start, String(start & 1));
    return samples;
  }

  function findPredecessors(target, rule, boundary) {
    if (typeof target !== "string" || !/^[01]+$/.test(target)) {
      throw new RangeError("The target row must be a binary pattern.");
    }
    integer(target.length, 1, MAX_SIZE, "Target width");
    checkedBoundary(boundary);
    const edges = pairTransitions(integer(rule, 0, 255, "Rule"));
    const limit = 3;
    const outside = Number(boundary === "fixed-on");
    const ring = boundary === "wrap";
    const fixedWays = ring ? null : suffixCounts(target, edges, end => (end & 1) === outside);
    let count = 0n;
    const samples = [];
    for (let start = 0; start < 4; start++) {
      if (!ring && (start >> 1) !== outside) continue;
      // On a ring the last pair must close back onto this exact starting pair.
      const ways = fixedWays ?? suffixCounts(target, edges, end => end === start);
      count += ways[0][start];
      if (ways[0][start] > 0n) samples.push(...samplePaths(target, edges, ways, start, limit));
    }
    // Ring paths with the same first cell can belong to different start pairs.
    return { count, samples: samples.sort().slice(0, limit) };
  }

  return Object.freeze({
    analyzeHistory, describeCycle, describeChange, findPredecessors, compareSeedFlip, describeAgreement,
    parseObservations, ruleEvidence, matchingRules, mapBasins, defaultBasinWidth, MAX_BASIN_WIDTH,
  });
})();

if (typeof module !== "undefined" && module.exports) module.exports = AtlasAnalysis;
