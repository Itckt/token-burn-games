(function () {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const { mod, seeded } = node ? require('./math.js') : Nightline.math;
  const { STATIONS } = node ? require('./route.js') : Nightline.route;
  const CAPACITY = 18, MAX_WAITING = 6, CROSSING_TIME = 0.6;

  // A visit identifies one platform call across laps. The queue can be drawn
  // before the train arrives and will have the same destinations at the berth.
  function platformCall(visit) {
    const station = mod(visit, STATIONS.length);
    const random = seeded(7381 + visit);
    const size = 3 + Math.floor(random() * (MAX_WAITING - 2));
    const queue = Array.from({ length: size }, (_, i) => {
      if (station === 1 && i < 3) return 3; // Campus three-a-side team to Lok Fu.
      return (station + 1 + Math.floor(random() * (STATIONS.length - 1))) % STATIONS.length;
    });
    return { visit, station, queue, boarded: 0, alighted: 0, crossing: null };
  }

  function createCar() {
    return { destinations: [0, 2, 2, 1, 1], call: platformCall(0) };
  }
  function load(car) { return car.destinations.reduce((sum, n) => sum + n, 0); }

  // A crossing may finish during a closing request. The doors are still wider
  // than a rider for the whole crossing. Only fully open doors admit a new one.
  function exchange(car, dt, openSeconds) {
    const call = car.call;
    if (!call.crossing) {
      if (openSeconds + 1e-9 < CROSSING_TIME) return;
      if (car.destinations[call.station]) call.crossing = { boarding: false, elapsed: 0 };
      else if (call.boarded < call.queue.length && load(car) < CAPACITY) {
        call.crossing = { boarding: true, elapsed: 0 };
      } else return;
    }
    const crossing = call.crossing;
    crossing.elapsed += dt;
    if (crossing.elapsed < CROSSING_TIME - 1e-9) return;
    if (crossing.boarding) {
      car.destinations[call.queue[call.boarded]]++;
      call.boarded++;
    } else {
      car.destinations[call.station]--;
      call.alighted++;
    }
    call.crossing = null;
  }

  // One vec4 per figure: platform-relative metres and gait (zero hides a slot). All riders
  // use the same z=2 doorway as the cab and the corresponding screen doors.
  function writePoses(call, out) {
    const crossing = call.crossing;
    const t = crossing ? Math.min(1, crossing.elapsed / CROSSING_TIME) : 0;
    const walk = t * t * (3 - 2 * t);
    const board = crossing?.boarding ? walk : 0;
    const bob = 0.025 * Math.sin(Math.PI * 2 * walk) ** 2;
    const stride = Math.sin(Math.PI * 2 * t);
    out.fill(0);
    for (let i = call.boarded; i < call.queue.length; i++) {
      const rank = i - call.boarded;
      const place = Math.max(0, rank - board);
      const intoCar = rank === 0 ? board : 0;
      const k = i * 4;
      out[k] = 2.55 + 0.45 * place - 1.60 * intoCar;
      out[k + 1] = 1.09 + (board ? bob : 0);
      out[k + 2] = 2.23 + 0.40 * place - 0.24 * intoCar;
      out[k + 3] = 1 + (board ? 0.75 * stride : 0);
    }
    if (crossing && !crossing.boarding) {
      const k = MAX_WAITING * 4;
      out[k] = 0.97 + 2.28 * walk;
      out[k + 1] = 1.09 + bob;
      out[k + 2] = 2 - 0.68 * walk * walk;
      out[k + 3] = 1 + 0.75 * stride;
    }
  }

  const api = { CAPACITY, MAX_WAITING, CROSSING_TIME, createCar, platformCall, load, exchange, writePoses };
  if (node) module.exports = api;
  else Nightline.passengers = api;
})();
