(function () {
  'use strict';
  const {math, sim} = PocketPlaces;

  function attach(canvas, input) {
    const pointers=new Map();
    let dragged=false, pinchSpan=0;
    function span() {
      const [a,b]=pointers.values();
      return Math.hypot(a.x-b.x,a.y-b.y);
    }
    function releaseCapture(id) {
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
    function cancel() {
      const captured=[...pointers.keys()];
      pointers.clear(); pinchSpan=0; dragged=false;
      for (const id of captured) releaseCapture(id);
      canvas.dataset.dragging='false'; input.clearHover();
    }
    canvas.addEventListener('pointerdown',event=>{
      if (!input.available() || event.button!==0 || pointers.size>=2) return;
      const x=event.clientX, y=event.clientY;
      pointers.set(event.pointerId,{x,y,start:{x,y}});
      canvas.focus({preventScroll:true});
      canvas.setPointerCapture(event.pointerId);
      input.clearHover();
      if (pointers.size===2) {
        pinchSpan=span(); dragged=true; input.startPinch();
      }
    });
    function move(p,x,y) {
      if (x===p.x && y===p.y) return;
      // Include the movement before the threshold, even if it arrived in tiny events.
      const dx=x-(dragged ? p.x : p.start.x), dy=y-(dragged ? p.y : p.start.y);
      p.x=x; p.y=y;
      if (pointers.size===2) {
        const next=span();
        if (pinchSpan>1 && next>1) input.zoom(next/pinchSpan);
        pinchSpan=next;
      } else if (dragged || sim.moved(p.start,p)) {
        dragged=true; input.rotate(dx,dy);
      }
      if (dragged) canvas.dataset.dragging='true';
    }
    canvas.addEventListener('pointermove',event=>{
      if (!input.available()) return;
      const p=pointers.get(event.pointerId);
      if (p) move(p,event.clientX,event.clientY);
      else if (!pointers.size && event.pointerType==='mouse') input.hover(event.clientX,event.clientY);
    });
    function release(event,cancelled) {
      const p=pointers.get(event.pointerId);
      if (!p) return;
      const end={x:event.clientX,y:event.clientY};
      // A device can deliver its final drag or pinch distance only on pointerup.
      if (!cancelled) move(p,end.x,end.y);
      const tap=!cancelled && pointers.size===1 && !dragged && !sim.moved(p.start,end);
      pointers.delete(event.pointerId); pinchSpan=0;
      releaseCapture(event.pointerId);
      if (!pointers.size) { dragged=false; canvas.dataset.dragging='false'; }
      if (tap) input.tap(end.x,end.y);
    }
    canvas.addEventListener('pointerup',e=>release(e,false));
    canvas.addEventListener('pointercancel',e=>release(e,true));
    canvas.addEventListener('lostpointercapture',e=>release(e,true));
    canvas.addEventListener('pointerleave',input.clearHover);
    window.addEventListener('blur',cancel);
    canvas.addEventListener('wheel',e=>{
      if (!input.available()) return;
      e.preventDefault();
      const units=e.deltaMode===1 ? 16 : e.deltaMode===2 ? canvas.getBoundingClientRect().height : 1;
      input.zoom(Math.exp(math.clamp(-e.deltaY*units*.0015,-.7,.7)));
    },{passive:false});
    return {cancel};
  }
  PocketPlaces.gestures={attach};
})();
