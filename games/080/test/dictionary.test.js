"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { entries, topics, modes, search, resolveEntry, quizPool, createRound, correctAnswer, reviewAnswer } = require("../dictionary.js");
const { gapPrompt, readPassage } = require("../passage.js");

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
}
const terms = (query, topic) => search(query, topic).map(entry => entry.term);
const unique = values => new Set(values).size === values.length;
const reading = /^[a-z]+[1-6]( [a-z]+[1-6])*$/;
const hanCount = text => (text.match(/\p{Script=Han}/gu) || []).length;

test("every entry has an unambiguous headword, reading, gloss and topic", () => {
  assert.equal(entries.length, 40);
  assert.equal(Object.keys(topics).length, 5);
  for (const key of ["term", "jyutping", "meaning"]) {
    assert.ok(unique(entries.map(e => e[key])), "Duplicate " + key);
  }
  for (const entry of entries) {
    assert.ok(Object.hasOwn(topics, entry.topic), entry.term);
    assert.match(entry.term, /^\p{Script=Han}+$/u);
    assert.match(entry.jyutping, reading);
    assert.equal(entry.jyutping.split(" ").length, hanCount(entry.term), entry.term);
    assert.ok(entry.meaning.trim() && entry.note.trim(), entry.term);
    assert.ok(entry.keywords.length && entry.keywords.every(tag => tag.trim()), entry.term);
  }
  for (const topic of Object.keys(topics)) assert.equal(search("", topic).length, 8);
});

test("every usage example has a translation and one toned syllable per spoken character", () => {
  for (const { term, example } of entries) {
    assert.ok(hanCount(example.zh) >= 2, term);
    assert.match(example.jyutping, reading, term);
    assert.equal(example.jyutping.split(" ").length, hanCount(example.zh), term);
    assert.match(example.en, /[A-Za-z]/);
  }
  const bill = search("埋單")[0];
  assert.deepEqual(bill.example, { zh: "唔該，埋單。", jyutping: "m4 goi1 maai4 daan1", en: "The bill, please." });
});

test("known Hong Kong expressions have their expected Jyutping and meaning", () => {
  for (const [term, romanisation, meaning] of [
    ["吹水", "ceoi1 seoi2", "Have a casual chat"],
    ["放飛機", "fong3 fei1 gei1", "Stand someone up"],
    ["執生", "zap1 saang1", "Think on your feet"],
    ["埋單", "maai4 daan1", "Settle the bill"],
    ["屈機", "wat1 gei1", "Have an overpowering advantage"],
  ]) {
    const [hit] = search(term);
    assert.equal(hit.jyutping, romanisation);
    assert.equal(hit.meaning, meaning);
  }
});

test("every headword, alternate spelling, complete reading and gloss finds its own entry first", () => {
  for (const entry of entries) {
    for (const query of [entry.term, ...entry.forms, entry.jyutping, entry.meaning]) {
      assert.equal(search(query)[0], entry, query);
    }
    assert.equal(search(entry.jyutping.replace(/[\d ]/g, ""))[0], entry, entry.term);
  }
});

test("traditional, simplified and spelling variants resolve to the same canonical record", () => {
  assert.deepEqual(terms("飛機"), ["放飛機"]);
  assert.deepEqual(terms("放飞机"), ["放飛機"]);
  assert.deepEqual(terms("痴线"), ["黐線"]);
  assert.deepEqual(terms("搭檯"), ["搭枱"]);
  assert.deepEqual(terms("蛇"), ["打蛇餅", "蛇王"]);
});

test("Jyutping accepts optional tones, spacing, hyphens, case and full-width typing", () => {
  for (const query of ["ceoi seoi", " ceoi1  seoi2 ", "ceoi1seoi", "ceoiseoi2",
    "CEOI1-SEOI2", "ＣＥＯＩ１－ＳＥＯＩ２", "ceoi'seoi", "ceoi s"]) {
    assert.deepEqual(terms(query), ["吹水"], query);
  }
  assert.deepEqual(terms("sing2muk"), ["醒目"]);
});

test("partial readings can start at a syllable boundary and typed tones stay significant", () => {
  assert.deepEqual(terms("ceoi1"), ["吹水", "吹雞"]);
  assert.ok(terms("seoi2").includes("潛水"));
  assert.ok(terms("sei").every(term => term !== "吹水"));
  assert.deepEqual(terms("fei1gei"), ["放飛機"]);
  for (const wrong of ["ceoi2 seoi2", "ceoi1 seoi6", "wat6 gei1", "ceoi7", "eoiseoi"]) {
    assert.deepEqual(terms(wrong), [], wrong);
  }
});

test("English matches full meanings, synonyms and unordered word prefixes", () => {
  assert.equal(terms("Go quiet in a chat")[0], "潛水");
  assert.deepEqual(terms("SCALLIONS"), ["走青"]);
  assert.deepEqual(terms("cos spl"), ["夾錢"]);
  assert.deepEqual(terms("know-it-all"), ["認叻"]);
  assert.deepEqual(terms("someONE else’s ord"), ["搭單"]);
  assert.deepEqual(terms("assignment deadline"), ["開夜車"]);
  assert.equal(terms("queue")[0], "打蛇餅");
  assert.deepEqual(terms("3v3"), ["齊腳"]);
  assert.deepEqual(terms("three-a-side"), ["齊腳"]);
  assert.match(search("3v3")[0].note, /齊腳未？ \(cai4 goek3 mei6\)/);
});

test("empty searches browse in editorial order and filtering applies to every search language", () => {
  assert.deepEqual(search(), entries);
  assert.deepEqual(search(" \t\n "), entries);
  assert.deepEqual(search("", "plans"), entries.filter(e => e.topic === "plans"));
  for (const query of ["打蛇餅", "queue", "daa2se4beng2"]) {
    assert.deepEqual(terms(query, "work"), []);
    assert.deepEqual(terms(query, "plans"), ["打蛇餅"]);
  }
  assert.deepEqual(terms("bargain", "plans"), ["走寶"]);
  assert.deepEqual(terms("bargain", "food"), ["抵到爛"]);
});

test("literal punctuation, bare tone digits and unknown terms give no spurious matches", () => {
  for (const query of ["[.*]", "—", "???", "1", "2", "3", "4", "5", "6", "不存在的詞", "mooncheese"]) {
    assert.deepEqual(search(query), [], query);
  }
  assert.throws(() => search("", "no-such-topic"), /Unknown topic/);
  assert.throws(() => search("", "constructor"), /Unknown topic/);
});

test("building quizzes and sorting search results preserve the dictionary order", () => {
  const original = [...entries];
  const subset = search("", "talk");
  subset.reverse();
  createRound({ count: 40, random: seeded(317) });
  search("chat");
  assert.deepEqual(entries, original);
  assert.deepEqual(search(), original);
});

test("every multiple-choice mode makes four distinct, in-topic choices and exactly one correct answer", () => {
  const keys = { meaning: "meaning", term: "term", reading: "jyutping", cloze: "term" };
  for (const topic of ["all", ...Object.keys(topics)]) {
    const pool = search("", topic);
    for (const mode of Object.keys(modes).filter(mode => mode !== "type")) {
      const round = createRound({ topic, count: pool.length, mode, random: seeded(71) });
      assert.equal(round.questions.length, pool.length);
      assert.ok(unique(round.questions.map(q => q.entry.term)));
      for (const q of round.questions) {
        assert.ok(pool.includes(q.entry));
        assert.equal(q.choices.length, 4);
        assert.ok(unique(q.choices));
        assert.equal(q.choices[q.correctIndex], q.entry[keys[q.mode]]);
        if (q.mode === "cloze") {
          assert.equal(q.prompt, gapPrompt(q.entry));
          assert.equal(q.hint, q.entry.example.en);
        } else {
          assert.equal(q.prompt, q.mode === "term" ? q.entry.meaning : q.entry.term);
          assert.equal(q.hint, q.mode === "meaning" ? q.entry.jyutping : "");
        }
        assert.ok(q.choices.every(option => pool.some(e => e.topic === q.entry.topic && e[keys[q.mode]] === option)));
        if (mode !== "mixed") assert.equal(q.mode, mode);
      }
    }
  }
});

test("mixed practice covers all three directions in each complete cycle", () => {
  const { questions } = createRound({ mode: "mixed", count: 9, random: seeded(103) });
  for (let i = 0; i < questions.length; i += 3) {
    assert.deepEqual(questions.slice(i, i + 3).map(q => q.mode).sort(), ["meaning", "reading", "term"]);
  }
});

test("shuffle is reproducible with a test seed and varies targets and correct positions across seeds", () => {
  const make = seed => createRound({ topic: "food", count: 8, random: seeded(seed) }).questions;
  assert.deepEqual(make(3), make(3));
  assert.notDeepEqual(make(3).map(q => q.entry.term), make(4).map(q => q.entry.term));
  const indices = new Set([3, 7, 11].flatMap(seed => make(seed).map(q => q.correctIndex)));
  assert.deepEqual([...indices].sort(), [0, 1, 2, 3]);
});

test("round setup validates the count against the selected topic and rejects unknown modes", () => {
  for (const count of [0, -1, 1.5, NaN, Infinity, 41, "5", null]) {
    assert.throws(() => createRound({ count }), /1 to 40/);
  }
  assert.throws(() => createRound({ topic: "food", count: 9 }), /1 to 8/);
  assert.throws(() => createRound({ topic: "unknown" }), /Unknown topic/);
  for (const mode of ["unknown", "constructor", ""]) {
    assert.throws(() => createRound({ mode }), /Unknown quiz mode/);
  }
  assert.equal(createRound().questions.length, 5);
  assert.equal(createRound({ count: 1 }).questions.length, 1);
});

test("answering, feedback, scoring and advancing stay consistent across a whole round", () => {
  const round = createRound({ count: 2, random: seeded(1) });
  assert.equal(round.finished, false);
  assert.equal(round.score, 0);
  assert.throws(() => round.advance(), /Answer the current/);
  for (const bad of [-1, 4, NaN, 1.5, "1", undefined]) {
    assert.throws(() => round.answer(bad), /listed answers/);
  }
  assert.equal(round.answers.length, 0);
  const correct = round.answer(round.current.correctIndex);
  assert.equal(correct.correct, true);
  assert.equal(round.feedback, correct);
  assert.throws(() => round.answer(0), /already been answered/);
  assert.equal(round.score, 1);
  round.advance();
  assert.equal(round.feedback, undefined);
  const q = round.current;
  const wrong = (q.correctIndex + 1) % 4;
  assert.deepEqual(round.answer(wrong), { question: q, choice: wrong, correct: false });
  round.advance();
  assert.equal(round.finished, true);
  assert.equal(round.score, 1);
  assert.equal(round.answers.length, 2);
  assert.equal(round.current, undefined);
  assert.throws(() => round.answer(0), /ended/);
  assert.throws(() => round.advance(), /ended/);
});

test("ending early counts only submitted answers, including an answer awaiting advance", () => {
  const empty = createRound();
  empty.finish();
  assert.equal(empty.answers.length, 0);
  assert.equal(empty.score, 0);
  const round = createRound();
  round.answer(round.current.correctIndex);
  round.finish();
  round.finish();
  assert.equal(round.finished, true);
  assert.equal(round.score, 1);
  assert.equal(round.answers.length, 1);
});

test("example search finds every sentence by its Chinese, full reading and translation", () => {
  const options = { scope: "examples" };
  for (const entry of entries) {
    for (const text of Object.values(entry.example)) {
      assert.equal(search(text, "all", options)[0], entry, text);
    }
  }
  assert.deepEqual(search("", "all", options), entries);
  assert.throws(() => search("one", "all", { scope: "unknown" }), /search scope/);
});

test("example fragments respect typed tones, syllable boundaries, punctuation and topic filters", () => {
  const find = (query, topic = "all") => search(query, topic, { scope: "examples" }).map(e => e.term);
  for (const query of ["九龍塘", "ＬＵＮＧ４－ＴＯＮＧ４", "lungtong4", "packed station", "Kowloon Tong"]) {
    assert.deepEqual(find(query, "plans"), ["迫爆"], query);
    assert.deepEqual(find(query, "talk"), []);
  }
  for (const query of ["ung4tong4", "lung2tong4", "mooncheese", "!!!", "。"]) {
    assert.deepEqual(find(query), [], query);
  }
  assert.deepEqual(find("唔該埋單"), ["埋單"]);
  assert.deepEqual(find("HKBU"), ["開夜車"]);
  assert.deepEqual(find("deck wins"), ["屈機"]);
  assert.deepEqual(search("Kowloon Tong"), []);
  assert.deepEqual(find("reinforcements"), []);
});

test("saving resolves full headwords, variants and readings without guessing from partial results", () => {
  for (const entry of entries) {
    for (const query of [entry.term, ...entry.forms, entry.jyutping, entry.jyutping.replace(/[ \d]/g, "")]) {
      assert.equal(resolveEntry(query), entry);
    }
  }
  assert.equal(resolveEntry(" ＤＡＡＰ３－ＴＯＩ "), resolveEntry("搭檯"));
  for (const query of ["", " ", "ceoi1", "seoi2", "飛機", "ceoi2seoi2", "chat", "../吹水"]) {
    assert.equal(resolveEntry(query), undefined, query);
  }
});

test("a phrasebook intersects each search scope with the topic and keeps editorial order", () => {
  const savedTerms = new Set(["屈機", "outdated word", "迫爆"]);
  assert.deepEqual(search("", "all", { savedTerms }).map(e => e.term), ["迫爆", "屈機"]);
  assert.deepEqual(search("bik1", "plans", { savedTerms }), [resolveEntry("迫爆")]);
  assert.deepEqual(search("bik1", "work", { savedTerms }), []);
  assert.deepEqual(search("deck", "work", { scope: "examples", savedTerms }), [resolveEntry("屈機")]);
  assert.deepEqual(search("HKBU", "all", { scope: "examples", savedTerms }), []);
  assert.deepEqual(search("", "all", { savedTerms: new Set() }), []);
});

test("saved quizzes draw targets from the book and all four choices from the target's topic", () => {
  const savedTerms = new Set(["放飛機", "埋單", "obsolete"]);
  const round = createRound({ savedTerms, mode: "term", random: seeded(1) });
  assert.deepEqual(round.questions.map(q => q.entry.term).sort(), ["放飛機", "埋單"].sort());
  for (const q of round.questions) {
    assert.equal(new Set(q.choices).size, 4);
    assert.ok(q.choices.every(term => resolveEntry(term).topic === q.entry.topic));
  }
  assert.equal(createRound({ topic: "food", savedTerms }).questions.length, 1);
  assert.throws(() => createRound({ topic: "talk", savedTerms }), /No saved expressions/);
  assert.throws(() => createRound({ count: 3, savedTerms }), /1 to 2/);
  assert.throws(() => createRound({ savedTerms: new Set(["gone"]) }), /No saved expressions/);
  savedTerms.clear();
  assert.equal(round.questions.length, 2);
  assert.throws(() => createRound({ savedTerms }), /No saved expressions/);
});

test("typed practice accepts the complete toned reading for every entry without revealing choices", () => {
  const round = createRound({ mode: "type", count: entries.length, random: seeded(300) });
  for (const q of round.questions) {
    assert.equal(q.mode, "type");
    assert.equal(q.prompt, q.entry.term);
    assert.equal(q.hint, "");
    assert.equal(q.choices, undefined);
    assert.equal(correctAnswer(q), q.entry.jyutping);
    const result = round.answer(q.entry.jyutping.toUpperCase().replaceAll(" ", ""));
    assert.equal(result.correct, true);
    assert.deepEqual(result.corrections, []);
    round.advance();
  }
  assert.equal(round.score, entries.length);
  assert.equal(round.finished, true);
});

test("typed input accepts full-width forms and separators only between toned syllables", () => {
  const options = { mode: "type", savedTerms: new Set(["吹水"]) };
  for (const text of ["ＣＥＯＩ１－ＳＥＯＩ２", "  ceoi1  seoi2  ", "ceoi1’seoi2", "ceoi1'seoi2"]) {
    const round = createRound(options);
    assert.equal(round.answer(text).correct, true);
    assert.equal(round.feedback.choice, "ceoi1 seoi2");
  }
  const round = createRound(options);
  for (const text of ["", "  ", "ceoi seoi", "ceoiseoi2", "ceoi1 seoi", "ceoi1", "1 2", "ceoi1 seoi7",
    "c eoi1 seoi2", "ceoi1 / seoi2", "ceoi1seoi2-", "ceoi1seoi2gai1", "ceoi11seoi2", "吹水", null, 2]) {
    assert.throws(() => round.answer(text), /2 syllables.*1 to 6/, String(text));
    assert.equal(round.answers.length, 0);
  }
  const miss = round.answer("ceoi1 seoi5");
  assert.equal(miss.correct, false);
  assert.deepEqual(miss.corrections, ["水 · seoi5 → seoi2 (tone 2, high rising)"]);
  assert.equal(reviewAnswer(miss), "You typed “ceoi1 seoi5”. Answer “ceoi1 seoi2”.");
  assert.throws(() => round.answer("ceoi1 seoi2"), /already been answered/);
  round.finish();
  const retry = round.retryMissed();
  assert.equal(retry.current.mode, "type");
  assert.ok(retry.answer("ceoi1seoi2").correct);
  assert.equal(round.score, 0);
});

test("retry uses only answered misses in their original directions and starts a fresh score", () => {
  const round = createRound({ count: 5, random: seeded(44) });
  assert.throws(() => round.retryMissed(), /Finish the current round/);
  const [first, second, third] = round.questions;
  round.answer((first.correctIndex + 1) % 4);
  round.advance();
  round.answer(second.correctIndex);
  round.advance();
  round.answer((third.correctIndex + 1) % 4);
  round.finish();
  const retry = round.retryMissed(() => 0.99);
  assert.equal(retry.answers.length, 0);
  assert.equal(retry.questions.length, 2);
  [first, third].forEach((original, i) => {
    const q = retry.current;
    assert.equal(q.entry, original.entry);
    assert.equal(q.mode, original.mode);
    assert.notEqual(q.choices, original.choices);
    assert.equal(retry.position, i);
    assert.equal(new Set(q.choices).size, 4);
    retry.answer(q.correctIndex);
    retry.advance();
  });
  assert.equal(retry.score, 2);
  assert.equal(round.score, 1);
  assert.throws(() => retry.retryMissed(), /No missed answers/);
  const empty = createRound();
  empty.finish();
  assert.throws(() => empty.retryMissed(), /No missed answers/);
});

test("typed corrections distinguish spelling changes from tone changes on the corresponding characters", () => {
  const round = createRound({ mode: "type", savedTerms: new Set(["吹水"]) });
  assert.throws(() => round.answer("a".repeat(30_000)), /2 syllables/);
  assert.deepEqual(round.answer("caai1 soi6").corrections, [
    "吹 · caai1 → ceoi1 (spelling)",
    "水 · soi6 → seoi2 (spelling and tone 2, high rising)",
  ]);
});

test("explicit Jyutping separators must fall between syllables in both lookup scopes and phrasebook resolution", () => {
  for (const bad of ["c eoi1 seoi2", "ceo-i1seoi2", "ceoi1seoi2-", "'ceoi1seoi2", "maai 4daan1"]) {
    assert.deepEqual(search(bad), [], bad);
    assert.equal(resolveEntry(bad), undefined, bad);
  }
  assert.deepEqual(search("lu-ng4tong4", "all", { scope: "examples" }), []);
  assert.equal(search("lung4-tong4", "all", { scope: "examples" })[0].term, "迫爆");
  for (const entry of entries) {
    assert.equal(resolveEntry(entry.jyutping.replaceAll(" ", "’")), entry);
    assert.equal(resolveEntry(entry.jyutping.replace(/[1-6]/g, "").replaceAll(" ", "-")), entry);
  }
});

test("the passage reader recognises every canonical spelling and variant in surrounding text", () => {
  for (const entry of entries) {
    for (const form of [entry.term, ...entry.forms]) {
      const text = "「" + form + "！」";
      const { matches, vocabulary, terms } = readPassage(text);
      assert.equal(matches.length, 1, text);
      assert.equal(matches[0].entry, entry);
      assert.equal(text.slice(matches[0].start, matches[0].end), form);
      assert.equal(matches[0].surface, form);
      assert.deepEqual([...terms], [entry.term]);
      assert.equal(vocabulary[0].count, 1);
      assert.deepEqual([...vocabulary[0].variants], form === entry.term ? [] : [form]);
    }
  }
});

test("passage matches keep original offsets, repetitions and vocabulary order across lines", () => {
  const text = "🍜 搭檯搭台！\r\n佢放我哋飞机，又放我哋飞机。𠵱家埋單。";
  const { matches, vocabulary, summary } = readPassage(text);
  assert.deepEqual(matches.map(m => text.slice(m.start, m.end)), ["搭檯", "搭台", "放我哋飞机", "放我哋飞机", "埋單"]);
  assert.ok(matches.every((m, i) => m.surface === text.slice(m.start, m.end) && (!i || m.start >= matches[i - 1].end)));
  assert.deepEqual(vocabulary.map(({ entry, count, variants }) => [entry.term, count, [...variants]]), [
    ["搭枱", 2, ["搭檯", "搭台"]], ["放飛機", 2, ["放我哋飞机"]], ["埋單", 1, []],
  ]);
  assert.equal(summary, "3 expressions · 5 matches");
  assert.equal(readPassage("迫爆").summary, "1 expression · 1 match");
  assert.equal(readPassage("埋單埋單").summary, "1 expression · 2 matches");
});

test("passage matching only bridges listed insertions and keeps separate words separate", () => {
  for (const text of ["", "\n", "✈️", "放\n飛機", "放，我飛機", "吹一杯水", "打蛇", "ceoi1 seoi2"]) {
    const result = readPassage(text);
    assert.deepEqual(result.matches, [], text);
    assert.deepEqual(result.vocabulary, []);
    assert.equal(result.terms.size, 0);
  }
  assert.deepEqual([...readPassage("放佢飛機，啱你心水，吹陣水，打晒蛇饼").terms], ["放飛機", "啱心水", "吹水", "打蛇餅"]);
});

test("sentence gaps mask just the target characters in all 40 examples", () => {
  const split = {
    "吹水": "我哋坐低□陣□。", "啱心水": "呢隻色好□我□□。",
    "放飛機": "你尋日□我□□喎。", "打蛇餅": "門口條人龍□晒□□。",
  };
  const round = createRound({ mode: "cloze", count: entries.length, random: seeded(134) });
  for (const question of round.questions) {
    const { entry, prompt } = question;
    const expected = split[entry.term] || entry.example.zh.replaceAll(entry.term, "□".repeat(Array.from(entry.term).length));
    assert.equal(prompt, expected, entry.term);
    assert.notEqual(prompt, entry.example.zh, entry.term);
    assert.equal(question.hint, entry.example.en);
    assert.equal(correctAnswer(question), entry.term);
    assert.equal(round.answer(question.correctIndex).correct, true);
    round.advance();
  }
  assert.equal(round.score, entries.length);
  const entry = { ...resolveEntry("放飛機"), example: { zh: "放飞机、放我飛機，仲掛住吹水？" } };
  assert.equal(gapPrompt(entry), "□□□、□我□□，仲掛住吹水？");
});

test("passage practice intersects topic and phrasebook and freezes targets for the round and retry", () => {
  const { terms: passageTerms } = readPassage("搭檯又搭台，埋單。今晚開夜車。");
  const savedTerms = new Set(["搭枱", "開夜車", "冇癮"]);
  assert.deepEqual(quizPool({ passageTerms, savedTerms }).map(e => e.term), ["開夜車", "搭枱"]);
  const filters = { topic: "food", passageTerms, savedTerms };
  assert.throws(() => createRound({ ...filters, count: 2 }), /1 to 1/);
  assert.throws(() => createRound({ ...filters, topic: "talk" }), /No expressions from the passage/);
  assert.throws(() => createRound({ passageTerms: new Set() }), /No expressions from the passage/);
  const round = createRound({ ...filters, mode: "cloze" });
  passageTerms.clear();
  savedTerms.clear();
  const q = round.current;
  assert.equal(round.questions.length, 1);
  assert.equal(q.entry.term, "搭枱");
  assert.equal(new Set(q.choices).size, 4);
  assert.ok(q.choices.every(term => resolveEntry(term).topic === "food"));
  round.answer((q.correctIndex + 1) % 4);
  round.finish();
  const retry = round.retryMissed();
  assert.equal(retry.current.prompt, q.prompt);
  assert.equal(retry.current.mode, "cloze");
  assert.equal(retry.answer(retry.current.correctIndex).correct, true);
});
