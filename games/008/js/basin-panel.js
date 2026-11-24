(function (A) {
  "use strict";
  const { terrain: T, hydrology: H, math: M } = A;
  const volumeFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

  function bind(byId, changedBed) {
    const options = [...document.querySelectorAll("[data-wear]")];
    const slider = byId("lake-level"), datum = byId("lake-datum");
    let weathering = "fresh", level = T.WATER, enabled = false;
    function displayLevel(value) {
      level = value;
      slider.value = String(level);
      const relative = level === 0 ? "at datum" : level > 0 ? "above datum" : "below datum";
      slider.setAttribute("aria-valuetext", Math.abs(level) + (Math.abs(level) === 1 ? " metre " : " metres ") + relative);
      const percent = 100 * (level - H.MIN_LEVEL) / (H.MAX_LEVEL - H.MIN_LEVEL);
      slider.style.setProperty("--stage", percent + "%");
      byId("level-readout").textContent = (level < 0 ? "−" : level > 0 ? "+" : "") + Math.abs(level) + " m";
      datum.disabled = !enabled || level === T.WATER;
    }
    slider.addEventListener("input", () => {
      if (!enabled) return;
      const value = Math.round(Number(slider.value));
      displayLevel(Number.isFinite(value) ? M.clamp(value, H.MIN_LEVEL, H.MAX_LEVEL) : level);
    });
    datum.addEventListener("click", () => { if (enabled) displayLevel(T.WATER); });
    for (const button of options) {
      button.addEventListener("click", () => {
        if (!enabled || weathering === button.dataset.wear) return;
        weathering = button.dataset.wear;
        for (const option of options) option.setAttribute("aria-pressed", String(button === option));
        changedBed();
      });
    }
    function showFlood({ area, volume }) {
      const percent = 100 * area / (2 * T.HALF) ** 2;
      byId("flood-area").textContent = (area / 10000).toFixed(2) + " ha";
      byId("flood-volume").textContent = volumeFormat.format(volume) + " m³";
      byId("flood-cover").value = percent;
      byId("flood-share").textContent = percent.toFixed(1) + "% of survey";
    }
    function setEnabled(value) {
      enabled = value;
      slider.disabled = !enabled;
      for (const button of options) button.disabled = !enabled;
      displayLevel(level);
    }
    return { setEnabled, showFlood, get weathering() { return weathering; }, get level() { return level; } };
  }
  A.basinPanel = { bind };
})(globalThis.FieldAtlas);
