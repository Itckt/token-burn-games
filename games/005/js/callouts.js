(function (root) {
  'use strict';
  const M = root.CupMath, G = root.CupMeshes, L = root.CupLesson;
  const {x:gapX,z:gapZ} = L.gapProbe;
  const gapPoint = (low, high) => [gapX, (low + high) / 2, gapZ];
  const at = point => renderer => renderer.screen(point);
  const strand = (renderer, scene) => renderer.strandScreen(scene.soft);
  const tag = (text, side, dy, anchor, secondary = false, visible = () => true) =>
    ({text, side, dy, anchor, secondary, visible});
  const wall = tag('Cup wall', -1, -27, at(G.polar(G.radiusAt(1.52) + 0.005,1.52,-1)), true);
  const block = tag('Noodle block', 1, -24, strand);
  const gap = (r, s) => r.screen(gapPoint(L.floorAt(gapX,s.baseFlex), s.bottom));
  const chapters = [
    [wall, block, tag('Air gap',1,15,gap)],
    [wall, tag('Seating line',1,-18,(r,s) => r.screen(G.polar(G.innerRadiusAt(s.seatY),s.seatY,G.EDGE_R+0.02)))],
    [tag('Cup base',-1,-12,at([-0.57,0.11,0.63]),true), block, tag('Flex space',1,11,gap)],
    [wall, tag('Hot water',1,-22,(r,s) => r.screen(L.pourPosition(s,G.HEIGHT+0.06)),false,s => s.stream>0.03),
      tag('Water level',1,16,(r,s) => r.screen([0.54,s.surfaceY,0.61]),false,s => s.water>0.015)],
    [wall, tag('Soft noodles',1,-29,strand), tag('Broth',1,12,at([0.41,0.45,0.55]))]
  ];
  const exteriorTags = [
    tag('Printed sleeve',-1,-8,(r,s) => r.screen(G.polar(G.radiusAt(1.31,s.fit?.taper),1.31,-1.39))),
    tag('Rolled rim',1,-16,at(G.polar(G.RIM,G.HEIGHT,-0.1)))
  ];
  const scanTags = [tag('Slice plane',1,-12,(r,s) => r.screen(G.polar(s.scan.radius*0.77,s.scan.height,1.06)))];
  const pourTags = [
    tag('Underside',1,-20,(r,s) => r.screen([gapX,s.fit.bottom,gapZ])),
    tag('Pool surface',1,20,(r,s) => r.screen([0.46,s.surfaceY,0.59]),false,L.hasPool)
  ];
  const pressTags = [
    tag('Test pad',-1,10,(r,s) => r.screen([0.28,s.press.surfaceY,0.64])),
    tag('Lowest curl',1,-16,r => r.screen(r.dryProfile.lowestPoint,true))
  ];
  const gapTags = [
    tag('Packed underside',-1,-20,(r,s) => r.screen([gapX,s.gap.packedY,gapZ])),
    tag('Current underside',1,12,(r,s) => r.screen([gapX,s.bottom,gapZ]))
  ];
  const packedMark = (r,s) => r.screen(s.tracked.strand.path[s.tracked.strand.mark],true);
  const liveMark = (r,s) => r.screen(s.tracked.point,true);
  const trackTags = [
    tag('Packed mark',-1,-25,packedMark,false,s => s.tracked.soft > 0.015),
    tag('Tracked curl',1,12,liveMark)
  ];
  function packingTags(scene) {
    const {fit} = scene;
    if (scene.forces) return [
      tag('Weight',-1,-22,(r,s) => r.screen(s.forces.arrows[0].tail)),
      tag(fit.onFloor ? 'Floor reaction' : 'Wall reaction',1,16,(r,s) => r.screen(s.forces.arrows.at(-1).tail))
    ];
    if (scene.press) return pressTags;
    if (scene.scan) return scanTags;
    if (scene.contactMap) {
      const closest = tag(fit.onFloor ? 'Closest curl' : 'Wall contact',1,-20,(r,s) => r.screen(s.fit.contact,true));
      return fit.onFloor ? [closest,tag('Floor support',-1,16,r => r.screen(r.dryProfile.lowestPoint,true))] : [closest];
    }
    if (fit.onFloor) return [block, tag('Cup floor', 1, 18, at([0.36, G.FLOOR, 0.75]))];
    if (scene.meter) return pourTags;
    return [
      tag('Wall contact',1,-20,at(G.polar(G.innerRadiusAt(fit.contactY,fit.taper),fit.contactY,G.EDGE_R+0.015))),
      tag(fit.gapMM.toFixed(1)+' mm gap',1,16,at(gapPoint(G.FLOOR,fit.bottom)))
    ];
  }
  function svg(name, attributes = {}) {
    const node = document.createElementNS('http://www.w3.org/2000/svg',name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key,value);
    return node;
  }
  class Callouts {
    constructor(overlay, orientation) {
      this.overlay = overlay;
      this.orientation = orientation;
    }
    rebuild(definitions, guide, trail, forces) {
      this.overlay.replaceChildren();
      this.guide = guide ? svg('path',{class:'gap-guide'}) : null;
      if (this.guide) this.overlay.append(this.guide);
      this.trail = trail ? svg('path',{class:'strand-trail'}) : null;
      if (this.trail) this.overlay.append(this.trail);
      this.forcePaths = (forces?.arrows ?? []).map(({kind}) => {
        const arrow = svg('path',{class:'force-arrow '+kind});
        this.overlay.append(arrow);
        return arrow;
      });
      this.labels = definitions.map(def => {
        const group = svg('g'), path = svg('path',{class:'leader'}), spot = svg('circle',{class:'spot',r:3.5});
        const rect = svg('rect',{class:'tag',rx:3.5,height:22}), txt = svg('text',{'dominant-baseline':'central'});
        txt.textContent = def.text;
        group.append(path,spot,rect,txt);
        this.overlay.append(group);
        return {def,group,path,spot,rect,txt,width:Math.ceil(txt.getComputedTextLength())+15};
      });
    }
    update(renderer, scene, view, exterior) {
      const w = renderer.width, h = renderer.height, narrow = w < 515, fit = scene.fit;
      const key = [scene.index, exterior, narrow, fit?.diameter, fit?.taper, !!scene.scan, !!scene.meter, !!scene.press, !!scene.contactMap, !!scene.forces, !!scene.gap, scene.tracked?.strand.key].join('/');
      if (key !== this.key) {
        this.overlay.classList.toggle('scanning',!!scene.scan && !exterior);
        this.overlay.classList.toggle('tracking',!!scene.tracked && !exterior);
        this.overlay.classList.toggle('gap-study',!!scene.gap && !exterior);
        const defs = exterior ? exteriorTags : fit ? packingTags(scene) : scene.gap ? gapTags : scene.tracked ? trackTags : chapters[scene.index];
        const guide = fit ? !fit.onFloor && !scene.scan && !scene.contactMap && !scene.forces : scene.index === 0 || scene.index === 2 || scene.gap;
        this.rebuild(narrow && defs.length > 2 ? defs.filter(d => !d.secondary) : defs, !exterior && guide, !exterior && scene.tracked, !exterior && scene.forces);
        this.key = key;
      }
      const angle = view.yaw - (exterior ? -0.8 : 0);
      this.overlay.style.opacity = M.smooth(0.65,0.91,Math.cos(angle)) * (1-M.smooth(0.69,0.96,view.pitch));
      const quadrant = ((Math.round(view.yaw/(Math.PI/2))%4)+4)%4;
      const bearing = ['Front view','Right side','Rear view','Left side'][quadrant];
      if (this.orientation.textContent !== bearing) this.orientation.textContent = bearing;
      if (this.guide) {
        const low = scene.gap ? scene.bottom : scene.press?.surfaceY ?? L.floorAt(gapX,scene.baseFlex);
        const high = scene.gap?.packedY ?? (fit && !scene.press ? fit.bottom : scene.bottom);
        this.guide.style.display = scene.press?.touching ? 'none' : '';
        const [x0,y0] = renderer.screen([gapX,low,gapZ]), [x1,y1] = renderer.screen([gapX,high,gapZ]);
        this.guide.setAttribute('d',`M ${x0-4} ${y0} h 8 M ${x0} ${y0} L ${x1} ${y1} M ${x1-4} ${y1} h 8`);
      }
      if (this.trail) {
        const [x,y] = packedMark(renderer,scene), [a,b] = liveMark(renderer,scene);
        this.trail.setAttribute('d', `M ${x} ${y} L ${a} ${b}`);
      }
      this.forcePaths.forEach((path,i) => {
        const arrow = scene.forces.arrows[i];
        const a = renderer.screen(arrow.tail).slice(0,2), b = renderer.screen(arrow.tip).slice(0,2);
        const head = root.CupDrawing.arrowHead(a,b,8);
        const d = head.length ? 'M '+a.join(' ')+' L '+b.join(' ')+' M '+head.map(p => p.join(' ')).join(' L ') : '';
        path.setAttribute('d',d);
      });
      for (const {def,group,path,spot,rect,txt,width} of this.labels) {
        const visible = def.visible(scene);
        group.style.display = visible ? '' : 'none';
        if (!visible) continue;
        const [x,y] = def.anchor(renderer,scene), side = def.side;
        const edge = side > 0 ? Math.max(w*0.72,x+30) : Math.min(w*0.28-width,x-width-33);
        const tagX = M.clamp(edge,8,w-width-8), tagY = M.clamp(y+def.dy,58,h-44);
        const end = side > 0 ? tagX : tagX+width, elbow = x+side*Math.min(Math.abs(end-x)*0.60,27);
        path.setAttribute('d',`M ${x} ${y} L ${elbow} ${tagY} L ${end} ${tagY}`);
        spot.setAttribute('cx',x); spot.setAttribute('cy',y);
        rect.setAttribute('x',tagX); rect.setAttribute('y',tagY-11); rect.setAttribute('width',width);
        txt.setAttribute('x',tagX+7.5); txt.setAttribute('y',tagY+0.25);
      }
    }
  }
  root.CupCallouts = Callouts;
})(globalThis);
