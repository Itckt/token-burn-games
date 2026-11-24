"use strict";

var TwistAnalysis = (function (cube) {
  function gcd(a, b) {
    while (b) [a, b] = [b, a % b];
    return a;
  }
  const lcm = (a, b) => a / gcd(a, b) * b;

  function cycles(permutation, orientations, base) {
    const visited = new Set();
    let order = 1, changed = 0;
    for (let start = 0; start < permutation.length; start++) {
      if (visited.has(start)) continue;
      let slot = start, length = 0, twist = 0;
      do {
        visited.add(slot);
        twist += orientations[slot];
        slot = permutation[slot];
        length++;
      } while (slot !== start);
      if (length > 1 || twist % base) changed += length;
      // One circuit returns the pieces to their slots. The accumulated
      // corner twists or edge flips may require further circuits.
      order = lcm(order, length * base / gcd(base, twist));
    }
    return { changed, order };
  }

  function effect(moves) {
    const state = cube.coordinates(cube.apply(cube.create(), moves));
    const corners = cycles(state.cp, state.co, 3);
    const edges = cycles(state.ep, state.eo, 2);
    return { corners: corners.changed, edges: edges.changed, repetitions: lcm(corners.order, edges.order) };
  }
  return { effect };
})(typeof module !== "undefined" && module.exports ? require("./cube.js") : TwistCube);

if (typeof module !== "undefined" && module.exports) module.exports = TwistAnalysis;
