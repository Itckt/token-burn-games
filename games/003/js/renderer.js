(function (R) {
  'use strict';
  const M=R.math, B=R.battle, A=R.arena, Signal=R.signal, {Builder,rgb,STRIDE}=R.mesh, models=R.models;
  const meshVS=[
    'attribute vec3 aPos,aNormal,aColor; attribute float aGlow;',
    'uniform mat4 uVP,uModel; varying mediump vec3 vPos,vNormal,vColor; varying mediump float vGlow;',
    'void main(){vec4 world=uModel*vec4(aPos,1.); vPos=world.xyz;',
    'vNormal=normalize((uModel*vec4(aNormal,0.)).xyz); vColor=aColor; vGlow=aGlow; gl_Position=uVP*world;}'
  ].join('\n');
  const meshFS=[
    'precision mediump float; varying vec3 vPos,vNormal,vColor; varying float vGlow;',
    'uniform vec3 uEye,uTint; uniform float uMode,uFlash,uLane;',
    'void main(){vec3 n=normalize(vNormal),v=normalize(uEye-vPos);',
    'float key=max(dot(n,normalize(vec3(-.40,.86,.48))),0.);',
    'float fill=max(dot(n,normalize(vec3(.76,.40,-.50))),0.);',
    'vec3 color=vColor*uTint*(vec3(.48,.44,.58)+vec3(.58,.60,.57)*key+vec3(.23,.17,.27)*fill);',
    'float rim=pow(1.-max(dot(n,v),0.),3.); color+=vec3(.059,.041,.078)*rim;',
    'if(uMode>2.5){float band=smoothstep(.48,.94,cos(vPos.y*37.));',
    'gl_FragColor=vec4(mix(uTint,vec3(.87,1.,.98),.16+rim*.48),.14+band*.28+rim*.26);return;}',
    'color+=vec3(.65,.66,.73)*pow(max(dot(n,normalize(v+normalize(vec3(-.35,.82,.47)))),0.),24.)*.16;',
    'color=mix(color,vColor*uTint*(1.04+vGlow*.20),min(1.,vGlow));',
    'if(uMode<.5){vec2 dv=vec2(abs(vPos.x)-7.32,abs(vPos.z)-2.16);',
    'vec3 light=vPos.x<0.?vec3(.02,.55,.65):vec3(.67,.08,.34);',
    'color+=light*.24*exp(-dot(dv,dv)*.68)*max(.2,n.y);',
    'float mark=(1.-smoothstep(.94,1.13,abs(vPos.z-uLane)))*step(abs(vPos.x),8.65)*step(vPos.y,.25);color+=vec3(.035,.12,.13)*mark;',
    '} else if(uMode<1.5){float fog=clamp(.30-vPos.z*.012, .16,.57);color=mix(color*.88,vec3(.19,.125,.27),fog);}',
    'else {color+=vColor*(.12+rim*.10);}',
    'gl_FragColor=vec4(mix(color,vec3(.97,.91,1.),uFlash*.79),1.);}'
  ].join('\n');
  const screenVS='attribute vec2 aQuad; varying mediump vec2 uv; void main(){uv=aQuad*.5+.5;gl_Position=vec4(aQuad,0.,1.);}';
  const skyFS=[
    'precision mediump float; varying vec2 uv;',
    'void main(){vec3 col=mix(vec3(.078,.073,.15),vec3(.25,.15,.34),uv.y);',
    'col+=vec3(.093,.038,.09)*max(0.,1.-length((uv-vec2(.72,.76))*vec2(.9,1.5)));gl_FragColor=vec4(col,1.);}'
  ].join('');
  const filterFS=[
    'precision mediump float; varying vec2 uv; uniform sampler2D tex; uniform vec2 delta; uniform float cut;',
    'vec3 sampleLight(vec2 p){vec3 c=texture2D(tex,p).rgb;float v=max(c.r,max(c.g,c.b));return c*mix(1.,smoothstep(.58,.93,v),cut);}',
    'void main(){vec3 c=sampleLight(uv)*.227027;c+=(sampleLight(uv+delta*1.3846)+sampleLight(uv-delta*1.3846))*.316216;',
    'c+=(sampleLight(uv+delta*3.23077)+sampleLight(uv-delta*3.23077))*.070270;gl_FragColor=vec4(c,1.);}'
  ].join('');
  const composeFS=[
    'precision mediump float; varying vec2 uv; uniform sampler2D scene,bloom; uniform vec2 pixel;',
    'void main(){vec3 c=texture2D(scene,uv).rgb;',
    'vec3 r=texture2D(scene,uv+vec2(pixel.x,0.)).rgb,d=texture2D(scene,uv+vec2(0.,pixel.y)).rgb;',
    'float edge=smoothstep(.13,.55,max(length(c-r),length(c-d)));c=mix(c,(c+c+r+d)*.25,edge*.65);',
    'c+=texture2D(bloom,uv).rgb*.36;',
    'float v=dot(uv-.5,uv-.5);c*=1.-v*.32;gl_FragColor=vec4(c,1.);}'
  ].join('');
  const spriteVS=[
    'attribute vec2 aQuad; uniform mat4 uVP; uniform vec3 center,axisX,axisY; varying mediump vec2 loc;',
    'void main(){loc=aQuad; gl_Position=uVP*vec4(center+axisX*aQuad.x+axisY*aQuad.y,1.);}'
  ].join('');
  const spriteFS=[
    'precision mediump float; varying vec2 loc;uniform vec3 tint; uniform float opacity,kind;',
    'void main(){float rad=length(loc); if(kind<3.5 && rad>1.) discard;float a=(1.-smoothstep(.06,1.,rad));',
    'if(kind>3.5){vec2 d=abs(loc);float edge=max(d.x,d.y);float corner=smoothstep(.55,.74,min(d.x,d.y));',
    'a=.065*(1.-smoothstep(.85,1.,edge))+(1.-smoothstep(.015,.06,abs(edge-.94)))*(.23+.77*corner);}',
    'else if(kind>2.5){float hex=max(abs(loc.y),dot(abs(loc),vec2(.866,.5)));',
    'a=.065*(1.-smoothstep(.70,.79,hex))+.85*(1.-smoothstep(.01,.065,abs(hex-.79)));}',
    'else if(kind>.5 && kind<1.5) a=1.-smoothstep(.012,.095,abs(rad-.835));',
    'else if(kind>1.5) a=pow(a,2.)+.35*pow(max(0.,1.-abs(loc.x)*12.),3.)*(1.-rad)+.35*pow(max(0.,1.-abs(loc.y)*12.),3.)*(1.-rad);',
    'gl_FragColor=vec4(tint,a*opacity);}'
  ].join('');
  function program(gl,vs,fs) {
    const shaders=[];
    const make=(type,source)=>{
      const sh=gl.createShader(type);shaders.push(sh);
      gl.shaderSource(sh,source);gl.compileShader(sh);
      if (!gl.getShaderParameter(sh,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    let p=null;
    try {
      const vertex=make(gl.VERTEX_SHADER,vs), fragment=make(gl.FRAGMENT_SHADER,fs);
      p=gl.createProgram();
      gl.attachShader(p,vertex);gl.attachShader(p,fragment);gl.linkProgram(p);
      if (!gl.getProgramParameter(p,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const out={p};
      for (let i=0;i<gl.getProgramParameter(p,gl.ACTIVE_UNIFORMS);i++) {
        const name=gl.getActiveUniform(p,i).name;out[name]=gl.getUniformLocation(p,name);
      }
      for (let i=0;i<gl.getProgramParameter(p,gl.ACTIVE_ATTRIBUTES);i++) {
        const name=gl.getActiveAttrib(p,i).name;out[name]=gl.getAttribLocation(p,name);
      }
      return out;
    } catch (error) {
      if (p) gl.deleteProgram(p);
      throw error;
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
  }
  const WHITE=[1,1,1], ORIGIN=M.identity(), UP=[0,1,0];
  const GOLD = rgb('#ffd073');
  const MINT = rgb('#b6fa96'), UNIT = R.roster.UNIT, Drills = R.drills;
  const Coils = R.coils, Freight = R.freight, LILAC = rgb('#d8b3ff');
  function pose(x,y,z,yaw=0,size=1,roll=0) {
    const c=Math.cos(yaw),s=Math.sin(yaw), cr=Math.cos(roll),sr=Math.sin(roll);
    return new Float32Array([c*cr*size,sr*size,-s*cr*size,0, -c*sr*size,cr*size,s*sr*size,0, s*size,0,c*size,0, x,y,z,1]);
  }
  function beamPose(a,b,radius) {
    const v=M.sub(b,a), n=M.normalize(v), x=M.normalize(M.cross(Math.abs(n[1])>.9?[0,0,1]:UP,n)), z=M.cross(x,n);
    return new Float32Array([x[0]*radius,x[1]*radius,x[2]*radius,0,...v,0,z[0]*radius,z[1]*radius,z[2]*radius,0,(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2,1]);
  }
  class Renderer {
    constructor(canvas) {
      this.canvas=canvas;
      const gl=canvas.getContext('webgl',{alpha:true,antialias:true,depth:true,premultipliedAlpha:false,powerPreference:'high-performance'});
      if (!gl) throw new Error('WebGL is unavailable');
      this.gl=gl;
      this.programs=[];this.enabled=[];this.meshes={};this.targets=[];
      try { this.initialize(); } catch (error) { this.dispose(); throw error; }
    }
    initialize() {
      const gl=this.gl;
      const link=(vs,fs)=>{
        const result=program(gl,vs,fs);
        this.programs.push(result.p);
        return result;
      };
      this.meshProg=link(meshVS,meshFS);this.sky=link(screenVS,skyFS);
      this.filter=link(screenVS,filterFS);this.compose=link(screenVS,composeFS);this.sprite=link(spriteVS,spriteFS);
      this.quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
      this.current=null;this.targetView=0;this.view=0;this.drift=0;this.pointer=0;this.hover=null;
      this.reduced=Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      this.width=0;this.height=0;
      this.upload('city',A.city());this.upload('board',A.board());
      this.upload('cache', models.signalCache());
      this.upload('gate', models.deliveryGate());
      this.upload('coil', models.snareCoil());
      this.upload('freight-cart', models.freightCart());
      this.upload('freight-track', models.freightTrack(Freight.DOCK));
      this.upload('fuse', models.fuse());
      this.upload('uplink', models.uplink());
      this.previewSocket = null;
      for (let t=0;t<2;t++) {
        this.upload('tower'+t,models.tower(t));this.upload('crystal'+t,models.crystal(t));
        for (const c of Object.values(UNIT)) this.upload(c.id+t,models.unit(c.id,t));
      }
      const shaft=new Builder();shaft.cylinder(0,0,0,1,1,1,6,'#ffffff',1);this.upload('beam',shaft.finish());
      const shard=new Builder();shard.cylinder(0,0,0,.57,0,1,4,'#ffffff',.76);this.upload('shard',shard.finish());
      const ruin=new Builder();ruin.box(0,.14,0,1.96,.30,1.85,'#3b3248',.34,.06);
      ruin.cylinder(0,.35,0,.65,.47,.23,8,'#504254');ruin.box(-.27,.53,.16,.39,.41,.42,'#685367',.07,.055);
      this.upload('ruin',ruin.finish());
      this.portraits={};
      this.renderPortraits();
      this.teamTint=models.TEAM.map(rgb);
      this.maxTex=Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
      this.maxRatio=Math.min(1.65,window.devicePixelRatio||1);
      this.pixelRatio=this.maxRatio;this.sampleTime=0;this.sampleFrames=0;
    }
    releaseTarget(t) {
      const gl=this.gl;
      gl.deleteFramebuffer(t.fb);gl.deleteTexture(t.tex);
      if (t.rb) gl.deleteRenderbuffer(t.rb);
    }
    dispose() {
      const gl=this.gl;
      gl.useProgram(null);
      for (const attr of this.enabled) gl.disableVertexAttribArray(attr);
      for (const t of this.targets) this.releaseTarget(t);
      for (const m of Object.values(this.meshes)) gl.deleteBuffer(m.buf);
      if (this.quad) gl.deleteBuffer(this.quad);
      for (const p of this.programs) gl.deleteProgram(p);
      this.enabled=[];this.targets=[];this.meshes={};this.programs=[];this.quad=null;
    }
    upload(name,data) {
      const gl=this.gl, buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
      this.meshes[name]={buf,count:data.length/STRIDE};
    }
    use(p) {
      if (p===this.current) return;
      const gl=this.gl;for (const attr of this.enabled) gl.disableVertexAttribArray(attr);
      this.enabled=[];gl.useProgram(p.p);this.current=p;
    }
    attr(loc,size,stride,offset) {
      const gl=this.gl;
      if (!this.enabled.includes(loc)) {gl.enableVertexAttribArray(loc);this.enabled.push(loc);}
      gl.vertexAttribPointer(loc,size,gl.FLOAT,false,stride,offset);
    }
    quadFor(p) {
      const gl=this.gl;this.use(p);gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);this.attr(p.aQuad,2,0,0);
    }
    beginMeshes(camera,mode=0) {
      const gl=this.gl,p=this.meshProg;this.use(p);
      gl.uniformMatrix4fv(p.uVP,false,camera.vp);gl.uniform3fv(p.uEye,camera.eye);gl.uniform1f(p.uMode,mode);
      gl.uniform1f(p.uLane,this.hover===null?99:B.LANES[this.hover]);
    }
    draw(name,transform=ORIGIN,flash=0,tint=WHITE) {
      const gl=this.gl,p=this.meshProg,m=this.meshes[name];
      gl.bindBuffer(gl.ARRAY_BUFFER,m.buf);this.attr(p.aPos,3,40,0);this.attr(p.aNormal,3,40,12);this.attr(p.aColor,3,40,24);this.attr(p.aGlow,1,40,36);
      gl.uniformMatrix4fv(p.uModel,false,transform);gl.uniform1f(p.uFlash,flash);gl.uniform3fv(p.uTint,tint);
      gl.drawArrays(gl.TRIANGLES,0,m.count);
    }
    renderPortraits() {
      const gl=this.gl, w=440,h=284;
      this.canvas.width=w;this.canvas.height=h;
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,w,h);
      gl.depthMask(true);gl.disable(gl.BLEND);gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);
      for (const c of B.CARDS) {
        const vertices=models.portrait(c.id);
        this.upload('portrait',vertices);
        gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        this.beginMeshes(A.portraitCamera(vertices,w/h),2);this.draw('portrait');
        this.portraits[c.id]=this.canvas.toDataURL('image/png');
        gl.deleteBuffer(this.meshes.portrait.buf);
      }
      delete this.meshes.portrait;
    }
    makeTarget(w,h,depth) {
      const gl=this.gl, tex=gl.createTexture(),fb=gl.createFramebuffer();
      gl.bindTexture(gl.TEXTURE_2D,tex);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
      let rb=null;
      if (depth) {rb=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,rb);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,rb);}
      const target={w,h,tex,fb,rb};
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) {
        this.releaseTarget(target);
        throw new Error('WebGL framebuffer unavailable');
      }
      return target;
    }
    resize() {
      const width=this.canvas.clientWidth,height=this.canvas.clientHeight;
      const ratio=Math.min(this.pixelRatio,this.maxTex/Math.max(1,width,height)), w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio));
      if (this.width===w && this.height===h && this.targets.length===3) return;
      this.width=w;this.height=h;this.canvas.width=w;this.canvas.height=h;
      for (const t of this.targets) this.releaseTarget(t);
      this.targets=[];
      const bw=Math.max(1,Math.ceil(w/3)), bh=Math.max(1,Math.ceil(h/3));
      this.targets.push(this.makeTarget(w,h,true));
      this.targets.push(this.makeTarget(bw,bh,false));
      this.targets.push(this.makeTarget(bw,bh,false));
    }
    sampleFrame(delta) {
      if (delta<=0 || delta>.15) return;
      this.sampleTime+=delta;this.sampleFrames++;
      if (this.sampleTime<2) return;
      const average=this.sampleTime/this.sampleFrames;
      if (average>1/48) this.pixelRatio=Math.max(Math.min(.75,this.maxRatio),this.pixelRatio-.16);
      else if (average<1/68) this.pixelRatio=Math.min(this.maxRatio,this.pixelRatio+.10);
      this.sampleTime=0;this.sampleFrames=0;
    }
    bindTarget(t) {
      const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,t?t.fb:null);gl.viewport(0,0,t?t.w:this.width,t?t.h:this.height);
    }
    texture(tex,slot,loc) {
      const gl=this.gl;gl.activeTexture(gl.TEXTURE0+slot);gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(loc,slot);
    }
    post() {
      const gl=this.gl,[scene,a,b]=this.targets,p=this.filter;
      gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);
      this.bindTarget(a);this.quadFor(p);this.texture(scene.tex,0,p.tex);gl.uniform1f(p.cut,1);gl.uniform2f(p.delta,1.55/a.w,0);gl.drawArrays(gl.TRIANGLES,0,6);
      this.bindTarget(b);this.texture(a.tex,0,p.tex);gl.uniform1f(p.cut,0);gl.uniform2f(p.delta,0,1.55/b.h);gl.drawArrays(gl.TRIANGLES,0,6);
      this.bindTarget(null);const c=this.compose;this.quadFor(c);this.texture(scene.tex,0,c.scene);this.texture(b.tex,1,c.bloom);gl.uniform2f(c.pixel,1/scene.w,1/scene.h);gl.drawArrays(gl.TRIANGLES,0,6);
    }
    sprites(additive) {
      const gl=this.gl,p=this.sprite;this.quadFor(p);gl.disable(gl.CULL_FACE);gl.depthMask(false);
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,additive?gl.ONE:gl.ONE_MINUS_SRC_ALPHA);gl.uniformMatrix4fv(p.uVP,false,this.camera.vp);
    }
    spot(center,rx,ry,tint,opacity,kind=0,ground=false) {
      const gl=this.gl,p=this.sprite;
      gl.uniform3fv(p.center,center);
      gl.uniform3fv(p.axisX,ground?[rx,0,0]:this.right.map(v=>v*rx));
      gl.uniform3fv(p.axisY,ground?[0,0,ry]:this.up.map(v=>v*ry));
      gl.uniform3fv(p.tint,tint);gl.uniform1f(p.opacity,opacity);gl.uniform1f(p.kind,kind);gl.drawArrays(gl.TRIANGLES,0,6);
    }
    endSprites() {
      const gl=this.gl;gl.disable(gl.BLEND);gl.enable(gl.CULL_FACE);gl.depthMask(true);
    }
    placementGhosts(sites, coilPreview) {
      const gl = this.gl, z = B.LANES[this.hover];
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);
      gl.uniform1f(this.meshProg.uMode, 3);
      if (coilPreview) {
        this.draw('coil',pose(Coils.SOCKETS[this.previewSocket],.24,z),0,LILAC);
      } else {
        const spec = UNIT[this.previewCard], y = spec.hover ? .352 : .202;
        for (const {x, offset} of sites) {
          this.draw(spec.id + '0', pose(x, y, z + offset, 0, spec.scale), 0, this.teamTint[0]);
        }
      }
      gl.uniform1f(this.meshProg.uMode, 0);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    fieldEquipment(s, alpha, units, time) {
      if (s.mode === 'salvage') {
        this.draw('uplink', pose(0,.13,0));
        for (const pile of s.objective.piles) {
          const z = B.LANES[pile.lane] + .70;
          for (let i = 0; i < pile.amount; i++) {
            const x = pile.x + (i - (pile.amount - 1) / 2) * .28;
            this.draw('fuse', pose(x,.31 + Math.sin(time*2.7 + i)*.044,z,time*.7,1.12));
          }
        }
        for (const {u, x} of units) {
          for (let i = 0; i < (u.cargo || 0); i++) {
            this.draw('fuse', pose(x + (i - (u.cargo - 1) / 2)*.24, UNIT[u.cardId].label+.12, u.z, 0,.76));
          }
        }
      }
      if (s.mode === 'freight') {
        s.objective.carts.forEach((cart, lane) => {
          const z = B.freightRailZ(lane), x = M.lerp(cart.prevX, cart.x, alpha);
          this.draw('freight-track', pose(0,.53,z));
          this.draw('freight-cart', pose(x,.66,z));
        });
      }
      s.coils.fields.forEach((field, team) => {
        if (field) this.draw('coil', pose(Coils.SOCKETS[field.socket],.24,B.LANES[field.lane]), 0, this.teamTint[team]);
      });
    }
    coilLights(s, preview) {
      if (this.previewSocket !== null && s.phase === 'playing') {
        for (const z of B.LANES) for (const x of Coils.SOCKETS) {
          this.spot([x,.263,z], .40,.38,LILAC,.67,1,true);
        }
        if (preview) this.spot([Coils.SOCKETS[this.previewSocket],.27,B.LANES[this.hover]],Coils.REACH/.94,1.02,LILAC,.94,4,true);
      }
      s.coils.fields.forEach((field, team) => {
        if (!field) return;
        const x = Coils.SOCKETS[field.socket], z = B.LANES[field.lane], tint = this.teamTint[team];
        const ready = s.age + 1e-8 >= field.armAt;
        this.spot([x,.264,z],Coils.REACH/.94,1.02,tint,ready ? .92 : .38,4,true);
        const scan = this.reduced || !ready ? 0 : Math.sin((s.age - field.armAt) * 4) * Coils.REACH;
        this.spot([x + scan,.27,z],.07,.91,tint,ready ? .78 : .32,4,true);
      });
    }
    tacticalLights(s, units, cachePos, preview, alpha) {
      const cache = s.cache;
      this.coilLights(s, preview);
      if (s.mode === 'freight') {
        s.objective.carts.forEach((cart, lane) => {
          const x = M.lerp(cart.prevX,cart.x,alpha), z = B.freightRailZ(lane);
          const push = cart.escorts[0] - cart.escorts[1];
          const tint = push === 0 ? GOLD : this.teamTint[push > 0 ? 0 : 1];
          this.spot([x,.672,z],.92,.48,tint,.70,4,true);
          if (push) this.spot([x + Math.sign(push)*.49,1.02,z],.23,.20,tint,.74,2);
        });
      } else if (s.mode === 'salvage') {
        const until = s.objective.nextBankAt === null ? 0 : s.objective.nextBankAt - s.age;
        const charge = 1 - M.clamp(until / R.salvage.INTERVAL, 0, 1);
        this.spot([0,1.30,0],.31+charge*.31,.40+charge*.38,GOLD,.42+charge*.45,2);
        for (const pile of s.objective.piles) {
          this.spot([pile.x,.248,B.LANES[pile.lane]],R.salvage.REACH/.94,1.02,GOLD,.66,4,true);
        }
      } else if (s.mode === 'escort') {
        this.spot([Drills.GATE_X,.26,B.LANES[0]], .51,1.04,MINT,.9,4,true);
        const courier = units.find(({u}) => u.id === s.objective.carrierId);
        if (courier) this.spot([courier.x,.24,courier.u.z], .88,.72,MINT,.86,1,true);
      } else if (s.mode === 'watch') {
        const relay = Drills.subject(s);
        this.spot([relay.x,.285,relay.z],1.62,1.43,MINT,.88,4,true);
      }
      if (cachePos) {
        const open = cache.phase === 'open';
        const tint = cache.holder === null ? GOLD : this.teamTint[cache.holder];
        this.spot([cachePos[0], cachePos[1] + .24, cachePos[2]], .68, .71, GOLD, open ? .40 : .19);
        this.spot([0, .252, B.LANES[cache.lane]], Signal.REACH / .94, 1.02, tint, open ? .95 : .27, 4, true);
        if (cache.held > 0) {
          const size = .42 + .48 * cache.held / Signal.HOLD;
          this.spot([0, .258, B.LANES[cache.lane]], size, size, tint, .77, 1, true);
        }
      }
      for (const tower of s.towers) if (tower.hp > 0 && B.isGuarded(s, tower.team, tower.lane)) {
        this.spot([tower.x, 1.48, tower.z], 1.72, 1.56, this.teamTint[tower.team], .77, 3);
      }
      for (const {u, x} of units) {
        if (R.projectiles.ready(u, s.age)) this.spot([x,.34,u.z],UNIT.skiff.screenRange,1.02,GOLD,.45,1,true);
        if (B.isGuarded(s, u.team, u.lane)) this.spot([x, .88, u.z], 1.03, .91, this.teamTint[u.team], .75, 3);
        if (Coils.isSnared(u,s.age)) this.spot([x,.31,u.z],.65,.59,LILAC,.93,1,true);
      }
    }
    project(x,y,z) {const p=M.transformPoint(this.camera.vp,[x,y,z]);return [(p[0]+1)*.5,(1-p[1])*.5];}
    siteAt(nx,ny) {return this.camera ? A.pickSite(M.groundPoint(this.camera.inverse,nx,ny,.16)) : null;}
    laneAt(nx,ny) {return this.siteAt(nx,ny)?.lane ?? null;}
    render(s,t,alpha,delta,pointer=null) {
      const gl=this.gl;this.sampleFrame(delta);this.resize();
      const ease=this.reduced?1:1-Math.exp(-delta*5.4);
      this.view=M.lerp(this.view,this.targetView,ease);
      this.drift=M.lerp(this.drift,this.reduced?0:this.pointer*.024+Math.sin(t*.21)*.005,ease);
      this.camera=A.camera(this.width,this.height,this.view,this.drift);
      if (pointer) {
        const site = this.siteAt(...pointer);
        this.hover = site?.lane ?? null;
        if (site && this.previewSocket !== null) this.previewSocket = site.socket;
      }
      const forward=M.normalize(M.sub([0,.47,0],this.camera.eye));
      this.right=M.normalize(M.cross(forward,UP));this.up=M.cross(this.right,forward);
      this.bindTarget(this.targets[0]);gl.depthMask(true);gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);
      gl.clearColor(.13,.09,.20,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      this.quadFor(this.sky);gl.drawArrays(gl.TRIANGLES,0,6);
      gl.enable(gl.DEPTH_TEST);gl.enable(gl.CULL_FACE);
      this.beginMeshes(this.camera,1);this.draw('city');
      gl.uniform1f(this.meshProg.uMode,0);this.draw('board');
      const units=s.units.map(u=>({u,x:M.lerp(u.prevX,u.x,alpha)}));
      this.sprites(false);
      for (const obj of s.towers) this.spot([obj.x,.275,obj.z],1.50,1.38,[.055,.042,.099],.68,0,true);
      for (const {u,x} of units) this.spot([x,.222,u.z],.81,.51,[.045,.039,.072],.8,0,true);
      this.endSprites();
      this.beginMeshes(this.camera);
      const cachePos = s.cache.phase === 'incoming' || s.cache.phase === 'open' ? A.cachePosition(s.cache, s.age) : null;
      if (cachePos) this.draw('cache', pose(cachePos[0], cachePos[1], cachePos[2], t * .86, .92));
      if (s.mode === 'escort') this.draw('gate', pose(Drills.GATE_X, .20, B.LANES[0]));
      const coilPreview = this.previewSocket !== null && this.hover != null && !Coils.canPlace(s,0,this.hover,this.previewSocket);
      this.fieldEquipment(s, alpha, units, t);
      for (const obj of s.towers) {
        this.draw(obj.hp>0?'tower'+obj.team:'ruin',pose(obj.x,.265,obj.z),obj.hit);
        if (obj.hp>0) this.draw('crystal'+obj.team,pose(obj.x,1.46+Math.sin(t*1.65+obj.id)*.050,obj.z,t*.51+obj.id,1+obj.fire*.06),obj.hit*.46);
      }
      for (const {u,x} of units) {
        const spec=UNIT[u.cardId], phase=u.walk*8+u.id*.87;
        const bob=spec.hover?Math.sin(t*3+u.id)*.047+.15:u.moving?Math.abs(Math.sin(phase))*.038:Math.sin(t*2+u.id)*.013;
        const yaw=!u.moving && u.aim!==undefined?-u.aim:(u.team?Math.PI:0);
        const motion=u.fire*(spec.range>2 || spec.repair ? -.13 : .18);
        this.draw(u.cardId+u.team,pose(x+Math.cos(yaw)*motion,.202+bob,u.z-Math.sin(yaw)*motion,yaw,spec.scale,-u.fire*.066),u.hit);
      }
      const shots = s.shots.map(p => {
        const progress = Math.max(0, p.age - (1-alpha)*B.STEP) / p.duration;
        return {p, progress, pos:B.shotPoint(p,progress)};
      });
      for (const {p, progress, pos} of shots) {
        const tail=B.shotPoint(p,Math.max(0,progress-.20));
        if (progress>0) this.draw('beam',beamPose(tail,pos,p.type==='shell'?.105:.057),0,this.teamTint[p.team]);
      }
      for (const e of s.effects) {
        if (e.kind === 'mend' || e.kind === 'intercept' || e.kind === 'transmit') {
          const width = .042 * (1 - e.age / e.life);
          const tint = e.kind === 'mend' ? MINT : e.kind === 'intercept' ? GOLD : this.teamTint[e.team];
          this.draw('beam', beamPose([e.x,e.y,e.z], [e.tx,e.ty,e.tz], width), 0, tint);
          continue;
        }
        if (e.kind!=='wreck' && e.kind!=='blast' && e.kind!=='strike') continue;
        const part=e.age/e.life, count=e.kind==='strike'?4:7;
        for (let k=0;k<count;k++) {
          const ang=k*2.399+e.id, spread=(e.kind==='strike'?.6:1.25)*part;
          const x=e.x+Math.cos(ang)*spread, z=e.z+Math.sin(ang)*spread;
          this.draw('shard',pose(x,e.y+Math.sin(part*Math.PI)*(.38+(k%3)*.24),z,ang+t*4,.17*(1-part)+.02,ang),0,this.teamTint[e.team]);
        }
      }
      const sites = this.previewCard && this.hover != null ? B.deploymentSites(s, 0, this.hover, this.previewCard) : [];
      if (sites.length || coilPreview) this.placementGhosts(sites, coilPreview);
      this.sprites(true);
      for (const {x, offset} of sites) {
        this.spot([x,.236,B.LANES[this.hover] + offset],.76,.50,this.teamTint[0],.87,4,true);
      }
      this.tacticalLights(s, units, cachePos, coilPreview, alpha);
      for (const obj of s.towers) if (obj.hp>0) {
        const tint=this.teamTint[obj.team];
        this.spot([obj.x,2.11,obj.z],.89,.94,tint,.17+obj.fire*.42);
        this.spot([obj.x,.282,obj.z],1.57,1.46,tint,.12,1,true);
      }
      for (const {p, pos} of shots) {
        this.spot(pos,.34,.34,this.teamTint[p.team],.81,2);
      }
      for (const e of s.effects) {
        const part=e.age/e.life, tint=this.teamTint[e.team], deploy=e.kind==='deploy';
        if (e.kind === 'mend' || e.kind === 'intercept' || e.kind === 'transmit') {
          const color = e.kind === 'mend' ? MINT : GOLD;
          this.spot([e.tx,e.ty,e.tz], .22 + part * .28,.22 + part * .28,color,1-part,1);
          continue;
        }
        if (e.kind === 'uplink') {
          this.spot([e.x,e.y,e.z],.48 + part*2.6,.25 + part*.72,tint,.86*(1-part),1);
          continue;
        }
        if (e.kind === 'snare') {
          this.spot([e.x,.28,e.z],Coils.REACH*(.4+part),1.15,LILAC,1-part,4,true);
          this.spot([e.x,.44,e.z],.95,1.27,LILAC,.85*(1-part),2);
          continue;
        }
        if (e.kind === 'guard' || e.kind === 'cache' || e.kind === 'delivery') {
          const size = .60 + part * 1.48;
          this.spot([e.x, e.kind === 'delivery' ? e.y : .29, e.z], size, size, tint, (1-part)*.85, 1, true);
          continue;
        }
        const r=deploy?.4+part*.95:e.kind==='wreck'?.46+part*1.05:.22+part*.50;
        this.spot([e.x,deploy?.23:e.y,e.z],r,r,tint,(1-part)*.91,deploy?1:2,deploy);
      }
      if (!this.reduced) {
        for (let i=0;i<14;i++) {
          const x=((i*5.91+t*(.10+(i%3)*.05))%23)-11.5,z=((i*3.67)%11)-5.5;
          const y=.70+((i*.91+t*.11)%3.25), pulse=.16+.25*(1+Math.sin(t*1.5+i));
          this.spot([x,y,z],.030,.049,[.84,.69,.98],pulse);
        }
      }
      this.endSprites();this.post();
    }
  }
  R.Renderer=Renderer;
})(globalThis.Rift);
