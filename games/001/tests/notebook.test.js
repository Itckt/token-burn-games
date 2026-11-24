'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {Notebook, PREFIX, REACH, pressAt} = require('../src/notebook.js');
const {create} = require('../src/campus.js');
const {canStand} = require('../src/collision.js');
const campus = create(), {places} = campus;
const fail = () => { throw Error('storage unavailable'); };
function memory() {
  const values = new Map();
  return {getItem: key=>values.get(key), setItem: (key,value)=>values.set(key,value)};
}

test('each impression has a unique world-space press, a clear tile and a matching notebook drawing', () => {
  assert.equal(new Set(places.map(p=>p.stamp.title)).size,places.length);
  assert.equal(new Set(places.map(p=>JSON.stringify(p.stamp.strokes))).size,places.length);
  for (const [i,place] of places.entries()) {
    const [x,z] = place.stamp.at, sign = campus.signs.find(s=>s.words==='PRESS 0'+(i+1));
    assert.ok(sign && Math.abs(sign.center[0]-x)<.01 && Math.abs(sign.center[2]-z)<1);
    assert.equal(canStand(x,z-1,campus),false);
    assert.equal(pressAt(x,z,campus),place);
    assert.equal(pressAt(...place.view.slice(0,2),campus),undefined);
    for (const stroke of place.stamp.strokes) {
      assert.ok(stroke.length>=2 && stroke.flat().every(n=>Number.isFinite(n) && Math.abs(n)<=1));
    }
    const tileTop = (place.stamp.floor || 0)+.04;
    let tile = false;
    for (let n=0; n<campus.vertices.length; n+=10) {
      const v=campus.vertices;
      if (Math.hypot(v[n]-x,v[n+2]-z)<.4 && Math.abs(v[n+1]-tileTop)<1e-5 && v[n+4]>.99) { tile=true; break; }
    }
    assert.ok(tile, place.name+' tile above paving or pavilion platform');
  }
});

test('a press must be within reach on the same side of an obstacle', () => {
  const place = {stamp:{at:[0,0]}};
  const world = {places:[place],bounds:{west:-5,east:5,north:-5,south:5},colliders:[]};
  assert.equal(pressAt(REACH,0,world),place);
  assert.equal(pressAt(REACH+.001,0,world),undefined);
  world.colliders.push({kind:'box',x:.8,z:0,w:.06,d:2});
  assert.equal(pressAt(1.6,0,world),undefined);
  assert.equal(pressAt(-1,0,world),place);
});

test('saved stamps are idempotent, validate stored values and merge independent open walks', () => {
  const store = memory();
  store.setItem(PREFIX+'garden','maybe');
  store.setItem(PREFIX+'imaginary','1');
  const a = new Notebook(places,()=>store), b = new Notebook(places,()=>store);
  assert.equal(a.stamps.size,0);
  assert.equal(a.collect('imaginary'),false);
  assert.equal(a.collect('court'),true);
  assert.equal(a.collect('court'),false);
  b.collect('garden');
  a.read();
  assert.deepEqual([...a.stamps].sort(),['court','garden']);
  const reopened = new Notebook(places,()=>store);
  assert.deepEqual(reopened.stamps,a.stamps);
  assert.equal(reopened.saved,true);
});

test('denied getters, failed reads and full storage preserve impressions in the current walk', () => {
  for (const get of [fail,()=>undefined,()=>({getItem:fail,setItem:fail}),
    ()=>({getItem:()=>null,setItem:fail})]) {
    const book = new Notebook(places,get);
    for (const p of places) assert.ok(book.collect(p.id));
    book.read();
    assert.equal(book.saved,false);
    assert.equal(book.stamps.size,places.length);
    assert.equal(book.collect('tower'),false);
  }
});

test('a five-stamp Round 2 notebook reopens intact and can add the terrace independently',()=>{
  const store=memory();
  const original=['court','library','tower','arcade','garden'];
  original.forEach(id=>store.setItem(PREFIX+id,'1'));
  const book=new Notebook(places,()=>store);
  assert.deepEqual([...book.stamps],original);
  assert.equal(book.collect('terrace'),true);
  assert.equal(new Notebook(places,()=>store).stamps.size,6);
});

test('a six-stamp Round 3 notebook opens with only the water ring to collect',()=>{
  const store=memory();
  const original=['court','library','tower','arcade','garden','terrace'];
  for (const id of original) store.setItem(PREFIX+id,'1');
  const book=new Notebook(places,()=>store);
  assert.deepEqual([...book.stamps],original);
  assert.ok(book.collect('pool'));
  assert.equal(new Notebook(places,()=>store).stamps.size,7);
});

test('refreshing reconciles deletions, protects unsaved impressions and is atomic on a partial read',()=>{
  const values=new Map([[PREFIX+'court','1'],[PREFIX+'garden','1']]);
  let badRead=false;
  const store={
    getItem(key) { if (badRead && key.endsWith('tower')) throw Error('read interrupted'); return values.get(key); },
    setItem(){throw Error('storage full');}
  };
  const book=new Notebook(places,()=>store), observed=book.stamps;
  book.collect('library');
  values.clear();
  badRead=true; book.read();
  assert.deepEqual([...observed].sort(),['court','garden','library']);
  badRead=false; book.read();
  assert.deepEqual([...observed],['library']);
  assert.equal(book.saved,false);
  values.set(PREFIX+'library','1'); book.read();
  assert.equal(book.saved,true);
  values.clear(); book.read();
  assert.equal(observed.size,0);
});
