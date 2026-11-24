"use strict";

const StreetDictionary = (() => {
  const { entries, topics, search, resolveEntry } = typeof module === "object" && module.exports
    ? require("./lookup.js") : StreetLookup;
  const { gapPrompt } = typeof module === "object" && module.exports ? require("./passage.js") : StreetPassages;

  const modes = {
    mixed: "Mixed practice",
    meaning: "Cantonese to English",
    term: "English to Cantonese",
    reading: "Cantonese to Jyutping",
    type: "Typed Jyutping",
    cloze: "Sentence gaps",
  };
  const mixedDirections = ["meaning", "term", "reading"];
  const directions = {
    meaning: {
      prompt: entry => entry.term, hint: entry => entry.jyutping, answer: "meaning",
      instruction: "Choose the English meaning.",
    },
    term: {
      prompt: entry => entry.meaning, answer: "term", instruction: "Choose the Cantonese expression.",
    },
    reading: {
      prompt: entry => entry.term, answer: "jyutping", instruction: "Choose the Jyutping reading.",
    },
    cloze: {
      prompt: gapPrompt, hint: entry => entry.example.en, answer: "term",
      instruction: "Choose the expression missing from the sentence.",
    },
  };

  const tones = ["high level", "high rising", "mid level", "low falling", "low rising", "low level"];

  function shuffled(values, random) {
    const copy = [...values];
    for (let end = copy.length - 1; end > 0; end--) {
      const pick = Math.floor(random() * (end + 1));
      [copy[end], copy[pick]] = [copy[pick], copy[end]];
    }
    return copy;
  }

  function makeQuestion(entry, mode, random) {
    if (mode === "type") {
      return {
        entry, mode, prompt: entry.term, hint: "",
        instruction: "Type the Jyutping with a tone number for every syllable.",
      };
    }
    const direction = directions[mode];
    const neighbours = entries.filter(other => other !== entry && other.topic === entry.topic);
    const distractors = shuffled(neighbours, random).slice(0, 3);
    const choices = shuffled([entry, ...distractors].map(option => option[direction.answer]), random);
    return {
      entry, mode, choices,
      instruction: direction.instruction,
      prompt: direction.prompt(entry),
      hint: direction.hint?.(entry) || "",
      correctIndex: choices.indexOf(entry[direction.answer]),
    };
  }

  function gradeReading(question, input) {
    const expected = question.entry.jyutping.split(" ");
    const text = typeof input === "string" ? input.normalize("NFKC").trim().toLowerCase() : "";
    const wellFormed = /^[a-z]+[1-6](?:[\s'’-]*[a-z]+[1-6])*$/.test(text);
    const syllables = wellFormed ? text.match(/[a-z]+[1-6]/g) : [];
    if (syllables.length !== expected.length) {
      throw new RangeError(`Enter ${expected.length} syllables, each ending in a tone number from 1 to 6.`);
    }
    const characters = Array.from(question.entry.term);
    const corrections = [];
    expected.forEach((right, i) => {
      if (syllables[i] === right) return;
      const changes = [];
      if (syllables[i].slice(0, -1) !== right.slice(0, -1)) changes.push("spelling");
      if (syllables[i].at(-1) !== right.at(-1)) {
        const tone = Number(right.at(-1));
        changes.push(`tone ${tone}, ${tones[tone - 1]}`);
      }
      corrections.push(`${characters[i]} · ${syllables[i]} → ${right} (${changes.join(" and ")})`);
    });
    return { question, choice: syllables.join(" "), correct: !corrections.length, corrections };
  }

  function gradeChoice(question, choice) {
    if (!Number.isInteger(choice) || choice < 0 || choice >= question.choices.length) {
      throw new RangeError("Choose one of the listed answers.");
    }
    return { question, choice, correct: choice === question.correctIndex };
  }

  function correctAnswer(question) {
    return question.mode === "type" ? question.entry.jyutping : question.choices[question.correctIndex];
  }

  function reviewAnswer({ question, choice }) {
    const submitted = question.mode === "type" ? `typed “${choice}”` : `chose “${question.choices[choice]}”`;
    return `You ${submitted}. Answer “${correctAnswer(question)}”.`;
  }

  class Round {
    constructor(questions) {
      this.questions = questions;
      this.answers = [];
      this.position = 0;
    }

    get current() { return this.questions[this.position]; }
    get feedback() { return this.answers[this.position]; }
    get finished() { return this.position === this.questions.length; }
    get score() { return this.answers.filter(answer => answer.correct).length; }
    get missed() { return this.answers.filter(answer => !answer.correct); }

    answer(choice) {
      if (this.finished) throw new Error("This round has ended.");
      if (this.feedback) throw new Error("This question has already been answered.");
      const question = this.current;
      const result = question.mode === "type" ? gradeReading(question, choice) : gradeChoice(question, choice);
      this.answers.push(result);
      return result;
    }

    advance() {
      if (this.finished) throw new Error("This round has ended.");
      if (!this.feedback) throw new Error("Answer the current question first.");
      this.position++;
    }

    finish() { this.position = this.questions.length; }

    retryMissed(random = Math.random) {
      if (!this.finished) throw new Error("Finish the current round before retrying.");
      const missed = this.missed;
      if (!missed.length) throw new Error("No missed answers to retry.");
      return new Round(shuffled(missed, random).map(({ question }) =>
        makeQuestion(question.entry, question.mode, random)));
    }
  }

  function parseQuestionCount(text) {
    return /^\d+$/.test(text) ? Number(text) : NaN;
  }

  function quizPool({ topic = "all", savedTerms, passageTerms } = {}) {
    const pool = search("", topic, { savedTerms });
    return passageTerms ? pool.filter(entry => passageTerms.has(entry.term)) : pool;
  }

  function createRound({ topic, count, mode = "mixed", savedTerms, passageTerms, random = Math.random } = {}) {
    const pool = quizPool({ topic, savedTerms, passageTerms });
    if (!pool.length && passageTerms) throw new RangeError("No expressions from the passage match these quiz filters.");
    if (!pool.length) throw new RangeError("No saved expressions in this topic. Save an expression or choose another topic.");
    const size = count === undefined ? Math.min(5, pool.length) : count;
    if (!Number.isInteger(size) || size < 1 || size > pool.length) {
      throw new RangeError("Choose a question count from 1 to " + pool.length + ".");
    }
    if (!Object.hasOwn(modes, mode)) {
      throw new RangeError("Unknown quiz mode. Choose " + Object.keys(modes).join(", ") + ".");
    }
    const cycle = mode === "mixed" ? shuffled(mixedDirections, random) : [mode];
    const questions = shuffled(pool, random).slice(0, size).map((entry, i) =>
      makeQuestion(entry, cycle[i % cycle.length], random),
    );
    return new Round(questions);
  }

  return { entries, topics, modes, search, resolveEntry, quizPool, createRound, parseQuestionCount, correctAnswer, reviewAnswer };
})();

if (typeof module === "object" && module.exports) module.exports = StreetDictionary;
