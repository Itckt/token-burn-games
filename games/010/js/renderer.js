(function () {
  'use strict';
  const local = typeof module === 'object' && module.exports;
  const M = local ? require('./math.js') : PocketPlaces.math;
  const G = local ? require('./mesh.js') : PocketPlaces.mesh;
  const sim = local ? require('./simulation.js') : PocketPlaces.sim;
  const street = local ? require('./street.js') : PocketPlaces.street;
  const shaders = local ? require('./shaders.js') : PocketPlaces.shaders;
  const world = local ? require('./world.js') : PocketPlaces.world;
  const toast = local ? require('./toast.js') : PocketPlaces.toast;
  const till = local ? require('./till.js') : PocketPlaces.till;
  const cat = local ? require('./shop-cat.js') : PocketPlaces.shopCat;
  const daylight = street.createLight();
  const defaultRoom = world.createRoom();

  const sun = M.unit([-3.3, 9.7, 6.2]);
  const lightTarget = [0, 1.1, 0];
  const lightView = M.lookAt(M.add(lightTarget, M.scale(sun,15)), lightTarget);
  const lightMatrix = M.multiply(M.ortho(-7,7,-7,7,3,27), lightView);

  function bufferSize(width, height, pixelRatio, limit) {
    if (width <= 0 || height <= 0) return [1,1];
    const ratio = Math.min(pixelRatio || 1, 2, limit/width, limit/height,
      Math.sqrt(2400000 / (width*height)));
    return [Math.max(1,Math.floor(width*ratio)),Math.max(1,Math.floor(height*ratio))];
  }

  function createRenderer(gl, scene, atlas) {
    const cleanups = [];
    function own(resource, deleteMethod) {
      if (!resource) throw new Error('The graphics device could not allocate a resource.');
      cleanups.push(() => gl[deleteMethod](resource));
      return resource;
    }
    function dispose() {
      while (cleanups.length) cleanups.pop()();
    }

    function program(pair, attrs, names) {
      const handle = own(gl.createProgram(), 'deleteProgram');
      for (const [type, source] of [[gl.VERTEX_SHADER,pair.vertex],[gl.FRAGMENT_SHADER,pair.fragment]]) {
        const shader = own(gl.createShader(type), 'deleteShader');
        gl.shaderSource(shader,source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(handle,shader);
      }
      for (const [name,slot] of Object.entries(attrs)) gl.bindAttribLocation(handle,slot,name);
      gl.linkProgram(handle);
      if (!gl.getProgramParameter(handle,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(handle));
      const result = {handle};
      for (const name of names) result[name] = gl.getUniformLocation(handle,'u_'+name);
      return result;
    }

    function buffer(target, data, usage = gl.STATIC_DRAW) {
      const handle = own(gl.createBuffer(),'deleteBuffer');
      gl.bindBuffer(target,handle);
      gl.bufferData(target,data,usage);
      return handle;
    }
    function target(size) {
      const color = own(gl.createTexture(),'deleteTexture');
      gl.bindTexture(gl.TEXTURE_2D,color);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      const depth = own(gl.createRenderbuffer(),'deleteRenderbuffer');
      gl.bindRenderbuffer(gl.RENDERBUFFER,depth);
      gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,size,size);
      const framebuffer = own(gl.createFramebuffer(),'deleteFramebuffer');
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,color,0);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('The graphics device could not create a render target.');
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      return {color,framebuffer,size};
    }

    try {
      const attrs = {a_position:0,a_normal:1,a_color:2,a_uv:3,a_material:4};
      const poseUniforms=['rotor','liquid','catPose','walk','tuning','blind','slice','till'];
      const surface = program(shaders.surface,attrs,['camera','light','sun','eye','atlas','shadow','shadowStep','hover',
        'rain','night','rainTime','busLeft','teaTint','swirl',...poseUniforms]);
      const cast = program(shaders.shadow,attrs,['camera','atlas']);
      const pickInk = program(shaders.pick,attrs,['camera','atlas',...poseUniforms]);
      const ground = program(shaders.ground,{a_ground:0},['camera']);
      const steam = program(shaders.steam,{a_position:0,a_wisp:1},['camera']);
      const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const viewportLimit = Math.min(...gl.getParameter(gl.MAX_VIEWPORT_DIMS),gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
      const shadow = target(Math.min(1536,maxTexture,viewportLimit));
      const selection = target(1);

      if (atlas.width > maxTexture) {
        const smaller = atlas.ownerDocument.createElement('canvas');
        smaller.width = smaller.height = 2 ** Math.floor(Math.log2(maxTexture));
        smaller.getContext('2d').drawImage(atlas,0,0,smaller.width,smaller.height);
        atlas = smaller;
      }
      const print = own(gl.createTexture(),'deleteTexture');
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D,print);
      // The atlas uses top-left coordinates, so a panel's top edge has v = 0.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.generateMipmap(gl.TEXTURE_2D);

      const batches = scene.batches.map(b => ({
        vertex:buffer(gl.ARRAY_BUFFER,b.vertices),
        index:buffer(gl.ELEMENT_ARRAY_BUFFER,b.indices),
        count:b.indices.length
      }));
      const floor = buffer(gl.ARRAY_BUFFER,new Float32Array([-7,-6, 7,-6, -7,6, 7,6]));
      const wisps = sim.steamMesh(scene.steam);
      const steamVertices = buffer(gl.ARRAY_BUFFER,wisps.vertices.byteLength,gl.DYNAMIC_DRAW);
      const steamIndices = buffer(gl.ELEMENT_ARRAY_BUFFER,wisps.indices);
      let slots = 0;
      function layout(count) {
        for (let i=slots; i<count; i++) gl.enableVertexAttribArray(i);
        for (let i=count; i<slots; i++) gl.disableVertexAttribArray(i);
        slots = count;
      }
      function attribute(slot,size,stride,offset) {
        gl.vertexAttribPointer(slot,size,gl.FLOAT,false,stride*4,offset*4);
      }
      function drawWorld() {
        layout(5);
        for (const b of batches) {
          gl.bindBuffer(gl.ARRAY_BUFFER,b.vertex);
          attribute(0,3,G.STRIDE,0); attribute(1,3,G.STRIDE,3);
          attribute(2,3,G.STRIDE,6); attribute(3,2,G.STRIDE,9); attribute(4,3,G.STRIDE,11);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b.index);
          gl.drawElements(gl.TRIANGLES,b.count,gl.UNSIGNED_SHORT,0);
        }
      }
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.disable(gl.DITHER);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
      gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);

      // The architecture and the sun are stationary. Bake shadows just once.
      gl.bindFramebuffer(gl.FRAMEBUFFER,shadow.framebuffer);
      gl.viewport(0,0,shadow.size,shadow.size);
      gl.clearColor(1,1,1,1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(cast.handle);
      gl.uniformMatrix4fv(cast.camera,false,lightMatrix);
      gl.uniform1i(cast.atlas,0);
      drawWorld();
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,shadow.color);
      gl.activeTexture(gl.TEXTURE0);
      gl.useProgram(surface.handle);
      gl.uniformMatrix4fv(surface.light,false,lightMatrix);
      gl.uniform3fv(surface.sun,sun);
      gl.uniform1i(surface.atlas,0); gl.uniform1i(surface.shadow,1);
      gl.uniform1f(surface.shadowStep,1/shadow.size);

      let bladeCos=1, bladeSin=0, displayedDrink=defaultRoom.drink;
      const catPose=[...cat.home,1,0];
      let lift=0, stride=0, dial=0, lamp=0;
      let drop=0, split=0, finish=0, drawer=0, amount=0;
      function applyPose(pass) {
        gl.uniform2f(pass.rotor,bladeCos,bladeSin);
        gl.uniform2f(pass.liquid,displayedDrink.scale,displayedDrink.drop);
        gl.uniform4f(pass.catPose,...catPose);
        gl.uniform2f(pass.walk,lift,stride);
        gl.uniform2f(pass.tuning,dial,lamp);
        gl.uniform1f(pass.blind,drop);
        gl.uniform2f(pass.slice,split,finish);
        gl.uniform2f(pass.till,drawer,amount);
      }
      function draw(camera,time,hover = 0,light = daylight,room = defaultRoom) {
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        gl.viewport(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight);
        gl.clearColor(0,0,0,0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(ground.handle);
        gl.uniformMatrix4fv(ground.camera,false,camera.matrix);
        gl.enable(gl.BLEND); gl.depthMask(false);
        layout(1); gl.bindBuffer(gl.ARRAY_BUFFER,floor); attribute(0,2,2,0);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);

        gl.depthMask(true); gl.disable(gl.BLEND);
        gl.useProgram(surface.handle);
        bladeCos=Math.cos(room.fan.angle); bladeSin=Math.sin(room.fan.angle);
        displayedDrink=room.drink;
        const pet=room.cat || defaultRoom.cat, angle=pet.yaw-cat.homeYaw;
        catPose[0]=pet.x; catPose[1]=pet.z; catPose[2]=Math.cos(angle); catPose[3]=Math.sin(angle);
        lift=pet.lift; stride=pet.stride;
        const tuning=room.tuning || defaultRoom.tuning;
        dial=tuning.dial; lamp=Number(tuning.playing);
        drop=room.drop ?? 0; split=room.split ?? 0; drawer=room.drawer ?? 0;
        finish=toast.finishes.indexOf((room.plate || defaultRoom.plate).finish);
        const bill=room.bill || defaultRoom.bill;
        amount=room.atTill || bill.settled ? till.counted(bill) : till.subtotal(till.bills[bill.bill]);
        applyPose(surface);
        gl.uniform3fv(surface.teaTint,displayedDrink.tint);
        gl.uniform1f(surface.swirl,Math.max(0,1-(time-room.pouredAt)/2));
        gl.uniformMatrix4fv(surface.camera,false,camera.matrix);
        gl.uniform3fv(surface.eye,camera.eye);
        gl.uniform1f(surface.hover,hover || -1);
        gl.uniform1f(surface.rain,light.rain);
        gl.uniform1f(surface.night,light.night);
        // Keep mediump glass coordinates precise, even after a long visit.
        gl.uniform1f(surface.rainTime,(time*1.2)%1);
        gl.uniform1f(surface.busLeft,street.busLeft(time));
        drawWorld();

        sim.updateSteam(wisps,scene.steam,camera.right,time,room.fan.wind,displayedDrink);
        gl.useProgram(steam.handle);
        gl.uniformMatrix4fv(steam.camera,false,camera.matrix);
        layout(2); gl.bindBuffer(gl.ARRAY_BUFFER,steamVertices);
        gl.bufferSubData(gl.ARRAY_BUFFER,0,wisps.vertices);
        attribute(0,3,5,0); attribute(1,2,5,3);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,steamIndices);
        gl.enable(gl.BLEND); gl.depthMask(false);
        gl.drawElements(gl.TRIANGLES,wisps.indices.length,gl.UNSIGNED_SHORT,0);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }
      const pixel = new Uint8Array(4);
      function pick(camera,px,py) {
        const w=gl.drawingBufferWidth, h=gl.drawingBufferHeight;
        if (px<0 || py<0 || px>=w || py>=h) return 0;
        gl.bindFramebuffer(gl.FRAMEBUFFER,selection.framebuffer);
        // Translate the full view so the requested pixel lands in a 1x1 target.
        gl.viewport(-px,-py,w,h);
        gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(pickInk.handle);
        applyPose(pickInk);
        gl.uniformMatrix4fv(pickInk.camera,false,camera.matrix);
        gl.uniform1i(pickInk.atlas,0);
        drawWorld();
        gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        gl.viewport(0,0,w,h);
        return pixel[0];
      }
      return {draw,pick,dispose,viewportLimit};
    } catch (error) {
      dispose();
      throw error;
    }
  }

  const api = {bufferSize, lightMatrix, createRenderer};
  if (local) module.exports = api;
  else PocketPlaces.renderer = api;
})();
