"use strict";

function bindTwistEditor(session, byId, changed, focusPuzzle) {
  const input = byId("algorithm-input"), feedback = byId("algorithm-feedback");
  const play = byId("algorithm-play"), invert = byId("algorithm-invert");
  const examples = [];
  let draft = [];

  function refresh() {
    play.disabled = !draft.length || !session.canStartSequence;
  }

  function updateEditor() {
    try {
      draft = TwistNotation.parse(input.value);
      feedback.textContent = draft.length ? draft.length + (draft.length === 1 ? " turn" : " turns") : "Enter a sequence.";
      feedback.classList.remove("invalid");
      input.setAttribute("aria-invalid", "false");
    } catch (error) {
      draft = [];
      feedback.textContent = error.message;
      feedback.classList.add("invalid");
      input.setAttribute("aria-invalid", "true");
    }
    const effect = draft.length ? TwistAnalysis.effect(draft) : null;
    byId("effect-corners").textContent = effect?.corners ?? "—";
    byId("effect-edges").textContent = effect?.edges ?? "—";
    byId("effect-repeats").textContent = effect ? effect.repetitions + "×" : "—";
    for (const [button, preset] of examples) button.setAttribute("aria-pressed", String(input.value === preset.text));
    invert.disabled = !draft.length;
    refresh();
  }

  for (const preset of TwistNotation.PRESETS) {
    const button = document.createElement("button");
    button.className = "preset";
    button.textContent = preset.name;
    button.title = preset.tip;
    button.addEventListener("click", () => { input.value = preset.text; updateEditor(); });
    byId("algorithm-presets").append(button);
    examples.push([button, preset]);
  }
  input.value = TwistNotation.PRESETS[0].text;
  input.addEventListener("input", updateEditor);
  invert.addEventListener("click", () => {
    input.value = TwistCube.inverseSequence(draft).map(TwistNotation.formatMove).join(" ");
    updateEditor();
  });
  play.addEventListener("click", () => {
    if (session.playAlgorithm(draft)) {
      changed();
      focusPuzzle();
    }
  });
  updateEditor();
  return refresh;
}
