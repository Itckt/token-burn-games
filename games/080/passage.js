"use strict";

const StreetPassages = (() => {
  const { entries } = typeof module === "object" && module.exports
    ? require("./entries.js") : StreetLexicon;
  const byInitial = new Map();

  function register(entry, surface, mask) {
    const initial = surface[0];
    if (!byInitial.has(initial)) byInitial.set(initial, []);
    byInitial.get(initial).push({ entry, surface, mask });
  }

  for (const entry of entries) {
    for (const form of [entry.term, ...entry.forms]) {
      const [first, ...rest] = Array.from(form);
      const tailMask = "□".repeat(rest.length);
      register(entry, form, "□" + tailMask);
      for (const infix of entry.infixes || []) {
        register(entry, first + infix + rest.join(""), "□" + infix + tailMask);
      }
    }
  }
  for (const patterns of byInitial.values()) patterns.sort((a, b) => b.surface.length - a.surface.length);

  // Offsets refer to the original string, so punctuation, emoji and line breaks survive rendering.
  function findMatches(text) {
    const matches = [];
    let start = 0;
    while (start < text.length) {
      const match = byInitial.get(text[start])?.find(pattern => text.startsWith(pattern.surface, start));
      if (match) {
        const end = start + match.surface.length;
        matches.push({ ...match, start, end });
        start = end;
      } else {
        start++;
      }
    }
    return matches;
  }

  function readPassage(text) {
    const matches = findMatches(text);
    const grouped = new Map();
    for (const { entry, surface } of matches) {
      if (!grouped.has(entry.term)) grouped.set(entry.term, { entry, count: 0, variants: new Set() });
      const item = grouped.get(entry.term);
      item.count++;
      if (surface !== entry.term) item.variants.add(surface);
    }
    const vocabulary = [...grouped.values()];
    const summary = matches.length
      ? `${vocabulary.length} expression${vocabulary.length === 1 ? "" : "s"} · ${matches.length} match${matches.length === 1 ? "" : "es"}`
      : "No dictionary expressions found in this passage.";
    return { matches, vocabulary, terms: new Set(grouped.keys()), summary };
  }

  function gapPrompt(entry) {
    const text = entry.example.zh;
    let prompt = "";
    let offset = 0;
    for (const match of findMatches(text)) {
      if (match.entry.term !== entry.term) continue;
      prompt += text.slice(offset, match.start) + match.mask;
      offset = match.end;
    }
    if (!offset) throw new Error(`The example for ${entry.term} needs a matching expression.`);
    return prompt + text.slice(offset);
  }

  return { readPassage, gapPrompt };
})();

if (typeof module === "object" && module.exports) module.exports = StreetPassages;
