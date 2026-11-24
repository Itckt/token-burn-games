(() => {
  "use strict";
  const {game:{TEAMS,MODES,RULES}, deck:Deck, supply:Supply, hud:{element,label,clockText}, hudArt:{paintIcon}} = Slipwake;
  const modeDetails = {
    skirmish: {
      guide: "Each knockout earns a point.",
      column: ["Drops","Supplies collected","supplies"]
    },
    relay: {
      guide: "Walk onto the gold core and carry it into the east gate. A carrier moves more slowly and loses the dash. Both crews in pickup range contest the core.",
      column: ["Goals","Core deliveries","deliveries"]
    },
    signal: {
      guide: "Hold the lit ring for a full uncontested second to earn a signal point. An empty or contested ring clears partial progress. The live station changes every 18 seconds. Dashing and shielded runners sit out the count.",
      column: ["Held","Signal points helped secure","holds"],
      note: "Held counts each point you were in the ring to secure."
    },
    freight: {
      guide: "Escort the cart to the east depot. Each extra escort adds speed. A rival in the circle stops it. If only rivals remain, it runs west. After a haul, meet the cart at midfield. Dashing and shielded runners sit out the push.",
      column: ["Hauls","Hauls escorted into a depot","hauls"],
      note: "Every runner escorting at the depot gets a haul."
    }
  };
  function iconCanvas() {
    const canvas = element("canvas");
    canvas.setAttribute("aria-hidden","true");
    return canvas;
  }
  function teamTable(match,team) {
    const columns = [
      ["KO","Knockouts","kills"],["Ast","Assists","assists"],["Down","Times knocked out","deaths"],
      ["Dmg","Damage dealt","damage"],["Heal","Health restored by card","healing"],modeDetails[match.mode].column
    ];
    const table = element("table","crew-table"), caption = element("caption",team ? "foe" : "friend");
    const crest = iconCanvas(), points = match.scores[team];
    paintIcon(crest,team ? "ember" : "tide");
    caption.append(crest,element("strong","",TEAMS[team]),element("span","",points + " " + MODES[match.mode].units[points===1 ? 0 : 1]));
    const head = element("thead"), headings = element("tr"), body = element("tbody");
    for (const [short,title] of [["Runner","Runner"],...columns]) {
      const cell = element("th","",short);
      cell.setAttribute("scope","col");
      cell.setAttribute("aria-label",title);
      cell.title = title;
      headings.append(cell);
    }
    for (const actor of match.actors) {
      if (actor.team!==team) continue;
      const row = element("tr",actor.id===0 ? "sheet-player" : "");
      const name = element("th","",actor.name);
      name.setAttribute("scope","row");
      if (actor.id===0) name.append(element("small","","You"));
      row.append(name);
      for (const column of columns) row.append(element("td","",String(actor[column[2]])));
      body.append(row);
    }
    head.append(headings);
    table.append(caption,head,body);
    return table;
  }
  class Menus {
    constructor(ui) { this.ui = ui; }
    modal(title, nodes, actions, focusIndex=0) {
      const ui = this.ui;
      label(ui["dialog-title"], title);
      ui["dialog-content"].replaceChildren(...nodes);
      const buttons = actions.map(([text, click]) => {
        const button = element("button", "", text);
        button.type = "button";
        button.addEventListener("click", click);
        return button;
      });
      ui["dialog-actions"].replaceChildren(...buttons);
      ui.dialog.scrollTop = 0;
      ui.game.inert = true;
      ui.overlay.hidden = false;
      (buttons[focusIndex] || ui.dialog).focus({preventScroll:true});
    }
    dismiss() {
      this.ui.overlay.hidden = true;
      this.ui.game.inert = false;
    }
    editDeck(loadout,save,cancel) {
      const slots = element("div","editor-slots"), pool = element("div","editor-pool");
      const positions = ["Hand 1","Hand 2","Reserve"];
      let draft = loadout.slice(), selected = 0;
      const slotViews = positions.map((position,index) => {
        const button = element("button","editor-slot"), icon = iconCanvas(), name = element("strong");
        button.type = "button";
        button.append(element("small","",position),icon,name);
        button.addEventListener("click",() => { selected=index; update(); });
        slots.append(button);
        return {button,icon,name};
      });
      const poolViews = Object.entries(Deck.cards).map(([id,card]) => {
        const button = element("button","editor-card"), icon = iconCanvas(), text = element("span","editor-copy");
        const where = element("small","editor-position");
        button.type = "button";
        button.dataset.card = id;
        paintIcon(icon,id);
        text.append(element("strong","",card.name),element("small","",card.help));
        button.append(icon,text,element("span","editor-cost",card.cost + " energy"),where);
        button.addEventListener("click",() => { draft=Deck.arrange(draft,selected,id); update(); });
        pool.append(button);
        return {button,id,where};
      });
      function update() {
        slotViews.forEach(({button,icon,name},i) => {
          const id = draft[i], card = Deck.cards[id];
          if (icon.dataset.icon !== id) paintIcon(icon,id);
          label(name,card.name);
          button.setAttribute("aria-pressed",String(selected===i));
          button.setAttribute("aria-label",positions[i] + ". " + card.name);
        });
        for (const {button,id,where} of poolViews) {
          label(where,positions[draft.indexOf(id)] || "");
          button.setAttribute("aria-pressed",String(draft[selected]===id));
        }
      }
      update();
      const help = element("p","","Choose a slot, then a card. Choosing a card already in your deck swaps the two slots.");
      this.modal("Build your deck",[help,slots,pool],[["Equip deck",()=>save(draft)],["Cancel",cancel]]);
      slotViews[0].button.focus({preventScroll:true});
    }
    guide(match,actions) {
      const objective = modeDetails[match.mode].guide;
      const rules = element("p", "", "The HKBU crew has three minutes between lectures. " + objective + " " + this.ui["round-brief"].textContent + " wins. At the horn, the higher score wins. A tie is a draw.");
      const list = element("dl", "guide-list");
      for (const [key, meaning] of [
        ["W A S D","Move relative to the screen."],["Mouse","Aim at a runner or a spot on the deck."],
        ["LMB","Click for one bolt. Hold for repeated fire."],["Space","Dash through fire. Move to steer, or dash along your aim."],
        ["E","Burst and push nearby rivals. Cover blocks both attacks."],["Esc / ?","Pause the round or open this guide."],
        ["F","Raise the return vane for 0.3 seconds. Hostile bolts that hit you travel back along their path with their remaining range. The vane recharges in four seconds. Dashing folds it."],
        ["1 / 2","Play a card from that slot. The reserve fills the slot you used. One energy returns every three seconds."],
        ["R","Rally your crewmates on open deck for six seconds. Move the pointer off the arena to call them to you. A core carrier keeps running the gate."],
        ["RMB","Right-click a rival to focus both crewmates’ fire for five seconds. Right-click open deck to clear the order."],
        ["C","Open or close the crew sheet. The round pauses while you read it."],
        ...(match.relay ? [["Q","Pass the core along the dashed aim line. Either crew can catch it. Carry a caught pass into the gate to score."]] : []),
        ["M","Toggle synthesized sound."]
      ]) {
        const term = element("dt");
        term.append(element("kbd","",key));
        list.append(term,element("dd","",meaning));
      }
      const cards = element("dl","guide-list");
      for (const card of Object.values(Deck.cards)) {
        cards.append(element("dt","guide-card",card.name + " · " + card.cost),element("dd","",card.help));
      }
      const supplies = element("p","guide-supply","Watch the boxed cross on the radar for crane drops. Collect a crate to repair up to " +
        Supply.RULES.repair + " health and run faster for five seconds. Both crews in the circle contest the crate.");
      this.modal("Field guide", [rules,list,supplies,cards], actions);
    }
    crewSheet(match,actions) {
      const summary = element("p","sheet-summary",MODES[match.mode].name + " · " + clockText(match.remaining) +
        (match.phase==="ended" ? " · Final" : match.prior==="ready" ? " · Deployment" : " · Paused"));
      let note = "Assists count damage in the last " + RULES.assistTime + " seconds or a live focus order when a crewmate finishes the knockout.";
      if (modeDetails[match.mode].note) note += " " + modeDetails[match.mode].note;
      this.modal("Crew sheet",[summary,teamTable(match,0),teamTable(match,1),element("p","sheet-note",note)],actions);
    }
    result(match, rematch, lobby, crewSheet, review, fromReview) {
      const p = match.actors[0], score = element("div", "result-score");
      score.append(element("span","friend",TEAMS[0]),element("strong","",match.scores.join(" – ")),element("span","foe",TEAMS[1]));
      const title = ["Undertow wins","Afterburn wins"][match.winner] || "Round drawn";
      const cause = match.scores.includes(match.target) ? MODES[match.mode].result : "Time on the deck is up.";
      const stats = element("p", "", "Your round · " + p.kills + " KO · " + p.deaths + " down · " + p.damage +
        " damage · " + p.assists + (p.assists===1 ? " assist" : " assists"));
      const nodes = [score,element("p","",cause),stats];
      if (p.returns) nodes.push(element("p","",p.returns + (p.returns===1 ? " bolt returned" : " bolts returned")));
      if (match.freight) nodes.push(element("p","",p.hauls + (p.hauls===1 ? " haul escorted" : " hauls escorted")));
      if (match.mode==="skirmish" && p.assists>=3) nodes.push(element("p","deadline","Group project · Your name earned its place on the hand-in."));
      if (match.relay || p.healing) nodes.push(element("p","",p.healing + " health restored" + (match.relay ? " · " + p.deliveries + " delivered" : "")));
      if (match.relay) {
        nodes.push(element("p","",p.completions + " completed passes · " + p.interceptions + " interceptions"));
        if (p.completions>=3) nodes.push(element("p","deadline","Clean transfers · The Kowloon Tong lunch express is running."));
      }
      if (match.scores.includes(match.target) && match.events.at(-2)?.deadline) {
        nodes.push(element("p","deadline","Deadline delivery · Handed in with " + match.remaining.toFixed(1) + " s to spare."));
      }
      this.modal(title, nodes, [["Play again",rematch],["Tactical replay",review],["Crew sheet",crewSheet],["Choose mode",lobby]],fromReview ? 1 : 0);
      this.ui.announcer.textContent = title + ". " + match.scores.join(" to ") + ".";
    }
  }
  Slipwake.menus = {Menus};
})();
