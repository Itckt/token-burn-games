(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const notebook = common ? require("./notebook.js") : root.Isobar.notebook;
  const field = common ? require("./field.js") : root.Isobar.field;
  const ui = common ? require("./ui.js") : root.Isobar.ui;

  function mount({ win, get, all, listen, capture, inspect }) {
    let storage;
    // Some browsers deny even the localStorage getter for a local file.
    try { storage = win.localStorage; } catch { storage = null; }
    const book = notebook.open(storage), status = get("notebook-status");
    const captures = all("[data-capture]");

    function show() {
      const samples = {};
      for (const slot of notebook.SLOTS) {
        const record = book.entries[slot];
        get("record-" + slot).hidden = !record;
        let site = "—";
        if (record) {
          const pose = notebook.pose(record);
          samples[slot] = field.sample(pose, record);
          site = ui.stationLabel(samples[slot]) + "\nSignal " + pose.signal + " · T+ " + ui.clock(pose.time);
        }
        get("site-" + slot).textContent = site;
      }
      get("notebook-sheet").hidden = !samples.A && !samples.B;
      for (const [name, metric] of Object.entries(field.METRICS)) {
        for (const slot of notebook.SLOTS) {
          get(name + "-" + slot).textContent = samples[slot] ? samples[slot][name].toFixed(metric.digits) : "—";
        }
        get(name + "-diff").textContent = samples.A && samples.B ?
          notebook.difference(samples.A[name], samples.B[name], metric.digits) : "—";
      }
    }

    function save(slot, record) {
      const persisted = book.write(slot, record);
      show();
      const action = record ? " captured" : " cleared";
      status.textContent = slot + action + (persisted ? " in this browser." : " for this page. Browser storage is unavailable.");
    }
    for (const button of captures) listen(button, "click", () => save(button.dataset.capture, capture()));
    for (const button of all("[data-clear]")) listen(button, "click", () => {
      const slot = button.dataset.clear;
      captures.find(control => control.dataset.capture === slot).focus({ preventScroll: true });
      save(slot, null);
    });
    for (const button of all("[data-recall]")) listen(button, "click", () => {
      const slot = button.dataset.recall, record = book.entries[slot];
      if (!record) return;
      inspect(notebook.pose(record), { x: record.x, z: record.z });
      status.textContent = "Inspecting observation " + slot + ".";
      get("probe-toggle").focus();
    });
    show();
    if (book.entries.A || book.entries.B) status.textContent = "Saved observations loaded.";
  }
  if (common) module.exports = { mount };
  else (root.Isobar ||= {}).notebookPanel = { mount };
})(globalThis);
