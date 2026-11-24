(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./map.js'),require('./walks.js'),require('./navigation.js'),require('./notebook.js'),require('./photo-studies.js'));
  else root.Atlas.GuideSections = factory(root.Atlas.map,root.Atlas.walks,root.Atlas.navigation,root.Atlas.notebook,root.Atlas.studies);
})(globalThis, function (map, walks, navigation, notebook, studies) {
  'use strict';
  const panels = ['places','walks','studies'];

  function illustrate(canvas, place) {
    const ctx=canvas.getContext('2d');
    const {ink,strokes}=place.stamp;
    ctx.fillStyle=ink;
    ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();
    ctx.translate(canvas.width/2,canvas.height*.49);
    const scale=canvas.height*.44;
    ctx.scale(scale,-scale);
    ctx.strokeStyle='#ffeed0';
    ctx.lineWidth=.07;
    ctx.lineJoin=ctx.lineCap='round';
    for (const line of strokes) {
      ctx.beginPath();
      ctx.moveTo(...line[0]);
      for (const p of line.slice(1)) ctx.lineTo(...p);
      ctx.stroke();
    }
    ctx.restore();
  }
  return class GuideSections {
    constructor(doc, world, state, directions, actions) {
      this.doc=doc;
      this.el=id=>doc.getElementById(id);
      this.state=state;
      this.directions=directions;
      this.places=world.places;
      this.actions=actions;
      this.active='places';
      this.walk=walks.catalogue[0];
      this.map=new map.CampusMap(this.el('walks-map'),world,true);
      this.choices=walks.catalogue.map(walk=>{
        const button=doc.createElement('button');
        button.type='button';
        button.textContent=walk.name;
        button.addEventListener('click',()=>this.selectWalk(walk));
        this.el('walk-choices').append(button);
        return button;
      });
      this.el('take-walk').addEventListener('click',()=>actions.takeWalk(this.walk));
      panels.forEach((name,i)=>{
        const button=this.el('tab-'+name);
        button.addEventListener('click',()=>this.show(name));
        button.addEventListener('keydown',e=>{
          const target={ArrowRight:(i+1)%3,ArrowLeft:(i+2)%3,Home:0,End:2}[e.key];
          if (target === undefined || e.altKey || e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          this.show(panels[target]);
          this.el('tab-'+panels[target]).focus();
        });
      });
      const lookouts=world.places.filter(place=>place.study);
      this.album=new notebook.Collection(lookouts,()=>doc.defaultView.localStorage,studies.PREFIX);
      this.cards=new Map(lookouts.map(place=>[place.id,this.studyCard(place)]));
      this.refreshStudies();
      doc.defaultView.addEventListener('storage',event=>{
        if (event.key !== null && !event.key?.startsWith(studies.PREFIX)) return;
        this.album.read();
        this.refreshStudies();
      });
    }
    show(name) {
      this.active=name;
      for (const panel of panels) {
        const selected=panel===name, tab=this.el('tab-'+panel);
        this.el('page-'+panel).hidden=!selected;
        tab.setAttribute('aria-selected',String(selected));
        tab.tabIndex=selected ? 0 : -1;
      }
      this.el('stamp-count').hidden=name!=='places';
      this.el('study-count').hidden=name!=='studies';
      if (name==='walks') this.selectWalk(this.directions.walk || this.walk);
      this.actions.invalidate();
    }
    selectWalk(walk) {
      this.walk=walk;
      const {directions,state}=this, here=[state.x,state.z], active=directions.walk===walk;
      this.choices.forEach((button,i)=>button.setAttribute('aria-pressed',String(walks.catalogue[i]===walk)));
      this.el('itinerary-name').textContent=walk.name;
      this.el('itinerary-intro').textContent=walk.intro;
      this.markers=walk.stops.map(({id})=>{
        const place=this.places.find(p=>p.id===id);
        return {id,name:place.name,point:place.view.slice(0,2)};
      });
      const list=this.el('itinerary-stops');
      list.replaceChildren();
      this.markers.forEach((marker,i)=>{
        const item=this.doc.createElement('li');
        item.textContent=marker.name;
        if (active && i===directions.index) item.setAttribute('aria-current','step');
        list.append(item);
      });
      this.preview=directions.preview(here,walk);
      const button=this.el('take-walk');
      button.textContent=active ? 'End guided walk' : 'Start guided walk';
      button.disabled=!active && !this.preview;
      const length=this.preview ? Math.ceil(navigation.lengthFrom(here,this.preview)) : null;
      this.el('walk-length').textContent=length===null ? 'No walking route from here' :
        walk.stops.length+' stops · '+length+' m '+(active ? 'remaining' : 'from here');
      this.draw();
    }
    draw() {
      if (this.active==='walks') {
        const current=this.directions.walk===this.walk ? this.directions.index : 0;
        this.map.draw(this.state,this.markers[current].id,this.preview,this.markers);
      }
    }
    studyCard(place) {
      const doc=this.doc, row=doc.createElement('article'), art=doc.createElement('canvas');
      art.width=160; art.height=112; art.setAttribute('aria-hidden','true');
      illustrate(art,place);
      const copy=doc.createElement('div'), heading=doc.createElement('h3'), brief=doc.createElement('p');
      const label=doc.createElement('small'), button=doc.createElement('button');
      heading.textContent=place.study.name;
      brief.textContent=place.study.brief;
      button.type='button';
      button.textContent='Frame from lookout';
      button.setAttribute('aria-label','Frame from the '+place.name+' lookout');
      button.addEventListener('click',()=>this.actions.frame(place));
      copy.append(label,heading,brief,button);
      row.append(art,copy);
      this.el('study-list').append(row);
      return {art,label,place,hasPrint:false};
    }
    refreshStudies() {
      const count=this.album.entries.size;
      this.el('study-count').textContent=count+' of '+this.cards.size+' studies recorded'+(count && !this.album.saved ? ' · this visit' : '');
      for (const card of this.cards.values()) {
        const recorded=this.album.entries.has(card.place.id);
        card.label.textContent=card.place.name+(recorded ? ' · Recorded' : '');
        if (!recorded && card.hasPrint) {
          illustrate(card.art,card.place);
          card.hasPrint=false;
        }
      }
    }
    record(place, sheet, frame) {
      const card=this.cards.get(place.id);
      const {art}=card;
      this.album.collect(place.id);
      try {
        // Crop from the exposed print. Its image survives even after WebGL
        // gives its drawing buffer back to the compositor.
        const scale=Math.max(art.width/frame.w,art.height/frame.h);
        const w=art.width/scale, h=art.height/scale;
        art.getContext('2d').drawImage(sheet,frame.x+(frame.w-w)/2,frame.y+(frame.h-h)/2,w,h,0,0,art.width,art.height);
        card.hasPrint=true;
      } catch { /* The full postcard is already exposed and can still be saved. */ }
      this.refreshStudies();
      return place.study.name+' · recorded'+(this.album.saved ? '' : ' this visit');
    }
  };
});
