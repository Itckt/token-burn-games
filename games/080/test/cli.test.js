"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { PassThrough, Readable, Writable } = require("node:stream");
const { stripVTControlCharacters } = require("node:util");
const fs = require("node:fs");
const path = require("node:path");
const { main } = require("../cli.js");
const { filePhrasebook } = require("../file-phrasebook.js");

function capture() {
  let text = "";
  const stream = new Writable({
    write(chunk, encoding, callback) {
      text += chunk.toString("utf8");
      callback();
    },
  });
  return { stream, text: () => text };
}

// A draw near one leaves Fisher–Yates in its original order, including the choices.
async function run(argv, input = "", book) {
  const out = capture();
  const err = capture();
  const code = await main(argv, {
    input: Readable.from(Array.isArray(input) ? input : [input]),
    output: out.stream, error: err.stream, random: () => 0.999999, book,
  });
  return { code, stdout: out.text(), stderr: err.text() };
}

function temporaryBook(t) {
  const root = fs.realpathSync(__dirname);
  const directory = fs.mkdtempSync(path.join(root, ".phrasebook-test-"));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(directory)), root);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const location = path.join(directory, "book");
  return { location, open: () => filePhrasebook(location) };
}

test("help lists runnable commands, interactive controls and all quiz options", async () => {
  for (const args of [["--help"], ["-h"], ["help"], ["quiz", "--help"]]) {
    const result = await run(args);
    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    for (const text of ["search <words>", "browse", "--count", "--topic", "--mode", "/quit",
      "--examples", "--saved", "book add|remove", "type", "/retry", "read <passage>",
      "--passage", "cloze", "book export", "book import", "/read"]) {
      assert.ok(result.stdout.includes(text), text);
    }
  }
});

test("one-shot lookup prints a complete Unicode entry and its example reading", async () => {
  for (const args of [["search", "ＢＡＡＴ３－ＧＷＡＡ３"], ["search", "八卦"], ["search", "be", "nosy"]]) {
    const { code, stdout, stderr } = await run(args);
    assert.equal(code, 0);
    assert.equal(stderr, "");
    assert.match(stdout, /1 entry · All topics/);
    assert.match(stdout, /八卦\s+baat3 gwaa3/);
    assert.match(stdout, /Be nosy/);
    assert.match(stdout, /我都係八卦問吓啫。/);
    assert.match(stdout, /ngo5 dou1 hai6 baat3 gwaa3 man6 haa5 ze1/);
    assert.match(stdout, /I was just being nosy and asking/);
    assert.doesNotMatch(stdout, /Search>/);
  }
});

test("browsing and topic discovery report the matching entries and their counts", async () => {
  const topics = await run(["topics"]);
  assert.equal(topics.code, 0);
  assert.match(topics.stdout, /talk\s+Conversation \(8\)/);
  assert.match(topics.stdout, /food\s+Food & spending \(8\)/);
  assert.equal(topics.stdout.trim().split("\n").length, 5);
  const all = await run(["browse"]);
  assert.match(all.stdout, /40 entries · All topics/);
  assert.equal(all.stdout.trim().split("\n").length, 41);
  const subset = await run(["browse", "--topic=plans"]);
  assert.equal(subset.code, 0);
  assert.match(subset.stdout, /8 entries · Out & about/);
  assert.match(subset.stdout, /打蛇餅\s+daa2 se4 beng2/);
  assert.doesNotMatch(subset.stdout, /吹水/);
});

test("multiword search and a topic flag work together in either position", async () => {
  const a = await run(["search", "split", "cost", "--topic", "food"]);
  const b = await run(["search", "--topic=food", "cost", "split"]);
  assert.equal(a.code, 0);
  assert.equal(a.stdout, b.stdout);
  assert.match(a.stdout, /夾錢\s+gaap3 cin2/);
  const empty = await run(["search", "split", "cost", "--topic", "work"]);
  assert.equal(empty.code, 0);
  assert.match(empty.stdout, /No entries matched/);
  assert.doesNotMatch(empty.stdout, /夾錢/);
});

test("usage errors return a nonzero status and a useful message without starting a prompt", async () => {
  for (const [argv, message] of [
    [["unknown"], /Unknown command/],
    [["search"], /Give search a word/],
    [["search", "   "], /Give search a word/],
    [["browse", "--topic", "sea"], /Unknown topic/],
    [["browse", "--count", "2"], /count/],
    [["topics", "food"], /positional/i],
    [["quiz", "--mode", "letters"], /Unknown quiz mode/],
    [["quiz", "--count", "two"], /count from 1 to 40/],
    [["quiz", "--count", "1.5"], /count from 1 to 40/],
    [["quiz", "--count", "1e0"], /count from 1 to 40/],
    [["quiz", "--count", "0"], /count from 1 to 40/],
    [["quiz", "--count", "9", "--topic", "talk"], /count from 1 to 8/],
    [["quiz", "--topic"], /topic/],
  ]) {
    const result = await run(argv);
    assert.equal(result.code, 2, argv.join(" "));
    assert.match(result.stderr, message);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /at (main|command) \(/);
  }
});

test("a piped quiz retries invalid input, explains mistakes, and reports an exact score", async () => {
  const { code, stdout, stderr } = await run(
    ["quiz", "--mode", "meaning", "--topic", "talk", "--count", "2"],
    "0\r\n9\r\nwrong\r\n\r\n2\r\n1\r\n",
  );
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.match(stdout, /\[1\/2\] Choose the English meaning\.\n吹水\s+ceoi1 seoi2/);
  assert.equal((stdout.match(/Enter a number from 1 to 4/g) || []).length, 4);
  assert.match(stdout, /The answer is “Have a casual chat”/);
  assert.match(stdout, /Correct!/);
  assert.match(stdout, /Score\s+1\/2 correct/);
  assert.match(stdout, /2 of 2 questions answered/);
  const review = stdout.split("To revisit")[1];
  assert.match(review, /吹水 · ceoi1 seoi2/);
  assert.match(review, /You chose “Call in the crew”/);
  assert.doesNotMatch(review, /吹雞/);
});

test("reading and reverse-lookup quizzes show the intended prompt and choice language", async () => {
  const options = ["--topic", "food", "--count", "1", "--mode"];
  const reading = await run(["quiz", ...options, "reading"], "1\n");
  assert.match(reading.stdout, /Choose the Jyutping reading\.\n埋單\n  1\. maai4 daan1/);
  assert.match(reading.stdout, /1\/1 correct/);
  assert.doesNotMatch(reading.stdout, /To revisit/);
  const reverse = await run(["quiz", ...options, "term"], "1\n");
  assert.match(reverse.stdout, /Choose the Cantonese expression\.\nSettle the bill\n  1\. 埋單/);
  assert.match(reverse.stdout, /1\/1 correct/);
});

test("quitting and end of input finish a partial round without scoring unattempted questions", async () => {
  for (const input of ["1\n q \n", "1\nQUIT\n", "1"]) {
    const result = await run(["quiz", "--count", "3"], input);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /1\/1 correct/);
    assert.match(result.stdout, /1 of 3 questions answered/);
    assert.doesNotMatch(result.stdout, /\[3\/3\]/);
  }
  const empty = await run(["quiz", "--count", "1"]);
  assert.equal(empty.code, 0);
  assert.match(empty.stdout, /Round ended before any answers/);
  assert.match(empty.stdout, /0 of 1 questions answered/);
  assert.doesNotMatch(empty.stdout, /0\/0/);
});

test("the interactive session keeps buffered input through searches, commands and quiz rounds", async () => {
  const input = ["", "/oops", "fongfeigei", "/browse --topic work", "/quiz --count 2 --topic work",
    "1", "q", "hot pot", "/topics", "/quit", "trailing unused text"].join("\n");
  const { code, stdout, stderr } = await run([], input);
  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.match(stdout, /Unknown command “oops”/);
  assert.match(stdout, /放飛機\s+fong3 fei1 gei1/);
  assert.match(stdout, /8 entries · Work & play/);
  assert.match(stdout, /1 of 2 questions answered/);
  assert.match(stdout, /打邊爐\s+daa2 bin1 lou4/);
  assert.match(stdout, /plans\s+Out & about \(8\)/);
  assert.doesNotMatch(stdout, /trailing unused text/);
});

test("an interactive session also exits cleanly on immediate EOF", async () => {
  const { code, stdout } = await run([]);
  assert.equal(code, 0);
  assert.match(stdout, /40 expressions/);
  assert.equal((stdout.match(/Search>/g) || []).length, 1);
});

test("terminal line editing uses the quiz prompt and accepts an entered choice", async () => {
  const input = new PassThrough();
  input.isTTY = true;
  const output = capture();
  output.stream.isTTY = true;
  output.stream.columns = 80;
  const finished = main(["quiz", "--count", "1", "--mode", "meaning"], {
    input, output: output.stream, error: capture().stream, random: () => 0.999999,
  });
  input.end("1\r");
  assert.equal(await finished, 0);
  const transcript = stripVTControlCharacters(output.text());
  assert.match(transcript, /Answer 1–4 \(q to finish\)> /);
  assert.match(transcript, /1\/1 correct/);
});

test("searching examples prints the matched sentence, its Jyutping and translation", async () => {
  for (const query of ["Kowloon Tong", "九龍塘", "gau2lung4tong4"]) {
    const result = await run(["search", "--examples", query, "--topic", "plans"]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /1 entry · Out & about/);
    assert.match(result.stdout, /迫爆 · Be packed to bursting/);
    assert.match(result.stdout, /九龍塘站個月台迫爆喇。\n  gau2 lung4 tong4/);
    assert.match(result.stdout, /The platform at Kowloon Tong station is packed/);
  }
  const misses = await run(["search", "--topic=work", "--examples", "Kowloon Tong"]);
  assert.match(misses.stdout, /No example sentences matched/);
  assert.doesNotMatch(misses.stdout, /迫爆/);
});

test("session commands handle quoted readings and option values and recover after an unclosed quote", async () => {
  const input = ['/search "ceoi1 seoi2"', "/browse --topic='food'", "/search someone else's order",
    '/search --examples "Kowloon Tong"', '/search "unfinished', "/search '放飞机'", "/quit"].join("\n");
  const result = await run([], input);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /吹水\s+ceoi1 seoi2/);
  assert.match(result.stdout, /8 entries · Food & spending/);
  assert.match(result.stdout, /搭單\s+daap3 daan1/);
  assert.match(result.stdout, /The platform at Kowloon Tong/);
  assert.match(result.stdout, /Close the quoted argument/);
  assert.match(result.stdout, /放飛機\s+fong3 fei1 gei1/);
  assert.doesNotMatch(result.stdout, /No entries matched|Unknown topic/);
});

test("the on-disk book persists canonical saves across commands and independent writers", async t => {
  const shelf = temporaryBook(t);
  const first = shelf.open(), second = shelf.open();
  assert.match((await run(["book"], "", first)).stdout, /phrasebook is empty/);
  assert.equal(fs.existsSync(shelf.location), false);
  assert.match((await run(["book", "add", "放飞机"], "", first)).stdout, /Saved 放飛機/);
  assert.match((await run(["book", "add", "FONG3-feigei"], "", second)).stdout, /already saved/);
  assert.match((await run(["book", "add", "wat1", "gei1"], "", second)).stdout, /Saved 屈機/);
  assert.deepEqual([...shelf.open().read()], ["放飛機", "屈機"]);
  const listed = await run(["book"], "", shelf.open());
  assert.equal(listed.code, 0);
  assert.match(listed.stdout, /2 entries · All topics · Phrasebook/);
  assert.match(listed.stdout, /放飛機[\s\S]*屈機/);
  const subset = await run(["browse", "--saved", "--topic", "work"], "", first);
  assert.match(subset.stdout, /1 entry · Work & play · Phrasebook/);
  assert.doesNotMatch(subset.stdout, /放飛機/);
  const example = await run(["search", "--saved", "--examples", "deck"], "", second);
  assert.match(example.stdout, /Your deck wins every round/);
  const excluded = await run(["search", "--saved", "--examples", "HKBU"], "", first);
  assert.match(excluded.stdout, /No example sentences matched/);
  assert.match((await run(["book", "remove", "放飛機"], "", second)).stdout, /Removed 放飛機/);
  assert.match((await run(["book", "remove", "放飞机"], "", first)).stdout, /was not in/);
  assert.deepEqual([...shelf.open().read()], ["屈機"]);
});

test("invalid book operations never create records and storage failures have a nonzero status", async t => {
  const shelf = temporaryBook(t);
  for (const args of [["add"], ["remove"], ["oops", "吹水"], ["add", "ceoi"], ["remove", "../吹水"]]) {
    const result = await run(["book", ...args], "", shelf.open());
    assert.equal(result.code, 2);
    assert.match(result.stderr, /book add|full headword/);
  }
  const empty = await run(["quiz", "--saved"], "", shelf.open());
  assert.equal(empty.code, 2);
  assert.match(empty.stderr, /No saved expressions/);
  assert.equal(empty.stdout, "");
  assert.equal(fs.existsSync(shelf.location), false);
  fs.writeFileSync(shelf.location, "occupied");
  for (const args of [["book"], ["book", "add", "吹水"]]) {
    const result = await run(args, "", shelf.open());
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Could not (read|update) the phrasebook/);
  }
  assert.equal(fs.readFileSync(shelf.location, "utf8"), "occupied");
});

test("a one-expression CLI phrasebook still makes a four-choice quiz and enforces its own limit", async t => {
  const { open, location } = temporaryBook(t);
  await run(["book", "add", "迫爆"], "", open());
  fs.writeFileSync(path.join(location, "obsolete.saved"), "");
  fs.mkdirSync(path.join(location, "埋單.saved"));
  const occupied = await run(["book", "add", "埋單"], "", open());
  assert.equal(occupied.code, 2);
  assert.match(occupied.stderr, /Could not update the phrasebook/);
  const result = await run(["quiz", "--saved", "--mode", "meaning"], "1\n", open());
  assert.equal(result.code, 0);
  assert.match(result.stdout, /\[1\/1\][^\n]*\n迫爆\s+bik1 baau3/);
  assert.match(result.stdout, /\n  4\. /);
  assert.match(result.stdout, /1\/1 correct/);
  for (const [options, msg] of [[["--count", "2"], /1 to 1/], [["--topic", "talk"], /No saved expressions/]]) {
    const invalid = await run(["quiz", "--saved", ...options], "", open());
    assert.equal(invalid.code, 2);
    assert.match(invalid.stderr, msg);
  }
});

test("typed quizzes retry malformed input, score tone errors once and print the learner's reading", async () => {
  const options = ["quiz", "--mode", "type", "--topic", "food", "--count", "2"];
  const result = await run(options, "maai daan\nＭＡＡＩ４－ＤＡＡＮ１\ndaap3toi5\n");
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Jyutping \(q to finish\)>/);
  assert.doesNotMatch(result.stdout, /\n  [1-4]\. /);
  assert.match(result.stdout, /Enter 2 syllables/);
  assert.match(result.stdout, /Correct!/);
  assert.match(result.stdout, /枱 · toi5 → toi2 \(tone 2, high rising\)/);
  assert.match(result.stdout, /Score\s+1\/2 correct/);
  assert.match(result.stdout, /You typed “daap3 toi5”. Answer “daap3 toi2”/);
  for (const input of ["maai daan\nq\n", "maai daan"]) {
    const stopped = await run(options, input);
    assert.match(stopped.stdout, /0 of 2 questions answered/);
    assert.doesNotMatch(stopped.stdout, /To revisit/);
  }
});

test("session retry drills only the misses from the last round and clears mastered questions", async () => {
  const input = ["/retry", "/quiz --mode type --topic work --count 3", "gaau2 dim5", "zap1 saang1",
    "q", "/retry", "gaau2dim6", "/retry", "/quit"].join("\n");
  const result = await run([], input);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Play a quiz in this session/);
  assert.match(result.stdout, /1 of 1 questions answered/);
  const [original, retry] = result.stdout.split("Retry missed questions");
  assert.match(original, /1\/2 correct/);
  assert.match(original, /2 of 3 questions answered/);
  assert.match(retry, /\[1\/1\] Type the Jyutping[^\n]*\n搞掂/);
  assert.doesNotMatch(retry, /執生|蛇王/);
  assert.match(retry, /1\/1 correct/);
  assert.match(retry, /No missed answers to retry/);
});

test("read accepts a passage as an argument or UTF-8 chunks on stdin and lists each expression once", async () => {
  const text = "🍜 搭檯搭台\n唔該，埋單。";
  const bytes = Buffer.from(text);
  const direct = await run(["read", text]);
  const piped = await run(["read", "-"], [bytes.subarray(0, 2), bytes.subarray(2, 9), bytes.subarray(9)]);
  assert.deepEqual(piped, direct);
  assert.equal(piped.code, 0);
  assert.ok(piped.stdout.startsWith(text + "\n"));
  assert.match(piped.stdout, /2 expressions · 3 matches/);
  assert.match(piped.stdout, /搭枱 \(×2\)\s+daap3 toi2\s+·\s+Share a table with strangers/);
  assert.match(piped.stdout, /As written\s+搭檯 \/ 搭台/);
  assert.match(piped.stdout, /埋單\s+maai4 daan1/);
  assert.equal((piped.stdout.match(/daap3 toi2/g) || []).length, 1);
  const none = await run(["read", "今日落雨。"]);
  assert.equal(none.code, 0);
  assert.match(none.stdout, /No dictionary expressions/);
  for (const args of [["read"], ["read", "-"]]) {
    const blank = await run(args);
    assert.equal(blank.code, 2);
    assert.match(blank.stderr, /Give read a Cantonese passage/);
  }
});

test("reading standard input is explicit and interactive commands preserve the next session line", async t => {
  const { open } = temporaryBook(t);
  const result = await run([], ["/read -", "/book import -", '/read "你放我飛機喎。"',
    '/book import 放飞机 "maai4 daan1"', "/book export", "/quit"].join("\n"), open());
  assert.equal(result.code, 0);
  assert.equal((result.stdout.match(/Use a one-shot command/g) || []).length, 2);
  assert.match(result.stdout, /1 expression · 1 match\n放飛機\s+fong3 fei1 gei1/);
  assert.match(result.stdout, /Added 2 expressions\. 0 already saved/);
  assert.match(result.stdout, /放飛機\n埋單\n/);
});

test("exported phrasebooks round-trip through stdin and merge canonical entries in dictionary order", async t => {
  const source = temporaryBook(t), destination = temporaryBook(t);
  const empty = await run(["book", "export"], "", source.open());
  assert.deepEqual(empty, { code: 0, stdout: "", stderr: "" });
  assert.equal(fs.existsSync(source.location), false);
  const added = await run(["book", "import", "ＭＡＡＩ４－ＤＡＡＮ１", "放飞机", "放飛機"], "", source.open());
  assert.equal(added.code, 0);
  assert.match(added.stdout, /Added 2 expressions\. 0 already saved/);
  const exported = (await run(["book", "export"], "", source.open())).stdout;
  assert.equal(exported, "放飛機\n埋單\n");
  await run(["book", "add", "屈機"], "", destination.open());
  const list = "\uFEFF\r\n" + exported.replaceAll("\n", "\r\n") + " fongfeigei \r";
  for (const summary of ["Added 2 expressions. 0 already saved.", "Added 0 expressions. 2 already saved."]) {
    const merged = await run(["book", "import", "-"], list, destination.open());
    assert.equal(merged.code, 0);
    assert.equal(merged.stdout.trim(), summary);
    assert.equal(merged.stderr, "");
  }
  assert.equal((await run(["book", "export"], "", destination.open())).stdout, "放飛機\n屈機\n埋單\n");
  const blank = await run(["book", "import", "-"], " \r\n", destination.open());
  assert.match(blank.stdout, /list is empty/);
  assert.equal(destination.open().read().size, 3);
});

test("a bad list reports its physical line number before saving any entries", async t => {
  const shelf = temporaryBook(t);
  for (const bad of ["ce-oi1 seoi2", "埋", "海底月亮", "搭枱,埋單"]) {
    const result = await run(["book", "import", "-"], "\uFEFF吹水\r\n \r\n" + bad + "\r埋單", shelf.open());
    assert.equal(result.code, 2);
    assert.match(result.stderr, /Line 3 has an unknown or incomplete expression/);
    assert.ok(result.stderr.includes(bad));
    assert.equal(result.stdout, "");
    assert.equal(fs.existsSync(shelf.location), false);
  }
  for (const args of [["book", "import"], ["book", "export", "埋單"]]) {
    assert.equal((await run(args, "", shelf.open())).code, 2);
  }
});

test("an interrupted file import reports its partial result and can safely finish on retry", async t => {
  const shelf = temporaryBook(t);
  fs.mkdirSync(shelf.location);
  const occupied = path.join(shelf.location, "埋單.saved");
  fs.mkdirSync(occupied);
  const args = ["book", "import", "吹水", "埋單", "搭檯"];
  const first = await run(args, "", shelf.open());
  assert.equal(first.code, 2);
  assert.match(first.stderr, /Import stopped at 埋單 with 1 added.*Could not update/);
  assert.deepEqual([...shelf.open().read()], ["吹水"]);
  fs.rmdirSync(occupied);
  const second = await run(args, "", shelf.open());
  assert.equal(second.code, 0);
  assert.match(second.stdout, /Added 2 expressions\. 1 already saved/);
  assert.deepEqual([...shelf.open().read()], ["吹水", "埋單", "搭枱"]);
});

test("a cloze passage round conceals the original sentence until grading and retries the missed direction", async () => {
  const session = ['/quiz --mode cloze --passage "放我飞机，搭檯。"', "2", "q", "/retry", "1", "/quit"].join("\n");
  const { code, stdout, stderr } = await run([], session);
  assert.equal(code, 0);
  assert.equal(stderr, "");
  const [initial, retry] = stdout.split("Retry missed questions");
  const beforeAnswer = initial.split("Answer 1–4")[0];
  assert.match(beforeAnswer, /\[1\/2\] Choose the expression missing from the sentence\.\n你尋日□我□□喎。\nHey, you stood me up yesterday\./);
  assert.doesNotMatch(beforeAnswer, /你尋日放我飛機喎|nei5 cam4 jat6/);
  assert.match(initial, /The answer is “放飛機”/);
  assert.match(initial, /你尋日放我飛機喎。\n  nei5 cam4 jat6 fong3 ngo5 fei1 gei1 wo3/);
  assert.match(initial, /0\/1 correct/);
  assert.match(initial, /1 of 2 questions answered/);
  assert.match(retry, /\[1\/1\] Choose the expression missing from the sentence\.\n你尋日□我□□喎/);
  assert.match(retry, /1\/1 correct/);
});

test("passage quiz filters apply to typed practice, count validation and empty intersections", async t => {
  const shelf = temporaryBook(t);
  await run(["book", "import", "搭枱", "埋單"], "", shelf.open());
  const options = ["quiz", "--saved", "--topic", "food", "--passage", "屈機。搭檯搭台！", "--mode", "type"];
  const single = await run(options, "daap3toi2", shelf.open());
  assert.equal(single.code, 0);
  assert.match(single.stdout, /Food & spending · Phrasebook · Passage/);
  assert.match(single.stdout, /\[1\/1\].*\n搭枱\n/);
  assert.match(single.stdout, /1\/1 correct/);
  const tooMany = await run([...options, "--count", "2"], "", shelf.open());
  assert.equal(tooMany.code, 2);
  assert.match(tooMany.stderr, /1 to 1/);
  for (const passage of ["", "返學", "屈機"]) {
    const empty = await run(["quiz", "--saved", "--passage", passage], "", shelf.open());
    assert.equal(empty.code, 2);
    assert.match(empty.stderr, /No expressions from the passage/);
    assert.equal(empty.stdout, "");
  }
});
