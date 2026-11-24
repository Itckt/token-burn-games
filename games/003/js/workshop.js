(function (root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('./roster.js') : root.Rift.roster, common ? require('./drills.js') : root.Rift.drills);
  if (common) module.exports = api;
  else root.Rift.workshop = api;
})(globalThis, function (Roster, Drills) {
  'use strict';

  function create(doc) {
    const byId = id => doc.getElementById(id);
    const format = byId('setup-mode');
    let draft, slot;
    function element(tag, text) {
      const el = doc.createElement(tag);
      if (text !== undefined) el.textContent = text;
      return el;
    }
    for (const [id, mode] of Object.entries(Drills.FORMATS)) {
      const option = element('option', mode.name + ' · ' + mode.duration + 's');
      option.value = id;
      format.append(option);
    }
    function describeMode() {
      byId('setup-brief').textContent = Drills.FORMATS[format.value].brief;
    }
    format.addEventListener('change', describeMode);
    const slots = Roster.DEFAULT_DECK.map((_, i) => {
      const button = element('button'), name = element('span');
      button.append(element('kbd', i + 1), name);
      button.addEventListener('click', () => { slot = i; refresh(); });
      byId('setup-slots').append(button);
      return {button, name};
    });
    const rows = Roster.CARDS.map(card => {
      const button = element('button'), img = element('img'), copy = element('span'), status = element('em');
      button.dataset.card = card.id;
      button.setAttribute('aria-label', card.name + ', ' + card.cost + ' energy. ' + card.info);
      img.alt = '';
      img.hidden = true;
      copy.append(element('strong', card.name), element('small', card.cost + ' energy · ' + card.role));
      button.append(img, copy, status);
      button.title = card.info;
      button.addEventListener('click', () => { Roster.equip(draft, slot, card.id); refresh(); });
      byId('setup-roster').append(button);
      return {card, button, img, status};
    });
    function refresh() {
      slots.forEach(({button, name}, i) => {
        name.textContent = Roster.CARD[draft[i]].name;
        button.setAttribute('aria-label', 'Slot ' + (i + 1) + ', ' + name.textContent);
        button.setAttribute('aria-pressed', String(slot === i));
      });
      for (const {card, button, status} of rows) {
        const position = draft.indexOf(card.id);
        status.textContent = position === -1 ? '' : String(position + 1);
        status.hidden = position === -1;
        button.setAttribute('aria-pressed', String(position === slot));
      }
      const selected = Roster.CARD[draft[slot]];
      byId('setup-intel').textContent = 'Slot ' + (slot + 1) + ' · ' + selected.name + '. ' + selected.info;
    }
    return {
      open(deck, mode, portraits, index) {
        draft = [...deck];
        slot = index;
        format.value = mode;
        describeMode();
        for (const {card, img} of rows) {
          img.hidden = !portraits;
          if (portraits) img.src = portraits[card.id];
        }
        refresh();
      },
      choice() { return {deck:[...draft], mode:format.value}; }
    };
  }
  return {create};
});
