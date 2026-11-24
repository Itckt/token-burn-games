"use strict";

function bindTwistCheckpoints(session, byId, storage, restorePosition) {
  const shelf = new TwistCheckpoints.Shelf(storage);
  const name = byId("checkpoint-name"), save = byId("checkpoint-save");
  const restore = byId("checkpoint-restore"), clear = byId("checkpoint-clear"), status = byId("checkpoint-status");
  const slots = [];
  let selected = 0;

  function renderSlot(index) {
    const { button, preview, caption } = slots[index];
    const record = shelf.get(index);
    const net = record ? TwistCube.facelets(TwistCube.apply(TwistCube.create(), record.moves)) : null;
    preview.replaceChildren();
    for (const face of TwistCube.FACES) {
      const group = document.createElement("span");
      group.style.gridArea = face;
      for (let cell = 0; cell < 9; cell++) {
        const tile = document.createElement("i");
        if (net) tile.style.backgroundColor = TwistCube.FACE[net[face][cell]].color;
        group.append(tile);
      }
      preview.append(group);
    }
    const count = record && record.moves.length + (record.moves.length === 1 ? " turn" : " turns");
    caption.textContent = record ? record.name || count : "Empty";
    const label = "Slot " + (index + 1) + ", " + caption.textContent + (record?.name ? ", " + count : "");
    button.title = label;
    button.setAttribute("aria-label", label);
  }

  function refresh() {
    const saved = !!shelf.get(selected), locked = session.trialActive;
    name.disabled = save.disabled = locked;
    restore.disabled = clear.disabled = locked || !saved;
    save.textContent = saved ? "Replace slot" : "Save position";
    byId("checkpoint-help").textContent = locked ? "End the time trial to save or restore a position." :
      "Save the last completed turn. Restore a slot to resume free play from there.";
  }
  function select(index) {
    selected = index;
    slots.forEach(({ button }, i) => button.setAttribute("aria-pressed", String(index === i)));
    name.value = shelf.get(index)?.name || "";
    status.textContent = "";
    refresh();
  }
  for (let i = 0; i < TwistCheckpoints.SLOT_COUNT; i++) {
    const button = document.createElement("button"), label = document.createElement("span");
    const preview = document.createElement("span"), caption = document.createElement("strong");
    button.className = "checkpoint-slot";
    label.textContent = "Slot " + (i + 1);
    preview.className = "mini-net";
    preview.setAttribute("aria-hidden", "true");
    button.append(label, preview, caption);
    button.addEventListener("click", () => select(i));
    byId("checkpoint-slots").append(button);
    slots.push({ button, preview, caption });
    renderSlot(i);
  }
  select(0);

  save.addEventListener("click", () => {
    if (session.trialActive) return;
    const persisted = shelf.save(selected, name.value, session.history);
    renderSlot(selected);
    select(selected);
    status.textContent = "Slot " + (selected + 1) + (persisted ? " saved on this device." : " saved for this session only.");
  });
  restore.addEventListener("click", () => {
    const record = shelf.get(selected);
    if (record && !session.trialActive) {
      restorePosition(record.moves, record.name || "Slot " + (selected + 1));
      status.textContent = "Restored slot " + (selected + 1) + ".";
    }
  });
  clear.addEventListener("click", () => {
    if (session.trialActive || !shelf.get(selected)) return;
    const persisted = shelf.clear(selected);
    renderSlot(selected);
    select(selected);
    status.textContent = "Slot " + (selected + 1) + (persisted ? " cleared." : " cleared for this session only.");
  });
  window.addEventListener("storage", event => {
    const editing = name.value !== (shelf.get(selected)?.name || "");
    const updated = shelf.sync(event.key);
    updated.forEach(renderSlot);
    if (updated.includes(selected)) {
      if (!editing) name.value = shelf.get(selected)?.name || "";
      status.textContent = "The selected slot changed in another tab.";
      refresh();
    }
  });
  return refresh;
}
