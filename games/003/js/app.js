(function (R, doc, win) {
  'use strict';
  const B = R.battle, Coils = R.coils, Roster = R.roster, Drills = R.drills;
  const byId = id => doc.getElementById(id);
  const field = byId('field');
  const dialog = byId('dialog');
  const labels = byId('world-labels');
  const lanes = [byId('lane-a'), byId('lane-b')];
  const guardButtons = [byId('guard-a'), byId('guard-b')];
  const sockets = [byId('socket-home'), byId('socket-center'), byId('socket-away')];
  const updateInstruments = R.instruments.create(doc, setText);
  const phaseNames = {ready: 'STANDBY', playing: 'LIVE MATCH', paused: 'PAUSED', ended: 'FINAL', offline: 'OFFLINE'};
  const workshop = R.workshop.create(doc), deckKey = 'rift-relay.deck.v1';
  const panels = R.dialogs.create(element), shelf = R.shelf.create(() => win.localStorage);
  let deck = Roster.deckOrDefault(), mode = 'standard';
  try { deck = Roster.deckOrDefault(JSON.parse(win.localStorage.getItem(deckKey))); } catch { /* File storage is optional. */ }
  const freshRecording = () => new R.replay.Recording({deck, mode, seed:mode === 'standard' ? Math.floor(Math.random() * 4294967296) : undefined});
  let recording = freshRecording(), clock = new B.FixedClock(), selected = B.CARD[deck[0]];
  let replay = null, replayRunning = false, replaySpeed = 1, pinnedAge = null, original = null;
  let listedRecording = null, momentIndex = -1, shelfSelection = null;
  let aimingCoil = false, socket = 1, boardPointer = null;
  const shownMatch = () => replay ? replay.match : recording.match;
  let renderer = null, graphicsIssue = null, cameraView = 0;
  let frameId = null, previousTime = null, sceneTime = 0, nextHudTime = 0;
  let resumeAfterDialog = false, noticeTimer, overlayKey = '';
  let audio = null, soundOn = false, lastEffect = 0;

  function element(tag, className, content) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }
  function icon(name) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg'), use = doc.createElementNS(ns, 'use');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    use.setAttribute('href', '#i-' + name);
    svg.append(use);
    return svg;
  }
  function setText(node, value) {
    const text = String(value);
    if (node.textContent !== text) node.textContent = text;
  }
  function buttonFace(button, glyph, label) {
    const use = button.querySelector('use'), href = '#i-' + glyph;
    if (use.getAttribute('href') !== href) use.setAttribute('href', href);
    setText(button.querySelector('span'), label);
  }
  function notify(message) {
    const notice = byId('notice');
    win.clearTimeout(noticeTimer);
    notice.textContent = message;
    notice.hidden = false;
    noticeTimer = win.setTimeout(() => { notice.hidden = true; }, 1700);
  }

  const energyCells = Array.from({length: B.MAX_ENERGY}, () => {
    const cell = element('i'), fill = element('i');
    cell.append(fill);
    byId('energy-meter').append(cell);
    return fill;
  });
  function makeCard(id, index) {
    const card = B.CARD[id];
    const button = element('button', 'unit-card'), art = element('span', 'card-art');
    const img = element('img'), cost = element('span', 'card-cost');
    const key = element('kbd', 'card-key', String(index + 1)), lock = element('span', 'card-lock');
    const copy = element('span', 'card-copy');
    art.style.setProperty('--ink', R.mesh.rgb(card.color).map(n => Math.round(n * 255)).join(' '));
    button.type = 'button';
    button.dataset.card = card.id;
    button.setAttribute('aria-label', card.name + ', ' + card.role + ', ' + card.cost + ' energy');
    button.setAttribute('aria-keyshortcuts', String(index + 1));
    button.title = card.name + ' · ' + card.hp + ' HP · ' + card.damage + ' damage per hit';
    img.alt = '';
    img.draggable = false;
    img.hidden = true;
    cost.append(icon('bolt'), element('span', '', String(card.cost)));
    copy.append(element('strong', '', card.name), element('small', '', card.role));
    art.append(img, cost, key, lock);
    button.append(art, copy);
    button.addEventListener('click', () => select(card));
    return {card, button, img, lock};
  }
  let cards = [];
  function fillHand(hand = deck) {
    cards = hand.map(makeCard);
    byId('cards').replaceChildren(...cards.map(item => item.button));
    if (renderer) showPortraits();
  }
  function showPortraits() {
    for (const {card, img} of cards) {
      img.src = renderer.portraits[card.id];
      img.hidden = false;
    }
  }
  fillHand();
  const laneTags = B.LANES.map((_, index) => {
    const node = element('span', 'world-mark lane-tag', B.laneName(index));
    labels.append(node);
    return node;
  });
  const bars = new Map();
  function position(node, x, y, z, width, height) {
    const [sx, sy] = renderer.project(x, y, z);
    const transform = 'translate(' + Math.round(sx * width) + 'px, ' + Math.round(sy * height) + 'px) translate(-50%, -50%)';
    if (node.style.transform !== transform) node.style.transform = transform;
  }
  function updateLabels(alpha) {
    const match = shownMatch();
    const width = field.clientWidth, height = field.clientHeight, alive = new Set();
    laneTags.forEach((tag, i) => position(tag, -9.16, .30, B.LANES[i], width, height));
    function health(actor, x, y) {
      if (actor.hp <= 0 || (!actor.tower && actor.hp === actor.maxHp)) return;
      let bar = bars.get(actor.id);
      if (!bar) {
        const node = element('span', 'world-mark health-bar ' + (actor.tower ? 'relay-health' : 'unit-health'));
        node.dataset.team = String(actor.team);
        const fill = element('i');
        node.append(fill);
        labels.append(node);
        bar = {node, fill};
        bars.set(actor.id, bar);
      }
      alive.add(actor.id);
      bar.fill.style.transform = 'scaleX(' + (actor.hp / actor.maxHp).toFixed(3) + ')';
      position(bar.node, x, y, actor.z, width, height);
    }
    for (const t of match.towers) health(t, t.x, 2.90);
    for (const u of match.units) health(u, R.math.lerp(u.prevX, u.x, alpha), Roster.UNIT[u.cardId].label);
    for (const [id, bar] of bars) if (!alive.has(id)) {
      bar.node.remove();
      bars.delete(id);
    }
  }

  function updateOverlay() {
    const match = shownMatch();
    const key = graphicsIssue?.title || (replay ? 'replay' : [match.phase, match.winner, match.reason, Boolean(original)].join('|'));
    if (key === overlayKey) return;
    overlayKey = key;
    const overlay = byId('overlay'), main = byId('overlay-main'), second = byId('overlay-second');
    overlay.hidden = !graphicsIssue && (Boolean(replay) || (match.phase !== 'paused' && match.phase !== 'ended'));
    byId('watch-replay').hidden = Boolean(graphicsIssue || replay) || match.phase !== 'ended';
    if (overlay.hidden) return;
    let title, body, glyph, kicker;
    main.hidden = false;
    second.hidden = false;
    if (graphicsIssue) {
      ({title, body} = graphicsIssue);
      glyph = 'info';
      kicker = 'GRAPHICS';
      main.textContent = 'Retry graphics';
      main.hidden = graphicsIssue.lost;
      second.hidden = true;
    } else if (match.phase === 'paused') {
      title = 'Match paused';
      body = 'Both lanes and energy reserves are frozen.';
      glyph = 'pause';
      kicker = 'TIMEOUT';
      main.textContent = 'Resume';
      second.textContent = original ? 'Retry position' : 'Restart match';
    } else {
      title = Drills.FORMATS[match.mode].drill ? (match.winner === 0 ? 'Drill cleared' : 'Drill lost') :
        match.winner === null ? 'Match drawn' : match.winner === 0 ? 'You win' : 'Vanta wins';
      glyph = match.winner === 1 ? 'rival' : match.winner === 0 ? 'player' : 'deck';
      kicker = match.reason.toUpperCase();
      const hp = [0, 0];
      for (const tower of match.towers) hp[tower.team] += tower.hp;
      body = 'Relays destroyed ' + match.destroyed.join(' – ') + '. Remaining relay health ' + hp.join(' – ') + ' (you / Vanta).';
      if (match.mode !== 'standard') body = Drills.FORMATS[match.mode].name + ' · ' + Drills.readout(match).text + '.';
      main.textContent = original ? 'Retry position' : 'Play again';
      second.textContent = 'Battle history';
    }
    byId('overlay-glyph').replaceChildren(icon(glyph));
    setText(byId('overlay-kicker'), kicker);
    setText(byId('overlay-title'), title);
    setText(byId('overlay-body'), body);
  }
  const filmTime = step => B.formatTime(Math.floor(step * B.STEP + 1e-8));
  function updateReplayControls() {
    byId('replay-strip').hidden = !replay;
    byId('deploy-strip').hidden = Boolean(replay);
    if (!replay) return;
    const tape = replay.recording;
    const toggle = byId('replay-toggle'), seek = byId('replay-seek');
    byId('take-over').hidden = Boolean(original);
    byId('take-over').disabled = Boolean(graphicsIssue || replay.atEnd || replay.match.phase !== 'playing');
    const action = replay.atEnd ? 'Replay again' : replayRunning ? 'Pause' : 'Play';
    toggle.disabled = seek.disabled = byId('replay-speed').disabled = Boolean(graphicsIssue);
    buttonFace(toggle, replayRunning ? 'pause' : 'play', action);
    toggle.setAttribute('aria-label', action === 'Replay again' ? action : action + ' replay');
    setText(byId('exit-replay'), tape === recording ? 'Results' : 'Back to arena');
    const elapsed = filmTime(replay.position), total = filmTime(tape.length);
    seek.max = String(tape.length);
    seek.value = String(replay.position);
    seek.setAttribute('aria-valuetext', elapsed + ' of ' + total);
    setText(byId('replay-time'), elapsed + ' / ' + total);
    setText(byId('replay-speed'), replaySpeed + '×');
    byId('replay-speed').setAttribute('aria-label', 'Playback speed ' + replaySpeed + '×. Change speed');
    const menu = byId('replay-moment');
    if (listedRecording !== tape) {
      const prompt = element('option', '', 'Choose a moment');
      prompt.value = '-1';
      menu.replaceChildren(prompt);
      tape.moments.forEach((moment, index) => {
        const option = element('option', '', filmTime(moment.step) + ' · ' + moment.message);
        option.value = String(index);
        menu.append(option);
      });
      listedRecording = tape;
    }
    if (menu.value !== String(momentIndex)) menu.value = String(momentIndex);
    menu.disabled = Boolean(graphicsIssue);
    byId('replay-lead').disabled = Boolean(graphicsIssue) || !tape.moments[momentIndex]?.step;
  }
  function updateAim(match, blocked) {
    const unavailable = Coils.canPlace(match, 0, 0, socket);
    if (blocked || match.phase !== 'playing') aimingCoil = false;
    const toggle = byId('coil-toggle');
    toggle.disabled = Boolean(blocked || (!aimingCoil && unavailable));
    toggle.setAttribute('aria-pressed', String(aimingCoil));
    const cooldown = Math.ceil(match.coils.readyAt[0] - match.age - 1e-8);
    const active = match.coils.fields[0];
    let status = unavailable.startsWith('Need') ? unavailable : Coils.COST + ' energy';
    if (match.phase === 'ready') status = 'Deploy first';
    else if (active) {
      const lane = B.laneName(active.lane);
      status = match.age < active.armAt - 1e-8 ? 'Arming ' + lane : 'Watching ' + lane + ' · ' + Math.ceil(active.expiresAt - match.age - 1e-8) + 's';
    } else if (cooldown > 0) status = 'Ready in ' + cooldown + 's';
    setText(byId('coil-status'), status);
    byId('coil-sockets').hidden = !aimingCoil;
    sockets.forEach((button, i) => button.setAttribute('aria-pressed', String(socket === i)));
    if (renderer) {
      renderer.previewCard = blocked || aimingCoil ? null : selected.id;
      renderer.previewSocket = aimingCoil ? socket : null;
    }
    const reason = aimingCoil ? unavailable : B.canDeploy(match, 0, 0, selected.id);
    for (const lane of lanes) lane.disabled = Boolean(blocked || reason);
    let caption = aimingCoil ? 'PLACE COIL' : 'DEPLOY SELECTED';
    if (reason.startsWith('Need') || reason === 'Card recharging') caption = reason.toUpperCase();
    setText(byId('deploy-caption'), caption);
    setText(byId('deploy-name'), aimingCoil ? Coils.NAMES[socket] + ' socket' : selected.name);
    setText(byId('intel-label'), aimingCoil ? 'FIELD ORDER' : 'UNIT INTEL');
    setText(byId('unit-info'), aimingCoil ? 'Tap a bridge to set the coil at its nearest socket. Enemies caught there take 18 damage and stop moving for 2s.' : selected.info);
  }
  function updateHud() {
    const match = shownMatch();
    const phase = graphicsIssue ? 'offline' : replay ? 'replay' : match.phase;
    doc.body.dataset.phase = phase;
    let phaseText = phaseNames[phase];
    if (phase === 'replay') phaseText = replayRunning ? 'REPLAY' : replay.atEnd ? 'REPLAY END' : 'REPLAY PAUSED';
    else if (original && !graphicsIssue) phaseText = phase === 'playing' ? 'PRACTICE' : 'PRACTICE ' + phaseNames[phase];
    setText(byId('phase-text'), phaseText);
    byId('return-original').hidden = !original;
    byId('match-setup').disabled = Boolean(original || replay || match.phase !== 'ready');
    byId('shelf-button').disabled = Boolean(original || replay);
    setText(byId('time'), B.formatTime(match.time));
    byId('time').classList.toggle('urgent', match.time <= 30);
    const pauseButton = byId('pause-button'), paused = replay ? !replayRunning : match.phase === 'paused';
    pauseButton.disabled = Boolean(graphicsIssue) || (!replay && match.phase === 'ended');
    pauseButton.setAttribute('aria-pressed', String(paused));
    buttonFace(pauseButton, paused ? 'play' : 'pause', replay && replay.atEnd ? 'Replay again' : paused ? 'Resume' : 'Pause');
    byId('camera-button').disabled = Boolean(graphicsIssue);
    labels.hidden = Boolean(graphicsIssue);
    const energy = match.energy[0];
    setText(byId('energy-number'), Math.floor(energy + 1e-8));
    byId('energy-meter').setAttribute('aria-valuenow', energy.toFixed(1));
    energyCells.forEach((fill, i) => {
      fill.style.transform = 'scaleX(' + R.math.clamp(energy - i, 0, 1).toFixed(3) + ')';
    });
    const blocked = Boolean(graphicsIssue || replay);
    updateAim(match, blocked);
    for (const {card, button, lock} of cards) {
      button.setAttribute('aria-pressed', String(!aimingCoil && card === selected));
      button.classList.toggle('unaffordable', energy + 1e-8 < card.cost);
      const remaining = (match.locks[0][card.id] || 0) - match.age;
      lock.hidden = remaining <= 0;
      if (remaining > 0) lock.style.transform = 'scaleX(' + R.math.clamp(remaining / B.CARD_LOCK, 0, 1) + ')';
    }
    const event = match.log[0];
    setText(byId('feed-time'), B.formatTime(event.time));
    byId('feed-time').dataset.side = String(event.side);
    setText(byId('feed-message'), event.message);
    const hpSummary = match.towers.map(t => (t.team ? 'Vanta ' : 'Your ') + B.laneName(t.lane) + ' ' + t.hp + ' HP').join(', ');
    const instruction = aimingCoil ? '. Choose a socket and use a lane button to place the coil.' : '. Use the lane buttons to deploy.';
    field.setAttribute('aria-label', (replay ? 'Match replay. ' : 'Two-lane battle board. ') + hpSummary + (replay ? '.' : instruction));
    updateInstruments(match, blocked);
    updateReplayControls();
    updateOverlay();
  }

  function tone(start, end, duration, volume, type = 'sine') {
    if (!soundOn || !audio || audio.state !== 'running') return;
    const osc = audio.createOscillator(), gain = audio.createGain(), time = audio.currentTime;
    osc.type = type;
    osc.frequency.setValueAtTime(start, time);
    osc.frequency.exponentialRampToValueAtTime(end, time + duration);
    gain.gain.setValueAtTime(.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + .012);
    gain.gain.exponentialRampToValueAtTime(.0001, time + duration);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(time);
    osc.stop(time + duration);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  function effectAudio() {
    let impact = null;
    for (const e of shownMatch().effects) if (e.id > lastEffect) {
      lastEffect = e.id;
      if (e.kind === 'deploy') tone(e.team ? 208 : 340, e.team ? 300 : 680, .13, .035);
      else if (e.kind === 'cache' || e.kind === 'delivery' || e.kind === 'uplink') tone(520, 825, .19, .035);
      else if (e.kind === 'intercept') tone(880, 440, .13, .026, 'triangle');
      else if (e.kind === 'snare') tone(480, 130, .22, .032, 'triangle');
      else if (e.kind === 'guard') tone(260, 345, .17, .03, 'triangle');
      else if (e.kind === 'mend') tone(480, 660, .12, .02);
      else if (e.kind !== 'transmit' && (!impact || e.kind === 'wreck')) impact = e;
    }
    if (impact) tone(impact.kind === 'wreck' ? 180 : 230, 58, impact.kind === 'wreck' ? .20 : .07, .024, 'triangle');
  }
  async function toggleSound() {
    const button = byId('sound-button');
    if (button.disabled) return;
    soundOn = !soundOn;
    try {
      if (soundOn) {
        if (!audio) audio = new (win.AudioContext || win.webkitAudioContext)();
        if (audio.state === 'suspended') await audio.resume();
        tone(360, 620, .11, .045);
      }
    } catch {
      soundOn = false;
      notify('Audio is unavailable in this browser.');
    }
    button.setAttribute('aria-pressed', String(soundOn));
    button.setAttribute('aria-label', soundOn ? 'Turn sound off' : 'Turn sound on');
    buttonFace(button, soundOn ? 'sound' : 'silent', soundOn ? 'Sound on' : 'Sound off');
  }
  function select(card) {
    if (card !== selected) tone(420, 520, .05, .018);
    selected = card;
    aimingCoil = false;
    updateHud();
  }
  function issueOrder(kind, lane) {
    if (graphicsIssue || dialog.open || replay || doc.hidden) return;
    const opening = recording.match.phase === 'ready';
    const result = recording.order(kind, lane, kind === 'coil' ? socket : selected.id);
    if (!result.ok) notify(result.error);
    else {
      if (kind === 'coil') aimingCoil = false;
      byId('notice').hidden = true;
      if (opening) previousTime = null;
    }
    updateHud();
  }
  function resetView(match) {
    clock = new B.FixedClock();
    previousTime = null;
    pinnedAge = match.age;
    aimingCoil = false;
    socket = 1;
    boardPointer = null;
    lastEffect = match.nextId - 1;
    sceneTime = renderer?.reduced ? 0 : match.age;
    byId('notice').hidden = true;
    // Entity IDs restart on a new tape. A reused ID can belong to the other faction.
    for (const {node} of bars.values()) node.remove();
    bars.clear();
    if (renderer) { renderer.hover = null; renderer.pointer = 0; }
    field.classList.remove('aiming');
  }
  function seekReplay(step) {
    replay.seek(step);
    resetView(replay.match);
  }
  function togglePause() {
    if (graphicsIssue || dialog.open || doc.hidden) return;
    if (replay) {
      if (replay.atEnd) seekReplay(0);
      replayRunning = !replayRunning;
    } else if (!B.pause(recording.match)) return;
    previousTime = null;
    updateHud();
  }
  function suspendPlay() {
    if (replay) {
      const running = replayRunning;
      replayRunning = false;
      return running;
    }
    return recording.match.phase === 'playing' && B.pause(recording.match);
  }
  function switchCamera() {
    if (!renderer || graphicsIssue) return;
    cameraView = 1 - cameraView;
    renderer.targetView = cameraView;
    const camera = byId('camera-button');
    setText(camera.querySelector('span'), cameraView ? 'CAM 02' : 'CAM 01');
    camera.setAttribute('aria-label', cameraView ? 'Switch to causeway camera' : 'Switch to tactical camera');
  }
  function restart() {
    recording = original ? original.playback.takeOver() : freshRecording();
    replay = null;
    replayRunning = false;
    listedRecording = null;
    momentIndex = -1;
    selected = B.CARD[recording.match.deck[0]];
    resetView(recording.match);
    updateHud();
  }
  function openDialog(section) {
    if (dialog.open) return;
    const setup = section === 'setup';
    if (setup && (recording.match.phase !== 'ready' || replay || original)) return;
    if (section === 'shelf' && (replay || original)) return;
    resumeAfterDialog = !graphicsIssue && suspendPlay();
    const content = byId('dialog-content');
    byId('setup-fields').hidden = byId('setup-cancel').hidden = !setup;
    dialog.dataset.section = section;
    setText(byId('dialog-done'), setup ? 'Apply setup' : 'Back to arena');
    const headings = {setup:['WORKSHOP','Match setup'], history:['MATCH LOG','Battle history'], manual:['FIELD MANUAL','How to play'], shelf:['MATCH FILMS','Replay shelf']};
    const [kicker, title] = headings[section];
    setText(byId('dialog-kicker'), kicker);
    setText(byId('dialog-heading'), title);
    content.replaceChildren();
    if (setup) workshop.open(deck, mode, renderer?.portraits, deck.indexOf(selected.id));
    else if (section === 'history') panels.history(content, shownMatch());
    else if (section === 'shelf') panels.films(content, shelf, watchSaved, Boolean(graphicsIssue));
    else panels.manual(content);
    dialog.showModal();
    updateHud();
  }
  dialog.addEventListener('close', () => {
    if (resumeAfterDialog && !graphicsIssue && !doc.hidden) {
      if (replay) replayRunning = !replay.atEnd;
      else if (recording.match.phase === 'paused') B.pause(recording.match);
    }
    resumeAfterDialog = false;
    previousTime = null;
    updateHud();
  });
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  byId('dialog-done').addEventListener('click', () => {
    if (dialog.dataset.section === 'setup' && recording.match.phase === 'ready' && !replay) {
      ({deck, mode} = workshop.choice());
      try { win.localStorage.setItem(deckKey, JSON.stringify(deck)); } catch { /* Keep this hand for the session. */ }
      fillHand();
      restart();
    }
    dialog.close();
  });
  byId('setup-cancel').addEventListener('click', () => dialog.close());
  byId('match-setup').addEventListener('click', () => openDialog('setup'));
  byId('close-dialog').addEventListener('click', () => dialog.close());
  byId('help-button').addEventListener('click', () => openDialog('manual'));
  byId('history-button').addEventListener('click', () => openDialog('history'));
  byId('shelf-button').addEventListener('click', () => openDialog('shelf'));
  byId('pause-button').addEventListener('click', togglePause);
  byId('camera-button').addEventListener('click', switchCamera);
  byId('sound-button').addEventListener('click', toggleSound);
  if (!win.AudioContext && !win.webkitAudioContext) {
    byId('sound-button').disabled = true;
    byId('sound-button').setAttribute('aria-label', 'Sound unavailable');
    byId('sound-button').title = 'Audio is unavailable in this browser';
  }
  byId('overlay-main').addEventListener('click', () => {
    if (graphicsIssue) startGraphics();
    else if (recording.match.phase === 'paused') togglePause();
    else if (recording.match.phase === 'ended') restart();
  });
  byId('overlay-second').addEventListener('click', () => {
    if (recording.match.phase === 'paused') restart();
    else if (recording.match.phase === 'ended') openDialog('history');
  });
  function startReplay(tape) {
    replay = new R.replay.Playback(tape);
    momentIndex = -1;
    replayRunning = !replay.atEnd;
    replaySpeed = 1;
    resetView(replay.match);
    updateHud();
    byId('replay-toggle').focus();
  }
  function watchSaved(entry) {
    if (graphicsIssue || doc.hidden || replay || original || !dialog.open) return;
    const tape = R.shelf.rebuild(entry);
    if (!tape) return false;
    resumeAfterDialog = false;
    dialog.close();
    shelfSelection = selected;
    selected = B.CARD[tape.match.deck[0]];
    fillHand(tape.match.deck);
    startReplay(tape);
  }
  byId('watch-replay').addEventListener('click', () => {
    if (recording.match.phase === 'ended' && !graphicsIssue && !replay) startReplay(recording);
  });
  byId('replay-toggle').addEventListener('click', togglePause);
  byId('replay-speed').addEventListener('click', () => {
    replaySpeed = replaySpeed === 4 ? 1 : replaySpeed * 2;
    updateHud();
  });
  byId('replay-seek').addEventListener('input', e => {
    if (!replay || graphicsIssue) return;
    replayRunning = false;
    momentIndex = -1;
    seekReplay(Number(e.target.value));
    updateHud();
  });
  function jumpToMoment(leadSeconds) {
    const moment = replay?.recording.moments[momentIndex];
    if (!moment || graphicsIssue || doc.hidden) return;
    replayRunning = false;
    seekReplay(moment.step - Math.round(leadSeconds / B.STEP));
    updateHud();
  }
  byId('replay-moment').addEventListener('change', e => {
    if (!replay || graphicsIssue) return;
    momentIndex = Number(e.target.value);
    if (momentIndex === -1) updateHud();
    else jumpToMoment(0);
  });
  byId('replay-lead').addEventListener('click', () => jumpToMoment(2));
  byId('take-over').addEventListener('click', () => {
    if (!replay || original || graphicsIssue || dialog.open || doc.hidden) return;
    const branch = replay.takeOver();
    if (!branch) return;
    original = {recording, playback:replay, speed:replaySpeed, momentIndex};
    recording = branch;
    replay = null;
    replayRunning = false;
    resetView(recording.match);
    updateHud();
    cards.find(item => item.card === selected).button.focus();
  });
  byId('return-original').addEventListener('click', () => {
    if (!original || dialog.open) return;
    recording = original.recording;
    replay = original.playback;
    replaySpeed = original.speed;
    momentIndex = original.momentIndex;
    original = null;
    replayRunning = false;
    resetView(replay.match);
    updateHud();
    if (!graphicsIssue) byId('replay-toggle').focus();
  });
  byId('exit-replay').addEventListener('click', () => {
    if (!replay) return;
    const fromShelf = replay.recording !== recording;
    replay = null;
    replayRunning = false;
    if (fromShelf) {
      selected = shelfSelection;
      shelfSelection = null;
      fillHand(recording.match.deck);
    }
    resetView(recording.match);
    updateHud();
    if (!graphicsIssue) byId(fromShelf ? 'shelf-button' : 'watch-replay').focus();
  });
  guardButtons.forEach((button, lane) => button.addEventListener('click', () => issueOrder('guard', lane)));
  function toggleCoil() {
    if (graphicsIssue || replay || dialog.open || doc.hidden) return;
    const error = Coils.canPlace(recording.match, 0, 0, socket);
    if (!aimingCoil && error) { notify(error); return; }
    aimingCoil = !aimingCoil;
    if (aimingCoil && boardPointer) {
      const site = siteAtPointer(boardPointer);
      if (site) socket = site.socket;
    }
    byId('notice').hidden = true;
    updateHud();
  }
  function chooseSocket(index) {
    if (aimingCoil && index !== socket) {
      socket = index;
      updateHud();
    }
  }
  function chooseManualSocket(index) {
    boardPointer = null;
    chooseSocket(index);
  }
  function placeSelected(lane) { issueOrder(aimingCoil ? 'coil' : 'deploy', lane); }
  byId('coil-toggle').addEventListener('click', toggleCoil);
  sockets.forEach((button, index) => button.addEventListener('click', () => chooseManualSocket(index)));
  lanes.forEach((button, lane) => {
    button.addEventListener('click', () => placeSelected(lane));
    const previewLane = () => { boardPointer = null; if (renderer) renderer.hover = lane; };
    button.addEventListener('pointerenter', previewLane);
    button.addEventListener('pointerleave', () => { if (renderer) renderer.hover = null; });
    button.addEventListener('focus', previewLane);
    button.addEventListener('blur', () => { if (renderer) renderer.hover = null; });
  });
  function fieldPoint(e) {
    if (!renderer || graphicsIssue || replay) return null;
    const rect = field.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || !Number.isFinite(e.clientX) || !Number.isFinite(e.clientY)) return null;
    const x = (e.clientX - rect.left) / rect.width * 2 - 1;
    const y = 1 - (e.clientY - rect.top) / rect.height * 2;
    renderer.pointer = R.math.clamp(x, -1, 1);
    return [x, y];
  }
  function siteAtPointer(e) {
    const point = fieldPoint(e);
    return point ? renderer.siteAt(...point) : null;
  }
  field.addEventListener('pointermove', e => {
    boardPointer = {clientX:e.clientX, clientY:e.clientY};
    const site = siteAtPointer(e);
    if (renderer) renderer.hover = site?.lane ?? null;
    if (site) chooseSocket(site.socket);
    field.classList.toggle('aiming', Boolean(site));
  });
  field.addEventListener('pointerleave', () => {
    boardPointer = null;
    if (renderer) { renderer.hover = null; renderer.pointer = 0; }
    field.classList.remove('aiming');
  });
  field.addEventListener('click', e => {
    const site = siteAtPointer(e);
    if (site) {
      boardPointer = {clientX:e.clientX, clientY:e.clientY};
      renderer.hover = site.lane;
      if (aimingCoil) socket = site.socket;
      placeSelected(site.lane);
    }
  });
  const expand = byId('expand-button');
  expand.hidden = !doc.fullscreenEnabled || !doc.documentElement.requestFullscreen;
  expand.addEventListener('click', async () => {
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else await doc.documentElement.requestFullscreen();
    } catch { notify('Fullscreen is unavailable in this window.'); }
  });
  doc.addEventListener('fullscreenchange', () => {
    expand.setAttribute('aria-pressed', String(Boolean(doc.fullscreenElement)));
    expand.setAttribute('aria-label', doc.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
  });
  doc.addEventListener('keydown', e => {
    if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || dialog.open || doc.hidden ||
        e.target.tagName === 'SELECT' || e.target.isContentEditable) return;
    const key = e.key.toLowerCase();
    if (/^[1-4]$/.test(key)) select(cards[Number(key) - 1].card);
    else if (key === 'q' || key === 'e') placeSelected(key === 'q' ? 0 : 1);
    else if (key === 'f' || (aimingCoil && key === 'escape')) toggleCoil();
    else if (aimingCoil && (key === 'arrowleft' || key === 'arrowright')) {
      chooseManualSocket(R.math.clamp(socket + (key === 'arrowleft' ? -1 : 1), 0, sockets.length - 1));
    }
    else if (key === 'z' || key === 'x') issueOrder('guard', key === 'z' ? 0 : 1);
    else if (key === 'p') togglePause();
    else if (key === 'v') switchCamera();
    else if (key === 'm') toggleSound();
    else if (key === '?') openDialog('manual');
    else return;
    e.preventDefault();
  });

  function stopFrames() {
    if (frameId !== null) win.cancelAnimationFrame(frameId);
    frameId = null;
    previousTime = null;
  }
  function schedule() {
    if (frameId === null && !doc.hidden && renderer && !graphicsIssue) frameId = win.requestAnimationFrame(frame);
  }
  function graphicsFailure(error, lost = false) {
    stopFrames();
    suspendPlay();
    resumeAfterDialog = false;
    if (!lost && renderer) renderer.dispose();
    renderer = null;
    graphicsIssue = {
      title: lost ? 'Graphics interrupted' : error.message === 'WebGL is unavailable' ? 'WebGL is unavailable' : 'Arena graphics unavailable',
      body: lost ? 'Your match will return when the graphics connection recovers.' : 'Enable WebGL and hardware acceleration in your browser, then retry to load the 3D board.',
      lost
    };
    updateHud();
  }
  function frame(time) {
    frameId = null;
    const delta = previousTime === null ? 0 : Math.max(0, Math.min(.25, (time - previousTime) / 1000));
    previousTime = time;
    const match = shownMatch(), phaseBefore = match.phase;
    if (replay) {
      if (replayRunning) clock.advance(delta, () => replay.advance(), replaySpeed);
      if (replay.atEnd) replayRunning = false;
    } else {
      if (match.phase === 'playing') clock.advance(delta, () => recording.advance());
      if (phaseBefore === 'playing' && match.phase === 'ended' && !original) shelf.keep(recording);
      if (!renderer.reduced && (match.phase === 'playing' || match.phase === 'ready')) sceneTime += delta;
    }
    const alpha = match.phase === 'ended' || match.age === pinnedAge ? 1 : clock.alpha;
    const displayTime = replay ? (renderer.reduced ? 0 : Math.max(0, match.age + (alpha - 1) * B.STEP)) : sceneTime;
    try {
      const pointer = boardPointer && fieldPoint(boardPointer);
      renderer.render(match, displayTime, alpha, delta, pointer);
      if (pointer) {
        field.classList.toggle('aiming', renderer.hover !== null);
        if (aimingCoil && renderer.hover !== null) chooseSocket(renderer.previewSocket);
      }
      updateLabels(alpha);
    } catch (error) {
      graphicsFailure(error);
      return;
    }
    effectAudio();
    if (time >= nextHudTime || phaseBefore !== match.phase) {
      updateHud();
      nextHudTime = time + 75;
    }
    schedule();
  }
  function startGraphics() {
    stopFrames();
    try {
      renderer = new R.Renderer(field);
      renderer.targetView = cameraView;
      showPortraits();
      graphicsIssue = null;
      updateHud();
      schedule();
    } catch (error) { graphicsFailure(error); }
  }
  field.addEventListener('webglcontextlost', e => { e.preventDefault(); graphicsFailure(new Error('Context lost'), true); });
  field.addEventListener('webglcontextrestored', startGraphics);
  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) {
      stopFrames();
      resumeAfterDialog = false;
      suspendPlay();
      updateHud();
    } else schedule();
  });
  startGraphics();
})(globalThis.Rift, document, window);
