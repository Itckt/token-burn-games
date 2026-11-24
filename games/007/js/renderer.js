"use strict";

var TwistRenderer = (function (math, mesh) {
  const cubeVertex = `
    attribute vec3 aPosition, aNormal, aColor;
    attribute float aGloss;
    uniform mat4 uVP, uModel;
    varying mediump vec3 vWorld, vNormal, vColor, vSticker;
    varying mediump float vGloss;
    void main() {
      vec4 world = uModel * vec4(aPosition, 1.0);
      vWorld = world.xyz;
      vNormal = (uModel * vec4(aNormal, 0.0)).xyz;
      vColor = aColor;
      vGloss = aGloss;
      // Sample the lettering in the home face's local frame so it travels
      // with the sticker during a turn. Atlas cell order is U R F D L B.
      vec3 p = aPosition, extent = abs(p);
      if (extent.x > extent.y && extent.x > extent.z)
        vSticker = vec3(-sign(p.x) * p.z, p.y, p.x > 0.0 ? 1.0 : 4.0);
      else if (extent.y > extent.z)
        vSticker = vec3(p.x, -sign(p.y) * p.z, p.y > 0.0 ? 0.0 : 3.0);
      else
        vSticker = vec3(sign(p.z) * p.x, p.y, p.z > 0.0 ? 2.0 : 5.0);
      gl_Position = uVP * world;
    }`;
  const cubeFragment = `
    precision mediump float;
    varying vec3 vWorld, vNormal, vColor, vSticker;
    varying float vGloss;
    uniform vec3 uEye;
    uniform bool uLetters;
    uniform float uFocus;
    uniform sampler2D uAlphabet;
    void main() {
      vec3 n = normalize(vNormal);
      vec3 viewDir = normalize(uEye - vWorld);
      vec3 key = normalize(vec3(-0.48, 0.90, 0.70));
      vec3 fill = normalize(vec3(0.88, 0.36, -0.28));
      float diffuse = 0.72 + 0.30 * max(dot(n, key), 0.0) + 0.11 * max(dot(n, fill), 0.0);
      float softbox = pow(max(dot(n, normalize(viewDir + key)), 0.0), 38.0);
      float rim = pow(1.0 - clamp(dot(viewDir, n), 0.0, 1.0), 3.0);
      vec3 pigment = vColor;
      if (uFocus < 0.0) {
        float grey = dot(pigment, vec3(0.21, 0.72, 0.07));
        pigment = mix(vec3(grey), pigment, 0.4) * 0.55;
      } else if (uFocus > 0.0 && vGloss > 0.9) {
        pigment = vec3(0.76, 0.96, 0.49);
      }
      if (uLetters && vGloss < 0.36) {
        // Leave the printed upper-center logo beneath the letter layer.
        if (vGloss < 0.32) discard;
        vec2 uv = vSticker.xy / 0.44 + vec2(3.5, 3.5) / 8.0;
        if (all(greaterThanEqual(uv, vec2(0.0))) && all(lessThanEqual(uv, vec2(1.0)))) {
          float ink = texture2D(uAlphabet, vec2((vSticker.z + uv.x) / 8.0, uv.y)).a;
          pigment = mix(pigment, vec3(0.065, 0.084, 0.092), ink);
        }
      }
      vec3 color = pigment * diffuse + (softbox * 0.25 + rim * 0.10) * vGloss;
      color += vec3(0.018, 0.025, 0.032) * max(n.y, 0.0) * vGloss;
      gl_FragColor = vec4(color, 1.0);
    }`;
  const floorVertex = `
    attribute vec2 aPlane;
    uniform mat4 uVP;
    varying mediump vec2 vFloor;
    void main() {
      vFloor = aPlane;
      gl_Position = uVP * vec4(aPlane.x, -1.84, aPlane.y, 1.0);
    }`;
  const floorFragment = `
    precision mediump float;
    varying vec2 vFloor;
    uniform float uVisibility;
    float line(float radius, float width) {
      return 1.0 - smoothstep(0.003, width, abs(length(vFloor) - radius));
    }
    void main() {
      float radius = length(vFloor);
      float angle = atan(vFloor.y, vFloor.x);
      float marks = 1.0 - smoothstep(0.075, 0.27, abs(sin(angle * 36.0)));
      float ticks = marks * smoothstep(2.70, 2.72, radius) * (1.0 - smoothstep(2.75, 2.77, radius));
      float ring = line(2.56, 0.014) * 0.30 + line(2.74, 0.010) * 0.12 + ticks * 0.32;
      vec2 offset = (vFloor - vec2(0.06, -0.08)) / vec2(1.52, 1.45);
      float shadow = 0.66 * exp(-1.65 * dot(offset, offset));
      float alpha = ring + shadow * (1.0 - ring);
      vec3 color = mix(vec3(0.012, 0.017, 0.022), vec3(0.49, 0.57, 0.61), ring / max(alpha, 0.001));
      gl_FragColor = vec4(color, alpha * uVisibility);
    }`;

  function program(gl, vertexSource, fragmentSource, attributes, uniforms) {
    const handle = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      gl.attachShader(handle, shader);
      gl.deleteShader(shader);
    }
    gl.linkProgram(handle);
    if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(handle));
    const info = { handle };
    for (const attr of attributes) info[attr] = gl.getAttribLocation(handle, attr);
    for (const u of uniforms) info[u] = gl.getUniformLocation(handle, u);
    return info;
  }

  class Renderer {
    constructor(canvas, pieces) {
      this.canvas = canvas;
      const options = { alpha: true, antialias: true, depth: true, powerPreference: "high-performance" };
      const gl = canvas.getContext("webgl", options) || canvas.getContext("experimental-webgl", options);
      if (!gl) throw new Error("WebGL is unavailable.");
      this.gl = gl;
      this.cube = program(gl, cubeVertex, cubeFragment, ["aPosition","aNormal","aColor","aGloss"],
        ["uModel","uVP","uEye","uLetters","uAlphabet","uFocus"]);
      this.floor = program(gl, floorVertex, floorFragment, ["aPlane"], ["uVP","uVisibility"]);
      const data = mesh.cubeMeshes(pieces);
      this.ranges = data.ranges;
      function buffer(type, array) {
        const handle = gl.createBuffer();
        gl.bindBuffer(type, handle);
        gl.bufferData(type, array, gl.STATIC_DRAW);
        return handle;
      }
      this.vertexBuffer = buffer(gl.ARRAY_BUFFER, data.vertices);
      this.indexBuffer = buffer(gl.ELEMENT_ARRAY_BUFFER, data.indices);
      this.floorBuffer = buffer(gl.ARRAY_BUFFER, new Float32Array([-4.5,-4.5, 4.5,-4.5, -4.5,4.5, 4.5,4.5]));
      const atlas = mesh.letterAtlas();
      this.alphabet = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.alphabet);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, atlas.width, atlas.height, 0, gl.ALPHA, gl.UNSIGNED_BYTE, atlas.pixels);
      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.LEQUAL);
    }
    resize(width, height, deviceScale) {
      const ratio = Math.min(deviceScale || 1, 2);
      const w = Math.max(1, Math.round(width * ratio)), h = Math.max(1, Math.round(height * ratio));
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this.gl.viewport(0, 0, w, h);
    }
    draw(pieces, active, camera, stickerLetters = false, trackedPiece = null) {
      const gl = this.gl;
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const floor = this.floor;
      gl.useProgram(floor.handle);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.CULL_FACE);
      gl.depthMask(false);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.floorBuffer);
      gl.enableVertexAttribArray(floor.aPlane);
      gl.vertexAttribPointer(floor.aPlane, 2, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(floor.uVP, false, camera.vp);
      gl.uniform1f(floor.uVisibility, math.clamp(camera.eye[1] * 0.6 + 0.15, 0, 1));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(floor.aPlane);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
      const cube = this.cube;
      gl.useProgram(cube.handle);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
      for (const [attribute, size, offset] of [[cube.aPosition,3,0],[cube.aNormal,3,3],[cube.aColor,3,6],[cube.aGloss,1,9]]) {
        gl.enableVertexAttribArray(attribute);
        gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, mesh.STRIDE * 4, offset * 4);
      }
      gl.uniformMatrix4fv(cube.uVP, false, camera.vp);
      gl.uniform3f(cube.uEye, ...camera.eye);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.alphabet);
      gl.uniform1i(cube.uAlphabet, 0);
      gl.uniform1i(cube.uLetters, stickerLetters ? 1 : 0);
      gl.uniform1f(cube.uFocus, trackedPiece ? -1 : 0);
      const rotating = active && math.rotation(active.axis, active.angle);
      for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i];
        let model = math.model(piece.basis, piece.pos, camera.layout);
        if (active && piece.pos[active.axis] === active.side) model = math.multiply(rotating, model);
        gl.uniformMatrix4fv(cube.uModel, false, model);
        const range = this.ranges[i];
        if (piece === trackedPiece) gl.uniform1f(cube.uFocus, 1);
        gl.drawElements(gl.TRIANGLES, range.count, gl.UNSIGNED_SHORT, range.first * 2);
        if (piece === trackedPiece) gl.uniform1f(cube.uFocus, -1);
      }
      for (const attribute of [cube.aPosition,cube.aNormal,cube.aColor,cube.aGloss]) gl.disableVertexAttribArray(attribute);
    }
  }
  return Renderer;
})(typeof module !== "undefined" && module.exports ? require("./math.js") : TwistMath,
   typeof module !== "undefined" && module.exports ? require("./mesh.js") : TwistMesh);

if (typeof module !== "undefined" && module.exports) module.exports = TwistRenderer;
