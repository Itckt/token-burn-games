/* The same whole-dollar menu is printed on the wall and rung up at the till. */
(function () {
  'use strict';
  const local = typeof module === 'object' && module.exports;
  const {parts} = local ? require('./mesh.js') : PocketPlaces.mesh;
  const id = 10, origin = [.69,1.207,-2.18], yaw = -.07;
  const menu = [
    {name:'Milk tea', chinese:'港式奶茶', price:18},
    {name:'Pineapple bun', chinese:'菠蘿包', price:12},
    {name:'French toast', chinese:'西多士', price:28}
  ];
  const bills = [
    {name:'The corner booth', items:[1,1,0], cash:50},
    {name:'One more fork', items:[1,0,1], cash:50},
    {name:'Saturday breakfast', items:[2,2,0], cash:60},
    {name:'A toast to go', items:[0,0,1], cash:50}
  ];
  const coins = [{value:10,stock:2},{value:5,stock:2},{value:2,stock:4},{value:1,stock:4}];
  const fresh = (bill = 0) => ({bill, dish:[], settled:false});
  const subtotal = bill => bill.items.reduce((sum,qty,i)=>sum+qty*menu[i].price,0);
  const counted = state => state.dish.reduce((sum,value)=>sum+value,0);
  function balance(state) {
    const bill = bills[state.bill];
    return bill.cash-subtotal(bill)-counted(state);
  }
  function left(state,coin) { return coin.stock-state.dish.filter(value=>value===coin.value).length; }
  function add(state,value) {
    const coin = coins.find(c=>c.value===value);
    if (state.settled || !coin || !left(state,coin)) return state;
    return {...state, dish:[...state.dish,value]};
  }
  function undo(state) {
    return state.settled || !state.dish.length ? state : {...state, dish:state.dish.slice(0,-1)};
  }
  function settle(state) {
    return state.settled || balance(state)!==0 ? state : {...state, settled:true};
  }
  function next(state) { return state.settled ? fresh((state.bill+1)%bills.length) : state; }

  const travel = [.265*Math.sin(yaw),.265*Math.cos(yaw)];
  function build({group,slab,box,cyl,panel}) {
    group(...origin,yaw,id,()=>{
      slab(0,.019,0,.69,.038,.55,.052,'#3a6756',.008);
      box(0,.160,-.018,.597,.17,.457,'#cfbf96',.042);
      box(0,.190,.091,.534,.09,.251,'#e3d5ad',.027,{rx:.17});
      box(0,.346,-.132,.488,.210,.136,'#83b39c',.034,{rx:-.12});
      box(0,.347,-.054,.373,.107,.013,'#244f44',.009,{rx:-.12});
      for (const [i,part] of [parts.tillTens,parts.tillOnes].entries()) {
        panel((i-.5)*.075,.347,-.045,.069,.081,'#ffffff','digitZero',{rx:-.12,part});
      }
      for (let i=0;i<4;i++) for (let j=0;j<2;j++) box(-.162+i*.100,.244+j*.013,.129-j*.077,
        .065,.026,.050,i===3 ? '#c95037' : '#ffedc9',.008);
      group(0,0,0,0,id,()=>{
        box(0,.046,.012,.586,.024,.473,'#6a5c40');
        box(0,.073,.246,.65,.076,.035,'#376652',.009);
        box(0,.077,.271,.23,.020,.025,'#c59b5c',.005,{gloss:.48});
        for (const x of [-.28,-.09,.09,.28]) box(x,.071,.077,.014,.040,.29,'#a58d62');
        for (const [x,z,r,color] of [[-.183,.14,.066,'#d9b577'],[.002,.13,.061,'#c6c7b8'],[.18,.10,.072,'#caa562']]) {
          cyl(x,.068,z,r,r,.020,color,12,{gloss:.55});
          cyl(x+.007,.083,z-.005,r*.91,r*.91,.012,color,12,{gloss:.55});
        }
      },parts.tillDrawer);
    });
  }
  const api = {id, menu, bills, coins, fresh, subtotal, counted, balance, left, add, undo, settle, next, travel, build};
  if (local) module.exports=api; else PocketPlaces.till=api;
})();
