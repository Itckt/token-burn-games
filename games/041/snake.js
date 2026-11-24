'use strict';

const { SnakeGame, ARENAS, MODES, DELIVERY_GOAL, CHEST_INTERVAL, CHEST_POINTS, MAX_SEED } = require('./game');
const { REVIEW_MOVES } = require('./review');
const { runSession } = require('./session');

const HELP = [
  'Terminal Snake',
  '',
  `  node snake.js [--arena ${ARENAS.join('|')}] [--mode ${MODES.join('|')}] [--seed N]`,
  '  node snake.js --help   Show controls',
  '',
  'Steer with the arrow keys or WASD. Space also starts a round.',
  'The snake starts facing right. It can turn one corner per move.',
  'Eat * to grow. In Classic, hitting a wall or your body ends the round.',
  'Loop wraps at the dotted edges. Courtyard has solid market stalls (#).',
  'In Junction, exit through A to arrive at the other A. B connects the same way.',
  `In Loop, Courtyard and Junction, every ${CHEST_INTERVAL} buns can reveal a chest (C) worth ${CHEST_POINTS} points.`,
  'Its counter ticks down once per move. A chest adds no length or speed.',
  '',
  'Standard is the original real-time game. Fill the board to win.',
  `Delivery gives you 84 moves to collect ${DELIVERY_GOAL} buns on the usual board.`,
  'Practice gives you one move per steering key. Take as long as you like.',
  'In Practice, H toggles a dotted route to the bun and the first direction to take.',
  `U takes back one Practice move, even after a crash or win (up to ${REVIEW_MOVES} moves).`,
  'Space or P pauses and resumes. R restarts. Q or Ctrl+C quits.',
  'On the ready or result screen, M cycles arenas and G cycles modes.',
  'Each arena and mode combination keeps its own best for the session.',
  `Press V while paused or after a result to review the last ${REVIEW_MOVES} moves.`,
  'Left/Right or A/D steps through the boards. Home/End jumps. V returns.',
  `Use --seed N (0 to ${MAX_SEED}) to replay or share the same food draws.`,
  '',
].join('\n');

function gameFromArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (!['--arena', '--mode', '--seed'].includes(flag)) throw new RangeError('Unknown arguments.');
    const key = flag.slice(2);
    if (Object.hasOwn(options, key)) throw new RangeError(`Use ${flag} only once.`);
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new RangeError(`${flag} needs a value.`);
    if (key === 'seed') {
      if (!/^\d+$/.test(value)) throw new RangeError('--seed expects a whole number.');
      options.seed = Number(value);
    } else {
      options[key] = value;
    }
  }
  return new SnakeGame(options);
}

function main(args, { stdin, stdout, stderr } = process) {
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    stdout.write(HELP);
    return 0;
  }
  let game;
  try {
    game = gameFromArgs(args);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    stderr.write(`${error.message} Run node snake.js --help for controls.\n`);
    return 2;
  }
  if (!stdin.isTTY || !stdout.isTTY) {
    stderr.write('Snake needs an interactive terminal. Run node snake.js with keyboard input and screen output attached.\n');
    return 1;
  }
  runSession({ input: stdin, output: stdout, game });
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, runSession };
