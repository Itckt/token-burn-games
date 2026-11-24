/* The photograph is composited locally while the WebGL drawing buffer is live. */
(function () {
  'use strict';
  const stock='#fff9e7', ink='#2e5748', vermilion='#a64c34';
  const skies={
    afternoon:['#f5e2c2','#e4c7a1'],
    shower:['#e0e4d6','#99b4b5'],
    evening:['#747178','#384554']
  };
  function layout(w,h) {
    if (![w,h].every(n=>Number.isFinite(n) && n>0)) throw new RangeError('Empty postcard source');
    const portrait=h>w, width=portrait ? 860 : 1200, height=portrait ? 1120 : 840;
    const mat={x:30,y:79,w:width-60,h:height-259};
    const scale=Math.min(mat.w/w,mat.h/h);
    const image={x:mat.x+(mat.w-w*scale)/2,y:mat.y+(mat.h-h*scale)/2,w:w*scale,h:h*scale};
    return {width,height,mat,image};
  }
  function paint(canvas,shot) {
    const {source,note,mode,illustrated,closeup}=shot;
    const {width,height,mat,image}=layout(source.width,source.height);
    canvas.width=width; canvas.height=height;
    const c=canvas.getContext('2d');
    if (!c) throw new Error('The postcard needs a 2D canvas.');
    function lettering(value,x,y,font,color=ink) {
      c.font=font; c.fillStyle=color; c.fillText(value,x,y);
    }
    c.fillStyle=stock; c.fillRect(0,0,width,height);
    c.strokeStyle='#b9ad8d'; c.lineWidth=1; c.strokeRect(10.5,10.5,width-21,height-21);
    lettering('Half Past Tea',mat.x,53,'bold 37px Georgia, serif');
    lettering('半 刻 茶 餐 廳',262,50,'bold 19px "Microsoft JhengHei", serif',vermilion);
    c.textAlign='right';
    lettering('九 龍 塘   /   KOWLOON TONG',width-32,49,'bold 19px "Microsoft JhengHei", monospace');
    c.textAlign='left';
    const colors=illustrated ? ['#fcf3d9','#e6d8b5'] : skies[mode];
    const sky=c.createLinearGradient(0,mat.y,width,mat.y+mat.h);
    sky.addColorStop(0,colors[0]); sky.addColorStop(1,colors[1]);
    c.fillStyle=sky; c.fillRect(mat.x,mat.y,mat.w,mat.h);
    c.drawImage(source,image.x,image.y,image.w,image.h);
    c.strokeStyle='#a79d80'; c.strokeRect(mat.x+.5,mat.y+.5,mat.w-1,mat.h-1);

    const view=shot.seat ? shot.seat.toUpperCase() : closeup ? 'CLOSE-UP' : 'WIDE VIEW';
    const foot=mat.y+mat.h, kind=illustrated ? 'ILLUSTRATED SLIP' : view+'  /  '+mode.toUpperCase();
    lettering(kind,36,foot+36,'bold 17px monospace',vermilion);
    lettering(note.title,34,foot+81,'bold 38px Georgia, serif');
    c.font='italic 24px Georgia, serif'; c.fillStyle='#47594c';
    let line='', y=foot+119;
    for (const word of ('“'+note.caption+'”').split(' ')) {
      const candidate=line ? line+' '+word : word;
      if (line && c.measureText(candidate).width>width-190) {
        c.fillText(line,36,y); y+=30; line=word;
      } else line=candidate;
    }
    c.fillText(line,36,y);
    // The cancellation carries the same number as the printed order slip.
    c.save(); c.translate(width-83,foot+88); c.rotate(-.11);
    c.strokeStyle=vermilion;
    for (const r of [42,38]) { c.lineWidth=r===42 ? 2.5 : 1; c.beginPath(); c.arc(0,0,r,0,Math.PI*2); c.stroke(); }
    c.textAlign='center';
    lettering('茶',0,1,'bold 32px "Microsoft JhengHei", serif',vermilion);
    lettering('SLIP '+String(note.id).padStart(2,'0'),0,23,'bold 12px monospace',vermilion);
    c.restore();
    canvas.setAttribute('aria-label',(illustrated ? 'Illustration' : mode+' café view')+' on a Kowloon Tong postcard. '+note.title+'. '+note.caption);
  }

  function mount(capture,onOpen,onClose) {
    const byId=id=>document.getElementById(id);
    const dialog=byId('postcard-dialog'), print=byId('postcard-print');
    const link=byId('postcard-save'), status=byId('postcard-status');
    let url=null, edition=0, returnTo=null;
    function release() {
      edition++;
      link.hidden=true; link.removeAttribute('href');
      if (url) window.URL.revokeObjectURL(url);
      url=null;
    }
    function open(opener) {
      if (dialog.open) return;
      release();
      const current=edition;
      returnTo=opener;
      dialog.showModal();
      onOpen();
      status.textContent='Preparing your PNG…';
      print.hidden=true;
      function failed() { status.textContent='The PNG could not be prepared. Close the postcard and try again.'; }
      try {
        const shot=capture();
        paint(print,shot);
        print.hidden=false;
        const subject=shot.note.title.toLowerCase().replace(/[^a-z0-9]+/g,'-');
        link.download='half-past-tea-'+(shot.illustrated ? 'illustration' : shot.mode)+'-'+subject+'.png';
        print.toBlob(blob=>{
          if (current!==edition || !dialog.open) return;
          if (!blob) { failed(); return; }
          try { url=window.URL.createObjectURL(blob); } catch { failed(); return; }
          link.setAttribute('href',url); link.hidden=false;
          status.textContent=shot.illustrated ? 'Illustrated order slip' : 'From your camera';
        },'image/png');
      } catch {
        failed();
      }
    }
    byId('postcard-close').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>{
      if (dialog.open) return;
      release(); onClose(returnTo);
    });
    return {open,isOpen:()=>dialog.open};
  }
  const api={layout,paint,mount};
  if (typeof module==='object' && module.exports) module.exports=api;
  else PocketPlaces.postcard=api;
})();
