"use strict";

const { createInterface } = require("node:readline");
const { text: streamText } = require("node:stream/consumers");
const { parseArgs } = require("node:util");
const { entries, topics, modes, search, resolveEntry, createRound, parseQuestionCount,
  correctAnswer, reviewAnswer } = require("./dictionary.js");
const { filePhrasebook } = require("./file-phrasebook.js");
const { exportList, importList, importSummary } = require("./phrasebook.js");
const { readPassage } = require("./passage.js");

const help = `Street Cantonese · 街談

  node cli.js                              Start an interactive session
  node cli.js search <words> [options]      Look up Chinese, Jyutping, or English
  node cli.js read <passage>                Find expressions in a Cantonese message
  node cli.js browse [options]              List expressions with readings and meanings
  node cli.js book                          List your saved expressions
  node cli.js book add|remove <expression>  Use a full headword, spelling variant, or reading
  node cli.js book export                   Print one saved headword per line
  node cli.js book import <expr> [...]      Merge a list of expressions into your phrasebook
  node cli.js topics                       List topic IDs and sizes
  node cli.js quiz [options]                Start a practice round

Search, browse and quiz options
  --topic ID     all, ${Object.keys(topics).join(", ")} (default all)
  --saved        Use expressions in your phrasebook
  --examples     Search inside example sentences (search only)

Quiz options
  --count N      Number of questions (default up to 5)
  --mode MODE    ${Object.keys(modes).join(", ")} (default mixed)
  --passage TEXT Practise expressions found in a Cantonese passage

Use read - or book import - to read UTF-8 text from standard input.
In a session, type a search or use /search, /read, /browse, /book, /topics, /quiz, /help, or /quit.
Use /retry to practise missed questions from your last round.`;

function formatExample({ example }) {
  return [example.zh, example.jyutping, example.en].map(line => "  " + line).join("\n");
}

function formatEntry(entry) {
  return [
    `${entry.term}   ${entry.jyutping}   ·   ${topics[entry.topic]}`,
    entry.meaning,
    entry.note,
    "",
    formatExample(entry),
  ].join("\n");
}

function printSummary(round, print) {
  const answered = round.answers.length;
  const total = round.questions.length;
  print(answered ? `Score   ${round.score}/${answered} correct` : "Round ended before any answers.");
  print(`${answered} of ${total} questions answered.`);
  const missed = round.missed;
  if (missed.length) print("\nTo revisit");
  for (const result of missed) {
    const { entry } = result.question;
    print(`  ${entry.term} · ${entry.jyutping} · ${entry.meaning}`);
    print("    " + reviewAnswer(result));
  }
}

async function play(round, ask, print) {
  while (!round.finished) {
    const q = round.current;
    print(`\n[${round.position + 1}/${round.questions.length}] ${q.instruction}`);
    if (q.mode === "cloze") {
      print(q.prompt);
      print(q.hint);
    } else {
      print(q.hint ? `${q.prompt}   ${q.hint}` : q.prompt);
    }
    const typing = q.mode === "type";
    if (!typing) q.choices.forEach((choice, i) => print(`  ${i + 1}. ${choice}`));
    while (!round.feedback && !round.finished) {
      const reply = await ask(typing ? "Jyutping (q to finish)> " : "Answer 1–4 (q to finish)> ");
      if (reply === null || /^(q|quit)$/i.test(reply)) {
        round.finish();
      } else if (!typing && !/^[1-4]$/.test(reply)) {
        print("Enter a number from 1 to 4, or q to finish.");
      } else {
        try {
          round.answer(typing ? reply : Number(reply) - 1);
        } catch (err) {
          if (!(err instanceof RangeError)) throw err;
          print(err.message);
        }
      }
    }
    if (round.finished) break;
    const result = round.feedback;
    print(result.correct ? "Correct!" : `The answer is “${correctAnswer(q)}”.`);
    for (const line of result.corrections || []) print("  " + line);
    print(`${q.entry.term} · ${q.entry.jyutping} · ${q.entry.meaning}`);
    if (q.mode === "cloze") print(formatExample(q.entry));
    round.advance();
  }
  print("");
  printSummary(round, print);
}

// Session commands accept quoted arguments and keep apostrophes inside words.
function sessionArgs(line) {
  const args = [];
  let token = "", quote = "", started = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = "";
      else token += ch;
    } else if (/\s/.test(ch)) {
      if (started) args.push(token);
      token = "";
      started = false;
    } else if ((ch === '"' || ch === "'") && (!started || token.endsWith("="))) {
      quote = ch;
      started = true;
    } else {
      token += ch;
      started = true;
    }
  }
  if (quote) throw new Error("Close the quoted argument and try again.");
  if (started) args.push(token);
  return args;
}

const filters = { topic: { type: "string", default: "all" }, saved: { type: "boolean" } };
const commandOptions = {
  topics: {}, book: {}, retry: {}, read: {},
  browse: filters,
  search: { ...filters, examples: { type: "boolean" } },
  quiz: { ...filters, count: { type: "string" }, mode: { type: "string", default: "mixed" }, passage: { type: "string" } },
};

function editBook(book, [action, ...words]) {
  if (!["add", "remove"].includes(action) || !words.length) {
    throw new Error("Use book add <expression>, book remove <expression>, book export or book import <expressions>.");
  }
  const entry = resolveEntry(words.join(" "));
  if (!entry) throw new Error("Give a full headword, a listed spelling, or a complete Jyutping reading.");
  const adding = action === "add";
  const changed = book.set(entry, adding);
  if (adding) return changed ? `Saved ${entry.term} to your phrasebook.` : `${entry.term} is already saved.`;
  return changed ? `Removed ${entry.term} from your phrasebook.` : `${entry.term} was not in your phrasebook.`;
}

function collectionLabel(topic, savedTerms) {
  return (topics[topic] || "All topics") + (savedTerms ? " · Phrasebook" : "");
}

function printLookup(name, values, words, savedTerms, print) {
  const query = words.join(" ").trim();
  if (name === "search" && !query) throw new Error("Give search a word, or use browse to list entries.");
  const scope = values.examples ? "examples" : "entries";
  const hits = search(query, values.topic, { scope, savedTerms });
  if (!hits.length) {
    if (savedTerms?.size === 0) print("Your phrasebook is empty. Use book add <expression> to save one.");
    else if (!query) print(`No saved expressions in ${topics[values.topic]}.`);
    else if (values.examples) print(`No example sentences matched “${query}”.`);
    else print(`No entries matched “${query}”. Try a headword, reading, or English keyword.`);
    return;
  }
  print(`${hits.length} ${hits.length === 1 ? "entry" : "entries"} · ${collectionLabel(values.topic, savedTerms)}`);
  for (const entry of hits) {
    if (name !== "search") print(`${entry.term}   ${entry.jyutping}   ·   ${entry.meaning}`);
    else if (values.examples) print(`\n${entry.term} · ${entry.meaning}\n${formatExample(entry)}`);
    else print("\n" + formatEntry(entry));
  }
}

function printPassage(text, print) {
  if (!text.trim()) throw new Error("Give read a Cantonese passage, or use read - for standard input.");
  const { vocabulary, summary } = readPassage(text);
  print(text);
  print("\n" + summary);
  for (const { entry, variants, count } of vocabulary) {
    const repeats = count > 1 ? ` (×${count})` : "";
    print(`${entry.term}${repeats}   ${entry.jyutping}   ·   ${entry.meaning}`);
    if (variants.size) print("  As written   " + [...variants].join(" / "));
  }
}

async function main(argv, {
  input = process.stdin, output = process.stdout, error = process.stderr, random = Math.random,
  book = filePhrasebook(),
} = {}) {
  const print = (line = "") => output.write(line + "\n");
  let reader;
  let lines;
  let lastRound;
  const terminal = Boolean(input.isTTY && output.isTTY);

  async function ask(prompt) {
    if (!reader) {
      reader = createInterface({ input, output, terminal, crlfDelay: Infinity });
      lines = reader[Symbol.asyncIterator]();
    }
    if (terminal) {
      reader.setPrompt(prompt);
      reader.prompt();
    } else {
      output.write(prompt);
    }
    const { value, done } = await lines.next();
    if (!terminal || done) print();
    return done ? null : value.trim();
  }

  async function argumentText(words, separator) {
    if (words.length === 1 && words[0] === "-") {
      if (!argv.length) throw new Error("Use a one-shot command to read standard input with -.");
      return streamText(input);
    }
    return words.join(separator);
  }

  async function bookCommand([action, ...words]) {
    if (action === "export") {
      if (words.length) throw new Error("Use book export without arguments.");
      const text = exportList(book.read());
      if (text) print(text);
    } else if (action === "import") {
      if (!words.length) throw new Error("Use book import <expressions> or book import - for standard input.");
      print(importSummary(importList(await argumentText(words, "\n"), book)));
    } else {
      print(editBook(book, [action, ...words]));
    }
  }

  async function command(name, args) {
    if (["help", "--help", "-h"].includes(name)) { print(help); return; }
    if (!Object.hasOwn(commandOptions, name)) {
      throw new Error(`Unknown command “${name}”. Use --help for the commands.`);
    }
    const options = { ...commandOptions[name], help: { type: "boolean", short: "h" } };
    const { values, positionals } = parseArgs({ args, options, allowPositionals: ["search", "book", "read"].includes(name) });
    if (values.help) { print(help); return; }
    if (name === "book" && positionals.length) { await bookCommand(positionals); return; }
    if (name === "read") { printPassage(await argumentText(positionals, " "), print); return; }
    if (name === "topics") {
      for (const [id, label] of Object.entries(topics)) {
        print(`${id.padEnd(8)} ${label} (${search("", id).length})`);
      }
      return;
    }
    const savedTerms = values.saved || name === "book" ? book.read() : undefined;
    if (name === "quiz" || name === "retry") {
      if (name === "retry") {
        if (!lastRound) throw new Error("Play a quiz in this session before using /retry.");
        lastRound = lastRound.retryMissed(random);
        print("Retry missed questions");
      } else {
        const count = values.count === undefined ? undefined : parseQuestionCount(values.count);
        const passageTerms = values.passage === undefined ? undefined : readPassage(values.passage).terms;
        lastRound = createRound({ topic: values.topic, mode: values.mode, count, savedTerms, passageTerms, random });
        print(`${modes[values.mode]} · ${collectionLabel(values.topic, savedTerms)}${passageTerms ? " · Passage" : ""}`);
      }
      await play(lastRound, ask, print);
      if (!argv.length && lastRound.missed.length) print("Use /retry to practise these missed questions.");
      return;
    }
    printLookup(name, values, positionals, savedTerms, print);
  }

  try {
    if (argv.length) {
      await command(argv[0], argv.slice(1));
    } else {
      print(`Street Cantonese · 街談   |   ${entries.length} expressions`);
      print("Type a word in Chinese, Jyutping, or English.");
      print("Use /browse, /read, /book, /topics, /quiz, /retry, /help, or /quit.");
      while (true) {
        const line = await ask("\nSearch> ");
        if (line === null || line === "/quit") break;
        if (!line) continue;
        try {
          if (line.startsWith("/")) {
            const [name = "", ...args] = sessionArgs(line.slice(1));
            await command(name, args);
          } else {
            await command("search", ["--", line]);
          }
        } catch (err) { print(err.message); }
      }
    }
    return 0;
  } catch (err) {
    error.write(err.message + "\n");
    return 2;
  } finally {
    if (reader) reader.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; });
}

module.exports = { main };
