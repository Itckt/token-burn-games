'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { EventEmitter } = require('node:events');
const { World, TICK } = require('../physics.js');
const { scenes, createScene, addFreeBall } = require('../scenes.js');
const { main, parseOptions } = require('../simulate.js');
const { near } = require('./helpers.js');

async function outputOf(args, isTTY = false, input = '') {
  let text = '';
  await main(args, { isTTY, write(chunk) { text += chunk; } }, Readable.from([input]));
  return text;
}

for (const [scene, count] of [['kowloon-six', 6], ['mass-mismatch', 2], ['opening-break', 7]]) {
  test(scene + ' is reproducible and produces physical impacts', () => {
    const a = createScene(scene);
    const b = createScene(scene);
    assert.equal(a.balls.length, count);
    const start = a.snapshot();
    for (let i = 0; i < 480; i++) a.step();
    assert.deepEqual(b.snapshot(), start);
    assert.ok(a.ballHits > 0);
    for (let i = 0; i < 480; i++) b.step();
    assert.deepEqual(a.snapshot(), b.snapshot());
    assert.deepEqual(createScene(scene).snapshot(), start);
  });
}

test('automatic ball placement finds clear positions and consistent initial velocities', () => {
  const a = createScene();
  const b = createScene();
  for (let i = 0; i < 30; i++) {
    const added = addFreeBall(a);
    assert.ok(added && b.canPlace(added.x, added.y, added.radius));
    assert.ok(Math.hypot(added.vx, added.vy) > 0);
    assert.deepEqual(added, addFreeBall(b));
  }
  assert.equal(a.balls.length, 36);
});

test('automatic placement leaves a full or undersized court intact', () => {
  for (const size of [16, 50]) {
    const w = new World({ width: size, height: size });
    w.addBall({ x: size / 2, y: size / 2, radius: size / 2 - 1 });
    const before = w.snapshot();
    assert.equal(addFreeBall(w), null);
    assert.deepEqual(w.snapshot(), before);
  }
});

test('scene lookup rejects unknown names, including inherited property names', () => {
  for (const name of ['missing', 'constructor', '__proto__']) {
    assert.throws(() => createScene(name), /Unknown scene/);
  }
});

test('default CLI returns one complete bounded ASCII court and its measurements', async () => {
  const text = await outputOf([]);
  const lines = text.trimEnd().split('\n');
  assert.equal(lines[0], 'Impulse Court | Kowloon Six');
  assert.match(lines[1], /^\+-{72}\+$/);
  assert.equal(lines[22], lines[1]);
  const court = lines.slice(2, 22);
  for (const row of court) assert.match(row, /^\|.{72}\|$/);
  for (let id = 1; id <= 6; id++) assert.ok(court.join('').includes(String(id)));
  assert.match(lines[23], /Time 3\.00 s  \|  Balls 6  \|  Ball hits [1-9]\d*  \|  Wall hits [1-9]\d*/);
  assert.match(lines[24], /^Kinetic energy [\d.]+$/);
  assert.equal(lines.length, 25);
  assert.ok(!text.includes('\x1b'));
});

test('CLI JSON contains the exact final state of the selected engine run', async () => {
  const args = ['--format', 'json', '--steps', '301', '--scene', 'mass-mismatch', '--elasticity', '0.75'];
  const expected = createScene('mass-mismatch', 0.75);
  for (let i = 0; i < 301; i++) expected.step(TICK);
  const text = await outputOf(args);
  assert.deepEqual(JSON.parse(text), { scene: 'mass-mismatch', ...expected.snapshot() });
  assert.equal(await outputOf(args), text);
});

test('zero ticks export the starting state and both endpoints of the elasticity range work', async () => {
  for (const e of [0, 1]) {
    const text = await outputOf(['--scene', 'opening-break', '--steps', '0', '--elasticity', String(e), '--format', 'json']);
    assert.deepEqual(JSON.parse(text), { scene: 'opening-break', ...createScene('opening-break', e).snapshot() });
  }
});

test('CLI help lists the available scenes and run options', async () => {
  const text = await outputOf(['--help']);
  for (const entry of [...Object.keys(scenes), '--steps', '--elasticity', '--format', '--animate',
    '--load', '--trace', '--seed', '--drag', '--forecast', '--until', '--sample-every', '--gate',
    '--surface', '--impulse', 'csv']) {
    assert.ok(text.includes(entry));
  }
});

test('invalid CLI input reports the error before advancing the world', async () => {
  for (const args of [
    ['--unknown'], ['kowloon-six'], ['--scene'], ['--scene', ''], ['--scene', 'missing'],
    ['--scene', '__proto__'], ['--format', '--steps'], ['--format', 'png'], ['--steps', '-1'],
    ['--steps', '3.2'], ['--steps', '1e3'], ['--steps', '9007199254740992'], ['--steps', 'NaN'],
    ['--elasticity', '1.01'], ['--elasticity', '-0.1'], ['--elasticity', 'NaN'],
    ['--elasticity', 'Infinity'], ['--elasticity', ' '], ['--animate', '--format', 'json'],
    ['--load'], ['--load', '--trace'], ['--load', '-', '--scene', 'mass-mismatch']
  ]) {
    assert.throws(() => parseOptions(args), Error, args.join(' '));
    await assert.rejects(outputOf(args), Error);
  }
});

test('ASCII playback includes the initial frame and the exact final partial frame', async () => {
  const text = await outputOf(['--animate', '--steps', '5']);
  assert.equal(text.match(/Impulse Court/g).length, 3);
  assert.ok(text.endsWith(await outputOf(['--steps', '5'])));
  assert.ok(!text.includes('\x1b'));
  const terminal = await outputOf(['--animate', '--steps', '0'], true);
  assert.ok(terminal.startsWith('\x1b[2J\x1b[H'));
  assert.ok(terminal.endsWith(await outputOf(['--steps', '0'])));
});

test('the slalom shows fixed posts and its JSON and ASCII traces agree about the first hits', async () => {
  const args = ['--scene', 'turnstile-slalom', '--steps', '120', '--trace'];
  const json = JSON.parse(await outputOf([...args, '--format', 'json']));
  assert.equal(json.bumpers.length, 3);
  assert.deepEqual(json.impacts.map(e => [e.type, e.ballId, e.bumperId ?? e.wall]),
    [['bumper', 3, 2], ['bumper', 2, 3], ['bumper', 1, 1], ['wall', 3, 'bottom']]);
  assert.deepEqual([json.bumperHits, json.ballHits, json.wallHits], [3, 0, 1]);
  const ascii = await outputOf(args);
  for (const post of json.bumpers) assert.ok(ascii.includes('B' + post.id));
  assert.match(ascii, /Bumper hits 3/);
  for (const hit of json.impacts) assert.ok(ascii.includes(hit.time.toFixed(6) + ' s  Ball ' + hit.ballId));
  assert.equal(await outputOf(args), ascii);
});

test('automatic placement also avoids the slalom bumpers', () => {
  const w = createScene('turnstile-slalom');
  for (let i = 0; i < 30; i++) {
    const ball = addFreeBall(w);
    assert.ok(ball);
    for (const post of w.bumpers) {
      assert.ok(Math.hypot(ball.x - post.x, ball.y - post.y) >= ball.radius + post.radius);
    }
  }
});

test('piping a traced checkpoint resumes exactly and records only new contacts', async () => {
  const args = ['--format', 'json', '--trace'];
  const scene = ['--scene', 'turnstile-slalom', '--elasticity', '0.73'];
  const first = await outputOf([...scene, ...args, '--steps', '117']);
  const second = JSON.parse(await outputOf(['--load', '-', ...args, '--steps', '604'], false, first));
  const total = JSON.parse(await outputOf([...scene, ...args, '--steps', '721']));
  assert.ok(JSON.parse(first).impacts.length > 0 && second.impacts.length > 0);
  assert.ok(second.impacts[0].time > JSON.parse(first).time);
  assert.deepEqual({ ...second, impacts: [...JSON.parse(first).impacts, ...second.impacts] }, total);
});

test('zero additional ticks preserve a checkpoint and an explicit elasticity override branches the run', async () => {
  const json = ['--format', 'json'];
  const first = await outputOf(['--scene', 'mass-mismatch', '--steps', '180', ...json]);
  assert.equal(await outputOf(['--load', '-', '--steps', '0', ...json], false, first), first);
  const args = ['--load', '-', '--steps', '120', '--trace', ...json];
  const elastic = JSON.parse(await outputOf(args, false, first));
  const inelastic = JSON.parse(await outputOf([...args, '--elasticity', '0'], false, first));
  assert.equal(inelastic.time, elastic.time);
  assert.equal(inelastic.restitution, 0);
  assert.equal(elastic.restitution, 1);
  assert.equal(inelastic.impacts[0].time, elastic.impacts[0].time);
  assert.ok(inelastic.kineticEnergy < elastic.kineticEnergy);
});

test('loading a local checkpoint supports UTF-8 and Windows redirected output', async () => {
  const saved = await outputOf(['--format', 'json', '--steps', '7']);
  const directory = await fs.mkdtemp(path.join(__dirname, 'checkpoint-'));
  const filename = path.join(directory, 'court.json');
  try {
    for (const encoding of ['utf8', 'utf16le']) {
      await fs.writeFile(filename, '\uFEFF' + saved, encoding);
      assert.equal(await outputOf(['--load', filename, '--steps', '0', '--format', 'json']), saved);
    }
  } finally {
    await fs.rm(filename, { force: true });
    await fs.rmdir(directory);
  }
});

test('unreadable, malformed and invalid checkpoints fail before emitting a frame', async () => {
  let text = '';
  const out = { write(chunk) { text += chunk; } };
  for (const bad of ['', 'plain text', '{}', 'null']) {
    await assert.rejects(main(['--load', '-', '--animate'], out, Readable.from([bad])), /checkpoint/i);
  }
  await assert.rejects(main(['--load', path.join(__dirname, 'absent-checkpoint.json')], out), /ENOENT/);
  assert.equal(text, '');
});

test('multi-character ASCII IDs near the right edge stay inside a 72-column row', async () => {
  const w = new World({ width: 720, height: 200 });
  for (let i = 0; i < 35; i++) w.addBall({ x: 2 + i * 15, y: 2, radius: 1 });
  w.addBall({ x: 719, y: 199, radius: 1 });
  const lines = (await outputOf(['--load', '-', '--steps', '0'], false, JSON.stringify(w.snapshot()))).split('\n');
  assert.equal(lines[0], 'Impulse Court | Imported court');
  for (const row of lines.slice(2, 22)) assert.match(row, /^\|.{72}\|$/);
  assert.match(lines[21], /10\|$/);
});

test('animated traces print each collision only in the frame in which it occurs', async () => {
  const w = new World({ width: 100, height: 100 });
  w.addBall({ x: 89, y: 50, radius: 10, vx: 120 });
  const text = await outputOf(['--load', '-', '--trace', '--animate', '--steps', '5'], false, JSON.stringify(w.snapshot()));
  const frames = text.split('Impulse Court').slice(1);
  assert.equal(frames.length, 3);
  assert.doesNotMatch(frames[0], /hit the right wall/);
  assert.match(frames[1], /0\.008333 s  Ball 1 hit the right wall/);
  assert.doesNotMatch(frames[2], /hit the right wall/);
});

test('the bank shot stops between ticks on the chosen ball, traces earlier hits and resumes from contact', async () => {
  const args = ['--scene', 'bank-shot', '--until', 'ball:1', '--trace', '--steps', '240'];
  const saved = await outputOf([...args, '--format', 'json']);
  const state = JSON.parse(saved);
  near(state.time, 129 / 144);
  near(state.time / TICK, 107.5);
  near(state.balls[0].vx, 67.2);
  near(state.balls[0].vy, -230.4);
  assert.deepEqual(state.impacts.map(e => [e.ballId, e.railId]), [[2, 2], [3, 1], [1, 1]]);
  assert.deepEqual(state.stop, { target: 'ball:1', impact: state.impacts.at(-1) });
  assert.equal(state.stop.impact.time, state.time);
  const resumed = JSON.parse(await outputOf(['--load', '-', '--steps', '1', '--trace', '--format', 'json'], false, saved));
  near(resumed.time, state.time + TICK);
  assert.equal(resumed.railHits, 3);
  assert.deepEqual(resumed.impacts, []);
  assert.equal(resumed.stop, undefined);
  const ascii = await outputOf(args);
  for (const text of ['R1', 'R2', 'Rail hits 3', 'Stopped at 0.895833 s  Ball 1 hit rail 1']) assert.ok(ascii.includes(text));
});

test('impact targets match either ball in a pair, a named post, rail or wall, and respect the tick limit', async () => {
  for (const [scene, target, match] of [
    ['mass-mismatch', 'ball:2', { type: 'ball', otherBallId: 2 }],
    ['mass-mismatch', 'pair', { type: 'ball' }],
    ['turnstile-slalom', 'bumper:3', { type: 'bumper', bumperId: 3 }],
    ['turnstile-slalom', 'wall:bottom', { type: 'wall', wall: 'bottom' }],
    ['bank-shot', 'rail:1', { type: 'rail', railId: 1 }],
    ['bank-shot', 'any', { type: 'rail', railId: 2 }]
  ]) {
    const state = JSON.parse(await outputOf(['--scene', scene, '--until', target, '--format', 'json']));
    assert.equal(state.stop.target, target);
    for (const [key, value] of Object.entries(match)) assert.equal(state.stop.impact[key], value);
    assert.equal(state.stop.impact.time, state.time);
    assert.equal(state.impacts, undefined);
  }
  const limited = JSON.parse(await outputOf(['--until', 'pair', '--steps', '1', '--format', 'json']));
  assert.deepEqual(limited.stop, { target: 'pair', impact: null });
  assert.equal(limited.time, TICK);
  assert.match(await outputOf(['--until', 'any', '--steps', '0']), /tick limit/);
});

test('animated playback stops on the matching instant even inside the first frame', async () => {
  const w = new World({ width: 100, height: 100 });
  w.addBall({ x: 89.5, y: 40, radius: 10, vx: 120 });
  const text = await outputOf(['--load', '-', '--until', 'any', '--animate', '--steps', '120'], false, JSON.stringify(w.snapshot()));
  const frames = text.split('Impulse Court').slice(1);
  assert.equal(frames.length, 2);
  assert.doesNotMatch(frames[0], /Stopped at/);
  assert.match(frames[1], /Stopped at 0.004167 s  Ball 1 hit the right wall/);
});

const csvHeader = 'sample,time,ballId,x,y,vx,vy,speed,kineticEnergy';
function csvRows(text) {
  const [header, ...lines] = text.trimEnd().split('\n');
  assert.equal(header, csvHeader);
  const keys = header.split(',');
  return lines.map(line => {
    const numbers = line.split(',').map(Number);
    assert.equal(numbers.length, keys.length);
    return Object.fromEntries(keys.map((key, i) => [key, numbers[i]]));
  });
}

test('CSV records each ball at the imported time, selected ticks and final partial interval', async () => {
  const w = new World({ width: 100, height: 100, drag: 0.3, restitution: 0.7 });
  w.addBall({ x: 88, y: 45, radius: 10, vx: 120, vy: -3 });
  w.addBall({ x: 25, y: 75, radius: 6, vy: -8 });
  w.time = 1.75;
  const text = await outputOf(['--load', '-', '--format', 'csv', '--steps', '5', '--sample-every', '2'], false, JSON.stringify(w.snapshot()));
  const rows = csvRows(text);
  assert.equal(rows.length, 8);
  for (const [sample, count] of [0, 2, 2, 1].entries()) {
    for (let tick = 0; tick < count; tick++) w.step();
    for (const b of w.balls) {
      const row = rows[2 * sample + b.id - 1];
      assert.deepEqual([row.sample, row.time, row.ballId, row.x, row.y, row.vx, row.vy],
        [sample, w.time, b.id, b.x, b.y, b.vx, b.vy]);
      near(row.speed, Math.hypot(b.vx, b.vy));
      near(row.kineticEnergy, 0.5 * b.mass * row.speed ** 2);
    }
  }
  assert.equal(w.wallHits, 1);
  assert.deepEqual(csvRows(await outputOf(['--load', '-', '--format', 'csv', '--steps', '0'], false, JSON.stringify(w.snapshot())))
    .map(row => row.sample), [0, 0]);
  const defaults = csvRows(await outputOf(['--scene', 'mass-mismatch', '--format', 'csv', '--steps', '121']));
  assert.deepEqual(defaults.map(row => row.sample), [0, 0, 1, 1, 2, 2]);
  near(defaults[2].time, 1);
});

test('CSV distinguishes a zero-time bounce, closes at a breakpoint and emits a header for an empty court', async () => {
  const args = ['--load', '-', '--format', 'csv', '--sample-every', '2', '--until', 'any', '--steps', '6'];
  for (const distance of [0, 0.5, 2]) {
    const w = new World({ width: 100, height: 100 });
    w.addBall({ x: 90 - distance, y: 40, radius: 10, vx: 120 });
    const rows = csvRows(await outputOf(args, false, JSON.stringify(w.snapshot())));
    assert.deepEqual(rows.map(r => [r.sample, r.time, r.vx]), [[0, 0, 120], [1, distance / 120, -120]]);
    assert.equal(rows[1].x, 90);
  }
  assert.equal(await outputOf(args, false, JSON.stringify(new World().snapshot())), csvHeader + '\n');
});

test('CSV waits for a slow output stream before writing more samples', async () => {
  const args = ['--scene', 'mass-mismatch', '--format', 'csv', '--sample-every', '1', '--steps', '3'];
  const output = new EventEmitter();
  let blocked = false;
  let text = '';
  output.write = chunk => {
    assert.equal(blocked, false);
    text += chunk;
    blocked = true;
    setImmediate(() => { blocked = false; output.emit('drain'); });
    return false;
  };
  await main(args, output);
  assert.equal(blocked, false);
  assert.equal(text, await outputOf(args));
});

test('seed, drag and forecast options reproduce a practice court and branch a checkpoint', async () => {
  const args = ['--seed', '0', '--drag', '0.4', '--steps', '37', '--forecast', '3', '--format', 'json'];
  const saved = await outputOf(args);
  const state = JSON.parse(saved);
  const w = createScene('practice-draw', 1, { seed: 0, drag: 0.4 });
  for (let i = 0; i < 37; i++) w.step();
  assert.deepEqual(state, { scene: 'practice-draw', seed: 0, ...w.snapshot(), forecast: w.forecast(3) });
  assert.equal(await outputOf(args), saved);
  const branched = JSON.parse(await outputOf(['--load', '-', '--steps', '0', '--drag', '0', '--format', 'json'], false, saved));
  assert.equal(branched.seed, 0);
  assert.equal(branched.drag, undefined);
  assert.equal(branched.forecast, undefined);
  assert.deepEqual(branched.balls, state.balls);
});

test('invalid recording intervals, missing target bodies and incompatible options fail before output', async () => {
  for (const args of [
    ['--sample-every', '2'], ['--format', 'csv', '--sample-every', '0'], ['--format', 'csv', '--sample-every', '2.1'],
    ['--format', 'csv', '--sample-every', '9007199254740992'], ['--format', 'csv', '--trace'],
    ['--format', 'csv', '--forecast', '1'], ['--format', 'csv', '--animate'], ['--until'], ['--until', 'wall:near'],
    ['--until', 'ball:7', '--animate'], ['--until', 'rail:1', '--format', 'csv'], ['--until', 'bumper:1'],
    ['--drag', 'Infinity'], ['--drag', '-1'], ['--seed', '1', '--load', '-'],
    ['--seed', '42', '--scene', 'bank-shot'], ['--seed', '4294967296'], ['--forecast', '7'], ['--forecast', '0']
  ]) {
    let text = '';
    await assert.rejects(main(args, { write(chunk) { text += chunk; } }, Readable.from([])), Error, args.join(' '));
    assert.equal(text, '');
  }
});

test('return lanes times both outbound shots and distinguishes their return speeds in JSON and ASCII', async () => {
  const args = ['--scene', 'return-lanes', '--steps', '480', '--trace'];
  const result = JSON.parse(await outputOf([...args, '--format', 'json']));
  assert.deepEqual(result.gates[0].counts, { forward: 2, reverse: 2 });
  assert.deepEqual(result.impacts.map(e => e.railId), [1, 2]);
  assert.deepEqual(result.crossings.map(e => [e.ballId, e.direction, e.vx]), [
    [1, 'forward', 240], [2, 'forward', 240], [1, 'reverse', -240], [2, 'reverse', -120]
  ]);
  result.crossings.forEach((e, i) => near(e.time, [1, 1, 3, 4][i]));
  const ascii = await outputOf(args);
  assert.match(ascii, /G1 crossings  \|  Forward 2  \|  Reverse 2/);
  const trace = ascii.split('\n').filter(line => line.includes(' s  Ball '));
  assert.deepEqual(trace.map(line => line.slice(0, 8)), ['1.000000', '1.000000', '2.000000', '2.000000', '3.000000', '4.000000']);
  assert.match(trace.at(-1), /Ball 2 crossed G1 reverse at 120.00 u\/s/);
});

test('stopping on a rail counts earlier crossings and a resumed run records only new ones', async () => {
  const args = ['--scene', 'return-lanes', '--trace', '--format', 'json'];
  const saved = await outputOf([...args, '--until', 'rail:2']);
  const stopped = JSON.parse(saved);
  near(stopped.time, 2);
  assert.equal(stopped.stop.impact.railId, 2);
  assert.deepEqual(stopped.gates[0].counts, { forward: 2, reverse: 0 });
  const resumed = JSON.parse(await outputOf(['--load', '-', '--steps', '240', '--trace', '--format', 'json'], false, saved));
  assert.deepEqual(resumed.crossings.map(e => e.direction), ['reverse', 'reverse']);
  assert.deepEqual(resumed.gates[0].counts, { forward: 2, reverse: 2 });
  assert.deepEqual(resumed.impacts, []);
  const full = JSON.parse(await outputOf([...args, '--steps', '480']));
  assert.deepEqual(resumed.balls, full.balls);
});

test('repeated court edits branch a loaded run at its saved time and are visible in the initial CSV sample', async () => {
  const preset = createScene('mass-mismatch', 0.8);
  preset.step(0.5);
  const saved = JSON.stringify(preset.snapshot());
  const edits = ['--load', '-', '--steps', '0', '--gate', '420,0,420,480', '--gate', '0,90,840,90',
    '--impulse', '2,80,-20', '--impulse', '2,4,8', '--surface', 'wall:right=0', '--surface', 'wall:left=0.9'];
  const state = JSON.parse(await outputOf([...edits, '--format', 'json'], false, saved));
  assert.deepEqual([state.balls[1].vx, state.balls[1].vy, state.time], [-15, -3, 0.5]);
  assert.deepEqual(state.gates.map(g => g.id), [1, 2]);
  assert.deepEqual(state.surfaceRestitution, { 'wall:right': 0, 'wall:left': 0.9 });
  assert.equal(state.crossings, undefined);
  const [first, second] = csvRows(await outputOf([...edits, '--format', 'csv'], false, saved));
  assert.equal(first.sample, 0);
  assert.deepEqual([second.time, second.x, second.vx, second.vy], [0.5, state.balls[1].x, -15, -3]);
  const cleared = JSON.parse(await outputOf(['--load', '-', '--surface', 'wall:right=default', '--steps', '0',
    '--format', 'json'], false, JSON.stringify(state)));
  assert.deepEqual(cleared.surfaceRestitution, { 'wall:left': 0.9 });
  assert.deepEqual(cleared.balls, state.balls);
});

test('animated traces emit a gate reading once and put arrival before a simultaneous rebound', async () => {
  const w = new World({ width: 100, height: 100 });
  w.addBall({ x: 89, y: 50, radius: 10, vx: 120 });
  const args = ['--load', '-', '--gate', '90,0,90,100', '--animate', '--steps', '5', '--trace'];
  const frames = (await outputOf(args, false, JSON.stringify(w.snapshot()))).split('Impulse Court').slice(1);
  assert.equal(frames.length, 3);
  assert.doesNotMatch(frames[0], /crossed/);
  assert.match(frames[1], /0\.008333 s  Ball 1 crossed G1 forward at 120.00 u\/s\n0\.008333 s  Ball 1 hit the right wall/);
  assert.doesNotMatch(frames[2], /crossed/);
});

test('invalid gate, material and impulse arguments fail before the first output row or frame', async () => {
  for (const args of [
    ['--gate', '1,2,3'], ['--gate', ',1,2,3'], ['--gate', '0,0,1,Infinity'], ['--gate', '1,2,1,2'],
    ['--gate', '0,-1,100,0'], ['--surface', 'wall:top='], ['--surface', 'wall:left=0=1'],
    ['--surface', 'wall:near=0.5'], ['--surface', 'rail:12=default'], ['--surface', 'wall:top=-0.1'],
    ['--surface', 'wall:bottom=NaN'], ['--impulse', '0,1,2'], ['--impulse', '2.5,1,2'],
    ['--impulse', '2,-4,'], ['--impulse', '1,NaN,2'], ['--impulse', '7,10,10']
  ]) {
    let text = '';
    await assert.rejects(main(['--format', 'csv', ...args], { write(chunk) { text += chunk; } }), Error, args.join(' '));
    assert.equal(text, '');
  }
});
