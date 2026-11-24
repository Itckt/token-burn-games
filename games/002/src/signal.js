(() => {
  "use strict";
  const node = typeof module === "object" && module.exports;
  const Pickup = node ? require("./pickup.js") : Slipwake.pickup;
  const RULES = Object.freeze({target:30, radius:1.6, shiftTime:18, previewTime:4, pointTime:1});
  const stations = [
    {name:"Midships", x:0, z:0},
    {name:"North slip", x:3.85, z:-6},
    {name:"South slip", x:-3.85, z:6}
  ];

  function create() {
    return {station:0, remaining:RULES.shiftTime, owner:null, contested:false, progress:0};
  }
  function nextStation(signal) { return (signal.station + 1) % stations.length; }
  function occupancy(signal, actors) {
    const claim = Pickup.claim(actors, stations[signal.station], RULES.radius + 1e-8);
    signal.contested = claim.contested;
    const owner = claim.runner?.team ?? null;
    if (owner !== signal.owner) signal.progress = 0;
    signal.owner = owner;
  }
  // Split at score and station boundaries. A winning point stops the rotation at that instant.
  function advance(signal, actors, dt, report) {
    if (dt < 0 || !Number.isFinite(dt)) return;
    occupancy(signal, actors);
    while (dt > 0) {
      const occupied = signal.owner !== null;
      const slice = Math.min(dt, signal.remaining, occupied ? RULES.pointTime-signal.progress : Infinity);
      signal.remaining -= slice;
      dt -= slice;
      if (occupied) {
        signal.progress += slice;
        if (signal.progress >= RULES.pointTime-1e-8) {
          signal.progress = 0;
          if (report("signalPoint", signal.owner, stations[signal.station]) === false) return;
        }
      }
      if (signal.remaining <= 1e-8) {
        signal.station = nextStation(signal);
        signal.remaining = RULES.shiftTime;
        signal.progress = 0;
        occupancy(signal, actors);
        report("signalShift", null, stations[signal.station]);
      }
    }
  }
  const api = {RULES, stations, create, nextStation, advance};
  if (typeof module === "object" && module.exports) module.exports = api;
  else (globalThis.Slipwake ||= {}).signal = api;
})();
