/* Object-slip controls. The dish, bill and blind setting belong to this visit. */
(function () {
  'use strict';
  const {blinds, toast, till} = PocketPlaces;
  const byId = id => document.getElementById(id);
  function buttons(container, names, choose) {
    const group = byId(container);
    return names.map((name,i)=>{
      const button=document.createElement('button');
      button.type='button'; button.textContent=name;
      button.addEventListener('click',()=>choose(i)); group.append(button);
      return button;
    });
  }
  function mark(buttons,selected,locked=false) {
    buttons.forEach((button,i)=>{
      button.setAttribute('aria-pressed',String(i===selected));
      button.disabled=locked;
    });
  }
  function mountBlinds(room,changed) {
    const stops=buttons('blind-stops',blinds.settings.map(s=>s.name),i=>{
      room.blind=blinds.settings[i];
      show(); changed();
    });
    function show() {
      mark(stops,blinds.settings.indexOf(room.blind));
      byId('blind-swatch').style.height=(8+room.blind.drop*92)+'%';
    }
    show();
  }
  function mountToast(room,changed) {
    const send=byId('toast-serve');
    function choose(field,value) {
      room.plate=toast.choose(room.plate,field,value);
      show(); changed();
    }
    const cuts=buttons('toast-cuts',toast.cuts,i=>choose('cut',toast.cuts[i]));
    const finishes=buttons('toast-finishes',toast.finishes,i=>choose('finish',toast.finishes[i]));
    function show(feedback='') {
      const plate=room.plate, order=toast.orders[plate.order];
      byId('toast-number').textContent='Toast order '+(plate.order+1)+' / '+toast.orders.length;
      byId('toast-name').textContent=order.name;
      byId('toast-request').textContent=order.cut+' · '+order.finish;
      mark(cuts,toast.cuts.indexOf(plate.cut),plate.served);
      mark(finishes,toast.finishes.indexOf(plate.finish),plate.served);
      byId('toast-feedback').textContent=plate.served ? order.receipt : feedback;
      send.textContent=plate.served ? (plate.order===toast.orders.length-1 ? 'Start another round' : 'Next toast order') : 'Send plate';
    }
    send.addEventListener('click',()=>{
      const plate=room.plate;
      if (plate.served) {
        room.plate=toast.next(plate); show(); cuts[0].focus({preventScroll:true});
      } else {
        room.plate=toast.serve(plate);
        const order=toast.orders[plate.order];
        show(plate.cut!==order.cut ? 'Check the cut on the order.' : 'Check the finish on the order.');
      }
      changed();
    });
    show();
  }
  function mountTill(room,changed) {
    const undo=byId('bill-undo'), handOver=byId('bill-settle');
    const bank=buttons('bill-coins',till.coins.map(c=>'$'+c.value),i=>{
      room.bill=till.add(room.bill,till.coins[i].value);
      show();
      if (bank[i].disabled) handOver.focus({preventScroll:true});
      changed();
    });
    const stock=bank.map(button=>{
      const label=document.createElement('small'); button.append(label); return label;
    });
    function printBill() {
      const {bill:index}=room.bill, bill=till.bills[index], lines=[];
      byId('bill-number').textContent='Bill '+(index+1)+' / '+till.bills.length;
      byId('bill-name').textContent=bill.name;
      bill.items.forEach((qty,i)=>{
        if (!qty) return;
        const item=till.menu[i], line=document.createElement('li'), amount=document.createElement('span');
        line.textContent=qty+' × '+item.name; amount.textContent='$'+qty*item.price;
        line.append(amount); lines.push(line);
      });
      byId('bill-lines').replaceChildren(...lines);
      byId('bill-total').textContent='$'+till.subtotal(bill); byId('bill-cash').textContent='$'+bill.cash;
    }
    function show(feedback='') {
      const state=room.bill;
      bank.forEach((button,i)=>{
        const coin=till.coins[i], left=till.left(state,coin);
        stock[i].textContent=left+' left';
        button.setAttribute('aria-label','Add $'+coin.value+' coin, '+left+' left');
        button.disabled=state.settled || !left;
      });
      undo.disabled=state.settled || !state.dish.length;
      byId('bill-counted').textContent='$'+till.counted(state);
      let message=feedback || 'Count out the change owed.';
      if (state.settled) message=state.dish.length ? '$'+till.counted(state)+' returned. Bill settled.' : 'Exact cash. Bill settled.';
      else if (!feedback && state.dish.length) message=state.dish.map(value=>'$'+value).join(' + ')+' in the dish.';
      byId('bill-feedback').textContent=message;
      handOver.textContent=state.settled ? (state.bill===till.bills.length-1 ? 'Start another shift' : 'Next customer') : 'Hand over change';
    }
    undo.addEventListener('click',()=>{
      room.bill=till.undo(room.bill); show(); changed();
      if (undo.disabled) bank[0].focus({preventScroll:true});
    });
    handOver.addEventListener('click',()=>{
      if (room.bill.settled) {
        room.bill=till.next(room.bill); printBill(); show(); bank[0].focus({preventScroll:true});
      } else {
        const gap=till.balance(room.bill);
        room.bill=till.settle(room.bill);
        show(gap>0 ? 'The dish is $'+gap+' short.' : 'The dish is $'+(-gap)+' over.');
      }
      changed();
    });
    printBill(); show();
  }
  function mount(room,changed) {
    mountBlinds(room,changed); mountToast(room,changed); mountTill(room,changed);
    return {inspect(id) {
      room.atTill=id===till.id;
      byId('blind-panel').hidden=id!==2;
      byId('toast-panel').hidden=id!==toast.id;
      byId('till-panel').hidden=!room.atTill;
    }};
  }
  PocketPlaces.tableService={mount};
})();
