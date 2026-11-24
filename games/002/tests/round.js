"use strict";
const assert = require("node:assert/strict");
const G = require("../src/game.js");

function round(options={}) {
  const match = G.createMatch({bots:false,...options});
  G.start(match);
  return match;
}
function ticks(match,count,input={}) {
  for (let i=0;i<count;i++) G.step(match,input);
}
function place(actor,x,z) { Object.assign(actor,{x,z}); }
function near(actual,expected,tolerance=1e-6) {
  assert.ok(Math.abs(actual-expected)<tolerance, actual + " differs from " + expected);
}
module.exports = {round,ticks,place,near};
