(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./navigation.js'));
  else root.Atlas.walks = factory(root.Atlas.navigation);
})(globalThis, function (navigation) {
  'use strict';
  const catalogue = [
    {id:'water', name:'Water & copper', intro:'Follow three ways of catching the light, from still water to folded metal.',
      stops:[
        {id:'pool', note:'Look west along the slabs. The green keystone has a twin in the water. Step to one side and the two arcs pull apart.'},
        {id:'tower', note:'Look up from the compass rose. The dial is cream stone, but the narrow spire above the louvres is copper.'},
        {id:'terrace', note:'Circle the foot of the kite. Its four triangular folds take turns catching the light.'}
      ]},
    {id:'break', name:'Between lectures', intro:'Take the shaded way from the reading rooms to the garden, with a stop at the student arcade.',
      stops:[
        {id:'library', note:'Look at the ribbon windows above the library sign. Each pale fin shades just one reading bay.'},
        {id:'arcade', note:'The three-a-side club has claimed the little noticeboard outside the arches. Their last match ended just in time for milk tea.'},
        {id:'garden', note:'Step under the pavilion. Its two folded eaves reach past the timber posts and keep the bench dry.'}
      ]}
  ];
  const STOP_RADIUS = 1.45;

  // A press route ends on arrival. A guided walk holds each observation until
  // the visitor asks for the next leg, even if they put the camera away and roam.
  class Directions {
    constructor(world) {
      this.places = world.places;
      this.planner = new navigation.Planner(world);
      this.clear();
    }
    clear() {
      this.leg = null;
      this.walk = null;
      this.index = 0;
      this.arrived = false;
    }
    get place() { return this.leg?.place; }
    get stop() { return this.walk?.stops[this.index]; }
    get last() { return !!this.walk && this.index === this.walk.stops.length-1; }

    preview(from, walk) {
      const points = [];
      const first = this.walk === walk ? this.index + Number(this.arrived) : 0;
      for (const stop of walk.stops.slice(first)) {
        const place = this.places.find(p => p.id === stop.id);
        const to = place.view.slice(0,2);
        const path = this.planner.find(from,to);
        if (!path) return null;
        points.push(...path);
        from = to;
      }
      return points;
    }
    toPress(from, place, preview) {
      this.clear();
      this.leg = new navigation.WalkingRoute(this.planner,from,place,preview);
    }
    toStop(from, walk, index) {
      const place = this.places.find(p => p.id === walk.stops[index].id);
      const destination = place.view.slice(0,2);
      const points = this.planner.find(from,destination);
      if (!points) return false;
      this.leg = new navigation.WalkingRoute(this.planner,from,place,points,destination);
      this.walk = walk;
      this.index = index;
      this.arrived = false;
      return true;
    }
    advance(from) {
      if (!this.arrived) return false;
      if (this.last) this.clear();
      else return this.toStop(from,this.walk,this.index+1);
      return true;
    }
    update(from, nearPress) {
      if (!this.leg || this.arrived) return;
      const at = this.leg.destination;
      if (this.walk) {
        if (Math.hypot(from[0]-at[0],from[1]-at[1]) <= STOP_RADIUS && this.planner.clear(from,at)) {
          this.arrived = true;
          return 'stop';
        }
      } else if (nearPress === this.place) {
        this.clear();
        return 'press';
      }
      if (!this.leg.update(from)) {
        this.clear();
        return 'lost';
      }
    }
  }
  return {catalogue, Directions, STOP_RADIUS};
});
