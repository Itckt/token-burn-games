(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./math.js'), require('./mesh.js'), require('./simulation.js'), require('./weather.js'), require('./moon-pool.js'));
  else root.Atlas.render = factory(root.Atlas.math, root.Atlas.mesh, root.Atlas.sim, root.Atlas.weather, root.Atlas.moonPool);
})(globalThis, function (M, G, S, W, moonPool) {
  'use strict';
  const sun=M.normalize([-.62,.93,.51]);
  const skyFields = [['aPoint',2,0]];
  const worldFields = [['aPosition',3,0],['aNormal',3,3],['aColor',3,6],['aMaterial',1,9]];
  const labelFields = [['aPosition',3,0],['aUV',2,3]];
  const rainFields = [['aSeed',3,0],['aCorner',2,3]];
  const screenVert=`
    attribute vec2 aPoint;
    varying vec2 vScreen;
    void main(){vScreen=aPoint;gl_Position=vec4(aPoint,.99999,1.);}
  `;
  const skyFrag=`
    precision highp float;
    varying vec2 vScreen;
    uniform vec3 uForward,uRight,uUp,uSun;
    uniform vec2 uLens;
    uniform float uNight,uWet;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    void main(){
      vec3 ray=normalize(uForward+uRight*vScreen.x*uLens.x+uUp*vScreen.y*uLens.y);
      float h=pow(max(0.,ray.y),.58);
      vec3 day=mix(vec3(.865,.902,.825),vec3(.36,.665,.79),clamp(h*1.22,0.,1.));
      float sd=distance(ray,uSun);
      day+=vec3(.14,.095,.035)*exp(-sd*5.4);
      day=mix(day,vec3(1.,.96,.78),1.-smoothstep(.031,.034,sd));
      float cloud=0.;
      if(uWet>0.) {
        vec2 p=ray.xz/(.36+max(ray.y,0.));
        cloud=.5+.24*sin(3.4*p.x+1.3*p.y)+.16*sin(5.1*p.y-p.x)+.09*cos(7.2*p.x+p.y);
        vec3 ceiling=mix(vec3(.49,.59,.63),vec3(.69,.75,.74),cloud);
        day=mix(day,mix(vec3(.72,.78,.76),ceiling,smoothstep(0.,.38,ray.y)),uWet*.97);
      }
      if(uNight<=0.) {gl_FragColor=vec4(day,1.);return;}
      vec3 night=mix(vec3(.246,.315,.390),vec3(.049,.091,.173),clamp(h*1.37,0.,1.));
      vec2 sphere=vec2(atan(ray.x,-ray.z)/6.2831853,asin(clamp(ray.y,-1.,1.))/3.141593)*vec2(455.,228.);
      vec2 cell=floor(sphere),p=fract(sphere)-vec2(.15+.7*hash(cell+5.1),.15+.7*hash(cell+13.7));
      float star=step(.957,hash(cell))*(1.-smoothstep(.022,.135,length(p)))*smoothstep(.04,.32,ray.y);
      night+=star*vec3(.77,.80,.74);
      vec3 moonDir=normalize(vec3(.35,.46,-.85));
      float md=distance(ray,moonDir),cut=distance(ray,normalize(moonDir+vec3(.014,.005,0.)));
      night+=vec3(.075,.095,.13)*exp(-md*12.);
      night=mix(night,vec3(1.,.942,.73),(1.-smoothstep(.031,.033,md))*smoothstep(.029,.031,cut));
      night=mix(night,mix(vec3(.14,.20,.263),vec3(.085,.135,.188),h)+cloud*.028,uWet*.97);
      gl_FragColor=vec4(mix(day,night,uNight),1.);
    }
  `;
  const worldVert=`
    attribute vec3 aPosition,aNormal,aColor;
    attribute float aMaterial;
    uniform mat4 uVP,uLightVP;
    varying vec3 vPosition,vNormal,vColor,vShadow;
    varying float vMaterial;
    void main(){
      vPosition=aPosition;vNormal=aNormal;vColor=aColor;vMaterial=aMaterial;
      vShadow=(uLightVP*vec4(aPosition,1.)).xyz*.5+.5;
      gl_Position=uVP*vec4(aPosition,1.);
    }
  `;
  function roofSource(roofs) {
    if (!roofs.length) return 'float roofHeight(vec2 p) { return 0.; }';
    // The roofs never move. Bake their extents into both shaders so a shower
    // needs no extra fragment-uniform arrays on devices with small limits.
    const checks = roofs.map(r => {
      const bounds = [r.x-r.w/2,r.z-r.d/2,r.x+r.w/2,r.z+r.d/2].map(n=>n.toFixed(5));
      return 'if (insideRoof(p,vec4('+bounds.join(',')+'))) h=max(h,'+r.height.toFixed(5)+');';
    });
    return `
      bool insideRoof(vec2 p,vec4 r) {
        return all(greaterThanEqual(p,r.xy)) && all(lessThanEqual(p,r.zw));
      }
      float roofHeight(vec2 p) {
        float h=0.;
        ${checks.join('\n        ')}
        return h;
      }`;
  }
  function worldFrag(derivatives, roofs = []) {
    return (derivatives?'#extension GL_OES_standard_derivatives : enable\n':'')+`
    precision highp float;
    varying vec3 vPosition,vNormal,vColor,vShadow;
    varying float vMaterial;
    uniform vec3 uEye,uSun;
    uniform float uNight,uHasShadow,uTexel,uWet,uRainPhase;
    uniform sampler2D uShadow;
    uniform vec2 uLamps[12];
    ${roofSource(roofs)}
    float hash(vec2 p){return fract(sin(dot(p,vec2(41.7,289.1)))*4258.343);}
    vec3 waterColor(vec3 base, float shadow) {
      vec2 p=vPosition.xz;
      vec2 slope=.014*vec2(sin(p.y*5.+p.x),cos(3.4*p.x+.6*p.y));
      vec2 tile=p*1.8, cell=floor(tile);
      vec2 ripple=fract(tile)-(.28+.44*vec2(hash(cell),hash(cell+3.2)));
      float radius=length(ripple);
      float age=fract(uRainPhase+hash(cell+7.1));
      float crest=(1.-smoothstep(.012,.067,abs(radius-.52*age)))*(1.-age)*uWet;
      slope+=crest*.18*ripple/max(radius,.001);
      vec3 incident=normalize(vPosition-uEye);
      vec3 ray=reflect(incident,normalize(vec3(slope.x,1.,slope.y)));
      vec3 sky=mix(vec3(.69,.84,.80),vec3(.31,.58,.70),smoothstep(0.,.8,ray.y));
      sky=mix(sky,vec3(.64,.72,.72),.84*uWet);
      sky=mix(sky,vec3(.18,.28,.35),uNight);
      // Intersect the reflected ray with the actual gate plane. The reflected
      // arc stays anchored to the stone as the visitor walks along either bank.
      if(abs(ray.x)>.001) {
        float t=(${moonPool.gate.x.toFixed(2)}-vPosition.x)/ray.x;
        vec2 hit=vPosition.zy+t*ray.zy-vec2(${moonPool.gate.z.toFixed(2)},${moonPool.gate.y.toFixed(2)});
        float r=length(hit);
        float ring=smoothstep(${moonPool.gate.inner.toFixed(2)}-.04,${moonPool.gate.inner.toFixed(2)}+.04,r)*
          (1.-smoothstep(${moonPool.gate.outer.toFixed(2)}-.04,${moonPool.gate.outer.toFixed(2)}+.04,r));
        vec3 clay=mix(vec3(.72,.47,.32),vec3(.38,.61,.54),step(.994,hit.y/max(r,.001)));
        if(t>0.) sky=mix(sky,clay*mix(1.,.38,uNight),ring);
      }
      float fresnel=.24+.66*pow(1.-clamp(-incident.y,0.,1.),2.);
      vec3 bed=base*(.72+.19*shadow)*mix(1.,.31,uNight);
      return mix(bed,sky,fresnel)+crest*.14*mix(1.,.55,uNight);
    }
    float depthAt(vec2 off) {
      vec4 raw=texture2D(uShadow,vShadow.xy+off*uTexel);
      return dot(raw.rgb,vec3(1.,1./255.,1./65025.));
    }
    float shade(float diffuse) {
      if(uHasShadow<.5 || min(vShadow.x,vShadow.y)<.003 || max(vShadow.x,vShadow.y)>.997 || vShadow.z>1.) return 1.;
      float ref=vShadow.z-(.00032+.00054*(1.-diffuse));
      return .25*(step(ref,depthAt(vec2(-.72,-.61)))+step(ref,depthAt(vec2(.67,-.77)))+
        step(ref,depthAt(vec2(-.62,.74)))+step(ref,depthAt(vec2(.76,.66))));
    }
    vec3 masonry(vec3 base,vec2 uv,vec2 size,float joint,float strength,float distanceToEye) {
      vec2 p=uv/size;
      p.x+=mod(floor(p.y),2.)*.5;
      vec2 edge=(.5-abs(fract(p)-.5))*size;
      float aa=${derivatives?'max(.004, min(.09, max(fwidth(uv.x),fwidth(uv.y))*.70))':'max(.005,distanceToEye*.0009)'};
      float seam=1.-smoothstep(joint-aa,joint+aa,min(edge.x,edge.y));
      float visible=1.-smoothstep(13.,72.,distanceToEye);
      float grain=(hash(floor(p))-.5)*strength;
      return base*(1.+visible*(grain-seam*strength*1.25));
    }
    void main(){
      vec3 n=normalize(vNormal),base=vColor;
      float d=distance(uEye,vPosition),mat=vMaterial,diff=max(0.,dot(n,uSun));
      if(mat>.5 && mat<1.5) base=masonry(base,vPosition.xz,vec2(1.60,.91),.016,.098,d);
      if(mat>1.5 && mat<2.5) {
        vec2 uv=abs(n.y)>.8?vPosition.xz:vec2(abs(n.x)>.6?vPosition.z:vPosition.x,vPosition.y);
        base=masonry(base,uv,vec2(.59,.253),.010,.090,d);
      }
      bool timber=mat>8.5 && mat<9.5;
      if(timber) {
        float grain=sin(56.*vPosition.x+.8*sin(2.8*vPosition.z)+.24*sin(5.1*vPosition.z));
        base*=1.+.028*grain*(1.-smoothstep(4.,18.,d));
      }
      float shadow=diff>.01 && uNight<1.?shade(diff):1.;
      vec3 day=base*(vec3(.702,.743,.765)*(.93+.07*max(n.y,0.))+vec3(.465,.408,.306)*diff*shadow);
      vec3 night=base*(vec3(.181,.259,.366)+vec3(.086,.112,.151)*max(0.,dot(n,normalize(vec3(.41,.76,-.32)))));
      if(mat>2.5 && mat<3.5) {
        float reflection=smoothstep(-.23,.47,normalize(vPosition-uEye).y);
        day=mix(day,vec3(.67,.78,.73),.10+reflection*.26);
        float lit=hash(floor(vColor.rg*997.+.5));
        night=mix(vec3(.09,.19,.23),mix(vec3(.83,.53,.29),vec3(1.,.82,.49),lit),smoothstep(.22,.50,lit)*.91);
      }
      if(mat>3.5 && mat<4.5) {day=base*.99;night=vec3(1.,.86,.51);}
      if(mat>5.5 && mat<6.5) {
        day=base*(.921+.084*diff);night=mix(vec3(.176,.226,.288),vec3(.25,.305,.367),diff);
      }
      if(mat>6.5 && mat<7.5) {
        day=base*(.91+.09*diff);night=base*vec3(.20,.28,.36);
      }
      float pool=0.;
      if(uNight>.002 && mat<2.5) {
        for(int i=0;i<12;i++) {
          vec2 delta=vPosition.xz-uLamps[i]; pool=max(pool,1.-smoothstep(.1,26.,dot(delta,delta)));
        }
        night+=base*vec3(.45,.257,.095)*pool*(1.-smoothstep(0.,5.,vPosition.y));
      }
      vec3 haze=mix(vec3(.82,.86,.77),vec3(.196,.26,.344),uNight);
      if(uWet>0.) {
        vec3 overcast=base*(vec3(.68,.73,.78)+.09*diff);
        day=mix(day,overcast,uWet*.89);
        if(mat>5.5 && mat<6.5) night=mix(night,vec3(.15,.21,.26),uWet*.8);
        if(((mat<2.5 && vPosition.y<.25) || timber) && n.y>.9 && roofHeight(vPosition.xz)==0.) {
          vec2 p=vPosition.xz;
          float film=uWet*(.62+.38*smoothstep(-.4,.65,sin(p.x*.82+p.y*.36)+.55*cos(p.y*1.2-p.x*.21)));
          float fresnel=pow(1.-clamp(normalize(uEye-vPosition).y,0.,1.),2.);
          day=mix(day,mix(day*.68,vec3(.66,.74,.76),.40*fresnel),film);
          night=mix(night,night*.68+fresnel*(vec3(.06,.09,.12)+pool*vec3(.39,.25,.10)),film);
        }
        haze=mix(haze,mix(vec3(.72,.78,.76),vec3(.165,.218,.27),uNight),uWet);
      }
      float fog=smoothstep(mix(36.,13.,uWet),mix(273.,150.,uWet),d)*mix(.63,.86,uWet);
      vec3 surface=mat>9.5?waterColor(base,shadow):mix(day,night,uNight);
      vec3 col=mix(surface,haze,fog);
      gl_FragColor=vec4(col,1.);
    }`;
  }
  const depthVert=`
    attribute vec3 aPosition; uniform mat4 uLightVP;
    void main(){gl_Position=uLightVP*vec4(aPosition,1.);}
  `;
  const depthFrag=`
    precision highp float;
    void main(){
      vec3 enc=fract(gl_FragCoord.z*vec3(1.,255.,65025.));
      enc-=enc.yzz*vec3(1./255.,1./255.,0.);
      gl_FragColor=vec4(enc,1.);
    }
  `;
  const labelVert=`
    attribute vec3 aPosition; attribute vec2 aUV; uniform mat4 uVP; varying mediump vec2 vUV;
    void main(){vUV=aUV;gl_Position=uVP*vec4(aPosition,1.);}
  `;
  const labelFrag=`
    precision mediump float;
    uniform sampler2D uAtlas; uniform float uNight; varying mediump vec2 vUV;
    void main(){vec4 c=texture2D(uAtlas,vUV);if(c.a<.065)discard;gl_FragColor=vec4(c.rgb*mix(1.,.72,uNight),c.a);}
  `;
  function rainVert(roofs = []) {
    return `
      attribute vec3 aSeed;
      attribute vec2 aCorner;
      uniform mat4 uVP;
      uniform vec3 uEye,uRight;
      uniform float uTime;
      varying mediump float vOpacity;
      ${roofSource(roofs)}
      void main(){
        float y=mod(aSeed.y-uTime*${(W.HEIGHT/W.PERIOD).toFixed(2)},${W.HEIGHT.toFixed(1)});
        vec2 wind=vec2(-.16,.055);
        float span=${W.SPAN.toFixed(1)};
        vec2 offset=mod(aSeed.xz+wind*y-uEye.xz+span*.5,span)-span*.5;
        vec2 xz=uEye.xz+offset;
        vec3 base=vec3(xz.x,y,xz.y);
        float floorY=roofHeight(xz);
        vOpacity=smoothstep(floorY,floorY+.28,y)*(1.-smoothstep(9.,span*.5,length(offset)))*
          (1.-smoothstep(12.,15.,y));
        vec3 streak=vec3(wind.x,1.,wind.y)*(.22+.10*fract(aSeed.x));
        gl_Position=uVP*vec4(base+aCorner.y*streak+aCorner.x*.019*uRight,1.);
      }`;
  }
  const rainFrag=`
    precision mediump float;
    uniform float uWet,uNight;
    varying mediump float vOpacity;
    void main(){
      gl_FragColor=vec4(mix(vec3(.83,.90,.91),vec3(.63,.74,.82),uNight),uWet*vOpacity*.55);
    }`;
  function program(gl,vs,fs,attributes,uniforms) {
    const p=gl.createProgram();
    if (!p) throw Error('Could not allocate a shader program');
    try {
      for(const [type,source] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]) {
        const shader=gl.createShader(type);
        if (!shader) throw Error('Could not allocate a shader');
        try {
          gl.shaderSource(shader,source); gl.compileShader(shader);
          if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
          gl.attachShader(p,shader);
        } finally { gl.deleteShader(shader); }
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
      const attrib={},uni={};
      for(const key of attributes) attrib[key]=gl.getAttribLocation(p,key);
      for(const key of uniforms) uni[key]=gl.getUniformLocation(p,key);
      return {p,attrib,uni};
    } catch (error) {
      gl.deleteProgram(p);
      throw error;
    }
  }
  function buffer(gl,values) {
    const b=gl.createBuffer();
    if (!b) throw Error('Could not allocate a vertex buffer');
    try {
      gl.bindBuffer(gl.ARRAY_BUFFER,b);
      gl.bufferData(gl.ARRAY_BUFFER,values,gl.STATIC_DRAW);
      return b;
    } catch (error) { gl.deleteBuffer(b); throw error; }
  }
  function makeLabels(gl,signs,doc) {
    const sheet=doc.createElement('canvas');
    const rows=2**Math.ceil(Math.log2(Math.max(1,signs.length)));
    const size=2**Math.floor(Math.log2(Math.min(1024,gl.getParameter(gl.MAX_TEXTURE_SIZE))));
    const row=Math.min(128,Math.floor(size/rows));
    sheet.width=size; sheet.height=rows*row;
    const ctx=sheet.getContext('2d'),verts=[];
    signs.forEach((s,i)=>{
      const width=Math.min(size-2,Math.round(row*s.width/s.height)),yy=i*row,lines=s.words.split('|');
      ctx.textAlign='center'; ctx.textBaseline='middle';
      if(s.style==='poster') {ctx.fillStyle='#f1e4bd';ctx.fillRect(0,yy,width,row);ctx.fillStyle='#466558';}
      else ctx.fillStyle='#fff3d4';
      const lineH=row/(lines.length+.15);
      lines.forEach((line,j)=>{
        ctx.font='600 '+Math.floor(lineH*.80)+'px "Segoe UI", sans-serif';
        ctx.fillText(line,width/2,yy+(j+.5)*lineH+.075*lineH,width*.955);
      });
      function corner(x,y,u,v) {
        return [s.center[0]+s.right[0]*x*s.width,s.center[1]+y*s.height,s.center[2]+s.right[2]*x*s.width,u*width/sheet.width,(yy+v*row)/sheet.height];
      }
      const a=corner(-.5,-.5,0,1),b=corner(.5,-.5,1,1),c=corner(.5,.5,1,0),d=corner(-.5,.5,0,0);
      verts.push(...a,...b,...c,...a,...c,...d);
    });
    const texture=gl.createTexture();
    if (!texture) throw Error('Could not allocate the sign texture');
    try {
      gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,sheet);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR); gl.generateMipmap(gl.TEXTURE_2D);
      return {texture,buffer:buffer(gl,new Float32Array(verts)),count:verts.length/5};
    } catch (error) { gl.deleteTexture(texture); throw error; }
  }
  class Renderer {
    constructor(canvas,world,gl) {
      this.gl=gl; this.canvas=canvas; this.world=world;
      this.quality=1; this.frameSeconds=0; this.samples=0; this.projection=null;
      this.shelters=world.shelters || [];
      this.enabled=[];
      try { this.initialize(); }
      catch (error) { this.dispose(); throw error; }
    }
    initialize() {
      const {gl,world,canvas}=this;
      this.scene=program(gl,worldVert,worldFrag(!!gl.getExtension('OES_standard_derivatives'),this.shelters),
        ['aPosition','aNormal','aColor','aMaterial'],['uVP','uLightVP','uEye','uSun','uNight','uWet','uRainPhase','uShadow','uTexel','uHasShadow','uLamps[0]']);
      this.sky=program(gl,screenVert,skyFrag,['aPoint'],['uForward','uRight','uUp','uSun','uLens','uNight','uWet']);
      this.depth=program(gl,depthVert,depthFrag,['aPosition'],['uLightVP']);
      this.lettering=program(gl,labelVert,labelFrag,['aPosition','aUV'],['uVP','uAtlas','uNight']);
      this.vertices=buffer(gl,world.vertices);
      this.screen=buffer(gl,new Float32Array([-1,-1,3,-1,-1,3]));
      this.labels=makeLabels(gl,world.signs,canvas.ownerDocument);
      const lightEye=M.add([0,3,0],M.scale(sun,120));
      this.lightVP=M.multiply(M.orthographic(-69,69,-68,68,1,244),M.lookAt(lightEye,[0,3,0]));
      this.bakeShadow();
      gl.useProgram(this.scene.p);
      gl.uniformMatrix4fv(this.scene.uni.uLightVP,false,this.lightVP);
      gl.uniform3fv(this.scene.uni.uSun,sun);
      gl.uniform1f(this.scene.uni.uTexel,1/this.shadowSize);
      gl.uniform1f(this.scene.uni.uHasShadow,this.shadowOK?1:0);
      gl.uniform1i(this.scene.uni.uShadow,0);
      gl.uniform2fv(this.scene.uni['uLamps[0]'],new Float32Array(world.lamps.flat()));
      gl.useProgram(this.sky.p);gl.uniform3fv(this.sky.uni.uSun,sun);
    }
    dispose() {
      const gl=this.gl;
      if (gl.isContextLost()) return;
      for (const idx of this.enabled) gl.disableVertexAttribArray(idx);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.useProgram(null);
      for (const shader of [this.scene,this.sky,this.depth,this.lettering,this.rain]) {
        if (shader) gl.deleteProgram(shader.p);
      }
      for (const mesh of [this.vertices,this.screen,this.labels?.buffer,this.rainBuffer]) {
        if (mesh) gl.deleteBuffer(mesh);
      }
      for (const texture of [this.shadow,this.labels?.texture]) {
        if (texture) gl.deleteTexture(texture);
      }
    }
    drawRain(s, vp, eye, right) {
      const gl=this.gl, roofs=this.shelters;
      if (!this.rain) {
        this.rain=program(gl,rainVert(roofs),rainFrag,['aSeed','aCorner'],
          ['uVP','uEye','uRight','uTime','uNight','uWet']);
        this.rainBuffer=buffer(gl,W.makeRainMesh());
      }
      this.bind(this.rain,this.rainBuffer,5,rainFields);
      const u=this.rain.uni;
      gl.uniformMatrix4fv(u.uVP,false,vp);
      gl.uniform3fv(u.uEye,eye); gl.uniform3fv(u.uRight,right);
      gl.uniform1f(u.uTime,s.weather.time); gl.uniform1f(u.uWet,s.weather.wet); gl.uniform1f(u.uNight,s.light);
      gl.drawArrays(gl.TRIANGLES,0,W.DROPS*3);
    }
    bind(p,b,stride,fields) {
      const gl=this.gl;
      for(const idx of this.enabled) gl.disableVertexAttribArray(idx);
      this.enabled.length=0;
      gl.useProgram(p.p); gl.bindBuffer(gl.ARRAY_BUFFER,b);
      for(const [name,size,offset] of fields) {
        const loc=p.attrib[name]; if(loc<0) continue;
        gl.enableVertexAttribArray(loc); this.enabled.push(loc);
        gl.vertexAttribPointer(loc,size,gl.FLOAT,false,stride*4,offset*4);
      }
    }
    bakeShadow() {
      const gl=this.gl,size=this.shadowSize=Math.min(2048,gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
      this.shadow=gl.createTexture();
      if (!this.shadow) throw Error('Could not allocate the shadow texture');
      gl.bindTexture(gl.TEXTURE_2D,this.shadow);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      for(const param of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D,param,gl.NEAREST);
      for(const param of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D,param,gl.CLAMP_TO_EDGE);
      const fb=gl.createFramebuffer();
      let rb;
      try {
        rb=gl.createRenderbuffer();
        this.shadowOK=false;
        if (fb && rb) {
          gl.bindFramebuffer(gl.FRAMEBUFFER,fb); gl.bindRenderbuffer(gl.RENDERBUFFER,rb);
          gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,size,size);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,rb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.shadow,0);
          this.shadowOK=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
        }
        if(this.shadowOK) {
          gl.viewport(0,0,size,size); gl.clearColor(1,1,1,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
          gl.enable(gl.DEPTH_TEST); gl.disable(gl.DITHER);
          this.bind(this.depth,this.vertices,G.STRIDE,[['aPosition',3,0]]);
          gl.uniformMatrix4fv(this.depth.uni.uLightVP,false,this.lightVP);
          const start=this.world.casterStart;
          gl.drawArrays(gl.TRIANGLES,start,this.world.vertices.length/G.STRIDE-start);
        }
      } finally {
        if (this.shadowOK) gl.enable(gl.DITHER);
        gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.bindRenderbuffer(gl.RENDERBUFFER,null);
        if (fb) gl.deleteFramebuffer(fb);
        if (rb) gl.deleteRenderbuffer(rb);
      }
      if (!this.shadowOK) {
        // A complete one-pixel sampler keeps the daylight pass usable on a small GPU.
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
      }
    }
    measureFrame(seconds) {
      if (!Number.isFinite(seconds) || seconds<=0) return;
      this.frameSeconds+=Math.min(seconds,.12);
      if (++this.samples<8 || this.frameSeconds<.85) return;
      const mean=this.frameSeconds/this.samples;
      if (mean>.020) this.quality=Math.max(.65,this.quality*.86);
      else if (mean<.0175) this.quality=Math.min(1,this.quality+.04);
      this.frameSeconds=0; this.samples=0;
    }
    resize(zoom = 1) {
      const b=this.canvas, pixels=Math.max(1,b.clientWidth*b.clientHeight);
      const ratio=this.quality*Math.min(1.6,b.ownerDocument.defaultView.devicePixelRatio||1,Math.sqrt(2304000/pixels));
      const w=Math.max(1,Math.round(b.clientWidth*ratio)),h=Math.max(1,Math.round(b.clientHeight*ratio));
      const resized=!this.projection || b.width!==w || b.height!==h;
      if(!resized && zoom===this.zoom) return false;
      if(resized) {
        b.width=w; b.height=h; this.gl.viewport(0,0,w,h);
      }
      this.zoom=zoom;
      this.aspect=w/h;
      this.lensY=M.lensScale(zoom);
      this.projection=M.perspective(2*Math.atan(this.lensY),this.aspect,.09,465);
      return true;
    }
    draw(s, zoom = 1) {
      const gl=this.gl;
      const wet=s.weather?.wet || 0;
      this.resize(zoom);
      const eye=S.eyePosition(s,this.world),axes=M.basis(s.yaw,s.pitch);
      const vp=M.multiply(this.projection,M.lookAt(eye,M.add(eye,axes.forward)));
      gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
      this.bind(this.sky,this.screen,2,skyFields);
      const sky=this.sky.uni;
      gl.uniform3fv(sky.uForward,axes.forward);gl.uniform3fv(sky.uRight,axes.right);gl.uniform3fv(sky.uUp,axes.up);
      gl.uniform2f(sky.uLens,this.lensY*this.aspect,this.lensY);gl.uniform1f(sky.uNight,s.light);
      gl.uniform1f(sky.uWet,wet);
      gl.drawArrays(gl.TRIANGLES,0,3);
      gl.depthMask(true);gl.enable(gl.DEPTH_TEST);gl.clear(gl.DEPTH_BUFFER_BIT);
      this.bind(this.scene,this.vertices,G.STRIDE,worldFields);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.shadow);
      gl.uniformMatrix4fv(this.scene.uni.uVP,false,vp);
      gl.uniform3fv(this.scene.uni.uEye,eye);gl.uniform1f(this.scene.uni.uNight,s.light);
      gl.uniform1f(this.scene.uni.uWet,wet);
      gl.uniform1f(this.scene.uni.uRainPhase,(s.weather?.time || 0)/W.PERIOD);
      gl.drawArrays(gl.TRIANGLES,0,this.world.vertices.length/G.STRIDE);
      this.bind(this.lettering,this.labels.buffer,5,labelFields);
      gl.uniformMatrix4fv(this.lettering.uni.uVP,false,vp);gl.uniform1f(this.lettering.uni.uNight,s.light);
      gl.bindTexture(gl.TEXTURE_2D,this.labels.texture);gl.uniform1i(this.lettering.uni.uAtlas,0);
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLES,0,this.labels.count);
      if (s.weather?.drops) this.drawRain(s,vp,eye,axes.right);
      gl.depthMask(true);gl.disable(gl.BLEND);
    }
  }
  return {Renderer,shaders:{screenVert,skyFrag,worldVert,worldFrag,depthVert,depthFrag,labelVert,labelFrag,rainVert,rainFrag}};
});
