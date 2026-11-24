(() => {
  "use strict";
  const {game:{RULES,TEAMS,MODES}, deck:Deck, signal:Signal, supply:Supply, freight:Freight, hudArt:{paintIcon,Radar}} = Slipwake;
  const byId = id => document.getElementById(id);

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function label(node, value) {
    if (node.textContent !== value) node.textContent = value;
  }
  function clockText(remaining) {
    const seconds=Math.max(0,Math.ceil(remaining-1e-7));
    return String(Math.floor(seconds/60)).padStart(2,"0") + ":" + String(seconds%60).padStart(2,"0");
  }
  function cooldownText(value) {
    return value <= 0 ? "" : String(Math.ceil(value - 1e-8) || 1);
  }
  class DeckPanel {
    constructor() {
      this.energy = byId("energy");
      this.fill = byId("energy-fill");
      this.value = byId("energy-value");
      this.note = byId("deck-note");
      this.slots = [byId("card-1"),byId("card-2")].map(button => ({
        button, icon:button.querySelector("canvas"), name:button.querySelector(".card-name"), cost:button.querySelector(".card-cost")
      }));
    }
    update(match) {
      const deck = match.deck, rules = Deck.RULES, player = match.actors[0];
      const fraction = (deck.energy + deck.charge / rules.chargeTime) / rules.capacity;
      this.fill.style.transform = "scaleX(" + fraction + ")";
      label(this.value, deck.energy + "/" + rules.capacity);
      if (this.energy.getAttribute("aria-valuenow") !== String(deck.energy)) {
        this.energy.setAttribute("aria-valuenow", String(deck.energy));
      }
      this.slots.forEach(({button,icon,name,cost}, index) => {
        const key = deck.hand[index], card = Deck.cards[key];
        if (button.dataset.card !== key) {
          button.dataset.card = key;
          if (icon.dataset.icon !== key) paintIcon(icon,key);
          label(name,card.name);
          label(cost,String(card.cost));
          button.title = card.name + " (" + card.cost + " energy). " + card.help;
          button.setAttribute("aria-label","Slot " + (index+1) + ". " + button.title);
        }
        button.disabled = match.phase !== "playing" || !player.hp || player.dashLeft > 0 || deck.energy < card.cost;
      });
      const feedback = this.feedback && match.elapsed - this.feedback.time < 1.8;
      label(this.note,feedback ? this.feedback.reason : "Next · " + Deck.cards[deck.reserve].name);
      this.note.classList.toggle("feedback",Boolean(feedback));
    }
  }

  class Hud {
    constructor() {
      const ids = ["game","score0","score1","clock","health","hp-fill","hp-current","dash-card","pulse-card",
        "score-target","mode-name","round-brief","deployment","edit-deck","relay-status","rally-state","focus-state",
        "crew-sheet","supply-status","supply-site","supply-state","vane","vane-state","freight-status","freight-pin","freight-state",
        ...Object.keys(MODES).map(mode=>"pick-"+mode),"signal-status","signal-site","signal-clock","signal-state","signal-fill",
        "pause","audio","deploy","tags","damage-numbers","hitmark","feed","respawn","respawn-text",
        "overlay","dialog","dialog-title","dialog-content","dialog-actions","announcer"];
      this.ui = Object.fromEntries(ids.map(id => [id, byId(id)]));
      document.querySelectorAll("canvas[data-icon]").forEach(canvas => paintIcon(canvas, canvas.dataset.icon));
      paintIcon(byId("portrait"), "tide");
      this.radar = new Radar(byId("radar"));
      this.deck = new DeckPanel();
      this.dashText = this.ui["dash-card"].querySelector(".cooldown");
      this.pulseText = this.ui["pulse-card"].querySelector(".cooldown");
    }
    reset(match) {
      const ui = this.ui;
      this.numbers = [];
      this.messages = [];
      this.deck.feedback = null;
      this.rallyFeedback = null;
      this.lastSupply = null;
      this.hit = null;
      this.radarTime = -Infinity;
      ui.feed.replaceChildren();
      ui["damage-numbers"].replaceChildren();
      ui.hitmark.hidden = true;
      ui.announcer.textContent = "";
      label(ui["score-target"],"FIRST TO " + match.target);
      const mode = MODES[match.mode];
      label(ui["mode-name"],mode.name);
      label(ui["round-brief"],"First to " + match.target + " " + mode.units[match.target===1 ? 0 : 1]);
      for (const key of Object.keys(MODES)) ui["pick-"+key].setAttribute("aria-pressed",String(key===match.mode));
      this.deck.update(match);
      this.tags = match.actors.map(a => {
        const tag = element("div", a.team ? "actor-tag hostile" : "actor-tag");
        if (a.id === 0) tag.append(element("span", "you-tag", "YOU"));
        const bar = element("div", "world-hp"), fill = element("i");
        bar.append(fill);
        tag.append(bar);
        return { tag, fill };
      });
      ui.tags.replaceChildren(...this.tags.map(entry => entry.tag));
    }
    combatNumber(e) {
      const repair = e.type === "repair", incoming = e.victim === 0;
      const style = repair ? " repair" : incoming ? " incoming" : "";
      const node = element("span","damage-number" + style,repair ? "+" + e.amount : "−" + e.damage);
      this.ui["damage-numbers"].append(node);
      this.numbers.push({node,x:e.x,z:e.z,time:e.time});
      if (!repair && !incoming) this.hit = e;
    }
    feedEntry(match,e) {
      const from = match.actors[e.source], to = match.actors[e.victim];
      const row = element("div","feed-row");
      const name = a => element("span",a.team ? "foe" : "friend",a.id === 0 ? "You" : a.name);
      let message;
      if (e.type === "freightDock") {
        const depot = e.team ? "West depot" : "East depot";
        row.append(element("span",e.team ? "foe" : "friend",TEAMS[e.team]),element("b","","HAUL"),element("span","",depot));
        message = TEAMS[e.team] + " docked at the " + depot.toLowerCase() + ".";
      } else if (e.type === "relayCatch") {
        const passer = match.actors[e.passer];
        row.append(name(passer),element("b","",e.intercepted ? "INTERCEPTED BY" : "PASS TO"),name(from));
        message = from.name + (e.intercepted ? " intercepted " : " caught ") + passer.name + "’s pass.";
      } else if (to) {
        row.append(name(from),element("b","","KO"),name(to));
        message = from.name + " knocked out " + to.name + ".";
        if (e.assists.includes(0)) {
          row.append(element("b","assist-credit","Your assist"));
          message += " Your assist.";
        }
      } else {
        row.append(name(from),element("b","",e.deadline ? "DEADLINE DELIVERY" : "DELIVERY"));
        message = from.name + " delivered the core.";
      }
      this.ui.feed.prepend(row);
      this.messages.push({node:row,time:e.time});
      if (this.messages.length > 3) this.messages.shift().node.remove();
      this.ui.announcer.textContent = message;
    }
    consume(match,e) {
      const announce = this.ui.announcer;
      switch (e.type) {
        case "hit":
          if (e.source === 0 || e.victim === 0) this.combatNumber(e);
          break;
        case "repair":
          this.deck.feedback = null;
          this.combatNumber(e);
          break;
        case "ko":
        case "delivery":
        case "freightDock":
        case "relayCatch":
          this.feedEntry(match,e);
          this.radarTime = -Infinity;
          break;
        case "boltReturn":
          announce.textContent = match.actors[e.source].name + " returned a bolt.";
          this.radarTime = -Infinity;
          break;
        case "freightReset":
          announce.textContent = "Cart back at midfield.";
          this.radarTime = -Infinity;
          break;
        case "rally":
          this.rallyFeedback = null;
          announce.textContent = "Crew rally set for six seconds.";
          this.radarTime = -Infinity;
          break;
        case "rallyDenied":
          this.rallyFeedback = e;
          announce.textContent = e.reason;
          break;
        case "focus":
        case "focusClear":
          announce.textContent = e.type === "focus" ? "Crew focusing " + match.actors[e.target].name + "." : "Focus order cleared.";
          this.radarTime = -Infinity;
          break;
        case "supplyInbound":
        case "supplyLand":
          announce.textContent = e.name + (e.type === "supplyInbound" ? ". Supplies landing in three seconds." : ". Supply crate on deck.");
          this.radarTime = -Infinity;
          break;
        case "supplyCollect":
          this.lastSupply = e;
          announce.textContent = match.actors[e.source].name + " collected supplies at the " + e.name.toLowerCase() + ".";
          if (e.heal > 0) this.combatNumber({...e,type:"repair",victim:e.source,amount:e.heal});
          this.radarTime = -Infinity;
          break;
        case "cardDenied":
          this.deck.feedback = e;
          announce.textContent = e.reason;
          break;
        case "net":
        case "fork":
        case "bank":
        case "haul":
          this.deck.feedback = null;
          break;
        case "relayPickup":
        case "relayDrop":
        case "relayReturn":
          announce.textContent = e.type === "relayPickup" ? match.actors[e.source].name + " picked up the core."
            : e.type === "relayDrop" ? "Core dropped." : "Core returned to midfield.";
          this.radarTime = -Infinity;
          break;
        case "relayPass":
        case "relayLand":
          announce.textContent = e.type === "relayPass" ? match.actors[e.source].name + " passed the core." : "Pass landed. Recover the loose core.";
          this.radarTime = -Infinity;
          break;
        case "signalShift":
          announce.textContent = "Station moved to " + Signal.stations[match.signal.station].name + ".";
          this.radarTime = -Infinity;
          break;
      }
    }
    buttonIcon(button, name, title, pressed) {
      const canvas = button.querySelector("canvas");
      if (canvas.dataset.icon !== name) paintIcon(canvas, name);
      if (button.title !== title) {
        button.title = title;
        button.setAttribute("aria-label", title);
      }
      button.setAttribute("aria-pressed", String(pressed));
    }
    sound(enabled) {
      this.buttonIcon(this.ui.audio, enabled ? "sound" : "muted", (enabled ? "Mute" : "Enable") + " sound (M)", enabled);
    }
    abilities(match,player) {
      const ui = this.ui, carrying = match.relay?.carrier === player.id;
      label(this.dashText,carrying ? "CORE" : cooldownText(player.dashCd));
      ui["dash-card"].classList.toggle("carrying",carrying);
      label(this.pulseText,cooldownText(player.pulseCd));
      let vane = "Ready";
      if (!player.hp) vane = "Down";
      else if (player.vaneLeft > 0) vane = "Active";
      else if (player.vaneCd > 0) vane = cooldownText(player.vaneCd) + " s";
      else if (player.shield > 0) vane = "Shielded";
      else if (player.dashLeft > 0) vane = "Dashing";
      label(ui["vane-state"],vane);
      ui.vane.classList.toggle("raised",player.vaneLeft>0);
      ui.vane.disabled = match.phase!=="playing" || vane!=="Ready";
    }
    update(match, view) {
      const ui = this.ui, player = match.actors[0], now = match.elapsed;
      label(ui.clock, clockText(match.remaining));
      for (let team=0; team<2; team++) label(ui["score"+team], String(match.scores[team]).padStart(2,"0"));
      label(ui["hp-current"], String(player.hp));
      ui["hp-fill"].style.transform = "scaleX(" + player.hp/RULES.hp + ")";
      if (ui.health.getAttribute("aria-valuenow") !== String(player.hp)) ui.health.setAttribute("aria-valuenow", String(player.hp));
      this.abilities(match,player);
      ui.deploy.hidden = match.phase !== "ready";
      ui.deployment.hidden = ui.deploy.hidden;
      this.deck.update(match);
      const rallyText = match.rally ? "Rally · " + Math.ceil(match.rally.remaining-1e-8) + " s" : "Rally crew";
      label(ui["rally-state"],this.rallyFeedback && now-this.rallyFeedback.time < 1.8 ? this.rallyFeedback.reason : rallyText);
      label(ui["focus-state"],match.focus ? "Focus · " + Math.ceil(match.focus.until-now-1e-8) + " s" : "Focus fire");
      this.supplyStatus(match);
      ui["relay-status"].hidden = !match.relay;
      if (match.relay) label(ui["relay-status"],this.relayStatus(match));
      ui["signal-status"].hidden = !match.signal;
      if (match.signal) this.signalStatus(match);
      ui["freight-status"].hidden = !match.freight;
      if (match.freight) this.freightStatus(match);
      ui.respawn.hidden = player.hp > 0 || match.phase !== "playing";
      if (!ui.respawn.hidden) label(ui["respawn-text"], "Back on deck in " + player.respawn.toFixed(1) + " s");
      const paused = match.phase === "paused";
      if (this.paused !== paused) {
        this.paused = paused;
        this.buttonIcon(ui.pause, paused ? "play" : "pause", (paused ? "Resume" : "Pause") + " round (Esc)", paused);
      }
      ui.pause.disabled = match.phase === "ended";
      for (const a of match.actors) {
        const {tag, fill} = this.tags[a.id];
        tag.hidden = !a.hp;
        if (tag.hidden) continue;
        const hasCore = match.relay?.carrier === a.id;
        const p = view.locate(a.x, hasCore ? 2.83 : 2.26, a.z);
        tag.style.transform = "translate(" + Math.round(p.x) + "px," + Math.round(p.y-5) + "px)";
        fill.style.width = a.hp + "%";
        tag.classList.toggle("shield", a.shield > 0);
        tag.classList.toggle("carrier", hasCore);
        tag.classList.toggle("focus-target", match.focus?.target === a.id);
        tag.classList.toggle("boosted", a.boostLeft > 0);
      }
      if (now - this.radarTime >= 0.09) {
        this.radar.paint(match);
        this.radarTime = now;
      }
      while (this.messages.length && now-this.messages[0].time > 4.8) this.messages.shift().node.remove();
      while (this.numbers.length && now-this.numbers[0].time > 0.62) this.numbers.shift().node.remove();
      for (const n of this.numbers) {
        const age = now-n.time, p = view.locate(n.x,2.25+1.5*age,n.z);
        n.node.style.transform = "translate(" + Math.round(p.x+9) + "px," + Math.round(p.y-8) + "px)";
        n.node.style.opacity = String(Math.min(1,(0.62-age)*4));
      }
      ui.hitmark.hidden = !this.hit || now-this.hit.time > 0.1;
      if (!ui.hitmark.hidden) {
        const p = view.locate(this.hit.x,1.1,this.hit.z);
        ui.hitmark.style.left = p.x + "px";
        ui.hitmark.style.top = p.y + "px";
      }
    }
    supplyStatus(match) {
      const ui = this.ui, drop = match.supply, boost = match.actors[0].boostLeft;
      const recent = this.lastSupply && match.elapsed-this.lastSupply.time < 2;
      ui["supply-status"].hidden = drop.state === "waiting" && !boost && !recent;
      if (ui["supply-status"].hidden) return;
      let title, state;
      if (drop.state !== "waiting") {
        title = Supply.sites[drop.site].name;
        const seconds = Math.max(0,Math.ceil(drop.nextAt-match.elapsed-1e-8));
        const action = drop.state === "incoming" ? "Landing" : drop.contested ? "Contested" : "Collect";
        state = action + " · " + seconds + " s";
      } else if (boost > 0) {
        title = "Speed boost";
        state = Math.ceil(boost-1e-8) + " s left";
      } else {
        title = match.actors[this.lastSupply.source].name;
        state = "Resupplied";
      }
      label(ui["supply-site"],title);
      label(ui["supply-state"],state);
    }
    relayStatus(match) {
      const core = match.relay;
      if (match.phase === "ready") return "Carry the core to the east gate";
      if (core.contested) return "Core contested · Clear the circle";
      if (core.flight) return core.flight.team ? "Rival pass · Cut it off" : "Pass in flight · Meet the core";
      if (core.carrier !== null) {
        const carrier = match.actors[core.carrier];
        if (carrier.id === 0) return "You have the core · Reach the east gate or press Q to pass";
        return carrier.team ? "Defend the west gate · " + carrier.name : "Escort " + carrier.name + " to the east gate";
      }
      if (core.state === "dropped") return "Loose core · Returns in " + Math.ceil(core.returnIn-1e-8) + " s";
      return core.lock > 1e-8 ? "Core resetting at midfield" : "Collect the core at midfield";
    }
    signalStatus(match) {
      const ui = this.ui, signal = match.signal;
      label(ui["signal-site"],Signal.stations[signal.station].name);
      label(ui["signal-clock"],Math.ceil(signal.remaining-1e-8) + " s");
      let state = "Hold the lit ring";
      if (signal.contested) state = "Contested · Clear the ring";
      else if (signal.owner !== null) state = TEAMS[signal.owner] + " holding";
      if (signal.remaining <= Signal.RULES.previewTime) state += " · Next " + Signal.stations[Signal.nextStation(signal)].name;
      label(ui["signal-state"],state);
      ui["signal-status"].dataset.control = signal.contested ? "contested" : ["ally","rival"][signal.owner] || "open";
      ui["signal-fill"].style.transform = "scaleX(" + signal.progress/Signal.RULES.pointTime + ")";
    }
    freightStatus(match) {
      const ui = this.ui, cart = match.freight, end = Freight.RULES.terminal;
      let state = "Escort the cart to the east depot";
      if (cart.resetLeft > 0) {
        state = match.phase==="ended" ? (cart.owner ? "West" : "East") + " depot reached"
          : "Docked · Midfield reset in " + Math.ceil(cart.resetLeft-1e-8) + " s";
      } else if (cart.contested) state = "Contested · Clear the cart";
      else if (cart.owner !== null) {
        const distance = end + (cart.owner ? cart.x : -cart.x);
        state = (cart.owner ? "Westbound" : "Eastbound") + " · " + distance.toFixed(1) + " m · " +
          cart.escorts + (cart.escorts===1 ? " escort" : " escorts");
      }
      label(ui["freight-state"],state);
      ui["freight-status"].dataset.control = cart.contested ? "contested" : ["ally","rival"][cart.owner] || "open";
      ui["freight-pin"].style.left = (50+50*cart.x/end) + "%";
    }
  }
  Slipwake.hud = {Hud, element, label, clockText};
})();
