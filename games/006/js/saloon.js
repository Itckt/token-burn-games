(function () {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const { STATIONS, nextStation } = node ? require('./route.js') : Nightline.route;
  const signals = node ? require('./signals.js') : Nightline.signals;
  const APPROACH = 80;
  // A row of the illuminated sign carries the same wording as the accessible caption.
  const stages = [
    ['ready', 'At station', '現在停靠'],
    ['opening', 'Doors opening', '車門開啟中'],
    ['dwell', 'Doors open on right', '右側車門已開'],
    ['closing', 'Doors closing', '車門關閉中'],
    ['next', 'Next stop', '下一站'],
    ['arriving', 'Arriving', '即將到站'],
    ['hold', 'Waiting for signal', '等候信號'],
    ['campusExit', 'HKBU exit on right', '右側往浸大']
  ].map(([key, english, chinese], row) => Object.freeze({ key, english, chinese, row }));
  const messages = STATIONS.map((station, index) => {
    const signs = {};
    for (const stage of stages) {
      signs[stage.key] = Object.freeze({ stage, station: index,
        english: stage.english + ' · ' + station.name, chinese: stage.chinese + ' · ' + station.chinese });
    }
    return signs;
  });

  function message(s) {
    if (s.berth !== null) {
      const stage = s.berth === 1 && s.phase === 'dwell' ? 'campusExit' : s.phase;
      return messages[s.berth][stage];
    }
    const next = messages[nextStation(s.last)];
    if (s.speed === 0 && signals.stopDistance(s) <= 0.0002) return next.hold;
    return s.nextMark - s.position <= APPROACH ? next.arriving : next.next;
  }
  const api = { APPROACH, ATLAS_SIZE: 512, ROWS: 8, DIVIDER: 296, stages: Object.freeze(stages), message };
  if (node) module.exports = api;
  else Nightline.saloon = api;
})();
