"use strict";

const AtlasWorkbench = (() => {
  const { COLORS, MAX_SIZE, integer, simulate, quantity } = Automaton;
  const {
    compareSeedFlip, describeAgreement, parseObservations, ruleEvidence, matchingRules,
    mapBasins, defaultBasinWidth, MAX_BASIN_WIDTH,
  } = AtlasAnalysis;
  const byId = id => document.getElementById(id);

  function preparePlot(canvas, history, live = COLORS.live) {
    const width = history[0].length, height = history.length;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    const image = context.createImageData(width, height);
    const palette = [COLORS.dead, live].map(hex => [
      ...hex.slice(1).match(/../g).map(byte => Number.parseInt(byte, 16)), 255,
    ]);
    let offset = 0;
    for (const row of history) {
      for (const bit of row) {
        image.data.set(palette[bit], offset);
        offset += 4;
      }
    }
    return generation => {
      context.fillStyle = COLORS.dead;
      context.fillRect(0, 0, width, height);
      context.putImageData(image, 0, 0, 0, 0, width, generation + 1);
    };
  }

  // A failed edit leaves the most recently applied experiment available.
  function onSubmit(formId, errorId, pause, apply) {
    const error = byId(errorId);
    byId(formId).addEventListener("submit", event => {
      event.preventDefault();
      pause();
      try {
        apply();
        error.hidden = true;
        error.textContent = "";
      } catch (problem) {
        if (!(problem instanceof RangeError)) throw problem;
        error.textContent = problem.message;
        error.hidden = false;
      }
    });
  }

  function damagePanel({ getRun, getGeneration, pause, loadRun }) {
    const input = byId("damage-cell");
    const canvas = byId("damage-diagram");
    let source, cell, comparison, paint;

    function draw() {
      const run = getRun();
      if (source !== run) {
        const { width } = run.settings;
        if (source?.settings.width !== width) cell = Math.floor(width / 2);
        source = run;
        input.max = String(width - 1);
        input.value = String(cell);
        byId("damage-error").hidden = true;
        comparison = null;
      }
      if (!comparison) {
        comparison = compareSeedFlip(run, cell);
        paint = preparePlot(canvas, comparison.differences, "#a74425");
        byId("damage-agreement").textContent = describeAgreement(comparison.firstAgreement, run.history.length);
      }
      const generation = getGeneration();
      paint(generation);
      const count = comparison.distances[generation];
      const summary = `Flipped cell ${cell} · generation ${generation} · ${quantity(count, "different cell")}.`;
      byId("damage-count").textContent = summary;
      canvas.setAttribute("aria-label", `Differences from the original run. ${summary}`);
    }

    onSubmit("damage-form", "damage-error", pause, () => {
      cell = integer(input.value, 0, getRun().settings.width - 1, "Seed cell");
      comparison = null;
      draw();
    });
    byId("use-flip").addEventListener("click", () => {
      loadRun(simulate({ ...getRun().settings, seed: comparison.seed }), getGeneration());
    });
    return draw;
  }

  function inferencePanel({ getRun, getGeneration, pause, loadRun }) {
    const candidates = byId("candidate");
    let observations = null;
    let source, evidence, renderedMask;

    function draw() {
      const run = getRun();
      const rows = observations ?? run.history;
      if (source !== run) {
        evidence = ruleEvidence(rows, run.settings.boundary);
        source = run;
        renderedMask = null;
      }
      const last = observations ? rows.length - 1 : getGeneration();
      const prefix = observations ? quantity(rows.length, "entered row") : `Generations 0 through ${last}`;
      byId("evidence-source").textContent = `${prefix} · ${quantity(rows[0].length, "cell")} · ${run.settings.boundary}`;
      const { off, on } = evidence[last];
      const mask = (on << 8) | off;
      if (mask === renderedMask) return;
      renderedMask = mask;
      const { outputs, rules } = matchingRules(evidence[last]);
      byId("evidence-bits").textContent = outputs;
      byId("candidate-count").textContent = quantity(rules.length, "compatible rule");
      candidates.replaceChildren(...rules.map(rule => {
        const option = document.createElement("option");
        option.value = String(rule);
        option.textContent = `Rule ${rule}`;
        return option;
      }));
      candidates.value = rules.includes(run.settings.rule) ? String(run.settings.rule) : String(rules[0] ?? "");
      byId("candidate-controls").hidden = rules.length === 0;
      byId("try-rule").disabled = rules.length === 0;
    }

    onSubmit("inference-form", "inference-error", pause, () => {
      const text = byId("observations").value.trim();
      observations = text ? parseObservations(text) : null;
      source = null;
      draw();
    });
    byId("try-rule").addEventListener("click", () => {
      const settings = { ...getRun().settings, rule: candidates.value };
      let generation = getGeneration();
      if (observations) {
        settings.seed = observations[0].join("");
        settings.width = settings.seed.length;
        settings.rows = Math.max(settings.rows, observations.length);
        generation = observations.length - 1;
      }
      loadRun(simulate(settings), generation);
    });
    return draw;
  }

  function basinPanel({ getRun, pause, loadRun }) {
    const input = byId("basin-width"), rank = byId("basin-rank");
    let sourceWidth, width, mapped, basins;

    function showBasin() {
      const basin = basins[Number(rank.value) - 1];
      byId("basin-position").textContent = `${rank.value} / ${basins.length}`;
      rank.setAttribute("aria-valuetext", `Basin ${rank.value} of ${basins.length}, cycle seed ${basin.representative}`);
      byId("cycle-seed").textContent = basin.representative;
      byId("basin-period").textContent = String(basin.period);
      byId("basin-size").textContent = String(basin.size);
      byId("basin-depth").textContent = String(basin.maxSteps);
      byId("use-basin").textContent = `Run example seed ${basin.example}`;
    }

    function draw() {
      const settings = getRun().settings;
      if (sourceWidth !== settings.width) {
        sourceWidth = settings.width;
        width = defaultBasinWidth(sourceWidth);
        input.value = String(width);
        byId("basin-error").hidden = true;
      }
      const key = `${settings.rule}/${width}/${settings.boundary}`;
      if (mapped === key) return;
      basins = mapBasins(settings.rule, width, settings.boundary);
      mapped = key;
      byId("basin-count").textContent =
        `Rule ${settings.rule} · ${quantity(width, "cell")} · ${settings.boundary} · ${2 ** width} seeds in ${quantity(basins.length, "basin")}.`;
      rank.max = String(basins.length);
      rank.value = "1";
      rank.disabled = basins.length === 1;
      showBasin();
    }

    onSubmit("basin-form", "basin-error", pause, () => {
      width = integer(input.value, 1, MAX_BASIN_WIDTH, "Basin width");
      draw();
    });
    rank.addEventListener("input", () => { pause(); showBasin(); });
    byId("use-basin").addEventListener("click", () => {
      const basin = basins[Number(rank.value) - 1];
      const settings = getRun().settings;
      const rows = Math.min(MAX_SIZE, Math.max(settings.rows, basin.maxSteps + basin.period + 1));
      loadRun(simulate({ ...settings, width, rows, seed: basin.example }), 0);
    });
    return draw;
  }

  return { preparePlot, damagePanel, inferencePanel, basinPanel };
})();
