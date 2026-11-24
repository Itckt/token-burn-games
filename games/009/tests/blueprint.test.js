"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../js/blueprint");
const T = require("../js/track");

test("portable blueprints round-trip every preset, editable piece and forced uphill ramp", () => {
  const pieces = [...T.LIBRARY.map(piece => piece.id), "rise"];
  const layouts = [...Object.values(T.PRESETS), {
    name: "九龍塘 / Studio 4", height: 5.75, pieces: Array.from({length: T.LIMIT}, (_, i) => pieces[i % pieces.length])
  }];
  for (const layout of layouts) {
    const code = B.encode(layout);
    const decoded = B.decode(" \r\n" + code + "\n");
    assert.deepEqual(decoded, layout);
    assert.notEqual(decoded.pieces, layout.pieces);
    assert.equal(B.encode(decoded), code);
    assert.deepEqual(T.build(decoded).sections.map(s => s.type), ["launch", ...layout.pieces, "finish"]);
  }
  assert.equal(B.encode(T.PRESETS.relay), "LF1/4/DPOBLSR/Lion Rock Relay");
  assert.deepEqual(B.decode("LF1/0.9//A/B"), {name: "A/B", height: 0.9, pieces: []});
  assert.equal(B.decode("LF1/12/U/<Bridge>").name, "<Bridge>");
});

test("invalid, oversized and unsupported blueprints fail before entering history", () => {
  const e = new T.Editor();
  for (const input of [null, {}, "", "LF2/4/S/Track", "LF1/4", "LF1/4/S/ ", "LF1/4/S/Two\nLines",
    "LF1/-2/S/Test", "LF1/0.89/S/Test", "LF1/12.01/S/Test", "LF1/NaN/S/Test", "LF1/1e1/S/Test",
    "LF1/4/SX/Test", "LF1/4/constructor/Test", "LF1/4/" + "S".repeat(49) + "/Test",
    "LF1/4//" + "n".repeat(49), "LF1/4//A\u0000B", "x".repeat(257)]) {
    assert.throws(() => e.commit(B.decode(input)));
    assert.deepEqual(e.layout, T.PRESETS.switchback);
  }
  assert.equal(e.past.length, 0);
  for (const field of [{height: Infinity}, {name: ""}, {pieces: ["launch"]}, {pieces: ["__proto__"]}]) {
    assert.throws(() => B.encode({...e.layout, ...field}));
  }
  assert.ok(e.commit(B.decode("LF1/4/UPB/Workshop")));
  assert.ok(e.undo());
  assert.deepEqual(e.layout, T.PRESETS.switchback);
  assert.ok(e.redo());
  assert.deepEqual(e.layout.pieces, ["rise", "drive", "brake"]);
});

test("a missing blueprint piece is rejected before encoding can shorten the course", () => {
  const pieces = ["straight", , "jump"];
  assert.throws(() => B.encode({...T.PRESETS.empty, pieces}), /unknown piece/);
  assert.throws(() => B.encode({...T.PRESETS.empty, pieces: "SJ"}), /list of pieces/);
  assert.equal(B.encode(T.PRESETS.podium), "LF1/4/SJSBLS/Podium Post");
});
