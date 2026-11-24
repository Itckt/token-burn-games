/* Original printed matter for the miniature, painted into one local texture. */
(function () {
  'use strict';
  const till = typeof module === 'object' && module.exports ? require('./till.js') : PocketPlaces.till;
  const SIZE = 2048;
  const blocks = {
    marquee:[10,10,1510,288],menu:[10,320,535,445],poster:[1565,430,300,395],
    clock:[1570,10,390,390],plaque:[575,320,915,167],urn:[575,515,245,174],
    pad:[850,510,230,250],tin:[1110,525,280,180],street:[10,805,1536,448],
    streetNight:[10,1270,1536,448],minibus:[1572,900,424,168],radioFace:[1572,1100,432,236],
    blind:[1572,1360,424,328], toastPlain:[10,1744,240,272], toastSyrup:[258,1744,240,272],
    toastMilk:[506,1744,240,272], digits:[780,1750,800,100]
  };
  const regions = {};
  function region([x,y,w,h]) { return [(x+.5)/SIZE,(y+.5)/SIZE,(x+w-.5)/SIZE,(y+h-.5)/SIZE]; }
  for (const [name,rect] of Object.entries(blocks)) regions[name] = region(rect);
  for (let i=0;i<3;i++) regions['window'+i] = region([10+i*512,805,512,448]);
  const [digitX,digitY,digitWidth,digitHeight] = blocks.digits;
  regions.digitZero = region([digitX,digitY,digitWidth/10,digitHeight]);
  const chinese = '"Noto Sans HK", "Microsoft JhengHei", "PingFang HK", sans-serif';
  const serif = '"Noto Serif HK", "PMingLiU", "Songti TC", serif';
  const cream = '#fff0cd', red = '#b94230', teal = '#245c50';

  function star(c,x,y,r,color) {
    c.beginPath();
    for (let i=0;i<16;i++) {
      const a = i*Math.PI/8, radius = i%2 ? r*.28 : (i%4 ? r*.65 : r);
      const px=x+Math.cos(a)*radius, py=y+Math.sin(a)*radius;
      if (i) c.lineTo(px,py); else c.moveTo(px,py);
    }
    c.closePath(); c.fillStyle=color; c.fill();
  }
  function type(c, text, x, y, size, color, family = 'Arial, sans-serif', weight = 700) {
    c.fillStyle=color; c.font=weight+' '+size+'px '+family; c.textAlign='center';
    c.textBaseline='middle'; c.fillText(text,x,y);
  }
  function rect(c,x,y,w,h,color) { c.fillStyle=color; c.fillRect(x,y,w,h); }
  function circle(c,x,y,r,color) {
    c.beginPath(); c.arc(x,y,r,0,Math.PI*2); c.fillStyle=color; c.fill();
  }
  function marquee(c,w,h) {
    rect(c,0,0,w,h,'#b94230');
    c.strokeStyle='#f2bf82'; c.lineWidth=5; c.strokeRect(10,10,w-20,h-20);
    c.strokeStyle='#db8060'; c.lineWidth=2; c.strokeRect(20,20,w-40,h-40);
    type(c,'半 刻 茶 餐 廳',w/2,116,145,cream,serif,900);
    type(c,'H A L F   P A S T   T E A',w/2,235,36,cream);
    rect(c,233,232,218,3,'#edb782'); rect(c,w-451,232,218,3,'#edb782');
    for (const x of [117,w-117]) {
      star(c,x,125,44,cream); star(c,x-32,174,12,'#edb782');
    }
  }
  function menu(c,w,h) {
    rect(c,0,0,w,h,'#ffedc8');
    c.strokeStyle=teal; c.lineWidth=6; c.strokeRect(10,10,w-20,h-20);
    rect(c,19,19,w-38,96,teal);
    type(c,'今 日 餐 牌',w/2,62,60,cream,chinese);
    type(c,'H O U S E   M E N U',w/2,140,21,red);
    till.menu.forEach(({name,chinese:han,price},i)=>{
      const y=195+i*83;
      type(c,han,122,y,41,teal,chinese); type(c,name.toUpperCase(),123,y+33,14,'#746d55');
      c.setLineDash([3,7]); c.beginPath(); c.moveTo(225,y+8); c.lineTo(396,y+8);
      c.strokeStyle='#8e9276'; c.lineWidth=3; c.stroke(); c.setLineDash([]);
      type(c,'$'+price,449,y+3,42,red,'Georgia, serif');
    });
  }
  function poster(c,w,h) {
    rect(c,0,0,w,h,'#e4b257'); rect(c,9,9,w-18,h-18,'#ffe6ad');
    type(c,'香 滑 奶 茶',w/2,58,37,teal,serif,900);
    circle(c,w/2,202,87,'#e29a53');
    c.save(); c.translate(0,-4); c.strokeStyle=cream; c.lineWidth=13;
    c.beginPath(); c.ellipse(206,209,24,27,.3,0,Math.PI*2); c.stroke();
    c.fillStyle=cream; c.beginPath(); c.moveTo(83,186); c.quadraticCurveTo(88,269,144,270);
    c.quadraticCurveTo(200,270,202,186); c.closePath(); c.fill();
    c.beginPath(); c.ellipse(142,186,59,12,0,0,Math.PI*2); c.fillStyle='#805233'; c.fill();
    c.beginPath(); c.ellipse(145,279,80,9,0,0,Math.PI*2); c.fillStyle=teal; c.fill(); c.restore();
    star(c,63,154,21,cream); star(c,237,129,15,teal);
    type(c,'HOUSE MILK TEA',w/2,334,25,teal); rect(c,78,360,144,3,red);
  }
  function clock(c,w,h) {
    c.clearRect(0,0,w,h); const r=w*.49;
    c.save(); c.translate(w/2,h/2); circle(c,0,0,r,'#fff1d2');
    for (let i=0;i<60;i++) {
      c.save(); c.rotate(i*Math.PI/30);
      rect(c,i%5 ? -1.4 : -4,-r+9,i%5 ? 2.8 : 8,i%5 ? 9 : 23,teal); c.restore();
    }
    for (const hour of [12,3,6,9]) {
      const a=hour*Math.PI/6; type(c,String(hour),Math.sin(a)*r*.71,-Math.cos(a)*r*.71,40,teal);
    }
    function hand(angle,length,width,color) {
      c.save(); c.rotate(angle); c.strokeStyle=color; c.lineWidth=width; c.lineCap='round';
      c.beginPath(); c.moveTo(0,11); c.lineTo(0,-length); c.stroke(); c.restore();
    }
    hand(3.5*Math.PI/6,r*.44,13,teal); hand(Math.PI,r*.69,9,teal);
    hand(1.65*Math.PI,r*.76,3,red); circle(c,0,0,11,red); c.restore();
  }
  function plaque(c,w,h) {
    rect(c,0,0,w,h,teal); c.strokeStyle='#dfc998'; c.lineWidth=4; c.strokeRect(9,9,w-18,h-18);
    type(c,'半 刻  ·  H A L F   P A S T   T E A',w/2,h/2+2,44,cream,chinese);
    for (const x of [29,w-29]) circle(c,x,h/2,7,'#d6b674');
  }
  function urn(c,w,h) {
    rect(c,0,0,w,h,'#f4dcaa'); c.strokeStyle=red; c.lineWidth=6; c.strokeRect(8,8,w-16,h-16);
    type(c,'熱 茶',w/2,67,61,red,serif,900); type(c,'HOT TEA',w/2,131,23,teal);
  }
  function pad(c,w,h) {
    rect(c,0,0,w,h,'#fff0c9'); type(c,'半刻  ·  客單',w/2,34,24,red,chinese);
    for(let i=0;i<7;i++) rect(c,12,58+i*26,w-24,2,'#b8c5ad');
    rect(c,157,57,2,h-65,red); type(c,'2 × 奶茶',77,96,23,teal,chinese);
    type(c,'1 × 西多',76,150,21,teal,chinese);
  }
  function tin(c,w,h) {
    rect(c,0,0,w,h,'#ecb866'); rect(c,0,23,w,22,red); rect(c,0,h-31,w,12,red);
    type(c,'淡 奶',w/2,h*.54,48,red,serif,900);
  }
  function radioFace(c,w,h) {
    rect(c,0,0,w,h,'#e8cb93');
    rect(c,10,12,212,h-24,'#594f3e');
    for (let y=20;y<h-14;y+=12) {
      rect(c,16,y,201,4,'#c69c6f');
      rect(c,16,y+4,201,2,'#896a4c');
    }
    for (let x=25;x<214;x+=18) rect(c,x,18,2,h-36,'#a18a67');
    rect(c,239,47,176,55,'#34564b');
    for (let k=0;k<19;k++) rect(c,249+k*8.6,55,2,k%3 ? 9 : 16,'#e9cd8a');
    type(c,'88     95     102',328,84,14,'#fae4ac');
    type(c,'半 刻',322,139,25,'#875738',serif);
    rect(c,238,161,177,2,'#b38e61');
  }
  function street(c,w,h,night=false) {
    const sky=c.createLinearGradient(0,0,0,h);
    sky.addColorStop(0,night ? '#293454' : '#b4d5cf');
    sky.addColorStop(1,night ? '#a47f83' : '#f9d8a7');
    rect(c,0,0,w,h,sky);
    if (night) {
      circle(c,468,27,9,'#ffe4a5');
      for (const [x,y] of [[60,29],[350,70],[523,41],[880,34],[1472,23]]) circle(c,x,y,2,'#f9dfb0');
    }
    const houses=[[0,99,152,'#dfbc94'],[136,46,132,'#c0bea0'],[258,130,160,'#bcae91'],
      [400,64,116,'#d9af8c'],[528,98,174,'#c5bf9f'],[684,25,144,'#e3b79b'],
      [817,122,139,'#c0b197'],[943,74,182,'#d7c6a7'],[1116,47,134,'#dfb8a0'],
      [1240,115,173,'#bcc1a8'],[1391,69,165,'#d4bda3']];
    const nightWalls=['#58657b','#435768','#706577','#526574'];
    const windows=['#263f52','#e6aa70','#31485d','#f5d89d','#8ba3ab'];
    for (const [index,[x,y,width,dayColor]] of houses.entries()) {
      const color=night ? nightWalls[index%nightWalls.length] : dayColor;
      rect(c,x,y,width,h-y,color); rect(c,x+7,y-10,width-19,10,color);
      rect(c,x+17,y-23,width*.2,15,night ? '#4b586b' : '#abb8a7');
      rect(c,x-3,y+11,width+6,6,night ? '#404e60' : '#a1ad97');
      for(let row=0;row<7;row++) for(let col=0;col<3;col++) {
        const xx=x+14+col*(width-22)/3, yy=y+28+row*46;
        rect(c,xx,yy,23,27,night ? windows[(row*3+col+index*2)%windows.length] : '#8fa99d');
        rect(c,xx+10,yy,2,27,night ? color : '#cfccb1');
        rect(c,xx-2,yy+25,27,4,night ? '#777b85' : '#e6cfac');
        if ((row+col)%3===0) {
          rect(c,xx+12,yy+23,17,10,night ? '#6a747f' : '#c9c4b0');
          rect(c,xx+15,yy+27,10,2,night ? '#4e5c6d' : '#99a89a');
        }
      }
    }
    // Shop awnings and angled reflections are part of the window print.
    for(let i=0;i<12;i++) rect(c,82+i*18,336,18,19,i%2 ? (night ? '#b89c87' : '#e9c8a9') : '#a86e61');
    rect(c,1068,224,31,101,night ? '#d9775c' : '#b37361'); type(c,'茶',1083,258,22,'#fff0d0',chinese);
    rect(c,0,387,w,12,night ? '#8c8290' : '#c8bea4');
    rect(c,0,399,w,49,night ? '#454e63' : '#929e93');
    for (let x=18;x<w;x+=112) rect(c,x,431,54,3,night ? '#938e91' : '#ddd0ad');
    rect(c,0,0,w,h,night ? 'rgba(101,129,160,.12)' : 'rgba(173,213,198,.30)');
    c.fillStyle=night ? 'rgba(229,209,175,.10)' : 'rgba(255,249,214,.22)';
    for(const x of [74,141,593,1049,1116,1412]) {
      c.beginPath(); c.moveTo(x,0); c.lineTo(x+29,0); c.lineTo(x-168,h); c.lineTo(x-205,h); c.fill();
    }
  }
  function minibus(c,w,h) {
    c.clearRect(0,0,w,h);
    c.save(); c.scale(w/424,h/168);
    for (const x of [81,337]) {
      circle(c,x,135,27,'#344549'); circle(c,x,135,13,'#b7c0ad'); circle(c,x,135,6,'#59655c');
    }
    c.beginPath(); c.moveTo(9,124); c.lineTo(9,50); c.quadraticCurveTo(11,26,43,25);
    c.lineTo(344,25); c.quadraticCurveTo(366,27,375,46); c.lineTo(409,92);
    c.lineTo(415,126); c.quadraticCurveTo(415,138,398,138); c.lineTo(23,138);
    c.quadraticCurveTo(9,138,9,124); c.fillStyle='#efe0b4'; c.fill();
    rect(c,28,20,319,18,'#b95443'); rect(c,48,14,265,8,'#cd7356');
    for (let x=26;x<290;x+=52) {
      rect(c,x,46,46,45,'#456466'); rect(c,x+3,49,40,22,'#a2c1b5');
      rect(c,x+7,78,14,10,'#bd916c');
    }
    rect(c,300,45,28,84,'#586d65'); rect(c,304,49,20,43,'#99b9ad');
    c.beginPath(); c.moveTo(337,46); c.lineTo(362,46); c.lineTo(392,88); c.lineTo(337,88);
    c.fillStyle='#678b88'; c.fill();
    rect(c,13,103,285,9,'#a74f40'); rect(c,334,103,72,9,'#a74f40');
    rect(c,399,115,12,8,'#ffda85'); rect(c,10,114,8,10,'#b84937');
    c.restore();
  }
  function blind(c,w,h) {
    rect(c,0,0,w,h,'#e4d9b8');
    for (let x=-12;x<w;x+=68) {
      rect(c,x,0,27,h,'#8ca898'); rect(c,x+4,0,2,h,'#b6c3a7');
      rect(c,x+32,0,3,h,'#739482'); rect(c,x+42,0,2,h,'#c39975');
    }
    for (let y=6;y<h;y+=12) rect(c,0,y,w,1,'rgba(100,93,62,.14)');
    rect(c,0,h-20,w,3,'#829981'); rect(c,0,h-12,w,2,'#c29b69');
  }
  function toastPrint(c,w,h,sauce) {
    const top=h*.78;
    rect(c,0,0,w,h,'#ae6436'); rect(c,4,4,w-8,top-8,'#cb8744');
    rect(c,10,10,w-20,top-20,'#e0a859');
    // Use the same sear marks under each finish so dressing the plate never moves the crumb.
    let seed=341;
    function random() { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; }
    const crust=['#eab96c','#d59450','#c88b49','#f2c882'];
    for (let i=0;i<340;i++) {
      const x=random()*w, y=random()*top, r=1+random()*4;
      c.beginPath(); c.ellipse(x,y,r*1.5,r,random()*3,0,2*Math.PI);
      c.fillStyle=crust[i%crust.length]; c.fill();
    }
    if (sauce) {
      c.lineCap='round';
      function ribbon(dx,dy,color,width) {
        c.beginPath(); c.moveTo(33+dx,51+dy);
        c.quadraticCurveTo(236+dx,6+dy,177+dx,48+dy);
        c.quadraticCurveTo(-63+dx,153+dy,96+dx,108+dy);
        c.quadraticCurveTo(300+dx,52+dy,124+dx,147+dy);
        c.quadraticCurveTo(24+dx,204+dy,208+dx,153+dy);
        c.strokeStyle=color; c.lineWidth=width; c.stroke();
      }
      ribbon(1,2,sauce===1 ? '#aa6733' : '#c19864',13);
      ribbon(0,0,sauce===1 ? '#c78638' : '#f8e3ad',11);
      ribbon(-1,-2,sauce===1 ? '#efbd68' : '#fff0cc',2.5);
    }
    rect(c,0,top,w,h-top,'#be824b');
    rect(c,0,h*.817,w,h*.018,'#db9f60');
    rect(c,0,h*.844,w,h*.012,'#975c36');
    rect(c,0,h*.90,w,h*.10,'#eed399');
    rect(c,0,h*.951,w,h*.013,'#ac7042');
    for (let i=0;i<78;i++) circle(c,random()*w,h*(.91+.084*random()),1+random()*1.2,'#d9b37b');
  }
  function digits(c,w,h) {
    rect(c,0,0,w,h,'#263e33');
    for (let i=0;i<10;i++) {
      type(c,String(i),(i+.5)*w/10,h*.53,82,'#f7dc9a','Georgia, serif');
      rect(c,i*w/10,h*.51,w/10,2,'#52604b');
    }
  }
  const painters = {marquee,menu,poster,clock,plaque,urn,pad,tin,street,minibus,radioFace,blind,digits,
    toastPlain:(c,w,h)=>toastPrint(c,w,h,0), toastSyrup:(c,w,h)=>toastPrint(c,w,h,1),
    toastMilk:(c,w,h)=>toastPrint(c,w,h,2),
    streetNight:(c,w,h)=>street(c,w,h,true)};
  function makeAtlas() {
    const canvas=document.createElement('canvas'); canvas.width=canvas.height=SIZE;
    const c=canvas.getContext('2d');
    c.fillStyle='#ffffff'; c.fillRect(0,0,SIZE,SIZE);
    for (const [name,[x,y,w,h]] of Object.entries(blocks)) {
      c.save(); c.translate(x,y); c.beginPath(); c.rect(0,0,w,h); c.clip();
      painters[name](c,w,h); c.restore();
    }
    return canvas;
  }
  const api={SIZE,blocks,regions,makeAtlas};
  if(typeof module==='object' && module.exports) module.exports=api;
  else PocketPlaces.art=api;
})();
