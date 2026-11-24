(function (root) {
  'use strict';
  const M = root.HarbourMath, City = root.HarbourCity, Textures = root.HarbourTextures;
  const Shaders = root.HarbourShaders, Quay = root.HarbourQuay;
  const Lanterns = root.HarbourLanterns, Tide = root.HarbourTide, Beacon = root.HarbourBeacon, Cargo = root.HarbourCargo;
  const Cableway = root.HarbourCableway, Timehouse = root.HarbourTimehouse;
  function vertexLayout(fields) {
    let stride = 0;
    const attributes = Object.entries(fields).map(([name, size]) => {
      const offset = stride;
      stride += size * Float32Array.BYTES_PER_ELEMENT;
      return {name, size, offset};
    });
    return {attributes, stride};
  }
  const surfaces = vertexLayout({aPosition:3, aNormal:3, aUv:2, aTile:1, aColor:3});
  const lamps = vertexLayout({aSail:3, aCurrent:3, aFlower:3, aCorner:2, aColor:3});
  const beam = vertexLayout({aBeam:3});
  const screen = vertexLayout({aPosition:2});
  function requireHandle(handle, name) {
    if (!handle) throw new Error(name + ' allocation failed');
    return handle;
  }
  function program(gl, vertex, fragment, layout) {
    const result = requireHandle(gl.createProgram(), 'Shader program');
    try {
      for (const [type,source] of [[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]]) {
        const shader = requireHandle(gl.createShader(type), 'Shader');
        try {
          gl.shaderSource(shader,source); gl.compileShader(shader);
          if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
          gl.attachShader(result,shader);
        } finally {
          gl.deleteShader(shader);
        }
      }
      layout.attributes.forEach(({name},index) => gl.bindAttribLocation(result,index,name));
      gl.linkProgram(result);
      if (!gl.getProgramParameter(result,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(result));
    } catch (error) {
      gl.deleteProgram(result);
      throw error;
    }
    const uniforms = {};
    const count = gl.getProgramParameter(result,gl.ACTIVE_UNIFORMS);
    for (let i=0;i<count;i++) {
      const name = gl.getActiveUniform(result,i).name;
      uniforms[name] = gl.getUniformLocation(result,name);
    }
    return {id:result,u:uniforms};
  }
  function releaseMesh(gl, chunks) {
    for (const {vertices, indices} of chunks) {
      if (vertices) gl.deleteBuffer(vertices);
      if (indices) gl.deleteBuffer(indices);
    }
  }
  function uploadMesh(gl, chunks, previous = []) {
    const result = [];
    try {
      for (const [i, chunk] of chunks.entries()) {
        const buffers = previous[i] || {};
        result.push(buffers);
        if (!previous[i]) {
          buffers.vertices = requireHandle(gl.createBuffer(), 'Mesh vertex buffer');
          buffers.indices = requireHandle(gl.createBuffer(), 'Mesh index buffer');
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, buffers.vertices);
        gl.bufferData(gl.ARRAY_BUFFER, chunk.vertices, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.indices);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, chunk.indices, gl.STATIC_DRAW);
        buffers.count = chunk.indices.length;
      }
    } catch (error) {
      releaseMesh(gl, result.slice(previous.length));
      throw error;
    }
    releaseMesh(gl, previous.slice(result.length));
    return result;
  }
  function texture(gl, source, size, existing) {
    const tex = existing || requireHandle(gl.createTexture(), 'Texture');
    try {
      gl.bindTexture(gl.TEXTURE_2D,tex);
      if (size) gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,source);
      else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,size ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,size ? gl.REPEAT : gl.CLAMP_TO_EDGE);
      gl.generateMipmap(gl.TEXTURE_2D);
    } catch (error) {
      if (!existing) gl.deleteTexture(tex);
      throw error;
    }
    return tex;
  }
  class Target {
    constructor(gl,w,h,depth) {
      this.w=w; this.h=h;
      try {
        this.buffer=requireHandle(gl.createFramebuffer(), 'Framebuffer');
        this.texture=requireHandle(gl.createTexture(), 'Render target texture');
        gl.bindFramebuffer(gl.FRAMEBUFFER,this.buffer);
        gl.bindTexture(gl.TEXTURE_2D,this.texture);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
        gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.texture,0);
        if (depth) {
          this.depth=requireHandle(gl.createRenderbuffer(), 'Depth buffer');
          gl.bindRenderbuffer(gl.RENDERBUFFER,this.depth);
          gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,this.depth);
        }
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) throw new Error('Incomplete render target');
      } catch (error) {
        this.dispose(gl);
        throw error;
      }
    }
    dispose(gl) {
      if (this.buffer) gl.deleteFramebuffer(this.buffer);
      if (this.texture) gl.deleteTexture(this.texture);
      if (this.depth) gl.deleteRenderbuffer(this.depth);
    }
  }
  class Renderer {
    constructor(canvas,city) {
      const gl = canvas.getContext('webgl',{alpha:false,antialias:false,depth:true,stencil:false,powerPreference:'high-performance'});
      if (!gl) throw new Error('WebGL unavailable');
      this.canvas=canvas; this.gl=gl;
      this.textureLimit=gl.getParameter(gl.MAX_TEXTURE_SIZE);
      this.maxSize=Math.min(this.textureLimit, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
      this.p = {};
      this.fleet = [];
      this.targets = null;
      this.attributeCount = 0;
      try {
        for (const name of ['environment', 'extract', 'blur', 'finish'])
          this.p[name] = program(gl, Shaders.screen, Shaders[name], screen);
        this.p.building = program(gl, Shaders.buildingVertex, Shaders.building, surfaces);
        this.p.lantern = program(gl, Shaders.lanternVertex, Shaders.lantern, lamps);
        this.p.beacon = program(gl, Shaders.beaconVertex, Shaders.beacon, beam);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
        this.setCity(city);
        this.signs=texture(gl,Textures.signAtlas(this.textureLimit));
        const ferry=uploadMesh(gl,City.buildFerry());
        this.fleet.push({mesh:ferry, scale:1, pose:City.ferryPose}, {mesh:ferry, scale:0.64, pose:time=>City.ferryPose(time,1)});
        this.fleet.push({mesh:uploadMesh(gl,City.buildJunk()), scale:1, pose:City.junkPose});
        this.tram = uploadMesh(gl, Quay.buildTram());
        this.rotor = uploadMesh(gl, Quay.buildWheelRotor());
        this.cabins = uploadMesh(gl, Quay.buildWheelCabins());
        this.lanterns = uploadMesh(gl, Lanterns.buildMesh());
        this.cableCar = uploadMesh(gl, Cableway.buildCar());
        this.beam = uploadMesh(gl, Beacon.buildBeam());
        this.rig = uploadMesh(gl, Cargo.buildRig());
        this.triangle = requireHandle(gl.createBuffer(), 'Screen buffer');
        gl.bindBuffer(gl.ARRAY_BUFFER,this.triangle);
        gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
        gl.depthFunc(gl.LEQUAL);
        gl.clearColor(0.059,0.094,0.118,1);
      } catch (error) {
        this.dispose();
        throw error;
      }
    }
    dispose() {
      const gl = this.gl;
      for (const p of Object.values(this.p)) gl.deleteProgram(p.id);
      for (const tex of [this.facades, this.noise, this.signs]) if (tex) gl.deleteTexture(tex);
      const meshes = new Set([this.world, this.tram, this.rotor, this.cabins, this.lanterns, this.cableCar, this.beam, this.rig,
        ...this.fleet.map(v => v.mesh)]);
      for (const mesh of meshes) if (mesh) releaseMesh(gl, mesh);
      if (this.triangle) gl.deleteBuffer(this.triangle);
      if (this.targets) Object.values(this.targets).forEach(target => target.dispose(gl));
    }
    setCity(city) {
      const gl=this.gl;
      const size=Textures.atlasSize(128,this.textureLimit);
      this.facades=texture(gl,Textures.facadeAtlas(city.seed,this.textureLimit),0,this.facades);
      this.noise=texture(gl,Textures.noisePixels(city.seed+3,size),size,this.noise);
      this.world=uploadMesh(gl,City.buildWorld(city),this.world);
    }
    resize(width,height) {
      const gl=this.gl;
      const ratio=Math.min(1,this.maxSize/Math.max(width,height));
      const w=Math.max(1,Math.floor(width*ratio)), h=Math.max(1,Math.floor(height*ratio));
      if (this.targets && this.canvas.width===w && this.canvas.height===h) return;
      this.canvas.width=w; this.canvas.height=h;
      if (this.targets) Object.values(this.targets).forEach(t=>t.dispose(gl));
      const small=(v,k)=>Math.max(1,Math.round(v*k));
      this.targets = null;
      const targets = {};
      try {
        targets.reflection = new Target(gl, small(w,0.58), small(h,0.58), true);
        targets.scene = new Target(gl, w, h, true);
        targets.glow = new Target(gl, small(w,0.23), small(h,0.23), false);
        targets.blur = new Target(gl, small(w,0.23), small(h,0.23), false);
        this.targets = targets;
      } catch (error) {
        Object.values(targets).forEach(t => t.dispose(gl));
        throw error;
      }
    }
    target(target) {
      const gl=this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER,target ? target.buffer : null);
      gl.viewport(0,0,target ? target.w : this.canvas.width,target ? target.h : this.canvas.height);
    }
    bind(tex,unit,uniform) {
      const gl=this.gl;
      gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,tex); gl.uniform1i(uniform,unit);
    }
    setAttributes(layout) {
      const count = layout.attributes.length;
      for (let i = this.attributeCount; i < count; i++) this.gl.enableVertexAttribArray(i);
      for (let i = count; i < this.attributeCount; i++) this.gl.disableVertexAttribArray(i);
      this.attributeCount = count;
    }
    screen() {
      const gl=this.gl;
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      this.setAttributes(screen);
      gl.bindBuffer(gl.ARRAY_BUFFER,this.triangle);
      gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0); gl.drawArrays(gl.TRIANGLES,0,3);
    }
    drawMeshes(chunks, layout = surfaces) {
      const gl = this.gl;
      this.setAttributes(layout);
      for (const chunk of chunks) {
        gl.bindBuffer(gl.ARRAY_BUFFER,chunk.vertices); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,chunk.indices);
        for (let i = 0; i < layout.attributes.length; i++) {
          const {size, offset} = layout.attributes[i];
          gl.vertexAttribPointer(i, size, gl.FLOAT, false, layout.stride, offset);
        }
        gl.drawElements(gl.TRIANGLES,chunk.count,gl.UNSIGNED_SHORT,0);
      }
    }
    drawModel(mesh, pose, scale = 1) {
      const gl = this.gl, u = this.p.building.u;
      gl.uniform4f(u.uModel, pose.x, pose.y, pose.z, pose.angle);
      gl.uniform1f(u.uScale, scale);
      this.drawMeshes(mesh);
    }
    conditions(u, scene) {
      this.gl.uniform3fv(u.uWeather, scene.weather);
      this.gl.uniform2fv(u.uTwilight, scene.twilight);
      this.gl.uniform1f(u.uTide, scene.tide);
    }
    beaconOptics(u, scene) {
      const {range, slope, spread, aperture} = Beacon.optics;
      this.gl.uniform3fv(u.uLamp, Beacon.lamp);
      this.gl.uniform2fv(u.uSweep, scene.sweep);
      this.gl.uniform4f(u.uOptics, range, slope, spread, aperture);
    }
    drawEnvironment({shot, basis, lens}, scene, mirror, target) {
      const gl = this.gl, env = this.p.environment;
      gl.useProgram(env.id);
      this.conditions(env.u, scene);
      gl.uniform3fv(env.u.uEye,shot.eye); gl.uniform3fv(env.u.uForward,basis.forward);
      gl.uniform3fv(env.u.uRight,basis.right); gl.uniform3fv(env.u.uUp,basis.up);
      gl.uniform2fv(env.u.uLens,lens); gl.uniform1f(env.u.uTime,scene.time);
      gl.uniform1f(env.u.uMirror,mirror); gl.uniform1f(env.u.uPixel,2*lens[1]/target.h);
      const {boats} = scene;
      for (const [uniform,boat] of [[env.u.uFerryWake,boats[0]],[env.u.uLaunchWake,boats[1]],[env.u.uJunkWake,boats[2]]]) {
        gl.uniform4f(uniform,boat.x,boat.z,Math.cos(boat.angle),Math.sin(boat.angle));
      }
      this.bind(mirror<0 ? this.noise : this.targets.reflection.texture,0,env.u.uReflection);
      this.bind(this.noise,1,env.u.uNoise);
      this.screen();
    }
    drawSurfaces({projection, lens}, scene, mirror, target) {
      const gl = this.gl, building = this.p.building;
      const {tram, wheelTurn, boats} = scene;
      gl.useProgram(building.id); gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
      gl.frontFace(mirror<0 ? gl.CW : gl.CCW);
      gl.uniformMatrix4fv(building.u.uProjection,false,projection); gl.uniform1f(building.u.uMirror,mirror);
      this.conditions(building.u, scene);
      this.beaconOptics(building.u, scene);
      gl.uniform4f(building.u.uHands, ...scene.clock.hands);
      gl.uniform1f(building.u.uBallLift, scene.clock.lift);
      gl.uniform1f(building.u.uDialPixel, 2 * lens[1] / (target.h * Timehouse.dialRadius));
      gl.uniform2f(building.u.uCabin, 0, 0);
      gl.uniform1f(building.u.uTramDirection, tram.direction);
      this.bind(this.facades,0,building.u.uFacades); this.bind(this.signs,1,building.u.uSigns);
      gl.uniform4f(building.u.uModel,0,0,0,0); gl.uniform1f(building.u.uScale,1);
      gl.uniform3fv(building.u.uWheel, scene.sheaveTurn);
      gl.uniform2f(building.u.uHoist, 0, 0);
      this.drawMeshes(this.world);
      this.drawModel(this.tram, tram);
      gl.uniform4f(building.u.uModel, Quay.wheel.x, Quay.wheel.y, Quay.wheel.z, 0);
      gl.uniform3fv(building.u.uWheel, [wheelTurn[0], wheelTurn[1], 1]);
      this.drawMeshes(this.rotor);
      gl.uniform3fv(building.u.uWheel, [wheelTurn[0], wheelTurn[1], 2]);
      this.drawMeshes(this.cabins);
      gl.uniform3fv(building.u.uWheel, [1, 0, 0]);
      gl.uniform2f(building.u.uHoist, scene.rig.hook, scene.rig.bottom);
      this.drawModel(this.rig, scene.rig);
      gl.uniform2f(building.u.uHoist, 0, 0);
      scene.cars.forEach((car, i) => {
        gl.uniform2f(building.u.uCabin, Cableway.doorTravel * car.doors, i);
        this.drawModel(this.cableCar, car);
      });
      gl.uniform2f(building.u.uCabin, 0, 0);
      boats.forEach((boat,i) => this.drawModel(this.fleet[i].mesh, boat, this.fleet[i].scale));
    }
    drawBeacon({projection, lens, shot}, scene, mirror) {
      const gl = this.gl, {id, u} = this.p.beacon;
      gl.useProgram(id);
      this.conditions(u, scene);
      this.beaconOptics(u, scene);
      gl.uniformMatrix4fv(u.uProjection, false, projection);
      gl.uniform3fv(u.uEye, shot.eye);
      gl.uniform2fv(u.uLens, lens);
      gl.uniform3fv(u.uContact, scene.contact);
      gl.uniform1f(u.uMirror, mirror);
      gl.uniform1f(u.uPhase, M.wrap(scene.time, M.TAU));
      this.drawMeshes(this.beam, beam);
    }
    drawLanterns({projection, lens}, scene, mirror, target) {
      const gl = this.gl, {id, u} = this.p.lantern;
      gl.useProgram(id);
      this.conditions(u, scene);
      gl.uniformMatrix4fv(u.uProjection, false, projection);
      gl.uniform3fv(u.uOrigin, Lanterns.origin);
      gl.uniform3fv(u.uWeights, scene.formation);
      gl.uniform4f(u.uLampSize, 0.72 / lens[0], 0.72 / lens[1], 4.6 / target.w, 4.6 / target.h);
      gl.uniform1f(u.uMirror, mirror);
      this.drawMeshes(this.lanterns, lamps);
    }
    drawLights(view, scene, mirror, target) {
      const gl = this.gl;
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.depthMask(false);
      this.drawLanterns(view, scene, mirror, target);
      this.drawBeacon(view, scene, mirror);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    scenery(view, scene, mirror) {
      const gl = this.gl, {basis, lens} = view;
      const target = mirror < 0 ? this.targets.reflection : this.targets.scene;
      this.target(target);
      if (mirror < 0) {
        // Include both horizon corners and the maximum water ripple displacement.
        const horizon = basis.up[1] > 0.001
          ? 0.5 + (Math.abs(basis.right[1] * lens[0]) - basis.forward[1]) / (2 * lens[1] * basis.up[1]) : 1;
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(0, 0, target.w, Math.ceil(target.h * M.clamp(horizon + 0.11, 0, 1)));
      }
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      this.drawEnvironment(view, scene, mirror, target);
      this.drawSurfaces(view, scene, mirror, target);
      this.drawLights(view, scene, mirror, target);
      gl.disable(gl.SCISSOR_TEST);
    }
    render(shot, time, weather = root.HarbourWeather.profiles.moonlit, twilight = root.HarbourAtmosphere.lighting.profiles.midnight, power = 1) {
      const gl=this.gl, t=this.targets, p=this.p;
      const aspect=this.canvas.width/this.canvas.height;
      const lens = root.HarbourFlight.lensFor(shot.fov, aspect, power);
      const basis=M.cameraBasis(shot.eye,shot.aim,shot.up);
      const projection=M.multiply(M.perspective(2*Math.atan(lens[1]),aspect,0.5,950),M.viewMatrix(shot.eye,basis));
      const boats=this.fleet.map(vessel=>vessel.pose(time));
      const angle = Quay.wheelAngle(time);
      const tide = Tide.heightAt(time);
      const cars = [Cableway.car(time), Cableway.car(time, true)];
      const sheave = Cableway.sheaveAngle(cars[0].fraction);
      const scene = {time, boats, weather, twilight, tide, formation: Lanterns.cue(time).weights,
        sweep: Beacon.direction(time), contact: Beacon.waterContact(tide), rig: Cargo.transfer(time),
        clock: Timehouse.reading(time), cars, sheaveTurn: [Math.cos(sheave), Math.sin(sheave), 0],
        tram: Quay.tramPose(time), wheelTurn: [Math.cos(angle), Math.sin(angle)]};
      const view = {shot, basis, lens, projection};
      this.scenery(view,scene,-1);
      this.scenery(view,scene,1);
      this.target(t.glow); gl.useProgram(p.extract.id);
      this.bind(t.scene.texture,0,p.extract.u.uImage); gl.uniform2f(p.extract.u.uTexel,1/t.scene.w,1/t.scene.h); this.screen();
      gl.useProgram(p.blur.id); this.target(t.blur); this.bind(t.glow.texture,0,p.blur.u.uImage);
      gl.uniform2f(p.blur.u.uStep,1.5/t.blur.w,0); this.screen();
      this.target(t.glow); this.bind(t.blur.texture,0,p.blur.u.uImage);
      gl.uniform2f(p.blur.u.uStep,0,1.5/t.glow.h); this.screen();
      this.target(null); gl.useProgram(p.finish.id); this.bind(t.scene.texture,0,p.finish.u.uImage);
      gl.uniform3fv(p.finish.u.uRain, [weather[1], time % 20000, aspect]);
      this.bind(t.glow.texture,1,p.finish.u.uBloom); this.screen();
    }
  }
  root.HarbourRenderer=Renderer;
})(globalThis);
