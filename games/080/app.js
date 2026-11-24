"use strict";

function mountStreetCantonese(doc, dictionary) {
  const { topics, modes } = dictionary;
  const byId = id => doc.getElementById(id);
  const field = (id, text) => { byId(id).textContent = text; };
  function element(tag, text, lang) {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (lang) node.lang = lang;
    return node;
  }

  function populate(id, options) {
    const items = Object.entries(options).map(([value, label]) => {
      const option = element("option", label);
      option.value = value;
      return option;
    });
    byId(id).replaceChildren(...items);
    byId(id).value = items[0].value;
  }

  const topicOptions = { all: "All topics", ...topics };
  populate("dictionary-topic", topicOptions);
  populate("quiz-topic", topicOptions);
  populate("quiz-mode", modes);
  populate("search-scope", { entries: "Expressions", examples: "Example sentences" });

  const views = ["dictionary", "reader", "quiz"];
  function showView(view) {
    for (const name of views) {
      byId(name + "-view").hidden = name !== view;
      byId("nav-" + name).setAttribute("aria-pressed", String(name === view));
    }
  }
  for (const view of views) {
    byId("nav-" + view).addEventListener("click", () => showView(view));
  }

  const ui = { byId, field, element };
  const book = StreetPhrasebook.pagePhrasebook(doc.defaultView);
  const quiz = mountQuiz(ui, dictionary, book);
  const { updateBook, openEntry } = mountLookup(ui, dictionary, book, quiz.updateLimit);
  mountBookTransfer(ui, book, updateBook);
  mountReader(ui, entry => {
    showView("dictionary");
    openEntry(entry);
  }, quiz.setPassage);
  byId("reader-quiz").addEventListener("click", () => {
    if (quiz.preparePassage()) {
      showView("quiz");
      byId("quiz-mode").focus();
    }
  });
  doc.defaultView?.addEventListener("storage", event => {
    if (book.refresh(event)) updateBook();
  });
}

function mountLookup({ byId, field, element }, { topics, search }, book, updateQuizLimit) {
  let activeButton;
  let activeEntry;
  function showSaveAction() {
    field("toggle-save", book.terms.has(activeEntry.term) ? "Remove from phrasebook" : "Save to phrasebook");
  }

  function showEntry(entry, button) {
    if (activeButton) activeButton.setAttribute("aria-pressed", "false");
    activeButton = button;
    activeEntry = entry;
    button.setAttribute("aria-pressed", "true");
    field("entry-topic", topics[entry.topic]);
    field("entry-term", entry.term);
    field("entry-reading", entry.jyutping);
    field("entry-meaning", entry.meaning);
    field("entry-note", entry.note);
    field("example-zh", entry.example.zh);
    field("example-reading", entry.example.jyutping);
    field("example-en", entry.example.en);
    showSaveAction();
  }

  function updateResults(preferred) {
    const scope = byId("search-scope").value;
    const savedTerms = byId("dictionary-saved").checked ? book.terms : undefined;
    const hits = search(byId("search").value, byId("dictionary-topic").value, { scope, savedTerms });
    const label = scope === "examples" ? "Search example sentences in Chinese, Jyutping, or English"
      : "Search Chinese, Jyutping, or English";
    byId("search").placeholder = label;
    field("search-label", label);
    field("result-count", hits.length + (hits.length === 1 ? " entry" : " entries"));
    byId("entry-card").hidden = !hits.length;
    byId("no-results").hidden = Boolean(hits.length);
    activeButton = null;
    activeEntry = null;
    if (!hits.length) {
      const emptyBook = savedTerms?.size === 0;
      field("empty-title", emptyBook ? "Your phrasebook is empty" : "No matching expressions");
      field("empty-hint", emptyBook ? "Clear the filters, select an expression and save it to your phrasebook."
        : "Try a shorter search or change the filters.");
    }
    const buttons = hits.map(entry => {
      const button = element("button");
      button.type = "button";
      button.className = "result";
      button.setAttribute("aria-controls", "entry-card");
      button.setAttribute("aria-pressed", "false");
      const term = element("span", entry.term, "yue-Hant");
      term.className = "result-term";
      const gloss = element("span", scope === "examples" ? entry.example.en : entry.meaning);
      gloss.className = "result-gloss";
      button.append(term);
      if (scope === "examples") button.append(element("span", entry.example.zh, "yue-Hant"));
      button.append(gloss);
      button.addEventListener("click", () => {
        showEntry(entry, button);
        byId("entry-term").focus();
      });
      return button;
    });
    byId("results").replaceChildren(...buttons);
    byId("results").scrollTop = 0;
    if (hits.length) {
      const index = Math.max(0, hits.indexOf(preferred));
      showEntry(hits[index], buttons[index]);
    }
  }

  byId("search").addEventListener("input", () => updateResults());
  for (const id of ["dictionary-topic", "search-scope", "dictionary-saved"]) {
    byId(id).addEventListener("change", () => updateResults());
  }
  byId("back-index").addEventListener("click", () => activeButton?.focus());
  function resetFilters(query) {
    byId("search").value = query;
    byId("dictionary-topic").value = "all";
    byId("search-scope").value = "entries";
    byId("dictionary-saved").checked = false;
    updateResults();
  }
  byId("reset-search").addEventListener("click", () => {
    resetFilters("");
    byId("search").focus();
  });
  function updateBook() {
    field("book-count", "(" + book.terms.size + ")");
    byId("book-note").hidden = book.persistent;
    if (byId("dictionary-saved").checked) updateResults(activeEntry);
    else if (activeEntry) showSaveAction();
    updateQuizLimit();
  }
  byId("toggle-save").addEventListener("click", () => {
    if (!activeEntry) return;
    book.set(activeEntry, !book.terms.has(activeEntry.term));
    updateBook();
    if (!activeEntry) byId("reset-search").focus();
  });
  updateResults();
  updateBook();
  function openEntry(entry) {
    resetFilters(entry.term);
    byId("entry-term").focus();
  }
  return { updateBook, openEntry };
}

function mountBookTransfer({ byId }, book, updateBook) {
  const list = byId("book-list");
  const status = byId("transfer-status");
  list.addEventListener("input", () => {
    list.setAttribute("aria-invalid", "false");
    status.textContent = "";
  });
  byId("book-export").addEventListener("click", () => {
    list.value = StreetPhrasebook.exportList(book.terms);
    list.setAttribute("aria-invalid", "false");
    status.textContent = list.value ? "Saved headwords selected for copying." : "Your phrasebook is empty.";
    list.focus();
    list.select();
  });
  byId("book-import").addEventListener("click", () => {
    try {
      const result = StreetPhrasebook.importList(list.value, book);
      updateBook();
      status.textContent = StreetPhrasebook.importSummary(result);
      list.setAttribute("aria-invalid", "false");
    } catch (err) {
      status.textContent = err.message;
      list.setAttribute("aria-invalid", "true");
      list.focus();
    }
  });
}

function mountReader({ byId, element, field }, openEntry, setPassage) {
  const input = byId("passage");
  function vocabularyRow({ entry, count, variants }) {
    const row = element("li");
    const button = element("button", entry.term, "yue-Hant");
    button.type = "button";
    button.className = "text-button";
    button.title = "Open dictionary entry";
    button.setAttribute("aria-controls", "entry-card");
    button.addEventListener("click", () => openEntry(entry));
    const head = element("div");
    head.className = "reader-word";
    const reading = element("span", entry.jyutping, "yue-Latn");
    reading.className = "transcription";
    head.append(button, " ", reading);
    if (count > 1) head.append(element("small", `×${count}`));
    row.append(head, element("p", entry.meaning));
    if (variants.size) {
      const note = element("small", "As written · ");
      note.append(element("span", [...variants].join(" / "), "yue-Hant"));
      row.append(note);
    }
    return row;
  }

  function update() {
    const text = input.value;
    const { matches, vocabulary, terms, summary } = StreetPassages.readPassage(text);
    setPassage(terms);
    field("reader-status", text.trim() ? summary : "");
    byId("reader-results").hidden = !matches.length;
    const marked = byId("marked-passage");
    marked.replaceChildren();
    let offset = 0;
    for (const match of matches) {
      marked.append(text.slice(offset, match.start), element("mark", match.surface));
      offset = match.end;
    }
    if (matches.length) marked.append(text.slice(offset));
    byId("reader-words").replaceChildren(...vocabulary.map(vocabularyRow));
  }
  input.addEventListener("input", update);
  byId("reader-sample").addEventListener("click", () => {
    input.value = "交完功課，我哋喺九龍塘搭枱食飯，吹陣水。\n阿澄一到就齊腳喇。埋單先，跟住玩三對三！";
    update();
    input.focus();
  });
  update();
}

mountStreetCantonese(document, StreetDictionary);
