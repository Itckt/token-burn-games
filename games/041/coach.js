'use strict';

const { DIRECTIONS, inBounds, nextCell, sameCell } = require('./arena');
const headings = Object.keys(DIRECTIONS);

function stepsTo(node) {
  const steps = [];
  while (node.parent) {
    steps.push({ x: node.x, y: node.y, direction: node.direction });
    node = node.parent;
  }
  return steps.reverse();
}

function findBunRoute(game) {
  if (!game.food) return null;
  const cellId = ({ x, y }) => y * game.width + x;
  // The tail vacates its square on a non-growing move. Keeping the rest of the
  // body blocked makes a simple path of free squares legal all the way to the bun.
  const blocked = [...game.stalls, ...game.snake.slice(0, -1)];
  const visited = new Set(blocked.map(cellId));
  const queue = [{ ...game.snake[0], direction: game.direction, parent: null }];
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i];
    for (const direction of headings) {
      if (direction === DIRECTIONS[from.direction].opposite) continue;
      const cell = nextCell(game, from, direction);
      const id = cellId(cell);
      if (!inBounds(game, cell) || visited.has(id)) continue;
      const step = { ...cell, direction, parent: from };
      if (sameCell(cell, game.food)) return stepsTo(step);
      visited.add(id);
      queue.push(step);
    }
  }
  return null;
}

module.exports = { findBunRoute };
