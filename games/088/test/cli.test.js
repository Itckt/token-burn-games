"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Readable, PassThrough } = require("node:stream");
const { simulate, asText, asSvg } = require("../automaton.js");
const { main } = require("../explore.js");

async function run(args = [], input = "") {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "", err = "";
  stdout.setEncoding("utf8").on("data", text => { out += text; });
  stderr.setEncoding("utf8").on("data", text => { err += text; });
  const status = await main(args, { stdin: Readable.from([input]), stdout, stderr });
  return { status, stdout: out, stderr: err };
}

async function success(args, input) {
  const { status, stderr, stdout } = await run(args, input);
  assert.equal(status, 0, stderr);
  assert.equal(stderr, "");
  return stdout;
}

test("the default command prints a clean, terminal-sized diagram", async () => {
  const output = await success();
  const rows = output.trimEnd().split("\n");
  assert.equal(rows.length, 32);
  assert.ok(rows.every(row => /^[.#]{63}$/.test(row)));
  assert.equal(rows[0], ".".repeat(31) + "#" + ".".repeat(31));
  assert.equal(output, asText(simulate({ width: 63, rows: 32 }).history));
});

test("help works without input and documents both exploration modes", async () => {
  assert.match(await success(["--help"]), /Usage: node explore\.js/);
  assert.match(await success(["-h"]), /--interactive/);
});

test("one-shot text supports inline arguments, binary seeds, orientation and wrapping", async () => {
  const args = ["--rule=170", "--width", "5", "--rows=4", "--seed", "10000"];
  assert.equal(await success(args), "#....\n.....\n.....\n.....\n");
  assert.equal(await success([...args, "--boundary=wrap"]), "#....\n....#\n...#.\n..#..\n");
  assert.equal(await success(["--rule", "0", "--width", "1", "--rows", "2"]), "#\n.\n");
  assert.equal(await success(["--rule", "255", "--width", "1", "--rows", "2", "--seed", "0"]), ".\n#\n");
});

test("one-shot SVG uses the configured history and writes only the image to stdout", async () => {
  const settings = { rule: 150, width: 24, rows: 7, seed: "random", key: 0xffffffff, boundary: "wrap" };
  const args = Object.entries(settings).flatMap(([name, value]) => ["--" + name, String(value)]);
  assert.equal(await success([...args, "--format", "svg"]), asSvg(simulate(settings).history));
});

test("table output includes the eight outputs with leading zeros intact", async () => {
  assert.equal(await success(["--rule", "1", "--format", "table"]), [
    "Rule 1 (00000001)", "111 -> 0", "110 -> 0", "101 -> 0", "100 -> 0",
    "011 -> 0", "010 -> 0", "001 -> 0", "000 -> 1", "",
  ].join("\n"));
});

test("bad command-line input exits unsuccessfully, with an actionable error only on stderr", async () => {
  const cases = [
    [["--rule"], /needs a value/], [["--rule", "--rows", "4"], /needs a value/],
    [["--rule=256"], /Rule/], [["--rule", "-1"], /Rule/], [["--width", "0"], /Width/],
    [["--rows", "1.2"], /Row count/], [["--key", "4294967296"], /Random key/],
    [["--seed", "12"], /seed/], [["--width", "2", "--seed", "101"], /fit/],
    [["--boundary", "loop"], /Boundary/], [["--format=zip"], /Format/], [["--huh"], /Unknown/],
    [["31"], /Unknown/], [["-i", "--format", "svg"], /Interactive/],
  ];
  for (const [args, expected] of cases) {
    const { status, stderr, stdout } = await run(args);
    assert.equal(status, 1, args.join(" "));
    assert.equal(stdout, "");
    assert.match(stderr, expected);
    assert.match(stderr, /--help/);
    assert.doesNotMatch(stderr, /at .+\.js:/);
  }
});

test("a piped session steps incrementally, resets, flips an output and stops at quit", async () => {
  const output = await success(["-i", "--width", "7", "--rows", "1"], [
    "step", "step 2", "reset", "flip 000", "table", "quit", "rule 255", "",
  ].join("\r\n"));
  assert.match(output, /Generation 1\n\.\.#\.#\.\.\nGenerations 2 to 3\n\.#\.\.\.#\.\n#\.#\.#\.#\n/);
  assert.match(output, /Rule 90 \| 7 cells x 1 row \| single \| fixed\n\.\.\.#\.\.\.\nRule 91/);
  assert.match(output, /Rule 91 \(01011011\)[\s\S]+000 -> 1\n$/);
  assert.doesNotMatch(output, /Rule 255|atlas>/);
});

test("interactive configuration supports seeded replay and a clean end of input", async () => {
  const output = await success(["--interactive", "--width=8", "--rows=3"], [
    "rule 204", "seed campus", "boundary wrap", "width 12", "rows 2", "key 123", "seed random", "show",
  ].join("\n"));
  const random = asText(simulate({ rule: 204, width: 12, rows: 2, seed: "random", key: 123, boundary: "wrap" }).history);
  assert.match(output, /Rule 204 \| 8 cells x 3 rows \| campus \| wrap/);
  assert.ok(output.endsWith((`Rule 204 | 12 cells x 2 rows | random (key 123) | wrap\n` + random).repeat(2)));
});

test("errors in a session preserve the previous diagram and allow further commands", async () => {
  const output = await success(["-i", "--width", "3", "--rows", "2", "--rule=204", "--seed=101"], [
    "rule 999", "step 511", "step -1", "flip 11", "seed 12", "width 2", "rule", "show extra",
    "unknown", "step 1 2", "", "help", "show", "exit", "",
  ].join("\n"));
  assert.equal((output.match(/^Error:/gm) || []).length, 10);
  assert.match(output, /flip BITS/);
  assert.ok(output.endsWith("Rule 204 | 3 cells x 2 rows | 101 | fixed\n#.#\n#.#\n"));
});

test("stats and CSV report cell activity including the seed's empty change count", async () => {
  const args = ["--rule=0", "--width=3", "--seed=101", "--rows=4"];
  assert.equal(await success([...args, "--format=stats"]), [
    "Rule 0 | generation 3", "0 of 3 cells on.", "0 cells changed since generation 2.",
    "Generation 2 repeats generation 1 (fixed point, period 1).", "",
  ].join("\n"));
  const csv = "generation,live,changed\n0,2,\n1,0,2\n2,0,0\n3,0,0\n";
  assert.equal(await success([...args, "--format=csv"]), csv);
  const session = await success(["-i", ...args], "stats 0\nstats 1\ncsv\nquit\n");
  assert.match(session, /Rule 0 \| generation 0\n2 of 3 cells on\.\nSeed row\.\nNo repeated row in 1 generation\./);
  assert.match(session, /2 cells changed since generation 0\.\nNo repeated row in 2 generations\./);
  assert.ok(session.endsWith(csv));
});

test("the CLI can query every symmetry and render the transformed run in existing formats", async () => {
  assert.equal(await success(["--rule=30", "--format=family"]), "Rule 30\nmirror -> Rule 86\ninvert -> Rule 135\nboth -> Rule 149\n");
  const args = ["--rule=170", "--width=4", "--rows=3", "--seed=1000"];
  assert.equal(await success([...args, "--transform=mirror"]), "...#\n....\n....\n");
  assert.equal(await success([...args, "--transform", "invert"]), ".###\n####\n####\n");
  const transformed = simulate({ rule: 240, width: 4, rows: 3, seed: "1110", boundary: "fixed-on" });
  assert.equal(await success([...args, "--transform=both", "--format=svg"]), asSvg(transformed.history));
  assert.match(await success([...args, "--transform=mirror", "--format=table"]), /^Rule 240 /);
  const session = await success(["-i", ...args, "--transform=mirror"], "transform mirror\nfamily\ntransform invert\nstep\nshow\n");
  assert.match(session, /Rule 170 \| 4 cells x 3 rows \| 1000 \| fixed\n/);
  assert.match(session, /mirror -> Rule 240\ninvert -> Rule 170/);
  assert.ok(session.endsWith("Rule 170 | 4 cells x 4 rows | 0111 | fixed-on\n.###\n####\n####\n####\n"));
});

test("parent reports use the chosen generation and boundary, with exact decimal counts", async () => {
  const args = ["--rule=170", "--width=4", "--rows=3", "--seed=1000", "--boundary=wrap"];
  assert.equal(await success([...args, "--format=parents"]),
    "Rule 170 | generation 2 | wrap\nTarget 0010\n1 predecessor\n0001\n");
  const session = await success(["-i", ...args], "parents 0\nparents\nshow\n");
  assert.match(session, /generation 0 \| wrap\nTarget 1000\n1 predecessor\n0100\n/);
  assert.match(session, /generation 2 \| wrap\nTarget 0010\n1 predecessor\n0001\n/);
  assert.ok(session.endsWith("Rule 170 | 4 cells x 3 rows | 1000 | wrap\n#...\n...#\n..#.\n"));
  assert.match(await success(["--rule=0", "--width=1", "--rows=1", "--format=parents"]), /Target 1\n0 predecessors\n$/);
  const big = await success(["--rule=0", "--width=512", "--rows=2", "--format=parents"]);
  assert.ok(big.includes(`\n${2n ** 512n} predecessors\n`));
  assert.deepEqual(big.trimEnd().split("\n").slice(3).map(s => s.length), [512, 512, 512]);
});

test("invalid transformations and out-of-range inspections leave session state usable", async () => {
  for (const args of [["--transform=unknown"], ["--transform"]]) {
    const result = await run(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /mirror|needs a value/);
  }
  const session = await success(["-i", "--rule=0", "--rows=1", "--width=1"], [
    "transform", "transform undo", "stats 1", "stats 0 1", "parents -1", "parents 0 1", "family 0",
    "boundary fixed-on", "parents", "show",
  ].join("\n"));
  assert.equal((session.match(/^Error:/gm) ?? []).length, 7);
  assert.match(session, /Target 1\n0 predecessors\n/);
  assert.ok(session.endsWith("Rule 0 | 1 cell x 1 row | single | fixed-on\n#\n"));
});

test("damage prints the distance and difference mask for every row of the applied run", async () => {
  const args = ["--rule=90", "--width=7", "--rows=5", "--format=damage"];
  assert.equal(await success(args), [
    "Rule 90 | fixed | flipped seed cell 3", "Flipped seed 0000000",
    "generation\tdistance\tdifference (# = different)", "0\t1\t...#...", "1\t2\t..#.#..",
    "2\t2\t.#...#.", "3\t4\t#.#.#.#", "4\t0\t.......", "The runs agree from generation 4.", "",
  ].join("\n"));
  const mirrored = await success(["--rule=170", "--seed=1000", "--width=4", "--rows=3",
    "--transform=mirror", "--format=damage", "--cell", "3"]);
  assert.match(mirrored, /^Rule 240 \| fixed \| flipped seed cell 3\nFlipped seed 0000/);
  assert.ok(mirrored.endsWith("0\t1\t...#\n1\t0\t....\n2\t0\t....\nThe runs agree from generation 1.\n"));
});

test("rule inference reads the configured run or exact literal rows of their own width", async () => {
  const args = ["--format=infer", "--boundary=wrap"];
  const expected = [
    "2 observed rows | 8 cells | wrap", "Outputs 111 to 000  10101010  (? unseen, ! conflicting)",
    "1 compatible rule", "170", "",
  ].join("\n");
  assert.equal(await success([...args, "--rule=170", "--seed=00010111", "--width=8", "--rows=2"]), expected);
  assert.equal(await success([...args, "--observe", "00010111/00101110"]), expected);
  assert.equal(await success([...args, "--observe=00010111\r\n00101110"]), expected);
  assert.equal(await success([...args, "--observe=0/0/1"]), [
    "3 observed rows | 1 cell | wrap", "Outputs 111 to 000  ???????!  (? unseen, ! conflicting)", "0 compatible rules", "",
  ].join("\n"));
});

test("basin reports list canonical cycle seeds, longest approaches and deterministic ties", async () => {
  assert.equal(await success(["--format=basins", "--rule=170", "--boundary=wrap", "--width=3"]), [
    "Rule 170 | 3 cells | wrap", "8 seeds in 4 basins", "cycle seed\tperiod\tseeds\tmax steps to cycle\texample seed",
    "001\t3\t3\t0\t001", "011\t3\t3\t0\t011", "000\t1\t1\t0\t000", "111\t1\t1\t0\t111", "",
  ].join("\n"));
  assert.match(await success(["--format=basins", "--rule=0"]), /8 cells \| fixed\n256 seeds in 1 basin\n/);
});

test("interactive experiments inspect prefixes, literal transitions, seed flips and other widths without changing the run", async () => {
  const session = await success(["-i", "--rule=170", "--seed=1000", "--width=4", "--rows=3", "--boundary=wrap"], [
    "infer 0", "infer 1000/0001", "infer", "damage 0", "basins 3", "basins", "help", "show",
  ].join("\n"));
  assert.match(session, /1 observed row \| 4 cells \| wrap[\s\S]*?256 compatible rules\n0 1 2 /);
  assert.match(session, /2 observed rows \| 4 cells \| wrap/);
  assert.match(session, /3 observed rows \| 4 cells \| wrap/);
  assert.match(session, /0\t1\t#\.\.\.\n1\t1\t\.\.\.#\n2\t1\t\.\.#\.\nNo agreement in 3 generations/);
  assert.match(session, /8 seeds in 4 basins/);
  assert.match(session, /16 seeds in 6 basins/);
  for (const command of ["damage [X]", "infer [G]", "basins [WIDTH]"]) assert.ok(session.includes(command));
  assert.ok(session.endsWith("Rule 170 | 4 cells x 3 rows | 1000 | wrap\n#...\n...#\n..#.\n"));
  const wide = await success(["-i", "--width=63", "--rule=0", "--rows=1"], "basins\n");
  assert.match(wide, /Rule 0 \| 8 cells \| fixed\n256 seeds in 1 basin/);
});

test("invalid experiment options fail cleanly and a session recovers from every bad query", async () => {
  for (const [args, error] of [
    [["--format=damage", "--width=1", "--cell=1"], /Seed cell/],
    [["--format=infer", "--observe=01/0"], /row 2/],
    [["--format=basins", "--width=13"], /Basin width/],
    [["--cell=2"], /--format damage/], [["--observe=1/0", "--format=stats"], /--format infer/],
    [["--format=damage", "--cell"], /needs a value/], [["--format=infer", "--observe"], /needs a value/],
  ]) {
    const reply = await run(args);
    assert.equal(reply.status, 1);
    assert.equal(reply.stdout, "");
    assert.match(reply.stderr, error);
  }
  const session = await success(["-i", "--rule=0", "--width=1", "--rows=1"], [
    "damage -1", "damage 0 1", "infer 1", "infer 0/10", "infer 0 0", "basins 0", "basins 2 3", "show",
  ].join("\n"));
  assert.equal((session.match(/^Error:/gm) ?? []).length, 7);
  assert.ok(session.endsWith("Rule 0 | 1 cell x 1 row | single | fixed\n#\n"));
});
