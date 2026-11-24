"use strict";

function mountQuiz({ byId, field, element }, { quizPool, createRound, parseQuestionCount, correctAnswer, reviewAnswer }, book) {
  let round;
  let passageTerms = new Set();
  const count = byId("quiz-count");
  let requestedCount = count.value;
  count.addEventListener("input", () => { requestedCount = count.value; });
  function stage(active) {
    for (const id of ["quiz-setup", "quiz-play", "quiz-summary"]) byId(id).hidden = id !== active;
    byId("reader-quiz").hidden = active === "quiz-play";
  }

  function filters() {
    return {
      topic: byId("quiz-topic").value,
      savedTerms: byId("quiz-saved").checked ? book.terms : undefined,
      passageTerms: byId("quiz-passage").checked ? passageTerms : undefined,
    };
  }
  function updateLimit() {
    const max = quizPool(filters()).length;
    count.max = String(max);
    count.disabled = !max;
    byId("start-round").disabled = !max;
    byId("quiz-empty").hidden = Boolean(max);
    field("quiz-empty", byId("quiz-passage").checked ? "Enter a passage in the Reader or change the quiz filters."
      : "Save an expression in this topic or change the collection to start a round.");
    byId("quiz-error").hidden = true;
    if (!max) count.value = "";
    else count.value = parseQuestionCount(requestedCount) > max ? String(max) : requestedCount;
    field("quiz-limit", max ? `(1–${max})` : "(0 available)");
  }
  byId("quiz-topic").addEventListener("change", updateLimit);
  byId("quiz-saved").addEventListener("change", updateLimit);
  byId("quiz-passage").addEventListener("change", updateLimit);

  function setPassage(terms) {
    passageTerms = terms;
    field("quiz-passage-count", `(${terms.size})`);
    if (byId("quiz-passage").checked) updateLimit();
  }

  function preparePassage() {
    if (!passageTerms.size || (round && !round.finished)) return false;
    byId("quiz-passage").checked = true;
    byId("quiz-saved").checked = false;
    byId("quiz-topic").value = "all";
    updateLimit();
    stage("quiz-setup");
    return true;
  }

  function entryLine(entry) {
    const line = element("span");
    line.append(element("span", entry.term, "yue-Hant"), " · ",
      element("span", entry.jyutping, "yue-Latn"), " · ", entry.meaning);
    return line;
  }

  function updateProgress() {
    byId("progress").max = round.questions.length;
    byId("progress").value = round.answers.length;
    field("live-score", round.score + " correct");
  }

  function markAnswer(question, answer) {
    if (round.current !== question || round.feedback) return;
    let result;
    try {
      result = round.answer(answer);
    } catch (err) {
      if (!(err instanceof RangeError) || question.mode !== "type") throw err;
      field("type-error", err.message);
      byId("type-error").hidden = false;
      byId("typed-reading").setAttribute("aria-invalid", "true");
      byId("typed-reading").focus();
      return;
    }
    if (question.mode === "type") {
      field("type-error", "");
      byId("type-error").hidden = true;
      byId("typed-reading").setAttribute("aria-invalid", "false");
      byId("typed-reading").disabled = true;
      byId("check-reading").disabled = true;
    } else {
      const buttons = Array.from(byId("choices").children);
      for (const button of buttons) button.disabled = true;
      buttons[question.correctIndex].classList.add("right");
      if (!result.correct) buttons[answer].classList.add("wrong");
    }
    const verdict = result.correct ? "Correct!" : `The answer is “${correctAnswer(question)}”.`;
    const corrections = (result.corrections || []).map(text => element("p", text));
    byId("feedback").replaceChildren(element("strong", verdict), entryLine(question.entry), ...corrections);
    if (question.mode === "cloze") {
      const { zh, jyutping } = question.entry.example;
      const reading = element("p", jyutping, "yue-Latn");
      reading.className = "transcription";
      byId("feedback").append(element("p", zh, "yue-Hant"), reading);
    }
    updateProgress();
    const next = byId("next-question");
    next.hidden = false;
    next.focus();
  }

  function showQuestion() {
    const question = round.current;
    const typing = question.mode === "type";
    const total = round.questions.length;
    field("position", `Question ${round.position + 1} of ${total}`);
    field("instruction", question.instruction);
    field("question", question.prompt);
    byId("question").lang = question.mode === "term" ? "en" : "yue-Hant";
    field("question-hint", question.hint);
    byId("question-hint").lang = question.mode === "cloze" ? "en" : "yue-Latn";
    byId("question-hint").hidden = !question.hint;
    const answerLang = { meaning: "en", term: "yue-Hant", reading: "yue-Latn", cloze: "yue-Hant" }[question.mode];
    const buttons = (question.choices || []).map((text, index) => {
      const button = element("button", text, answerLang);
      button.type = "button";
      button.className = "choice";
      button.addEventListener("click", () => markAnswer(question, index));
      return button;
    });
    byId("choices").replaceChildren(...buttons);
    byId("choices").hidden = typing;
    byId("type-form").hidden = !typing;
    byId("typed-reading").value = "";
    byId("typed-reading").disabled = false;
    byId("typed-reading").setAttribute("aria-invalid", "false");
    byId("check-reading").disabled = false;
    field("type-error", "");
    byId("type-error").hidden = true;
    byId("feedback").replaceChildren();
    field("next-question", round.position + 1 === total ? "See results" : "Next question");
    byId("next-question").hidden = true;
    updateProgress();
    byId(typing ? "typed-reading" : "question").focus();
  }

  byId("type-form").addEventListener("submit", event => {
    event.preventDefault();
    if (round?.current?.mode === "type") markAnswer(round.current, byId("typed-reading").value);
  });

  function showSummary() {
    stage("quiz-summary");
    const answered = round.answers.length;
    const total = round.questions.length;
    field("summary-title", answered === total ? "Round complete" : "Round ended");
    field("summary-score", answered ? `${round.score} of ${answered} correct` : "No questions answered");
    field("summary-count", `${answered} of ${total} questions answered.`);
    const missed = round.missed;
    const rows = missed.map(result => {
      const row = element("li");
      row.append(entryLine(result.question.entry), element("small", reviewAnswer(result)));
      return row;
    });
    byId("review-list").replaceChildren(...rows);
    byId("review-block").hidden = !missed.length;
    field("retry-missed", `Retry missed questions (${missed.length})`);
    byId("retry-missed").hidden = !missed.length;
    byId("summary-title").focus();
  }

  byId("quiz-setup").addEventListener("submit", event => {
    event.preventDefault();
    const error = byId("quiz-error");
    try {
      round = createRound({
        count: parseQuestionCount(byId("quiz-count").value),
        mode: byId("quiz-mode").value,
        ...filters(),
      });
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      return;
    }
    error.hidden = true;
    stage("quiz-play");
    showQuestion();
  });
  byId("retry-missed").addEventListener("click", () => {
    if (!round?.finished || !round.missed.length) return;
    round = round.retryMissed();
    stage("quiz-play");
    showQuestion();
  });
  byId("next-question").addEventListener("click", () => {
    if (!round?.feedback) return;
    round.advance();
    if (round.finished) showSummary();
    else showQuestion();
  });
  byId("end-round").addEventListener("click", () => {
    if (!round || round.finished) return;
    round.finish();
    showSummary();
  });
  byId("new-round").addEventListener("click", () => {
    stage("quiz-setup");
    byId("quiz-topic").focus();
  });
  return { updateLimit, setPassage, preparePassage };
}
