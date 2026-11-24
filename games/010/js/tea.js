/* Four measures fit the foreground cup. Heights and radii follow its inner wall. */
(function () {
  'use strict';
  const cup = {x:1.33, base:1.081, z:1.79};
  const levels = [[.060,0],[.122,.142],[.183,.167],[.246,.179],[.304,.188]];
  const capacity = levels.length - 1;
  const recipes = [
    {name:'House pour', tea:3, milk:1, receipt:'Silky, with enough tea to stand up to buttered toast.'},
    {name:'Window seat', tea:2, milk:2, receipt:'Half tea, half milk. The window regular measures by eye.'},
    {name:'Study break', tea:1, milk:3, receipt:'A soft landing after a hard deadline. The booth is yours.'}
  ];
  const fresh = (recipe = 0) => ({recipe, pours:[], served:false});
  function count(order) {
    const milk = order.pours.filter(pour => pour === 'milk').length;
    return {milk, tea:order.pours.length - milk};
  }
  function pour(order, ingredient) {
    if (order.served || order.pours.length >= capacity || !['tea','milk'].includes(ingredient)) return order;
    return {...order, pours:[...order.pours,ingredient]};
  }
  function undo(order) {
    if (order.served || !order.pours.length) return order;
    return {...order, pours:order.pours.slice(0,-1)};
  }
  function serve(order) {
    if (order.served || order.pours.length !== capacity || count(order).milk !== recipes[order.recipe].milk) return order;
    return {...order, served:true};
  }
  function next(order) {
    return order.served ? fresh((order.recipe + 1) % recipes.length) : order;
  }

  const blackTea = [.32,.15,.065], milkColor = [.98,.88,.69];
  function color(milkFraction) {
    const mix = Math.sqrt(milkFraction);
    return blackTea.map((v,i) => v + (milkColor[i]-v)*mix);
  }
  const houseColor = color(.25);
  function appearance(order) {
    const size = order ? order.pours.length : capacity;
    const milk = order ? count(order).milk : 1;
    const [height,radius] = levels[size], [fullHeight,fullRadius] = levels[capacity];
    const milkFraction = size ? milk/size : 0;
    return {
      scale:radius/fullRadius, drop:height-fullHeight,
      tint:color(milkFraction).map((v,i) => v/houseColor[i]),
      heat:Math.sqrt(size/capacity) * Math.min(1,(1-milkFraction)/.75)
    };
  }
  const api = {cup, levels, capacity, recipes, fresh, count, pour, undo, serve, next, appearance};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else PocketPlaces.tea = api;
})();
