(function (root) {
  "use strict";
  const precision = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

  const body = {
    vertex: `
      attribute vec3 aPosition;
      attribute vec2 aData;
      uniform mat4 uVP, uModel;
      varying vec2 vUV;
      varying vec3 vNormal, vWorld;
      void main() {
        vec4 world = uModel * vec4(aPosition, 1.0);
        vNormal = mat3(uModel) * aPosition;
        vWorld = world.xyz;
        vUV = aData;
        gl_Position = uVP * world;
      }`,
    fragment: precision + `
      uniform sampler2D uSurface;
      uniform vec3 uEye, uLight, uAir, uPole;
      uniform float uStar, uRinged, uEyepiece;
      varying vec2 vUV;
      varying vec3 vNormal, vWorld;
      void main() {
        vec4 albedo = texture2D(uSurface, vUV);
        vec3 n = normalize(vNormal);
        vec3 view = normalize(mix(uEye - vWorld, uEye, uEyepiece));
        float facing = clamp(dot(n, view), 0.0, 1.0);
        if (uStar > 0.5) {
          vec3 fire = albedo.rgb * (0.89 + 0.16 * sqrt(facing));
          gl_FragColor = vec4(fire + vec3(0.08, 0.035, 0.006), 1.0);
          return;
        }
        float day = dot(n, uLight);
        float diffuse = pow(max(0.0, mix((day + 0.07) / 1.07, day, uEyepiece)), 0.72);
        if (uRinged > 0.5) {
          float plane = dot(uLight, uPole);
          if (abs(plane) > 0.002) {
            float t = -dot(n, uPole) / plane;
            float r = length(n + uLight * t);
            float shade = smoothstep(1.29, 1.48, r) * (1.0 - smoothstep(2.18, 2.28, r));
            if (t > 0.0) diffuse *= 1.0 - 0.38 * shade;
          }
        }
        float fill = mix(0.19 + 0.07 * (n.y * 0.5 + 0.5), 0.026, uEyepiece);
        vec3 color = albedo.rgb * (fill + 0.82 * diffuse);
        color += uAir * pow(1.0 - facing, 3.5) * (0.15 + 0.64 * diffuse);
        float shine = pow(max(dot(reflect(-uLight, n), view), 0.0), 32.0);
        color += vec3(0.32, 0.38, 0.40) * albedo.a * shine * diffuse;
        gl_FragColor = vec4(color, 1.0);
      }`
  };

  const rings = {
    vertex: `
      attribute vec3 aPosition;
      attribute vec2 aData;
      uniform mat4 uVP, uModel;
      varying float vBand;
      varying vec3 vWorld;
      void main() {
        vec4 world = uModel * vec4(aPosition, 1.0);
        vBand = aData.x;
        vWorld = world.xyz;
        gl_Position = uVP * world;
      }`,
    fragment: precision + `
      uniform vec3 uLight, uCenter;
      uniform float uRadius;
      varying float vBand;
      varying vec3 vWorld;
      void main() {
        vec3 p = (vWorld - uCenter) / uRadius;
        float along = dot(p, uLight);
        float shadow = along < 0.0 ? smoothstep(0.90, 1.04, length(p - along * uLight)) : 1.0;
        float bands = 0.5 + 0.25 * sin(vBand * 132.0) + 0.15 * sin(vBand * 311.0);
        float gap = smoothstep(0.608, 0.623, vBand) * (1.0 - smoothstep(0.649, 0.66, vBand));
        float inner = smoothstep(0.0, 0.21, vBand);
        vec3 color = mix(vec3(0.47, 0.43, 0.37), vec3(0.89, 0.82, 0.67), inner * 0.55 + bands * 0.42);
        float alpha = (0.30 + inner * 0.52 + bands * 0.14) * (1.0 - gap * 0.88);
        gl_FragColor = vec4(color * (0.36 + shadow * 0.64), alpha);
      }`
  };

  const path = {
    vertex: `
      attribute vec3 aPosition;
      uniform mat4 uVP, uModel;
      void main() { gl_Position = uVP * uModel * vec4(aPosition, 1.0); }`,
    fragment: precision + `
      uniform vec4 uColor;
      void main() { gl_FragColor = uColor; }`
  };

  // Clip a world-space segment in the usual WebGL pipeline, including when
  // one endpoint passes behind the camera in follow mode.
  const link = {
    vertex: `
      attribute vec2 aPosition;
      uniform mat4 uVP;
      uniform vec3 uFrom, uTo;
      varying float vAlong;
      void main() {
        vAlong = aPosition.x * 0.5 + 0.5;
        gl_Position = uVP * vec4(mix(uFrom, uTo, vAlong), 1.0);
      }`,
    fragment: precision + `
      varying float vAlong;
      void main() {
        float dash = step(0.32, fract(vAlong * 18.0));
        gl_FragColor = vec4(0.46, 0.89, 0.85, mix(0.14, 0.92, dash));
      }`
  };

  const trail = {
    vertex: `
      attribute vec3 aPosition;
      attribute vec2 aData;
      uniform mat4 uVP;
      uniform float uRatio;
      varying vec2 vTrail;
      void main() {
        vTrail = aData;
        gl_PointSize = (5.2 - 1.4 * aData.x) * uRatio;
        gl_Position = uVP * vec4(aPosition, 1.0);
      }`,
    fragment: precision + `
      uniform vec3 uTint;
      varying vec2 vTrail;
      void main() {
        float alpha = mix(0.94, 0.16, vTrail.x);
        if (vTrail.y > 0.5) {
          float radius = length(gl_PointCoord * 2.0 - 1.0);
          alpha = (0.96 - 0.36 * vTrail.x) * (1.0 - smoothstep(0.60, 1.0, radius));
        }
        gl_FragColor = vec4(uTint, alpha);
      }`
  };

  const points = {
    vertex: `
      attribute vec3 aPosition;
      attribute vec2 aData;
      uniform mat4 uVP;
      uniform float uSky, uRatio;
      varying float vLight, vWarm, vSky;
      void main() {
        vec4 clip = uVP * vec4(aPosition, 1.0 - uSky);
        if (uSky > 0.5) clip.z = clip.w * 0.9999;
        gl_Position = clip;
        gl_PointSize = uRatio * mix(0.82 + aData.x * 0.95, 1.05 + aData.x * 1.9, uSky);
        vLight = aData.x;
        vWarm = aData.y;
        vSky = uSky;
      }`,
    fragment: precision + `
      varying float vLight, vWarm, vSky;
      void main() {
        float r = length(gl_PointCoord * 2.0 - 1.0);
        float core = 1.0 - smoothstep(0.12, 1.0, r);
        vec3 color = mix(vec3(0.69, 0.80, 0.94), vec3(0.98, 0.87, 0.70), vWarm);
        float alpha = mix(0.13 + vLight * 0.31, 0.30 + vLight * 0.65, vSky);
        gl_FragColor = vec4(color, core * alpha);
      }`
  };

  const sky = {
    vertex: `
      attribute vec2 aPosition;
      varying vec2 vUV;
      void main() { vUV = aPosition; gl_Position = vec4(aPosition, 1.0, 1.0); }`,
    fragment: precision + `
      varying vec2 vUV;
      uniform sampler2D uDust;
      void main() {
        vec2 uv = vUV * 0.5 + 0.5;
        float dust = texture2D(uDust, uv).r;
        float lane = vUV.y - 0.30 * vUV.x + 0.16;
        float band = exp(-4.0 * lane * lane);
        float vignette = max(0.0, 1.0 - dot(vUV, vUV) * 0.36);
        vec3 space = vec3(0.026, 0.043, 0.062) + vignette * vec3(0.012, 0.019, 0.025);
        space += band * dust * vec3(0.058, 0.079, 0.104);
        gl_FragColor = vec4(space, 1.0);
      }`
  };

  const glow = {
    vertex: `
      attribute vec2 aPosition;
      uniform mat4 uVP;
      uniform vec2 uSize;
      varying vec2 vUV;
      void main() {
        vec4 clip = uVP * vec4(0.0, 0.0, 0.0, 1.0);
        clip.xy += aPosition * uSize;
        vUV = aPosition;
        gl_Position = clip;
      }`,
    fragment: precision + `
      varying vec2 vUV;
      void main() {
        float r = length(vUV);
        float haze = exp(-r * 4.8) * (1.0 - smoothstep(0.70, 1.0, r));
        float limb = exp(-max(0.0, r - 0.163) * 53.0);
        vec3 light = vec3(1.0, 0.49, 0.13) * haze * 0.54 + vec3(1.0, 0.64, 0.20) * limb * 0.34;
        gl_FragColor = vec4(light, 1.0);
      }`
  };

  const api = { body, rings, path, link, trail, points, sky, glow };
  for (const program of Object.values(api)) program.vertex = precision + program.vertex;
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.OrbitAtlas ||= {}).shaders = api;
})(globalThis);
