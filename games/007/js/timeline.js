"use strict";

function bindTwistTimeline(session, byId, changed) {
  const sequence = byId("sequence"), slider = byId("review-position");
  const back = byId("back-step"), step = byId("step"), replay = byId("replay");
  const tokens = [], empty = document.createElement("span");
  empty.className = "sequence-empty";
  empty.textContent = "Turn a face or scramble to start.";
  let shownMoves = null, selected = null;

  slider.addEventListener("input", () => { if (session.seek(slider.valueAsNumber)) changed(); });
  back.addEventListener("click", () => {
    const previous = session.active?.progress ? session.cursor : Math.max(0, session.cursor - 1);
    if (session.seek(previous)) changed();
  });
  step.addEventListener("click", () => { if (session.stepOnce()) changed(); });
  replay.addEventListener("click", () => {
    if (session.seek(0)) { session.togglePause(); changed(); }
  });
  byId("end-review").addEventListener("click", () => { if (session.endPlayback()) changed(); });

  function updateTokens(moves, planned) {
    if (moves !== shownMoves) {
      sequence.replaceChildren(empty);
      tokens.length = 0;
      selected = null;
      shownMoves = moves;
    }
    empty.hidden = moves.length > 0;
    while (tokens.length > moves.length) tokens.pop().remove();
    while (tokens.length < moves.length) {
      const move = moves[tokens.length], token = document.createElement("span");
      token.className = "move-token";
      token.textContent = TwistNotation.formatMove(move);
      token.title = (tokens.length + 1) + ". " + TwistNotation.moveName(move);
      token.style.setProperty("--face", TwistCube.FACE[move[0]].color);
      sequence.append(token);
      tokens.push(token);
    }
    if (selected) {
      selected.classList.remove("current", "finished");
      selected.removeAttribute("aria-current");
    }
    if (planned) tokens.forEach((token, i) => token.classList.toggle("future", i > session.cursor));
    selected = planned ? tokens[Math.min(session.cursor, moves.length - 1)] : tokens.at(-1);
    if (!selected) return;
    const finished = planned && session.cursor === moves.length;
    selected.classList.add(finished ? "finished" : "current");
    if (!finished) selected.setAttribute("aria-current", planned ? "step" : "true");
    const left = selected.offsetLeft, right = left + selected.offsetWidth;
    if (left < sequence.scrollLeft) sequence.scrollLeft = left;
    else if (right > sequence.scrollLeft + sequence.clientWidth) sequence.scrollLeft = right - sequence.clientWidth;
  }

  return function refreshTimeline() {
    const review = session.playback, planned = !!review || session.mode === "scrambling";
    const moves = planned ? session.plan : session.history;
    const titles = { solving: "Solution steps", algorithm: "Algorithm steps", scrambling: "Scramble sequence" };
    byId("timeline-title").textContent = titles[review || session.mode] || "Move history";
    byId("sequence-label").textContent = planned ? session.cursor + " / " + moves.length : session.source;
    sequence.setAttribute("aria-label", planned ? session.cursor + " of " + moves.length + " turns complete" : "Move history");
    step.hidden = !session.playing || !(session.paused || session.singleStep);
    step.disabled = !session.paused;
    back.hidden = !review || (session.playing && !session.paused);
    back.disabled = session.cursor === 0 && !session.active?.progress;
    replay.hidden = !review || session.playing;
    byId("review-bar").hidden = !review;
    if (review) {
      slider.max = moves.length;
      slider.value = session.cursor;
      slider.setAttribute("aria-valuetext", session.cursor + " of " + moves.length + " turns complete");
    }
    updateTokens(moves, planned);
  };
}
