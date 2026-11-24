(function (root) {
  "use strict";
  const byId = id => document.getElementById(id);
  const seconds = time => time === null ? "—" : time.toFixed(3) + " s";
  const stateLabels = {rolling: "Rolling", finished: "Finished", "off-track": "Off track", "timed-out": "Timed out"};
  const finishFor = color => FoundryRender.FINISHES[color] || FoundryRender.FINISHES[0];
  function write(el, value) {
    const text = String(value);
    if (el.textContent !== text) el.textContent = text;
  }
  const setText = (id, value) => write(byId(id), value);

  function timing(currentWorld, requestFrame) {
    const ghost = byId("ghost-toggle"), results = byId("trial-results");
    let ghostEnabled = true, lastResult = null;
    function updateResults(board) {
      const newest = board.recent[0] || null;
      if (newest === lastResult) return;
      lastResult = newest;
      results.textContent = "";
      if (!newest) {
        const empty = document.createElement("li");
        empty.className = "empty-result";
        empty.textContent = "No finishes yet.";
        results.append(empty);
      }
      for (const record of board.recent) {
        const row = document.createElement("li");
        const finish = finishFor(record.color);
        const name = document.createElement("span"), time = document.createElement("strong");
        name.textContent = "#" + record.number + "  " + finish.name;
        name.style.setProperty("--finish", "#" + finish.hex);
        time.textContent = seconds(record.time);
        row.title = "Halfway split " + seconds(record.split);
        row.append(name,time);
        results.append(row);
      }
    }
    function refresh(reviewing = false) {
      const world = currentWorld(), board = world.timing, ball = board.latest;
      const run = ball && ball.run;
      setText("trial-runner", ball ? "#" + ball.number + "  " + finishFor(ball.color).name : "Release gate");
      let state = run && stateLabels[run.state];
      if (run?.state === "rolling" && (world.paused || reviewing)) state = reviewing ? "Held for replay" : "Paused";
      setText("trial-state", state || "Ready");
      setText("trial-clock", (run ? run.time : 0).toFixed(2));
      setText("trial-split", seconds(run ? run.split : null));
      const gap = byId("trial-gap");
      gap.hidden = !board.opponent || !run || run.split === null;
      if (!gap.hidden) {
        const finished = run.state === "finished";
        const delta = finished ? run.time - board.opponent.time : run.split - board.opponent.split;
        const lead = Math.abs(delta) < 0.0005 ? "Level" : seconds(Math.abs(delta)) + (delta < 0 ? " ahead" : " behind");
        setText("trial-gap", lead + (finished ? " at the flag" : " at halfway"));
      }
      setText("trial-best", seconds(board.best ? board.best.time : null));
      setText("ghost-hint", board.best ? "The ghost follows the best time on record when you drop a marble." :
        "Finish a run to record a ghost for your next drop.");
      updateResults(board);
    }
    function toggleGhost() {
      ghostEnabled = !ghostEnabled;
      ghost.setAttribute("aria-pressed", String(ghostEnabled));
      requestFrame();
    }
    ghost.addEventListener("click", toggleGhost);
    return {refresh, toggleGhost, get ghostEnabled() { return ghostEnabled; }};
  }

  function benchTabs(refresh) {
    const tabs = [byId("build-tab"), byId("trials-tab")];
    function activate(tab) {
      for (const item of tabs) {
        const selected = item === tab;
        item.setAttribute("aria-selected", String(selected));
        item.setAttribute("tabindex", selected ? "0" : "-1");
        byId(item.getAttribute("aria-controls")).hidden = !selected;
      }
      refresh();
    }
    for (const [index, tab] of tabs.entries()) {
      tab.addEventListener("click", () => activate(tab));
      tab.addEventListener("keydown", event => {
        const key = event.key;
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return;
        event.preventDefault();
        const next = key === "Home" ? tabs[0] : key === "End" ? tabs[1] : tabs[1 - index];
        activate(next);
        next.focus();
      });
    }
    return {showBuild() { activate(tabs[0]); }, showTrials() {
      const fromBuild = document.activeElement === tabs[0] || byId("build-panel").contains(document.activeElement);
      activate(tabs[1]);
      if (fromBuild) tabs[1].focus();
    }};
  }

  function paceHeat(startHeat) {
    const button = byId("start-heat");
    button.addEventListener("click", startHeat);
    const positions = Array.from({length: 3}, () => {
      const row = document.createElement("li");
      const place = document.createElement("span"), entrant = document.createElement("span");
      const name = document.createElement("strong"), speed = document.createElement("small"), result = document.createElement("span");
      place.className = "heat-place";
      entrant.className = "heat-entrant";
      result.className = "heat-result";
      entrant.append(name, speed);
      row.append(place, entrant, result);
      byId("heat-standings").append(row);
      return {row, place, name, speed, result};
    });
    const labels = {...stateLabels, queued: "Queued", waiting: "Gate held", blocked: "Gate blocked"};
    function refresh(world, speed, color, online, reviewing = false) {
      const heat = world.heat;
      const rows = heat ? heat.standings() : FoundryHeat.lineup(speed, color, FoundryRender.FINISHES.length);
      for (const [i, entry] of rows.entries()) {
        const pos = positions[i], finish = finishFor(entry.color);
        write(pos.place, entry.place ? "#" + entry.place : "");
        write(pos.name, finish.name);
        write(pos.speed, entry.speed + " m/s");
        let result = labels[entry.state] || "Ready";
        if (entry.state === "finished") result = seconds(entry.millis / 1000);
        else if (entry.state === "rolling" && (world.paused || reviewing)) result = "Paused";
        else if (entry.state === "rolling" && entry.split !== null) result = "Split " + seconds(entry.split);
        write(pos.result, result);
        const ink = "#" + finish.hex;
        if (pos.row.style.getPropertyValue("--finish") !== ink) pos.row.style.setProperty("--finish", ink);
      }
      let state = "Lineup";
      if (heat) state = heat.active ? (world.paused || reviewing ? "Paused" : "Racing") : "Complete";
      setText("heat-state", state);
      setText("heat-action", heat?.active ? "Heat in progress" : heat ? "Start next heat" : "Start heat");
      const disabled = !online || reviewing || Boolean(heat?.active);
      if (button.disabled !== disabled) button.disabled = disabled;
    }
    return {refresh};
  }

  function blueprints(currentLayout, loadLayout) {
    const dialog = byId("blueprints"), name = byId("blueprint-name");
    const output = byId("blueprint-export"), input = byId("blueprint-input"), copy = byId("blueprint-copy");
    const status = message => setText("blueprint-status", message);
    function updateCode() {
      try {
        output.value = FoundryBlueprint.encode({...currentLayout(), name: name.value});
        copy.disabled = false;
        name.setAttribute("aria-invalid", "false");
        status("");
      } catch (error) {
        output.value = "";
        copy.disabled = true;
        name.setAttribute("aria-invalid", "true");
        status(error.message);
      }
    }
    function open() {
      name.value = currentLayout().name;
      input.value = "";
      input.setAttribute("aria-invalid", "false");
      updateCode();
      dialog.showModal();
      name.focus();
    }
    name.addEventListener("input", updateCode);
    copy.addEventListener("click", async () => {
      const code = output.value;
      output.focus();
      output.select();
      const clipboard = window.navigator && window.navigator.clipboard;
      if (clipboard && clipboard.writeText) {
        try {
          await clipboard.writeText(code);
          if (dialog.open && output.value === code) status("Track code copied.");
          return;
        } catch { /* The selected code is ready for a native copy gesture. */ }
      }
      if (dialog.open && output.value === code) status("Code selected. Use your device’s Copy command.");
    });
    input.addEventListener("input", () => { input.setAttribute("aria-invalid", "false"); status(""); });
    byId("blueprint-load").addEventListener("click", () => {
      let layout;
      try { layout = FoundryBlueprint.decode(input.value); }
      catch (error) {
        input.setAttribute("aria-invalid", "true");
        status(error.message);
        input.focus();
        return;
      }
      loadLayout(layout);
      dialog.close();
    });
    byId("blueprint-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener("close", () => byId("layouts-toggle").focus());
    return {open};
  }
  root.FoundryPanels = {byId, setText, stateLabels, finishFor, timing, benchTabs, paceHeat, blueprints};
})(globalThis);
