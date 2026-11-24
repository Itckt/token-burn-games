'use strict';
const assert = require('node:assert/strict');
const M = require('../../js/math.js');

// Use the public camera pose to test what fits inside the renderer's frustum.
function clipFrom(shot, aspect) {
  const fov = (shot.fov + Math.max(0, 1 - aspect) * 24) * Math.PI / 180;
  const view = M.viewMatrix(shot.eye, M.cameraBasis(shot.eye, shot.aim, shot.up));
  const matrix = M.multiply(M.perspective(fov, aspect, 0.5, 950), view);
  return point => M.transform(matrix, [...point, 1]);
}

function projectFrom(shot, aspect) {
  const clip = clipFrom(shot, aspect);
  return point => {
    const [x,y,,w] = clip(point);
    assert.ok(w > 0.5, 'subject in front of the near plane');
    return [x/w, y/w];
  };
}

module.exports = {clipFrom, projectFrom};
