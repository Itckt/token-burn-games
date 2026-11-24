(function () {
  'use strict';
  const { ride: R, math, service, passengers, signals, lineSpeed, daylight, boarding, duties, saloon } = Nightline;
  const { byId, write, element } = Nightline.dom;

  function bind(ride, camera) {
    const rows = R.STATIONS.map(station => {
      const row = element('li', 'station'), names = element('span', 'station-names');
      const chinese = element('small', '', station.chinese);
      chinese.lang = 'zh-HK';
      names.append(element('strong', '', station.name), chinese);
      const tag = element('span', 'station-tag');
      row.append(element('span', 'station-marker'), names, tag);
      byId('stations').append(row);
      return { row, tag };
    });
    const segments = Array.from({ length: R.MAX_KMH / 10 }, () => {
      const segment = document.createElement('i');
      byId('segments').append(segment);
      return segment;
    });
    const refreshHistory = Nightline.runSheet.bind(ride.sheet);
    let lastStop = '', lastProgress = -1;
    const choice = byId('duty-select');
    for (const [id, name] of Object.entries(duties.cards)) {
      const option = element('option', '', name);
      option.value = id; choice.append(option);
    }

    function refreshDuty(online) {
      const { duty, berth, sheet, quality } = ride;
      choice.disabled = !online || ride.paused || berth === null;
      if (choice.value !== duty) choice.value = duty;
      write('duty-brief', duties.brief(duty, ride.last, R.bookedTime(ride)));
      const running = berth === null && duty !== 'free';
      byId('duty-live').hidden = !running;
      if (running) {
        const elapsed = ride.time - sheet.departedAt;
        const reading = duty === 'coast' ? duties.coastReading(quality, elapsed) :
          duty === 'smooth' ? duties.forces(quality) : ride.manual ? R.brakeCue(ride) : 'Assisted stops selected';
        write('duty-live', reading);
      }
      const last = sheet.entries[0], result = last?.duty;
      const show = Boolean(berth !== null && result && result.card === duty);
      byId('duty-result').hidden = !show;
      if (show) {
        write('duty-result', (result.passed ? 'Completed' : 'Missed') + ' at ' +
          R.STATIONS[last.to].name + ' · ' + result.detail);
        byId('duty-result').dataset.passed = String(result.passed);
      }
    }

    function workingSwitch(id, on) {
      byId(id + '-toggle').setAttribute('aria-pressed', String(on));
      write(id + '-setting', on ? 'On' : 'Off');
    }
    function refreshWorking(online) {
      workingSwitch('signal', ride.signalled);
      workingSwitch('limits', ride.limits);
      workingSwitch('guard', ride.guard.enabled);
      byId('limit-cue').hidden = !ride.limits;
      if (ride.limits) {
        const speed = lineSpeed.postedAt(ride.position);
        write('posted-speed', String(speed));
        byId('posted-speed').classList.toggle('restricted', speed < R.MAX_KMH);
        write('limit-ahead', lineSpeed.indication(ride.position));
      }
      byId('guard-desk').hidden = !ride.guard.enabled;
      if (ride.guard.enabled) {
        const aspect = boarding.lamp(ride);
        byId('guard-instruction').dataset.lamp = String(aspect);
        write('guard-instruction', boarding.instruction(ride));
        byId('departure-bell').disabled = !online || ride.paused || aspect !== 2;
      }
      const name = daylight.shifts[ride.clock.shift].name, clock = daylight.clockLabel(ride.clock);
      write('shift-name', name); write('service-clock', clock);
      byId('shift-toggle').setAttribute('aria-label', 'Change shift. ' + name + ', service time ' + clock);
    }

    function refreshRoute() {
      const next = R.nextStation(ride.last);
      const active = ride.berth === null ? next : ride.berth;
      const tagText = ride.berth === null ? 'Next' : 'Here';
      if (lastStop !== active + tagText) {
        rows.forEach(({ row, tag }, i) => {
          row.classList.toggle('here', i === active);
          row.classList.toggle('departed', i === ride.last && ride.berth === null);
          if (i === active) row.setAttribute('aria-current', 'step');
          else row.removeAttribute('aria-current');
          tag.hidden = i !== active;
          tag.textContent = i === active ? tagText : '';
        });
        lastStop = active + tagText;
        write('next-name', R.STATIONS[next].name);
      }
      const remaining = ride.nextMark - ride.position;
      write('distance', R.distanceLabel(remaining));
      const progress = Math.round(100 * math.clamp(1 - remaining / R.legLength(ride.last), 0, 1));
      if (progress !== lastProgress) {
        byId('leg-fill').style.width = progress + '%';
        byId('leg-progress').setAttribute('aria-valuenow', String(progress));
        lastProgress = progress;
      }
    }

    function refreshTimetable() {
      const sheet = ride.sheet;
      const elapsed = sheet.departedAt === null ? 0 : ride.time - sheet.departedAt;
      write('elapsed-time', service.clockLabel(elapsed));
      write('booked-time', service.clockLabel(R.bookedTime(ride)));
      const signal = signals.indication(ride), cue = byId('signal-cue');
      cue.hidden = !signal;
      if (signal) { write('signal-cue', signal.text); cue.dataset.aspect = String(signal.aspect); }
    }

    function refreshPower() {
      const { drawn, returned, power } = ride.meter;
      const kw = Math.round(power);
      write('power-value', (kw > 0 ? '+' : '') + kw + ' kW');
      byId('power-value').classList.toggle('returning', kw < 0);
      const bar = byId('power-bar');
      bar.classList.toggle('returning', kw < 0);
      bar.style.width = Math.min(50, Math.abs(kw) / 30) + '%';
      write('energy-drawn', drawn.toFixed(2));
      write('energy-returned', returned.toFixed(2));
      byId('coast').setAttribute('aria-pressed', String(ride.coasting));
    }

    function refreshPassengers() {
      const { car } = ride, { call } = car, aboard = passengers.load(car);
      write('load-value', aboard + ' / ' + passengers.CAPACITY);
      byId('load-fill').style.width = (100 * aboard / passengers.CAPACITY) + '%';
      const next = R.nextStation(ride.last);
      const waiting = call.queue.length - call.boarded;
      const leaving = car.destinations[call.station];
      let instruction;
      if (ride.berth === null) instruction = car.destinations[next] + ' to alight at ' + R.STATIONS[next].name;
      else if (call.crossing) instruction = (call.crossing.boarding ? 'Boarding' : 'Alighting') + ' · ' + waiting + ' waiting';
      else if (waiting && aboard === passengers.CAPACITY && !leaving) instruction = 'Carriage full · ' + waiting + ' waiting';
      else if (waiting || leaving) instruction = leaving + ' to alight · ' + waiting + ' waiting';
      else instruction = 'Boarding complete';
      write('exchange-state', instruction);
      byId('campus-group').hidden = ride.berth !== 1 || call.boarded >= 3;
    }

    function driveHint() {
      if (ride.guard.enabled && ride.berth !== null) return 'Press V to watch the platform exchange and the guard lamp above the doors.';
      if (ride.coasting) return 'Press C to resume your ' + ride.target + ' km/h target.';
      if (ride.berth === null && signals.secondsToClear(ride)) return 'Set a target to continue when the signal clears.';
      if (ride.manual) return 'Press Space at the brake cue. Stop within 1 m of the S board.';
      if (ride.phase === 'ready') return 'Press ↑ to depart or D to open the doors. Stops are automatic.';
      if (ride.berth !== null) return 'Select zero to stay at the platform after boarding.';
      return 'Press C to coast. Assisted stops brake automatically.';
    }

    return function refresh(online) {
      const status = !online ? 'Offline' : ride.paused ? 'Paused' : 'In service';
      write('speed-value', String(Math.round(ride.speed * 3.6)).padStart(2, '0'));
      write('target-value', String(ride.target));
      write('drive-state', online ? R.driveState(ride) : 'Offline');
      write('door-state', R.doorState(ride));
      segments.forEach((el, i) => el.classList.toggle('on', (i + 1) * 10 <= ride.target));
      write('service-text', status);
      write('feed-text', status === 'In service' ? 'Live' : status);
      byId('service-status').classList.toggle('idle', !online || ride.paused);
      byId('feed-label').classList.toggle('idle', !online || ride.paused);
      byId('pause-screen').hidden = !online || !ride.paused;
      write('pause-label', ride.paused ? 'Resume' : 'Pause');
      byId('manual-mode').setAttribute('aria-pressed', String(ride.manual));
      byId('rain-toggle').setAttribute('aria-pressed', String(ride.weather.rain));
      write('rain-label', ride.weather.rain ? 'Rain on' : 'Rain off');
      byId('track-caption').hidden = !online || ride.paused;
      write('track-place', R.locationName(ride.position));
      const showMark = ride.manual && (ride.berth !== null || !signals.secondsToClear(ride));
      byId('brake-cue').hidden = !showMark;
      const pointer = showMark ? R.gaugePosition(ride) : null;
      byId('brake-gauge').hidden = pointer === null;
      if (pointer !== null) byId('brake-pointer').style.left = (50 + 50 * pointer).toFixed(1) + '%';
      if (showMark) {
        const cue = R.brakeCue(ride);
        write('brake-cue', cue);
        byId('brake-cue').classList.toggle('urgent', cue === 'Brake now' || ride.protection);
      }
      write('drive-hint', driveHint());
      const caption = online && camera?.goalSeat === 1;
      byId('saloon-caption').hidden = !caption;
      if (caption) {
        const message = saloon.message(ride);
        write('saloon-english', message.english); write('saloon-chinese', message.chinese);
      }
      refreshRoute();
      refreshTimetable();
      refreshWorking(online);
      refreshHistory();
      refreshPower();
      refreshPassengers();
      refreshDuty(online);
    };
  }

  Nightline.instruments = { bind };
})();
