(function () {
  'use strict';
  const cat=PocketPlaces.shopCat;
  function mount(pet,notes,instant,onCall) {
    const printed=notes.find(note=>note.id===cat.id);
    // The print stays fixed. Its pin and camera subject travel with this visitor's cat.
    const slip={...printed,closeup:{...printed.closeup}};
    const buttons=cat.stops.map(stop=>{
      const button=document.createElement('button');
      button.type='button'; button.textContent=stop.name;
      button.addEventListener('click',()=>{
        cat.call(pet,stop.id,instant());
        locate(); describe(); onCall();
      });
      document.getElementById('cat-stops').append(button);
      return button;
    });
    const status=document.getElementById('cat-status');
    function locate() {
      slip.anchor=cat.point(pet,printed.anchor);
      slip.closeup.center=cat.point(pet,printed.closeup.center);
    }
    function describe() {
      buttons.forEach((b,i)=>b.setAttribute('aria-pressed',String(cat.stops[i]===pet.destination)));
      status.textContent=pet.trip ? 'On the way to the '+pet.destination.name.toLowerCase()+'.' : pet.destination.caption;
    }
    describe();
    return {slip,
      step(dt) {
        if (!pet.trip) return;
        cat.step(pet,dt); locate();
        if (!pet.trip) describe();
      },
      settle() {
        if (!pet.trip) return;
        cat.settle(pet); locate(); describe();
      }
    };
  }
  PocketPlaces.catVisit={mount};
})();
