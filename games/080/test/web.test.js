"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const tags = [...html.matchAll(/<([a-z][\w-]*)\b([^<>]*)>/gi)].map(([, tag, raw]) => ({
  tag,
  attrs: Object.fromEntries([...raw.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)].map(([, key, value]) => [key, value ?? ""])),
}));
const scripts = tags.filter(({ tag }) => tag === "script").map(({ attrs }) => ({
  name: attrs.src, code: fs.readFileSync(path.join(root, attrs.src), "utf8"),
}));

// Only the element operations used by the page. Events use Node's real EventTarget.
class TestElement extends EventTarget {
  constructor(tag, doc, attrs = {}) {
    super();
    this.tag = tag;
    this.doc = doc;
    this.attrs = { ...attrs };
    this.parts = [];
    this.value = attrs.value || "";
    this.hidden = Object.hasOwn(attrs, "hidden");
    this.disabled = false;
    this.checked = Object.hasOwn(attrs, "checked");
    this.className = attrs.class || "";
    this.classList = { add: name => { this.className += " " + name; } };
  }

  get children() { return this.parts.filter(part => typeof part !== "string"); }
  get textContent() { return this.parts.map(part => typeof part === "string" ? part : part.textContent).join(""); }
  set textContent(value) { this.parts = [String(value)]; }
  append(...parts) { this.parts.push(...parts); }
  replaceChildren(...parts) { this.parts = parts; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key]; }
  focus() { this.doc.activeElement = this; }
  select() {
    this.selectionStart = 0;
    this.selectionEnd = this.value.length;
  }
  click() {
    if (this.disabled) return;
    const check = this.attrs.type === "checkbox";
    if (check) this.checked = !this.checked;
    this.dispatchEvent(new Event("click"));
    if (check) this.dispatchEvent(new Event("change"));
  }
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    clear: () => values.clear(),
  };
}

function windowWith(storage = memoryStorage()) {
  return Object.assign(new EventTarget(), { localStorage: storage });
}

function page(win = windowWith()) {
  const elements = new Map();
  const doc = {
    defaultView: win,
    getElementById: id => elements.get(id) || null,
    createElement: tag => new TestElement(tag, doc),
  };
  for (const { tag, attrs } of tags) {
    if (attrs.id) elements.set(attrs.id, new TestElement(tag, doc, attrs));
  }
  const context = vm.createContext({ document: doc });
  vm.runInContext("Math.random = () => 0.999999", context);
  for (const script of scripts) vm.runInContext(script.code, context, { filename: script.name });
  const get = doc.getElementById;
  const click = id => get(id).click();
  function set(id, value) {
    const node = get(id);
    node.value = value;
    node.dispatchEvent(new Event(node.tag === "select" ? "change" : "input"));
  }
  function submit(id) {
    const event = new Event("submit", { cancelable: true });
    get(id).dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  }
  function start() {
    click("nav-quiz");
    submit("quiz-setup");
  }
  return { doc, get, click, set, submit, start };
}

test("the HTML loads local assets in order and all labels and control references resolve", () => {
  const ids = tags.map(({ attrs }) => attrs.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length);
  for (const { tag, attrs } of tags) {
    const refs = [attrs.for, attrs["aria-controls"], attrs["aria-labelledby"], attrs["aria-describedby"]];
    for (const ref of refs.filter(Boolean).flatMap(value => value.split(" "))) assert.ok(ids.includes(ref), ref);
    for (const address of [attrs.src, attrs.href].filter(Boolean)) {
      if (address.startsWith("#")) assert.ok(ids.includes(address.slice(1)));
      else {
        assert.match(address, /^[\w.-]+(?:\/[\w.-]+)*$/);
        assert.ok(fs.statSync(path.join(root, address)).isFile(), address);
      }
    }
    if (tag === "script") assert.ok(Object.hasOwn(attrs, "defer"));
  }
  assert.deepEqual(scripts.map(script => script.name), [
    "entries.js", "lookup.js", "passage.js", "phrasebook.js", "dictionary.js", "quiz-view.js", "app.js",
  ]);
  const stylesheet = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.doesNotMatch(stylesheet, /(?:url\(\s*|@import\s+)['"]?(?:https?:)?\/\//i);
});

test("the actual classic scripts initialise the dictionary, filters and entry details from disk", () => {
  const { get } = page();
  assert.equal(get("dictionary-view").hidden, false);
  assert.equal(get("quiz-view").hidden, true);
  assert.equal(get("reader-view").hidden, true);
  assert.equal(get("results").children.length, 40);
  assert.equal(get("result-count").textContent, "40 entries");
  assert.equal(get("dictionary-topic").children.length, 6);
  assert.deepEqual(get("quiz-mode").children.map(option => option.value), ["mixed", "meaning", "term", "reading", "type", "cloze"]);
  assert.equal(get("entry-term").textContent, "吹水");
  assert.equal(get("entry-reading").textContent, "ceoi1 seoi2");
  assert.equal(get("entry-meaning").textContent, "Have a casual chat");
  assert.match(get("example-zh").textContent, /吹陣水/);
  assert.match(get("example-reading").textContent, /ceoi1 zan6 seoi2/);
  assert.match(get("example-en").textContent, /chat/);
  assert.equal(get("results").children[0].getAttribute("aria-pressed"), "true");
  assert.equal(get("no-results").hidden, true);
});

test("selecting a search hit updates the full entry and lets the reader return to the index", () => {
  const { doc, get, click, set } = page();
  set("search", "ＣＥＯＩ１");
  assert.equal(get("results").children.length, 2);
  const [first, second] = get("results").children;
  second.click();
  assert.equal(first.getAttribute("aria-pressed"), "false");
  assert.equal(second.getAttribute("aria-pressed"), "true");
  assert.equal(get("entry-term").textContent, "吹雞");
  assert.equal(get("entry-reading").textContent, "ceoi1 gai1");
  assert.equal(get("entry-meaning").textContent, "Call in the crew");
  assert.match(get("example-en").textContent, /round everyone up/);
  assert.equal(doc.activeElement, get("entry-term"));
  click("back-index");
  assert.equal(doc.activeElement, second);
  set("search", "放飞机");
  assert.equal(get("entry-term").textContent, "放飛機");
  assert.equal(get("result-count").textContent, "1 entry");
});

test("topic changes, empty results and clearing filters keep the visible selection in sync", () => {
  const { get, doc, set, click } = page();
  set("dictionary-topic", "food");
  assert.equal(get("results").children.length, 8);
  set("search", "spring onion");
  assert.equal(get("entry-term").textContent, "走青");
  set("dictionary-topic", "talk");
  assert.equal(get("result-count").textContent, "0 entries");
  assert.equal(get("results").children.length, 0);
  assert.equal(get("entry-card").hidden, true);
  assert.equal(get("no-results").hidden, false);
  click("reset-search");
  assert.equal(get("search").value, "");
  assert.equal(get("dictionary-topic").value, "all");
  assert.equal(get("results").children.length, 40);
  assert.equal(get("entry-card").hidden, false);
  assert.equal(get("no-results").hidden, true);
  assert.equal(doc.activeElement, get("search"));
});

test("quiz setup enforces the selected topic's size and recovers from invalid input", () => {
  const { get, set, start } = page();
  assert.equal(get("quiz-count").max, "40");
  set("quiz-count", "30");
  set("quiz-topic", "food");
  assert.equal(get("quiz-count").max, "8");
  assert.equal(get("quiz-count").value, "8");
  assert.equal(get("quiz-limit").textContent, "(1–8)");
  for (const value of ["9", "", "1.5", "1e0", "0x2"]) {
    set("quiz-count", value);
    start();
    assert.equal(get("quiz-setup").hidden, false);
    assert.equal(get("quiz-play").hidden, true);
    assert.equal(get("quiz-error").hidden, false);
    assert.match(get("quiz-error").textContent, /1 to 8/);
  }
  set("quiz-count", "2");
  start();
  assert.equal(get("quiz-setup").hidden, true);
  assert.equal(get("quiz-play").hidden, false);
  assert.equal(get("quiz-error").hidden, true);
  assert.equal(get("choices").children.length, 4);
});

test("a mixed round rotates prompts, locks submitted choices and reports a perfect score", () => {
  const { get, click, set, start } = page();
  set("quiz-count", "3");
  start();
  const instructions = ["Choose the English meaning.", "Choose the Cantonese expression.", "Choose the Jyutping reading."];
  for (let i = 0; i < 3; i++) {
    assert.equal(get("position").textContent, "Question " + (i + 1) + " of 3");
    assert.equal(get("instruction").textContent, instructions[i]);
    assert.equal(get("question-hint").hidden, i !== 0);
    assert.equal(get("progress").value, i);
    assert.equal(get("next-question").hidden, true);
    const buttons = get("choices").children;
    buttons[0].click();
    // Even a second event delivered directly to the listener cannot double-score.
    buttons[0].dispatchEvent(new Event("click"));
    assert.ok(buttons.every(button => button.disabled));
    assert.equal(get("progress").value, i + 1);
    assert.match(get("feedback").textContent, /Correct!/);
    assert.equal(get("live-score").textContent, (i + 1) + " correct");
    assert.equal(get("next-question").hidden, false);
    click("next-question");
  }
  assert.equal(get("quiz-play").hidden, true);
  assert.equal(get("quiz-summary").hidden, false);
  assert.equal(get("summary-title").textContent, "Round complete");
  assert.equal(get("summary-score").textContent, "3 of 3 correct");
  assert.equal(get("review-block").hidden, true);
});

test("a missed answer gives the correct reading and a review, then a new round starts cleanly", () => {
  const { get, click, set, start } = page();
  set("quiz-topic", "work");
  set("quiz-mode", "reading");
  set("quiz-count", "1");
  start();
  assert.equal(get("question").textContent, "搞掂");
  assert.equal(get("question-hint").hidden, true);
  const [right, wrong] = get("choices").children;
  wrong.click();
  assert.match(right.className, /\bright\b/);
  assert.match(wrong.className, /\bwrong\b/);
  assert.match(get("feedback").textContent, /The answer is “gaau2 dim6”/);
  assert.equal(get("next-question").textContent, "See results");
  click("next-question");
  assert.equal(get("summary-score").textContent, "0 of 1 correct");
  assert.equal(get("review-block").hidden, false);
  assert.match(get("review-list").textContent, /You chose “zap1 saang1”. Answer “gaau2 dim6”/);
  click("new-round");
  assert.equal(get("quiz-setup").hidden, false);
  assert.equal(get("quiz-topic").value, "work");
  start();
  assert.equal(get("feedback").textContent, "");
  assert.equal(get("progress").value, 0);
  get("choices").children[0].click();
  click("next-question");
  assert.equal(get("review-list").children.length, 0);
  assert.equal(get("summary-score").textContent, "1 of 1 correct");
});

test("switching views preserves a search selection and quiz feedback mid-round", () => {
  const { get, click, set, start } = page();
  set("search", "ceoi1");
  get("results").children[1].click();
  start();
  get("choices").children[0].click();
  click("nav-dictionary");
  assert.equal(get("nav-dictionary").getAttribute("aria-pressed"), "true");
  assert.equal(get("quiz-view").hidden, true);
  assert.equal(get("search").value, "ceoi1");
  assert.equal(get("entry-term").textContent, "吹雞");
  click("nav-quiz");
  assert.equal(get("dictionary-view").hidden, true);
  assert.equal(get("quiz-play").hidden, false);
  assert.match(get("feedback").textContent, /Correct!/);
  click("end-round");
  assert.equal(get("summary-title").textContent, "Round ended");
  assert.equal(get("summary-score").textContent, "1 of 1 correct");
  assert.equal(get("summary-count").textContent, "1 of 5 questions answered.");
});

test("ending an unanswered round returns a meaningful empty summary and no review", () => {
  const { get, click, start } = page();
  start();
  click("end-round");
  assert.equal(get("summary-score").textContent, "No questions answered");
  assert.equal(get("summary-count").textContent, "0 of 5 questions answered.");
  assert.equal(get("review-block").hidden, true);
});

test("example lookup shows matching sentences and respects the dictionary filters", () => {
  const { get, set, click } = page();
  set("search", "Kowloon Tong");
  assert.equal(get("results").children.length, 0);
  set("search-scope", "examples");
  assert.equal(get("result-count").textContent, "1 entry");
  assert.equal(get("entry-term").textContent, "迫爆");
  assert.match(get("results").textContent, /九龍塘站個月台迫爆喇。/);
  assert.match(get("results").textContent, /The platform at Kowloon Tong/);
  assert.match(get("search-label").textContent, /example sentences/);
  click("toggle-save");
  click("dictionary-saved");
  set("search", "LUNG4-TONG4");
  assert.equal(get("result-count").textContent, "1 entry");
  set("dictionary-topic", "work");
  assert.equal(get("entry-card").hidden, true);
  click("reset-search");
  assert.equal(get("search-scope").value, "entries");
  assert.equal(get("dictionary-saved").checked, false);
  assert.equal(get("results").children.length, 40);
  assert.equal(get("book-count").textContent, "(1)");
});

test("saved expressions survive reloads and the last removal clears the card and quiz limit", () => {
  const storage = memoryStorage();
  const first = page(windowWith(storage));
  first.set("search", "放飞机");
  first.click("toggle-save");
  assert.equal(first.get("entry-term").textContent, "放飛機");
  assert.match(first.get("toggle-save").textContent, /Remove/);
  first.set("search", "埋單");
  first.click("toggle-save");
  const { get, click, set, doc } = page(windowWith(storage));
  assert.equal(get("book-note").hidden, true);
  assert.equal(get("book-count").textContent, "(2)");
  click("dictionary-saved");
  assert.equal(get("result-count").textContent, "2 entries");
  assert.equal(get("entry-term").textContent, "放飛機");
  click("quiz-saved");
  assert.equal(get("quiz-count").max, "2");
  set("quiz-topic", "food");
  assert.equal(get("quiz-count").value, "1");
  click("toggle-save");
  assert.equal(get("entry-term").textContent, "埋單");
  click("toggle-save");
  assert.equal(get("result-count").textContent, "0 entries");
  assert.equal(get("empty-title").textContent, "Your phrasebook is empty");
  assert.equal(get("entry-card").hidden, true);
  assert.equal(doc.activeElement, get("reset-search"));
  assert.equal(get("quiz-count").max, "0");
  assert.equal(get("start-round").disabled, true);
  assert.equal(get("quiz-empty").hidden, false);
  assert.equal(page(windowWith(storage)).get("book-count").textContent, "(0)");
  click("quiz-saved");
  assert.equal(get("start-round").disabled, false);
  assert.equal(get("quiz-empty").hidden, true);
  assert.equal(get("quiz-count").max, "8");
});

test("a saved web quiz keeps its target and topic choices even if the phrasebook changes mid-round", () => {
  const { get, click, set, start } = page();
  click("quiz-saved");
  assert.equal(get("start-round").disabled, true);
  set("search", "齊腳");
  click("toggle-save");
  assert.equal(get("start-round").disabled, false);
  set("quiz-mode", "meaning");
  start();
  assert.equal(get("question").textContent, "齊腳");
  assert.equal(get("position").textContent, "Question 1 of 1");
  assert.equal(get("choices").children.length, 4);
  assert.equal(get("choices").children[0].textContent, "Have enough people to start");
  click("nav-dictionary");
  click("toggle-save");
  click("nav-quiz");
  get("choices").children[0].click();
  click("next-question");
  assert.equal(get("summary-score").textContent, "1 of 1 correct");
  click("new-round");
  assert.equal(get("start-round").disabled, true);
});

test("unavailable storage and a failed write keep the phrasebook usable for the page session", () => {
  const blocked = new EventTarget();
  Object.defineProperty(blocked, "localStorage", { get() { throw new Error("Access denied"); } });
  const full = memoryStorage();
  full.setItem = () => { throw new Error("Storage full"); };
  for (const win of [blocked, windowWith(full)]) {
    const { get, click } = page(win);
    click("toggle-save");
    assert.equal(get("book-note").hidden, false);
    assert.equal(get("book-count").textContent, "(1)");
    click("dictionary-saved");
    assert.equal(get("entry-term").textContent, "吹水");
    click("toggle-save");
    assert.equal(get("book-count").textContent, "(0)");
    assert.equal(get("no-results").hidden, false);
  }
});

test("independent pages can save different expressions and refresh on storage changes or clear", () => {
  const storage = memoryStorage();
  storage.setItem("street-cantonese.phrasebook.吹水", "old-value");
  storage.setItem("street-cantonese.phrasebook.missing", "1");
  const win = windowWith(storage);
  const a = page(win);
  const b = page(windowWith(storage));
  assert.equal(a.get("book-count").textContent, "(0)");
  a.click("toggle-save");
  a.click("dictionary-saved");
  b.set("search", "搭枱");
  b.click("toggle-save");
  const notify = key => win.dispatchEvent(Object.assign(new Event("storage"), { key, storageArea: storage }));
  notify("some-other-app");
  assert.equal(a.get("result-count").textContent, "1 entry");
  notify("street-cantonese.phrasebook.搭枱");
  assert.equal(a.get("result-count").textContent, "2 entries");
  assert.equal(a.get("entry-term").textContent, "吹水");
  assert.equal(page(windowWith(storage)).get("book-count").textContent, "(2)");
  storage.clear();
  notify(null);
  assert.equal(a.get("entry-card").hidden, true);
  assert.equal(a.get("result-count").textContent, "0 entries");
});

test("typed web practice preserves a draft, explains tone mistakes and retries just the miss", () => {
  const { doc, get, click, set, start, submit } = page();
  set("quiz-topic", "food");
  set("quiz-mode", "type");
  set("quiz-count", "3");
  start();
  assert.equal(get("question").textContent, "埋單");
  assert.equal(get("choices").hidden, true);
  assert.equal(get("choices").children.length, 0);
  assert.equal(get("question-hint").hidden, true);
  assert.equal(get("type-form").hidden, false);
  assert.equal(doc.activeElement, get("typed-reading"));
  set("typed-reading", "maai daan");
  submit("type-form");
  assert.equal(get("type-error").hidden, false);
  assert.equal(get("typed-reading").getAttribute("aria-invalid"), "true");
  assert.equal(get("progress").value, 0);
  set("typed-reading", "maai5 daan1");
  click("nav-dictionary");
  click("nav-quiz");
  assert.equal(get("typed-reading").value, "maai5 daan1");
  submit("type-form");
  submit("type-form");
  assert.equal(get("type-error").hidden, true);
  assert.equal(get("progress").value, 1);
  assert.equal(get("typed-reading").disabled, true);
  assert.match(get("feedback").textContent, /埋 · maai5 → maai4 \(tone 4, low falling\)/);
  assert.equal(doc.activeElement, get("next-question"));
  click("next-question");
  assert.equal(get("typed-reading").value, "");
  assert.equal(get("typed-reading").disabled, false);
  set("typed-reading", "ＤＡＡＰ３－ＴＯＩ２");
  submit("type-form");
  click("end-round");
  assert.equal(get("summary-score").textContent, "1 of 2 correct");
  assert.equal(get("summary-count").textContent, "2 of 3 questions answered.");
  assert.match(get("review-list").textContent, /You typed “maai5 daan1”. Answer “maai4 daan1”/);
  assert.equal(get("retry-missed").hidden, false);
  click("retry-missed");
  assert.equal(get("question").textContent, "埋單");
  assert.equal(get("position").textContent, "Question 1 of 1");
  assert.equal(get("progress").value, 0);
  set("typed-reading", "maai4daan1");
  submit("type-form");
  click("next-question");
  assert.equal(get("summary-score").textContent, "1 of 1 correct");
  assert.equal(get("review-list").children.length, 0);
  assert.equal(get("retry-missed").hidden, true);
});

test("retry from a partial mixed round restores the missed direction and ignores old choice buttons", () => {
  const { get, click, set, start } = page();
  set("quiz-count", "3");
  start();
  get("choices").children[0].click();
  click("next-question");
  const prompt = get("question").textContent;
  const stale = get("choices").children[1];
  stale.click();
  click("end-round");
  assert.equal(get("summary-score").textContent, "1 of 2 correct");
  click("retry-missed");
  assert.equal(get("position").textContent, "Question 1 of 1");
  assert.equal(get("question").textContent, prompt);
  assert.equal(get("instruction").textContent, "Choose the Cantonese expression.");
  assert.equal(get("choices").children.length, 4);
  stale.dispatchEvent(new Event("click"));
  assert.equal(get("progress").value, 0);
  get("choices").children[0].click();
  click("next-question");
  assert.equal(get("summary-score").textContent, "1 of 1 correct");
  assert.equal(get("retry-missed").hidden, true);
});

test("the reader highlights exact source spans and opens the canonical card across active filters", () => {
  const { get, set, click, doc } = page();
  set("dictionary-topic", "work");
  set("search-scope", "examples");
  click("dictionary-saved");
  click("nav-reader");
  assert.equal(get("nav-reader").getAttribute("aria-pressed"), "true");
  assert.equal(get("reader-results").hidden, true);
  const text = "🍜 <b>搭檯</b>\n放我哋飞机，又搭台。";
  set("passage", text);
  assert.equal(get("reader-results").hidden, false);
  assert.equal(get("reader-status").textContent, "2 expressions · 3 matches");
  const marked = get("marked-passage");
  assert.equal(marked.textContent, text);
  assert.deepEqual(marked.children.map(node => [node.tag, node.textContent]), [
    ["mark", "搭檯"], ["mark", "放我哋飞机"], ["mark", "搭台"],
  ]);
  const words = get("reader-words").children;
  assert.equal(words.length, 2);
  assert.match(words[0].textContent, /搭枱.*daap3 toi2.*×2.*Share a table.*搭檯 \/ 搭台/);
  const termButton = words[1].children[0].children[0];
  assert.equal(termButton.textContent, "放飛機");
  termButton.click();
  assert.equal(get("reader-view").hidden, true);
  assert.equal(get("dictionary-view").hidden, false);
  assert.equal(get("entry-term").textContent, "放飛機");
  assert.equal(get("search").value, "放飛機");
  assert.equal(get("dictionary-topic").value, "all");
  assert.equal(get("search-scope").value, "entries");
  assert.equal(get("dictionary-saved").checked, false);
  assert.equal(doc.activeElement, get("entry-term"));
  click("nav-reader");
  assert.equal(get("passage").value, text);
  assert.equal(marked.textContent, text);
});

test("trying a sample and clearing or replacing a passage refreshes both the reader and quiz limit", () => {
  const { get, set, click, doc } = page();
  click("quiz-passage");
  assert.equal(get("start-round").disabled, true);
  assert.match(get("quiz-empty").textContent, /Reader/);
  click("nav-reader");
  click("reader-sample");
  assert.ok(get("passage").value.includes("九龍塘"));
  assert.equal(doc.activeElement, get("passage"));
  assert.equal(get("reader-words").children.length, 4);
  assert.equal(get("quiz-count").max, "4");
  set("quiz-topic", "food");
  assert.equal(get("quiz-count").max, "2");
  click("quiz-saved");
  assert.equal(get("quiz-count").max, "0");
  set("book-list", "埋單");
  click("book-import");
  assert.equal(get("quiz-count").max, "1");
  for (const text of ["返學", " "]) {
    set("passage", text);
    assert.equal(get("reader-results").hidden, true);
    assert.equal(get("reader-words").children.length, 0);
    assert.equal(get("marked-passage").textContent, "");
    assert.equal(get("reader-status").textContent, text.trim() ? "No dictionary expressions found in this passage." : "");
    assert.equal(get("start-round").disabled, true);
    assert.equal(get("quiz-passage-count").textContent, "(0)");
  }
  click("quiz-passage");
  assert.equal(get("start-round").disabled, false);
});

test("a passage cloze round reveals its full reading after grading and survives edits to the passage", () => {
  const { get, set, click, start, doc } = page();
  click("quiz-saved");
  set("quiz-topic", "work");
  click("nav-reader");
  set("passage", "放我飞机，又放飛機。搭檯。");
  click("reader-quiz");
  assert.equal(get("quiz-view").hidden, false);
  assert.equal(get("quiz-setup").hidden, false);
  assert.equal(get("quiz-passage").checked, true);
  assert.equal(get("quiz-saved").checked, false);
  assert.equal(get("quiz-topic").value, "all");
  assert.equal(get("quiz-count").value, "2");
  assert.equal(doc.activeElement, get("quiz-mode"));
  set("quiz-mode", "cloze");
  start();
  assert.equal(get("reader-quiz").hidden, true);
  assert.equal(get("question").textContent, "你尋日□我□□喎。");
  assert.equal(get("question").lang, "yue-Hant");
  assert.equal(get("question-hint").textContent, "Hey, you stood me up yesterday.");
  assert.equal(get("question-hint").lang, "en");
  assert.ok(get("choices").children.every(node => node.lang === "yue-Hant"));
  assert.equal(get("feedback").textContent, "");
  click("nav-reader");
  set("passage", "埋單。");
  get("reader-quiz").dispatchEvent(new Event("click"));
  assert.equal(get("reader-view").hidden, false);
  click("nav-quiz");
  assert.equal(get("position").textContent, "Question 1 of 2");
  const wrong = get("choices").children[1];
  wrong.click();
  assert.match(get("feedback").textContent, /The answer is “放飛機”/);
  assert.match(get("feedback").textContent, /你尋日放我飛機喎。/);
  assert.match(get("feedback").textContent, /nei5 cam4 jat6 fong3 ngo5 fei1 gei1 wo3/);
  click("end-round");
  assert.equal(get("summary-score").textContent, "0 of 1 correct");
  assert.equal(get("reader-quiz").hidden, false);
  click("retry-missed");
  assert.equal(get("position").textContent, "Question 1 of 1");
  assert.equal(get("question").textContent, "你尋日□我□□喎。");
  assert.equal(get("feedback").textContent, "");
  wrong.dispatchEvent(new Event("click"));
  assert.equal(get("progress").value, 0);
  get("choices").children[0].click();
  click("next-question");
  assert.equal(get("summary-score").textContent, "1 of 1 correct");
  click("new-round");
  start();
  assert.equal(get("question").textContent, "唔該，□□。");
});

test("web list import validates the entire draft, merges aliases and exports a selected portable list", () => {
  const storage = memoryStorage();
  const { get, set, click, doc } = page(windowWith(storage));
  click("toggle-save");
  click("dictionary-saved");
  click("quiz-saved");
  const list = get("book-list");
  const draft = "\uFEFF放飞机\r\n\nno such word\r\nmaai4 daan1";
  set("book-list", draft);
  click("book-import");
  assert.equal(list.value, draft);
  assert.equal(doc.activeElement, list);
  assert.equal(list.getAttribute("aria-invalid"), "true");
  assert.match(get("transfer-status").textContent, /Line 3/);
  assert.equal(get("book-count").textContent, "(1)");
  assert.equal(get("quiz-count").max, "1");
  set("book-list", draft.replace("no such word", "放飛機") + "\n吹水");
  assert.equal(list.getAttribute("aria-invalid"), "false");
  assert.equal(get("transfer-status").textContent, "");
  click("book-import");
  assert.equal(get("transfer-status").textContent, "Added 2 expressions. 1 already saved.");
  assert.equal(get("result-count").textContent, "3 entries");
  assert.equal(get("entry-term").textContent, "吹水");
  assert.equal(get("quiz-count").max, "3");
  click("book-export");
  assert.equal(list.value, "吹水\n放飛機\n埋單");
  assert.equal(doc.activeElement, list);
  assert.equal(list.selectionStart, 0);
  assert.equal(list.selectionEnd, list.value.length);
  click("book-import");
  assert.equal(get("transfer-status").textContent, "Added 0 expressions. 3 already saved.");
  const again = page(windowWith(storage));
  again.click("book-export");
  assert.equal(again.get("book-list").value, list.value);
});

test("empty transfers preserve saves and a storage failure midway still permits a full session export", () => {
  const storage = memoryStorage();
  const save = storage.setItem;
  storage.setItem = (key, value) => {
    if (key.endsWith("埋單")) throw new Error("Full");
    save(key, value);
  };
  const { get, set, click } = page(windowWith(storage));
  click("book-export");
  assert.equal(get("book-list").value, "");
  assert.match(get("transfer-status").textContent, /empty/);
  set("book-list", "吹水\n埋單\n潛水");
  click("book-import");
  assert.equal(get("book-note").hidden, false);
  assert.equal(get("book-count").textContent, "(3)");
  assert.equal(get("transfer-status").textContent, "Added 3 expressions. 0 already saved.");
  set("book-list", "\r\n ");
  click("book-import");
  assert.match(get("transfer-status").textContent, /list is empty/);
  click("book-export");
  assert.equal(get("book-list").value, "吹水\n潛水\n埋單");
  const reloaded = page(windowWith(storage));
  reloaded.click("book-export");
  assert.equal(reloaded.get("book-list").value, "吹水");
});

test("temporary limits restore the learner's chosen question count as a collection grows again", () => {
  const { get, set, click } = page();
  click("quiz-passage");
  set("passage", "埋單");
  assert.equal(get("quiz-count").value, "1");
  const larger = "埋單、搭枱、放飛機、迫爆、齊腳、吹水";
  set("passage", larger);
  assert.equal(get("quiz-count").value, "5");
  set("quiz-count", "3");
  set("quiz-topic", "food");
  assert.equal(get("quiz-count").value, "2");
  set("quiz-topic", "work");
  assert.equal(get("quiz-count").disabled, true);
  set("quiz-topic", "all");
  assert.equal(get("quiz-count").value, "3");
  click("quiz-passage");
  click("quiz-saved");
  set("book-list", "搭檯");
  click("book-import");
  assert.equal(get("quiz-count").value, "1");
  set("book-list", "吹水\n埋單\n迫爆");
  click("book-import");
  assert.equal(get("quiz-count").value, "3");
});
