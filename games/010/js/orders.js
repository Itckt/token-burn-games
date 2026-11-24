/* The order of the stamps matters. Browsing a slip never stamps a ticket. */
(function () {
  'use strict';
  const tickets = [
    {id:'window-set', name:'Window set', served:'One hot set delivered. The tote bag has agreed to share the booth.',
      steps:[
        {id:3, cue:'Pick up the pastry with the diamond crust.', hint:'Look for the pineapple bun on the white saucer.'},
        {id:1, cue:'Add a cup of the house pour.', hint:'Choose the milk tea on either table.'},
        {id:2, cue:'Deliver the set to the seats by the glass.', hint:'Pick the green window booth.'}
      ]},
    {id:'short-break', name:'Between lectures', served:'One milk tea to go. The student calls it an energy refill. The till calls it eighteen dollars.',
      steps:[
        {id:4, cue:'A student has ten minutes. Check how much of the break is left.', hint:'The wall clock hangs to the right of the striped awning.'},
        {id:5, cue:'Find the hot water for a fresh brew.', hint:'Pick the silver tea urn at the end of the counter.'},
        {id:1, cue:'Hand over the finished drink.', hint:'Choose a cup of house milk tea.'}
      ]},
    {id:'closing-round', name:'Closing round', served:'All three tickets served. The night supervisor accepts payment in chin scratches.',
      steps:[
        {id:5, cue:'Check the brass tap before closing the counter.', hint:'The tap belongs to the tea urn.'},
        {id:2, cue:'Give the window seats one last wipe.', hint:'Choose the window booth with the green cushions.'},
        {id:6, cue:'Hand the keys to the regular with four paws.', hint:'The shop cat is curled up at the front corner.'}
      ]}
  ];

  const firstTicket = () => ({ticket:0, step:0});
  const served = state => state.step === tickets[state.ticket].steps.length;
  function stamp(state, objectId) {
    const next = tickets[state.ticket].steps[state.step];
    if (!next || next.id!==objectId) return state;
    return {...state, step:state.step+1};
  }
  function nextTicket(state) {
    if (!served(state) || state.ticket===tickets.length-1) return state;
    return {ticket:state.ticket+1, step:0};
  }
  function pack(state) {
    return JSON.stringify({version:1, ticket:tickets[state.ticket].id, step:state.step});
  }
  function unpack(raw) {
    if (typeof raw!=='string') return null;
    let value;
    try { value=JSON.parse(raw); } catch { return null; }
    if (value?.version!==1) return null;
    const ticket=tickets.findIndex(order=>order.id===value.ticket);
    if (ticket<0 || !Number.isInteger(value.step) || value.step<0 || value.step>tickets[ticket].steps.length) return null;
    return {ticket, step:value.step};
  }
  const api = {tickets, firstTicket, served, stamp, nextTicket, pack, unpack};
  if (typeof module==='object' && module.exports) module.exports=api;
  else PocketPlaces.orders=api;
})();
