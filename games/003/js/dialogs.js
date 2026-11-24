(function (root, factory) {
  const common = typeof module === 'object' && module.exports;
  const load = name => common ? require('./' + name + '.js') : root.Rift[name];
  const api = factory(load('battle'), load('drills'));
  if (common) module.exports = api;
  else root.Rift.dialogs = api;
})(globalThis, function (B, Drills) {
  'use strict';

  function create(element) {
    function manual(content) {
      content.append(element('p', '', 'Choose a card, then click or tap a lane. Your units deploy beside your relay and fight automatically. Your first deployment starts the clock.'),
        element('p', '', 'Open Match setup before deploying to equip four of seven machines and choose a format. Parcel Run marks a carrier and its delivery arch in green. In Night Watch, defend the marked relay against three waves.'));
      const list = element('dl', 'control-list');
      const bindings = [
        ['Select a card', ['1', '2', '3', '4']], ['Deploy to Lane A / B', ['Q', 'E']],
        ['Aim or cancel a snare coil', ['F']], ['Change coil socket', ['←', '→']],
        ['Guard Lane A / B', ['Z', 'X']], ['Pause or resume', ['P']], ['Switch camera', ['V']], ['Toggle sound', ['M']], ['Open controls', ['?']]
      ];
      for (const [action, keys] of bindings) {
        const row = element('div'), shortcuts = element('dd');
        for (const key of keys) shortcuts.append(element('kbd', '', key));
        row.append(element('dt', '', action), shortcuts);
        list.append(row);
      }
      content.append(list,
        element('p', '', 'Hover over a bridge or focus its lane button to see a hologram at each deployment position.'),
        element('p', '', 'The gold signal cache stops at alternating bridges. Hold the marked center alone for 2 continuous seconds to collect 2 energy. An empty or contested center resets the link.'),
        element('p', '', 'Lane guard halves damage to your relay and units on one lane for 5 seconds. It costs no energy. Both lanes share a 22-second recharge.'),
        element('p', '', 'Spend 2 energy on a snare coil. Press F and click a bridge socket, or choose Home, Center or Away and use Q or E. The coil arms in 0.6s and watches for 6s. Its first catch deals 18 damage to every enemy machine in the field and holds them for 2s. They can still fight. Both lanes share a 14s recharge.'),
        element('p', '', 'In Freight Shift, the two carts move toward the rival dock when you have more escorts nearby. Up to three machines per side count on each lane. Equal numbers stop the cart. Snared escorts can push again when released. A delivery scores one point and the cart reloads at center after 4s. First to two wins. At the horn, equal deliveries draw.'),
        element('p', '', 'In Salvage Circuit, get a machine within the gold pickup frame while the other side is clear. Each machine holds three fuses. A wreck drops its fuses plus one. Every 12s the central mast banks both crews’ loads. Reach eight with a lead, or lead at the final uplink. Equal final scores draw.'),
        element('p', '', 'The Pleat Skiff’s gold ring shows its screen is ready. It can catch an enemy pulse, relay bolt or mortar shell on its lane once every 4s, even while snared.'),
        element('p', '', 'Energy refills by one about every 2.2 seconds, up to ten. In a relay battle, break both enemy relays to win. At the buzzer, surviving relays decide the match, then their total health. Equal totals draw.'),
        element('p', '', 'After the match, choose Watch replay. Drag the timeline or select a Key play to pause there. Choose 2s before for its lead-in. Press P to continue, or Take command to try another move. Original replay returns to the same frame.'),
        element('p', '', 'Open Replays for your three most recent finished matches. A saved replay supports the same controls and practice branches. Back to arena returns to your own board. A live match waits there paused.'));
    }
    function history(content, match) {
      const table = element('table', 'match-stats');
      table.append(element('caption', '', 'Match totals'));
      const head = element('thead'), header = element('tr'), body = element('tbody');
      for (const title of ['Stat', 'You', 'Vanta']) header.append(element('th', '', title));
      head.append(header);
      let objective = ['Caches secured', match.captures];
      if (match.mode === 'freight') objective = ['Carts delivered', match.objective.score];
      if (match.mode === 'salvage') objective = ['Fuses banked', match.objective.score];
      for (const [label, values] of [
        ['Cards deployed', match.deployed], objective, ['Machines snared', match.coils.caught],
        ['Shots intercepted', match.intercepted], ['Damage prevented by guard', match.guards.map(guard => guard.blocked)], ['HP repaired', match.repaired]
      ]) {
        const row = element('tr'), heading = element('th', '', label);
        heading.setAttribute('scope', 'row');
        row.append(heading, ...values.map(value => element('td', '', value)));
        body.append(row);
      }
      table.append(head, body);
      const list = element('ol', 'history-list');
      for (const event of match.log) {
        const row = element('li');
        row.dataset.side = String(event.side);
        row.append(element('time', '', B.formatTime(event.time)), element('span', '', event.message));
        list.append(row);
      }
      content.append(table, list);
    }
    function films(content, shelf, watch, offline) {
      const help = element('p', '', shelf.persistent ? 'Your last three finished matches, newest first.' : 'Your last three finished matches are available for this page session.');
      content.append(help);
      if (!shelf.entries.length) {
        content.append(element('p', 'shelf-empty', 'Finish a match to keep its replay here.'));
        return;
      }
      const list = element('ol', 'film-list'), status = element('p', 'film-status');
      status.setAttribute('role', 'status');
      for (const entry of shelf.entries) {
        const row = element('li'), copy = element('div'), mode = Drills.FORMATS[entry.setup.mode].name;
        const result = entry.winner === null ? 'Draw' : entry.winner === 0 ? 'Win' : 'Loss';
        const title = element('strong', '', mode), badge = element('b', 'film-result', result);
        badge.dataset.side = String(entry.winner);
        const elapsed = B.formatTime(Math.floor(entry.ticks * B.STEP + 1e-8));
        copy.append(title, badge, element('time', '', elapsed), element('small', '', entry.setup.deck.map(id => B.CARD[id].name).join(' · ')));
        const button = element('button', 'secondary', 'Watch');
        button.setAttribute('aria-label', 'Watch ' + mode + ' · ' + result + ' · ' + elapsed);
        button.disabled = offline;
        button.addEventListener('click', () => {
          if (watch(entry) === false) {
            button.disabled = true;
            status.textContent = 'This replay could not be reconstructed.';
          }
        });
        row.append(copy, button);
        list.append(row);
      }
      content.append(list, status);
    }
    return {manual, history, films};
  }
  return {create};
});
