(function () {
  'use strict';
  const { math: M, route: R, mesh, world, viaduct, surfaces, passengers, commuters, weather, signals,
    camera: cameraMath, saloon, shuttle, boarding, daylight } = Nightline;

  const { VERTEX, FRAGMENT } = Nightline.shaders;

  function program(gl) {
    const p = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader); gl.deleteProgram(p);
        throw new Error(message);
      }
      gl.attachShader(p, shader); gl.deleteShader(shader);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error(message);
    }
    return p;
  }

  function createRenderer(canvas) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: true, depth: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL unavailable');
    const p = program(gl); gl.useProgram(p);
    const attrs = [['aPosition',3,0],['aNormal',3,3],['aColor',4,6],['aUV',2,10],['aSurface',3,12],['aTrackPart',2,15]]
      .map(([name,size,offset]) => ({ loc: gl.getAttribLocation(p,name), size, offset }));
    for (const attr of attrs) gl.enableVertexAttribArray(attr.loc);
    const u = {};
    for (const name of ['ViewProjection','Origin','Rotation','Door','Atlas','Eye','Cab','Station','Outdoor','Sky','Display',
      'Weather','BladeAngle','FilmLow','FilmHigh','Aspect','GuardLamp','Heading','Sun','LampOrigin',
      'Swing','SaloonText','PassengerRows']) {
      u[name] = gl.getUniformLocation(p,'u'+name);
    }
    u.Riders = gl.getUniformLocation(p, 'uRiders[0]');
    function loadAtlas(unit, sampler, canvas) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.uniform1i(sampler, unit);
    }
    loadAtlas(1, u.SaloonText, surfaces.makeSaloonAtlas());
    loadAtlas(0, u.Atlas, surfaces.makeAtlas());
    const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    if (aniso) gl.texParameterf(gl.TEXTURE_2D,aniso.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(4,gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
    gl.clearColor(0.075,0.107,0.113,1); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);

    function upload(data) {
      if (!data.indices.length) return null;
      const vb = gl.createBuffer(), ib = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER,vb); gl.bufferData(gl.ARRAY_BUFFER,data.vertices,gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,data.indices,gl.STATIC_DRAW);
      return { vb, ib, count: data.indices.length };
    }
    function uploadPair(geometry) {
      return { station: geometry.station, outdoor: geometry.outdoor, marker: geometry.marker,
        solid: upload(geometry.solid), glass: upload(geometry.glass) };
    }
    function release(pair) {
      for (const item of [pair.solid,pair.glass]) if (item) { gl.deleteBuffer(item.vb); gl.deleteBuffer(item.ib); }
    }
    function draw(item) {
      if (!item) return;
      gl.bindBuffer(gl.ARRAY_BUFFER,item.vb); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,item.ib);
      for (const a of attrs) gl.vertexAttribPointer(a.loc,a.size,gl.FLOAT,false,mesh.STRIDE*4,a.offset*4);
      gl.drawElements(gl.TRIANGLES,item.count,gl.UNSIGNED_SHORT,0);
    }
    const cab = uploadPair(world.buildCab());
    const sky = upload(viaduct.buildSky());
    const riders = upload(commuters.buildRiders());
    const shuttleCars = [upload(shuttle.buildCar(false)), upload(shuttle.buildCar(true))];
    const poses = new Float32Array(4 * (passengers.MAX_WAITING + 1));
    const chunks = new Map();
    let platform = null;
    let previousChunk = null, idleTask = null, prepared = null, skyVisible = false;
    function cancelPreparation() {
      if (idleTask !== null) window.cancelIdleCallback(idleTask);
      idleTask = null; prepared = null;
    }
    function stream(center) {
      if (previousChunk === center) return;
      previousChunk = center;
      const first = center-3, last = center+10;
      const ready = prepared;
      cancelPreparation();
      for (const [i,pair] of chunks) if (i<first || i>last) { release(pair); chunks.delete(i); }
      for (let i=first;i<=last;i++) if (!chunks.has(i)) {
        const data = ready?.index === i ? ready.data : world.buildChunk(i);
        chunks.set(i,uploadPair(data));
      }
      skyVisible = Array.from(chunks.values()).some(pair => pair.outdoor);
      platform = null;
      for (const [i, pair] of chunks) {
        const mark = i * R.CHUNK;
        if (pair.station >= 0 && M.mod(mark, R.LENGTH) === R.STATIONS[pair.station].at) {
          const visit = Math.floor(mark / R.LENGTH) * R.STATIONS.length + pair.station;
          platform = { mark, expected: passengers.platformCall(visit) };
          break;
        }
      }
      if (window.requestIdleCallback && window.cancelIdleCallback) {
        idleTask = window.requestIdleCallback(deadline => {
          idleTask = null;
          if (deadline.timeRemaining() >= 7) prepared = { index: last+1, data: world.buildChunk(last+1) };
        });
      }
    }

    function render(s, camera, traffic = shuttle.carsAt(s.position, s.time)) {
      const cssW = Math.max(canvas.clientWidth,1), cssH = Math.max(canvas.clientHeight,1);
      const dpr = Math.min(window.devicePixelRatio || 1,1.75,Math.sqrt(1650000/(cssW*cssH)));
      const w = Math.max(1,Math.round(cssW*dpr)), h = Math.max(1,Math.round(cssH*dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width=w; canvas.height=h; }
      gl.viewport(0,0,w,h);
      const center = Math.floor(s.position/R.CHUNK);
      stream(center);
      const trackX = R.trackOffset(s.position), heading = Math.atan(R.trackSlope(s.position));
      const sn = Math.sin(heading), cs = Math.cos(heading), motion = Math.min(1,s.speed/10);
      const sway = motion*Math.sin(s.position*0.31)*0.007;
      const eye = cameraMath.eye(camera, sway, motion*Math.sin(s.position*0.55)*0.004, trackX, cs, sn);
      const yaw = heading+0.105+camera.yaw, pitch = -0.040+camera.pitch;
      const target = [eye[0]+Math.sin(yaw)*Math.cos(pitch),eye[1]+Math.sin(pitch),eye[2]-Math.cos(yaw)*Math.cos(pitch)];
      const aspect = w/h;
      const fov = Math.max(0.986,2*Math.atan(Math.tan(0.79)/aspect));
      const vp = M.multiply(M.perspective(fov,aspect,0.045,180),M.lookAt(eye,target,[sway*0.20,1,0]));
      gl.uniformMatrix4fv(u.ViewProjection,false,vp); gl.uniform3fv(u.Eye,eye);
      gl.uniform2f(u.Heading,cs,sn);
      gl.uniform2f(u.LampOrigin,trackX,0);
      const { side, rear } = s.swing, passengerMessage = saloon.message(s);
      gl.uniform4f(u.Swing,Math.cos(side),Math.sin(side),Math.cos(rear),Math.sin(rear));
      gl.uniform2f(u.PassengerRows,passengerMessage.station,passengerMessage.stage.row);
      gl.uniform4f(u.Sun,...daylight.sunlight(s.clock));
      gl.uniform2f(u.Display,Math.round(s.speed*3.6),s.berth ?? R.nextStation(s.last));
      const { cloud, water, film } = s.weather;
      gl.uniform3f(u.Weather, cloud, water, (s.time % 32) * 0.5);
      gl.uniform1f(u.BladeAngle, weather.bladeAngle(s.weather));
      gl.uniform4f(u.FilmLow, film[0], film[1], film[2], film[3]);
      gl.uniform4f(u.FilmHigh, film[4], film[5], film[6], film[7]);
      gl.uniform1f(u.Sky,0);
      gl.uniform1f(u.Aspect,signals.CLEAR);
      gl.depthMask(true); gl.disable(gl.BLEND); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      const door = s.door*s.door*(3-2*s.door);
      const exposure = R.openAir(s.position), guardLamp = boarding.lamp(s);
      function placeTrack(start, station, outdoor) {
        gl.uniform3f(u.Origin, 0, 0, s.position - start); gl.uniform2f(u.Rotation, 1, 0);
        gl.uniform1f(u.Cab, 0); gl.uniform1f(u.Station, station >= 0 ? 1 : 0);
        gl.uniform1f(u.Outdoor, Number(outdoor)); gl.uniform1f(u.Door, station === s.berth ? door : 0);
        gl.uniform1f(u.GuardLamp, station === s.berth ? guardLamp : 0);
      }
      function drawChunk(i,pair,pass) {
        if (!pair[pass]) return;
        const start = i * R.CHUNK;
        placeTrack(start, pair.station, pair.outdoor);
        if (pair.marker) gl.uniform1f(u.Aspect, signals.aspect(s, pair.marker, start + pair.marker.at % R.CHUNK));
        draw(pair[pass]);
      }
      function drawCab(pass) {
        gl.uniform3f(u.Origin,trackX,0,0); gl.uniform2f(u.Rotation,cs,sn);
        gl.uniform1f(u.Cab,1); gl.uniform1f(u.Station,0); gl.uniform1f(u.Outdoor,exposure);
        gl.uniform1f(u.GuardLamp,guardLamp);
        gl.uniform1f(u.Door,door); draw(cab[pass]);
      }
      for (const [i,pair] of chunks) drawChunk(i,pair,'solid');
      for (const car of traffic) {
        placeTrack(car.at, -1, Boolean(R.viaductAt(car.at)));
        gl.uniform3f(u.Origin, car.x, 0, s.position - car.at);
        gl.uniform2f(u.Rotation, car.cos, car.sin);
        draw(shuttleCars[car.car]);
      }
      if (platform) {
        const call = s.car.call.visit === platform.expected.visit ? s.car.call : platform.expected;
        if (call.boarded < call.queue.length || call.crossing) {
          passengers.writePoses(call, poses);
          gl.uniform4fv(u.Riders, poses);
          placeTrack(platform.mark, call.station, false);
          draw(riders);
        }
      }
      drawCab('solid');
      // Fill only uncovered depth, including the sky seen through a tunnel mouth.
      if (skyVisible) {
        gl.uniform1f(u.Sky,1); gl.uniform1f(u.Cab,0); gl.uniform1f(u.Outdoor,0); gl.uniform1f(u.Door,0);
        gl.uniform3fv(u.Origin,eye); gl.uniform2f(u.Rotation,1,0);
        draw(sky); gl.uniform1f(u.Sky,0);
      }
      gl.enable(gl.BLEND); gl.depthMask(false);
      for (let i=center+10;i>=center;i--) drawChunk(i,chunks.get(i),'glass');
      for (let i=center-3;i<center;i++) drawChunk(i,chunks.get(i),'glass');
      drawCab('glass'); gl.depthMask(true); gl.disable(gl.BLEND);
    }
    return { render, cancelPreparation };
  }
  Nightline.renderer = { createRenderer };
})();
