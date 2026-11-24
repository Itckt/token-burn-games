"use strict";

var TwistCross = (function (cube) {
  const targets = new Map(cube.FACES.map(face =>
    [face, cube.EDGES.map((name, id) => ({ name, id })).filter(edge => edge.name.includes(face))]));
  // An edge has 24 possible placements (12 slots, two orientations).
  // A cross is four labeled placements packed into four five-bit fields.
  const pack = (a, b, c, d) => a | (b << 5) | (c << 10) | (d << 15);
  const transitions = cube.MOVE_STATES.map(({ ep, eo }) => {
    const next = new Uint8Array(24);
    ep.forEach((from, to) => {
      next[2 * from] = 2 * to + eo[to];
      next[2 * from + 1] = 2 * to + (eo[to] ^ 1);
    });
    return next;
  });
  const inverse = cube.ALL_MOVES.map(move => cube.ALL_MOVES.indexOf(cube.inverse(move)));
  const neighborhoods = new Map();

  function after(key, move) {
    const next = transitions[move];
    return pack(next[key & 31], next[(key >>> 5) & 31], next[(key >>> 10) & 31], next[key >>> 15]);
  }

  function inspect(pieces, face) {
    const target = targets.get(face);
    if (!target) throw new RangeError("Choose a face for the cross.");
    const { ep, eo } = cube.coordinates(pieces);
    const placements = [];
    const edges = target.map(({ name, id }) => {
      const slot = ep.indexOf(id);
      placements.push(2 * slot + eo[slot]);
      return { name, slot: cube.EDGES[slot], aligned: slot === id && eo[slot] === 0 };
    });
    return { edges, aligned: edges.filter(edge => edge.aligned).length, key: pack(...placements) };
  }

  // Each entry records one move back to its parent. The same search builds a
  // small reusable ball around the goal and connects a new position to it.
  function expand(frontier, parents, destination) {
    const next = [];
    for (const key of frontier) {
      for (let move = 0; move < transitions.length; move++) {
        const child = after(key, move);
        if (parents.has(child)) continue;
        parents.set(child, inverse[move]);
        if (destination?.has(child)) return { meeting: child };
        next.push(child);
      }
    }
    return { next };
  }

  function nearGoal(face) {
    if (!neighborhoods.has(face)) {
      const goal = pack(...targets.get(face).map(edge => 2 * edge.id));
      const parents = new Map([[goal, null]]);
      let frontier = [goal];
      for (let depth = 0; depth < 4; depth++) frontier = expand(frontier, parents).next;
      neighborhoods.set(face, parents);
    }
    return neighborhoods.get(face);
  }

  function pathToRoot(key, parents) {
    const moves = [];
    for (let move = parents.get(key); move !== null; move = parents.get(key)) {
      moves.push(cube.ALL_MOVES[move]);
      key = after(key, move);
    }
    return moves;
  }

  function route(pieces, face) {
    const { key, aligned } = inspect(pieces, face);
    if (aligned === 4) return [];
    const toGoal = nearGoal(face);
    if (toGoal.has(key)) return pathToRoot(key, toGoal);
    const toStart = new Map([[key, null]]);
    let frontier = [key];
    while (frontier.length) {
      const { next, meeting } = expand(frontier, toStart, toGoal);
      if (meeting !== undefined) {
        // The first intersection is on the outside of the goal ball. Both
        // halves are shortest paths, with a half turn counting as one move.
        return cube.inverseSequence(pathToRoot(meeting, toStart)).concat(pathToRoot(meeting, toGoal));
      }
      frontier = next;
    }
    throw new RangeError("These four edges cannot form a cross.");
  }

  return { inspect, route };
})(typeof module !== "undefined" && module.exports ? require("./cube.js") : TwistCube);

if (typeof module !== "undefined" && module.exports) module.exports = TwistCross;
