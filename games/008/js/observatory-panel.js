(function (A) {
  "use strict";
  const { observatory: O, sim: S, math: M } = A;
  const clock = minute => S.formatHour(minute / 60);

  function bind(byId, { scene, holdMinute, visit, clearInput }) {
    const dialog = byId("observatory"), open = byId("study-open");
    const bearing = byId("skyline-bearing"), minuteInput = byId("sun-minute");
    const first = byId("first-sun"), last = byId("last-sun");
    const faceSun = byId("face-sun");
    const marker = byId("skyline-sun"), plot = byId("skyline-plot");
    const sites = ["camera", "route", "summit"];
    let site, grid, level, eye, skyline, daylight, ordinate, shownMinute, measuredRoute, measuredDistance;

    function readBearing() {
      const degrees = Number(bearing.value), ridge = skyline[degrees % 360];
      const label = String(degrees).padStart(3, "0") + "° " + S.heading(degrees * O.DEGREE).cardinal;
      const details = (ridge.angle / O.DEGREE).toFixed(1) + "° elevation angle · " +
        Math.round(ridge.distance) + " m away · " + Math.round(ridge.height) + " m elevation";
      byId("skyline-cursor").setAttribute("x1", degrees);
      byId("skyline-cursor").setAttribute("x2", degrees);
      byId("bearing-label").textContent = label;
      byId("ridge-reading").textContent = details;
      bearing.setAttribute("aria-valuetext", label + ", " + details);
    }
    function showMinute(minute) {
      if (minute === shownMinute) return;
      shownMinute = minute;
      const sun = S.sunDirection(minute / 60), above = sun[1] > 1e-9;
      const lit = daylight.windows.some(w => minute >= w.start && minute < w.end);
      const reading = clock(minute) + " · " + (!above ? "Night" : lit ? "Direct sun" : "Behind terrain");
      minuteInput.value = String(minute);
      minuteInput.setAttribute("aria-valuetext", reading);
      byId("sun-reading").textContent = reading;
      byId("sun-cursor").setAttribute("x1", minute + 0.5);
      byId("sun-cursor").setAttribute("x2", minute + 0.5);
      marker.hidden = !above;
      faceSun.disabled = !above;
      plot.dataset.night = String(!above);
      if (above) {
        const degrees = M.wrap(Math.atan2(sun[0], -sun[2]) / O.DEGREE, 360);
        marker.style.setProperty("--sun-x", degrees / 360 * 100 + "%");
        marker.style.setProperty("--sun-y", ordinate(Math.asin(sun[1]) / O.DEGREE) / 112 * 100 + "%");
        marker.dataset.shaded = String(!lit);
      }
    }
    function drawStudy() {
      skyline = O.skyline(grid, eye);
      daylight = O.sunWindows(grid, eye);
      const angles = skyline.map(ridge => ridge.angle / O.DEGREE);
      const low = Math.floor((Math.min(-3, ...angles) - 2) / 5) * 5;
      const high = Math.ceil((Math.max(33, ...angles) + 2) / 5) * 5;
      ordinate = degrees => 112 * (high - degrees) / (high - low);
      const line = [...angles, angles[0]].map((angle, i) => (i ? "L" : "M") + i + " " + ordinate(angle).toFixed(2)).join(" ");
      byId("skyline-line").setAttribute("d", line);
      byId("skyline-land").setAttribute("d", line + " L360 112 H0 Z");
      byId("skyline-zero").setAttribute("y1", ordinate(0));
      byId("skyline-zero").setAttribute("y2", ordinate(0));
      const { minutes, windows } = daylight;
      byId("sun-windows").setAttribute("d", windows.map(w => "M" + w.start + " 0 H" + w.end + " V16 H" + w.start + " Z").join(" "));
      const count = windows.length;
      byId("sun-duration").textContent = Math.floor(minutes / 60) + "h " + minutes % 60 + "m · " + count + (count === 1 ? " window" : " windows");
      first.disabled = last.disabled = !count;
      first.textContent = count ? "First sun " + clock(windows[0].start) : "First sun";
      last.textContent = count ? "Last sun " + clock(windows.at(-1).end - 1) : "Last sun";
      shownMinute = -1;
    }
    function measure(source, state) {
      site = source;
      let next, yaw;
      if (site === "summit") {
        next = O.summit(state.grid);
        yaw = Math.atan2(-next[0], next[2]);
      } else {
        const pose = site === "route" ? A.survey.flightPose(state.route, state.distance) : state.camera;
        next = pose.position.slice();
        yaw = pose.yaw;
      }
      const floor = Math.max(state.grid.surfaceAt(next[0], next[2]), state.level ?? -Infinity);
      next[1] = site === "camera" ? Math.max(floor + 2, next[1]) : floor + 3;
      if (grid !== state.grid || next.some((v, i) => v !== eye[i])) {
        grid = state.grid;
        eye = next;
        drawStudy();
      }
      level = state.level;
      measuredRoute = state.route;
      measuredDistance = state.distance;
      bearing.value = String(S.heading(yaw).degrees);
      for (const name of sites) byId("site-" + name).setAttribute("aria-pressed", String(name === site));
      byId("study-place").textContent = state.world.style.name + " · " + state.world.seed;
      const [x, y, z] = eye;
      byId("site-coordinates").textContent = "X " + Math.round(x) + " · Z " + Math.round(z) + " · Eye " + y.toFixed(1) + " m";
      readBearing();
      showMinute(S.minuteOfDay(state.hour));
    }
    function chooseTime(minute) {
      holdMinute(minute);
      showMinute(minute);
    }
    open.addEventListener("click", () => {
      if (open.disabled || dialog.open) return;
      clearInput();
      dialog.showModal();
      measure("camera", scene());
      byId("study-close").focus();
    });
    byId("study-close").addEventListener("click", () => dialog.close());
    for (const source of sites) {
      byId("site-" + source).addEventListener("click", () => {
        if (dialog.open && source !== site) measure(source, scene());
      });
    }
    bearing.addEventListener("input", () => { if (dialog.open) readBearing(); });
    minuteInput.addEventListener("input", () => { if (dialog.open) chooseTime(Number(minuteInput.value)); });
    first.addEventListener("click", () => { if (dialog.open && !first.disabled) chooseTime(daylight.windows[0].start); });
    last.addEventListener("click", () => { if (dialog.open && !last.disabled) chooseTime(daylight.windows.at(-1).end - 1); });
    function face(yaw, pitch) {
      dialog.close();
      visit({ position: eye, yaw, pitch: M.clamp(pitch, -1.48, 1.48) });
    }
    byId("visit-bearing").addEventListener("click", () => {
      if (!dialog.open) return;
      const degrees = Number(bearing.value);
      face(degrees * O.DEGREE, skyline[degrees % 360].angle);
    });
    faceSun.addEventListener("click", () => {
      if (!dialog.open || faceSun.disabled) return;
      holdMinute(shownMinute);
      const sun = S.sunDirection(shownMinute / 60);
      face(Math.atan2(sun[0], -sun[2]), Math.asin(sun[1]));
    });
    function refresh() {
      if (!dialog.open) return;
      const state = scene();
      const movedStation = site === "route" && (measuredRoute !== state.route || measuredDistance !== state.distance);
      if (grid !== state.grid || level !== state.level || movedStation) measure(site, state);
      else showMinute(S.minuteOfDay(state.hour));
    }
    return { refresh, get open() { return dialog.open; }, close() { dialog.close(); },
      setEnabled(value) {
        open.disabled = !value;
        if (!value && dialog.open) dialog.close();
      } };
  }
  A.observatoryPanel = { bind };
})(globalThis.FieldAtlas);
