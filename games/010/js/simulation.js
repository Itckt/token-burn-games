(function () {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./math.js') : PocketPlaces.math;
  const HOME = {yaw:.57, pitch:.49, zoom:1};
  const LIMITS = {minPitch:.19,maxPitch:1.08,minZoom:.72,maxZoom:1.7};
  const FRAME_POINTS = [];
  for (const x of [-4.73,4.73]) for (const z of [-3.56,3.56]) FRAME_POINTS.push([x,-.53,z]);
  FRAME_POINTS.push([-4.58,3.32,3.34],[-4.58,3.32,-3.40],[4.58,3.32,-3.40],
    [-3.22,4.45,-3.40],[2.90,4.45,-3.40]);

  function createView(auto = true) {
    return {...HOME, targetYaw:HOME.yaw,targetPitch:HOME.pitch,targetZoom:1,
      auto, orbitCenter:HOME.yaw,orbitTime:0,
      lens:{subject:null, overview:null, mix:0, center:[0,0,0], span:1}};
  }
  function setOrbit(v, enabled) {
    v.auto = enabled; v.orbitTime = 0; v.orbitCenter = v.yaw; v.targetYaw = v.yaw;
  }
  function rotate(v, dx, dy) {
    if (v.auto) setOrbit(v,false);
    v.targetYaw -= dx*.007;
    v.targetPitch = M.clamp(v.targetPitch+dy*.005,LIMITS.minPitch,LIMITS.maxPitch);
  }
  function zoomBy(v, factor) {
    if (Number.isFinite(factor) && factor>0) v.targetZoom = M.clamp(v.targetZoom*factor,LIMITS.minZoom,LIMITS.maxZoom);
  }
  function aim(v, pose, auto) {
    const turn = 2*Math.PI;
    v.targetYaw = pose.yaw + Math.round((v.yaw-pose.yaw)/turn)*turn;
    v.targetPitch = pose.pitch;
    v.targetZoom = pose.zoom;
    v.auto = auto; v.orbitTime = 0; v.orbitCenter = v.targetYaw;
  }
  function settle(v) {
    v.yaw = v.targetYaw; v.pitch = v.targetPitch; v.zoom = v.targetZoom;
    moveLens(v.lens,1);
  }
  function focusOn(v, subject, instant = false) {
    const lens = v.lens;
    if (!lens.subject) {
      lens.overview = {yaw:v.targetYaw, pitch:v.targetPitch, zoom:v.targetZoom, auto:v.auto};
      if (!lens.mix) {
        lens.center = subject.center.slice();
        lens.span = subject.span;
      }
    }
    lens.subject = subject;
    aim(v,{yaw:subject.yaw, pitch:subject.pitch, zoom:1},false);
    if (instant) settle(v);
  }
  function leaveFocus(v, instant = false) {
    const previous = v.lens.overview;
    if (!previous) return;
    v.lens.subject = v.lens.overview = null;
    aim(v,previous,previous.auto);
    if (instant) settle(v);
  }
  function resetView(v, auto, instant = false) {
    v.lens.subject = v.lens.overview = null;
    aim(v,HOME,auto);
    if (instant) settle(v);
  }
  function approach(value, target, ease) {
    const next = value + (target-value)*ease;
    return Math.abs(next-target)<1e-6 ? target : next;
  }
  function moveLens(lens, ease) {
    lens.mix = approach(lens.mix,lens.subject ? 1 : 0,ease);
    if (!lens.subject) return;
    lens.span = approach(lens.span,lens.subject.span,ease);
    for (let i=0;i<3;i++) lens.center[i] = approach(lens.center[i],lens.subject.center[i],ease);
  }
  function cameraMoving(v) {
    const lens = v.lens;
    return v.auto || v.yaw!==v.targetYaw || v.pitch!==v.targetPitch || v.zoom!==v.targetZoom ||
      lens.mix!==(lens.subject ? 1 : 0) || Boolean(lens.subject &&
        (lens.span!==lens.subject.span || lens.center.some((p,i)=>p!==lens.subject.center[i])));
  }
  function step(v, elapsed) {
    const dt = M.clamp(Number.isFinite(elapsed) ? elapsed : 0,0,.065);
    if (!dt) return 0;
    const ease = 1-Math.exp(-13*dt);
    if (v.auto) {
      v.orbitTime += dt;
      v.targetYaw = v.orbitCenter+.255*Math.sin(v.orbitTime*.065);
    }
    v.yaw = approach(v.yaw,v.targetYaw,ease);
    v.pitch = approach(v.pitch,v.targetPitch,ease);
    v.zoom = approach(v.zoom,v.targetZoom,ease);
    moveLens(v.lens,ease);
    return dt;
  }
  function camera(v, width, height) {
    const aspect = Math.max(width,1)/Math.max(height,1), flat = Math.cos(v.pitch);
    const direction = [Math.sin(v.yaw)*flat,Math.sin(v.pitch),Math.cos(v.yaw)*flat];
    const eye = M.scale(direction,20), view = M.lookAt(eye,[0,0,0]);
    let left=Infinity, right=-Infinity, bottom=Infinity, top=-Infinity;
    for (const [x,y,z] of FRAME_POINTS) {
      const px=view[0]*x+view[4]*y+view[8]*z+view[12];
      const py=view[1]*x+view[5]*y+view[9]*z+view[13];
      left=Math.min(left,px); right=Math.max(right,px);
      bottom=Math.min(bottom,py); top=Math.max(top,py);
    }
    let halfH = Math.max((right-left)/aspect,top-bottom)*.554;
    let cx = (left+right)/2, cy = (bottom+top)/2;
    const lens = v.lens;
    if (lens?.mix) {
      const [x,y] = M.transform4(view,...lens.center,1);
      cx += (x-cx)*lens.mix; cy += (y-cy)*lens.mix;
      halfH += (lens.span/Math.min(aspect,1)-halfH)*lens.mix;
    }
    halfH /= v.zoom;
    const halfW = halfH*aspect;
    const projection = M.ortho(cx-halfW,cx+halfW,cy-halfH,cy+halfH,1,45);
    return {matrix:M.multiply(projection,view), eye, right:[view[0],view[4],view[8]], direction};
  }

  // The renderer makes a feathered, camera-facing strip from these points.
  function steamPoint(source, strand, u, time, wind = 0, drink) {
    const phase = source.phase + strand*2.15, curl = u*7.8-time*1.22+phase;
    const envelope = Math.sin(Math.PI*u);
    const drift = wind*(source.draft || 0)*u*u;
    const cup = source.adjustable && drink;
    const heat = cup ? cup.heat : 1;
    return {
      x:source.x+(strand-1)*.045+u*.06+Math.sin(curl)*(.016+.080*u)-.16*drift,
      y:source.y+(cup ? cup.drop : 0)+u*source.height*(.7+.3*heat)-.09*drift,
      z:source.z+Math.cos(curl*.8+phase)*(.012+.04*u)+.64*drift,
      width:.011+.041*u+.012*envelope,
      alpha:heat*Math.max(0,envelope)*(.58+.19*Math.sin(u*7-time*1.9+phase))
    };
  }

  function pickPixel(x, y, cssWidth, cssHeight, bufferWidth, bufferHeight) {
    if (![x,y,cssWidth,cssHeight,bufferWidth,bufferHeight].every(Number.isFinite) ||
        cssWidth<=0 || cssHeight<=0 || bufferWidth<1 || bufferHeight<1 ||
        x<0 || y<0 || x>=cssWidth || y>=cssHeight) return null;
    return [Math.floor(x*bufferWidth/cssWidth), bufferHeight-1-Math.floor(y*bufferHeight/cssHeight)];
  }
  function cycleIndex(index,delta,count) {
    return ((index+delta)%count+count)%count;
  }
  function moved(start, current, threshold = 5) {
    return Math.hypot(current.x-start.x,current.y-start.y) >= threshold;
  }

  function exposed(point, direction, maxDistance=Infinity) {
    // Keep labels inside the cutaway when a manual orbit goes behind a wall.
    for (const [axis,plane,span] of [[0,-4.47,3.38],[2,-3.28,4.58]]) {
      if (direction[axis] >= -1e-6) continue;
      const distance = (plane-point[axis])/direction[axis];
      const across = axis===0 ? 2 : 0;
      if (distance>0 && distance<maxDistance && point[1]+distance*direction[1]<3.33 &&
          Math.abs(point[across]+distance*direction[across]) < span) return false;
    }
    return true;
  }

  function steamMesh(sources, segments = 20) {
    const strips = sources.length * 3;
    const vertices = new Float32Array(strips * (segments+1) * 2 * 5);
    const indices = new Uint16Array(strips * segments * 6);
    let index = 0;
    for (let strip=0; strip<strips; strip++) {
      for (let segment=0; segment<segments; segment++) {
        const a = (strip * (segments+1) + segment) * 2;
        indices.set([a,a+1,a+2, a+2,a+1,a+3],index);
        index += 6;
      }
    }
    return {vertices, indices, segments};
  }

  function updateSteam(mesh, sources, right, time, wind = 0, drink) {
    let i = 0;
    for (const source of sources) for (let strand=0; strand<3; strand++) {
      for (let step=0; step<=mesh.segments; step++) {
        const p = steamPoint(source,strand,step/mesh.segments,time,wind,drink);
        for (let edge=-1; edge<=1; edge+=2) {
          const offset = edge * p.width;
          mesh.vertices[i++] = p.x + right[0]*offset;
          mesh.vertices[i++] = p.y + right[1]*offset;
          mesh.vertices[i++] = p.z + right[2]*offset;
          mesh.vertices[i++] = edge;
          mesh.vertices[i++] = p.alpha;
        }
      }
    }
  }

  const api = {HOME,LIMITS,FRAME_POINTS,createView,setOrbit,rotate,zoomBy,resetView,focusOn,leaveFocus,
    settle,cameraMoving,step,camera,
    steamPoint,steamMesh,updateSteam,pickPixel,cycleIndex,moved,exposed};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else PocketPlaces.sim = api;
})();
