'use strict';

const { WIDTH, HEIGHT, SPRINT_LINES, DIG_LAYERS, SURGE_WAVES, STONE, cellsOf } = require('./game');

const FRAME_COLUMNS = 52;
const FRAME_ROWS = HEIGHT + 2;
const PANEL_WIDTH = FRAME_COLUMNS - (WIDTH * 2 + 2) - 3;
const INK = { I: 96, J: 94, L: 33, O: 93, S: 92, T: 95, Z: 91 };

function paint(text, style, color) {
  return color ? `\x1b[${style}m${text}\x1b[0m` : text;
}

// The preview always occupies four columns of blocks, including when hold is empty.
function preview(kind, color) {
  const rows = [Array(4).fill('  '), Array(4).fill('  ')];
  if (kind) {
    for (const [x, y] of cellsOf({ kind })) rows[y][x] = paint('[]', INK[kind], color);
  } else {
    rows[0][1] = '--';
  }
  return rows.map(row => row.join(''));
}

function pairedPreviews(first, second, color) {
  const left = preview(first, color);
  const right = preview(second, color);
  return left.map((row, i) => row + '    ' + right[i]);
}

function centered(text, width) {
  const left = Math.floor((width - text.length) / 2);
  return (' '.repeat(left) + text).padEnd(width);
}

function formatTime(tenths) {
  const seconds = Math.floor(tenths / 10);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${tenths % 10}`;
}

function overlayLines(game) {
  if (game.status === 'paused') return ['PAUSED', 'P to resume', 'Q to quit'];
  if (game.status === 'over') {
    const retry = game.undosLeft ? ['U to undo'] : [];
    return ['GAME OVER', ...retry, 'R to play again', 'Q to quit'];
  }
  if (game.status === 'won') {
    const message = { dig: ['Next stop, milk tea'], surge: ['Dry socks in Kowloon'] }[game.mode] ?? [];
    return [game.mode.toUpperCase() + ' COMPLETE', 'Time  ' + formatTime(game.elapsedTenths),
      ...message, 'R to play again', 'Q to quit'];
  }
  return [];
}

function renderWell(game, color) {
  const grid = game.board.map(row => row.map(kind => {
    if (kind === STONE) return paint('==', 37, color);
    return kind ? paint('##', INK[kind], color) : '  ';
  }));
  if (game.active) {
    const ghost = { ...game.active, y: game.landingY() };
    for (const [x, y] of cellsOf(ghost)) {
      if (y >= 0) grid[y][x] = paint('..', 2, color);
    }
    for (const [x, y] of cellsOf(game.active)) {
      if (y >= 0) grid[y][x] = paint('[]', INK[game.active.kind], color);
    }
  }

  const width = WIDTH * 2;
  const border = '+' + '-'.repeat(width) + '+';
  let floor = border;
  const wave = game.wave;
  if (wave?.rows > 0 && !game.finished) {
    const marker = 1 + wave.gap * 2;
    floor = border.slice(0, marker) + paint('^^', 93, color) + border.slice(marker + 2);
  }
  const well = [border, ...grid.map(row => '|' + row.join('') + '|'), floor];
  const middle = Math.floor(HEIGHT / 2);
  for (const [i, message] of overlayLines(game).entries()) {
    const line = centered(message, width);
    well[middle + i] = '|' + (i === 0 ? paint(line, 1, color) : line) + '|';
  }
  return well;
}

function modeLine(game) {
  if (game.mode === 'endless') return 'Endless';
  if (game.mode === 'practice') return 'Practice    Gravity off';
  let progress;
  if (game.mode === 'sprint') progress = `Sprint  ${Math.min(game.lines, SPRINT_LINES)}/${SPRINT_LINES}`;
  if (game.mode === 'dig') progress = `Dig  ${DIG_LAYERS - game.layersLeft}/${DIG_LAYERS}`;
  if (game.mode === 'surge') progress = `Surge  ${game.wave.completed}/${SURGE_WAVES}`;
  return progress + '    ' + formatTime(game.elapsedTenths);
}

// Use the spare row when two counters grow too wide to share one line.
function statLines(left, right) {
  const joined = [left, right].filter(Boolean).join('    ');
  return joined.length <= PANEL_WIDTH ? [joined, ''] : [left, right];
}

function playHint(game) {
  if (game.mode === 'practice') return `U undo    ${game.undosLeft} available`;
  if (game.mode === 'dig') return '.. landing    == stone';
  if (game.mode === 'surge') {
    const { locksLeft, rows, gap } = game.wave;
    const locks = locksLeft === 1 ? '1 lock' : `${locksLeft} locks`;
    if (rows === 0) return `Wave blocked   ${locks} left`;
    return `In ${locks}  +${rows} ${rows === 1 ? 'row' : 'rows'}  gap ${gap + 1}`;
  }
  return '..  Landing position';
}

function roundStats(game, color) {
  const { pieces, bestCombo, clears } = game.stats;
  const clock = game.mode === 'practice'
    ? `Undos available  ${game.undosLeft}`
    : 'Time played  ' + formatTime(game.elapsedTenths);
  return [
    paint('ROUND STATS', 1, color), clock, `Pieces locked  ${pieces}`, `Best combo  ${bestCombo}`,
    ...['Singles', 'Doubles', 'Triples', 'Quads'].map((label, i) => label.padEnd(9) + clears[i]),
  ];
}

function controls(game, color) {
  return [
    paint('CONTROLS', 1, color),
    'Move       A/D, Left/Right',
    'Turn CW    W/X, Up',
    'Turn CCW   Z',
    'Soft drop  S, Down',
    'Hard drop  Space',
    'Hold C    Pause P    Quit Q',
    playHint(game),
  ];
}

function renderPanel(game, color) {
  const clear = game.lastClear;
  const combo = clear?.combo > 1 ? `Combo ${clear.combo}` : '';
  return [
    paint('KOWLOON STACK', '1;96', color),
    modeLine(game),
    `Score  ${game.score}`,
    ...statLines(`Lines  ${game.lines}`, `Level  ${game.level}`),
    paint('NEXT        ' + (game.canHold ? 'HOLD' : 'HOLD (used)'), 1, color),
    ...pairedPreviews(game.next, game.held, color),
    paint('2ND         3RD', 1, color),
    ...pairedPreviews(...game.following, color),
    clear ? `${clear.count} ${clear.count === 1 ? 'row' : 'rows'}  +${clear.points}` : '',
    ...statLines(combo, clear?.backToBack ? 'Back-to-back' : ''),
    ...(game.status === 'playing' ? controls(game, color) : roundStats(game, color)),
  ];
}

function renderFrame(game, color = false) {
  const well = renderWell(game, color);
  const panel = renderPanel(game, color);
  return well.map((row, i) => {
    const info = panel[i]?.trimEnd();
    return info ? row + '   ' + info : row;
  }).join('\n');
}

module.exports = { FRAME_COLUMNS, FRAME_ROWS, renderFrame };
