'use strict';
const assert=require('node:assert/strict');
const {page}=require('./page.js');
const {wrapAngle}=require('../../src/math.js');

function running(options) {
  const h=page(options).boot();
  h.settle();
  assert.equal(h.errors.length,0);
  assert.equal(h.id('unavailable').hidden,true);
  return h;
}
function advance(h,count) { for (let i=0; i<count; i++) h.tick(); }
function groundPosition(h) { const [x,,z]=h.uniform('uEye'); return [x,z]; }
function selectInGuide(h,place) {
  const dialog=h.id('guide-dialog');
  if (!dialog.open) h.key('KeyM');
  const button=dialog.querySelector('.guide-list').children.find(b=>b.dataset.place===place.id);
  button.emit('click');
  return button;
}
// Steer only from the compass arrow the walker can see. The normal mouse,
// damping, collision and arrival handlers all stay in the loop.
function walkToCue(h, arrived) {
  const yaw=()=>{
    const [x,,z]=h.uniform('uForward');
    return Math.atan2(x,-z);
  };
  let aim=yaw();
  h.key('KeyW');
  for (let frame=0; frame<2400 && !arrived(); frame++) {
    if (frame%4===0) {
      const cue=parseFloat(h.id('route-arrow').style.transform.slice('rotate('.length));
      const target=wrapAngle(yaw()+cue);
      h.doc.emit('mousemove',{movementX:wrapAngle(target-aim)/.00235,movementY:0});
      aim=target;
    }
    h.tick();
  }
  h.up('KeyW'); h.key('Escape'); h.settle();
  assert.ok(arrived(),'the displayed turn cues lead to the destination');
}
module.exports={running,advance,groundPosition,selectInGuide,walkToCue};
