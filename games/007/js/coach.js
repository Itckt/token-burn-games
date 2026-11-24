"use strict";

function bindTwistCoach(session, byId, changed, focusPuzzle, trackPiece) {
  const face = byId("cross-face"), show = byId("cross-show"), play = byId("cross-play");
  const progress = byId("cross-progress"), note = byId("cross-note");
  const cards = [];
  let hint = null;

  for (const letter of TwistCube.FACES) {
    const option = document.createElement("option");
    option.value = letter;
    option.textContent = letter + " · " + TwistCube.FACE[letter].name;
    face.append(option);
  }
  face.value = "U";
  for (let i = 0; i < 4; i++) {
    const item = document.createElement("li"), card = document.createElement("button");
    const name = document.createElement("b"), detail = document.createElement("span");
    card.append(name, detail);
    card.addEventListener("click", () => { trackPiece(name.textContent); focusPuzzle(); });
    item.append(card);
    byId("cross-edges").append(item);
    cards.push({ card, name, detail });
  }

  function refresh() {
    const report = TwistCross.inspect(session.pieces, face.value);
    if (hint && (!session.canStartSequence || hint.face !== face.value || hint.key !== report.key)) hint = null;
    report.edges.forEach((edge, i) => {
      const { card, name, detail } = cards[i];
      const other = Array.from(edge.name).find(f => f !== face.value);
      card.style.setProperty("--edge-color", TwistCube.FACE[other].color);
      card.classList.toggle("aligned", edge.aligned);
      name.textContent = edge.name;
      detail.textContent = edge.aligned ? "Aligned" : edge.slot === edge.name ? "Flipped" : "At " + edge.slot;
      card.title = "Track " + edge.name + " · " + detail.textContent;
      card.setAttribute("aria-label", card.title);
    });
    byId("cross-edges").style.setProperty("--cross-color", TwistCube.FACE[face.value].color);
    progress.textContent = report.aligned + " / 4 aligned";
    show.hidden = !!hint;
    show.disabled = !session.canStartSequence || report.aligned === 4;
    play.hidden = !hint;
    play.disabled = !hint;
    let message = "Match each edge to both of its centers. Select an edge to track it.";
    if (session.trialActive) message = "Hints return when the time trial ends.";
    else if (report.aligned === 4) message = "Cross complete. All four side stickers match their centers.";
    else if (hint) {
      play.textContent = "Play " + TwistNotation.formatMove(hint.move);
      message = TwistNotation.moveName(hint.move) + ". " + hint.distance +
        (hint.distance === 1 ? " turn" : " turns") + " to the cross by a shortest route.";
    }
    if (note.textContent !== message) note.textContent = message;
  }
  face.addEventListener("change", refresh);
  show.addEventListener("click", () => {
    if (!session.canStartSequence) return;
    const moves = TwistCross.route(session.pieces, face.value);
    if (!moves.length) return;
    hint = { face: face.value, key: TwistCross.inspect(session.pieces, face.value).key,
      move: moves[0], distance: moves.length };
    refresh();
    play.focus({ preventScroll: true });
  });
  play.addEventListener("click", () => {
    if (hint && session.canStartSequence && session.manual(hint.move)) {
      changed();
      focusPuzzle();
    }
  });
  return refresh;
}
