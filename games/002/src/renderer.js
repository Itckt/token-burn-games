(() => {
  "use strict";
  const {math:M,mesh:{Builder,STRIDE,TAU},art,relay:Relay,deck:Deck,signal:Signal,supply:Supply,freight:Freight}=Slipwake;
  const YAW=-0.245, PITCH=0.855, UP=[0,1,0], IDENTITY=M.model();
  const TEAM=[[0.39,1.0,0.85],[1.0,0.43,0.30]], PEARL=[1,0.98,0.79], AMBER=[1,0.75,0.33];
  const ICE=[0.64,0.86,1.0], VIOLET=[0.79,0.72,1.0];
  const vertex=`
    attribute vec3 aPosition, aNormal, aColor;
    attribute float aGlow;
    uniform mat4 uVP, uModel, uLight;
    varying mediump vec3 vWorld, vNormal, vColor, vLight;
    varying mediump float vGlow;
    void main() {
      vec4 w = uModel * vec4(aPosition,1.0);
      vWorld=w.xyz;
      vNormal=(uModel*vec4(aNormal,0.0)).xyz;
      vColor=aColor; vGlow=aGlow;
      vLight=(uLight*w).xyz*0.5+0.5;
      gl_Position=uVP*w;
    }`;
  const precision=`
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
  `;
  const lighting=precision+`
    varying mediump vec3 vWorld, vNormal, vColor, vLight;
    varying mediump float vGlow;
    uniform sampler2D uMap;
    uniform float uTexel, uFlash;
    float visibility(vec2 offset,float bias) {
      vec2 depth=texture2D(uMap,vLight.xy+offset*uTexel).rg;
      return step(vLight.z-bias,depth.r+depth.g/255.0);
    }
    void main() {
      vec3 n=normalize(vNormal);
      float sun=max(dot(n,normalize(vec3(-20.,35.,17.))),0.);
      float bias=0.00055+0.0011*(1.-sun);
      float visibility4=(visibility(vec2(-0.8,-0.6),bias)+visibility(vec2(0.6,-0.8),bias)
        +visibility(vec2(0.8,0.6),bias)+visibility(vec2(-0.6,0.8),bias))*0.25;
      float sky=n.y*0.5+0.5;
      vec3 ambient=mix(vec3(.39,.46,.49),vec3(.64,.72,.75),sky);
      vec3 lit=vColor*(ambient+vec3(.55,.47,.35)*sun*visibility4);
      lit=mix(lit,vColor*1.16,vGlow);
      lit=mix(lit,vec3(1.,.91,.71),uFlash);
      float haze=smoothstep(16.,34.,length(vWorld.xz))*.25;
      gl_FragColor=vec4(mix(lit,vec3(.32,.49,.52),haze),1.);
    }`;
  const waterVert=`
    attribute vec3 aPosition;
    uniform mat4 uVP;
    varying mediump vec2 vSea;
    void main(){vSea=aPosition.xz;gl_Position=uVP*vec4(aPosition,1.);}
  `;
  const waterFrag=precision+`
    varying mediump vec2 vSea;
    uniform float uTime;
    float hash(vec2 p){return fract(sin(dot(p,vec2(43.17,17.31)))*1371.14);}
    float noise(vec2 p){
      vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);
    }
    void main(){
      vec2 p=vSea; float t=uTime;
      float swell=noise(p*.16+vec2(t*.025,0.));
      vec3 col=mix(vec3(.105,.229,.262),vec3(.205,.370,.392),swell);
      float a=p.y*5.7+sin(p.x*1.07+t*.64)*.73+noise(p*.53)*3.0+t*.83;
      float crest=smoothstep(.90,.99,cos(a))*smoothstep(.49,.78,noise(p*vec2(.48,1.02)+vec2(t*.095,0.)));
      float fine=smoothstep(.968,.995,cos(a*2.37+p.x*.49-t*.37))*smoothstep(.53,.8,noise(p*1.2));
      col+=vec3(.087,.136,.132)*crest+vec3(.043,.073,.075)*fine;
      vec2 q=abs(p)-vec2(15.22,9.49);
      float dist=length(max(q,0.))+min(max(q.x,q.y),0.);
      float foam=1.-smoothstep(.04,.20,abs(dist-.23-.11*sin(a*.7)));
      col+=vec3(.12,.17,.15)*foam;
      col*=.83+.17*smoothstep(0.,2.3,dist);
      gl_FragColor=vec4(col,1.);
    }`;
  const depthVert=`attribute vec3 aPosition;uniform mat4 uVP;void main(){gl_Position=uVP*vec4(aPosition,1.);}`;
  const depthFrag=precision+`void main(){float d=gl_FragCoord.z*255.;gl_FragColor=vec4(floor(d)/255.,fract(d),0.,1.);}`;
  const fxVert=`attribute vec3 aPosition;attribute vec4 aTint;uniform mat4 uVP;varying mediump vec4 vTint;
    void main(){vTint=aTint;gl_Position=uVP*vec4(aPosition,1.);}`;
  const fxFrag=precision+`varying mediump vec4 vTint;void main(){gl_FragColor=vTint;}`;
  function program(gl,vs,fs,uniforms) {
    const p=gl.createProgram();
    for (const [kind,source] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]) {
      const shader=gl.createShader(kind);
      gl.shaderSource(shader,source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
      gl.attachShader(p,shader); gl.deleteShader(shader);
    }
    ["aPosition","aNormal","aColor","aGlow","aTint"].forEach((attr,i)=>gl.bindAttribLocation(p,i,attr));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
    const u={program:p};
    for (const key of uniforms.split(" ")) u[key]=gl.getUniformLocation(p,key);
    return u;
  }
  function upload(gl,data) {
    const buffer=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
    return {buffer,count:data.length/STRIDE};
  }
  function bind(gl,mesh,full=true) {
    gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,40,0);
    for (let i=1;i<=3;i++) {
      if (full) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i,i===3?1:3,gl.FLOAT,false,40,i*12); }
      else gl.disableVertexAttribArray(i);
    }
    gl.disableVertexAttribArray(4);
  }
  function context(canvas,alpha=false) {
    const settings={alpha,antialias:true,depth:true,stencil:false,premultipliedAlpha:false,powerPreference:"high-performance"};
    return canvas.getContext("webgl",settings) || canvas.getContext("experimental-webgl",settings);
  }
  function shadow(gl,stage,light) {
    const size=Math.min(2048,gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    const tex=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    const fbo=gl.createFramebuffer(),depth=gl.createRenderbuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER,fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindRenderbuffer(gl.RENDERBUFFER,depth); gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,size,size);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE) {
      const p=program(gl,depthVert,depthFrag,"uVP");
      gl.viewport(0,0,size,size); gl.clearColor(1,1,1,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.useProgram(p.program); gl.uniformMatrix4fv(p.uVP,false,light);
      bind(gl,stage,false); gl.drawArrays(gl.TRIANGLES,0,stage.count); gl.deleteProgram(p.program);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.deleteFramebuffer(fbo); gl.deleteRenderbuffer(depth);
    return {tex,size};
  }
  class Batch {
    constructor(gl) { this.gl=gl; this.buffer=gl.createBuffer(); this.data=new Float32Array(16384); this.length=0; }
    point(x,y,z,c,a) {
      if (this.length+7>this.data.length) {
        const bigger=new Float32Array(this.data.length*2); bigger.set(this.data); this.data=bigger;
      }
      const d=this.data,i=this.length;
      d[i]=x;d[i+1]=y;d[i+2]=z;d[i+3]=c[0];d[i+4]=c[1];d[i+5]=c[2];d[i+6]=a;this.length+=7;
    }
    ring(x,y,z,r,w,col,alpha,start=0,end=TAU,segments=40) {
      for (let i=0;i<segments;i++) {
        const a=start+(end-start)*i/segments,b=start+(end-start)*(i+1)/segments;
        const sa=Math.sin(a),ca=Math.cos(a),sb=Math.sin(b),cb=Math.cos(b);
        const p=(s,c,rad)=>this.point(x+s*rad,y,z+c*rad,col,alpha);
        p(sa,ca,r);p(sb,cb,r);p(sb,cb,r-w);p(sa,ca,r);p(sb,cb,r-w);p(sa,ca,r-w);
      }
    }
    blob(x,z,rx,rz) {
      const col=[0.075,0.14,0.15];
      for (let i=0;i<18;i++) {
        const a=TAU*i/18,b=TAU*(i+1)/18;
        this.point(x,0.053,z,col,0.53);
        this.point(x+rx*Math.sin(a),0.053,z+rz*Math.cos(a),col,0);
        this.point(x+rx*Math.sin(b),0.053,z+rz*Math.cos(b),col,0);
      }
    }
    strip(x,z,ex,ez,y,w,col,alpha) {
      const dx=ex-x,dz=ez-z,n=Math.hypot(dx,dz)||1,a=-dz*w/n/2,b=dx*w/n/2;
      this.point(x+a,y,z+b,col,alpha);this.point(ex+a,y,ez+b,col,alpha);this.point(ex-a,y,ez-b,col,alpha);
      this.point(x+a,y,z+b,col,alpha);this.point(ex-a,y,ez-b,col,alpha);this.point(x-a,y,z-b,col,alpha);
    }
    cable(x,y,z,ex,ey,ez,width,color,alpha) {
      const a=Math.cos(YAW)*width/2,b=-Math.sin(YAW)*width/2;
      this.point(x-a,y,z-b,color,alpha); this.point(x+a,y,z+b,color,alpha); this.point(ex+a,ey,ez+b,color,alpha);
      this.point(x-a,y,z-b,color,alpha); this.point(ex+a,ey,ez+b,color,alpha); this.point(ex-a,ey,ez-b,color,alpha);
    }
    draw(gl,p,vp) {
      if (!this.length) return;
      gl.useProgram(p.program); gl.uniformMatrix4fv(p.uVP,false,vp);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      gl.bufferData(gl.ARRAY_BUFFER,this.data.subarray(0,this.length),gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,28,0);
      for (let i=1;i<4;i++) gl.disableVertexAttribArray(i);
      gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4,4,gl.FLOAT,false,28,12);
      gl.disable(gl.CULL_FACE);gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false); gl.drawArrays(gl.TRIANGLES,0,this.length/7); gl.depthMask(true);
      gl.disable(gl.BLEND);gl.enable(gl.CULL_FACE); this.length=0;
    }
  }
  function makeRig(gl,team,variant) {
    const raw=art.runner(team,variant);
    return Object.fromEntries(Object.entries(raw).map(([k,data])=>[k,upload(gl,data)]));
  }
  function drawOrders(batch,match,time) {
    if (match.focus) {
      const foe=match.actors[match.focus.target];
      for (let i=0;i<4;i++) {
        const a=TAU*(i+0.5)/4, x=Math.sin(a), z=Math.cos(a);
        const r=1.25+0.05*Math.cos(time*6);
        const tipX=foe.x+x*0.89, tipZ=foe.z+z*0.89;
        for (const side of [-1,1]) {
          batch.strip(foe.x+x*r+side*z*0.17,foe.z+z*r-side*x*0.17,tipX,tipZ,0.14,0.075,AMBER,1);
        }
      }
    }
    if (match.rally) {
      const {x,z,remaining}=match.rally, color=TEAM[0];
      const phase=(time*1.4)%1, fade=Math.min(1,remaining*3);
      batch.ring(x,0.095,z,0.68+0.6*phase,0.06,color,(1-phase)*fade,0,TAU,28);
      batch.ring(x,0.096,z,0.56,0.09,color,0.9*fade,0,TAU,24);
      batch.point(x,0.08,z,color,fade); batch.point(x+0.08,0.08,z,color,fade); batch.point(x,1.56,z,color,fade);
      batch.point(x,1.56,z,color,fade); batch.point(x+0.64,1.36,z,color,fade); batch.point(x,1.13,z,color,fade);
    }
    if (match.net) {
      const {x,z,remaining}=match.net, radius=Deck.RULES.netRadius, fade=Math.min(1,remaining*3);
      const top=1.04+0.06*Math.sin(time*5);
      batch.ring(x,0.09,z,radius,0.075,ICE,0.92*fade,0,TAU,12);
      batch.ring(x,top,z,radius,0.042,ICE,0.8*fade,0,TAU,12);
      for (let i=0;i<12;i++) {
        const a=i*TAU/12, b=(i+1)*TAU/12;
        const ax=x+Math.sin(a)*radius, az=z+Math.cos(a)*radius;
        const bx=x+Math.sin(b)*radius, bz=z+Math.cos(b)*radius;
        batch.point(ax,top,az,ICE,0.27*fade); batch.point(bx,top,bz,ICE,0.27*fade); batch.point(ax,0.09,az,ICE,0.02);
      }
    }
  }
  function drawStation(batch,signal,time) {
    const {x,z}=Signal.stations[signal.station], r=Signal.RULES.radius;
    const color=TEAM[signal.owner] || VIOLET;
    for (let i=0;i<4;i++) {
      const a=i*TAU/4, tint=signal.contested ? TEAM[i%2] : color;
      batch.ring(x,0.145,z,r,0.135,tint,0.98,a+0.045,a+TAU/4-0.045,12);
      const h=0.41+0.1*Math.sin(time*3);
      const px=x+Math.sin(a)*r, pz=z+Math.cos(a)*r;
      const tx=Math.cos(a)*0.13,tz=-Math.sin(a)*0.13;
      batch.point(px-tx,0.14,pz-tz,tint,0.9);
      batch.point(px+tx,0.14,pz+tz,tint,0.9);
      batch.point(px,h,pz,tint,0.1);
    }
    if (signal.progress>0) {
      batch.ring(x,0.14,z,r-0.22,0.08,color,1,0,TAU*signal.progress/Signal.RULES.pointTime,36);
    }
    if (signal.remaining<=Signal.RULES.previewTime) {
      const next=Signal.stations[Signal.nextStation(signal)];
      for (let i=0;i<8;i++) {
        const a=i*TAU/8+time*0.45;
        batch.ring(next.x,0.14,next.z,r,0.09,VIOLET,0.7,a,a+0.39,4);
      }
    }
  }
  function passGuide(batch,actors,carrier,aim) {
    const dx=aim[0]-carrier.x,dz=aim[2]-carrier.z;
    const yaw=Math.hypot(dx,dz)>0.025 ? Math.atan2(dx,dz) : carrier.yaw;
    const sx=Math.sin(yaw), sz=Math.cos(yaw), reach=Relay.RULES.passRange;
    const end=Relay.trace(actors,carrier,carrier.x,carrier.z,sx*reach,sz*reach);
    const distance=Math.hypot(end.x-carrier.x,end.z-carrier.z);
    const color=end.receiver ? TEAM[end.receiver.team] : AMBER;
    for (let d=0.85;d<distance-0.15;d+=0.62) {
      const to=Math.min(distance-0.15,d+0.32);
      batch.strip(carrier.x+d*sx,carrier.z+d*sz,carrier.x+to*sx,carrier.z+to*sz,0.105,0.065,color,0.85);
    }
    batch.ring(end.x,0.12,end.z,0.24,0.064,color,0.95,0,TAU,16);
  }
  class Renderer {
    constructor(canvas) {
      this.canvas=canvas;
      const gl=this.gl=context(canvas);
      if (!gl) throw Error("WebGL is unavailable");
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
      this.surface=program(gl,vertex,lighting,"uVP uModel uLight uMap uTexel uFlash");
      this.seaProgram=program(gl,waterVert,waterFrag,"uVP uTime");
      this.particleProgram=program(gl,fxVert,fxFrag,"uVP");
      this.stage=upload(gl,art.world());
      this.core=upload(gl,art.relayCore());
      this.gates=upload(gl,art.relayGates());
      this.pads=upload(gl,art.signalPads());
      this.crate=upload(gl,art.supplyCrate());
      this.track=upload(gl,art.freightTrack());
      this.cart=upload(gl,art.freightCart());
      const sea=new Builder(); sea.tile(0,-1.9,0,220,220,"#ffffff");
      this.sea=upload(gl,sea.finish());
      this.light=M.multiply(M.ortho(-30,30,-26,26,1,89),M.lookAt([-20,35,17],[0,0,0]));
      this.map=shadow(gl,this.stage,this.light);
      this.rigs=Array.from({length:6},(_,i)=>makeRig(gl,i<3?0:1,i%3));
      this.batch=new Batch(gl); this.focusX=0;this.focusZ=0;this.clock=0;
      this.width=1;this.height=1;
      this.camera(0,0,0);
    }
    camera(x,z,dt) {
      const canvas=this.canvas, width=canvas.clientWidth||1,height=canvas.clientHeight||1;
      const dpr=Math.min(globalThis.devicePixelRatio||1,1.7,Math.sqrt(2250000/(width*height)));
      const w=Math.max(1,Math.round(width*dpr)),h=Math.max(1,Math.round(height*dpr));
      if (canvas.width!==w || canvas.height!==h) { canvas.width=w;canvas.height=h; }
      const follow=1-Math.exp(-3.0*dt), aspect=width/height;
      this.focusX=M.mix(this.focusX,x*(aspect<1.1 ? 0.62 : 0.17),follow);
      this.focusZ=M.mix(this.focusZ,z*0.24,follow);
      const target=[this.focusX,0.24,this.focusZ];
      if (width===this.width && height===this.height && this.lastX===target[0] && this.lastZ===target[2]) return;
      this.width=width;this.height=height;this.lastX=target[0];this.lastZ=target[2];
      const halfH=Math.max(9.75,Math.min(15.8,16.55/aspect));
      this.pixelsPerUnit=height/(2*halfH);
      const eye=[target[0]+Math.sin(YAW)*27, target[1]+Math.tan(PITCH)*27,target[2]+Math.cos(YAW)*27];
      this.vp=M.multiply(M.ortho(-halfH*aspect,halfH*aspect,-halfH,halfH,0.5,105),M.lookAt(eye,target,UP));
      this.inv=M.inverse(this.vp);
    }
    locate(x,y,z) {
      const p=M.project(this.vp,x,y,z);
      return {x:(p[0]+1)*0.5*this.width,y:(1-p[1])*0.5*this.height};
    }
    pickRunner(x,y,actors,passing=false) {
      // The top of a runner projects above its feet. A click on either should aim at it.
      let closest=null, best=Infinity;
      const radius=0.57*this.pixelsPerUnit;
      for (const a of actors) {
        if (!a.hp || a.id===0 || (!passing && !a.team) || (passing && (a.shield>0 || a.dashLeft>0))) continue;
        const head=this.locate(a.x,1.78,a.z), foot=this.locate(a.x,0.26,a.z);
        const dy=y-M.clamp(y,head.y,foot.y), distance=Math.hypot(x-foot.x,dy);
        if (distance<=radius && distance<best) { best=distance; closest=a; }
      }
      return closest;
    }
    pick(x,y,actors=[],passing=false) {
      const runner=this.pickRunner(x,y,actors,passing);
      if (runner) return [runner.x,0,runner.z];
      return M.groundPoint(this.inv,2*x/this.width-1,1-2*y/this.height);
    }
    drawMesh(mesh,transform,flash=0) {
      const g=this.gl,p=this.surface;
      bind(g,mesh); g.uniformMatrix4fv(p.uModel,false,transform); g.uniform1f(p.uFlash,flash);
      g.drawArrays(g.TRIANGLES,0,mesh.count);
    }
    drawFreight(cart) {
      const b=this.batch, r=Freight.RULES.radius, t=this.clock;
      this.drawMesh(this.track,IDENTITY);
      this.drawMesh(this.cart,M.model(cart.x,0.03,cart.z));
      b.blob(cart.x,cart.z,1.25,0.83);
      const color=TEAM[cart.owner] || AMBER;
      for (let i=0;i<6;i++) {
        const start=i*TAU/6, tint=cart.contested ? TEAM[i%2] : color;
        b.ring(cart.x,0.12,cart.z,r,0.095,tint,0.94,start+0.05,start+TAU/6-0.05,8);
      }
      if (cart.resetLeft>0) {
        b.ring(0,0.13,0,r,0.075,AMBER,0.85,0,TAU*(1-cart.resetLeft/Freight.RULES.resetTime),36);
      } else if (cart.owner!==null) {
        const direction=cart.owner===0 ? 1 : -1;
        const x=cart.x+direction*(1.25+(t*1.4)%0.55);
        for (const side of [-1,1]) b.strip(x,side*0.25,x+direction*0.26,0,0.14,0.095,color,1);
      }
    }
    drawSupply(match) {
      const drop=match.supply, site=Supply.sites[drop.site], b=this.batch;
      const remaining=Math.max(0,drop.nextAt-match.elapsed);
      const incoming=drop.state==="incoming", r=Supply.RULES.radius;
      const height=incoming ? 4.3*Math.min(1,remaining/Supply.RULES.leadTime) : 0;
      const x=site.x+Math.sin(this.clock*2)*height*0.045, z=site.z;
      this.drawMesh(this.crate,M.model(x,0.045+height,z,0.26));
      b.blob(site.x,z,0.83,0.61);
      for (let i=0;i<4;i++) {
        const angle=i*TAU/4;
        const tint=drop.contested ? TEAM[i%2] : ICE;
        b.ring(site.x,0.105,z,r,0.09,tint,0.95,angle+0.10,angle+TAU/4-0.10,9);
      }
      if (incoming) {
        const phase=(this.clock*1.4)%1;
        const tension=Math.min(0.85,remaining*3);
        for (const side of [-1,1]) {
          b.cable(x+side*0.39,height+0.83,z-side*0.10,site.x,height+1.58,z,0.038,PEARL,tension);
        }
        b.cable(site.x,height+1.58,z,site.x,height+4.3,z,0.031,PEARL,tension);
        b.ring(site.x,0.115,z,r+0.55*(1-phase),0.05,ICE,phase,0,TAU,28);
      } else {
        b.ring(site.x,0.115,z,r-0.14,0.045,PEARL,0.9,0,TAU*remaining/Supply.RULES.window,32);
      }
    }
    drawRelay(match,aim) {
      const core=match.relay, t=this.clock, b=this.batch;
      const carrier=match.actors[core.carrier];
      const bob=0.075*Math.sin(3*t);
      let x=core.x,z=core.z,y=0.87+bob;
      this.drawMesh(this.gates,IDENTITY);
      if (carrier) {
        x-=Math.sin(carrier.yaw)*0.47;
        z-=Math.cos(carrier.yaw)*0.47;
        y=2.13+bob;
        const gate=Relay.gates[1-carrier.team];
        b.ring(gate.x,0.092,gate.z,Relay.RULES.gateRadius+0.13,0.09,AMBER,0.75+0.2*Math.sin(t*5));
        if (carrier.id===0) {
          const dx=gate.x-core.x,dz=gate.z-core.z,n=Math.hypot(dx,dz)||1;
          for (const d of [1.25,1.8,2.35]) {
            const px=core.x+d*dx/n,pz=core.z+d*dz/n;
            for (const s of [-1,1]) b.strip(px,pz,px-(0.26*dx+s*0.21*dz)/n,pz-(0.26*dz-s*0.21*dx)/n,0.10,0.07,AMBER,0.9);
          }
          if (aim) passGuide(b,match.actors,carrier,aim);
        }
      } else if (core.flight) {
        const f=core.flight;
        y=1.0+0.64*Math.sin(Math.PI*f.distance/Relay.RULES.passRange);
        const trail=Math.min(1.1,f.distance);
        b.strip(x,z,x-trail*f.dx,z-trail*f.dz,y,0.16,AMBER,0.69);
        b.blob(x,z,0.42,0.30);
      } else {
        b.blob(x+0.12,z,0.62,0.43);
        b.ring(x,0.078,z,Relay.RULES.pickupRadius,0.06,AMBER,core.lock>0 ? 0.35 : 0.9);
        for (let i=0;i<3;i++) {
          const start=-t+i*TAU/3;
          b.ring(x,0.12,z,0.76,0.11,PEARL,0.78,start,start+0.59,7);
        }
      }
      this.drawMesh(this.core,M.model(x,y,z,t*1.4));
    }
    render(match,effects,dt,aim,passAim) {
      const gl=this.gl,player=match.actors[0],frozen=match.phase==="paused" || match.phase==="ended";
      if (!frozen) this.clock+=dt;
      this.camera(match.phase==="ready" ? 0 : player.x,match.phase==="ready" ? 0 : player.z,frozen ? 0 : dt);
      gl.viewport(0,0,this.canvas.width,this.canvas.height);
      gl.clearColor(0.14,0.26,0.29,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      const p=this.surface;
      gl.useProgram(p.program);gl.uniformMatrix4fv(p.uVP,false,this.vp);gl.uniformMatrix4fv(p.uLight,false,this.light);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.map.tex);gl.uniform1i(p.uMap,0);gl.uniform1f(p.uTexel,1/this.map.size);
      this.drawMesh(this.stage,IDENTITY);
      const b=this.batch;
      if (match.supply.state!=="waiting") this.drawSupply(match);
      if (match.relay) this.drawRelay(match,passAim);
      if (match.freight) this.drawFreight(match.freight);
      if (match.signal) {
        this.drawMesh(this.pads,IDENTITY);
        drawStation(b,match.signal,this.clock);
      }
      drawOrders(b,match,this.clock);
      for (const a of match.actors) {
        if (a.hp<=0) continue;
        const rig=this.rigs[a.id],t=this.clock,s=1.09;
        const bob=0.019*Math.sin(t*2.7+a.id)+Math.min(a.speed,4)*0.013*Math.abs(Math.cos(a.stride));
        const root=M.model(a.x,bob,a.z,a.yaw,s,s,s);
        const flash=a.hpFlash>0 ? 0.5*(a.hpFlash/0.16) : 0;
        this.drawMesh(rig.body,root,flash);
        for (const side of [-1,1]) {
          const motion=Math.sin(a.stride)*Math.min(a.speed/3,1)*side;
          this.drawMesh(rig.leg,M.multiply(root,M.model(side*0.212,Math.max(0,motion)*0.085,motion*0.17)),flash);
        }
        this.drawMesh(rig.gun,M.multiply(root,M.model(0,0,-a.recoil*0.105)),flash);
        b.blob(a.x+0.22,a.z-0.14,0.91,0.65);
        const color=TEAM[a.team];
        if (a.vaneLeft>0) {
          for (let i=0;i<3;i++) {
            const start=t*12+i*TAU/3;
            b.ring(a.x,0.93,a.z,0.91,0.15,VIOLET,0.94,start,start+1.55,9);
            b.ring(a.x,1.01,a.z,0.96,0.05,PEARL,0.94,start+1.15,start+1.55,4);
          }
        }
        if (a.boostLeft>0) {
          const dx=Math.sin(a.yaw), dz=Math.cos(a.yaw);
          for (const side of [-1,1]) {
            const x=a.x+side*dz*0.31, z=a.z-side*dx*0.31;
            b.strip(x,z,x-dx*0.9,z-dz*0.9,0.24,0.09,ICE,Math.min(0.8,a.boostLeft*2));
          }
        }
        b.ring(a.x,0.061,a.z,a.id===0 ? 0.92 : 0.74,a.id===0 ? 0.083 : 0.046,color,a.id===0 ? 0.93 : 0.73,0,TAU,32);
        if (a.id===0 || a.shield>0) {
          for (let i=0;i<3;i++) {
            const start=t*0.55+i*TAU/3;
            b.ring(a.x,0.068,a.z,1.08,0.061,a.shield>0 ? PEARL : AMBER,0.93,start,start+0.47,5);
          }
        }
      }
      // Fill the opaque depth buffer first so covered water pixels can skip the wave shader.
      const water=this.seaProgram;
      gl.useProgram(water.program);gl.uniformMatrix4fv(water.uVP,false,this.vp);
      gl.uniform1f(water.uTime,this.clock);bind(gl,this.sea,false);gl.drawArrays(gl.TRIANGLES,0,this.sea.count);
      if (aim && player.hp>0 && match.phase==="playing") {
        const [x,,z]=aim;
        b.ring(x,0.072,z,0.28,0.037,PEARL,0.76,0,TAU,20);
      }
      for (const shot of match.shots) {
        const dx=Math.sin(shot.yaw),dz=Math.cos(shot.yaw),x=shot.x,z=shot.z;
        const color=shot.returned ? VIOLET : shot.bank ? AMBER : TEAM[shot.team];
        b.strip(x,z,x-dx*0.75,z-dz*0.75,1.08,0.25,color,shot.returned || shot.bank ? 0.9 : 0.43);
        b.strip(x,z,x-dx*0.55,z-dz*0.55,1.09,0.10,PEARL,1);
      }
      for (const ring of effects.rings) {
        const t=ring.age/ring.life,rad=0.42+(ring.end-0.42)*(1-(1-t)*(1-t));
        b.ring(ring.x,ring.signal ? 0.15 : 0.09,ring.z,rad,0.15*(1-t)+0.025,ring.signal ? VIOLET : ring.gold ? AMBER : TEAM[ring.team],1-t);
      }
      for (const tether of effects.tethers) {
        const fade=1-tether.age/tether.life;
        b.strip(tether.x,tether.z,tether.toX,tether.toZ,1.06,0.16,TEAM[0],fade*0.65);
        b.strip(tether.x,tether.z,tether.toX,tether.toZ,1.07,0.048,PEARL,fade);
      }
      const right=[Math.cos(YAW),0,-Math.sin(YAW)],up=[-Math.sin(YAW)*Math.sin(PITCH),Math.cos(PITCH),-Math.cos(YAW)*Math.sin(PITCH)];
      for (const q of effects.bits) {
        const fade=1-q.age/q.life,col=q.white ? PEARL : q.signal ? VIOLET : q.gold ? AMBER : TEAM[q.team],r=q.size*(0.5+0.5*fade);
        const pt=(u,v)=>b.point(q.x+(right[0]*u+up[0]*v)*r,q.y+up[1]*v*r,q.z+(right[2]*u+up[2]*v)*r,col,fade);
        pt(0,1.5);pt(1,0);pt(0,-1.5);pt(0,1.5);pt(0,-1.5);pt(-1,0);
      }
      b.draw(gl,this.particleProgram,this.vp);
    }
  }
  // Render the HUD portrait once from the very same rig as the player's model.
  function portrait(destination) {
    const image=destination.getContext("2d");
    if (!image) return;
    const canvas=document.createElement("canvas");
    const gl=context(canvas,true);
    if (!gl) return;
    const vs=`attribute vec3 aPosition,aColor,aNormal;attribute float aGlow;uniform mat4 uVP;
      varying mediump vec3 vColor;void main(){float n=max(dot(aNormal,normalize(vec3(-.6,1.,.9))),0.);
      vColor=aColor*(.68+.53*n)+aColor*aGlow*.15;gl_Position=uVP*vec4(aPosition,1.);}`;
    const fs=precision+`varying mediump vec3 vColor;void main(){gl_FragColor=vec4(vColor,1.);}`;
    const p=program(gl,vs,fs,"uVP");canvas.width=192;canvas.height=186;
    gl.viewport(0,0,192,186);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.useProgram(p.program);
    const view=M.lookAt([1.76,2.38,3.8],[0,1.34,0]);
    gl.uniformMatrix4fv(p.uVP,false,M.multiply(M.ortho(-0.88,0.88,-0.85,0.85,0.1,12),view));
    const rig=makeRig(gl,0,0);
    for (const mesh of [rig.body,rig.gun]) { bind(gl,mesh);gl.drawArrays(gl.TRIANGLES,0,mesh.count); }
    // A 2D copy survives browser WebGL drawing-buffer clears.
    destination.width=192;destination.height=186;
    image.drawImage(canvas,0,0);
    for (const part of Object.values(rig)) gl.deleteBuffer(part.buffer);
    gl.deleteProgram(p.program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
  Slipwake.view={Renderer,portrait,YAW};
})();
