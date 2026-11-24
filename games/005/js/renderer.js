(function (root) {
  'use strict';
  const M=root.CupMath, G=root.CupMeshes, L=root.CupLesson, D=root.CupDesign;
  const liningSource=`
    uniform float uWallSlope;
    float liningRadius(float height) {
      return ${(G.RIM-G.WALL).toFixed(3)} + (height-${G.HEIGHT.toFixed(3)})*uWallSlope;
    }`;
  const vertexSource=`
    attribute vec3 aPosition, aNormal, aColor;
    attribute vec2 aUV;
    attribute vec3 aWetPosition, aWetNormal;
    uniform mat4 uVP, uModel;
    uniform mat3 uNormal;
    uniform int uMaterial;
    uniform float uTime, uSoft, uWater, uFlex, uTrace, uWaterBase, uRipple, uPadRise;
    uniform float uReshapeShell, uGuidedSeat;
    ${liningSource}
    varying vec3 vPosition, vNormal, vColor, vLocal;
    varying vec2 vUV;
    void main() {
      vec3 p=aPosition;
      vec3 n=aNormal;
      if (uReshapeShell>0.5) {
        float r=length(p.xz);
        if (r>0.0001) {
          vec2 radial=p.xz/r;
          float slopeChange=${G.wallSlope.toFixed(9)}-uWallSlope;
          float newR=r+(${G.HEIGHT.toFixed(3)}-p.y)*slopeChange;
          float radialNormal=dot(n.xz,radial);
          // Inverse-transpose of the radial displacement about the fixed rim.
          n.xz=radial*radialNormal+(n.xz-radial*radialNormal)*(r/newR);
          n.y+=slopeChange*radialNormal;
          p.xz=radial*newR;
        }
      }
      if (uMaterial==3) {
        if (uGuidedSeat>0.5) {
          float radius=length(p.xz), limit=liningRadius(p.y);
          if (radius>limit) {
            vec2 radial=p.xz/radius;
            p.xz=radial*limit;
            n=normalize(vec3(radial.x,-uWallSlope,radial.y));
          }
        }
        p=mix(p,aWetPosition,uSoft);
        n=mix(n,aWetNormal,uSoft);
      }
      if (uMaterial==4 || uMaterial==9) {
        float top=p.y;
        p.y=uMaterial==9 ? ${G.FLOOR.toFixed(3)}+top*uPadRise : uWaterBase+top*uWater;
        float radius=liningRadius(p.y);
        p.xz*=uMaterial==9 ? radius : radius-0.008;
        if (uMaterial==4) p.y+=(1.0-uTrace)*top*uRipple*0.010*smoothstep(0.0,0.12,uWater)*(sin(5.0*p.x+uTime*2.3)+cos(p.z*6.0-uTime*1.6));
      }
      if (uMaterial==6) {
        p.x+=0.035*sin(p.y*10.0+uTime*1.8+aPosition.z*9.0);
        p.z+=0.022*cos(p.y*7.0+uTime);
      }
      p.y+=uFlex*max(0.0,1.0-p.y/0.46)*(0.35+0.65*smoothstep(-0.72,0.55,p.x));
      vec4 world=uModel*vec4(p,1.0);
      vPosition=world.xyz; vLocal=p; vNormal=uNormal*n;
      vUV=aUV; vColor=aColor;
      gl_Position=uVP*world;
      if (uMaterial==8) gl_Position.z-=0.0001*gl_Position.w;
      if (uMaterial==9 && uPadRise==0.0) gl_Position.z-=0.00001*gl_Position.w;
    }`;
  const fragmentSource=`
    uniform vec3 uEye;
    uniform sampler2D uPaper;
    uniform int uMaterial;
    uniform float uTime, uSoft, uAlpha, uSeat, uSeatY, uUnderside, uTrace, uWater, uWaterBase, uScanY, uHighlight;
    uniform float uGapMap, uPackedY;
    ${liningSource}
    varying vec3 vPosition, vNormal, vColor, vLocal;
    varying vec2 vUV;
    void main() {
      if (uMaterial==8) {
        vec2 grid=abs(fract(vLocal.xz*5.0+0.5)-0.5);
        float lines=1.0-smoothstep(0.012,0.055,min(grid.x,grid.y));
        float rim=smoothstep(0.97,0.99,length(vLocal.xz));
        gl_FragColor=vec4(0.41,0.33,0.57,0.10+0.13*lines+0.53*rim);
        return;
      }
      if (uMaterial==5) {
        vec2 q=vLocal.xz;
        vec2 offset=q-vec2(0.28,-0.22);
        float soft=0.23*exp(-dot(offset,offset)*1.37);
        float contact=0.25*(1.0-smoothstep(0.64,1.03,length(q)));
        gl_FragColor=vec4(0.29,0.26,0.18,soft+contact);
        return;
      }
      vec3 n=normalize(vNormal), v=normalize(uEye-vPosition);
      vec3 light=normalize(vec3(-0.55,0.90,0.83));
      float direct=max(0.0,dot(n,light));
      float sky=n.y*0.5+0.5;
      float shine=pow(max(0.0,dot(n,normalize(light+v))),30.0);
      vec3 base=vColor;
      if (uMaterial==1) base=texture2D(uPaper,vUV).rgb;
      vec3 lighting=vec3(0.62,0.60,0.55)+vec3(0.22,0.23,0.26)*sky+vec3(0.28,0.27,0.26)*direct;
      vec3 color=base*lighting+0.025*shine;
      float opacity=uAlpha;
      vec2 grainCell=mod(floor(gl_FragCoord.xy),vec2(61.0));
      float grain=fract(sin(dot(grainCell,vec2(0.13,0.73)))*37.1);
      color+=(grain-0.5)*0.009;
      if (uMaterial==2) {
        float edge=length(vUV-0.5)*2.0;
        float grooves=smoothstep(0.83,0.88,edge)*sin(edge*248.0);
        if (base.g>0.6) {
          vec3 reflection=reflect(-v,n);
          float band=0.5+0.5*sin(reflection.z*4.9+reflection.x*3.3+vUV.x*0.8);
          color=mix(vec3(0.64,0.65,0.59),vec3(0.94,0.93,0.84),band);
          color+=0.028*grooves+0.014*sin(vUV.x*89.0+sin(vUV.y*29.0))+0.012*(grain-0.5);
        } else {
          color+=0.05*grooves;
          float stripe=step(0.86,fract(vUV.x*9.0+vUV.y*3.0));
          color=mix(color,vec3(0.97,0.78,0.52),0.35*stripe);
        }
      }
      if (uMaterial==3) {
        color=base*(0.45+0.28*sky+0.40*direct)+vec3(0.055,0.044,0.018)*shine;
        color+=uSoft*vec3(0.06,0.065,0.032)*(0.3+shine);
        if (uTrace>0.5) {
          float depth=uWaterBase+uWater-vPosition.y;
          float wet=step(0.002,uWater)*smoothstep(-0.008,0.008,depth);
          vec3 dye=mix(vec3(0.97,0.73,0.39),vec3(0.14,0.62,0.60),wet);
          color=dye*(0.53+0.21*sky+0.37*direct)+0.055*shine;
          color+=0.14*(1.0-smoothstep(0.006,0.024,abs(depth)))*wet;
        }
        if (uHighlight>0.5) {
          vec3 markColor=mix(vec3(0.78,0.20,0.22),vec3(1.0,0.79,0.50),0.30*step(0.86,fract(vUV.x*12.0)));
          color=markColor*(0.73+0.19*sky+0.32*direct)+0.06*shine;
        }
        if (uPackedY>=0.0 && vPosition.y<uPackedY) {
          // Keep the waterline dye visible between the plum hatch marks.
          float stripe=abs(fract(dot(vPosition,vec3(4.6,8.0,2.7)))-0.5);
          color=mix(color,vec3(0.28,0.13,0.23),0.82*(1.0-smoothstep(0.08,0.20,stripe)));
        }
        if (uGapMap>0.5) {
          float gapMM=(liningRadius(vPosition.y)-length(vPosition.xz))*${root.CupPacking.mmPerUnit.toFixed(6)};
          vec3 dye=gapMM<=${D.closeMM.toFixed(1)} ? vec3(0.70,0.26,0.15) :
            gapMM<=${D.nearMM.toFixed(1)} ? vec3(0.93,0.67,0.30) : vec3(0.30,0.48,0.46);
          color=dye*(0.72+0.20*sky+0.27*direct)+0.03*shine;
        }
      }
      if (uMaterial==9) {
        float rings=0.5+0.5*cos(length(vLocal.xz)*64.0);
        color=mix(vec3(0.70,0.33,0.19),vec3(0.95,0.67,0.39),0.34*rings+0.32*sky)*lighting;
      }
      if (uMaterial==4) {
        float fresnel=pow(clamp(1.0-abs(dot(n,v)),0.0,1.0),2.0);
        float ripple=sin(length(vLocal.xz-vec2(0.52,0.52))*34.0-uTime*4.0);
        color=mix(base,vec3(0.96,0.98,0.88),0.18+0.37*fresnel);
        color=mix(color,vec3(0.89,0.70,0.43),0.38*uSoft);
        color+=max(0.0,ripple)*0.045*sky;
        opacity*=1.0-0.52*uTrace;
      }
      if (uMaterial==6) {
        color=mix(vec3(0.79,0.84,0.77),vec3(1.0,0.99,0.91),vUV.x);
        opacity*=smoothstep(0.0,0.15,vUV.x)*(1.0-smoothstep(0.65,1.0,vUV.x));
      }
      if (uMaterial==7) {
        color*=1.0-0.25*exp(-3.9*abs(vLocal.y-uUnderside));
        float seatLine=1.0-smoothstep(0.012,0.026,abs(vLocal.y-uSeatY));
        color=mix(color,vec3(0.79,0.42,0.20),uSeat*seatLine);
        if (uPackedY>=0.0) {
          float datum=1.0-smoothstep(0.009,0.019,abs(vLocal.y-uPackedY));
          color=mix(color,vec3(0.40,0.23,0.33),datum*step(0.34,fract(vUV.x*40.0)));
        }
      }
      if (uScanY>=0.0 && (uMaterial==3 || uMaterial==7 || uMaterial==1)) {
        float band=1.0-smoothstep(0.006,0.022,abs(vPosition.y-uScanY));
        color=mix(color,vec3(0.40,0.27,0.58),0.90*band);
      }
      gl_FragColor=vec4(color,opacity);
    }`;

  function paintWrapper(c,w,h) {
    c.fillStyle='#f7e8c8'; c.fillRect(0,0,w,h);
    const red='#bf502e', pale='#fff1d2';
    c.fillStyle=red;
    c.fillRect(0,74,w,286); c.fillRect(0,65,w,4); c.fillRect(0,366,w,4);
    c.fillStyle='#d77649'; c.fillRect(0,80,w,3);
    // The printed bands wrap seamlessly because every wave spans a whole period.
    function wave(y,amplitude,periods,width,color,phase) {
      c.strokeStyle=color; c.lineWidth=width; c.beginPath();
      for(let x=0;x<=w;x+=2) {
        const py=y+amplitude*Math.sin(x/w*M.TAU*periods+phase);
        if(x===0)c.moveTo(x,py); else c.lineTo(x,py);
      }
      c.stroke();
    }
    for(let i=0;i<4;i++) wave(393+i*13,15,6,4.5,red,0.2+i*0.04);
    for(let i=0;i<5;i++) wave(273+i*14,10,7,2,'#e89660',i*0.17);
    c.fillStyle=red; c.fillRect(0,472,w,2); c.fillRect(0,479,w,4);
    function stamp(label,x,y,width,font,color) {
      c.save(); c.font=font; c.textBaseline='middle'; c.textAlign='center'; c.fillStyle=color;
      c.translate(x,y); c.scale(width/c.measureText(label).width,1); c.fillText(label,0,0); c.restore();
    }
    for(const angle of [-0.86,2.28]) {
      const x=(angle/M.TAU+0.5)*w;
      stamp('K O W L O O N   T O N G',x,45,246,'bold 13px Arial',red);
      stamp('CURL',x,147,330,'900 110px Arial',pale);
      stamp('CLUB',x,235,323,'900 110px Arial',pale);
      c.fillStyle=red; c.fillRect(x-127,295,254,27);
      stamp('I N S T A N T   N O O D L E S',x,309,238,'bold 14px Arial',pale);
      stamp('3v3  SUPPER  LEAGUE',x,457,246,'bold 14px Arial',red);
      const badge=x+435;
      c.strokeStyle=pale; c.lineWidth=4; c.beginPath(); c.arc(badge,213,58,0,M.TAU); c.stroke();
      for(let k=0;k<3;k++) {
        c.beginPath(); c.moveTo(badge-35,201+k*12);
        c.bezierCurveTo(badge-12,175+k*12,badge+12,227+k*12,badge+35,201+k*12); c.stroke();
      }
    }
    const rng=M.random(84);
    for(let i=0;i<16000;i++) {
      c.fillStyle=i%2 ? 'rgba(92,48,25,0.055)' : 'rgba(255,250,225,0.12)';
      c.fillRect(rng()*w,rng()*h,1+rng()*1.4,1);
    }
  }
  function wrapperTexture(gl) {
    const canvas=document.createElement('canvas');
    canvas.width=2048; canvas.height=512;
    const c=canvas.getContext('2d'), texture=gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    if(c) {
      paintWrapper(c,canvas.width,canvas.height);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
    } else {
      // A paper-and-ink stripe can be uploaded directly if Canvas 2D is unavailable.
      const paper=[247,232,200,255], ink=[191,80,46,255];
      const stripe=new Uint8Array([...paper,...ink,...paper,...paper,...ink,...ink,...ink,...paper]);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,8,0,gl.RGBA,gl.UNSIGNED_BYTE,stripe);
    }
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D);
    return texture;
  }
  function compile(gl,type,source) {
    const shader=gl.createShader(type);
    gl.shaderSource(shader,source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) {
      const error=gl.getShaderInfoLog(shader);
      gl.deleteShader(shader); throw new Error(error);
    }
    return shader;
  }
  const identity=M.identity();
  class Renderer {
    constructor(canvas, specimen) {
      this.canvas=canvas;
      const gl=canvas.getContext('webgl',{alpha:true,antialias:true,depth:true,powerPreference:'high-performance'});
      if(!gl) throw new Error('WebGL is unavailable');
      this.gl=gl;
      const precision=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);
      const floatPrecision=precision && precision.precision ? 'highp' : 'mediump';
      const header='precision '+floatPrecision+' float;\nprecision mediump int;\n';
      const program=gl.createProgram();
      const shaders=[];
      try {
        shaders.push(compile(gl,gl.VERTEX_SHADER,header+vertexSource));
        shaders.push(compile(gl,gl.FRAGMENT_SHADER,header+fragmentSource));
        for(const shader of shaders) gl.attachShader(program,shader);
        gl.linkProgram(program);
        if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
      } catch(error) {
        gl.deleteProgram(program);
        throw error;
      } finally {
        for(const shader of shaders) gl.deleteShader(shader);
      }
      gl.useProgram(program);
      this.attributes=['aPosition','aNormal','aColor','aUV'].map(n=>gl.getAttribLocation(program,n));
      this.poseAttributes=['aWetPosition','aWetNormal'].map(n=>gl.getAttribLocation(program,n));
      this.poseEnabled=false;
      this.uniform={};
      for(const n of ['VP','Model','Normal','Time','Soft','Water','WaterBase','Ripple','ScanY','Flex','Material','Eye','Paper','Alpha','Seat','SeatY','Underside','Trace','PadRise','Highlight','WallSlope','ReshapeShell','GuidedSeat','GapMap','PackedY']) {
        this.uniform[n]=gl.getUniformLocation(program,'u'+n);
      }
      this.buffers={};
      for(const [name,mesh] of Object.entries(G.buildModel(specimen?.mesh))) {
        if(name==='noodles') {
          this.anchor=G.strandAnchor(mesh,[0.58,1.53,0.88]);
          this.seatedAnchor=G.seatedPoint(this.anchor.dry);
          this.dryProfile=specimen?.profile ?? root.CupPacking.measure(mesh);
        }
        const v=gl.createBuffer(), i=gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER,v); gl.bufferData(gl.ARRAY_BUFFER,mesh.vertices,gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,i); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.indices,gl.STATIC_DRAW);
        let pose=null;
        if(mesh.hydrated) {
          pose=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,pose);
          gl.bufferData(gl.ARRAY_BUFFER,mesh.hydrated,gl.STATIC_DRAW);
        }
        this.buffers[name]={v,i,pose,count:mesh.indices.length};
      }
      this.paper=wrapperTexture(gl);
      gl.uniform1i(this.uniform.Paper,0);
      for(const at of this.attributes) gl.enableVertexAttribArray(at);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
      gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0,0,0,0);
    }
    draw(name,material=0,model=identity,alpha=1,strand) {
      const gl=this.gl, u=this.uniform, mesh=this.buffers[name];
      gl.uniform1i(u.Material,material); gl.uniform1f(u.Alpha,alpha);
      gl.uniformMatrix4fv(u.Model,false,model); gl.uniformMatrix3fv(u.Normal,false,M.normalMatrix(model));
      gl.bindBuffer(gl.ARRAY_BUFFER,mesh.v);
      for(let i=0;i<4;i++) gl.vertexAttribPointer(this.attributes[i],i===3?2:3,gl.FLOAT,false,G.STRIDE*4,i*12);
      if(mesh.pose) {
        gl.bindBuffer(gl.ARRAY_BUFFER,mesh.pose);
        this.poseAttributes.forEach((at,i)=>{
          if(!this.poseEnabled) gl.enableVertexAttribArray(at);
          gl.vertexAttribPointer(at,3,gl.FLOAT,false,24,i*12);
        });
      } else if(this.poseEnabled) {
        for(const at of this.poseAttributes) gl.disableVertexAttribArray(at);
      }
      this.poseEnabled=!!mesh.pose;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,mesh.i);
      if (!strand) gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_SHORT,0);
      else {
        // The tracked tube occupies one contiguous range in the existing index
        // buffer. Submit each triangle once and change the dye for that range.
        const first=strand.firstIndex, end=first+strand.indexCount;
        if (first>0) gl.drawElements(gl.TRIANGLES,first,gl.UNSIGNED_SHORT,0);
        gl.uniform1f(u.Highlight,1);
        gl.drawElements(gl.TRIANGLES,strand.indexCount,gl.UNSIGNED_SHORT,first*2);
        gl.uniform1f(u.Highlight,0);
        if (end<mesh.count) gl.drawElements(gl.TRIANGLES,mesh.count-end,gl.UNSIGNED_SHORT,end*2);
      }
    }
    render(view,scene,exterior,time,trace=false) {
      const gl=this.gl, u=this.uniform, canvas=this.canvas;
      const w=canvas.clientWidth, h=canvas.clientHeight;
      if(!w || !h) return false;
      const dpr=Math.min(root.devicePixelRatio || 1,1.8);
      const width=Math.round(w*dpr),height=Math.round(h*dpr);
      if(canvas.width!==width || canvas.height!==height) {canvas.width=width;canvas.height=height;}
      gl.viewport(0,0,width,height);
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      const aspect=w/h;
      const span=Math.max(4.86,3.85/aspect)/view.zoom;
      const target=[0,1.92,-0.18], distance=8;
      const eye=M.add(target,[distance*Math.sin(view.yaw)*Math.cos(view.pitch),
        distance*Math.sin(view.pitch),distance*Math.cos(view.yaw)*Math.cos(view.pitch)]);
      this.vp=M.multiply(M.ortho(-span*aspect/2,span*aspect/2,-span/2,span/2,0.1,20),M.lookAt(eye,target));
      this.width=w; this.height=h;
      const body=M.multiply(M.translation(0.052*scene.bump,0.022*Math.abs(scene.bump),0),M.rotateZ(0.032*scene.bump));
      const fit=scene.fit;
      this.guidedSeat=!fit;
      const block=fit
        ? M.multiply(M.translation(0,fit.offsetY+scene.lift,0),M.multiply(M.rotateY(fit.rotation),M.scale(fit.scale,fit.scale,fit.scale)))
        : M.multiply(body,M.translation(0,scene.lift,0));
      this.body=body; this.block=block;
      gl.uniformMatrix4fv(u.VP,false,this.vp); gl.uniform3fv(u.Eye,eye);
      gl.uniform1f(u.Time,time); gl.uniform1f(u.Soft,scene.soft); gl.uniform1f(u.Water,scene.water);
      gl.uniform1f(u.WaterBase,scene.meter ? G.FLOOR : L.poolBase);
      gl.uniform1f(u.Ripple,scene.meter ? 0 : 1);
      gl.uniform1f(u.PadRise,scene.press?.rise ?? 0);
      gl.uniform1f(u.Highlight,0);
      gl.uniform1f(u.ScanY,scene.scan?.height ?? -1);
      const taper=fit?.taper ?? 1;
      gl.uniform1f(u.WallSlope,G.wallSlope*taper);
      gl.uniform1f(u.GuidedSeat,Number(this.guidedSeat));
      gl.uniform1f(u.GapMap,Number(!!scene.contactMap));
      gl.uniform1f(u.PackedY,scene.gap?.packedY ?? -1);
      gl.uniform1f(u.ReshapeShell,0);
      gl.uniform1f(u.Seat,Number(fit ? !fit.onFloor && !scene.lift : scene.index===1));
      gl.uniform1f(u.SeatY,fit ? fit.contactY : this.dryProfile.contact[1]);
      gl.uniform1f(u.Underside,fit ? fit.bottom+scene.lift : scene.bottom);
      const tracing=trace && !fit && scene.index>=3;
      gl.uniform1f(u.Trace,Number(tracing));
      gl.uniform1f(u.Flex,0);
      gl.enable(gl.BLEND); gl.depthMask(false);
      const footprint=G.radiusAt(0,taper)/G.BASE;
      this.draw('shadow',5,taper===1 ? identity : M.scale(footprint,1,footprint));
      gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.CULL_FACE);
      gl.uniform1f(u.Flex,scene.baseFlex);
      gl.uniform1f(u.ReshapeShell,Number(taper!==1));
      this.draw('base',0,body); this.draw('shell',1,body); this.draw('lining',7,body);
      this.draw('lip',0,body);
      if(exterior) {
        this.draw('completeShell',1,body); this.draw('completeLining',7,body); this.draw('completeLip',0,body);
      } else this.draw('edges',0,body);
      gl.uniform1f(u.Flex,0); gl.uniform1f(u.ReshapeShell,0);
      if(scene.press) this.draw('water',9,body);
      this.draw('lid',2,body); this.draw('noodles',3,block,1,scene.tracked?.strand);
      if(scene.gap) gl.uniform1f(u.PackedY,-1);
      if(tracing) gl.uniform1f(u.Trace,0);
      if(!scene.scan && !scene.contactMap) this.draw('toppings',3,block);
      if(tracing) gl.uniform1f(u.Trace,1);
      gl.enable(gl.BLEND); gl.depthMask(false);
      if(L.hasPool(scene)) this.draw('water',4,body,0.52);
      if(scene.scan) {
        const {height,radius}=scene.scan;
        gl.disable(gl.CULL_FACE);
        this.draw('sheet',8,M.multiply(M.translation(0,height,0),M.scale(radius,1,radius)));
        gl.enable(gl.CULL_FACE);
      }
      if(scene.stream>0.004) {
        const foot=L.pourPosition(scene), source=L.pourPosition(scene,10.8);
        // A sheared vertical tube enters the frame from above and meets the food or pool.
        const model=M.multiply(M.translation(...foot),M.scale(scene.stream,source[1]-foot[1],scene.stream));
        model[4]=source[0]-foot[0];
        this.draw('stream',0,model,0.70*scene.stream);
      }
      if(scene.seep>0.004) {
        const model=M.multiply(M.translation(0,scene.surfaceY,0),M.scale(1,scene.bottom-scene.surfaceY,1));
        this.draw('seep',0,model,0.72*scene.seep);
      }
      if(scene.steam>0.01) {
        const sourceY=Math.max(scene.surfaceY,G.BLOCK_TOP)+0.04;
        this.draw('steam',6,M.translation(0,sourceY,0),0.62*scene.steam);
      }
      gl.depthMask(true); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
      return true;
    }
    screen(position,block=false) {
      const p=M.transform(block ? this.block : this.body,position);
      return M.project(this.vp,p,this.width,this.height);
    }
    strandScreen(soft) {
      const {dry,wet}=this.anchor;
      const start=this.guidedSeat ? this.seatedAnchor : dry;
      return this.screen(start.map((value,i)=>M.lerp(value,wet[i],soft)),true);
    }
  }
  root.CupRenderer=Renderer;
})(globalThis);
