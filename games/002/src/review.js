(() => {
  "use strict";
  const {game:{TEAMS,MODES}, tape:{trailTime}, hud:{element,label}, hudArt:{Radar}} = Slipwake;

  function stamp(time) {
    const tenths = Math.floor(time*10+1e-7);
    return Math.floor(tenths/600) + ":" + String(Math.floor(tenths/10)%60).padStart(2,"0") + "." + tenths%10;
  }
  function button(text,action) {
    const node = element("button","tape-button",text);
    node.type = "button";
    node.addEventListener("click",action);
    return node;
  }
  class Review {
    constructor(tape,match,menus,back,requestFrame) {
      this.tape = tape;
      this.playing = false;
      this.last = null;
      this.time = 0;
      this.requestFrame = requestFrame;
      const shell = element("section","tape");
      const heading = element("div","tape-heading");
      this.score = element("strong");
      heading.append(element("span","friend","● " + TEAMS[0]),this.score,element("span","foe",TEAMS[1] + " ◆"));
      const chart = element("canvas","tape-chart");
      chart.width = 828; chart.height = 438;
      chart.setAttribute("role","img");
      chart.setAttribute("aria-label","Overhead routes. Numbers identify runners in each crew. The gold ring marks you.");
      this.radar = new Radar(chart);
      const crews = element("div","tape-crews");
      this.health = match.actors.map(a => {
        const row = element("div",a.team ? "tape-runner foe" : "tape-runner friend"), hp = element("small");
        row.append(element("b","",String(a.id%3+1)),element("span","",a.name),hp);
        crews.append(row);
        return hp;
      });
      this.play = button("Play",() => {
        if (!this.playing && this.time >= tape.duration) this.seek(0);
        this.setPlaying(!this.playing);
      });
      this.prev = button("Previous play",() => this.jump(this.scene.previous));
      this.next = button("Next play",() => this.jump(this.scene.next));
      this.clock = element("span","tape-clock");
      const transport = element("div","tape-transport");
      transport.append(this.play,this.prev,this.next,this.clock);
      this.slider = element("input","tape-slider");
      this.slider.type = "range";
      this.slider.min = "0"; this.slider.max = String(tape.duration); this.slider.step = "any";
      this.slider.setAttribute("aria-label","Replay position");
      this.slider.addEventListener("input",() => { this.setPlaying(false); this.seek(Number(this.slider.value)); });
      this.slider.addEventListener("keydown",e => {
        const delta = {ArrowLeft:-1,ArrowRight:1,ArrowDown:-1,ArrowUp:1}[e.key];
        if (!delta) return;
        e.preventDefault();
        this.setPlaying(false);
        this.seek(this.time+delta);
      });
      this.caption = element("p","tape-caption");
      shell.append(heading,chart,crews,this.caption,this.slider,transport);
      menus.modal("Tactical replay",[element("p","sheet-summary",MODES[match.mode].name + " · " + trailTime + " s movement trails"),shell],
        [["Back to result",back]]);
      this.seek(0);
      this.setPlaying(false);
      this.play.disabled = this.slider.disabled = tape.duration <= 0;
      (this.play.disabled ? menus.ui["dialog-actions"].querySelector("button") : this.play).focus({preventScroll:true});
    }
    seek(position) {
      const scene = this.scene = this.tape.read(position);
      this.time = scene.time;
      this.slider.value = String(this.time);
      this.slider.setAttribute("aria-valuetext",stamp(this.time));
      label(this.clock,stamp(this.time) + " / " + stamp(this.tape.duration));
      label(this.score,scene.frame.scores.join(" – "));
      scene.frame.actors.forEach(a => label(this.health[a.id],a.hp ? a.hp + " HP" : "Down"));
      label(this.caption,scene.mark ? stamp(scene.mark.time) + " · " + scene.mark.plays.join(" · ") : "Opening positions");
      this.prev.disabled = !scene.previous;
      this.next.disabled = !scene.next;
      this.radar.paint(scene.frame,scene.trail,scene.mark && this.time-scene.mark.time<1 ? scene.mark : null);
    }
    jump(mark) {
      if (!mark) return;
      this.setPlaying(false);
      this.seek(mark.time);
    }
    setPlaying(on) {
      this.playing = on && this.tape.duration > 0;
      this.last = null;
      label(this.play,this.playing ? "Pause" : "Play");
      this.play.setAttribute("aria-pressed",String(this.playing));
      if (this.playing) this.requestFrame();
    }
    frame(timestamp) {
      if (!this.playing) return;
      if (this.last !== null) this.seek(this.time + Math.min(0.25, Math.max(0,timestamp-this.last)/1000));
      this.last = timestamp;
      if (this.time >= this.tape.duration) this.setPlaying(false);
      else this.requestFrame();
    }
  }
  Slipwake.review = {Review};
})();
