"use strict";

// Looking straight at each face, from the upper left to the lower right.
const slots = {
  U: "ULB UB UBR UL U UR UFL UF URF".split(" "),
  R: "URF UR UBR FR R BR DFR DR DRB".split(" "),
  F: "UFL UF URF FL F FR DLF DF DFR".split(" "),
  D: "DLF DF DFR DL D DR DBL DB DRB".split(" "),
  L: "ULB UL UFL BL L FL DBL DL DLF".split(" "),
  B: "UBR UB ULB BR B BL DRB DB DBL".split(" ")
};

// A clockwise turn sends each strip to the next, with indices in transfer order.
const strips = {
  U: ["F012", "L012", "B012", "R012"], D: ["F678", "R678", "B678", "L678"],
  R: ["F258", "U258", "B630", "D258"], L: ["F036", "D036", "B852", "U036"],
  F: ["U678", "R036", "D210", "L852"], B: ["U012", "L630", "D876", "R258"]
};
function turnNet(net, face) {
  const result = Object.fromEntries(Object.keys(slots).map(f => [f, net[f].slice()]));
  result[face] = [6, 3, 0, 7, 4, 1, 8, 5, 2].map(i => net[face][i]);
  const ring = strips[face];
  ring.forEach((from, i) => {
    const to = ring[(i + 1) % 4];
    for (let j = 1; j <= 3; j++) result[to[0]][to[j]] = net[from[0]][from[j]];
  });
  return result;
}
function applyNet(net, moves) {
  for (const move of moves) {
    const quarters = move.endsWith("'") ? 3 : move.endsWith("2") ? 2 : 1;
    for (let i = 0; i < quarters; i++) net = turnNet(net, move[0]);
  }
  return net;
}
module.exports = { slots, applyNet };
