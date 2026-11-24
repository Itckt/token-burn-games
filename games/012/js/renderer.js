(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const dep = name => common ? require("./" + name + ".js") : root.OrbitAtlas[name];
  const M = dep("math"), G = dep("geometry"), textures = dep("surfaces"), shaders = dep("shaders");
  const { orbits } = dep("physics"), { bodies, planets, sun, moon, byId } = dep("catalog");
  const { shape: lunarShape, moonMatrix } = dep("lunar");
  const { celestialNorth } = dep("sky");
  const { APSIDES } = dep("observations");
  const air = {
    sun: [0, 0, 0], moon: [0, 0, 0], mercury: [0, 0, 0], venus: [0.23, 0.16, 0.08], earth: [0.24, 0.54, 0.85],
    mars: [0.19, 0.09, 0.04], jupiter: [0.17, 0.15, 0.12], saturn: [0.18, 0.16, 0.11],
    uranus: [0.18, 0.32, 0.33], neptune: [0.12, 0.25, 0.46]
  };
  const studioLight = M.normalize([-0.68, 0.69, 0.64]);
  const origin = [0, 0, 0], identity = M.bodyMatrix(origin, 1);
  function rotatingModel(body, days, position, radius) {
    const spin = M.wrap(days, Math.abs(body.spinDays)) / body.spinDays * M.TAU;
    const tilted = M.bodyMatrix(body.id === "saturn" ? origin : position, radius, M.radians(body.tilt), spin);
    // Saturn's pole has a fixed azimuth as the surface rotates beneath the rings.
    return body.id === "saturn" ? M.multiply(M.bodyMatrix(position, 1, 0, -0.88), tilted) : tilted;
  }
  const sectorColors = {
    perihelion: { fill: [1, 0.64, 0.32, 0.23], edge: [1, 0.64, 0.32, 0.78] },
    aphelion: { fill: [0.46, 0.72, 1, 0.23], edge: [0.46, 0.72, 1, 0.78] }
  };

  function program(gl, sources) {
    const handle = gl.createProgram();
    const compiled = [];
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, sources.vertex], [gl.FRAGMENT_SHADER, sources.fragment]]) {
        const shader = gl.createShader(type);
        compiled.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || "Shader compilation failed");
        gl.attachShader(handle, shader);
      }
      gl.bindAttribLocation(handle, 0, "aPosition");
      gl.bindAttribLocation(handle, 1, "aData");
      gl.linkProgram(handle);
      if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(handle) || "Shader linking failed");
    } catch (error) {
      gl.deleteProgram(handle);
      throw error;
    } finally {
      compiled.forEach(shader => gl.deleteShader(shader));
    }
    const uniforms = new Map();
    return { handle, at(name) {
      if (!uniforms.has(name)) uniforms.set(name, gl.getUniformLocation(handle, name));
      return uniforms.get(name);
    } };
  }

  function buffer(gl, target, data, usage = gl.STATIC_DRAW) {
    const handle = gl.createBuffer();
    gl.bindBuffer(target, handle);
    gl.bufferData(target, data, usage);
    return handle;
  }
  function mesh(gl, source) {
    return { vertex: buffer(gl, gl.ARRAY_BUFFER, source.vertices),
      index: buffer(gl, gl.ELEMENT_ARRAY_BUFFER, source.indices), count: source.indices.length };
  }
  function pathBuffer(gl, data) {
    return { buffer: buffer(gl, gl.ARRAY_BUFFER, data), count: data.length / 3 };
  }
  function vertices(gl, handle, size, extra = 0) {
    const stride = (size + extra) * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, handle);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, size, gl.FLOAT, false, stride, 0);
    if (extra) {
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, extra, gl.FLOAT, false, stride, size * 4);
    } else gl.disableVertexAttribArray(1);
  }
  function drawMesh(gl, shape) {
    vertices(gl, shape.vertex, 3, 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, shape.index);
    gl.drawElements(gl.TRIANGLES, shape.count, gl.UNSIGNED_SHORT, 0);
  }
  function upload(gl, bitmap) {
    const handle = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, handle);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, bitmap.width, bitmap.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bitmap.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    return handle;
  }

  class Renderer {
    constructor(canvas, portrait = false) {
      this.canvas = canvas;
      const gl = canvas.getContext("webgl", { alpha: portrait, antialias: true, depth: true, premultipliedAlpha: true });
      if (!gl) throw new Error("WebGL is unavailable");
      this.gl = gl;
      this.programs = {};
      const names = portrait ? ["body", "rings"] : Object.keys(shaders);
      for (const name of names) this.programs[name] = program(gl, shaders[name]);
      this.sphere = mesh(gl, G.sphere());
      this.ring = mesh(gl, G.ring());
      this.textures = new Map();
      if (!portrait) {
        this.quad = buffer(gl, gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]));
        this.tracks = new Map();
        this.sectors = new Map();
        this.trails = [];
        this.lunarTrack = pathBuffer(gl, G.orbitPath(lunarShape, 1, 128));
        for (const body of planets) {
          const orbit = orbits[body.id];
          this.tracks.set(body.id, pathBuffer(gl, G.orbitPath(orbit, body.track)));
          this.sectors.set(body.id, Object.keys(APSIDES).map(kind => ({
            ...pathBuffer(gl, G.apsisSector(orbit, body.track, kind)), ...sectorColors[kind]
          })));
        }
        this.stars = this.pointBuffer(G.stars());
        this.asteroids = this.pointBuffer(G.asteroidBelt());
        this.dust = upload(gl, textures.dustMap());
      }
      gl.clearColor(0, 0, 0, portrait ? 0 : 1);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
    }
    pointBuffer(data) {
      return { buffer: buffer(this.gl, this.gl.ARRAY_BUFFER, data), count: data.length / 5 };
    }
    use(name) {
      const p = this.programs[name];
      this.gl.useProgram(p.handle);
      return p;
    }
    resize(width, height, ratio = 1) {
      const density = Math.min(ratio, 2, Math.sqrt(2400000 / Math.max(1, width * height)));
      const w = Math.max(1, Math.round(width * density)), h = Math.max(1, Math.round(height * density));
      if (this.canvas.width !== w) this.canvas.width = w;
      if (this.canvas.height !== h) this.canvas.height = h;
      this.ratio = density;
      this.gl.viewport(0, 0, w, h);
    }
    alphaBlend() {
      const gl = this.gl;
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    sphereBody(body, model, view, light, eyepiece = false) {
      const gl = this.gl, p = this.use("body");
      if (!this.textures.has(body.id)) this.textures.set(body.id, upload(gl, textures.textureFor(body.id)));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.textures.get(body.id));
      gl.uniform1i(p.at("uSurface"), 0);
      gl.uniformMatrix4fv(p.at("uVP"), false, view.matrix);
      gl.uniformMatrix4fv(p.at("uModel"), false, model);
      gl.uniform3fv(p.at("uEye"), view.eye);
      gl.uniform3fv(p.at("uLight"), light);
      gl.uniform3fv(p.at("uPole"), M.normalize([model[4], model[5], model[6]]));
      gl.uniform3fv(p.at("uAir"), air[body.id]);
      gl.uniform1f(p.at("uStar"), body.id === "sun" ? 1 : 0);
      gl.uniform1f(p.at("uRinged"), body.id === "saturn" ? 1 : 0);
      gl.uniform1f(p.at("uEyepiece"), eyepiece ? 1 : 0);
      drawMesh(gl, this.sphere);
    }
    drawRings(model, center, radius, view, light) {
      const gl = this.gl, p = this.use("rings");
      gl.uniformMatrix4fv(p.at("uVP"), false, view.matrix);
      gl.uniformMatrix4fv(p.at("uModel"), false, model);
      gl.uniform3fv(p.at("uLight"), light);
      gl.uniform3fv(p.at("uCenter"), center);
      gl.uniform1f(p.at("uRadius"), radius);
      gl.disable(gl.CULL_FACE);
      this.alphaBlend();
      drawMesh(gl, this.ring);
      gl.disable(gl.BLEND);
    }
    points(group, view, sky) {
      const gl = this.gl, p = this.use("points");
      gl.uniformMatrix4fv(p.at("uVP"), false, view.matrix);
      gl.uniform1f(p.at("uSky"), sky ? 1 : 0);
      gl.uniform1f(p.at("uRatio"), this.ratio);
      vertices(gl, group.buffer, 3, 2);
      gl.drawArrays(gl.POINTS, 0, group.count);
    }
    orbitGuides(states, view, options) {
      const gl = this.gl;
      const sectors = options.sweeps && this.sectors.get(options.selected);
      if (sectors || options.orbits) {
        const p = this.use("path");
        gl.uniformMatrix4fv(p.at("uVP"), false, view.matrix);
        gl.uniformMatrix4fv(p.at("uModel"), false, identity);
        if (sectors) {
          for (const sector of sectors) {
            vertices(gl, sector.buffer, 3);
            gl.uniform4fv(p.at("uColor"), sector.fill);
            gl.drawArrays(gl.TRIANGLE_FAN, 0, sector.count - 1);
            gl.uniform4fv(p.at("uColor"), sector.edge);
            gl.drawArrays(gl.LINE_STRIP, 0, sector.count);
          }
        }
        if (options.orbits) {
          for (const [id, track] of this.tracks) {
            gl.uniform4fv(p.at("uColor"), id === options.selected
              ? [0.95, 0.60, 0.33, 0.80] : [0.57, 0.66, 0.70, 0.42]);
            vertices(gl, track.buffer, 3);
            gl.drawArrays(gl.LINE_LOOP, 0, track.count);
          }
          if (options.moon) {
            gl.uniformMatrix4fv(p.at("uModel"), false, options.moon.guide);
            gl.uniform4fv(p.at("uColor"), [0.68, 0.78, 0.94, 0.72]);
            vertices(gl, this.lunarTrack.buffer, 3);
            gl.drawArrays(gl.LINE_LOOP, 0, this.lunarTrack.count);
          }
        }
      }
      if (options.linkTarget) {
        const p = this.use("link");
        gl.uniformMatrix4fv(p.at("uVP"), false, view.matrix);
        gl.uniform3fv(p.at("uFrom"), states[options.selected].position);
        gl.uniform3fv(p.at("uTo"), states[options.linkTarget].position);
        vertices(gl, this.quad, 2);
        gl.drawArrays(gl.LINES, 0, 2);
      }
    }
    motionTrails(from, to, day, duration, view) {
      const gl = this.gl, p = this.use("trail");
      gl.uniformMatrix4fv(p.at("uVP"), false, view.matrix);
      gl.uniform1f(p.at("uRatio"), this.ratio);
      for (const [i, id] of [from, to].entries()) {
        if (!Object.hasOwn(orbits, id)) continue;
        const track = this.trails[i] ||= { vertices: new Float32Array(G.TRAIL_FLOATS) };
        if (track.id !== id || track.day !== day || track.duration !== duration) {
          G.writeMotionTrail(track.vertices, orbits[id], byId[id].track, day, duration);
          if (track.buffer) {
            gl.bindBuffer(gl.ARRAY_BUFFER, track.buffer);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, track.vertices);
          } else track.buffer = buffer(gl, gl.ARRAY_BUFFER, track.vertices, gl.DYNAMIC_DRAW);
          Object.assign(track, { id, day, duration });
        }
        vertices(gl, track.buffer, 3, 2);
        gl.uniform3fv(p.at("uTint"), i === 0 ? [1, 0.71, 0.40] : [0.42, 0.91, 0.82]);
        gl.drawArrays(gl.LINE_STRIP, 0, G.TRAIL_STEPS + 1);
        gl.drawArrays(gl.POINTS, G.TRAIL_STEPS + 1, G.TRAIL_MARKS);
      }
    }
    scene(states, days, view, options) {
      const gl = this.gl;
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      const sky = this.use("sky");
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.dust);
      gl.uniform1i(sky.at("uDust"), 0);
      vertices(gl, this.quad, 2);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.depthMask(false);
      this.alphaBlend();
      this.points(this.stars, view, true);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);

      let saturnModel, saturnLight;
      for (const body of bodies) {
        const pos = states[body.id].position;
        const model = rotatingModel(body, days, pos, body.radius);
        const light = body.id === "sun" ? studioLight : M.normalize(M.scale(pos, -1));
        if (body.id === "saturn") { saturnModel = model; saturnLight = light; }
        this.sphereBody(body, model, view, light);
      }
      if (options.moon) this.sphereBody(moon, options.moon.model, view, options.moon.light);
      gl.disable(gl.CULL_FACE);
      gl.depthMask(false);
      this.alphaBlend();
      this.orbitGuides(states, view, options);
      if (options.trailDays > 0) this.motionTrails(options.selected, options.destination, days, options.trailDays, view);
      this.points(this.asteroids, view, false);
      const glow = this.use("glow");
      gl.uniformMatrix4fv(glow.at("uVP"), false, view.matrix);
      const size = sun.radius * 6;
      gl.uniform2f(glow.at("uSize"), size * view.projection[0], size * view.projection[5]);
      gl.blendFunc(gl.ONE, gl.ONE);
      vertices(gl, this.quad, 2);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this.drawRings(saturnModel, states.saturn.position, byId.saturn.radius, view, saturnLight);
      gl.depthMask(true);
    }
    portrait(body, width, height, ratio = 1) {
      this.resize(width, height, ratio);
      const aspect = width / height;
      const halfHeight = Math.max(1.14, (body.id === "saturn" ? 2.38 : 1.17) / aspect);
      const distance = halfHeight / Math.tan(M.radians(12)) + 0.10;
      const eye = M.scale(M.normalize([0.12, body.id === "saturn" ? 0.48 : 0.23, 1]), distance);
      const view = { eye, matrix: M.multiply(M.perspective(M.radians(24), aspect, 0.1, Math.max(30, distance + 5)),
        M.lookAt(eye, origin)) };
      const model = M.bodyMatrix(origin, 1, M.radians(body.tilt), body.id === "earth" ? -0.26 : 0.23);
      this.drawGlobe(body, model, view, studioLight, false);
    }
    eyepiece(body, days, observation, width, height, ratio = 1) {
      this.resize(width, height, ratio);
      // Parallel rays keep the projected terminator and disk fraction consistent with the readout.
      const aspect = width / height, extent = body.id === "saturn" ? 2.42 : 1.13;
      const halfHeight = extent / Math.min(1, aspect);
      const projection = M.orthographic(halfHeight, aspect, 0.5, 9.5);
      const eye = M.scale(observation.eye, 5);
      const view = { eye, matrix: M.multiply(projection, M.lookAt(eye, origin, celestialNorth)) };
      const model = body === moon ? moonMatrix(observation.lunar, origin, 1) : rotatingModel(body, days, origin, 1);
      this.drawGlobe(body, model, view, body === sun ? studioLight : observation.light, true);
    }
    drawGlobe(body, model, view, light, eyepiece) {
      const gl = this.gl;
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      this.sphereBody(body, model, view, light, eyepiece);
      if (body.id === "saturn") this.drawRings(model, origin, 1, view, light);
    }
  }

  const api = { program, Renderer };
  if (common) module.exports = api;
  else (root.OrbitAtlas ||= {}).renderer = api;
})(globalThis);
