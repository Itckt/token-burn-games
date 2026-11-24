(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./math"), require("./terrain"), require("./meshes"), require("./simulation"), require("./shaders"), require("./observatory"));
  } else {
    const a = root.FieldAtlas;
    a.createRenderer = factory(a.math, a.terrain, a.meshes, a.sim, a.shaders, a.observatory);
  }
})(globalThis, function (M, T, G, S, shaders, O) {
  "use strict";
  const SHADOW_SIZE = 512;
  function createRenderer(canvas) {
    const gl = canvas.getContext("webgl", { alpha: false, antialias: true, depth: true,
      preserveDrawingBuffer: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL is unavailable. Enable graphics acceleration in your browser, then reload this page.");
    const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision > 0;
    function compile(type, source) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("WebGL could not allocate a graphics shader.");
      // Keep vertex transforms at full precision and match the interpolators on older GPUs.
      const compatible = highp ? source : source.replace("precision highp float", "precision mediump float")
        .replace(/\bvarying /g, "varying mediump ");
      gl.shaderSource(shader, compatible);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const message = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error("A graphics shader could not compile. " + message);
      }
      return shader;
    }
    function program(vertex, fragment) {
      const vs = compile(gl.VERTEX_SHADER, vertex);
      let fs;
      try { fs = compile(gl.FRAGMENT_SHADER, fragment); }
      catch (error) { gl.deleteShader(vs); throw error; }
      const p = gl.createProgram();
      if (!p) {
        gl.deleteShader(vs); gl.deleteShader(fs);
        throw new Error("WebGL could not allocate a graphics program.");
      }
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
      gl.deleteShader(vs); gl.deleteShader(fs);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        const message = gl.getProgramInfoLog(p);
        gl.deleteProgram(p);
        throw new Error("Could not link graphics program. " + message);
      }
      const u = {}, a = {};
      for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
        const name = gl.getActiveUniform(p, i).name;
        u[name] = gl.getUniformLocation(p, name);
      }
      for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i++) {
        const name = gl.getActiveAttrib(p, i).name;
        a[name] = gl.getAttribLocation(p, name);
      }
      const mask = Object.values(a).reduce((bits, index) => bits | (1 << index), 0);
      return { p, u, a, mask };
    }
    let land, sky, water, rain, runoff, gate, caster, screen, lake, drops;
    function buffer(data, stride) {
      const id = gl.createBuffer();
      if (!id) throw new Error("WebGL could not allocate a geometry buffer.");
      try {
        gl.bindBuffer(gl.ARRAY_BUFFER, id);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      } catch (error) {
        gl.deleteBuffer(id);
        throw error;
      }
      return { id, count: data.length / stride };
    }
    function texture(w, h, pixels, filter = gl.LINEAR) {
      const id = gl.createTexture();
      if (!id) throw new Error("WebGL could not allocate a landscape texture.");
      try {
        gl.bindTexture(gl.TEXTURE_2D, id);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      } catch (error) {
        gl.deleteTexture(id);
        throw error;
      }
      return id;
    }
    function renderTarget() {
      return { fb: gl.createFramebuffer(), depth: gl.createRenderbuffer(), tex: null, w: 0, h: 0, ok: false };
    }
    function releaseTarget(target) {
      if (target?.fb) gl.deleteFramebuffer(target.fb);
      if (target?.depth) gl.deleteRenderbuffer(target.depth);
      if (target?.tex) gl.deleteTexture(target.tex);
    }
    function sizeTarget(target, w, h, filter) {
      target.w = w; target.h = h;
      if (target.tex) gl.deleteTexture(target.tex);
      target.tex = null;
      target.ok = false;
      if (!target.fb || !target.depth) return;
      try {
        target.tex = texture(w, h, null, filter);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.tex, 0);
        gl.bindRenderbuffer(gl.RENDERBUFFER, target.depth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, target.depth);
        target.ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      } catch {
        // Both optical effects have a complete, ordinary-lighting fallback.
        target.ok = false;
      } finally {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      if (!target.ok && target.tex) { gl.deleteTexture(target.tex); target.tex = null; }
    }
    let mirror, shadow, shadowSun, reflectedShadowVP;
    let scene = null, mirrorStamp = -100, mirrorPose = [], mirrorTrees = false, mirrorLevel, mirrorProbe, mirrorGate, disposed = false;
    function releaseScene(batch) {
      if (!batch) return;
      for (const mesh of [batch.ground, batch.trees, batch.rocks, batch.ranges, batch.runoff, batch.gates, batch.buoys]) {
        if (mesh) gl.deleteBuffer(mesh.id);
      }
      if (batch.tex) gl.deleteTexture(batch.tex);
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      releaseScene(scene);
      scene = null;
      for (const mesh of [screen, lake, drops]) if (mesh) gl.deleteBuffer(mesh.id);
      for (const shader of [land, sky, water, rain, runoff, gate, caster]) if (shader) gl.deleteProgram(shader.p);
      releaseTarget(mirror);
      releaseTarget(shadow);
    }
    function loadWorld(world, grid, items) {
      const baked = G.landscapeTexture(grid, items.trees);
      const next = { style: world.style, heightRange: T.heightRange(grid) };
      try {
        next.ground = buffer(G.land(world, grid), G.STRIDE);
        next.trees = buffer(G.forest(world, items.trees), G.STRIDE);
        next.rocks = buffer(G.stones(world, items.rocks), G.STRIDE);
        next.ranges = buffer(G.horizon(world), G.STRIDE);
        next.tex = texture(baked.size, baked.size, baked.data);
      } catch (error) {
        releaseScene(next);
        throw error;
      }
      releaseScene(scene);
      scene = next;
      shadowSun = null;
      mirrorStamp = -100;
    }
    function setOverlay(name, source, build, stride) {
      source ??= null;
      if (!scene || (scene[name]?.source ?? null) === source) return;
      const next = source ? buffer(build(source), stride) : null;
      if (next) next.source = source;
      if (scene[name]) gl.deleteBuffer(scene[name].id);
      scene[name] = next;
      mirrorStamp = -100;
    }
    function setRunoff(grid, points) {
      setOverlay("runoff", points, path => G.runoffRibbon(grid, path), 5);
    }
    function setGates(gates) {
      setOverlay("gates", gates, G.relayGates, 6);
    }
    function setPassage(passage) {
      setOverlay("buoys", passage, G.passageBuoys, G.STRIDE);
    }
    function resize(w, h) {
      w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
      if (canvas.width === w && canvas.height === h && mirror.w) return;
      canvas.width = w; canvas.height = h;
      const scale = Math.min(0.6, 640 / Math.max(w, h));
      sizeTarget(mirror, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)), gl.LINEAR);
      mirrorStamp = -100;
    }
    let mask = 0;
    function use(prog) {
      gl.useProgram(prog.p);
      for (let i = 0, changed = (prog.mask ^ mask) >>> 0; changed; i++, changed >>>= 1) {
        if (changed & 1) {
          if (prog.mask & (1 << i)) gl.enableVertexAttribArray(i);
          else gl.disableVertexAttribArray(i);
        }
      }
      mask = prog.mask;
    }
    function atmosphere(u, light, eye, weather) {
      gl.uniform3fv(u.uSun, light.sun); gl.uniform1f(u.uDay, light.day);
      gl.uniform2f(u.uWeather, weather[0], weather[1]);
      if (u.uWarm) gl.uniform1f(u.uWarm, light.warmth);
      if (u.uHigh) gl.uniform3fv(u.uHigh, light.high);
      gl.uniform3fv(u.uLow, light.low);
      if (u.uEye) gl.uniform3fv(u.uEye, eye);
    }
    function prepareShadow(sun) {
      if (!shadow) {
        shadow = renderTarget();
        sizeTarget(shadow, SHADOW_SIZE, SHADOW_SIZE, gl.NEAREST);
        if (shadow.ok) {
          try { caster = program(shaders.shadowVertex, shaders.shadowFragment); }
          catch { shadow.ok = false; }
        }
        if (!shadow.ok) {
          releaseTarget(shadow);
          shadow = { ok: false };
        }
      }
      if (!shadow.ok) return false;
      if (shadowSun && M.dot(sun, shadowSun) > Math.cos(0.0015)) return true;
      shadowSun = sun;
      shadow.vp = O.lightProjection(scene.heightRange, sun);
      gl.bindFramebuffer(gl.FRAMEBUFFER, shadow.fb);
      gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
      gl.clearColor(1, 1, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.disable(gl.CULL_FACE); gl.disable(gl.DITHER);
      use(caster);
      gl.uniformMatrix4fv(caster.u.uLightVP, false, shadow.vp);
      gl.bindBuffer(gl.ARRAY_BUFFER, scene.ground.id);
      gl.vertexAttribPointer(caster.a.aPosition, 3, gl.FLOAT, false, G.STRIDE * 4, 0);
      gl.drawArrays(gl.TRIANGLES, 0, scene.ground.count);
      gl.enable(gl.DITHER);
      gl.clearColor(0.66, 0.72, 0.69, 1);
      return true;
    }
    function ridgeLighting(u, frame, vp) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, frame.shadows ? shadow.tex : scene.tex);
      gl.uniform1i(u.uShadow, 2);
      gl.uniformMatrix4fv(u.uLightVP, false, frame.shadows ? shadow.vp : vp);
      gl.uniform2f(u.uShade, frame.shadeStrength, 1 / SHADOW_SIZE);
      gl.activeTexture(gl.TEXTURE0);
    }
    function opaque(vp, eye, reflected, frame) {
      const { axes, aspect, light, elapsed, trees, weather } = frame;
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.CULL_FACE); gl.frontFace(reflected ? gl.CW : gl.CCW);
      use(land);
      const { u, a } = land;
      atmosphere(u, light, eye, weather);
      ridgeLighting(u, frame, vp);
      gl.uniformMatrix4fv(u.uVP, false, vp); gl.uniform1f(u.uHalf, T.HALF);
      gl.uniform1f(u.uLevel, frame.level);
      gl.uniform1f(u.uProbe, +frame.probe);
      gl.uniform1f(u.uReflect, +reflected); gl.uniform1f(u.uForest, +trees);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene.tex); gl.uniform1i(u.uLandscape, 0);
      function draw(mesh, kind) {
        gl.uniform1f(u.uKind, kind);
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.id);
        const stride = G.STRIDE * Float32Array.BYTES_PER_ELEMENT;
        gl.vertexAttribPointer(a.aPosition, 3, gl.FLOAT, false, stride, 0);
        gl.vertexAttribPointer(a.aNormal, 3, gl.FLOAT, false, stride, 12);
        gl.vertexAttribPointer(a.aColor, 3, gl.FLOAT, false, stride, 24);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
      }
      draw(scene.ground, 0); draw(scene.rocks, 1);
      if (trees) draw(scene.trees, 1);
      if (scene.buoys && frame.water) draw(scene.buoys, 3);
      draw(scene.ranges, 2);
      gl.disable(gl.CULL_FACE);
      use(sky);
      atmosphere(sky.u, light, eye, weather);
      const flip = v => reflected ? [v[0], -v[1], v[2]] : v;
      gl.uniform3fv(sky.u.uForward, flip(axes.forward)); gl.uniform3fv(sky.u.uRight, flip(axes.right));
      gl.uniform3fv(sky.u.uUp, flip(axes.up)); gl.uniform1f(sky.u.uTime, elapsed);
      const tangent = Math.tan(S.FOV / 2);
      gl.uniform2f(sky.u.uFrustum, aspect * tangent, tangent);
      gl.bindBuffer(gl.ARRAY_BUFFER, screen.id);
      gl.vertexAttribPointer(sky.a.aPosition, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function annotations(vp, eye, reflected, frame) {
      if (scene.runoff) drawRunoff(vp, eye, reflected, frame);
      if (scene.gates) drawGates(vp, eye, frame);
    }
    function drawTransparent(count) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.drawArrays(gl.TRIANGLES, 0, count);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    function bindAnnotation(shader, vp, eye, frame) {
      use(shader);
      const { u } = shader;
      gl.uniformMatrix4fv(u.uVP, false, vp); gl.uniform3fv(u.uEye, eye);
      gl.uniform1f(u.uDensity, 0.00155 * (1 + 3.7 * frame.weather[0]));
      gl.uniform3fv(u.uHaze, frame.light.low);
      gl.uniform1f(u.uTime, frame.elapsed);
    }
    function drawGates(vp, eye, frame) {
      if (!gate) gate = program(shaders.gateVertex, shaders.gateFragment);
      bindAnnotation(gate, vp, eye, frame);
      gl.uniform1f(gate.u.uDay, frame.light.day);
      gl.uniform1f(gate.u.uNext, frame.nextGate);
      gl.bindBuffer(gl.ARRAY_BUFFER, scene.gates.id);
      gl.vertexAttribPointer(gate.a.aPosition, 3, gl.FLOAT, false, 24, 0);
      gl.vertexAttribPointer(gate.a.aRing, 3, gl.FLOAT, false, 24, 12);
      drawTransparent(scene.gates.count);
    }
    function drawRunoff(vp, eye, reflected, frame) {
      if (!runoff) runoff = program(shaders.runoffVertex, shaders.runoffFragment);
      bindAnnotation(runoff, vp, eye, frame);
      const { u, a } = runoff;
      gl.uniform3fv(u.uTint, M.mixColor([0.34, 0.67, 0.69], [0.82, 1.0, 0.94], frame.light.day));
      gl.uniform1f(u.uLevel, frame.level); gl.uniform1f(u.uReflect, +reflected);
      gl.bindBuffer(gl.ARRAY_BUFFER, scene.runoff.id);
      gl.vertexAttribPointer(a.aPosition, 3, gl.FLOAT, false, 20, 0);
      gl.vertexAttribPointer(a.aFlow, 2, gl.FLOAT, false, 20, 12);
      drawTransparent(scene.runoff.count);
    }
    function drawRain(vp, right, eye, elapsed, strength, light) {
      if (!rain) rain = program(shaders.rainVertex, shaders.rainFragment);
      if (!drops) drops = buffer(G.rainField(), 5);
      use(rain);
      gl.uniformMatrix4fv(rain.u.uVP, false, vp);
      gl.uniform3fv(rain.u.uEye, eye);
      gl.uniform3fv(rain.u.uRight, right);
      gl.uniform1f(rain.u.uTime, elapsed);
      gl.uniform1f(rain.u.uRain, strength);
      gl.uniform3fv(rain.u.uTint, M.mixColor(light.low, [0.85, 0.9, 0.91], light.day * 0.65));
      gl.bindBuffer(gl.ARRAY_BUFFER, drops.id);
      gl.vertexAttribPointer(rain.a.aPosition, 3, gl.FLOAT, false, 20, 0);
      gl.vertexAttribPointer(rain.a.aCorner, 2, gl.FLOAT, false, 20, 12);
      drawTransparent(drops.count);
    }
    const clearWeather = [0, 0];
    function render(camera, hour, elapsed, layers, weather = clearWeather) {
      if (!scene) return;
      const aspect = canvas.width / canvas.height, eye = camera.position;
      const axes = M.basis(M.direction(camera.yaw, camera.pitch)), light = S.lighting(hour);
      const level = layers.level ?? T.WATER;
      const probe = !!layers.probe, nextGate = layers.nextGate ?? 0;
      const shadows = !!layers.shadows && light.sun[1] > 0.00001 && prepareShadow(light.sun);
      const shadeStrength = shadows ? M.smoothstep(0, 0.065, light.sun[1]) * (1 - 0.82 * Math.max(...weather)) : 0;
      const frame = { axes, aspect, light, elapsed, trees: layers.trees, water: layers.water, weather, level, probe, nextGate,
        shadows, shadeStrength };
      const vp = M.multiply(M.perspective(S.FOV, aspect, 0.35, 1200), M.view(eye, axes));
      const pose = [...eye, camera.yaw * 45, camera.pitch * 45, hour * 12, weather[0] * 4, weather[1] * 4];
      const moved = pose.some((v, i) => Math.abs(v - mirrorPose[i]) > 0.08);
      const age = elapsed - mirrorStamp;
      const currentShadowVP = shadows ? shadow.vp : null;
      if (layers.water && mirror.ok && (age > 0.55 || (moved && age >= 1 / 30) ||
          mirrorTrees !== layers.trees || mirrorLevel !== level || mirrorProbe !== probe || mirrorGate !== nextGate ||
          reflectedShadowVP !== currentShadowVP)) {
        // Reflect y to 2 * level - y in world space before view/projection.
        const reflectedVP = vp.slice();
        for (let i = 0; i < 4; i++) {
          reflectedVP[12 + i] += 2 * level * vp[4 + i];
          reflectedVP[4 + i] = -vp[4 + i];
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, mirror.fb); gl.viewport(0, 0, mirror.w, mirror.h);
        const reflectedEye = [eye[0], 2 * level - eye[1], eye[2]];
        opaque(reflectedVP, reflectedEye, true, frame);
        annotations(reflectedVP, reflectedEye, true, frame);
        mirror.vp = reflectedVP;
        mirrorStamp = elapsed; mirrorPose = pose; mirrorTrees = layers.trees; mirrorLevel = level;
        mirrorProbe = probe; mirrorGate = nextGate; reflectedShadowVP = currentShadowVP;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
      opaque(vp, eye, false, frame);
      if (layers.water) {
        use(water);
        const u = water.u;
        atmosphere(u, light, eye, weather);
        ridgeLighting(u, frame, vp);
        gl.uniform1f(u.uLevel, level);
        gl.uniform1f(u.uChart, Number(!!layers.chart));
        gl.uniformMatrix4fv(u.uMirrorVP, false, mirror.vp || vp);
        gl.uniformMatrix4fv(u.uVP, false, vp); gl.uniform1f(u.uTime, elapsed); gl.uniform1f(u.uHalf, T.HALF);
        gl.uniform3fv(u.uDeep, scene.style.deep); gl.uniform3fv(u.uShallow, scene.style.shallow);
        gl.uniform1i(u.uLandscape, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mirror.ok ? mirror.tex : scene.tex);
        gl.uniform1i(u.uMirror, 1); gl.uniform1f(u.uHasMirror, +mirror.ok);
        // Flatten the actual bed triangles for exact chart depths. Ordinary water is one quad.
        const mesh = layers.chart ? scene.ground : lake;
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.id);
        gl.vertexAttribPointer(water.a.aPosition, 3, gl.FLOAT, false, layers.chart ? G.STRIDE * 4 : 0, 0);
        // A terrace exactly at lake level has zero depth in the flood survey.
        gl.depthFunc(gl.LESS);
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
        gl.depthFunc(gl.LEQUAL);
        gl.activeTexture(gl.TEXTURE0);
      }
      // Transparent features test against the finished water depth. Drawing the
      // lake later would paint over rings and runoff that are above its surface.
      annotations(vp, eye, false, frame);
      if (weather[1] > 0.001) drawRain(vp, axes.right, eye, elapsed, weather[1], light);
    }
    try {
      land = program(shaders.landVertex, shaders.landFragment);
      sky = program(shaders.skyVertex, shaders.skyFragment);
      water = program(shaders.waterVertex, shaders.waterFragment);
      screen = buffer(new Float32Array([-1, -1, 3, -1, -1, 3]), 2);
      lake = buffer(G.water(), 3);
      mirror = renderTarget();
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
      gl.clearColor(0.66, 0.72, 0.69, 1);
    } catch (error) {
      dispose();
      throw error;
    }
    return { loadWorld, render, resize, setRunoff, setGates, setPassage, dispose,
      get shadowsAvailable() { return shadow?.ok ?? true; } };
  }
  return createRenderer;
});
