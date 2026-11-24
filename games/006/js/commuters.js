(function () {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const { Mesh, paint, PART } = node ? require('./mesh.js') : Nightline.mesh;
  const { MAX_WAITING } = node ? require('./passengers.js') : Nightline.passengers;
  const coats = [0x51857a, 0xc08a55, 0x647888, 0xa86050, 0x859373, 0x686584, 0x96a5aa].map(c => paint(c));
  const skins = [0xc49570, 0xd7ae88, 0xa77b5f].map(c => paint(c));
  const trousers = paint(0x39444c), shoes = paint(0x343b3a), hair = paint(0x39312e);
  const canvas = paint(0xb69869), strap = paint(0x54493c);

  // Octagonal cross-sections give the shoulders, chin and hair a silhouette
  // from both the approaching train and the open doorway. Faces point along -X.
  function buildRiders() {
    const m = new Mesh();
    for (let slot = 0; slot <= MAX_WAITING; slot++) {
      m.part = PART.RIDER + slot;
      const coat = coats[slot], skin = skins[slot % skins.length];
      const height = [1, 0.96, 1.04, 0.98][slot % 4];
      const v = (x, y, z) => [x, y * height, z];
      const leg = (a, b, r, finish) => m.tube(v(...a), v(...b), r, finish, 6);
      function section(low, high, finish) {
        const point = ([y, rx, rz, dx], side) => {
          const angle = side * Math.PI / 4;
          return v(dx + rx * Math.cos(angle), y, rz * Math.sin(angle));
        };
        for (let i = 0; i < 8; i++) {
          m.quad(point(low, i), point(high, i), point(high, i + 1), point(low, i + 1), finish);
        }
      }
      for (const side of [-1, 1]) {
        const z = side * 0.105, foot = side * 0.025;
        m.box(foot - 0.15, 0, z - 0.065, foot + 0.085, 0.09, z + 0.065, shoes);
        leg([foot, 0.075, z], [0, 0.82, z * 0.82], 0.082, trousers);
        leg([0, 1.36, side * 0.17], [0.026, 1.09, side * 0.224], 0.071, coat);
        leg([0.026, 1.09, side * 0.224], [-0.038, 0.90, side * 0.229], 0.054, coat);
        m.box(-0.078, 0.82 * height, side * 0.229 - 0.035,
          0.003, 0.91 * height, side * 0.229 + 0.035, skin);
      }
      const hip = [0.77, 0.137, 0.19, 0.01], shoulder = [1.34, 0.125, 0.212, 0];
      const collar = [1.43, 0.070, 0.089, -0.004];
      section(hip, shoulder, coat); section(shoulder, collar, coat);
      const chin = [1.43, 0.08, 0.082, -0.025], temple = [1.59, 0.117, 0.108, -0.013];
      section(collar, [1.455, 0.067, 0.068, -0.01], skin);
      section(chin, temple, skin);
      const crown = [1.68, 0.087, 0.084, 0.003];
      section(temple, crown, hair);
      m.box(-0.069, 1.675 * height, -0.065, 0.073, 1.688 * height, 0.065, hair);
      if (slot % 2 === 0) {
        m.box(0.105, 0.91 * height, -0.14, 0.208, 1.26 * height, 0.14, canvas);
        for (const z of [-0.092, 0.092]) leg([-0.11, 1.22, z], [0.112, 1.37, z], 0.017, strap);
      }
    }
    return m.finish();
  }

  const api = { buildRiders };
  if (node) module.exports = api;
  else Nightline.commuters = api;
})();
