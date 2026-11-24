"use strict";

(() => {
  const {
    simulate, ruleTable, flipBit, transformRule, transformRun, TRANSFORMS, asSvg, quantity, DEFAULTS,
  } = Automaton;
  const { analyzeHistory, describeCycle, describeChange, findPredecessors } = AtlasAnalysis;
  const byId = id => document.getElementById(id);
  const canvas = byId("diagram");
  const presets = [...document.querySelectorAll("[data-rule]")];
  const hints = {
    single: "One live cell in the middle of the first row.",
    alternating: "Every other cell starts on, beginning at the left edge.",
    random: "The same key always gives the same starting row.",
    campus: "Three campus relay teams start at the quarter, half and three-quarter marks.",
    custom: "Use 1 for on and 0 for off. Short patterns are centred in the row.",
  };
  let diagram;
  let analysis;
  let paint;
  let generation = 0;
  let timer = null;

  function seedFields() {
    const kind = byId("seed").value;
    byId("custom-tools").hidden = kind !== "custom";
    byId("random-tools").hidden = kind !== "random";
    byId("seed-help").textContent = hints[kind];
  }

  function readSettings() {
    const kind = byId("seed").value;
    const seed = kind === "custom" ? byId("pattern").value.trim() : kind;
    if (kind === "custom" && !/^[01]+$/.test(seed)) {
      throw new Error("Enter a binary pattern using only 0 and 1.");
    }
    return {
      rule: byId("rule").value, width: byId("width").value, rows: byId("rows").value,
      boundary: byId("boundary").value, seed,
      key: kind === "random" ? byId("key").value : (diagram?.settings.key ?? DEFAULTS.key),
    };
  }

  function changeRule(rule) {
    byId("rule").value = String(rule);
    applySettings();
  }

  function ruleInStepper() {
    const typed = byId("rule").valueAsNumber;
    return Number.isInteger(typed) ? typed : (diagram?.settings.rule ?? DEFAULTS.rule);
  }

  function moveRule(delta) {
    changeRule(Math.max(0, Math.min(255, ruleInStepper() + delta)));
  }

  function ruleButtons() {
    const typed = ruleInStepper();
    byId("rule-down").disabled = typed <= 0;
    byId("rule-up").disabled = typed >= 255;
  }

  const bits = ruleTable(0).map(({ pattern }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bit";
    const triplet = document.createElement("span");
    triplet.className = "triplet";
    triplet.setAttribute("aria-hidden", "true");
    for (const bit of pattern) {
      const square = document.createElement("i");
      if (bit === "1") square.className = "live";
      triplet.append(square);
    }
    const label = document.createElement("span");
    label.className = "word";
    label.textContent = pattern;
    const output = document.createElement("span");
    output.className = "bit-output";
    button.append(triplet, label, output);
    button.addEventListener("click", () => changeRule(flipBit(diagram.settings.rule, pattern)));
    byId("bits").append(button);
    return { button, output };
  });

  function pause() {
    if (timer !== null) clearInterval(timer);
    timer = null;
    byId("play-label").textContent = "Play";
    byId("play-icon").className = "icon-play";
  }

  function showPredecessors() {
    const { rule, boundary } = diagram.settings;
    const target = diagram.history[generation].join("");
    const { count, samples } = findPredecessors(target, rule, boundary);
    byId("parent-count").textContent = count > BigInt(samples.length)
      ? `First ${samples.length} of ${quantity(count, "predecessor")}.`
      : `${quantity(count, "predecessor")}.`;
    byId("parent-help").hidden = samples.length === 0;
    const items = samples.map(seed => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = seed;
      button.setAttribute("aria-label", `Use ${seed} as the starting row`);
      button.addEventListener("click", () => {
        const rows = Math.max(2, diagram.settings.rows);
        loadExperiment(simulate({ ...diagram.settings, seed, rows }), 1);
        byId("scrub").focus();
      });
      item.append(button);
      return item;
    });
    byId("parent-seeds").replaceChildren(...items);
  }

  function draw() {
    const { rule, width, rows } = diagram.settings;
    paint(generation);
    const { live: count, changed } = analysis.activity[generation];
    const cells = quantity(width, "cell");
    byId("population").textContent = `${count} of ${cells} on in generation ${generation}.`;
    byId("activity").textContent = describeChange(changed, generation);
    byId("parent-generation").textContent = String(generation);
    byId("scrub").value = String(generation);
    byId("scrub").setAttribute("aria-valuetext", `Generation ${generation} of ${rows - 1}`);
    byId("position").textContent = `${generation} / ${rows - 1}`;
    byId("rewind").disabled = generation === 0;
    byId("step").disabled = generation === rows - 1;
    canvas.setAttribute("aria-label", `Rule ${rule}, ${cells} wide, generations 0 through ${generation}. ${quantity(count, "cell")} on in the last visible row.`);
    for (const [panel, update] of inspections) {
      if (panel.open) update();
    }
  }

  function displayRun(result, selected = result.settings.rows - 1) {
    pause();
    diagram = result;
    analysis = analyzeHistory(result.history);
    byId("error").hidden = true;
    byId("error").textContent = "";
    const { rule, width, rows } = diagram.settings;
    paint = AtlasWorkbench.preparePlot(canvas, diagram.history);
    generation = selected;
    byId("rule").value = String(rule);
    byId("rule-title").textContent = `Rule ${rule}`;
    byId("binary").textContent = rule.toString(2).padStart(8, "0") + "₂";
    byId("dimensions").textContent = `${quantity(width, "cell")} × ${quantity(rows, "row")}`;
    ruleButtons();
    byId("scrub").max = String(rows - 1);
    byId("scrub").disabled = rows === 1;
    byId("play").disabled = rows === 1;
    byId("cycle-summary").textContent = describeCycle(analysis.cycle, rows);
    byId("go-repeat").hidden = analysis.cycle === null;
    for (const mode of TRANSFORMS) byId(mode + "-rule").textContent = `Rule ${transformRule(rule, mode)}`;
    for (const preset of presets) preset.setAttribute("aria-pressed", String(Number(preset.dataset.rule) === rule));
    ruleTable(rule).forEach(({ pattern, output }, i) => {
      bits[i].output.textContent = String(output);
      bits[i].button.setAttribute("aria-pressed", String(output === 1));
      bits[i].button.setAttribute("aria-label", `Output for ${pattern} is ${output}. Toggle bit.`);
    });
    draw();
  }

  function applySettings() {
    seedFields();
    let result;
    try {
      result = simulate(readSettings());
    } catch (error) {
      pause();
      ruleButtons();
      byId("error").hidden = false;
      byId("error").textContent = error.message;
      return;
    }
    displayRun(result);
  }

  function loadExperiment(result, selected) {
    const { width, rows, boundary, seed, key } = result.settings;
    byId("width").value = String(width);
    byId("rows").value = String(rows);
    byId("boundary").value = boundary;
    byId("key").value = String(key);
    const custom = /^[01]+$/.test(seed);
    byId("seed").value = custom ? "custom" : seed;
    if (custom) byId("pattern").value = seed;
    seedFields();
    displayRun(result, selected);
  }

  function seek(value) {
    pause();
    generation = value;
    draw();
  }

  function play() {
    const last = diagram.history.length - 1;
    if (last === 0) return;
    if (generation === last) generation = 0;
    byId("play-label").textContent = "Pause";
    byId("play-icon").className = "icon-pause";
    timer = setInterval(() => {
      generation++;
      if (generation === last) pause();
      draw();
    }, 1000 / Number(byId("speed").value));
    draw();
  }

  byId("settings").addEventListener("submit", event => { event.preventDefault(); applySettings(); });
  byId("seed").addEventListener("change", seedFields);
  byId("rule").addEventListener("input", ruleButtons);
  byId("rule-down").addEventListener("click", () => moveRule(-1));
  byId("rule-up").addEventListener("click", () => moveRule(1));
  for (const preset of presets) preset.addEventListener("click", () => changeRule(preset.dataset.rule));
  for (const mode of TRANSFORMS) {
    byId(mode).addEventListener("click", () => loadExperiment(transformRun(diagram, mode), generation));
  }
  byId("go-repeat").addEventListener("click", () => seek(analysis.cycle.repeat));
  const host = { getRun: () => diagram, getGeneration: () => generation, pause, loadRun: loadExperiment };
  const inspections = [
    [byId("parents"), showPredecessors],
    [byId("damage"), AtlasWorkbench.damagePanel(host)],
    [byId("inference"), AtlasWorkbench.inferencePanel(host)],
    [byId("basins"), AtlasWorkbench.basinPanel(host)],
  ];
  for (const [panel, update] of inspections) {
    panel.addEventListener("toggle", () => {
      if (panel.open) { pause(); update(); }
    });
  }
  byId("rewind").addEventListener("click", () => seek(0));
  byId("step").addEventListener("click", () => seek(Math.min(generation + 1, diagram.history.length - 1)));
  byId("scrub").addEventListener("input", () => seek(Number(byId("scrub").value)));
  byId("play").addEventListener("click", () => { if (timer === null) play(); else pause(); });
  byId("speed").addEventListener("change", () => { if (timer !== null) { pause(); play(); } });
  byId("save").addEventListener("click", () => {
    const svg = asSvg(diagram.history.slice(0, generation + 1));
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `rule-${diagram.settings.rule}-g${generation}.svg`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  applySettings();
})();
