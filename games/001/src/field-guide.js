(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./map.js'), require('./simulation.js'), require('./navigation.js'), require('./notebook.js'),require('./walks.js'),require('./guide-sections.js'));
  else root.Atlas.FieldGuide = factory(root.Atlas.map, root.Atlas.sim, root.Atlas.navigation, root.Atlas.notebook,root.Atlas.walks,root.Atlas.GuideSections);
})(globalThis, function (map, sim, navigation, notebook, walks, GuideSections) {
  'use strict';
  function drawStamp(canvas, stamp, collected) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.save();
    ctx.translate(canvas.width/2,canvas.height/2);
    ctx.scale(canvas.width/2,-canvas.height/2);
    ctx.beginPath();
    ctx.arc(0,0,.94,0,2*Math.PI);
    ctx.fillStyle = collected ? stamp.ink : '#ede9db';
    ctx.fill();
    ctx.lineWidth = .045;
    ctx.strokeStyle = collected ? '#fff1cb' : '#a39d87';
    ctx.beginPath();
    ctx.arc(0,0,.80,0,2*Math.PI);
    ctx.stroke();
    ctx.scale(.70,.70);
    ctx.strokeStyle = collected ? '#fff1cb' : '#6d7567';
    ctx.lineWidth = .11;
    ctx.lineJoin = ctx.lineCap = 'round';
    for (const stroke of stamp.strokes) {
      ctx.beginPath();
      ctx.moveTo(...stroke[0]);
      for (const point of stroke.slice(1)) ctx.lineTo(...point);
      ctx.stroke();
    }
    ctx.restore();
  }
  return class FieldGuide {
    constructor(doc, world, state, actions) {
      this.el = id => doc.getElementById(id);
      this.world = world;
      this.state = state;
      this.actions = actions;
      this.dialog = this.el('guide-dialog');
      this.list = this.dialog.querySelector('.guide-list');
      this.mini = new map.CampusMap(this.el('mini-map'), world);
      this.map = new map.CampusMap(this.el('guide-map'), world, true);
      this.directions = new walks.Directions(world);
      this.book = new notebook.Notebook(world.places, () => doc.defaultView.localStorage);
      this.sections = new GuideSections(doc,world,state,this.directions,{
        takeWalk: walk=>this.takeWalk(walk), invalidate:actions.invalidate,
        frame: place=>{
          this.clearRoute();
          this.dialog.close();
          actions.frame(place);
        }
      });
      this.entries = world.places.map((place, index) => {
        const button = doc.createElement('button'), art = doc.createElement('canvas');
        const number = doc.createElement('b'), name = doc.createElement('span');
        button.type = 'button';
        button.className = 'place-button';
        button.dataset.place = place.id;
        art.width = art.height = 80;
        art.setAttribute('aria-hidden','true');
        number.textContent = String(index+1).padStart(2,'0');
        name.textContent = place.name;
        button.append(number, name, art);
        button.addEventListener('click', () => this.select(place));
        this.list.append(button);
        return {place, button, art};
      });
      this.refreshBook();
      this.el('guide-map').addEventListener('click', event => {
        const place = this.map.pick(event.clientX, event.clientY);
        if (place) this.select(place);
      });
      this.el('follow-route').addEventListener('click', () => this.follow());
      this.el('end-route').addEventListener('click', () => this.cancel());
      this.el('next-stop').addEventListener('click', () => this.advance());
      this.el('stamp').addEventListener('click', () => this.collect());
      this.el('travel').addEventListener('click', () => {
        this.clearRoute();
        this.dialog.close();
        actions.travel(this.selected);
      });
      doc.defaultView.addEventListener('storage', event => {
        if (event.key !== null && !event.key?.startsWith(notebook.PREFIX)) return;
        this.book.read();
        this.refreshBook();
        if (this.dialog.open) this.detail();
        actions.invalidate();
      });
    }
    position() { return [this.state.x, this.state.z]; }
    near() { return notebook.pressAt(this.state.x, this.state.z, this.world); }
    refreshBook() {
      const count = this.book.stamps.size, total = this.entries.length;
      const scope = count && !this.book.saved ? ' · this visit' : '';
      this.el('stamp-count').textContent = count+' of '+total+' stamps'+scope;
      for (const {place, button, art} of this.entries) {
        const collected = this.book.stamps.has(place.id);
        button.dataset.stamped = String(collected);
        button.setAttribute('aria-label',place.name+(collected ? ', stamped' : ', unstamped'));
        drawStamp(art, place.stamp, collected);
      }
    }
    open(current) {
      this.dialog.showModal();
      this.sections.show(this.directions.walk ? 'walks' : 'places');
      this.select(this.directions.place || current);
      if (this.directions.walk) this.el('tab-walks').focus();
      else this.entries.find(entry => entry.place === this.selected).button.focus();
    }
    select(place) {
      this.selected = place;
      for (const entry of this.entries) entry.button.setAttribute('aria-pressed', String(entry.place === place));
      this.preview = this.directions.planner.find(this.position(), place.stamp.at);
      this.detail();
      if (this.sections.active === 'places') this.map.draw(this.state, place.id, this.preview);
    }
    detail() {
      const place = this.selected, collected = this.book.stamps.has(place.id);
      this.el('selected-name').textContent = place.name;
      this.el('selected-note').textContent = place.guide;
      this.el('stamp-title').textContent = place.stamp.title;
      this.el('field-note').textContent = collected ? place.stamp.note : 'Stamp your notebook here to reveal the field note.';
      drawStamp(this.el('stamp-art'),place.stamp,collected);
      const near = this.near() === place;
      let action = 'Route to press', metres = '';
      if (near) action = collected ? 'Stamp collected' : 'Stamp notebook';
      else if (!this.directions.walk && this.directions.place === place) action = 'End route';
      else if (!this.preview) action = 'No walking route';
      else metres = Math.ceil(navigation.lengthFrom(this.position(),this.preview))+' m';
      this.el('route-action').textContent = action;
      this.el('route-distance').textContent = metres;
      this.el('route-distance').hidden = !metres;
      this.el('follow-route').disabled = near ? collected : !this.preview && action !== 'End route';
    }
    follow() {
      if (this.near() === this.selected) { this.collect(); return; }
      if (!this.directions.walk && this.directions.place === this.selected) { this.cancel(); return; }
      if (!this.preview) return;
      this.directions.toPress(this.position(),this.selected,this.preview);
      this.dialog.close();
      this.actions.walk();
    }
    takeWalk(walk) {
      if (this.directions.walk === walk) { this.cancel(); return; }
      if (!this.directions.toStop(this.position(),walk,0)) {
        this.actions.notify('No walking route from here');
        return;
      }
      this.dialog.close();
      this.actions.walk();
    }
    advance() {
      const tour=this.directions.walk;
      if (!tour || !this.directions.arrived) return;
      if (!this.directions.advance(this.position())) this.actions.notify('No walking route to the next stop from here');
      else if (!this.directions.leg) this.actions.notify(tour.name+' complete · '+tour.stops.length+' stops visited');
      else this.actions.walk();
      this.actions.invalidate();
    }
    clearRoute() {
      this.directions.clear();
      this.el('route-card').hidden = true;
    }
    cancel() {
      if (!this.directions.leg) return;
      this.clearRoute();
      if (this.dialog.open) {
        this.detail();
        if (this.sections.active==='walks') this.sections.selectWalk(this.sections.walk);
      }
      this.actions.notify('Walking route ended');
      this.actions.invalidate();
    }
    collect() {
      const place = this.near();
      if (!place || !this.book.collect(place.id)) return;
      if (!this.directions.walk && this.directions.place === place) this.clearRoute();
      this.refreshBook();
      if (this.dialog.open) this.detail();
      this.el('stamp').hidden = true;
      this.actions.notify(this.book.stamps.size === this.entries.length ?
        'Notebook complete · all '+this.entries.length+' campus stamps collected' : place.stamp.title+' stamped in your notebook');
      this.actions.invalidate();
    }
    updateRoute(near) {
      const d=this.directions, place=d.place, here=this.position();
      const event=d.update(here,near);
      if (event && this.dialog.open && this.sections.active==='walks') this.sections.selectWalk(this.sections.walk);
      this.el('route-card').hidden=!d.leg;
      if (event==='press' || event==='lost') {
        this.actions.notify(event==='press' ? 'At the '+place.name+' stamp press' : 'No walking route from here');
        if (this.dialog.open) this.detail();
      }
      if (!d.leg) return;
      const progress=this.el('walk-progress');
      progress.hidden=!d.walk;
      if (d.walk) progress.textContent=d.walk.name+' · '+(d.index+1)+' / '+d.walk.stops.length;
      this.el('route-name').textContent=place.name;
      this.el('stop-detail').hidden=!d.arrived;
      let angle;
      if (d.arrived) {
        angle=place.view[2];
        this.el('route-cue').textContent='Look '+sim.bearing(angle).label;
        this.el('stop-note').textContent=d.stop.note;
        this.el('next-label').textContent=d.last ? 'Finish walk' : 'Next stop';
        if (event==='stop') this.actions.notify('Reached '+place.name);
      } else {
        const next=d.leg.points[0];
        angle=Math.atan2(next[0]-here[0],here[1]-next[1]);
        const metres=Math.ceil(navigation.lengthFrom(here,d.leg.points));
        this.el('route-cue').textContent=sim.bearing(angle).label+' · '+metres+(d.walk ? ' m to lookout' : ' m to press');
      }
      this.el('route-arrow').style.transform='rotate('+(angle-this.state.yaw)+'rad)';
    }
    update(currentId) {
      const near=this.near(), d=this.directions;
      this.el('stamp').hidden=!near || this.book.stamps.has(near.id);
      if (near) this.el('stamp').setAttribute('aria-label','Stamp notebook at '+near.name);
      this.updateRoute(near);
      this.mini.draw(this.state,d.place?.id || currentId,d.arrived ? null : d.leg?.points);
      if (this.dialog.open) {
        if (this.sections.active==='places') this.map.draw(this.state,this.selected.id,this.preview);
        else this.sections.draw();
      }
    }
  };
});
