"use strict";

function bindTwistNet(session, byId, turnFace, invalidate) {
  const cube = TwistCube, faces = new Map();
  const select = byId("tracked-piece"), location = byId("piece-location");
  let turnSuffix = "", tracked = null;

  for (const [label, names] of [["Corners", cube.CORNERS], ["Edges", cube.EDGES]]) {
    const group = document.createElement("optgroup");
    group.label = label;
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name + " · " + Array.from(name, face => cube.FACE[face].name).join(" / ");
      group.append(option);
    }
    select.append(group);
  }

  for (const face of ["U", "L", "F", "R", "B", "D"]) {
    const button = document.createElement("button"), tiles = [];
    button.className = "net-face";
    button.style.gridArea = face;
    for (let i = 0; i < 9; i++) {
      const tile = document.createElement("span");
      tile.setAttribute("aria-hidden", "true");
      button.append(tile);
      tiles.push(tile);
    }
    button.addEventListener("click", event => turnFace(face, event.shiftKey));
    byId("cube-net").append(button);
    faces.set(face, { button, tiles });
  }

  function refresh(suffix) {
    turnSuffix = suffix;
    const net = cube.facelets(session.pieces);
    tracked = cube.inspectPiece(session.pieces, select.value);
    byId("cube-net").classList.toggle("tracking", !!tracked);
    byId("view-name").textContent = tracked ? select.value + " at " + tracked.slot : "Perspective";
    location.hidden = !tracked;
    const detail = tracked ? select.value + " at " + tracked.slot + " · " +
      tracked.stickers.map(s => s.home + " faces " + s.face).join(", ") : "";
    if (location.textContent !== detail) location.textContent = detail;
    let matched = 0;
    for (const [face, { button, tiles }] of faces) {
      const stickers = net[face], mark = tracked?.stickers.find(s => s.face === face);
      stickers.forEach((sticker, i) => {
        if (face === sticker) matched++;
        tiles[i].classList.toggle("tracked", i === mark?.index);
        if (tiles[i].textContent === sticker) return;
        tiles[i].textContent = sticker;
        tiles[i].style.setProperty("--face", cube.FACE[sticker].color);
      });
      const rows = [0, 3, 6].map(i => stickers.slice(i, i + 3).join(" ")).join(", ");
      button.title = TwistNotation.moveName(face + turnSuffix);
      const hint = mark ? " Tracked " + select.value + " at row " + (1 + Math.floor(mark.index / 3)) +
        ", column " + (1 + mark.index % 3) + "." : "";
      button.setAttribute("aria-label", button.title + ". Sticker rows " + rows + "." + hint);
      button.disabled = session.mode !== "idle" && session.mode !== "manual";
    }
    byId("net-score").textContent = matched + " / 54 matched";
  }
  function selectionChanged() { refresh(turnSuffix); invalidate(); }
  select.addEventListener("change", selectionChanged);
  function selectPiece(name) {
    select.value = name;
    selectionChanged();
  }
  function trackHit(hit) {
    const name = cube.pieceAtSurface(session.pieces, hit);
    if (name) selectPiece(select.value === name ? "" : name);
  }
  return { refresh, trackHit, selectPiece, get trackedPiece() { return tracked?.piece ?? null; } };
}
