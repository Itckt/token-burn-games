(function () {
  'use strict';
  const {tea} = PocketPlaces;
  function mount(onOpen,onChange) {
    const byId = id => document.getElementById(id);
    const toggle=byId('brew-toggle'), panel=byId('brew-bench'), serve=byId('brew-serve');
    const black=byId('pour-tea'), milk=byId('pour-milk'), undo=byId('brew-undo');
    const doses=byId('brew-measures'), status=byId('brew-status');
    let order=null;
    function render(message) {
      const recipe=tea.recipes[order.recipe], size=order.pours.length, counts=tea.count(order);
      byId('brew-name').textContent=recipe.name;
      byId('brew-target').textContent=recipe.tea+' tea + '+recipe.milk+' milk';
      byId('brew-count').textContent=size+' / '+tea.capacity;
      doses.replaceChildren(...Array.from({length:tea.capacity},(_,i)=>{
        const mark=document.createElement('span');
        mark.className=order.pours[i] || 'empty';
        mark.textContent=order.pours[i] || '·';
        return mark;
      }));
      status.textContent=message || (order.served ? recipe.receipt :
        !size ? 'Start with an empty cup.' : counts.tea+' tea and '+counts.milk+' milk in the cup.');
      black.disabled=milk.disabled=size===tea.capacity;
      undo.disabled=order.served || !size;
      serve.disabled=size<tea.capacity;
      serve.textContent=!order.served ? 'Serve cup' : order.recipe===tea.recipes.length-1 ? 'Brew again' : 'Next recipe';
    }
    function close() {
      panel.hidden=true;
      toggle.setAttribute('aria-expanded','false');
    }
    toggle.addEventListener('click',()=>{
      if (!panel.hidden) { close(); return; }
      panel.hidden=false;
      toggle.setAttribute('aria-expanded','true');
      if (!order) order=tea.fresh();
      render();
      onOpen();
      onChange(order,false);
    });
    function edit(next,stir) {
      if (order===next) return;
      order=next;
      render();
      onChange(order,stir);
      if (order.pours.length===tea.capacity) serve.focus({preventScroll:true});
      else if (!order.pours.length) black.focus({preventScroll:true});
    }
    black.addEventListener('click',()=>edit(tea.pour(order,'tea'),true));
    milk.addEventListener('click',()=>edit(tea.pour(order,'milk'),true));
    undo.addEventListener('click',()=>edit(tea.undo(order),false));
    serve.addEventListener('click',()=>{
      if (order.served) {
        edit(tea.next(order),false);
      } else {
        const served=tea.serve(order);
        if (served===order) {
          render('That ratio misses the order. Undo the last measure to adjust it.');
          undo.focus({preventScroll:true});
        } else {
          order=served;
          render();
        }
      }
    });
    return {close};
  }
  PocketPlaces.teaBench={mount};
})();
