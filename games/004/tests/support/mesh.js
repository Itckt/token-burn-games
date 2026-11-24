'use strict';
const assert = require('node:assert/strict');
const G = require('../../js/mesh.js');
const M = require('../../js/math.js');

function checkChunk({vertices, indices}) {
  assert.ok(vertices instanceof Float32Array && indices instanceof Uint16Array);
  const count = vertices.length / G.STRIDE;
  assert.ok(Number.isInteger(count) && count > 0 && count <= 65535);
  assert.ok(indices.length > 0 && indices.length % 3 === 0);
  assert.ok(vertices.every(Number.isFinite));
  for (let i = 0; i < vertices.length; i += G.STRIDE) {
    assert.ok(Math.abs(Math.hypot(vertices[i+3], vertices[i+4], vertices[i+5]) - 1) < 1e-5, 'unit face normal');
  }
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * G.STRIDE, b = indices[i+1] * G.STRIDE, c = indices[i+2] * G.STRIDE;
    assert.ok(a < vertices.length && b < vertices.length && c < vertices.length);
    const edge = (start, end) => [0,1,2].map(k => vertices[end+k] - vertices[start+k]);
    const normal = M.cross(edge(a,b), edge(a,c));
    assert.ok(M.dot(normal, vertices.subarray(a+3,a+6)) > 1e-8, `winding or area at triangle ${i/3}`);
  }
}

module.exports = {checkChunk};
