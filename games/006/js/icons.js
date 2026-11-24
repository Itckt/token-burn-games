(function () {
  'use strict';
  // Original 24-unit pictograms. Canvas keeps these sharp at the display's pixel ratio.
  const paths = {
    clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 6v6l4 2',
    rain: 'M6 14a4 4 0 0 1-.2-8A6 6 0 0 1 17 6a4 4 0 1 1 1 8z M7 17l-2 4m8-4-2 4m8-4-2 4',
    brand: 'M3.5 17.5 9 7.9Q10 6 12 6h8.4M7 19l5.1-9q.5-1 1.6-1H20M11 19l3.6-6.2q.5-.8 1.4-.8h3.8',
    muted: 'M3 9h4l5-4v14l-5-4H3z M16 9l6 6m0-6-6 6',
    sound: 'M2 9h4l5-4v14l-5-4H2z M15 8q4 4 0 8m3-11q7 7 0 14',
    expand: 'M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5',
    collapse: 'M9 3v6H3m12-6v6h6M3 15h6v6m12-6h-6v6',
    camera: 'M3 7h3l2-3h6l2 3h4v13H3z M14.8 13a3.3 3.3 0 1 1-6.6 0 3.3 3.3 0 0 1 6.6 0',
    pan: 'M6 12V6.5a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5.7a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0V16q0 5-5 5h-1q-3 0-5-2.5l-4-5q-1.5-2 1-2.7L7 13',
    play: 'M7 4.5 19 12 7 19.5z',
    drive: 'M13.5 2 5 13h6l-.8 9L19 10.5h-6.4z',
    doors: 'M3 3.5h18v17H3z M12 4v16 M8.5 10v4m7-4v4',
    loop: 'M5 8q1.8-4 7-4h5l3 3m0-4v4h-4 M19 16q-1.8 4-7 4H7l-3-3m0 4v-4h4',
    keyboard: 'M2 5.5h20v13H2z M5.5 9h.8m2.8 0h.8m2.8 0h.8m2.8 0h.8m2.8 0h.5 M6 12h1m3 0h1m3 0h1m3 0h.5 M7.5 15h9',
    arrowCorner: 'M6 18 18 6M7 6h11v11',
    info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v5m0-9v.3',
    pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z M14.3 10a2.3 2.3 0 1 1-4.6 0 2.3 2.3 0 0 1 4.6 0',
    close: 'M5 5l14 14m0-14L5 19'
  };

  function draw(canvas, name = canvas.dataset.icon) {
    const context = canvas.getContext('2d');
    if (!context || !paths[name]) return;
    canvas.dataset.icon = name;
    const size = canvas.getBoundingClientRect().width || 18;
    const pixels = Math.ceil(size * Math.min(window.devicePixelRatio || 1, 3));
    canvas.width = canvas.height = pixels;
    context.scale(pixels / 24, pixels / 24);
    context.lineJoin = context.lineCap = 'round';
    context.lineWidth = name === 'brand' ? 2.5 : 1.65;
    context.strokeStyle = getComputedStyle(canvas).color;
    context.stroke(new Path2D(paths[name]));
  }

  Nightline.icons = { draw };
})();
