'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const tea=require('../js/tea'), sim=require('../js/simulation'), {steam,notes}=require('../js/world');
const {openPage,key,ticks,surface}=require('./support/page');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,a+' vs '+b);

test('all four-measure combinations serve exactly the advertised recipes in any pour order',()=>{
  for (const [r,recipe] of tea.recipes.entries()) {
    assert.equal(recipe.tea+recipe.milk,tea.capacity);
    for (let bits=0;bits<2**tea.capacity;bits++) {
      let order=tea.fresh(r);
      for (let i=0;i<tea.capacity;i++) {
        assert.equal(tea.serve(order),order); assert.equal(tea.next(order),order);
        const previous=order;
        order=tea.pour(order,bits & 1<<i ? 'milk' : 'tea');
        assert.equal(previous.pours.length,i);
      }
      const result=tea.serve(order);
      const expected=order.pours.filter(s=>s==='milk').length===recipe.milk;
      assert.equal(result.served,expected);
      assert.equal(tea.pour(order,'tea'),order);
      if (expected) {
        assert.equal(tea.serve(result),result); assert.equal(tea.undo(result),result);
        assert.equal(tea.pour(result,'milk'),result);
        assert.deepEqual(tea.next(result),tea.fresh((r+1)%tea.recipes.length));
      } else assert.equal(result,order);
    }
  }
});

test('undo returns the last ingredient, leaves previous orders intact and stops at an empty cup',()=>{
  const empty=tea.fresh();
  for (const ingredient of ['water','constructor',null,0]) assert.equal(tea.pour(empty,ingredient),empty);
  assert.equal(tea.undo(empty),empty);
  const black=tea.pour(empty,'tea'), mixed=tea.pour(black,'milk');
  assert.deepEqual(tea.undo(mixed),black); assert.deepEqual(tea.undo(black),empty);
  assert.deepEqual(tea.count(mixed),{tea:1,milk:1});
  assert.deepEqual(mixed.pours,['tea','milk']);
});

test('the liquid rises inside the cup and only the hot foreground pour emits steam from that level',()=>{
  const full=tea.appearance(), empty=tea.appearance(tea.fresh());
  assert.equal(full.scale,1); assert.equal(full.drop,0); assert.deepEqual(full.tint,[1,1,1]);
  assert.equal(empty.scale,0); assert.equal(empty.heat,0);
  const state=tea.fresh(), hot=tea.appearance(tea.pour(state,'tea')), cold=tea.appearance(tea.pour(state,'milk'));
  assert.equal(cold.heat,0); assert.ok(hot.heat>0);
  assert.ok(cold.tint.every((channel,i)=>channel>hot.tint[i]));
  let last=empty, order=state;
  for (const ingredient of ['tea','milk','tea','tea']) {
    order=tea.pour(order,ingredient);
    const drink=tea.appearance(order);
    assert.ok(drink.scale>last.scale && drink.scale<=1 && drink.drop>last.drop && drink.drop<=0);
    near(sim.steamPoint(steam[0],1,0,3,1,drink).y,steam[0].y+drink.drop);
    for (const source of steam.slice(1)) {
      assert.deepEqual(sim.steamPoint(source,0,.5,2,.4,drink),sim.steamPoint(source,0,.5,2,.4));
    }
    last=drink;
  }
  assert.deepEqual(last,full);
  for (const u of [0,.5,1]) assert.equal(sim.steamPoint(steam[0],1,u,0,1,cold).alpha,0);
});

test('the tea bench frames the front cup, measures actual ingredients and lets a mistaken order be repaired',()=>{
  const p=openPage({reduced:true}), click=id=>p.$(id).click();
  key(p,'ArrowRight'); ticks(p,90);
  const wide=surface(p).u_camera;
  click('brew-toggle'); p.win.tick();
  assert.equal(p.$('brew-toggle').getAttribute('aria-expanded'),'true');
  assert.equal(p.$('lens').getAttribute('aria-pressed'),'true');
  assert.ok(p.$('brew-serve').disabled && p.$('brew-undo').disabled);
  assert.equal(surface(p).u_liquid[0],0); assert.equal(p.win.frames.size,0);
  const shot=sim.createView(false); sim.focusOn(shot,notes[0].closeup,true);
  assert.deepEqual(surface(p).u_camera,Array.from(sim.camera(shot,810,455).matrix));
  for (let i=0;i<4;i++) click('pour-tea');
  click('pour-milk');
  assert.ok(p.$('pour-tea').disabled && p.$('pour-milk').disabled);
  assert.equal(p.doc.activeElement,p.$('brew-serve')); click('brew-serve');
  assert.match(p.$('brew-status').textContent,/ratio/);
  assert.equal(p.doc.activeElement,p.$('brew-undo')); click('brew-undo'); click('pour-milk');
  assert.deepEqual(p.$('brew-measures').children.map(d=>d.textContent),['tea','tea','tea','milk']);
  click('brew-serve'); p.win.tick();
  assert.equal(p.$('brew-status').textContent,tea.recipes[0].receipt);
  assert.deepEqual(surface(p).u_liquid,[1,0]); assert.deepEqual(surface(p).u_teaTint,[1,1,1]);
  assert.equal(surface(p).u_swirl,0); assert.equal(p.$('brew-serve').textContent,'Next recipe');
  assert.ok(p.$('brew-undo').disabled);
  click('brew-serve');
  assert.equal(p.doc.activeElement,p.$('pour-tea'));
  assert.equal(p.$('brew-name').textContent,tea.recipes[1].name); assert.equal(p.$('brew-count').textContent,'0 / 4');
  click('brew-toggle'); click('lens'); p.win.tick();
  assert.deepEqual(surface(p).u_camera,wide); assert.deepEqual(p.errors,[]);
});

test('tickets and the tea bench can be put down independently, including in the illustrated fallback',()=>{
  const p=openPage({noWebGL:true}), click=id=>p.$(id).click();
  click('ticket-toggle'); p.$('object-list').children[2].click();
  const stamped=()=>p.$('service-stamps').getAttribute('aria-label');
  assert.equal(stamped(),'1 of 3 steps stamped');
  click('brew-toggle'); click('pour-milk');
  assert.ok(p.$('service-ticket').hidden && !p.$('brew-bench').hidden);
  assert.equal(stamped(),'1 of 3 steps stamped','framing the tea does not stamp a ticket');
  click('ticket-toggle'); assert.ok(p.$('brew-bench').hidden);
  click('brew-toggle'); assert.equal(p.$('brew-count').textContent,'1 / 4');
  for (const [i,recipe] of tea.recipes.entries()) {
    for (let n=0;n<recipe.tea;n++) click('pour-tea');
    for (let n=i===0 ? 1 : 0;n<recipe.milk;n++) click('pour-milk');
    click('brew-serve'); assert.equal(p.$('brew-status').textContent,recipe.receipt);
    if (i===tea.recipes.length-1) assert.equal(p.$('brew-serve').textContent,'Brew again');
    click('brew-serve');
  }
  assert.equal(p.$('brew-name').textContent,tea.recipes[0].name);
  assert.equal(p.win.frames.size,0); assert.deepEqual(p.errors,[]);
});

test('pour ripples expire on café time, freeze when hidden and settle immediately with reduced motion',()=>{
  const p=openPage(), click=id=>p.$(id).click();
  click('brew-toggle'); click('pour-tea'); p.win.tick();
  assert.equal(surface(p).u_swirl,1);
  ticks(p,30); const partial=surface(p).u_swirl;
  assert.ok(partial>.7 && partial<.8);
  p.doc.hidden=true; p.doc.emit('visibilitychange'); p.win.tick(180000);
  p.doc.hidden=false; p.doc.emit('visibilitychange'); p.win.tick();
  near(surface(p).u_swirl,partial);
  ticks(p,95); assert.equal(surface(p).u_swirl,0);
  click('pour-milk'); p.win.tick(); assert.ok(surface(p).u_swirl>.9);
  p.win.motion.matches=true; p.win.motion.emit('change'); p.win.tick();
  assert.equal(surface(p).u_swirl,0); assert.equal(p.win.frames.size,0);
});

test('an interrupted graphics context restores the current mix and fan speed, including pours made during recovery',()=>{
  const p=openPage({reduced:true}), click=id=>p.$(id).click();
  click('fan-speed'); click('brew-toggle'); click('pour-milk'); p.win.tick();
  const first=surface(p).u_liquid;
  p.$('scene').focus(); p.$('scene').emit('webglcontextlost');
  assert.equal(p.$('scene').tabIndex,-1); assert.ok(p.$('fan-speed').disabled);
  click('pour-tea'); assert.equal(p.win.frames.size,0);
  p.doc.gl=null; p.$('scene').emit('webglcontextrestored'); p.win.tick();
  assert.equal(p.$('scene').tabIndex,0); assert.equal(p.$('fan-label').textContent,'High');
  assert.ok(!p.$('fan-speed').disabled);
  const half=tea.appearance(tea.pour(tea.pour(tea.fresh(),'milk'),'tea'));
  assert.deepEqual(surface(p).u_teaTint,half.tint); assert.deepEqual(surface(p).u_liquid,[half.scale,half.drop]);
  assert.ok(half.drop>first[1]);
  assert.equal(p.$('brew-count').textContent,'2 / 4');
  assert.equal(p.win.frames.size,0); assert.deepEqual(p.errors,[]);
});
