(function (root) {
  "use strict";
  const {byId, setText, stateLabels, finishFor} = FoundryPanels;

  function speedChart(canvas, record, peak) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.width, height = canvas.height;
    const x = time => record.time ? width * time / record.time : 0;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#aac4b740";
    for (const fraction of [0.25, 0.5, 0.75]) ctx.fillRect(0, height*fraction, width, 1);
    ctx.beginPath();
    record.speeds.forEach((speed, i) => {
      const px = x(Math.min(i/FoundryReplay.SAMPLE_HZ, record.time));
      const py = height-3 - speed / Math.max(peak, 1) * (height-8);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#bbebcf";
    ctx.stroke();
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.fillStyle = "#88d0b02b";
    ctx.fill();
    if (record.split !== null) {
      ctx.fillStyle = "#f2c271";
      ctx.fillRect(x(record.split)-1, 0, 2, height);
    }
  }

  function mount(player, {toggle, play, seek}) {
    const open = byId("review-run"), scrub = byId("replay-scrub"), playButton = byId("replay-play");
    const marker = byId("replay-marker"), emptyHint = byId("replay-hint").textContent;
    let lastRecord;
    open.addEventListener("click", toggle);
    byId("replay-exit").addEventListener("click", toggle);
    playButton.addEventListener("click", play);
    scrub.addEventListener("input", () => {
      if (player.record) seek(Number(scrub.value) / Number(scrub.max) * player.record.time);
    });

    function refresh(record, online) {
      const disabled = !record || !online;
      if (open.disabled !== disabled) open.disabled = disabled;
      setText("review-action", player.record ? "Return to live" : "Replay last run");
      if (record === lastRecord) return;
      lastRecord = record;
      byId("replay-chart").hidden = !record;
      setText("replay-outcome", record ? stateLabels[record.state] : "");
      setText("replay-hint", record ? "#" + record.number + " " + finishFor(record.color).name : emptyHint);
      if (!record) return;
      const peak = Math.max(...record.speeds);
      setText("replay-peak", peak.toFixed(1) + " m/s peak");
      setText("replay-duration", record.time.toFixed(3) + " s");
      setText("replay-split-mark", record.split === null ? "" : "Halfway " + record.split.toFixed(2) + " s");
      speedChart(byId("replay-trace"), record, peak);
    }
    function transport(online) {
      const record = player.record;
      byId("live-transport").hidden = Boolean(record);
      byId("replay-transport").hidden = !record;
      marker.hidden = !record;
      if (!record) return;
      setText("replay-number", "Replay #" + record.number);
      const action = player.playing ? "Pause replay" : "Play replay";
      playButton.title = action + " (P)";
      playButton.setAttribute("aria-label", action);
      const icon = playButton.querySelector("[data-icon]"), glyph = player.playing ? "pause" : "play";
      if (icon.dataset.icon !== glyph) { icon.dataset.icon = glyph; FoundryIcons.draw(icon); }
      playButton.disabled = !online || record.time === 0;
      scrub.disabled = !online || record.time === 0;
    }
    function cursor() {
      const duration = player.record.time;
      const fraction = duration > 0 ? player.time / duration : 0;
      const time = player.time.toFixed(3), end = duration.toFixed(3);
      setText("replay-time", time + " / " + end + " s");
      scrub.value = String(Math.round(fraction * Number(scrub.max)));
      scrub.setAttribute("aria-valuetext", time + " of " + end + " seconds");
      const percent = (100*fraction).toFixed(2) + "%";
      scrub.style.setProperty("--fill", percent);
      marker.style.setProperty("left", percent);
    }
    return {refresh, transport, cursor};
  }
  root.FoundryReplayPanel = {mount};
})(globalThis);
