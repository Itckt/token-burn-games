"use strict";

const readline = require("node:readline");
const {
  DEFAULTS, TRANSFORMS, integer, simulate, extendRun, ruleTable, flipBit,
  transformRule, transformRun, rowText, asText, asSvg, quantity,
} = require("./automaton.js");
const {
  analyzeHistory, describeCycle, describeChange, findPredecessors, compareSeedFlip, describeAgreement,
  parseObservations, ruleEvidence, matchingRules, mapBasins, defaultBasinWidth,
} = require("./analysis.js");

const help = `Rule Atlas | Elementary cellular automata

Usage: node explore.js [options]

  --rule N          Wolfram rule, 0 to 255 (default 90)
  --width N         Cells per row, 1 to 512 (default 63)
                    Basin maps use 1 to 12 cells (default 8)
  --rows N          Rows including the seed, 1 to 512 (default 32)
  --seed SEED       single, alternating, campus, random or a binary pattern
  --key N           Random seed key, 0 to 4294967295 (default 42)
  --boundary MODE   fixed (outside off), fixed-on (outside on) or wrap (a ring)
                    Default is fixed
  --transform MODE  mirror, invert or both, applied to the configured run
  --format FORMAT   text (default), svg, table, family, stats, csv, parents,
                    damage, infer or basins
                    stats reports activity and cycles, csv lists activity by row
                    parents finds seeds one step before the final row
                    damage compares the run with one starting cell flipped
                    infer finds all rules consistent with observed transitions
                    basins maps every seed of the chosen width to a cycle
  --cell X          Seed cell for damage, counting from 0 (default middle)
  --observe ROWS    Literal binary rows for infer, separated by / (default run)
  -i, --interactive Start a line-oriented terminal session
  -h, --help        Show this help

Examples:
  node explore.js --rule 30 --width 31 --rows 16
  node explore.js -i --rule 110 --seed campus --boundary wrap
  node explore.js --rule 170 --width 7 --rows 8 --boundary wrap --format stats
  node explore.js --boundary wrap --format infer --observe 1000/0001/0010
`;

const commands = `show                Print the current diagram
step [N]            Append N generations and print the new rows (default 1)
reset               Return to generation zero with the same seed
rule N              Select a rule from 0 to 255
flip BITS           Toggle one output, e.g. flip 010
table               Print the eight neighbourhoods and their outputs
seed SEED           Set a preset or a centred pattern of 0s and 1s
key N               Set the repeatable random seed key
boundary MODE       Choose fixed, fixed-on or wrap
width N / rows N    Change diagram dimensions
stats [G]           Show activity and the first repeated row through generation G
csv                 Print generation, live cells and changes for every row
parents [G]         Count predecessors and print up to three sample seeds
                    G defaults to the last generation
family              List the mirrored and on/off-swapped rule numbers
transform MODE      Apply mirror, invert or both to the rule, seed and boundary
damage [X]          Flip seed cell X in a comparison run (default middle)
infer [G]           Find rules that fit generations 0 through G (default last)
infer ROW/ROW/...   Find rules that fit literal rows under the applied boundary
basins [WIDTH]      Map all seeds at width 1 to 12 (default current width, or 8)
help / quit         List commands or leave the session
`;

const settingNames = new Set(["rule", "width", "rows", "boundary", "seed", "key"]);
const formats = ["text", "svg", "table", "family", "stats", "csv", "parents", "damage", "infer", "basins"];

function parseArgs(args) {
  const overrides = {};
  const options = {};
  let format = "text";
  let transform = null;
  let interactive = false;
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === "-i" || token === "--interactive") { interactive = true; continue; }
    const match = /^--([a-z]+)(?:=(.*))?$/s.exec(token);
    if (!match || (!settingNames.has(match[1]) && !["format", "transform", "cell", "observe"].includes(match[1]))) {
      throw new Error(`Unknown argument "${token}".`);
    }
    const [, name, inline] = match;
    const value = inline === undefined ? args[++i] : inline;
    if (!value || value.startsWith("--") || value === "-i") {
      throw new Error(`--${name} needs a value.`);
    }
    if (name === "format") format = value;
    else if (name === "transform") transform = value;
    else if (settingNames.has(name)) overrides[name] = value;
    else options[name] = value;
  }
  if (!formats.includes(format)) throw new Error(`Format must be one of ${formats.join(", ")}.`);
  if (interactive && format !== "text") throw new Error("Interactive sessions use --format text.");
  if (options.cell !== undefined && format !== "damage") throw new Error("--cell requires --format damage.");
  if (options.observe !== undefined && format !== "infer") throw new Error("--observe requires --format infer.");
  const width = format === "basins" ? defaultBasinWidth(63) : 63;
  const settings = { ...DEFAULTS, width, rows: 32, ...overrides };
  return { settings, format, transform, interactive, options };
}

function tableText(rule) {
  const lines = ruleTable(rule).map(({ pattern, output }) => `${pattern} -> ${output}`);
  return [`Rule ${rule} (${rule.toString(2).padStart(8, "0")})`, ...lines, ""].join("\n");
}

function describe({ settings, history }) {
  const { rule, width, rows, seed, key, boundary } = settings;
  const seedLabel = seed === "random" ? `random (key ${key})` : seed;
  const size = `${quantity(width, "cell")} x ${quantity(rows, "row")}`;
  return `Rule ${rule} | ${size} | ${seedLabel} | ${boundary}\n` + asText(history);
}

function damageText(run, column) {
  const { cell, seed, differences, distances, firstAgreement } = compareSeedFlip(run, column);
  return [
    `Rule ${run.settings.rule} | ${run.settings.boundary} | flipped seed cell ${cell}`,
    `Flipped seed ${seed}`, "generation\tdistance\tdifference (# = different)",
    ...differences.map((row, g) => `${g}\t${distances[g]}\t${rowText(row)}`),
    describeAgreement(firstAgreement, differences.length), "",
  ].join("\n");
}

function inferenceText(history, boundary) {
  const evidence = ruleEvidence(history, boundary).at(-1);
  const { outputs, rules } = matchingRules(evidence);
  return [
    `${quantity(history.length, "observed row")} | ${quantity(history[0].length, "cell")} | ${boundary}`,
    `Outputs 111 to 000  ${outputs}  (? unseen, ! conflicting)`, quantity(rules.length, "compatible rule"),
    ...(rules.length ? [rules.join(" ")] : []), "",
  ].join("\n");
}

function basinText(rule, width, boundary) {
  const basins = mapBasins(rule, width, boundary);
  return [
    `Rule ${rule} | ${quantity(Number(width), "cell")} | ${boundary}`, `${2 ** width} seeds in ${quantity(basins.length, "basin")}`,
    "cycle seed\tperiod\tseeds\tmax steps to cycle\texample seed",
    ...basins.map(b => [b.representative, b.period, b.size, b.maxSteps, b.example].join("\t")), "",
  ].join("\n");
}

function report(run, format, options = {}) {
  const { settings, history } = run;
  const generation = options.generation ?? history.length - 1;
  const { rule, width, boundary } = settings;
  switch (format) {
    case "text": return asText(history);
    case "svg": return asSvg(history);
    case "table": return tableText(rule);
    case "damage": return damageText(run, options.cell);
    case "infer": {
      const observed = options.observe === undefined ? history.slice(0, generation + 1) : parseObservations(options.observe);
      return inferenceText(observed, boundary);
    }
    case "basins": return basinText(rule, options.basinWidth ?? width, boundary);
    case "family":
      return [`Rule ${rule}`, ...TRANSFORMS.map(mode => `${mode} -> Rule ${transformRule(rule, mode)}`), ""].join("\n");
    case "parents": {
      const target = history[generation].join("");
      const { count, samples } = findPredecessors(target, rule, boundary);
      return [`Rule ${rule} | generation ${generation} | ${boundary}`, `Target ${target}`,
        quantity(count, "predecessor"), ...samples, ""].join("\n");
    }
    case "stats": {
      const { activity, cycle } = analyzeHistory(history.slice(0, generation + 1));
      const { live, changed } = activity[generation];
      return [`Rule ${rule} | generation ${generation}`, `${live} of ${quantity(width, "cell")} on.`,
        describeChange(changed, generation), describeCycle(cycle, generation + 1), ""].join("\n");
    }
    case "csv": {
      const { activity } = analyzeHistory(history);
      return ["generation,live,changed", ...activity.map(({ live, changed }, g) =>
        `${g},${live},${changed ?? ""}`), ""].join("\n");
    }
  }
}

function executeCommand(current, line) {
  const [command, ...args] = line.trim().split(/\s+/);
  if (command === "step") {
    if (args.length > 1) throw new Error("Use step or step N.");
    const previous = current.history.length;
    const result = extendRun(current, args[0] ?? 1);
    const last = result.history.length - 1;
    const label = previous === last ? `Generation ${last}` : `Generations ${previous} to ${last}`;
    return { result, text: label + "\n" + asText(result.history.slice(previous)) };
  }
  if (settingNames.has(command) || command === "flip" || command === "transform") {
    if (args.length !== 1) throw new Error(`The ${command} command needs one value.`);
    if (command === "transform") return { result: transformRun(current, args[0]) };
    const change = command === "flip" ? { rule: flipBit(current.settings.rule, args[0]) } : { [command]: args[0] };
    return { result: simulate({ ...current.settings, ...change }) };
  }
  if (command === "damage" || command === "basins") {
    if (args.length > 1) throw new Error(`Use ${command} with at most one value.`);
    const options = command === "damage"
      ? { cell: args[0] }
      : { basinWidth: args[0] ?? defaultBasinWidth(current.settings.width) };
    return { text: report(current, command, options) };
  }
  if (command === "parents" || command === "stats" || command === "infer") {
    if (args.length > 1) throw new Error(`Use ${command} or ${command} G.`);
    if (command === "infer" && args[0]?.includes("/")) return { text: report(current, command, { observe: args[0] }) };
    const last = current.history.length - 1;
    const generation = integer(args[0] ?? last, 0, last, "Generation");
    return { text: report(current, command, { generation }) };
  }
  if (args.length) throw new Error(`Unexpected arguments for "${command}".`);
  switch (command) {
    case "quit": case "exit": return { quit: true };
    case "": return { text: "" };
    case "help": return { text: commands };
    case "table": case "family": case "csv": return { text: report(current, command) };
    case "show": return { text: describe(current) };
    case "reset": return { result: simulate({ ...current.settings, rows: 1 }) };
    default: throw new Error(`Unknown command "${command}". Type help for commands.`);
  }
}

async function interact(initial, input, output) {
  let result = initial;
  const tty = Boolean(input.isTTY && output.isTTY);
  const reader = readline.createInterface({ input, output, terminal: tty });
  reader.setPrompt("atlas> ");
  const write = message => output.write(message);
  const prompt = () => { if (tty) reader.prompt(); };
  write('Rule Atlas. Type "help" for commands.\n' + describe(result));
  prompt();
  try {
    for await (const line of reader) {
      try {
        const reply = executeCommand(result, line);
        if (reply.quit) break;
        if (reply.result) result = reply.result;
        write(reply.text ?? describe(result));
      } catch (error) {
        write(`Error: ${error.message}\n`);
      }
      prompt();
    }
  } finally {
    reader.close();
  }
}

async function main(args, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    if (args.includes("--help") || args.includes("-h")) {
      stdout.write(help);
      return 0;
    }
    const { settings, format, transform, interactive, options } = parseArgs(args);
    let result = simulate(settings);
    if (transform !== null) result = transformRun(result, transform);
    if (interactive) await interact(result, stdin, stdout);
    else stdout.write(report(result, format, options));
    return 0;
  } catch (error) {
    stderr.write(`Error: ${error.message}\nRun node explore.js --help for usage.\n`);
    return 1;
  }
}

if (require.main === module) {
  process.stdout.on("error", error => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });
  main(process.argv.slice(2)).then(code => { process.exitCode = code; });
}

module.exports = { main };
