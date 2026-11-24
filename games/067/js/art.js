(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EmberArt = factory();
})(globalThis, function () {
  "use strict";

  // Each row is one line of an original pixel drawing. A dot is transparent.
  const drawings = {
    coin: [
      ["#68432f", "#ad642e", "#e69a42", "#ffd177", "#fff0af"],
      `.........####...
       .......##ddbb#..
       ......#dedbcab#.
       ......#dcdccab#.
       ......#dbdccab#.
       ......#dbcdbab#.
       ...######bcbab#.
       .##deeddc##ba#..
       #ddccccccdd##...
       #bdddcccddb#....
       #abbbbbbcca#....
       .##aaaaaa##.....
       #cc######dc#....
       #bccccccccb#....
       .##abbbba##.....
       ...######.......`
    ],
    gem: [
      ["#4f3f66", "#735186", "#9b73b1", "#c6a0db", "#e5cbee", "#fff0fc"],
      `.......##.......
       ......#ed#......
       .....#fedd#.....
       ....#eedcbb#....
       ...#eedccbbb#...
       ..#eedcccbbba#..
       .#eeedcccbbbaa#.
       #eddddddccccbaa#
       .#dccccccbbbaa#.
       ..#dcccccbbba#..
       ...#dcccbbaa#...
       ....#dccbaa#....
       .....#dcba#.....
       ......#ca#......
       .......##.......`
    ],
    sprout: [
      ["#3f5541", "#587c51", "#89aa64", "#b1c87a", "#dfda94", "#a36e49", "#d69862"],
      `..........#####.
       .........#eddd#.
       .#####..#dddcc#.
       .#edcc##dcccb#..
       ..#dccb#bccb#...
       ...#ccbabbb#....
       ....##bab##.....
       ......#b#.......
       ......#b#.......
       ...##########...
       ...#gggggggg#...
       ...#ffffffgg#...
       ....#gfffgg#....
       ....#ggfffg#....
       .....#ffff#.....
       ......####......`
    ],
    bottle: [
      ["#3d4b60", "#547389", "#6b9daf", "#8cc4c6", "#c4e6d3", "#a47048", "#e4ad75"],
      `.....######.....
       .....#ggff#.....
       .....#ffff#.....
       ....#eeeeed#....
       .....#edcc#.....
       .....#edcc#.....
       ....#eedccc#....
       ...#eedddccb#...
       ..#eedddcccbb#..
       ..#edeeddccbb#..
       ..#edcccddcbb#..
       ..#edcccccbbb#..
       ..#dccccccbbb#..
       ...#dccccbbb#...
       ....#bbbbbba#...
       .....######.....`
    ],
    scroll: [
      ["#70523d", "#ac8052", "#cba870", "#e9c995", "#fff0bb", "#a65348", "#dc8168"],
      `...##########...
       ..#eeeeddccba#..
       ..#e##eddcbab#..
       ..#e#ddcccb##...
       ...#eedccc#.....
       ....#edccc#.....
       ....#gffff#.....
       ....#fggff#.....
       ....#edcccb#....
       ....#eeddccb#...
       .....#eedccb#...
       ..####eedccb##..
       .#eeeeddcccbaa#.
       .#e##ddcccba#a#.
       ..#bbccccbaa##..
       ...#########....`
    ],
    chest: [
      ["#553a36", "#81503c", "#ad6742", "#d98b50", "#f6bd63", "#ffe3a2", "#f1a052"],
      `...##########...
       ..#ddccccccee#..
       .#eddcbbbbcedd#.
       #deccbbbbbcdddc#
       #ddccbbbbbcdcc c#
       #ddccbbbbbcdccc#
       ################
       #deeddddeeddddc#
       #cccc##eed##ccb#
       #bbcc#eeed#ccab#
       #abcc#d#dd#ccab#
       #abcc#dddd#ccab#
       #abccc####cccab#
       #ddccbbbbbbcddd#
       .##############.`
    ],
    flame: [
      ["#a35b43", "#d87645", "#ed9453", "#ffba65", "#ffdb80", "#fff0ae", "#ca9b76", "#916954"],
      `.........cc.....
       ........ccc.....
       .......ccbc.....
       .......ccbcc....
       .....b.ccdbcc...
       .....bbccddcc.c.
       ....bbccdddcccc.
       ..b.bccddeddbcc.
       ..bbccdddeeddbc.
       .bbccddeeeeddbb.
       .bbccdeefeeeddb.
       .bbccdefffeedcb.
       ..bbcceffeedcc..
       ...bbccdddccb...
       ....bbbbbbbb....
       ..ggghh..hhggg..
       .hhggggggggghhh.
       ...hhhggggghh...
       .ggggghhhgggggg.
       .hhhh.....hhhhh.`
    ],
    pennant: [
      ["#473d49", "#896342", "#c59260", "#376765", "#63a092", "#f2bb71", "#ffe5ad"],
      `....##............
       ...#gg#...........
       ....##............
       ....#c##########..
       ....#c#feeeeedd#..
       ....#c#ffeeddd#...
       ....#c#ggffdd#....
       ....#c#eefgddd#...
       ....#c#deeffddd#..
       ....#c##########..
       ....#c#...........
       ....#c#...........
       ....#b#...........
       ....#b#...........
       ...#ccc#..........
       ..#######.........`
    ],
    trophy: [
      ["#775339", "#a27840", "#d59a4e", "#eeb661", "#ffcf81", "#ffe7a3"],
      `...##########...
       .###eeddddcc###.
       #dd#eeddddcc#dd#
       #c.#eeddddcc#.c#
       #c.#edddddcc#.c#
       .#cc#ddddcc#cc#.
       ..###ddccc####..
       ....##dcc##.....
       ......#cc#......
       ......#dc#......
       .....#ddcc#.....
       ...##ddcccc##...
       ...#eeddddcc#...
       ...##########...`
    ],
    pack: [
      ["#4b4148", "#735144", "#a16e52", "#bd8b62", "#e0ad7a", "#89a992", "#b8caba"],
      `......#####.....
       .....#eddcc#....
       .....#c###c#....
       ...##########...
       ..#ffeeeeefbb#..
       .#ffeeeeefebbb#.
       .#feffffeffbbb#.
       .#dfffffffcbbb#.
       .#c##dd##ccbbb#.
       .#cccdeccccbb##.
       ##cccddccccbbdb#
       #d#ccccccc#bbcb#
       #c#ddddddd#bbcb#
       .##ccceecc#bb##.
       ..#ccccccc#bb#..
       ..#bbbbbbbbbb#..
       ...##########...`
    ]
  };

  const paths = {
    overview: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/>',
    habits: '<rect x="5" y="4.5" width="14" height="16.5" rx="2.5"/><rect x="8.5" y="2.5" width="7" height="4" rx="1.2"/><path d="m8.5 13 2.4 2.4 4.6-5"/>',
    statistics: '<path d="M4 4v16h17M8 16v-5m5 5V6m5 10v-7"/>',
    rewards: '<path d="M3 12V9a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v3M3 11h18v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM7.5 5v6m9-6v6"/><rect x="10" y="10.5" width="4" height="4.5" rx=".7"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M7.5 3v4m9-4v4M3 10h18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    left: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
    right: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    check: '<path d="m4.5 12 5 5 10-10"/>',
    book: '<path d="M3 4.8c3.5-.9 6.5-.3 9 1.4 2.5-1.7 5.5-2.3 9-1.4v14c-3.4-.9-6.5-.4-9 1.4-2.5-1.8-5.6-2.3-9-1.4zM12 6.2v14"/>',
    boot: '<path d="m4.5 5.5 6.5.4.4 5.1 3.7 2.3 3.6.2c1.7.1 2.8 1.8 2.8 3.5v1H3.5v-4zM4 20h17M10.5 9l2.5-.5m-1.7 3.1 2.7-.7"/>',
    drop: '<path d="M12 2.5c-2 3.8-7.2 9-7.2 12.3a7.2 7.2 0 1 0 14.4 0c0-3.3-5.2-8.5-7.2-12.3zM8 15a4 4 0 0 0 3.4 3.4"/>',
    pencil: '<path d="m4 16-1 5 5-1 12-12-4-4zM13.5 6.5l4 4M4 16l4 4m8-16 1.4-1.4a1.8 1.8 0 0 1 2.5 0l1.5 1.5a1.8 1.8 0 0 1 0 2.5L20 8"/>',
    leaf: '<path d="M20 3c-7 0-15 1-15 10 0 3.5 2.5 6 6 6 8 0 9-9 9-16zM3 21 15 9"/>',
    moon: '<path d="M20.5 14a8.8 8.8 0 0 1-11-11A9.3 9.3 0 1 0 20.5 14z"/>',
    cup: '<path d="M3 8h13v6a6.5 6.5 0 0 1-13 0zM16 9h2a3 3 0 0 1 0 6h-2M3 21h16M7 3v2m4-3v3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>',
    fire: '<path d="M12 2c1 5-3.5 6-2 10 2-1 3.5-2.5 4-5 3 3 5 6 5 9a7 7 0 0 1-14 0c0-4 4-7 7-14z"/>',
    settings: '<path d="m9.5 3-.7 2.6-2.2 1.3L4 6.3 2.5 9l1.9 2v2l-1.9 2L4 17.7l2.6-.6 2.2 1.3.7 2.6h5l.7-2.6 2.2-1.3 2.6.6 1.5-2.7-1.9-2v-2l1.9-2L20 6.3l-2.6.6-2.2-1.3-.7-2.6z"/><circle cx="12" cy="12" r="3"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    edit: '<path d="m4 15-1 6 6-1L20 9l-5-5zM13 6l5 5"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    flag: '<path d="M5 21V3m0 1c5-4 9 4 15 0v9c-6 4-10-4-15 0"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>'
  };

  function symbol(id, [palette, picture]) {
    const rows = picture.split("\n").map(row => row.replace(/\s/g, ""));
    const width = Math.max(...rows.map(row => row.length));
    const regions = new Map();
    // The outline and first shade share an ink for a cohesive, small-scale silhouette.
    const ink = char => char === "#" ? palette[0] : palette[char.charCodeAt(0) - 97];
    rows.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        const char = row[x];
        let end = x + 1;
        while (row[end] === char) end++;
        if (char !== ".") {
          const color = ink(char);
          if (!color) throw new Error("Unknown pixel color in " + id);
          regions.set(color, (regions.get(color) || "") + `M${x} ${y}h${end-x}v1h-${end-x}z`);
        }
        x = end;
      }
    });
    const shapes = [...regions].map(([color, path]) => `<path fill="${color}" d="${path}"/>`).join("");
    return `<symbol id="px-${id}" viewBox="-1 -1 ${width+2} ${rows.length+2}">${shapes}</symbol>`;
  }

  function definitions() {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true"><defs>' +
      Object.entries(drawings).map(([id, drawing]) => symbol(id, drawing)).join("") + "</defs></svg>";
  }

  function pixel(id, className = "") {
    return `<svg class="pixel ${className}" aria-hidden="true" focusable="false" shape-rendering="crispEdges"><use href="#px-${id}"/></svg>`;
  }

  function icon(id, className = "") {
    return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[id]}</svg>`;
  }

  const lettering = {
    0: ["01110","11011","11011","11011","11011","11011","01110"],
    1: ["0110","1110","0110","0110","0110","0110","1111"],
    2: ["01110","11011","00011","00110","01100","11000","11111"],
    3: ["11110","00011","00011","01110","00011","00011","11110"],
    4: ["00110","01110","11010","11010","11111","00010","00010"],
    5: ["11111","11000","11110","00011","00011","11011","01110"],
    6: ["00110","01100","11000","11110","11011","11011","01110"],
    7: ["11111","00011","00110","00110","01100","01100","01100"],
    8: ["01110","11011","11011","01110","11011","11011","01110"],
    9: ["01110","11011","11011","01111","00011","00110","01100"],
    d: ["00011","00011","01111","11011","11011","11011","01111"],
    a: ["00000","00000","01110","00011","01111","11011","01111"],
    y: ["00000","00000","11011","11011","11011","11011","01111","00011","11110"],
    s: ["0000","0000","0111","1100","0110","0011","1110"],
    t: ["0100","1100","1111","1100","1100","1100","0111"],
    r: ["0000","0000","1101","1111","1100","1100","1100"],
    e: ["00000","00000","01110","11011","11111","11000","01111"],
    k: ["11000","11000","11011","11110","11100","11110","11011"]
  };

  function streakTitle(count) {
    let advance = 0;
    let path = "";
    for (const char of `${count} day streak`) {
      if (char === " ") { advance += 2; continue; }
      const glyph = lettering[char];
      glyph.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          if (row[x] === "1") path += `M${advance+x} ${y}h1v1h-1z`;
        }
      });
      advance += glyph[0].length + 1;
    }
    return `<svg class="streak-lettering" aria-hidden="true" viewBox="0 0 ${advance-1} 9" width="${(advance-1)*5}" height="45" shape-rendering="crispEdges"><path d="${path}" fill="currentColor"/></svg>`;
  }

  return { definitions, pixel, icon, streakTitle };
});
