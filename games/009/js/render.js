(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = node
    ? factory(require("./math.js"), require("./mesh.js"), require("./track.js"), require("./camera.js"), require("./picking.js"))
    : factory(root.FoundryMath, root.FoundryMesh, root.FoundryTrack, root.FoundryCamera, root.FoundryPicking);
  if (node) module.exports = api;
  else root.FoundryRender = api;
})(globalThis, function (M, G, T, C, Picking) {
  "use strict";
  const LIGHT=M.unit([-0.58,1.10,0.52]);
  const FINISHES = [
    {name: "Persimmon", hex: "d9582d"}, {name: "Jade", hex: "318c83"},
    {name: "Egg tart", hex: "e6ae30"}, {name: "Harbour blue", hex: "6287a4"},
    {name: "Porcelain", hex: "e8dbbe"}
  ];
  const COLORS = FINISHES.map(finish => G.color(finish.hex));
  const vertex=`
    attribute vec3 aPos, aNormal, aColor;
    uniform mat4 uVP, uModel, uLightVP;
    varying vec3 vWorld, vNormal, vLocal, vColor;
    varying vec4 vShadow;
    void main() {
      vec4 world=uModel*vec4(aPos,1.0);
      vWorld=world.xyz; vNormal=mat3(uModel)*aNormal; vLocal=aNormal; vColor=aColor;
      vShadow=uLightVP*world; gl_Position=uVP*world;
    }`;
  function fragment(derivatives) {
    const header=derivatives ? "#extension GL_OES_standard_derivatives : enable\n" : "";
    return header+`
    precision highp float;
    varying vec3 vWorld, vNormal, vLocal, vColor;
    varying vec4 vShadow;
    uniform vec3 uLight, uEyeDir, uTint;
    uniform vec2 uSize;
    uniform float uKind, uShadowOn, uTexel, uPixel;
    uniform sampler2D uShadow;
    float visibility(vec3 n) {
      if (uShadowOn<0.5) return 1.0;
      vec3 p=vShadow.xyz/vShadow.w*0.5+0.5;
      if (p.x<0.0 || p.y<0.0 || p.x>1.0 || p.y>1.0 || p.z>=1.0) return 1.0;
      float bias=0.00020+0.00050*(1.0-max(dot(n,uLight),0.0));
      float total=0.0;
      for (int x=-1;x<=1;x++) for (int y=-1;y<=1;y++) {
        vec2 depth=texture2D(uShadow,p.xy+vec2(float(x),float(y))*uTexel*1.35).rg;
        total+=step(p.z-bias,depth.x+depth.y/255.0);
      }
      return total/9.0;
    }
    float grid(vec2 uv, vec2 fw) {
      vec2 dist=abs(fract(uv+0.5)-0.5)/max(fw,vec2(0.0001));
      return 1.0-smoothstep(0.10,1.0,min(dist.x,dist.y));
    }
    void main() {
      vec3 n=normalize(vNormal);
      float sun=visibility(n);
      vec3 rgb;
      if (uKind>0.5 && uKind<1.5) {
        vec2 uv=vWorld.xz;
        vec2 fw=`+(derivatives ? "fwidth(uv)" : "vec2(uPixel*1.55)")+`;
        float minor=grid(uv,fw);
        float major=grid(uv/5.0,fw/5.0);
        vec2 screen=gl_FragCoord.xy/uSize;
        float vignette=smoothstep(0.15,0.88,length((screen-0.53)*vec2(0.92,1.0)));
        rgb=mix(vec3(0.941,0.943,0.906),vec3(0.901,0.910,0.870),vignette);
        float ink=(minor*0.117+major*0.102)*(0.96-0.34*screen.y);
        rgb=mix(rgb,vec3(0.43,0.50,0.43),ink);
        rgb*=mix(vec3(0.77,0.80,0.75),vec3(1.0),sun);
        float grain=fract(sin(dot(mod(gl_FragCoord.xy,64.0),vec2(12.9898,78.233)))*3758.5453);
        rgb+=(grain-0.5)*0.007;
      } else if (uKind>2.5) {
        // Screen-door transparency keeps the reference marble order independent.
        vec2 pixel=floor(gl_FragCoord.xy);
        if (mod(pixel.x+2.0*pixel.y,4.0)>1.0) discard;
        float edge=1.0-max(dot(n,uEyeDir),0.0);
        float band=smoothstep(0.10,0.15,abs(vLocal.y));
        rgb=mix(vec3(0.13,0.48,0.56),vec3(0.82,1.0,0.88),max(1.0-band,edge*edge));
      } else {
        vec3 base=vColor;
        if (uKind < -0.5) base=mix(base,vec3(1.0,0.80,0.39),0.68);
        bool ball=uKind>1.5;
        if (ball) {
          vec3 q=normalize(vLocal);
          float band=abs(q.y+0.38*q.x+0.19*sin(q.z*3.2));
          float stripe=1.0-smoothstep(0.10,0.14,band);
          float hairline=1.0-smoothstep(0.018,0.037,abs(band-0.218));
          base=mix(uTint,vec3(0.99,0.927,0.746),max(stripe*0.93,hairline*0.82));
        }
        float diff=max(dot(n,uLight),0.0);
        float sky=n.y*0.5+0.5;
        float shine=pow(max(dot(n,normalize(uLight+uEyeDir)),0.0),ball ? 56.0 : 45.0);
        rgb=base*(0.53+0.34*sky+0.23*diff*sun);
        rgb*=mix(vec3(0.80,0.85,0.81),vec3(1.0),sun);
        rgb+=vec3(1.0,0.95,0.81)*shine*(ball ? 0.77 : 0.095)*sun;
        if (ball) {
          float rim=pow(1.0-max(dot(n,uEyeDir),0.0),3.0);
          rgb+=rim*vec3(0.16,0.17,0.15);
          rgb+=vec3(0.12)*pow(max(dot(n,normalize(vec3(-0.65,0.63,0.45))),0.0),18.0);
        }
      }
      gl_FragColor=vec4(rgb,1.0);
    }`;
  }
  const depthVS=`attribute vec3 aPos; uniform mat4 uVP,uModel;
    void main(){gl_Position=uVP*uModel*vec4(aPos,1.0);}`;
  const depthFS=`precision highp float;
    void main(){vec2 d=fract(gl_FragCoord.z*vec2(1.0,255.0));d.x-=d.y/255.0;gl_FragColor=vec4(d,0.0,1.0);}`;
  function program(gl,vs,fs,names) {
    const out=gl.createProgram();
    try {
      for (const [kind,source] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]) {
        const shader=gl.createShader(kind);
        try {
          gl.shaderSource(shader,source); gl.compileShader(shader);
          if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
          gl.attachShader(out,shader);
        } finally { gl.deleteShader(shader); }
      }
      for (const [i,name] of ["aPos","aNormal","aColor"].entries()) gl.bindAttribLocation(out,i,name);
      gl.linkProgram(out);
      if (!gl.getProgramParameter(out,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(out));
      const locations={program:out};
      for (const name of names.split(" ")) locations[name]=gl.getUniformLocation(out,name);
      return locations;
    } catch (error) {
      gl.deleteProgram(out);
      throw error;
    }
  }
  class Renderer {
    constructor(canvas) {
      const gl=canvas.getContext("webgl",{alpha:false,antialias:true,depth:true,stencil:false,powerPreference:"high-performance"});
      if (!gl || gl.isContextLost()) throw new Error("WebGL is unavailable");
      this.canvas=canvas; this.gl=gl; this.identity=M.identity();
      const high = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
      const precision = high && high.precision ? "highp" : "mediump";
      const litVS = vertex.replace(/varying /g, "varying " + precision + " ");
      const litFS = fragment(!!gl.getExtension("OES_standard_derivatives")).replace("precision highp", "precision " + precision);
      this.lit=program(gl,litVS,litFS,
        "uVP uModel uLightVP uLight uEyeDir uTint uSize uKind uShadowOn uTexel uPixel uShadow");
      try {
        this.depth=program(gl,depthVS,depthFS.replace("precision highp", "precision " + precision),"uVP uModel");
      } catch (error) {
        gl.deleteProgram(this.lit.program);
        throw error;
      }
      this.floor=this.upload(G.ground()); this.sphere=this.upload(G.sphere());
      this.parts=[]; this.lightVP=this.identity; this.dirty=true; this.lastShadow=0;
      this.shadowSize=Math.min(1536,gl.getParameter(gl.MAX_TEXTURE_SIZE),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
      this.shadowBuffer=gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowBuffer);
      this.shadowTexture=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,this.shadowTexture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,this.shadowSize,this.shadowSize,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.shadowTexture,0);
      this.depthBuffer=gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER,this.depthBuffer);
      gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,this.shadowSize,this.shadowSize);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,this.depthBuffer);
      this.shadows=precision === "highp" && gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.DITHER); // Packed shadow depths must survive the colour write exactly.
      gl.enableVertexAttribArray(0);
    }
    upload(mesh) {
      const gl=this.gl, v=gl.createBuffer(), i=gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,v); gl.bufferData(gl.ARRAY_BUFFER,mesh.vertices,gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,i); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.indices,gl.STATIC_DRAW);
      return {v,i,count:mesh.indices.length};
    }
    release(mesh) { this.gl.deleteBuffer(mesh.v); this.gl.deleteBuffer(mesh.i); }
    draw(mesh,lit) {
      const gl=this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER,mesh.v);
      gl.vertexAttribPointer(0,3,gl.FLOAT,false,36,0);
      if (lit) {
        gl.vertexAttribPointer(1,3,gl.FLOAT,false,36,12);
        gl.vertexAttribPointer(2,3,gl.FLOAT,false,36,24);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,mesh.i);
      gl.drawElements(gl.TRIANGLES,mesh.count,gl.UNSIGNED_SHORT,0);
    }
    course(course) {
      for (const part of this.parts) this.release(part);
      this.pickMeshes=course.sections.map(section=>Picking.pickMesh(G.sectionMesh(section)));
      this.parts=this.pickMeshes.map(mesh=>this.upload(mesh));
      const yaw=Math.atan2(LIGHT[0],LIGHT[2]), pitch=Math.asin(LIGHT[1]);
      const f=C.framing(C.cloud(course),yaw,pitch,100,100);
      this.lightVP=C.matrices(f.target,yaw,pitch,f.half*1.18+1,1,M.length(M.sub(course.bounds.max,course.bounds.min))).vp;
      this.dirty=true;
    }
    pick(view, x, y) {
      return Picking.nearestSection(this.pickMeshes, Picking.viewRay(view, x, y));
    }
    lighting(camera,shadows) {
      const gl=this.gl, s=this.lit;
      gl.useProgram(s.program); gl.enableVertexAttribArray(1); gl.enableVertexAttribArray(2);
      gl.uniformMatrix4fv(s.uVP,false,camera.vp); gl.uniformMatrix4fv(s.uLightVP,false,this.lightVP);
      gl.uniformMatrix4fv(s.uModel,false,this.identity); gl.uniform3fv(s.uLight,LIGHT);
      gl.uniform3fv(s.uEyeDir,camera.out); gl.uniform2f(s.uSize,this.canvas.width,this.canvas.height);
      gl.uniform1f(s.uPixel,camera.half*2/this.canvas.height); gl.uniform1f(s.uTexel,1/this.shadowSize);
      gl.uniform1f(s.uShadowOn,shadows ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,this.shadowTexture); gl.uniform1i(s.uShadow,0);
    }
    previews(cards) {
      const gl=this.gl, w=300,h=150;
      this.canvas.width=w; this.canvas.height=h; gl.viewport(0,0,w,h);
      for (const card of cards) {
        const type=card.dataset.piece;
        const section=T.piece(type,{p:[0,4,0],yaw:0});
        const geometry=G.sectionMesh(section,true), points=[];
        for (let i=0;i<geometry.vertices.length;i+=9) points.push(geometry.vertices.subarray(i,i+3));
        const yaw=type==="loop" ? 0.47 : 0.68, pitch=type==="loop" ? 0.32 : 0.55;
        const f=C.framing(points,yaw,pitch,w,h,10,6,25);
        const camera=C.matrices(f.target,yaw,pitch,f.half*1.07,w/h,12);
        gl.clearColor(0.946,0.946,0.918,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        this.lighting(camera,false); gl.uniform1f(this.lit.uKind,0);
        const mesh=this.upload(geometry); this.draw(mesh,true); this.release(mesh);
        const dest=card.querySelector("canvas");
        dest.width=w; dest.height=h;
        const context=dest.getContext("2d");
        if (context) context.drawImage(this.canvas,0,0);
      }
    }
    render(camera,balls,now,moving,ghost = null,selectedSection = -1) {
      const gl=this.gl, s=this.lit, d=this.depth;
      const marbles=balls.map(b=>({model:M.modelMatrix(b.p,T.RADIUS,b.q),color:COLORS[b.color] || COLORS[0]}));
      if (this.shadows && (this.dirty || moving && now-this.lastShadow>32)) {
        gl.bindTexture(gl.TEXTURE_2D,null); gl.bindFramebuffer(gl.FRAMEBUFFER,this.shadowBuffer);
        gl.viewport(0,0,this.shadowSize,this.shadowSize);
        gl.clearColor(1,1,1,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
        gl.useProgram(d.program); gl.disableVertexAttribArray(1); gl.disableVertexAttribArray(2);
        gl.uniformMatrix4fv(d.uVP,false,this.lightVP); gl.uniformMatrix4fv(d.uModel,false,this.identity);
        for (const mesh of this.parts) this.draw(mesh,false);
        for (const b of marbles) { gl.uniformMatrix4fv(d.uModel,false,b.model); this.draw(this.sphere,false); }
        gl.bindFramebuffer(gl.FRAMEBUFFER,null); this.dirty=false; this.lastShadow=now;
      }
      gl.viewport(0,0,this.canvas.width,this.canvas.height);
      gl.clearColor(0.926,0.932,0.893,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      this.lighting(camera,this.shadows);
      gl.uniform1f(s.uKind,1); this.draw(this.floor,true);
      gl.uniform1f(s.uKind,0);
      for (let i=0; i<this.parts.length; i++) {
        if (i === selectedSection) gl.uniform1f(s.uKind,-1);
        this.draw(this.parts[i],true);
        if (i === selectedSection) gl.uniform1f(s.uKind,0);
      }
      gl.uniform1f(s.uKind,2);
      for (const b of marbles) {
        gl.uniform3fv(s.uTint,b.color); gl.uniformMatrix4fv(s.uModel,false,b.model); this.draw(this.sphere,true);
      }
      if (ghost) {
        gl.uniform1f(s.uKind,3);
        gl.uniformMatrix4fv(s.uModel,false,M.modelMatrix(ghost,T.RADIUS));
        this.draw(this.sphere,true);
      }
    }
  }
  return {Renderer, FINISHES};
});
