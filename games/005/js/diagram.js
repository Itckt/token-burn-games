(function (root) {
  'use strict';
  const G = root.CupMeshes, L = root.CupLesson, M = root.CupMath, P = root.CupPacking;
  const ink = '#4d6355', orange = '#a95730', teal = '#217a74';
  const center = 53, unit = 65 / (G.HEIGHT - G.FLOOR);
  const yAt = height => 74 - (height - G.FLOOR) * unit;
  const radiusAt = (height,taper) => G.innerRadiusAt(height,taper) * unit;
  const rim = radiusAt(G.HEIGHT);
  const lastDrawing = new WeakMap();

  const {path, line, fill, cupOutline} = root.CupDrawing;

  function annotations(scene, section, onWall) {
    const {fit,index,soft} = scene, low = yAt(section.bottom), high = yAt(section.top);
    const block = [center+12,(low+high)/2], gap = [center+3,(low+74)/2];
    const wall = y => [center+radiusAt(y,fit?.taper),yAt(y)];
    if (scene.gap) return [
      ['Packed '+scene.gap.originalMM.toFixed(1)+' mm',[center+11,yAt(scene.gap.packedY)]],
      ['Now '+scene.gap.remainingMM.toFixed(1)+' mm',[center+4,low]]
    ];
    if (scene.meter && !fit.onFloor) return [
      ['Lowest curl',[center+5,low]], L.hasPool(scene)
        ? [scene.meter.amountML === scene.meter.capacityML ? 'First contact' : 'Pool surface',[center-8,yAt(scene.surfaceY)]]
        : ['Empty pocket',gap]
    ];
    if (fit) return [
      fit.onFloor ? ['Floor support',[center,74]] : ['Wall support',wall(fit.contactY)],
      [fit.gapMM.toFixed(1)+' mm gap',gap]
    ];
    if (index === 1) return [
      onWall ? ['Wall contact',wall(scene.seatY)] : ['Lifted block',block], ['Tapered cup',wall(0.63)]
    ];
    if (index === 2) return [['Held edges',wall(scene.seatY)],
      ['Flex space',[center+L.gapProbe.x*unit,(yAt(L.floorAt(L.gapProbe.x,scene.baseFlex))+low)/2]]];
    if (index >= 3) {
      const food = soft > 0.1 ? 'Loose strands' : 'Noodle block';
      return [scene.stream > 0.03 ? ['Pour stream',[center+7,6]] : [food,block],
        [section.pool,L.hasPool(scene) ? [center-8,yAt(scene.surfaceY)] : gap]];
    }
    return [['Noodle block',block],['Air gap',gap]];
  }

  function drawStrands(ctx,scene,{bottom,top},trace) {
    const {fit,soft} = scene, low = yAt(bottom), high = yAt(top);
    const surface = yAt(scene.surfaceY), hasWater = L.hasPool(scene);
    const outline = fit ? fit.outline : [
      [G.radiusAt(G.BLOCK_BOTTOM)-G.WALL-0.10*soft,bottom],
      [G.radiusAt(G.BLOCK_TOP)-G.WALL-0.08*soft,top]
    ];
    const left = outline.map(([r,y]) => [center-r*unit,yAt(y)]);
    const right = outline.map(([r,y]) => [center+r*unit,yAt(y)]).reverse();
    const cake = left.concat(right);
    ctx.save();
    path(ctx,cake); ctx.closePath(); ctx.clip();
    if (soft<0.98) {
      ctx.fillStyle = 'rgba(228,177,106,'+(0.78*(1-soft))+')';
      ctx.fillRect(center-rim,high,2*rim,low-high);
    }
    const curls = [], frequency = M.lerp(0.59,0.21,soft);
    for (let row=0; row<6; row++) {
      const points = [], baseY = M.lerp(high+1,low-1,row/5);
      for (let x=center-rim; x<=center+rim; x+=1.2) {
        const wave = Math.sin(x*frequency+1.4*row);
        points.push([x,baseY+wave*(1.2+1.5*soft)]);
      }
      curls.push(points);
      line(ctx,points,trace ? '#ac6a2e' : '#bc8547',1.35+0.45*soft);
    }
    if (trace && hasWater) {
      ctx.beginPath(); ctx.rect(center-rim,surface,2*rim,74-surface); ctx.clip();
      for (const points of curls) line(ctx,points,teal,1.8);
    }
    if (scene.gap) {
      const from = yAt(scene.gap.packedY);
      ctx.beginPath(); ctx.rect(center-rim,from,2*rim,74-from); ctx.clip();
      for (const points of curls) line(ctx,points,'#693e53',1.6,[1.3,2.9]);
    }
    ctx.restore();
    if (soft<0.15) line(ctx,[...cake,cake[0]],orange,1);
  }

  function elevation(ctx, scene, section, trace, onWall, labels) {
    const {fit,index} = scene, low = yAt(section.bottom), high = yAt(section.top);
    const surface = yAt(scene.surfaceY), hasWater = L.hasPool(scene);
    const cup = cupOutline(center,74,unit,fit?.taper,scene.baseFlex);
    fill(ctx,cup,'#fffcef');
    if (hasWater) {
      const r = radiusAt(scene.surfaceY,fit?.taper);
      fill(ctx,[[center-r,surface],[center+r,surface],cup.at(-2),cup[1]],trace ? '#afd5ce' : '#c6dcd1');
    }
    drawStrands(ctx,scene,section,trace);
    line(ctx,cup,ink,1.8);
    if (scene.gap) {
      const level = yAt(scene.gap.packedY), radius = radiusAt(scene.gap.packedY);
      line(ctx,[[center-radius,level],[center+radius,level]],'#693e53',1.3,[3,2]);
      line(ctx,[[center+4,level],[center+4,low]],'#693e53',1.1);
    }
    line(ctx,[[center-rim-2,9],[center-rim+2,9]],ink,2.8);
    line(ctx,[[center+rim-2,9],[center+rim+2,9]],ink,2.8);
    if (hasWater) {
      const r = radiusAt(scene.surfaceY,fit?.taper);
      line(ctx,[[center-r,surface],[center+r,surface]],teal,trace ? 1.5 : 0.9);
    }
    if (fit || index === 0 || index === 2) {
      const x = index === 2 && !fit ? L.gapProbe.x : 0, px = center+x*unit;
      const end = yAt(L.floorAt(x,scene.baseFlex));
      line(ctx,[[px,low],[px,end]],orange,1,[2,2]);
      for (const y of [low,end]) line(ctx,[[px-3,y],[px+3,y]],orange);
      if (index === 2 && !fit) line(ctx,[[cup[1][0],74],[cup.at(-2)[0],74]],ink,0.8,[2,2]);
    }
    if (!scene.meter && (fit || index === 1) && onWall) {
      const atY = fit ? fit.contactY : scene.seatY;
      for (const side of [-1,1]) {
        const x=center+side*radiusAt(atY,fit?.taper), y=yAt(atY);
        line(ctx,[[x+8*side,y],[x,y]],orange,1.4);
        line(ctx,[[x+3*side,y-2.5],[x,y],[x+3*side,y+2.5]],orange,1.4);
      }
    }
    if (scene.stream>0.03) {
      const end = Math.min(high,surface);
      line(ctx,[[center+8,1],[center+6,end]],teal,1+scene.stream);
      if (scene.seep>0.03) line(ctx,[[center+4,low],[center+4,surface]],teal,1.2,[2,2]);
    }
    ctx.font='10.5px Consolas, "Courier New", monospace'; ctx.textBaseline='middle';
    for (const [i,[label,point]] of labels.entries()) {
      const [x,y]=point, yy=i ? 59 : 27, color=i && hasWater ? teal : i ? orange : ink;
      line(ctx,[[x,y],[93,y],[105,yy],[115,yy]],color,0.85);
      ctx.fillStyle=color; ctx.beginPath(); ctx.arc(x,y,1.65,0,Math.PI*2); ctx.fill();
      ctx.fillText(label,120,yy);
    }
  }


  function strandView(ctx, scene) {
    const {strand, soft, packedMM, heightMM, point} = scene.tracked;
    const cx = 54, floor = 93, unit = 78 / (G.HEIGHT - G.FLOOR);
    const atY = y => floor - (y - G.FLOOR)*unit;
    // Front elevation of the entire marked strand, including the return loop.
    const project = ([x,y,z]) => [cx+(x*Math.cos(0.24)-z*Math.sin(0.24))*unit, atY(y)];
    const cup = cupOutline(cx,floor,unit);
    fill(ctx,cup,'#fffaf0');
    const water = G.innerRadiusAt(scene.surfaceY)*unit, level = atY(scene.surfaceY);
    fill(ctx,[[cx-water,level],[cx+water,level],cup[2],cup[1]],'#d2e4da');
    line(ctx,cup,ink,1.4);
    const packed = strand.path.map(project);
    const current = strand.path.map((p,i) => project(p.map((v,k) => M.lerp(v,strand.wet[i][k],soft))));
    if (strand.closed) { packed.push(packed[0]); current.push(current[0]); }
    const dye='#a33f3f';
    line(ctx,packed,ink,1.3,[3,2]); line(ctx,current,dye,1.7);
    const a=packed[strand.mark], b=project(point);
    line(ctx,[a,b],ink,0.85,[1,2]);
    for (const [p,color] of [[a,ink],[b,dye]]) {
      ctx.beginPath(); ctx.arc(...p,2.4,0,M.TAU); ctx.fillStyle=color; ctx.fill();
      ctx.lineWidth=0.8; ctx.strokeStyle='#fffaf0'; ctx.stroke();
    }
    ctx.textBaseline='middle';
    for (const [label,mm,y,color,dash] of [['Packed mark',packedMM,24,ink,[3,2]],['Current mark',heightMM,63,dye,[]]]) {
      line(ctx,[[111,y],[125,y]],color,1.6,dash);
      ctx.fillStyle=color; ctx.font='10px "Segoe UI", sans-serif'; ctx.fillText(label,131,y);
      ctx.font='bold 12px Consolas, monospace'; ctx.fillText(mm.toFixed(1)+' mm',131,y+14);
    }
  }

  function description(scene, labels) {
    const {scan, press, tracked, fit, meter, contactMap, brief} = scene;
    if (scene.forces) {
      const f=scene.forces;
      return 'Force directions for a '+f.massG+' g block. Weight '+f.weightN.toFixed(2)+' N downward. '+
        (fit.onFloor ? 'Floor reaction' : 'Each wall reaction')+' '+f.reactionN.toFixed(2)+' N, with '+
        f.upN.toFixed(2)+' N upward and '+f.inwardN.toFixed(2)+' N inward.';
    }
    if (scene.gap) {
      const g=scene.gap;
      return 'Packed underside '+g.originalMM.toFixed(1)+' mm above the floor. Hatched curls reach '+
        root.CupDesign.gapLabel(g.reachedMM)+' into the original gap. Remaining clearance '+root.CupDesign.gapLabel(g.remainingMM)+'.';
    }
    if (contactMap) return 'Plan view of wall clearance. Closest curl '+root.CupDesign.gapLabel(contactMap.closestMM)+
      ' from the lining. '+contactMap.closeCount+' of '+contactMap.gaps.length+' arcs within '+root.CupDesign.closeMM+' mm.';
    if (brief) return 'Pocket capacity against room above the dry block. Shaded area needs at least '+brief.pocketML+
      ' mL below and '+brief.roomMM+' mm above. '+brief.matches.length+' of '+brief.sizes.length+
      ' diameters meet both targets. Marked block '+fit.diameter+' mm.';
    if (press) {
      const length=root.CupDesign.gapLabel;
      return 'Test pad travel '+length(press.travelMM)+'. Floor fit lifts '+length(scene.reference.press.liftMM)+
        '. '+fit.diameter+' mm test block lifts '+length(press.liftMM)+' with '+length(press.clearanceMM)+' clearance left.';
    }
    if (tracked) return 'Front elevation of the selected strand. Packed mark '+tracked.packedMM.toFixed(1)+
      ' mm above the floor. Current mark '+tracked.heightMM.toFixed(1)+' mm above the floor.';
    if (scan) return 'Horizontal slice '+scan.heightLabel+' above the floor. '+scan.region+
      '. Inside width '+(2*scan.radius*P.mmPerUnit).toFixed(1)+' mm.';
    return 'Cup cross section showing '+labels.map(([label]) => label.toLowerCase()).join(' and ')+'.'+
      (meter ? ' Water added '+meter.amountML.toFixed(1)+' mL.' : '');
  }

  function draw(canvas, scene, trace = false, force = false) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(root.devicePixelRatio || 1, 2);
    const {fit, scan, meter, press, tracked, soft, contactMap, brief} = scene, section = L.section(scene);
    const onWall = fit ? !fit.onFloor : scene.lift < 0.03;
    const key = [w,h,dpr,scene.index,fit?.diameter,fit?.taper,!!contactMap,brief?.pocketML,brief?.roomMM,scan?.height,meter?.amountML,trace,section.pool,
      scene.forces?.massG,scene.gap && root.CupDesign.gapLabel(scene.gap.reachedMM),scene.gap?.remainingMM.toFixed(1),
      press?.travelMM,tracked?.strand.key,tracked?.heightMM.toFixed(1),onWall,scene.stream>0.03,scene.seep>0.03,soft>0.1,soft<0.15,soft<0.98,
      Math.round(section.bottom*160),Math.round(section.top*160),Math.round(scene.baseFlex*300),
      Math.round(scene.stream*12),Math.round(scene.seep*10),Math.round(scene.water*80),Math.round(soft*80)].join('/');
    if (!force && lastDrawing.get(canvas) === key) return true;
    const special = scan || press || contactMap || brief || scene.forces;
    const labels = special || tracked ? [] : annotations(scene,section,onWall);
    const alt = description(scene,labels);
    if (canvas.getAttribute('aria-label') !== alt) canvas.setAttribute('aria-label',alt);
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    const width = Math.round(w*dpr), height = Math.round(h*dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.clearRect(0,0,width,height);
    ctx.save();
    if (scan) { ctx.fillStyle = '#252e38'; ctx.fillRect(0,0,width,height); }
    const pageHeight = special ? 114 : tracked ? 103 : 84;
    const scale = Math.max(0, Math.min((w-12)/224,(h-3)/pageHeight));
    ctx.scale(dpr,dpr);
    ctx.translate((w-224*scale)/2,(h-pageHeight*scale)/2);
    ctx.scale(scale,scale);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const views = root.CupBenchViews;
    if (scan) views.scanViews(ctx,scan,fit);
    else if (press) views.pressViews(ctx,scene);
    else if (scene.forces) views.forceView(ctx,scene);
    else if (contactMap) views.clearanceDial(ctx,contactMap);
    else if (brief) views.finderChart(ctx,brief,fit.diameter);
    else if (tracked) strandView(ctx,scene);
    else elevation(ctx,scene,section,trace,onWall,labels);
    ctx.restore();
    lastDrawing.set(canvas,key);
    return true;
  }
  root.CupDiagram = {draw};
})(globalThis);
