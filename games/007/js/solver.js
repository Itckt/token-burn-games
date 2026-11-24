"use strict";

// Two-phase IDA*. The move maps come from the same exact turns used by the renderer.
function createTwistSolver(names, moves) {
  const phase2 = names.map((_, i) => i).filter(i => "UD".includes(names[i][0]) || names[i][1] === "2");
  const factorial = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];
  let tables;

  function following(state, move) {
    const m = moves[move];
    return {
      cp: m.cp.map(i => state.cp[i]),
      co: m.cp.map((i, j) => (state.co[i] + m.co[j]) % 3),
      ep: m.ep.map(i => state.ep[i]),
      eo: m.ep.map((i, j) => state.eo[i] ^ m.eo[j])
    };
  }

  function parity(perm) {
    let odd = 0;
    for (let i = 1; i < perm.length; i++) {
      for (let j = 0; j < i; j++) if (perm[j] > perm[i]) odd ^= 1;
    }
    return odd;
  }

  function valid(state) {
    function inRange(array, size, limit) {
      if (!(Array.isArray(array) || ArrayBuffer.isView(array)) || array.length !== size) return false;
      for (let i = 0; i < size; i++) {
        if (!Number.isInteger(array[i]) || array[i] < 0 || array[i] >= limit) return false;
      }
      return true;
    }
    return !!state && inRange(state.cp, 8, 8) && new Set(state.cp).size === 8 &&
      inRange(state.ep, 12, 12) && new Set(state.ep).size === 12 &&
      inRange(state.co, 8, 3) && state.co.reduce((a, b) => a + b, 0) % 3 === 0 &&
      inRange(state.eo, 12, 2) && state.eo.reduce((a, b) => a + b, 0) % 2 === 0 &&
      parity(state.cp) === parity(state.ep);
  }

  function solved(state) {
    return state.cp.every((p, i) => p === i && !state.co[i]) &&
      state.ep.every((p, i) => p === i && !state.eo[i]);
  }

  function orientRank(values, base) {
    let rank = 0;
    for (let i = 0; i < values.length - 1; i++) rank = rank * base + values[i];
    return rank;
  }

  function orientationTable(size, base, permKey, orientKey) {
    const count = base ** (size - 1);
    const table = new Uint16Array(count * 18);
    const from = new Uint8Array(size);
    const to = new Uint8Array(size);
    for (let rank = 0; rank < count; rank++) {
      let remaining = rank, sum = 0;
      for (let i = size - 2; i >= 0; i--) {
        from[i] = remaining % base;
        sum += from[i];
        remaining = Math.floor(remaining / base);
      }
      from[size - 1] = (base - sum % base) % base;
      for (let k = 0; k < 18; k++) {
        const perm = moves[k][permKey], orient = moves[k][orientKey];
        for (let i = 0; i < size; i++) to[i] = (from[perm[i]] + orient[i]) % base;
        table[rank * 18 + k] = orientRank(to, base);
      }
    }
    return table;
  }

  function sliceTable() {
    // ID zero is the solved middle slice (last four edge positions).
    const masks = [0xf00];
    const ids = new Uint16Array(4096);
    for (let a = 0; a < 9; a++) for (let b = a + 1; b < 10; b++) {
      for (let c = b + 1; c < 11; c++) for (let d = c + 1; d < 12; d++) {
        const mask = (1 << a) | (1 << b) | (1 << c) | (1 << d);
        if (mask !== masks[0]) { ids[mask] = masks.length; masks.push(mask); }
      }
    }
    const table = new Uint16Array(masks.length * 18);
    for (let s = 0; s < masks.length; s++) {
      for (let k = 0; k < 18; k++) {
        let mask = 0;
        for (let i = 0; i < 12; i++) if (masks[s] & (1 << moves[k].ep[i])) mask |= 1 << i;
        table[s * 18 + k] = ids[mask];
      }
    }
    return { ids, table };
  }

  function permRank(perm) {
    let rank = 0;
    for (let i = 0; i < perm.length - 1; i++) {
      let smaller = 0;
      for (let j = i + 1; j < perm.length; j++) if (perm[j] < perm[i]) smaller++;
      rank = rank * (perm.length - i) + smaller;
    }
    return rank;
  }

  function permutationTable(size, slotMaps) {
    const table = new Uint16Array(factorial[size] * slotMaps.length);
    const to = new Uint8Array(size);
    for (let rank = 0; rank < factorial[size]; rank++) {
      const pool = Array.from({ length: size }, (_, i) => i);
      const from = [];
      let remaining = rank;
      for (let i = size - 1; i >= 0; i--) {
        const digit = Math.floor(remaining / factorial[i]);
        from.push(pool.splice(digit, 1)[0]);
        remaining %= factorial[i];
      }
      for (let k = 0; k < slotMaps.length; k++) {
        const map = slotMaps[k];
        for (let i = 0; i < size; i++) to[i] = from[map[i]];
        table[rank * slotMaps.length + k] = permRank(to);
      }
    }
    return table;
  }

  // Breadth-first distances in a pair of coordinates give admissible search bounds.
  function distances(first, second, width) {
    const secondSize = second.length / width;
    const dist = new Uint8Array(first.length / width * secondSize).fill(255);
    const queue = new Uint32Array(dist.length);
    let head = 0, tail = 1;
    dist[0] = 0;
    while (head < tail) {
      const index = queue[head++];
      const a = Math.floor(index / secondSize) * width;
      const b = index % secondSize * width;
      const nextDepth = dist[index] + 1;
      for (let k = 0; k < width; k++) {
        const next = first[a + k] * secondSize + second[b + k];
        if (dist[next] !== 255) continue;
        dist[next] = nextDepth;
        queue[tail++] = next;
      }
    }
    return dist;
  }

  function prepare() {
    const twist = orientationTable(8, 3, "cp", "co");
    const flip = orientationTable(12, 2, "ep", "eo");
    const slice = sliceTable();
    const corners = permutationTable(8, phase2.map(k => moves[k].cp));
    const edges = permutationTable(8, phase2.map(k => moves[k].ep.slice(0, 8)));
    const middle = permutationTable(4, phase2.map(k => moves[k].ep.slice(8).map(i => i - 8)));
    return { twist, flip, slice, corners, edges, middle,
      twistDist: distances(twist, slice.table, 18), flipDist: distances(flip, slice.table, 18),
      cornerDist: distances(corners, middle, 10), edgeDist: distances(edges, middle, 10) };
  }

  function findPath(start, config) {
    const { first, second, third, firstDist, secondDist, thirdSize, allowed, maxDepth } = config;
    const width = allowed.length, path = [];
    function search(a, b, c, depth, lastFace) {
      if (firstDist[a * thirdSize + c] > depth || secondDist[b * thirdSize + c] > depth) return false;
      if (depth === 0) return true;
      for (let k = 0; k < width; k++) {
        const move = allowed[k];
        const face = Math.floor(move / 3);
        // Opposite faces commute. Explore just one ordering of adjacent opposites.
        if (face === lastFace || face + 3 === lastFace) continue;
        path.push(move);
        if (search(first[a * width + k], second[b * width + k], third[c * width + k], depth - 1, face)) return true;
        path.pop();
      }
      return false;
    }
    const [a, b, c] = start;
    const lowerBound = Math.max(firstDist[a * thirdSize + c], secondDist[b * thirdSize + c]);
    for (let depth = lowerBound; depth <= maxDepth; depth++) {
      if (search(a, b, c, depth, -1)) return path;
    }
    throw new Error("Could not find a route for this cube state.");
  }

  function solve(state) {
    if (!valid(state)) throw new RangeError("The cube state is unreachable.");
    if (solved(state)) return [];
    for (let k = 0; k < 18; k++) if (solved(following(state, k))) return [names[k]];
    if (!tables) tables = prepare();
    const t = tables;
    let mask = 0;
    for (let i = 0; i < 12; i++) if (state.ep[i] >= 8) mask |= 1 << i;
    const first = findPath([orientRank(state.co, 3), orientRank(state.eo, 2), t.slice.ids[mask]], {
      first: t.twist, second: t.flip, third: t.slice.table, thirdSize: 495,
      firstDist: t.twistDist, secondDist: t.flipDist, allowed: names.map((_, i) => i), maxDepth: 12
    });
    const middleState = first.reduce(following, state);
    const second = findPath([permRank(middleState.cp), permRank(middleState.ep.slice(0, 8)),
      permRank(middleState.ep.slice(8))], {
      first: t.corners, second: t.edges, third: t.middle, thirdSize: 24,
      firstDist: t.cornerDist, secondDist: t.edgeDist, allowed: phase2, maxDepth: 18
    });
    return first.concat(second).map(k => names[k]);
  }

  return { solve, following, valid };
}

var TwistSolver = (function (cube) {
  const moves = cube.MOVE_STATES;
  const solver = createTwistSolver(cube.ALL_MOVES, moves);
  function workerSource() {
    const factory = createTwistSolver.toString();
    return '"use strict";const solver = (' + factory + ')(' + JSON.stringify(cube.ALL_MOVES) +
      ',' + JSON.stringify(moves) + ');self.onmessage = function (event) {' +
      'const { ticket, state } = event.data || {}; try { self.postMessage({ticket, moves: solver.solve(state)}); }' +
      'catch (error) { self.postMessage({ticket, error: error.message}); }};';
  }
  return { ...solver, workerSource };
})(typeof module !== "undefined" && module.exports ? require("./cube.js") : TwistCube);

if (typeof module !== "undefined" && module.exports) module.exports = TwistSolver;
