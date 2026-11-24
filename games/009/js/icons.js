(function (root) {
  "use strict";

  // Original 24-unit line drawings. Only the interface uses a 2D canvas.
  const paths = {
    brand: "M3 18h6c3 0 6-2 8-5s2-7-1-8-6 1-7 4 0 6 3 8 6 2 9 1 M3 21h7",
    keyboard: "M3 5.5h18v13H3z M6 9h1m3 0h1m3 0h1m3 0h.1 M6 12h.1m3 0h1m3 0h1m3 0h1 M8 15.5h8",
    folder: "M2.5 7V5h7l2.3 2H21v3 M3 10h19l-2.7 9H3z",
    down: "M6 9l6 6 6-6",
    loop: "M2 18h5c6 0 11-5 11-10 0-3-2-5-5-5-4 0-7 4-7 8 0 5 4 8 10 8h6",
    bend: "M4 19v-5a8 8 0 0 1 8-8h6 M9 19v-5a3 3 0 0 1 3-3h6 M16 3l4 3-4 3",
    plus: "M12 5v14M5 12h14",
    minus: "M5 12h14",
    pieces: "M3 7l6-3 6 3-6 3z M3 7v7l6 3v-7 M9 17l6-3V7 M12 15l4 2 5-2.5 M15 10.5l6 3v5L16 21l-5-2.5V16",
    ruler: "M2.5 15.5l13-13 6 6-13 13z M7 11l2 2m1-5 2 2m1-5 2 2",
    undo: "M9 4l-6 6 6 6 M4 10h10a6 6 0 0 1 6 6v3",
    redo: "M15 4l6 6-6 6 M20 10H10a6 6 0 0 0-6 6v3",
    cube: "M12 2.5l9 5v9l-9 5-9-5v-9z M3 7.5l9 5 9-5 M12 12.5v9",
    fit: "M3.5 9V3.5H9 M15 3.5h5.5V9 M20.5 15v5.5H15 M9 20.5H3.5V15",
    drop: "M12 2v6m-3-3 3 3 3-3 M12 11a4 4 0 1 0 0 8 4 4 0 1 0 0-8 M3 16v5h18v-5",
    pause: "M8 5v14m8-14v14",
    play: "M7 4.5L19 12 7 19.5z",
    step: "M5 5l10 7-10 7z M19 5v14",
    heat: "M4 21V4m0 1c5-4 10 4 16 0v9c-6 4-11-4-16 0 M8 5v8m5-7v9m4-9v9",
    reset: "M3 4v6h6 M3.7 10a8 8 0 1 1 .8 6",
    library: "M3 5h4v14H3z M10 5h4v14h-4z M16 6l3-1 3 13-3 1z",
    remove: "M9 5h12v14H9l-7-7z M12 9l6 6m0-6-6 6",
    marble: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18 M4 15c5 1 11-4 12-10 M7 19c5 0 12-5 13-11",
    mouse: "M7 10a5 5 0 0 1 10 0v5a5 5 0 0 1-10 0z M12 5v6 M2 10l-1 2 1 2m20-4 1 2-1 2",
    scroll: "M6 9a6 6 0 0 1 12 0v6a6 6 0 0 1-12 0z M12 6v4",
    gravity: "M8 3v14m-4-4 4 4 4-4 M16 5v8m-2-2 2 2 2-2 M3 21h18",
    timer: "M12 6a7.5 7.5 0 1 0 0 15 7.5 7.5 0 1 0 0-15 M12 6V3m-3 0h6m3 4 2-2 M12 10v4l3 1",
    split: "M4 20V6h3v14m10 0V6h3v14 M8 10h2m2 0h2 M2 21h7m6 0h7",
    ghost: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M4 13l9-9m-6 14 13-13m-8 15 8-8",
    drive: "M3 5l6 7-6 7m7-14 6 7-6 7m7-14 5 7-5 7",
    jump: "M2 17h3q4 0 6-4v5H2z M15 16l7 1v2h-7z M8 10q2-3 5-3m3 1 2 2",
    blueprint: "M3 4l6 2 6-2 6 2v14l-6-2-6 2-6-2z M9 6v14m6-16v14",
    copy: "M8 8h12v13H8z M5 16H3V3h12v2",
    close: "M5 5l14 14m0-14L5 19"
  };

  function draw(element) {
    const name = element.dataset.icon;
    if (!Object.hasOwn(paths, name)) return;
    let canvas = element;
    if (element.tagName !== "CANVAS") {
      canvas = element.querySelector("canvas") || document.createElement("canvas");
      if (!canvas.parentNode) element.append(canvas);
    }
    element.setAttribute("aria-hidden", "true");
    const size = name === "brand" ? 80 : 48;
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(size / 24, size / 24);
    ctx.strokeStyle = name === "brand" ? "#19382e" : getComputedStyle(element).color;
    ctx.lineWidth = name === "pause" ? 3.4 : name === "brand" ? 1.8 : 1.65;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke(new Path2D(paths[name]));
    if (name === "brand") {
      ctx.beginPath();
      ctx.arc(6.3, 13.7, 2, 0, Math.PI * 2);
      ctx.fillStyle = "#19382e";
      ctx.fill();
    }
  }

  function axis(canvas, view) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const origin = [28, 26];
    const axes = [
      {k: 0, name: "X", color: "#b56549"},
      {k: 1, name: "Y", color: "#528168"},
      {k: 2, name: "Z", color: "#62829a"}
    ];
    ctx.setTransform(canvas.width / 59, 0, 0, canvas.height / 51, 0, 0);
    ctx.clearRect(0, 0, 59, 51);
    ctx.lineCap = "round";
    ctx.lineWidth = 1.5;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 8px Consolas, monospace";
    for (const {k, name, color} of axes.sort((a, b) => view.out[a.k] - view.out[b.k])) {
      const x = view.right[k], y = -view.up[k];
      const endX = origin[0] + 17 * x, endY = origin[1] + 17 * y;
      ctx.strokeStyle = ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(...origin);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.fillText(name, origin[0] + 24 * x, origin[1] + 24 * y);
    }
    ctx.beginPath();
    ctx.arc(...origin, 2, 0, Math.PI * 2);
    ctx.fillStyle = "#516255";
    ctx.fill();
  }

  root.FoundryIcons = {draw, axis};
})(globalThis);
