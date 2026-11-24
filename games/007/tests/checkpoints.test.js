"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const cube = require("../js/cube.js");
const { Shelf, NAME_LIMIT } = require("../js/checkpoints.js");
const { memoryStorage, seeded } = require("./helpers.js");

test("three independent checkpoints round-trip solved, long and unsimplified histories", () => {
  const store = memoryStorage(), shelf = new Shelf(store);
  const histories = [[], cube.scramble(620, seeded(400)), ["U", "U'", ...cube.ALL_MOVES]];
  const names = ["", "Kowloon Tong warm-up", "交功課前"];
  histories.forEach((moves, i) => {
    const input = moves.slice();
    assert.equal(shelf.save(i, " " + names[i] + " ", input), true);
    input.push("F");
    const saved = shelf.get(i);
    assert.deepEqual(saved, { name: names[i], moves });
    assert.throws(() => saved.moves.push("R"), TypeError);
  });
  assert.equal(store.items.size, 3);
  const reopened = new Shelf(store);
  histories.forEach((moves, i) => assert.deepEqual(reopened.get(i), { name: names[i], moves }));
  assert.ok(reopened.clear(1));
  const another = new Shelf(store);
  assert.equal(another.get(1), null);
  assert.deepEqual(another.get(2), shelf.get(2));
});

test("invalid saves and slot indexes leave all checkpoint data intact", () => {
  const store = memoryStorage(), shelf = new Shelf(store);
  shelf.save(0, "original", ["R2"]);
  const original = shelf.get(0), serialized = [...store.items.entries()];
  for (const bad of [-1, 3, "0", NaN, 1.5]) {
    assert.throws(() => shelf.save(bad, "", []), RangeError);
    assert.throws(() => shelf.get(bad), RangeError);
    assert.throws(() => shelf.clear(bad), RangeError);
  }
  for (const [name, moves] of [[null, []], ["x".repeat(NAME_LIMIT + 1), []], ["", "RU"], ["", ["R", "E"]],
    ["bad", [,,,]], ["bad", ["R", null]]]) assert.throws(() => shelf.save(0, name, moves));
  assert.equal(shelf.get(0), original);
  assert.deepEqual([...store.items.entries()], serialized);
});

test("corrupt and incompatible saved slots stay empty without losing neighboring slots", () => {
  const store = memoryStorage(), shelf = new Shelf(store);
  shelf.save(0, "intact", ["B'"]);
  shelf.save(1, "replace me", ["D"]);
  const key = [...store.items.keys()][1];
  for (const junk of ["???", "null", "[]", "{}", '{"name":1,"moves":[]}', '{"name":"","moves":["Y"]}']) {
    store.setItem(key, junk);
    const restored = new Shelf(store);
    assert.equal(restored.get(1), null);
    assert.deepEqual(restored.get(0), { name: "intact", moves: ["B'"] });
  }
});

test("open shelves accept external slot changes and clears without overwriting unrelated slots", () => {
  const store = memoryStorage(), a = new Shelf(store), b = new Shelf(store);
  a.save(0, "before", ["R"]);
  b.save(2, "after", ["F"]);
  const [firstKey, lastKey] = store.items.keys();
  assert.deepEqual(a.sync(lastKey), [2]);
  assert.deepEqual(b.sync(firstKey), [0]);
  assert.deepEqual(a.get(2), b.get(2));
  assert.deepEqual(a.get(0), b.get(0));
  b.clear(0);
  assert.deepEqual(a.sync("twistlab.trial.v1.1-DRILL"), []);
  assert.ok(a.get(0));
  a.sync(firstKey);
  assert.equal(a.get(0), null);
  store.items.clear();
  b.sync(null);
  assert.equal(b.get(2), null);
});

test("denied reads and failed writes preserve a usable session copy and permit a later retry", () => {
  const deny = () => { throw new Error("Storage unavailable"); };
  for (const storage of [undefined, { getItem: deny, setItem: deny, removeItem: deny }]) {
    const s = new Shelf(storage);
    assert.equal(s.save(0, "one", ["U"]), false);
    assert.deepEqual(s.get(0).moves, ["U"]);
    assert.equal(s.clear(0), false);
    assert.equal(s.get(0), null);
  }
  const store = memoryStorage(), s = new Shelf(store), allowed = store.setItem;
  s.save(0, "old", ["U"]);
  store.setItem = deny;
  assert.equal(s.save(0, "new", ["F"]), false);
  s.sync();
  assert.equal(s.get(0).name, "new");
  assert.equal(new Shelf(store).get(0).name, "old");
  store.setItem = allowed;
  assert.ok(s.save(0, "retry", s.get(0).moves));
  assert.deepEqual(new Shelf(store).get(0), { name: "retry", moves: ["F"] });
});
