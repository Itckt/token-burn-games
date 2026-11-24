'use strict';

const { CHEST_INTERVAL, CHEST_POINTS } = require('./game');
const { findBunRoute } = require('./coach');

const SETUP_KEYS = 'M arena  G mode  Q quit';
const RESULT_KEYS = `R play again  V review  ${SETUP_KEYS}`;
const PRACTICE_RESULT_KEYS = `R play again  U undo  V review  ${SETUP_KEYS}`;
const REVIEW_KEYS = 'Left/Right or A/D step  Home/End jump  V return  Q quit';
const CONTROLS = {
  ready: `Arrows/WASD steer  Space start  ${SETUP_KEYS}`,
  running: 'Arrows/WASD steer   Space pause   R restart   Q quit',
  paused: 'Space resume   V review   R restart   Q quit',
  lost: RESULT_KEYS,
  won: RESULT_KEYS,
};
const PRACTICE_CONTROLS = {
  ready: `Arrows/WASD step  H hint  ${SETUP_KEYS}`,
  running: 'WASD step  H hint  U undo  Space pause  R reset  Q quit',
  paused: 'Space resume  H hint  U undo  V review  R reset  Q quit',
  lost: PRACTICE_RESULT_KEYS,
  won: PRACTICE_RESULT_KEYS,
};
const controlLines = [REVIEW_KEYS, ...Object.values(CONTROLS), ...Object.values(PRACTICE_CONTROLS)];
const CONTROL_WIDTH = Math.max(...controlLines.map(line => line.length));
const ARENA_HINTS = {
  loop: 'Dotted edges wrap.',
  courtyard: 'Dodge the # stalls.',
  junction: 'A-A and B-B are tunnels.',
};
const LOSSES = { wall: 'You hit the wall.', self: 'You hit your snake.', stall: 'You hit a market stall (#).' };

function titleText(game) {
  const name = game.mode === 'standard' ? 'SNAKE' : game.mode.toUpperCase();
  const arena = game.arena === 'classic' ? '' : ` / ${game.arena.toUpperCase()}`;
  const seed = game.seed === undefined ? '' : ` Seed ${game.seed}`;
  return `${name}${arena}${seed}`;
}

function reviewTitle(move, total) {
  return `REVIEW  Move ${move}/${total}`;
}

function scoreText(score, best) {
  return `Score ${score}   Best ${best}`;
}

function frameSize(game) {
  const titleWidth = Math.max(titleText(game).length, reviewTitle(game.moves, game.moves).length);
  // Reserve the score digits up front so gaining a point cannot displace a narrow board.
  const maxChests = game.arena === 'classic' ? 0 : Math.floor((game.goal - 1) / CHEST_INTERVAL);
  const maxScore = game.goal + maxChests * CHEST_POINTS;
  const headerWidth = titleWidth + 2 + scoreText(maxScore, maxScore).length;
  return {
    columns: Math.max(2 * game.width + 2, CONTROL_WIDTH, headerWidth),
    rows: game.height + 5,
  };
}

function fits(game, output) {
  const size = frameSize(game);
  return output.columns >= size.columns && output.rows >= size.rows;
}

function count(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function deliveryStatus(game, state, hint) {
  const order = count(game.goal, 'bun');
  if (state.status === 'ready') return `Ready. ${order} in ${game.moveLimit} moves. ${hint ?? 'Guide @ to *.'}`;
  if (state.status === 'won') return `Delivery complete! ${order} in ${count(state.moves, 'move')}.`;
  if (state.status === 'lost') return `Out of moves. Delivered ${state.bites} of ${order}.`;
  const paused = state.status === 'paused' ? 'Paused. ' : '';
  const bonus = state.chest ? `   C +${CHEST_POINTS} (${count(state.chest.movesLeft, 'move')})` : '';
  return `${paused}Buns ${state.bites}/${game.goal}   ${count(game.moveLimit - state.moves, 'move')} left${bonus}`;
}

function statusText(game, state) {
  if (state.collision) return `Game over. ${LOSSES[state.collision]}`;
  const hint = ARENA_HINTS[game.arena];
  if (game.mode === 'delivery') return deliveryStatus(game, state, hint);
  const chest = state.chest
    ? `C chest +${CHEST_POINTS}   ${count(state.chest.movesLeft, 'move')} left`
    : `C chest every ${CHEST_INTERVAL} buns.`;
  switch (state.status) {
    case 'ready':
      if (game.mode === 'practice') return `Ready. One step per key. ${hint ?? 'Guide @ to *.'}`;
      return hint ? `Ready. ${hint} Guide @ to *.` : 'Ready (Classic). Guide @ to the pineapple bun (*).';
    case 'running': return hint ? `${hint}  ${chest}` : '@ head    o body    * snack';
    case 'paused': return state.chest ? `Paused. ${chest}` : 'Paused. Milk tea break in Kowloon Tong.';
    case 'won': return 'Board cleared! Every open square is yours.';
  }
}

function hintText(game, route) {
  const paused = game.status === 'paused' ? 'Paused. ' : '';
  const hint = route
    ? `${route[0].direction.toUpperCase()}, ${count(route.length, 'move')} to *.`
    : 'No clear path to * yet.';
  const chest = game.chest ? `  C +${CHEST_POINTS} (${count(game.chest.movesLeft, 'move')})` : '';
  return `${paused}Hint  ${hint}${chest}`;
}

function boardLines(game, state, paint, route) {
  const grid = Array.from({ length: game.height }, () => Array(game.width).fill('  '));
  if (route) {
    for (const { x, y } of route) grid[y][x] = paint('.', '36') + ' ';
  }
  for (const { x, y } of game.stalls) grid[y][x] = paint('#', '1;34') + ' ';
  if (state.food) grid[state.food.y][state.food.x] = paint('*', '1;33') + ' ';
  if (state.chest) grid[state.chest.y][state.chest.x] = paint('C', '1;35') + ' ';
  for (const [index, part] of state.snake.entries()) {
    grid[part.y][part.x] = (index === 0 ? paint('@', '1;36') : paint('o', '36')) + ' ';
  }
  const loop = game.arena === 'loop';
  function border(gate) {
    const line = Array(2 * game.width).fill(loop ? '.' : '-');
    if (gate) line[2 * gate.x] = paint(gate.mark, '1;32');
    return '+' + line.join('') + '+';
  }
  function side(gate, y) {
    if (gate && gate.y === y) return paint(gate.mark, '1;32');
    return loop ? ':' : '|';
  }
  const { left, right, up, down } = game.gates;
  return [
    border(up),
    ...grid.map((row, y) => side(left, y) + row.join('') + side(right, y)),
    border(down),
  ];
}

function frameLines(game, color, reviewed, columns, showHint) {
  const state = reviewed ?? game;
  const paint = (text, style) => color ? `\x1b[${style}m${text}\x1b[0m` : text;
  const title = reviewed ? reviewTitle(state.moves, game.moves) : titleText(game);
  const score = scoreText(state.score, game.best);
  const controls = game.mode === 'practice' ? PRACTICE_CONTROLS : CONTROLS;
  const route = showHint ? findBunRoute(game) : null;
  return [
    paint(title, '1') + score.padStart(columns - title.length),
    ...boardLines(game, state, paint, route),
    (showHint ? hintText(game, route) : statusText(game, state)).padEnd(columns),
    (reviewed ? REVIEW_KEYS : controls[game.status]).padEnd(columns),
  ];
}

function drawScreen(game, output, color, clear = false, reviewed = null, showHint = false) {
  const size = frameSize(game);
  let row = 1;
  let column = 1;
  let lines;
  if (fits(game, output)) {
    row += Math.floor((output.rows - size.rows) / 2);
    column += Math.floor((output.columns - size.columns) / 2);
    lines = frameLines(game, color, reviewed, size.columns, showHint);
  } else {
    lines = [`Resize to ${size.columns}x${size.rows} to play.`, 'Q quits.']
      .slice(0, output.rows)
      .map(line => line.slice(0, output.columns));
  }
  // Position each row explicitly so drawing the bottom edge never scrolls the terminal.
  const frame = lines.map((line, i) => `\x1b[${row + i};${column}H${line}`).join('');
  output.write((clear ? '\x1b[2J' : '') + frame);
}

module.exports = { drawScreen, fits };
