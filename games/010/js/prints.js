/* Original spot illustrations for the printed order slips. Coordinates are
   shared between the full-size illustration and its little index thumbnail. */
(function () {
  'use strict';
  const ink = '#334c40', cream = '#fff2d7', jade = '#79a98f', dark = '#41745f';
  const red = '#b94d35', warm = '#c18b56';
  function path(c, d, fill, stroke = ink, weight = 2) {
    const p = new Path2D(d);
    if (fill) { c.fillStyle = fill; c.fill(p); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = weight; c.stroke(p); }
  }
  function ellipse(c,x,y,rx,ry,fill,stroke = null,weight = 2) {
    c.beginPath(); c.ellipse(x,y,rx,ry,0,0,Math.PI*2);
    if (fill) { c.fillStyle=fill; c.fill(); }
    if (stroke) { c.strokeStyle=stroke; c.lineWidth=weight; c.stroke(); }
  }
  function shadow(c,x,y,rx,ry) {
    ellipse(c,x,y,rx,ry,'rgba(143,111,67,.11)');
    c.save(); c.beginPath(); c.ellipse(x,y,rx,ry,0,0,Math.PI*2); c.clip();
    c.beginPath();
    for (let i=-rx-12; i<rx+14; i+=4) {
      c.moveTo(x+i,y+ry); c.lineTo(x+i+12,y-ry);
    }
    c.strokeStyle='rgba(130,104,65,.20)'; c.lineWidth=.7; c.stroke(); c.restore();
  }
  function glimmer(c,x,y,r) {
    c.save(); c.translate(x,y); c.scale(r,r);
    path(c,'M0 -1 Q0 -.12 .74 0 Q.08 .08 0 1 Q-.06 .1 -.74 0 Q-.07 -.1 0 -1Z',red,null);
    c.restore();
  }
  function saucer(c) {
    path(c,'M42 109 C45 98 76 93 116 93 C160 93 184 99 185 108 C186 119 155 129 116 129 C76 130 44 121 42 109Z','#dfd4b2');
    ellipse(c,113,107,71,17,cream,ink,2.1);
    path(c,'M49 108 C58 116 86 122 115 121 C148 120 172 115 179 107',null,dark,2);
    path(c,'M55 104 Q69 98 88 99 M150 99 Q162 100 168 103',null,'#b5ac8d',1.2);
  }
  function cup(c) {
    shadow(c,125,123,72,10);
    saucer(c);
    path(c,'M147 65 C169 49 181 60 177 76 C174 92 159 102 142 102 L143 94 C156 93 168 81 169 72 C170 64 164 62 150 73Z',cream);
    path(c,'M151 96 C165 93 176 78 174 68',null,'#b9b398',1.2);
    path(c,'M71 60 C73 79 76 103 90 112 C100 119 129 119 139 107 C148 94 150 73 154 59Z',cream,ink,2.6);
    path(c,'M80 84 C87 105 94 111 108 113 C125 116 136 105 142 91 C136 111 130 118 110 117 C89 117 83 106 80 84Z','#d9d4b2',null);
    path(c,'M73 68 C88 79 137 82 151 66 L150 71 C135 85 91 85 74 74Z',jade,dark,1.1);
    path(c,'M76 78 C92 88 135 87 148 75',null,dark,1.4);
    ellipse(c,112.4,60,41.9,12.7,cream,ink,2.2);
    ellipse(c,112.6,60.4,36.9,8.9,'#bd804e',ink,1.5);
    path(c,'M79 62 Q88 50 120 54 Q139 55 147 60 C136 52 96 54 85 63Z','#935c3b',null);
    path(c,'M89 62 C97 58 114 58 127 61 M124 65 Q137 65 140 61',null,'#ebbe83',1.6);
    path(c,'M84 85 Q86 95 91 100 M138 86 L135 94 M140 88 L137 96 M135 95 L131 102',null,'#aaac8c',1);
    // The café's four-petal porcelain mark.
    for (let i=0;i<4;i++) {
      const a=i*Math.PI/2; ellipse(c,111+3.4*Math.cos(a),96+3.4*Math.sin(a),2.7,2.7,dark);
    }
    ellipse(c,111,96,2,2,'#e0ac63');
    path(c,'M95 46 C103 39 87 35 96 24 M110 44 C122 35 103 32 111 21 C116 14 116 11 114 7 M127 44 C134 39 122 34 130 27',null,'#a87b50',1.8);
    glimmer(c,62,48,6); glimmer(c,169,40,4);
  }
  function booth(c) {
    shadow(c,119,119,80,12);
    path(c,'M44 90 L118 108 L178 86 L177 104 L119 128 L46 110Z','#a2734c');
    path(c,'M49 100 L119 118 L175 96 M119 118 L119 126',null,'#dec18b',1.7);
    path(c,'M40 85 Q39 80 45 78 L97 59 L178 77 Q184 81 179 87 L121 111 Q117 113 110 110 L45 95 Q40 94 40 85Z',jade);
    path(c,'M42 85 L114 102 Q119 104 124 102 L177 81',null,cream,1.8);
    path(c,'M44 80 L42 49 Q42 42 49 39 L103 20 Q110 17 114 22 L120 58 Q122 63 116 66 L57 90Z',dark);
    path(c,'M49 79 L47 48 Q47 45 53 43 L103 26 Q109 24 110 29 L114 58 Q114 62 110 64 L56 84Z','#88b296',ink,1.7);
    for (let i=0;i<7;i++) {
      const x=53+i*8.2,y=43-i*2.8;
      path(c,'M'+x+' '+y+' q-2 5 0 16 l2 18',null,'#517d65',1.8);
      path(c,'M'+(x+2)+' '+(y+1)+' l1 16',null,'#b9caaa',1.1);
    }
    path(c,'M44 83 L57 87 L119 65 M47 103 L53 105 L53 111',null,'#d7b078',2);
    glimmer(c,139,40,6);
  }
  function bun(c) {
    shadow(c,122,120,75,10);
    saucer(c);
    path(c,'M59 91 C61 64 82 44 113 42 C146 38 167 59 171 86 C173 99 158 108 137 112 C104 119 67 113 59 99Z','#bf7944',ink,2.4);
    path(c,'M60 85 C61 62 84 40 116 40 C144 39 164 55 170 79 L167 87 L160 88 L157 95 L148 93 L138 101 L129 98 L117 104 L107 100 L98 104 L89 96 L78 97 L72 90 L66 92Z','#e4aa59',ink,2.2);
    path(c,'M65 72 Q88 54 107 42 M66 87 Q94 65 129 42 M78 95 Q113 68 148 48 M99 100 Q132 76 160 59 M127 98 Q151 82 167 73 M83 52 Q107 65 156 92 M70 64 Q96 78 133 99 M99 44 Q122 54 167 79 M124 42 Q141 50 160 61',null,'#ab703a',2.5);
    path(c,'M72 71 L87 61 M102 65 L121 53 M121 77 L141 63 M90 87 L101 80 M142 86 L157 77',null,'#f4ce83',2.2);
    path(c,'M72 100 Q89 110 105 110 M136 107 L146 104 M147 101 L154 98',null,'#855f3e',1.4);
    glimmer(c,52,53,6); glimmer(c,168,44,4);
  }
  function clock(c) {
    shadow(c,120,127,50,7);
    ellipse(c,123,75,49,53,'#985b40',ink,2.4);
    ellipse(c,118,72,50,54,'#c76748',ink,2.5);
    ellipse(c,118,72,44.5,48.5,'#e6c590',ink,1.7);
    ellipse(c,118,72,41,45,cream,ink,1.5);
    c.save(); c.translate(118,72); c.scale(.92,1);
    for (let i=0;i<60;i++) {
      c.save(); c.rotate(i*Math.PI/30); c.strokeStyle=ink; c.lineWidth=i%5 ? .8 : 2;
      c.beginPath(); c.moveTo(0,-41); c.lineTo(0,i%5 ? -39 : -35); c.stroke(); c.restore();
    }
    c.font='bold 12px Georgia, serif'; c.textAlign='center'; c.textBaseline='middle'; c.fillStyle=ink;
    for (const [n,x,y] of [['12',0,-26],['3',28,0],['6',0,27],['9',-28,0]]) c.fillText(n,x,y);
    path(c,'M0 0 L20 5 M0 0 L0 28',null,ink,3.2);
    path(c,'M4 2 L-24 -11',null,red,1.3); ellipse(c,0,0,3.5,3.5,red);
    c.restore(); glimmer(c,54,42,5);
  }
  function urn(c) {
    shadow(c,125,126,52,8);
    path(c,'M83 115 L83 122 Q116 137 151 123 L150 115Z',dark);
    ellipse(c,116,115,35,10,'#b7bea8',ink,2);
    path(c,'M78 51 Q76 47 82 44 Q117 32 150 46 L151 108 Q150 119 116 121 Q84 120 79 111Z','#acbcac',ink,2.5);
    path(c,'M85 56 L85 105 Q88 111 94 111 L92 54Z','#dce0c6',null);
    path(c,'M137 56 L136 115 L145 111 L146 53Z','#7c9585',null);
    path(c,'M79 59 Q113 73 150 57 M80 103 Q110 117 150 101',null,cream,3);
    path(c,'M79 62 Q113 76 150 60 M81 106 Q110 119 150 104',null,dark,1.3);
    path(c,'M73 51 Q74 44 84 42 Q96 33 114 32 Q136 32 147 42 Q158 44 156 50 C146 63 84 64 73 51Z','#c7d0ba',ink,2.3);
    path(c,'M82 46 Q113 58 150 46',null,'#708978',1.4);
    ellipse(c,115,31,7,4,ink); ellipse(c,115,28,7,4,dark,ink,1.5);
    path(c,'M79 64 Q67 59 67 69 L69 78 L78 79 M150 64 Q162 58 162 68 L160 76 L151 78',null,ink,4);
    path(c,'M95 72 Q112 77 127 73 L127 91 Q111 95 96 91Z','#efd6a1','#9e7950',1.2);
    c.font='bold 11px serif'; c.fillStyle=red; c.textAlign='center'; c.fillText('熱茶',111,86);
    path(c,'M102 101 L95 107 L88 104 L84 110',null,ink,5);
    path(c,'M102 101 L95 107 L88 104 L84 110',null,'#c69a56',3);
    path(c,'M95 104 L95 97 M89 97 L101 97',null,ink,2.6);
    path(c,'M110 19 Q104 14 110 9 M122 20 Q128 15 123 10',null,'#ab8058',1.6);
    glimmer(c,57,46,5);
  }
  function cat(c) {
    shadow(c,120,115,75,13);
    path(c,'M51 96 C50 78 69 59 94 58 C112 56 129 63 137 74 C151 80 163 92 159 104 C150 119 113 123 80 118 C60 117 49 110 51 96Z','#d5a069',ink,2.4);
    path(c,'M62 95 C56 109 84 116 102 108 C111 104 118 104 121 109 C123 114 113 120 102 121 C85 125 61 123 52 113 C44 105 45 93 53 85',null,ink,8);
    path(c,'M62 95 C56 109 84 116 102 108 C111 104 118 104 121 109 C123 114 113 120 102 121 C85 125 61 123 52 113 C46 105 46 94 53 85',null,'#c38e5c',4.8);
    path(c,'M63 76 Q70 78 73 89 L67 84 M74 67 Q84 69 88 81 L81 76 M88 61 Q99 64 103 76 L95 69','#a67449',null);
    path(c,'M116 80 L115 48 Q116 44 119 47 L134 60 Q146 57 156 60 L173 47 Q178 45 175 52 L171 78 C177 95 163 106 147 108 C127 109 112 100 116 80Z','#dfaa72',ink,2.4);
    path(c,'M119 52 L121 67 L130 61Z M162 62 L171 54 L168 69Z','#d49377',null);
    path(c,'M131 98 Q127 91 135 88 Q143 88 146 92 Q151 88 156 90 Q163 94 157 99 Q144 109 131 98Z','#f4d9ad',null);
    path(c,'M125 83 Q131 88 136 82 M153 83 Q158 88 163 81 M143 90 L147 90 L145 93Z',null,ink,2);
    path(c,'M145 93 Q145 98 140 97 M145 93 Q147 97 151 96 M131 91 L113 88 M131 94 L113 95 M158 92 L177 87 M158 95 L178 95',null,ink,1.2);
    path(c,'M138 60 L141 72 L143 61 M146 61 L148 71 L152 60Z','#af7b4f',null);
    ellipse(c,131,108,11,6,'#efd3a6',ink,1.5); ellipse(c,153,106,10,5,'#efd3a6',ink,1.5);
    path(c,'M129 109 L129 112 M134 108 L135 111 M153 106 L154 109',null,'#a38662',1);
    glimmer(c,87,41,5);
  }

  function fan(c) {
    shadow(c,119,126,51,7);
    path(c,'M83 116 Q87 111 110 110 L135 110 Q151 110 157 117 L157 122 Q126 132 83 124Z',dark);
    path(c,'M85 116 Q91 111 110 109 L137 109 Q150 110 155 117 Q128 126 85 119Z',jade);
    path(c,'M107 113 Q113 104 111 78 L123 76 Q122 99 129 111 Q119 117 107 113Z',jade);
    ellipse(c,117,61,42,43,'#d8d5b8',ink,2);
    c.save(); c.translate(117,60); c.scale(.97,1);
    for (let i=0;i<4;i++) {
      c.save(); c.rotate(i*Math.PI/2);
      path(c,'M-4 -3 Q-21 -17 -15 -31 Q-10 -40 3 -35 Q15 -30 12 -24 Q4 -18 4 -4Z',i%2 ? '#57937b' : '#78ae91');
      path(c,'M-5 -12 Q-9 -23 -5 -29',null,'#a9c4a0',1.3);
      c.restore();
    }
    for (const r of [39,28,16]) ellipse(c,0,0,r,r,null,'#9c804e',1.8);
    for (let i=0;i<10;i++) {
      c.save(); c.rotate(i*Math.PI/5);
      path(c,'M0 -7 Q2 -22 0 -39',null,'#b49c6b',1.35); c.restore();
    }
    ellipse(c,0,0,8,8,dark,ink,1.5); ellipse(c,0,0,3,3,'#e8c38a');
    c.restore();
    for (let i=0;i<3;i++) ellipse(c,112+9*i,118-i*.25,2.8,1.5,i===0 ? red : cream,ink,.7);
    glimmer(c,62,43,5);
  }
  function radio(c) {
    shadow(c,117,118,77,10);
    path(c,'M71 44 L71 34 Q71 20 88 20 L132 20 Q147 20 147 34 L147 42 L140 43 L140 35 Q140 28 131 28 L89 28 Q78 28 78 35 L78 44Z','#ba9862');
    path(c,'M83 19 Q104 16 131 18 L131 28 L84 29Z',dark);
    path(c,'M45 49 Q45 43 53 41 L166 35 L183 46 L183 107 L169 117 L53 121 Q45 120 45 112Z','#996943');
    path(c,'M45 50 Q45 45 52 45 L162 40 Q169 40 169 48 L169 110 Q169 115 164 115 L52 120 Q45 120 45 111Z','#e1c18a');
    path(c,'M53 55 L104 52 L104 105 L53 108Z','#635841');
    for (let i=0;i<9;i++) path(c,'M56 '+(59+i*5.4)+' l45 -2',null,'#d1ac79',2.7);
    path(c,'M111 52 L161 50 L161 70 L111 72Z',dark);
    for (let i=0;i<10;i++) path(c,'M'+(114+4.8*i)+' 55 l0 '+(i%3 ? 3 : 6),null,cream,1);
    path(c,'M135 51 l0 19',null,red,2.4);
    for (const x of [122,151]) {
      ellipse(c,x,91-(x-122)*.05,8.5,9,dark,ink,1.6);
      ellipse(c,x,91-(x-122)*.05,4.7,5,'#d7b278');
    }
    path(c,'M175 52 L175 101 M179 54 L179 99',null,'#c69462',1.3);
    glimmer(c,47,32,5); glimmer(c,190,75,4);
  }
  function toastPlate(c,room) {
    const plate=room?.plate;
    const cut=plate?.cut==='Triangles', finish=plate?.finish;
    shadow(c,121,125,78,8); saucer(c);
    const top='M51 68 Q48 65 54 62 L108 38 Q113 36 119 38 L176 60 Q182 63 178 67 L117 97 Q112 100 107 97Z';
    const front='M51 65 L179 64 L178 67 L117 97 Q112 100 107 97 L53 71Z';
    const back='M51 65 Q49 63 54 62 L108 38 Q113 36 119 38 L176 60 Q180 62 179 64Z';
    function crust(d) {
      path(c,d,'#e4aa60');
      c.save(); c.clip(new Path2D(d));
      path(c,'M51 69 L114 42 L175 64 M70 76 L111 94 L160 70',null,'#bf8046',2.3);
      for (let i=0;i<61;i++) {
        const x=52+(i*47)%124, y=40+(i*19)%57;
        ellipse(c,x,y,1+i%3,.6+i%2,i%3 ? '#cb8b49' : '#f1c47e');
      }
      if (finish && finish!=='Butter only') {
        const d='M68 64 Q145 36 121 53 Q57 83 105 68 Q186 47 143 70 Q82 99 153 78';
        path(c,d,null,finish==='Golden syrup' ? '#b77a38' : '#c09b67',5.8);
        path(c,d,null,finish==='Golden syrup' ? '#e6ae52' : '#ffedbd',3.6);
      }
      c.restore();
    }
    if (cut) {
      c.save(); c.translate(3,-6);
      path(c,'M51 64 L179 63 L179 77 L51 80Z','#edce91');
      path(c,'M53 72 L177 70',null,'#ae7443',2); crust(back); c.restore();
    }
    c.save(); if (cut) c.translate(-3,5);
    path(c,'M51 65 L112 95 L179 64 L178 80 L117 111 Q112 114 106 111 L51 82Z','#bc8046');
    path(c,'M54 76 L112 105 L175 76',null,'#e1a960',2.3); crust(cut ? front : top);
    path(c,'M96 77 L111 70 L126 75 L125 80 L112 86 L96 82Z','#dfab58','#926b3e',1.3);
    path(c,'M96 77 L111 70 L126 75 L111 82Z','#fae299','#b48c52',1.2); c.restore();
    glimmer(c,52,43,5); glimmer(c,177,37,3.5);
  }
  function cashRegister(c,room) {
    const till=typeof module==='object' && module.exports ? require('./till.js') : PocketPlaces.till;
    const state=room?.bill || till.fresh(), open=room?.atTill && !state.settled;
    const value=room?.atTill || state.settled ? till.counted(state) : till.subtotal(till.bills[state.bill]);
    shadow(c,119,124,76,8);
    path(c,'M45 94 L153 99 L184 86 L183 101 L150 118 L46 111Z',dark);
    if (open) {
      path(c,'M48 98 L148 103 L135 122 L36 116Z','#8d805c');
      path(c,'M38 112 L136 119 L136 126 L37 120Z',jade);
      for (const [x,y] of [[67,108],[97,110],[126,112]]) ellipse(c,x,y,8,3,'#e0bd79',ink,1);
      path(c,'M71 118 L102 120',null,'#e3c487',2.5);
    }
    path(c,'M49 83 L63 57 L145 59 L177 49 L178 85 L153 100 L49 95Z','#c0a579');
    path(c,'M50 82 L74 62 L173 65 L152 90Z','#e4cca0');
    path(c,'M73 62 L74 36 Q74 31 79 31 L160 32 L173 38 L172 64 L150 72Z',jade);
    path(c,'M82 39 L151 41 L151 61 L82 58Z','#355644');
    c.save(); c.translate(116,49); c.rotate(.028); c.fillStyle='#f4d99b';
    c.textAlign='center'; c.textBaseline='middle'; c.font='bold 19px Georgia, serif';
    c.fillText(String(value).padStart(2,'0'),0,1); c.restore();
    for (let j=0;j<2;j++) for (let i=0;i<5;i++) {
      const x=71+i*15+j*4, y=80+i*.8-j*6;
      path(c,'M'+x+' '+y+' l5 -4 8 .5 -4 4Z',i===4 ? '#bf684d' : cream,ink,1);
    }
    path(c,'M154 90 L154 98 M49 91 L150 97',null,'#9d7954',1.5);
    if (!open) path(c,'M87 103 L118 105',null,'#e2c48b',2.6);
    glimmer(c,53,45,5); glimmer(c,182,29,3.5);
  }
  const drawings = [cup,booth,bun,clock,urn,cat,fan,radio,toastPlate,cashRegister];
  function paint(canvas,id,small = false,room) {
    const draw = drawings[id-1];
    if (!draw) throw new RangeError('Unknown order slip');
    const width = small ? 200 : 720;
    canvas.width=width; canvas.height=Math.round(width*140/230);
    const c=canvas.getContext('2d');
    if (!c) return;
    c.save(); c.scale(canvas.width/230,canvas.height/140);
    c.lineCap='round'; c.lineJoin='round';
    if (small) { c.translate(115,75); c.scale(1.20,1.20); c.translate(-115,-75); }
    draw(c,room); c.restore();
  }
  const api = {paint};
  if (typeof module === 'object' && module.exports) module.exports=api;
  else PocketPlaces.prints=api;
})();
