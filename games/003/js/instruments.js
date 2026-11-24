(function (root, factory) {
  const common = typeof module === 'object' && module.exports;
  const load = name => common ? require('./' + name + '.js') : root.Rift[name];
  const api = factory(load('battle'), load('signal'), load('drills'), load('freight'), load('salvage'));
  if (common) module.exports = api;
  else root.Rift.instruments = api;
})(globalThis, function (B, Signal, Drills, Freight, Salvage) {
  'use strict';

  const secondsLeft = seconds => Math.max(0, Math.ceil(seconds - 1e-8));
  function create(doc, setText) {
    const byId = id => doc.getElementById(id);
    const guardButtons = [byId('guard-a'), byId('guard-b')];
    const tracks = B.LANES.map((_, lane) => {
      const row = doc.createElement('div'), name = doc.createElement('strong'), rail = doc.createElement('span');
      const pin = doc.createElement('i'), state = doc.createElement('small');
      name.textContent = 'Lane ' + B.laneName(lane);
      rail.className = 'freight-meter';
      rail.setAttribute('role', 'meter');
      rail.setAttribute('aria-label', name.textContent + ' cart position');
      rail.setAttribute('aria-valuemin', '-100');
      rail.setAttribute('aria-valuemax', '100');
      rail.append(pin);
      row.append(name, rail, state);
      byId('freight-strip').append(row);
      return {row, rail, pin, state};
    });
    function updateFreight(s) {
      s.objective.carts.forEach((cart, lane) => {
        const {row, rail, pin, state} = tracks[lane];
        const position = Math.round(100 * cart.x / Freight.DOCK), status = Freight.status(cart, s.age);
        const location = position === 0 ? 'At center' : Math.abs(position) + '% toward ' + (position > 0 ? 'Vanta' : 'your dock');
        setText(state, status);
        row.dataset.push = String(Math.sign(cart.escorts[0] - cart.escorts[1]));
        pin.style.left = (50 + position / 2) + '%';
        rail.setAttribute('aria-valuenow', String(position));
        rail.setAttribute('aria-valuetext', location + ' · ' + status);
        rail.title = location;
      });
    }
    function updateSignal(s) {
      const cache = s.cache;
      let status;
      if (cache.phase === 'incoming') status = 'Arrives in ' + secondsLeft(cache.opensAt - s.age) + 's';
      else if (cache.phase === 'done') status = 'Deliveries complete';
      else if (cache.phase === 'claimed') status = cache.holder === 0 ? 'Secured by you' : 'Secured by Vanta';
      else {
        const hold = cache.contested ? 'Contested' : cache.holder === 0 ? 'Your link' : cache.holder === 1 ? 'Vanta linking' : 'Hold center';
        const closing = Math.min(cache.opensAt + Signal.WINDOW, s.duration);
        status = hold + ' · ' + secondsLeft(closing - s.age) + 's left';
      }
      setText(byId('signal-status'), status);
      setText(byId('signal-lane'), 'Lane ' + B.laneName(cache.lane));
      byId('signal-lane').hidden = cache.phase === 'done';
      byId('signal-strip').dataset.side = String(cache.holder);
      const meter = byId('signal-meter');
      meter.hidden = cache.phase !== 'open';
      meter.setAttribute('aria-valuenow', String(Math.round(100 * cache.held / Signal.HOLD)));
      byId('signal-fill').style.transform = 'scaleX(' + cache.held / Signal.HOLD + ')';
    }
    function updateGuard(s, blocked) {
      const guard = s.guards[0], active = B.isGuarded(s, 0, guard.lane);
      const cooldown = secondsLeft(guard.readyAt - s.age);
      let status = 'Ready';
      if (active) status = 'Guarding ' + B.laneName(guard.lane) + ' · ' + secondsLeft(guard.until - s.age) + 's';
      else if (cooldown) status = 'Ready in ' + cooldown + 's';
      else if (s.phase === 'ready') status = 'Deploy first';
      setText(byId('guard-status'), status);
      guardButtons.forEach((button, lane) => {
        button.disabled = Boolean(blocked || B.canGuard(s, 0, lane));
        button.dataset.active = String(active && guard.lane === lane);
      });
    }
    return function update(s, blocked) {
      const freight = s.mode === 'freight', salvage = s.mode === 'salvage', format = Drills.FORMATS[s.mode];
      const score = format.scoreTitles ? s.objective.score : s.destroyed;
      setText(byId('score-player'), score[0]);
      setText(byId('score-rival'), score[1]);
      byId('score-player').title = format.scoreTitles?.[0] ?? 'Enemy relays destroyed';
      byId('score-rival').title = format.scoreTitles?.[1] ?? 'Your relays destroyed';
      const objective = Drills.readout(s);
      byId('objective-strip').hidden = !objective;
      if (objective) {
        setText(byId('objective-name'), format.name);
        setText(byId('objective-detail'), objective.text);
        byId('objective-meter').hidden = objective.progress === undefined;
        if (objective.progress !== undefined) byId('objective-fill').style.transform = 'scaleX(' + objective.progress + ')';
      }
      byId('salvage-cargo').hidden = !salvage;
      byId('freight-strip').hidden = !freight;
      byId('signal-strip').hidden = Boolean(format.scoreTitles);
      if (freight) updateFreight(s);
      else if (salvage) {
        const [you, rival] = Salvage.carried(s);
        setText(byId('cargo-player'), you);
        setText(byId('cargo-rival'), rival);
      }
      else updateSignal(s);
      updateGuard(s, blocked);
    };
  }
  return {create};
});
