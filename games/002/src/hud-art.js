(() => {
  "use strict";
  const {arena:A, relay:Relay, deck:Deck, signal:Signal, supply:Supply, freight:Freight} = Slipwake;
  const mint = "#83ecd4", coral = "#ff9476", amber = "#ffc473", paper = "#eff1da", violet = "#cdbaff";
  const chartWidth = 276, chartHeight = 146;

  function polygon(ctx, color, points) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
  }
  function line(ctx, color, width, points) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (const [x, y] of points.slice(1)) ctx.lineTo(x, y);
    ctx.stroke();
  }
  function circle(ctx, color, x, y, radius, stroke = 0) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (stroke) { ctx.lineWidth = stroke; ctx.strokeStyle = color; ctx.stroke(); }
    else { ctx.fillStyle = color; ctx.fill(); }
  }
  function paintIcon(canvas, name) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.dataset.icon = name;
    canvas.width = canvas.height = 96;
    ctx.setTransform(3, 0, 0, 3, 0, 0);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    switch (name) {
      case "brand":
        polygon(ctx, amber, [[3,8],[11,2],[29,2],[23,9],[12,9],[8,13]]);
        polygon(ctx, paper, [[8,13],[22,13],[29,8],[25,18],[16,21],[3,21]]);
        polygon(ctx, amber, [[3,24],[17,24],[27,19],[19,29],[8,31]]);
        break;
      case "tide":
        polygon(ctx, mint, [[2,12],[12,7],[28,7],[23,13],[13,13],[5,18]]);
        polygon(ctx, mint, [[4,21],[14,16],[27,16],[21,23],[11,26]]);
        break;
      case "ember":
        polygon(ctx, coral, [[3,23],[12,6],[11,17],[21,3],[18,17],[29,9],[24,23],[14,28]]);
        polygon(ctx, "#623d35", [[11,23],[17,15],[16,22],[21,19],[17,25]]);
        break;
      case "pause":
        ctx.fillStyle = paper; ctx.fillRect(8,6,5,20); ctx.fillRect(19,6,5,20);
        break;
      case "roster":
        for (const y of [8,16,24]) {
          circle(ctx,mint,7,y,2);
          line(ctx,paper,2,[[13,y],[26,y]]);
        }
        break;
      case "play":
        polygon(ctx, paper, [[9,5],[26,16],[9,27]]);
        break;
      case "muted":
      case "sound":
        polygon(ctx, paper, [[3,12],[9,12],[16,6],[16,26],[9,20],[3,20]]);
        if (name === "muted") {
          line(ctx, coral, 2.3, [[21,12],[28,20]]);
          line(ctx, coral, 2.3, [[28,12],[21,20]]);
        } else {
          line(ctx, mint, 2.3, [[20,11],[23,16],[20,21]]);
          line(ctx, mint, 2.3, [[24,7],[29,16],[24,25]]);
        }
        break;
      case "driver":
        polygon(ctx, mint, [[4,20],[18,6],[28,6],[28,12],[14,26],[10,22],[6,26],[3,23],[8,18]]);
        line(ctx, "#284640", 2, [[13,18],[22,9]]);
        line(ctx, paper, 1.5, [[3,16],[10,9]]);
        break;
      case "dash":
        polygon(ctx, amber, [[2,11],[15,11],[20,16],[10,25],[15,17]]);
        polygon(ctx, paper, [[11,6],[20,6],[30,16],[18,26],[23,16]]);
        line(ctx, amber, 2, [[3,21],[8,21]]);
        break;
      case "pulse":
        circle(ctx, "#a6ded4", 16, 16, 12, 1.5);
        circle(ctx, mint, 16, 16, 8, 1.4);
        polygon(ctx, paper, [[16,5],[18,13],[26,16],[18,18],[16,27],[14,19],[6,16],[14,14]]);
        break;
      case "fork":
        for (const [x,y] of [[14,4],[23,6],[28,15]]) {
          line(ctx, amber, 2.5, [[6,26],[x,y]]);
          circle(ctx, paper, x, y, 2);
        }
        break;
      case "patch":
        circle(ctx, mint, 16, 16, 11, 2);
        line(ctx, mint, 4, [[16,9],[16,23]]);
        line(ctx, paper, 4, [[9,16],[23,16]]);
        break;
      case "net":
        line(ctx, "#add9ff", 2.3, [[4,9],[16,4],[28,9],[25,22],[16,29],[7,22],[4,9],[16,14],[28,9]]);
        line(ctx, paper, 1.8, [[16,14],[16,26]]);
        break;
      case "bank":
        line(ctx, paper, 2.4, [[3,6],[3,21]]);
        line(ctx, amber, 2.7, [[16,27],[6,15],[24,8]]);
        polygon(ctx, amber, [[20,5],[30,5],[25,15]]);
        break;
      case "haul":
        line(ctx, mint, 2.8, [[3,27],[19,11],[15,7],[24,4],[28,9],[25,18],[21,15]]);
        line(ctx, paper, 1.5, [[8,28],[20,16]]);
        break;
      case "skirmish":
        for (const x of [7,15,23]) polygon(ctx,mint,[[x-4,24],[x+2,7],[x+6,7],[x+1,24]]);
        break;
      case "relay":
        polygon(ctx,amber,[[16,2],[24,10],[24,20],[16,29],[8,20],[8,10]]);
        line(ctx,"#735638",2,[[9,13],[16,16],[23,13]]);
        break;
      case "signal":
        circle(ctx,violet,16,21,2.6);
        for (const r of [8,13]) {
          ctx.beginPath(); ctx.strokeStyle=violet; ctx.lineWidth=2.5;
          ctx.arc(16,21,r,Math.PI*1.15,Math.PI*1.85); ctx.stroke();
        }
        break;
      case "freight":
        polygon(ctx,amber,[[3,9],[28,9],[24,21],[8,21]]);
        line(ctx,"#615339",2,[[10,13],[21,13]]);
        for (const x of [10,22]) circle(ctx,paper,x,24,2.6);
        line(ctx,mint,2,[[3,29],[28,29]]);
        break;
      case "vane":
        line(ctx,violet,3,[[4,9],[20,9],[26,16],[20,23],[9,23]]);
        polygon(ctx,paper,[[4,23],[14,16],[14,29]]);
        break;
    }
  }

  class Radar {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      if (!this.ctx) return;
      this.plate = document.createElement("canvas");
      this.plate.width = canvas.width;
      this.plate.height = canvas.height;
      const ctx = this.plate.getContext("2d");
      if (!ctx) { this.ctx=null; return; }
      const w = chartWidth, h = chartHeight;
      for (const surface of [this.ctx,ctx]) surface.setTransform(canvas.width/w,0,0,canvas.height/h,0,0);
      this.sx = (w - 18) / (2 * A.halfW);
      this.sz = (h - 14) / (2 * A.halfD);
      ctx.fillStyle = "#172d32";
      ctx.fillRect(0, 0, w, h);
      for (let x = -12; x <= 12; x += 3) line(ctx, "#284145", 1, [[this.x(x),7],[this.x(x),h-7]]);
      for (let z = -6; z <= 6; z += 3) line(ctx, "#284145", 1, [[9,this.z(z)],[w-9,this.z(z)]]);
      ctx.strokeStyle = "#657e79";
      ctx.lineWidth = 1.4;
      ctx.strokeRect(9, 7, w-18, h-14);
      circle(ctx, "#657e79", w/2, h/2, 2*this.sz, 1.4);
      ctx.fillStyle = "#647a77";
      for (const b of A.blocks) ctx.fillRect(this.x(b.x-b.w/2),this.z(b.z-b.d/2),b.w*this.sx,b.d*this.sz);
      line(ctx, mint, 2.5, [[9,this.z(-2)],[9,this.z(2)]]);
      line(ctx, coral, 2.5, [[w-9,this.z(-2)],[w-9,this.z(2)]]);
    }
    x(v) { return chartWidth/2 + v*this.sx; }
    z(v) { return chartHeight/2 + v*this.sz; }
    trails(frames) {
      for (let i=1;i<frames.length;i++) {
        const alpha=0.2+0.65*i/frames.length;
        for (const a of frames[i].actors) {
          const before=frames[i-1].actors[a.id];
          if (!a.hp || !before.hp || before.deaths!==a.deaths) continue;
          const ink=(a.team ? "rgba(255,148,118," : "rgba(131,236,212,")+alpha+")";
          line(this.ctx,ink,1.55,[[this.x(before.x),this.z(before.z)],[this.x(a.x),this.z(a.z)]]);
        }
      }
    }
    paint(match,trail,highlight) {
      const ctx = this.ctx;
      if (!ctx) return;
      ctx.drawImage(this.plate, 0, 0, chartWidth, chartHeight);
      if (trail) this.trails(trail);
      if (match.freight) {
        const cart=match.freight, r=Freight.RULES.terminal, x=this.x(cart.x), y=this.z(cart.z);
        for (const offset of [-2,2]) line(ctx,"#939d8d",1,[[this.x(-r),y+offset],[this.x(r),y+offset]]);
        for (const side of [-1,1]) line(ctx,side>0 ? mint : coral,2.5,[[this.x(side*r),y-5],[this.x(side*r),y+5]]);
        const color=[mint,coral][cart.owner] || amber;
        circle(ctx,color,x,y,Freight.RULES.radius*this.sz,1.3);
        if (cart.contested) {
          ctx.beginPath(); ctx.strokeStyle=coral; ctx.arc(x,y,Freight.RULES.radius*this.sz,0,Math.PI); ctx.stroke();
        }
        ctx.fillStyle=color; ctx.fillRect(x-5.5,y-3.5,11,7);
      }
      if (match.signal) {
        const signal=match.signal, radius=Signal.RULES.radius*this.sz;
        Signal.stations.forEach((site,i)=>{
          const x=this.x(site.x), y=this.z(site.z);
          if (i===signal.station) {
            const color=[mint,coral][signal.owner] || violet;
            circle(ctx,color,x,y,radius,3);
            if (signal.contested) {
              ctx.beginPath(); ctx.strokeStyle=coral; ctx.lineWidth=3;
              ctx.arc(x,y,radius,0,Math.PI); ctx.stroke();
            }
          } else if (signal.remaining<=Signal.RULES.previewTime && i===Signal.nextStation(signal)) {
            circle(ctx,violet,x,y,radius,1.5);
          } else circle(ctx,"#9a9da9",x,y,2.5);
        });
      }
      if (match.relay) Relay.gates.forEach((gate,i) => {
        circle(ctx,i ? coral : mint,this.x(gate.x),this.z(gate.z),Relay.RULES.gateRadius*this.sz,2.4);
      });
      if (match.net) circle(ctx,"#add9ff",this.x(match.net.x),this.z(match.net.z),Deck.RULES.netRadius*this.sz,2);
      if (match.supply.state!=="waiting") {
        const site=Supply.sites[match.supply.site], x=this.x(site.x), y=this.z(site.z);
        const ink=match.supply.contested ? amber : "#b3e2ff";
        ctx.strokeStyle=ink;
        ctx.lineWidth=match.supply.state==="incoming" ? 1.3 : 2.5;
        ctx.strokeRect(x-6,y-6,12,12);
        line(ctx,ink,2,[[x-3,y],[x+3,y]]);
        line(ctx,ink,2,[[x,y-3],[x,y+3]]);
      }
      for (const a of match.actors) {
        if (!a.hp) continue;
        const x = this.x(a.x), y = this.z(a.z);
        if (a.team) polygon(ctx, coral, [[x,y-5.4],[x+5.4,y],[x,y+5.4],[x-5.4,y]]);
        else circle(ctx, mint, x, y, 4.5);
        if (trail) {
          ctx.fillStyle="#172b2e"; ctx.font="bold 6px sans-serif";
          ctx.textAlign="center"; ctx.textBaseline="middle";
          ctx.fillText(String(a.id%3+1),x,y+0.3);
        }
        if (a.vaneLeft>0) circle(ctx,violet,x,y,8.8,1.7);
        if (a.id===match.focus?.target) {
          for (const sign of [-1,1]) {
            line(ctx,amber,2,[[x+sign*5,y-8],[x+sign*9,y-8],[x+sign*9,y+8],[x+sign*5,y+8]]);
          }
        }
        if (a.id === 0) {
          circle(ctx, amber, x, y, 7.3, 2);
          line(ctx, amber, 2, [[x+Math.sin(a.yaw)*7,y+Math.cos(a.yaw)*7],
            [x+Math.sin(a.yaw)*12,y+Math.cos(a.yaw)*12]]);
        }
      }
      if (match.rally) {
        const x=this.x(match.rally.x), y=this.z(match.rally.z);
        line(ctx,paper,2,[[x,y+2],[x,y-12]]);
        polygon(ctx,mint,[[x,y-12],[x+10,y-8],[x,y-5]]);
      }
      if (match.relay) {
        const core=match.relay, x=this.x(core.x), y=this.z(core.z)-(core.carrier===null ? 0 : 8);
        if (core.flight) line(ctx,amber,2,[[x,y],[x-core.flight.dx*9,y-core.flight.dz*9]]);
        circle(ctx,"#262b29",x,y,6.8);
        polygon(ctx,amber,[[x,y-5.7],[x+4.8,y-2.5],[x+4.8,y+2.5],[x,y+5.7],[x-4.8,y+2.5],[x-4.8,y-2.5]]);
      }
      if (highlight) {
        const x=this.x(highlight.x), y=this.z(highlight.z);
        for (const sign of [-1,1]) {
          line(ctx,paper,1.3,[[x+sign*6,y-9],[x+sign*10,y-9],[x+sign*10,y-5]]);
          line(ctx,paper,1.3,[[x+sign*6,y+9],[x+sign*10,y+9],[x+sign*10,y+5]]);
        }
      }
    }
  }

  Slipwake.hudArt = {paintIcon, Radar};
})();
