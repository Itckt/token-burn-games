'use strict';

const { setTimeout: delay } = require('node:timers/promises');
const { readFile } = require('node:fs/promises');
const { buffer } = require('node:stream/consumers');
const { once } = require('node:events');
const { TICK, FORECAST_SECONDS, ballEnergy } = require('./physics.js');
const { scenes, createScene, readCheckpoint, checkpoint, DRAW_SCENE, DEFAULT_SEED, readSeed } = require('./scenes.js');
const { describeImpact, describeCrossing, describeForecast, impactTargets, renderAscii } = require('./court-report.js');

const usage = [
  'Impulse Court | 2D bouncing-ball simulator',
  '',
  'Usage: node simulate.js [options]',
  '',
  '  --scene NAME    ' + Object.keys(scenes).join(', '),
  '                  Default: kowloon-six',
  '  --load FILE     Resume a JSON checkpoint. Use - for standard input.',
  '  --seed N        Generate a practice-draw court, 0 to 4294967295 (default seed: 852)',
  '  --steps N       Additional 1/120-second ticks (default: 360)',
  '  --elasticity E  Restitution, 0 to 1 (default: saved value or 1)',
  '  --drag K        Linear drag per second, K >= 0 (default: saved value or 0)',
  '  --gate X1,Y1,X2,Y2  Add an oriented timing gate between two court points',
  '  --surface TARGET=E  Set elasticity on wall:SIDE, bumper:ID or rail:ID. Use default to inherit.',
  '  --impulse ID,JX,JY  Add momentum to an existing ball at the starting clock time',
  '                  Gate, surface and impulse options can be repeated.',
  '  --format TYPE   ascii, json, or csv (default: ascii)',
  '  --sample-every N  Record CSV positions and velocities every N ticks (default: 120)',
  '  --animate       Play ASCII frames in the terminal for the requested ticks',
  '  --trace         Include each new impact and timing gate crossing',
  '  --until TARGET  Stop on any, pair, ball:ID, bumper:ID, rail:ID, or wall:SIDE',
  '                  Wall sides are left, right, top and bottom. --steps limits the search.',
  '  --forecast ID   Predict one ball’s next ' + FORECAST_SECONDS + ' seconds from the final frame',
  '  --help          Show this help'
].join('\n');

function wholeNumber(option, text, min) {
  const n = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(n) || n < min) {
    throw new Error(option + ' requires a whole number of at least ' + min + ' within the safe integer range.');
  }
  return n;
}

function parseCourtEdit(option, value) {
  if (option === '--surface') {
    const parts = value.split('=');
    if (parts.length !== 2 || !parts[0] || !parts[1].trim()) throw new Error('--surface requires TARGET=E or TARGET=default.');
    const [surface, raw] = parts;
    const restitution = raw === 'default' ? null : Number(raw);
    if (restitution !== null && (!Number.isFinite(restitution) || restitution < 0 || restitution > 1)) {
      throw new Error('--surface elasticity must be between 0 and 1.');
    }
    return { option, surface, restitution };
  }
  const parts = value.split(',').map(part => part.trim());
  const count = option === '--gate' ? 4 : 3;
  if (parts.length !== count || parts.some(part => !part || !Number.isFinite(Number(part)))) {
    throw new Error(option + ' requires ' + count + ' comma-separated finite numbers.');
  }
  if (option === '--gate') {
    const [x1, y1, x2, y2] = parts.map(Number);
    return { option, segment: { x1, y1, x2, y2 } };
  }
  return { option, ballId: wholeNumber('--impulse ball ID', parts[0], 1), jx: Number(parts[1]), jy: Number(parts[2]) };
}

function parseOptions(args) {
  const result = { steps: 360, format: 'ascii', animate: false };
  for (let i = 0; i < args.length; i++) {
    const option = args[i];
    if (option === '--animate' || option === '--trace') {
      result[option.slice(2)] = true;
      continue;
    }
    if (!['--scene', '--load', '--seed', '--steps', '--elasticity', '--drag', '--format', '--forecast',
      '--sample-every', '--until', '--gate', '--surface', '--impulse'].includes(option)) {
      throw new Error('Unknown option: ' + option);
    }
    const value = args[++i];
    if (!value || !value.trim() || value.startsWith('--')) {
      throw new Error('Missing value for ' + option);
    }
    switch (option) {
      case '--gate':
      case '--surface':
      case '--impulse':
        (result.edits ??= []).push(parseCourtEdit(option, value));
        break;
      case '--scene':
        if (!Object.hasOwn(scenes, value)) throw new Error('Unknown scene: ' + value);
        result.scene = value;
        break;
      case '--load':
        result.load = value;
        break;
      case '--seed':
        result.seed = readSeed(value);
        break;
      case '--forecast':
        result.forecast = wholeNumber(option, value, 1);
        break;
      case '--steps':
        result.steps = wholeNumber(option, value, 0);
        break;
      case '--sample-every':
        result.sampleEvery = wholeNumber(option, value, 1);
        break;
      case '--until':
        result.until = value;
        break;
      case '--elasticity':
        result.elasticity = Number(value);
        if (!Number.isFinite(result.elasticity) || result.elasticity < 0 || result.elasticity > 1) {
          throw new Error('--elasticity requires a number between 0 and 1.');
        }
        break;
      case '--drag':
        result.drag = Number(value);
        if (!Number.isFinite(result.drag) || result.drag < 0) throw new Error('--drag requires a nonnegative finite number.');
        break;
      case '--format':
        if (!['ascii', 'json', 'csv'].includes(value)) throw new Error('--format accepts ascii, json or csv.');
        result.format = value;
        break;
    }
  }
  if (result.animate && result.format !== 'ascii') throw new Error('--animate requires ASCII output.');
  if (result.format === 'csv') {
    if (result.trace || result.forecast) throw new Error('--trace and --forecast use ASCII or JSON output.');
    result.sampleEvery ??= 120;
  } else if (result.sampleEvery !== undefined) {
    throw new Error('--sample-every requires --format csv.');
  }
  if (result.load && result.scene) throw new Error('Choose either --load or --scene.');
  if (result.seed !== undefined) {
    if (result.load || (result.scene && result.scene !== DRAW_SCENE)) {
      throw new Error('--seed selects a new practice-draw court.');
    }
    result.scene = DRAW_SCENE;
  }
  if (!result.load) {
    result.scene ??= 'kowloon-six';
    result.elasticity ??= 1;
    if (result.scene === DRAW_SCENE) result.seed ??= DEFAULT_SEED;
  }
  return result;
}

async function loadRun(options, input) {
  if (!options.load) {
    const { scene, seed, drag, elasticity } = options;
    return { scene, seed, world: createScene(scene, elasticity, { seed, drag }) };
  }
  const bytes = options.load === '-' ? await buffer(input) : await readFile(options.load);
  // Windows PowerShell 5 redirects native output as UTF-16LE with a BOM.
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8';
  const run = readCheckpoint(bytes.toString(encoding));
  if (options.elasticity !== undefined) run.world.restitution = options.elasticity;
  if (options.drag !== undefined) run.world.drag = options.drag;
  return run;
}

async function writeSample(output, world, sample) {
  for (const ball of world.balls) {
    const row = [sample, world.time, ball.id, ball.x, ball.y, ball.vx, ball.vy,
      Math.hypot(ball.vx, ball.vy), ballEnergy(ball)];
    if (output.write(row.join(',') + '\n') === false) await once(output, 'drain');
  }
}

async function main(args, output = process.stdout, input = process.stdin) {
  const line = value => output.write(value + '\n');
  if (args.includes('--help')) {
    line(usage);
    return;
  }
  const options = parseOptions(args);
  const run = await loadRun(options, input);
  const { world, scene, seed } = run;
  for (const edit of options.edits ?? []) {
    if (edit.option === '--gate') world.addGate(edit.segment);
    else if (edit.option === '--surface') world.setSurfaceRestitution(edit.surface, edit.restitution);
    else world.applyImpulse(edit.ballId, edit.jx, edit.jy);
  }
  const name = (scenes[scene]?.name ?? 'Imported court') + (seed === undefined ? '' : ' (seed ' + seed + ')');
  if (options.forecast > world.balls.length) throw new RangeError('Choose an existing ball ID to forecast.');
  const target = options.until && impactTargets(world).find(item => item.value === options.until);
  if (options.until && !target) throw new RangeError('Unknown impact target for this court: ' + options.until);
  const impacts = options.trace ? [] : undefined;
  // ASCII prints both kinds of event in solver order, even when absolute
  // timestamps round to a tie. JSON exposes the two streams separately.
  const crossings = options.trace && world.gates.length ? (options.format === 'ascii' ? impacts : []) : undefined;
  const stepOptions = { impacts, crossings, stopOn: target?.matches };
  let done = 0;
  let stoppedAt;
  function advanceTicks(count) {
    const end = Math.min(options.steps, done + count);
    while (done < end && !stoppedAt) {
      stoppedAt = world.step(TICK, stepOptions);
      done++;
    }
  }
  const finished = () => done === options.steps || Boolean(stoppedAt);
  const predict = () => options.forecast === undefined ? undefined : world.forecast(options.forecast);
  function printCourt() {
    line(renderAscii(world, name));
    if (impacts) {
      for (const event of impacts) {
        const description = event.type === 'gate' ? describeCrossing(event) : describeImpact(event);
        line(event.time.toFixed(6) + ' s  ' + description);
      }
      impacts.length = 0;
    }
    if (target && finished()) {
      line(stoppedAt ? 'Stopped at ' + stoppedAt.time.toFixed(6) + ' s  ' + describeImpact(stoppedAt)
        : 'Reached the tick limit before a matching impact (' + target.label + ').');
    }
    const forecast = finished() && predict();
    if (forecast) {
      line('Forecast | ' + describeForecast(forecast));
      for (const p of forecast.points) {
        line('  ' + p.time.toFixed(6) + ' s  (' + p.x.toFixed(2) + ', ' + p.y.toFixed(2) + ')  hits ' + p.hits);
      }
    }
  }
  if (options.format === 'csv') {
    if (output.write('sample,time,ballId,x,y,vx,vy,speed,kineticEnergy\n') === false) await once(output, 'drain');
    let sample = 0;
    await writeSample(output, world, sample);
    while (!finished()) {
      advanceTicks(options.sampleEvery);
      await writeSample(output, world, ++sample);
    }
    return;
  }
  if (options.animate) {
    const frame = () => {
      if (output.isTTY) output.write('\x1b[2J\x1b[H');
      printCourt();
    };
    frame();
    while (!finished()) {
      const count = Math.min(4, options.steps - done);
      await delay(1000 * TICK * count);
      advanceTicks(count);
      frame();
    }
    return;
  }
  advanceTicks(options.steps);
  if (options.format === 'json') {
    const stop = target ? { target: target.value, impact: stoppedAt ?? null } : undefined;
    line(JSON.stringify({ ...checkpoint(run), impacts, crossings, forecast: predict(), stop }, null, 2));
  } else {
    printCourt();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error.message + '\nUse node simulate.js --help for options.');
    process.exitCode = 1;
  });
}

module.exports = { main, parseOptions };
