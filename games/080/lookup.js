"use strict";

const StreetLookup = (() => {
  const { entries, topics } = typeof module === "object" && module.exports
    ? require("./entries.js") : StreetLexicon;

  function normalize(text) {
    return text.normalize("NFKC").trim().toLowerCase();
  }

  function englishWords(text) {
    return normalize(text).replace(/['’]/g, "").match(/[\p{L}\p{N}]+/gu) || [];
  }

  function readingSuffixes(reading) {
    const syllables = reading.split(" ");
    return syllables.map((_, i) => syllables.slice(i).join(""));
  }

  const withoutPunctuation = text => text.replace(/[\s\p{P}]+/gu, "");
  const index = entries.map(entry => {
    const gloss = englishWords(entry.meaning);
    const tags = entry.keywords.map(englishWords);
    const translation = englishWords(entry.example.en);
    return {
      entry,
      heads: [entry.term, ...entry.forms].map(normalize),
      readings: readingSuffixes(entry.jyutping),
      gloss: gloss.join(" "),
      tags: tags.map(words => words.join(" ")),
      words: [...gloss, ...tags.flat()],
      example: {
        chinese: withoutPunctuation(normalize(entry.example.zh)),
        readings: readingSuffixes(entry.example.jyutping),
        words: translation,
        phrase: translation.join(" "),
      },
    };
  });

  function queryParts(query) {
    const text = normalize(query);
    const spaced = text.replace(/[\s'’-]+/g, " ");
    const words = englishWords(text);
    return {
      text, words, phrase: words.join(" "),
      reading: /^[a-z][a-z1-6]*(?: [a-z][a-z1-6]*)*$/.test(spaced) ? spaced : "",
      chinese: withoutPunctuation(text),
    };
  }

  // A stored tone can be omitted. A tone the learner types must match.
  function readingPrefix(reading, query) {
    let letter = 0;
    let typed = 0;
    while (letter < reading.length && typed < query.length) {
      const current = reading[letter++];
      if (current >= "1" && current <= "6") {
        if (query[typed] === current) typed++;
        if (query[typed] === " ") typed++;
      } else if (current === query[typed]) typed++;
      else return 0;
    }
    if (typed < query.length) return 0;
    return /^[1-6]*$/.test(reading.slice(letter)) ? 2 : 1;
  }

  function readingScore(suffixes, reading) {
    if (!reading) return 0;
    let score = 0;
    for (const [i, suffix] of suffixes.entries()) {
      const match = readingPrefix(suffix, reading);
      if (match) score = Math.max(score, (i === 0 ? 60 : 30) + 10 * match);
    }
    return score;
  }

  function wordMatch(fields, words) {
    return words.length > 0 && words.every(word => {
      if (/^\d+$/.test(word)) return fields.includes(word);
      return fields.some(field => field.startsWith(word));
    });
  }

  function entryRank(record, query) {
    if (record.heads[0] === query.text) return 100;
    if (record.heads.includes(query.text)) return 95;
    if (record.heads.some(head => head.includes(query.text))) return 65;
    const score = readingScore(record.readings, query.reading);
    if (record.gloss === query.phrase) return Math.max(score, 90);
    if (record.tags.includes(query.phrase)) return Math.max(score, 75);
    return Math.max(score, wordMatch(record.words, query.words) ? 55 : 0);
  }

  function exampleRank({ example }, query) {
    if (query.chinese && example.chinese.includes(query.chinese)) return 100;
    if (query.phrase && example.phrase === query.phrase) return 90;
    return Math.max(readingScore(example.readings, query.reading),
      wordMatch(example.words, query.words) ? 55 : 0);
  }

  function search(query = "", topic = "all", { scope = "entries", savedTerms } = {}) {
    if (topic !== "all" && !Object.hasOwn(topics, topic)) {
      throw new RangeError("Unknown topic. Choose all, " + Object.keys(topics).join(", ") + ".");
    }
    if (scope !== "entries" && scope !== "examples") {
      throw new RangeError("Choose entries or examples as the search scope.");
    }
    const pool = index.filter(({ entry }) => (topic === "all" || entry.topic === topic)
      && (!savedTerms || savedTerms.has(entry.term)));
    const parts = queryParts(query);
    if (!parts.text) return pool.map(record => record.entry);
    const rank = scope === "examples" ? exampleRank : entryRank;
    return pool.map(record => ({ entry: record.entry, score: rank(record, parts) }))
      .filter(hit => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(hit => hit.entry);
  }

  // Mutating a phrasebook requires a complete, unambiguous expression.
  function resolveEntry(query = "") {
    const { text, reading } = queryParts(query);
    const matches = index.filter(record => record.heads.includes(text)
      || (reading && readingPrefix(record.readings[0], reading) === 2));
    return matches.length === 1 ? matches[0].entry : undefined;
  }

  return { entries, topics, search, resolveEntry };
})();

if (typeof module === "object" && module.exports) module.exports = StreetLookup;
