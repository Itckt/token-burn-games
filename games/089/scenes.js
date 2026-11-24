'use strict';

const CourtScenes = (() => {
  const { World } = typeof module !== 'undefined' && module.exports
    ? require('./physics.js') : CourtPhysics;

  const DRAW_SCENE = 'practice-draw';
  const DEFAULT_SEED = 852;

  function readSeed(value) {
    const seed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new RangeError('Seed must be a whole number from 0 to 4294967295.');
    }
    return seed;
  }

  function practiceLayout(seed) {
    let state = readSeed(seed);
    function integer(count) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return Math.floor(state / 0x100000000 * count);
    }
    // One body per 140 × 120 cell. Even adjacent cells at maximum jitter
    // have room for two full-sized posts, so every seed finishes in nine draws.
    const cells = Array.from({ length: 24 }, (_, i) => i);
    function position() {
      const [cell] = cells.splice(integer(cells.length), 1);
      return { x: (cell % 6) * 140 + 50 + integer(41), y: Math.floor(cell / 6) * 120 + 42 + integer(37) };
    }
    function velocity() {
      const magnitude = 70 + integer(151);
      return integer(2) ? magnitude : -magnitude;
    }
    const bumpers = Array.from({ length: 3 }, () => ({ ...position(), radius: 24 + integer(11) }));
    const balls = Array.from({ length: 6 }, () => ({
      ...position(), radius: 14 + integer(11), vx: velocity(), vy: velocity()
    }));
    return { bumpers, balls };
  }

  const scenes = {
    'kowloon-six': {
      name: 'Kowloon Six',
      description: 'Two trios share the court after class in Kowloon Tong.',
      balls: [
        { x: 151, y: 111, vx: 139, vy: 65, radius: 25 },
        { x: 262, y: 281, vx: 91, vy: -82, radius: 30 },
        { x: 112, y: 381, vx: 173, vy: -44, radius: 20 },
        { x: 643, y: 108, vx: -117, vy: 96, radius: 24 },
        { x: 498, y: 246, vx: -94, vy: -49, radius: 32 },
        { x: 724, y: 360, vx: -149, vy: 31, radius: 22 }
      ]
    },
    'mass-mismatch': {
      name: 'Mass mismatch',
      description: 'A light ball meets one four times its mass. Watch their speeds after impact.',
      balls: [
        { x: 188, y: 240, vx: 198, vy: 0, radius: 20 },
        { x: 604, y: 240, vx: -36, vy: 0, radius: 40 }
      ]
    },
    'opening-break': {
      name: 'Opening break',
      description: 'One fast ball breaks a triangular rack of six equal masses.',
      balls: [
        { x: 128, y: 240, vx: 410, vy: 0, radius: 20 },
        { x: 486, y: 240, radius: 20 },
        { x: 523, y: 218.5, radius: 20 },
        { x: 523, y: 261.5, radius: 20 },
        { x: 560, y: 197, radius: 20 },
        { x: 560, y: 240, radius: 20 },
        { x: 560, y: 283, radius: 20 }
      ]
    },
    'turnstile-slalom': {
      name: 'Turnstile slalom',
      description: 'Three balls bank off the gates on the walk from HKBU to Kowloon Tong station.',
      bumpers: [
        { x: 295, y: 175, radius: 34 },
        { x: 430, y: 322, radius: 42 },
        { x: 585, y: 204, radius: 34 }
      ],
      balls: [
        { x: 106, y: 159, radius: 18, vx: 330, vy: 26 },
        { x: 735, y: 220, radius: 20, vx: -250, vy: -15 },
        { x: 420, y: 431, radius: 16, vx: 50, vy: -180 }
      ]
    },
    'bank-shot': {
      name: 'Bank shot',
      description: 'Follow ball 1 into the sloping rail, then compare its next bank with a hit on a round end.',
      rails: [
        { x1: 320, y1: 300, x2: 500, y2: 165, radius: 9 },
        { x1: 535, y1: 340, x2: 705, y2: 340, radius: 12 }
      ],
      balls: [
        { x: 140, y: 240, vx: 240, radius: 18 },
        { x: 788, y: 350, vx: -136, radius: 16 },
        { x: 570, y: 84, vx: -86, vy: 120, radius: 20 }
      ]
    },
    'return-lanes': {
      name: 'Return lanes',
      description: 'Two equal shots cross G1 on the way out. Time the return trip from the hard and soft rails.',
      gates: [{ x1: 420, y1: 60, x2: 420, y2: 420 }],
      rails: [
        { x1: 686, y1: 80, x2: 686, y2: 220, radius: 8 },
        { x1: 686, y1: 260, x2: 686, y2: 400, radius: 8 }
      ],
      surfaceRestitution: { 'rail:2': 0.5 },
      balls: [
        { x: 180, y: 150, vx: 240, radius: 18 },
        { x: 180, y: 330, vx: 240, radius: 18 }
      ]
    },
    [DRAW_SCENE]: {
      name: 'Practice draw',
      description: 'Two trios draw starting spots around three posts for a study break in Kowloon Tong.',
      generate: practiceLayout
    }
  };

  function createScene(key = 'kowloon-six', restitution = 1, { drag = 0, seed = DEFAULT_SEED } = {}) {
    if (!Object.hasOwn(scenes, key)) throw new RangeError('Unknown scene: ' + key);
    const preset = scenes[key];
    const layout = preset.generate ? preset.generate(seed) : preset;
    const world = new World({ restitution, drag });
    for (const bumper of layout.bumpers ?? []) world.addBumper(bumper);
    for (const rail of layout.rails ?? []) world.addRail(rail);
    for (const gate of layout.gates ?? []) world.addGate(gate);
    for (const [surface, value] of Object.entries(layout.surfaceRestitution ?? {})) {
      world.setSurfaceRestitution(surface, value);
    }
    for (const ball of layout.balls) world.addBall(ball);
    return world;
  }

  function addFreeBall(world) {
    const n = world.balls.length;
    const radius = [19, 22, 16][n % 3];
    if (radius * 2 >= Math.min(world.width, world.height)) return null;
    const columns = Math.floor(world.width / (2 * radius));
    const rows = Math.floor(world.height / (2 * radius));
    const cellWidth = world.width / columns;
    const cellHeight = world.height / rows;
    const slots = rows * columns;
    for (let i = 0; i < slots; i++) {
      const slot = (n * 67 + i) % slots;
      const x = (slot % columns + 0.5) * cellWidth;
      const y = (Math.floor(slot / columns) + 0.5) * cellHeight;
      if (world.canPlace(x, y, radius)) {
        const angle = (n + 1) * 2.399963;
        const speed = 110 + n % 5 * 15;
        return world.addBall({
          x, y, radius, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed
        });
      }
    }
    return null;
  }

  function readCheckpoint(text) {
    let state;
    try {
      state = JSON.parse(text.trimStart());
    } catch {
      throw new Error('Checkpoint must contain valid JSON.');
    }
    const world = World.fromSnapshot(state);
    const scene = typeof state.scene === 'string' && Object.hasOwn(scenes, state.scene) ? state.scene : 'custom';
    const seed = scene === DRAW_SCENE ? readSeed(state.seed === undefined ? DEFAULT_SEED : state.seed) : undefined;
    return { world, scene, seed };
  }

  function checkpoint({ world, scene, seed = DEFAULT_SEED }) {
    const state = { scene, ...world.snapshot() };
    if (scene === DRAW_SCENE) state.seed = readSeed(seed);
    return state;
  }

  return { scenes, createScene, addFreeBall, readCheckpoint, checkpoint, DRAW_SCENE, DEFAULT_SEED, readSeed };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CourtScenes;
