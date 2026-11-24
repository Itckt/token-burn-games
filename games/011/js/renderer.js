(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const math = common ? require("./math.js") : root.Isobar.math;
  const storm = common ? require("./storm.js") : root.Isobar.storm;
  const field = common ? require("./field.js") : root.Isobar.field;
  const relief = common ? require("./relief.js") : root.Isobar.relief;
  const doppler = common ? require("./doppler.js") : root.Isobar.doppler;
  const lighting = common ? require("./lighting.js") : root.Isobar.lighting;
  const section = common ? require("./section.js") : root.Isobar.section;
  const geometry = common ? require("./geometry.js") : root.Isobar.geometry;
  const textures = common ? require("./textures.js") : root.Isobar.textures;
  const shaders = common ? require("./shaders.js") : root.Isobar.shaders;
  const ZERO = { x: 0, z: 0 };
  let oceanPixels, cloudPixels, pressureMesh;

  function resolution(width, height, pixelRatio) {
    const w = Math.max(1, width), h = Math.max(1, height);
    const ratio = Math.min(pixelRatio || 1, 1.75, Math.sqrt(1500000 / (w * h)));
    return [Math.max(1, Math.round(w * ratio)), Math.max(1, Math.round(h * ratio))];
  }

  function makeRenderer(canvas) {
    const options = { alpha: false, antialias: true, depth: true, stencil: false, powerPreference: "high-performance" };
    const gl = canvas.getContext("webgl", options) || canvas.getContext("experimental-webgl", options);
    if (!gl) throw new Error("WebGL is unavailable");
    const buffers = [], programs = [], textureObjects = [];
    const enabled = new Set();
    let disposed = false;

    function disableAttributes() {
      for (const index of enabled) gl.disableVertexAttribArray(index);
      enabled.clear();
    }

    function dispose() {
      if (disposed) return;
      disposed = true;
      disableAttributes();
      for (const buffer of buffers) gl.deleteBuffer(buffer);
      for (const program of programs) gl.deleteProgram(program);
      for (const texture of textureObjects) gl.deleteTexture(texture);
    }

    function link(source, attributes, uniforms) {
      const program = gl.createProgram();
      programs.push(program);
      const stages = [];
      try {
        for (const [type, code] of [[gl.VERTEX_SHADER, source.vertex], [gl.FRAGMENT_SHADER, source.fragment]]) {
          const shader = gl.createShader(type);
          stages.push(shader);
          gl.shaderSource(shader, code);
          gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Shader compilation failed");
          gl.attachShader(program, shader);
        }
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Shader link failed");
      } finally {
        for (const shader of stages) gl.deleteShader(shader);
      }
      const p = { program };
      for (const name of attributes.split(" ")) p[name] = gl.getAttribLocation(program, name);
      for (const name of uniforms.split(" ")) p[name] = gl.getUniformLocation(program, name);
      return p;
    }

    function buffer(target, data, usage) {
      const b = gl.createBuffer();
      buffers.push(b);
      gl.bindBuffer(target, b);
      gl.bufferData(target, data, usage);
      return b;
    }

    function texture(source, wrap, mipmaps = true) {
      const tex = gl.createTexture();
      textureObjects.push(tex);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
      return tex;
    }

    function sampler(uniform, tex) {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uniform, 0);
    }

    function use(p) {
      disableAttributes();
      gl.useProgram(p.program);
    }

    function attribute(index, b, count, stride = 0, offset = 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.enableVertexAttribArray(index);
      enabled.add(index);
      gl.vertexAttribPointer(index, count, gl.FLOAT, false, stride * 4, offset * 4);
    }

    try {
      const surfaceUniforms = "uVP uGrid uPixel uTransect uRelease uArrival ";
      const flatUniforms = surfaceUniforms + "uHeight uExtent ";
      const sea = link(shaders.sea, "aPlane", flatUniforms + "uNoise uWater uLit uLightDir uEye uContrast");
      const radar = link(shaders.radar, "aPlane", flatUniforms + "uPhase uStrength uScale uRain uSweep uEcho");
      const velocity = link(shaders.doppler, "aPlane", flatUniforms + "uScale uPeakWind uSite");
      const wind = link(shaders.wind, "aPlane", flatUniforms + "uScale uPeakWind uPulse");
      const pressure = link(shaders.pressure, "aPlane", surfaceUniforms + "uScale uCentral");
      const surfaces = { cloud: sea, radar, doppler: velocity, wind, pressure };
      const deck = link(shaders.deck, "aPlane", "uVP uHeight uExtent uStrength uPhase uNoise uCut uContrast uLightDir uShadow uLit");
      const cloud = link(shaders.cloud, "aCorner aProfile aCenter aTangent", "uVP uRight uUp uSun uStrength uAtlas uCut uIncident uShadow uLit");
      const rain = link(shaders.rain, "aPosition aBrightness", "uVP uStrength uCut uRainColor");
      const seaNoise = texture(oceanPixels ||= textures.oceanNoise(), gl.REPEAT);
      const cloudTexture = texture(cloudPixels ||= textures.cloudAtlas(), gl.CLAMP_TO_EDGE);
      let echoTexture = null;
      const floor = buffer(gl.ARRAY_BUFFER, geometry.plane(), gl.STATIC_DRAW);
      let reliefBuffers;
      const clouds = storm.makeClouds(), drops = storm.makeRain();
      const mesh = geometry.billboards(clouds);
      const profileBuffer = buffer(gl.ARRAY_BUFFER, mesh.profiles, gl.STATIC_DRAW);
      const cloudPositions = new Float32Array(clouds.length * 20);
      const cloudBuffer = buffer(gl.ARRAY_BUFFER, cloudPositions.byteLength, gl.DYNAMIC_DRAW);
      const indexBuffer = buffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.DYNAMIC_DRAW);
      const rainPositions = new Float32Array(drops.length * 6);
      const rainBuffer = buffer(gl.ARRAY_BUFFER, rainPositions.byteLength, gl.DYNAMIC_DRAW);
      const brightness = new Float32Array(drops.length * 2);
      drops.forEach((drop, i) => { brightness[i * 2] = 0.55 + 0.45 * drop.brightness; brightness[i * 2 + 1] = 0.09; });
      const brightnessBuffer = buffer(gl.ARRAY_BUFFER, brightness, gl.STATIC_DRAW);
      const depths = new Float32Array(clouds.length), order = [];
      let lastSort = -Infinity, sortDirection = [0, 0, 0];
      let cloudPhase = -1, cloudStrength = -1, rainPhase = -1, rainTravel = -1, rainStrength = -1;
      let light, lightMinutes;

      function update(bufferObject, target, data, end) {
        gl.bindBuffer(target, bufferObject);
        gl.bufferSubData(target, 0, data.subarray(0, end));
      }

      function plane(p, frame, extent, height) {
        use(p);
        attribute(p.aPlane, floor, 2);
        gl.uniformMatrix4fv(p.uVP, false, frame.vp);
        gl.uniform1f(p.uExtent, extent);
        gl.uniform1f(p.uHeight, height);
      }

      function drawSurface(state, frame, p, axis) {
        if (p === pressure) {
          if (!reliefBuffers) {
            const terrain = pressureMesh ||= relief.mesh();
            reliefBuffers = { vertices: buffer(gl.ARRAY_BUFFER, terrain.positions, gl.STATIC_DRAW),
              indices: buffer(gl.ELEMENT_ARRAY_BUFFER, terrain.indices, gl.STATIC_DRAW), count: terrain.indices.length };
          }
          use(p);
          attribute(p.aPlane, reliefBuffers.vertices, 2);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, reliefBuffers.indices);
          gl.uniformMatrix4fv(p.uVP, false, frame.vp);
        } else {
          plane(p, frame, 145, 0);
        }
        const launch = state.drift?.launch || ZERO, end = state.drift?.end || ZERO;
        gl.uniform2f(p.uRelease, launch.x, launch.z);
        gl.uniform3f(p.uArrival, end.x, end.z, state.drift ? 1 : 0);
        gl.uniform3f(p.uTransect, axis.x, axis.z, (state.section?.distance || 0) / field.KM_PER_UNIT);
        gl.uniform1f(p.uGrid, state.layers.grid ? 1 : 0);
        gl.uniform1f(p.uPixel, 2 * frame.distance * Math.tan(math.FOV / 2) / Math.max(1, canvas.height));
        if (p !== sea) gl.uniform1f(p.uScale, storm.radialScale(state.strength));
        if (p === radar) {
          if (!echoTexture) echoTexture = texture(field.echoMap(), gl.CLAMP_TO_EDGE, false);
          sampler(p.uEcho, echoTexture);
          gl.uniform1f(p.uPhase, state.phase);
          gl.uniform1f(p.uStrength, state.strength);
          gl.uniform1f(p.uRain, storm.readings(state.strength, state.time).rain);
          gl.uniform1f(p.uSweep, state.time % 8 * math.TAU / 8);
        } else if (p === wind || p === velocity) {
          gl.uniform1f(p.uPeakWind, storm.readings(state.strength, state.time).wind);
          if (p === wind) gl.uniform1f(p.uPulse, (state.rainTravel % 2) / 2);
          else {
            const site = doppler.site(state);
            gl.uniform2f(p.uSite, site.x, site.z);
          }
        } else if (p === pressure) {
          gl.uniform1f(p.uCentral, storm.readings(state.strength, state.time).pressure);
          gl.drawElements(gl.TRIANGLES, reliefBuffers.count, gl.UNSIGNED_SHORT, 0);
          return;
        } else {
          gl.uniform3fv(p.uWater, light.water);
          gl.uniform3fv(p.uLit, light.lit);
          gl.uniform3fv(p.uLightDir, light.direction);
          gl.uniform3fv(p.uEye, frame.eye);
          gl.uniform1f(p.uContrast, light.contrast);
          sampler(p.uNoise, seaNoise);
        }
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      function drawRain(state, frame, cut) {
        const count = storm.rainCount(state.strength);
        if (state.rainTravel !== rainTravel || state.strength !== rainStrength || state.phase !== rainPhase) {
          for (let i = 0; i < count; i++) storm.rainPose(drops[i], state, rainPositions, i * 6);
          update(rainBuffer, gl.ARRAY_BUFFER, rainPositions, count * 6);
          rainTravel = state.rainTravel;
          rainStrength = state.strength;
          rainPhase = state.phase;
        }
        use(rain);
        gl.uniform2f(rain.uCut, cut.x, cut.z);
        attribute(rain.aPosition, rainBuffer, 3);
        attribute(rain.aBrightness, brightnessBuffer, 1);
        gl.uniformMatrix4fv(rain.uVP, false, frame.vp);
        gl.uniform1f(rain.uStrength, state.strength);
        gl.uniform3fv(rain.uRainColor, light.rain);
        gl.drawArrays(gl.LINES, 0, count * 2);
      }

      function drawClouds(state, frame, cut) {
        const count = storm.cloudCount(state.strength);
        const poseChanged = state.phase !== cloudPhase || state.strength !== cloudStrength;
        if (poseChanged) {
          for (let i = 0; i < count; i++) {
            const offset = i * 20;
            storm.cloudPose(clouds[i], state.phase, state.strength, cloudPositions, offset);
            cloudPositions.copyWithin(offset + 5, offset, offset + 5);
            cloudPositions.copyWithin(offset + 10, offset, offset + 10);
          }
          update(cloudBuffer, gl.ARRAY_BUFFER, cloudPositions, count * 20);
          cloudPhase = state.phase;
          cloudStrength = state.strength;
        }
        // Alpha blending requires far-to-near order. Reuse the ordering between
        // small camera/particle movements and upload only the visible prefix.
        const sinceSort = state.time - lastSort;
        const frozenChange = !state.playing && (poseChanged || sinceSort !== 0);
        const turned = math.dot(frame.back, sortDirection) < (state.playing ? 0.9998 : 1 - 1e-12);
        if (order.length !== count || sinceSort < 0 || sinceSort > 0.13 || frozenChange || turned) {
          order.length = count;
          for (let i = 0; i < count; i++) {
            const o = i * 20;
            depths[i] = cloudPositions[o] * frame.back[0] + cloudPositions[o + 1] * frame.back[1] + cloudPositions[o + 2] * frame.back[2];
            order[i] = i;
          }
          order.sort((a, b) => depths[a] - depths[b]);
          geometry.writeIndices(mesh.indices, order);
          update(indexBuffer, gl.ELEMENT_ARRAY_BUFFER, mesh.indices, count * 6);
          lastSort = state.time;
          sortDirection = frame.back;
        }
        use(cloud);
        gl.uniform2f(cloud.uCut, cut.x, cut.z);
        attribute(cloud.aCorner, profileBuffer, 2, 6);
        attribute(cloud.aProfile, profileBuffer, 4, 6, 2);
        attribute(cloud.aCenter, cloudBuffer, 3, 5);
        attribute(cloud.aTangent, cloudBuffer, 2, 5, 3);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        sampler(cloud.uAtlas, cloudTexture);
        gl.uniformMatrix4fv(cloud.uVP, false, frame.vp);
        gl.uniform3fv(cloud.uRight, frame.right);
        gl.uniform3fv(cloud.uUp, frame.up);
        gl.uniform3fv(cloud.uShadow, light.shadow);
        gl.uniform3fv(cloud.uLit, light.lit);
        gl.uniform3fv(cloud.uIncident, light.incident);
        gl.uniform3f(cloud.uSun, math.dot(light.incident, frame.right), math.dot(light.incident, frame.up),
          math.dot(light.incident, frame.back));
        gl.uniform1f(cloud.uStrength, state.strength);
        gl.drawElements(gl.TRIANGLES, count * 6, gl.UNSIGNED_SHORT, 0);
      }

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0.043, 0.071, 0.090, 1);
      gl.activeTexture(gl.TEXTURE0);

      function resize(width, height, dpr) {
        const [w, h] = resolution(width, height, dpr);
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        gl.viewport(0, 0, w, h);
      }

      function drawScene(state, frame, surface, axis) {
        if (surface === sea && (!light || lightMinutes !== state.lightMinutes)) {
          lightMinutes = state.lightMinutes;
          light = lighting.at(lightMinutes);
        }
        if (surface === pressure) {
          gl.enable(gl.DEPTH_TEST);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        } else {
          gl.disable(gl.DEPTH_TEST);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.disable(gl.BLEND);
        drawSurface(state, frame, surface, axis);
        if (surface !== sea) return;
        const cut = axis === ZERO ? ZERO : section.nearNormal(axis, frame.back);
        gl.enable(gl.BLEND);
        if (state.layers.rain) drawRain(state, frame, cut);
        if (state.layers.clouds) {
          plane(deck, frame, 13.2, 0.78);
          gl.uniform2f(deck.uCut, cut.x, cut.z);
          sampler(deck.uNoise, seaNoise);
          gl.uniform1f(deck.uPhase, state.phase);
          gl.uniform1f(deck.uStrength, state.strength);
          gl.uniform3fv(deck.uShadow, light.shadow);
          gl.uniform3fv(deck.uLit, light.lit);
          gl.uniform3fv(deck.uLightDir, light.direction);
          gl.uniform1f(deck.uContrast, light.contrast);
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          drawClouds(state, frame, cut);
        }
      }

      function render(state, frame) {
        if (disposed) return;
        const surface = surfaces[state.imagery] || sea;
        const axis = state.section?.enabled ? section.axis(state.section.bearing) : ZERO;
        if (!state.comparing || surface === sea) { drawScene(state, frame, surface, axis); return; }
        // Both halves use the full viewport projection. Only fragment coverage
        // and clears are clipped, so features line up at every divider position.
        const split = math.splitColumn(canvas.width, state.cloudPercent);
        gl.enable(gl.SCISSOR_TEST);
        try {
          if (split > 0) {
            gl.scissor(0, 0, split, canvas.height);
            drawScene(state, frame, sea, axis);
          }
          if (split < canvas.width) {
            gl.scissor(split, 0, canvas.width - split, canvas.height);
            drawScene(state, frame, surface, axis);
          }
        } finally {
          gl.disable(gl.SCISSOR_TEST);
        }
      }
      return { render, resize, dispose };
    } catch (error) {
      dispose();
      throw error;
    }
  }
  const api = { makeRenderer, resolution };
  if (common) module.exports = api;
  else (root.Isobar ||= {}).renderer = api;
})(globalThis);
