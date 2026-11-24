(function (root) {
  "use strict";
  const T = FoundryTrack;
  const {byId, setText} = FoundryPanels;
  const names = new Map(T.LIBRARY.map(piece => [piece.id, piece.name]));
  names.set("rise", "Uphill ramp");

  function drawProfile(canvas, course, selected) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const width = canvas.width, height = canvas.height;
    const x = distance => width * distance / course.length;
    const y = altitude => height - 3 - (height - 12) * altitude / course.peak;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#a5c1ab35";
    for (const fraction of [0, 0.5, 1]) ctx.fillRect(0, y(fraction * course.peak), width, 1);
    for (const [i, section] of course.sections.entries()) {
      const selectedPiece = i === selected + 1 && selected >= 0;
      const start = section.startDistance, left = x(start), right = x(start + section.length);
      ctx.fillStyle = selectedPiece ? "#f4c87332" : "#a5c1ab38";
      ctx.fillRect(left, 0, selectedPiece ? right - left : 1, height);
      const rgb = FoundryMesh.paints[section.type][1].map(channel => Math.round(channel * 255)).join(",");
      for (const deck of section.decks) {
        const from = x(start + deck[0].s), to = x(start + deck.at(-1).s);
        ctx.beginPath();
        ctx.moveTo(from, y(deck[0].p[1]));
        for (const sample of deck) ctx.lineTo(x(start + sample.s), y(sample.p[1]));
        ctx.lineWidth = selectedPiece ? 5 : 3;
        ctx.strokeStyle = selectedPiece ? "#fff2b8" : "rgb(" + rgb + ")";
        ctx.stroke();
        ctx.lineTo(to, height);
        ctx.lineTo(from, height);
        ctx.fillStyle = "rgba(" + rgb + ",0.19)";
        ctx.fill();
      }
    }
  }

  function mount({editor, rebuild, requestFrame, toast}) {
    const profile = byId("course-profile"), position = byId("piece-position");
    const height = byId("release-height"), applyHeight = byId("apply-height");
    let course, selected = -1, online = false, highlighted, highlightTimer;

    const cards = T.LIBRARY.map((piece, i) => {
      const card = document.createElement("button"), thumb = document.createElement("canvas");
      card.className = "piece-card";
      card.dataset.piece = piece.id;
      card.title = piece.description + " (" + (i + 1) + ")";
      card.setAttribute("aria-label", "Add " + piece.name.toLowerCase());
      thumb.className = "thumb";
      thumb.setAttribute("aria-hidden", "true");
      const caption = document.createElement("span"), plus = document.createElement("i");
      caption.className = "card-caption";
      caption.textContent = piece.name;
      plus.dataset.icon = "plus";
      caption.append(plus);
      const key = document.createElement("span");
      key.className = "card-key";
      key.textContent = String(i + 1);
      key.setAttribute("aria-hidden", "true");
      card.append(thumb, key, caption);
      card.addEventListener("click", event => insert(i, event.shiftKey));
      byId("piece-grid").append(card);
      return card;
    });

    function refreshHeight() {
      const value = Number(height.value), valid = T.validHeight(value);
      height.disabled = !online;
      applyHeight.disabled = !online || !valid || value === editor.layout.height;
      height.setAttribute("aria-invalid", String(!valid));
      setText("height-error", valid ? "" : "Enter a height from " + T.MIN_HEIGHT + " to " + T.MAX_HEIGHT + " m.");
    }
    function commitHeight() {
      const value = Number(height.value);
      if (online && editor.setHeight(value)) rebuild("Gate height set to " + value + " m", selected);
    }
    height.addEventListener("input", refreshHeight);
    height.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); commitHeight(); }
    });
    applyHeight.addEventListener("click", commitHeight);

    function refresh(available) {
      online = available;
      refreshHeight();
      const count = editor.layout.pieces.length;
      for (const card of cards) card.disabled = !online || count >= T.LIMIT;
      position.disabled = !online || count === 0;
      byId("remove").disabled = !online || count === 0;
      byId("piece-actions").hidden = selected < 0;
      byId("move-earlier").disabled = !online || selected <= 0;
      byId("move-later").disabled = !online || selected < 0 || selected >= count - 1;
      setText("remove-label", selected < 0 ? "Remove last piece" : "Remove selected piece");
      setText("build-hint", selected < 0 ? "Choose a card to extend the track." :
        "Cards insert before piece " + (selected + 1) + ".");
      if (selected >= 0) setText("section-length", course.sections[selected + 1].length.toFixed(1) + " m long");
    }
    function select(index) {
      const count = editor.layout.pieces.length;
      selected = Number.isInteger(index) && index >= 0 && index < count ? index : -1;
      position.value = String(selected);
      refresh(online);
      drawProfile(profile, course, selected);
      requestFrame();
    }
    function setCourse(next, index = -1) {
      course = next;
      height.value = String(editor.layout.height);
      setText("profile-peak", "Peak " + course.peak.toFixed(1) + " m");
      setText("profile-length", course.length.toFixed(1) + " m");
      position.textContent = "";
      function option(value, label) {
        const el = document.createElement("option");
        el.value = String(value);
        el.textContent = label;
        position.append(el);
      }
      option(-1, "Finish · append here");
      editor.layout.pieces.forEach((type, i) => option(i, (i + 1) + " · " + names.get(type)));
      select(index);
    }
    position.addEventListener("change", () => { if (online) select(Number(position.value)); });
    function selectSection(index) {
      if (online) select(index < 0 ? -1 : Math.max(0, index - 1));
    }
    profile.addEventListener("click", event => {
      if (!online) return;
      const rect = profile.getBoundingClientRect();
      if (!rect.width || !Number.isFinite(event.clientX)) return;
      const distance = (event.clientX - rect.left) / rect.width * course.length;
      // The release bay selects the first build position, the finish selects append.
      selectSection(T.sectionIndexAt(course.sections, distance));
    });

    function insert(i, uphill) {
      if (!online) return;
      const piece = T.LIBRARY[i];
      const type = uphill && piece.id === "ramp" ? "rise" : piece.id;
      const index = selected < 0 ? editor.layout.pieces.length : selected;
      if (!editor.insert(index, type)) return toast("Track is full · " + T.LIMIT + " pieces");
      rebuild(names.get(type) + (selected < 0 ? " added" : " inserted"), selected < 0 ? -1 : selected + 1);
      if (highlighted) highlighted.classList.remove("added");
      clearTimeout(highlightTimer);
      highlighted = cards[i];
      highlighted.classList.add("added");
      highlightTimer = setTimeout(() => highlighted.classList.remove("added"), 550);
    }
    function move(delta) {
      const to = selected + delta;
      if (!online || selected < 0 || to < 0 || to >= editor.layout.pieces.length) return;
      if (editor.move(selected, to)) rebuild("Piece moved " + (delta < 0 ? "earlier" : "later"), to);
      else select(to); // Identical neighbours exchange selection without resetting a run.
    }
    function remove() {
      if (!online) return;
      const index = selected < 0 ? editor.layout.pieces.length - 1 : selected;
      if (editor.remove(index)) rebuild(selected < 0 ? "Last piece removed" : "Selected piece removed", selected);
    }
    byId("move-earlier").addEventListener("click", () => move(-1));
    byId("move-later").addEventListener("click", () => move(1));
    byId("remove").addEventListener("click", remove);
    return {cards, setCourse, refresh, insert, remove, selectSection,
      get selectedSection() { return selected < 0 ? -1 : selected + 1; }};
  }
  root.FoundryBuildPanel = {mount};
})(globalThis);
