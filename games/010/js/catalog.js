/* The illustrated index, printed slip and pins share one set of object IDs. */
(function () {
  'use strict';
  const {math, sim, prints} = PocketPlaces;
  const number = n => String(n).padStart(2,'0');
  const byId = id => document.getElementById(id);
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function mount(notes, inspect, visibleFromSeat, room) {
    const cards = [], markers = [];
    for (const [i,note] of notes.entries()) {
      const card = element('button','object-card');
      card.type = 'button';
      card.setAttribute('aria-label','Inspect '+note.title+(note.action ? '. '+note.action : ''));
      const miniature = element('canvas','');
      miniature.setAttribute('aria-hidden','true');
      prints.paint(miniature,note.id,true);
      const name = element('span','index-label');
      name.append(element('span','index-number',number(note.id)),element('span','index-name',note.short));
      if (note.action) name.append(element('span','index-action',note.action));
      card.append(miniature,name);
      card.addEventListener('click',()=>inspect(i));
      byId('object-list').append(card);
      cards.push(card);

      const marker = element('button','marker');
      marker.type = 'button'; marker.hidden = true; marker.title = note.title;
      marker.setAttribute('aria-label','Inspect '+note.title+' in the scene');
      marker.append(element('b','',number(note.id)));
      marker.addEventListener('click',()=>inspect(i,true));
      byId('markers').append(marker);
      markers.push(marker);
    }
    byId('note-total').textContent = number(notes.length);
    function illustrate(index) { prints.paint(byId('portrait'),notes[index].id,false,room); }
    function show(index) {
      const note = notes[index], caption = '“'+note.caption+'”';
      byId('note-chinese').textContent = note.chinese;
      byId('note-title').textContent = byId('field-title').textContent = note.title;
      byId('caption').textContent = byId('field-caption').textContent = caption;
      byId('note-number').textContent = number(note.id);
      illustrate(index);
      for (let i=0;i<notes.length;i++) {
        cards[i].setAttribute('aria-pressed',String(i===index));
        markers[i].setAttribute('aria-pressed',String(i===index));
      }
    }
    function position(camera,width,height,selected,allPins) {
      for (const [i,marker] of markers.entries()) {
        const note=notes[i];
        const point=camera?.seated ? note.seatedAnchor || note.closeup.center : note.anchor;
        let visible = Boolean(camera && (allPins || i===selected));
        if (visible) {
          const p = math.project(point,camera.matrix,width,height);
          const towardEye=camera.seated ? math.sub(camera.eye,point) : camera.direction;
          visible = p.x>=6 && p.x<=width-15 && p.y>=31 && p.y<=height-2 &&
            p.depth>=-1 && p.depth<=1 && sim.exposed(point,towardEye,camera.seated ? 1 : Infinity) &&
            (!camera.seated || visibleFromSeat(camera.eye,point,note.id));
          if (visible) {
            const move = 'translate('+Math.round(p.x-8)+'px,'+Math.round(p.y-40)+'px)';
            if (marker.style.transform!==move) marker.style.transform=move;
          }
        }
        const hidden=!visible;
        if (marker.hidden!==hidden) marker.hidden=hidden;
      }
    }
    return {show, illustrate, position, cards, markers};
  }
  PocketPlaces.catalog = {mount};
})();
