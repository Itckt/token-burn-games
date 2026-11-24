"use strict";

function bindTwistTrials(session, byId, changed, focusPuzzle, storage) {
  const input = byId("trial-code"), start = byId("trial-start"), end = byId("trial-end");
  const status = byId("trial-status"), daily = byId("trial-daily");
  const clock = byId("trial-time"), stageClock = byId("trial-stage-time");
  const records = new TwistTrials.Records(storage);
  let draft, best, message, recorded = null, interval = null;

  function updateClock() {
    const elapsed = session.trial?.code === draft?.code ? session.trialElapsed() : 0;
    const value = TwistTrials.formatTime(elapsed);
    if (clock.textContent !== value) clock.textContent = stageClock.textContent = value;
  }
  function syncClock() {
    updateClock();
    const running = session.trialActive && session.trial.startedAt !== null && !document.hidden;
    if (running && interval === null) interval = window.setInterval(updateClock, 50);
    if (!running && interval !== null) {
      window.clearInterval(interval);
      interval = null;
    }
  }

  function refresh() {
    const trial = session.trial && session.trial.code === draft?.code ? session.trial : null;
    const active = session.trialActive, finished = trial && trial.finishedAt !== null;
    if (finished && trial !== recorded) {
      best = records.record(trial.code, session.trialElapsed(), trial.turns);
      recorded = trial;
    }
    input.disabled = daily.disabled = active;
    start.hidden = active;
    start.disabled = !draft || !session.canStartSequence;
    start.textContent = finished ? "Retry trial" : "Start trial";
    end.hidden = !active;
    byId("trial-stage").hidden = !trial;
    byId("view-label").hidden = !!trial;
    if (trial) byId("trial-stage-code").textContent = trial.code;
    byId("trial-turns").textContent = trial?.turns ?? 0;
    byId("trial-best").textContent = best ? TwistTrials.formatTime(best.ms) : "—";
    byId("trial-best-turns").textContent = best ? best.turns + (best.turns === 1 ? " turn" : " turns") : "";
    let note = message;
    if (finished) note = "Solved. Retry this code to race the same mix.";
    else if (active) note = trial.startedAt === null ? "Inspect the cube. Your first turn starts the clock." :
      "Clock running. End trial to keep the last completed turn and return to free play.";
    if (status.textContent !== note) status.textContent = note;
    syncClock();
  }

  function readCode() {
    if (session.trialActive) return;
    try {
      draft = TwistTrials.parseCode(input.value);
      message = draft.length + (draft.length === 1 ? " scramble turn." : " scramble turns.");
    } catch (error) {
      draft = null;
      message = error.message;
    }
    best = draft ? records.best(draft.code) : null;
    input.setAttribute("aria-invalid", String(!draft));
    refresh();
  }
  input.addEventListener("input", readCode);
  daily.addEventListener("click", () => {
    input.value = TwistTrials.dailyCode();
    readCode();
  });
  function begin() {
    if (!session.canStartSequence) return;
    readCode();
    if (!draft || !session.startTrial(draft.code)) return;
    input.value = draft.code;
    changed();
    focusPuzzle();
  }
  start.addEventListener("click", begin);
  input.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.isComposing && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      begin();
    }
  });
  end.addEventListener("click", () => {
    if (session.endTrial()) {
      message = "Trial ended. You can keep playing this position.";
      changed();
      start.focus();
    }
  });
  document.addEventListener("visibilitychange", syncClock);
  readCode();
  return refresh;
}
