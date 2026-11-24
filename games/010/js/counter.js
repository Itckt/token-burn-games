(function () {
  'use strict';
  const {orders} = PocketPlaces;
  const storageKey = 'half-past-tea.counter.v1';

  function mount(onOpen) {
    const byId = id => document.getElementById(id);
    const toggle = byId('ticket-toggle'), panel = byId('service-ticket'), cue = byId('service-cue');
    const hint = byId('service-hint'), next = byId('service-next'), feedback = byId('service-feedback');
    let progress = null;
    try { progress=orders.unpack(window.localStorage.getItem(storageKey)); } catch { /* Some file origins have no storage. */ }

    function save(state) {
      progress=state;
      try { window.localStorage.setItem(storageKey,orders.pack(state)); } catch { /* This shift can continue in memory. */ }
    }
    function syncToggle() {
      let action='Take a ticket';
      if (progress) action=orders.served(progress) ? 'View served ticket' : 'Resume ticket';
      byId('ticket-label').textContent=panel.hidden ? action : 'Put ticket down';
      toggle.setAttribute('aria-expanded',String(!panel.hidden));
    }
    function respond(message) {
      feedback.textContent=message;
      feedback.hidden=!message;
    }
    function showTicket(message='') {
      const ticket=orders.tickets[progress.ticket], done=orders.served(progress);
      byId('service-kind').textContent=done ? 'Served' : 'Order';
      byId('service-number').textContent=String(progress.ticket+1).padStart(2,'0');
      byId('service-total').textContent='of '+String(orders.tickets.length).padStart(2,'0');
      byId('service-name').textContent=ticket.name;
      cue.textContent=done ? ticket.served : ticket.steps[progress.step].cue;
      panel.classList.toggle('is-served',done);
      const stamps=byId('service-stamps');
      stamps.setAttribute('aria-label',progress.step+' of '+ticket.steps.length+' steps stamped');
      stamps.replaceChildren(...ticket.steps.map((step,i)=>{
        const mark=document.createElement('span');
        mark.textContent=i<progress.step ? '✓' : String(i+1);
        mark.classList.toggle('stamped',i<progress.step);
        return mark;
      }));
      hint.hidden=done; next.hidden=!done;
      next.textContent=progress.ticket===orders.tickets.length-1 ? 'Work another shift' : 'Take next ticket';
      respond(message);
      syncToggle();
    }
    function close() {
      panel.hidden=true;
      syncToggle();
    }
    toggle.addEventListener('click',()=>{
      if (!panel.hidden) { close(); return; }
      panel.hidden=false;
      if (onOpen) onOpen();
      if (!progress) save(orders.firstTicket());
      showTicket();
    });
    hint.addEventListener('click',()=>{
      if (!panel.hidden && !orders.served(progress)) respond(orders.tickets[progress.ticket].steps[progress.step].hint);
    });
    next.addEventListener('click',()=>{
      if (panel.hidden || !orders.served(progress)) return;
      save(progress.ticket===orders.tickets.length-1 ? orders.firstTicket() : orders.nextTicket(progress));
      showTicket(); cue.focus({preventScroll:true});
    });
    syncToggle();
    function inspect(note) {
      if (panel.hidden || orders.served(progress)) return;
      const stamped=orders.stamp(progress,note.id);
      if (stamped===progress) {
        respond('You chose the '+note.short.toLowerCase()+'. Try another object for this stamp.');
        return;
      }
      save(stamped);
      showTicket(orders.served(stamped) ? 'Ticket stamped and served.' : 'Stamped · '+note.short);
    }
    return {inspect, close};
  }
  PocketPlaces.counter={mount};
})();
