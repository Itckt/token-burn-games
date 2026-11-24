(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const field = common ? require("./field.js") : root.Isobar.field;
  const storm = common ? require("./storm.js") : root.Isobar.storm;
  const relief = common ? require("./relief.js") : root.Isobar.relief;
  const doppler = common ? require("./doppler.js") : root.Isobar.doppler;
  const precision = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
    #else
      precision mediump float;
    #endif
  `;

  const planeVertex = `
    attribute vec2 aPlane;
    uniform mat4 uVP;
    uniform float uExtent, uHeight;
    varying mediump vec2 vWorld;
    void main() {
      vWorld = aPlane * uExtent;
      gl_Position = uVP * vec4(vWorld.x, uHeight, vWorld.y, 1.0);
    }
  `;

  const azimuth = `
    float azimuth(vec2 p) {
      return dot(p, p) < 0.000001 ? 0.0 : atan(p.y, p.x);
    }
  `;
  const transectLine = `
    uniform vec3 uTransect;
    vec3 markTransect(vec3 color, vec2 p, float width) {
      vec2 axis = uTransect.xy;
      if (dot(axis, axis) < 0.5) return color;
      float along = dot(p, axis);
      float across = abs(p.x * axis.y - p.y * axis.x);
      float end = abs(along) - ${field.RANGE.toFixed(1)};
      float tick = abs(fract(along / 3.0 + 0.5) - 0.5) * 3.0;
      float stroke = max(end, min(across, max(tick, across - 0.18)));
      float cursor = abs(length(vec2(along - uTransect.z, across)) - 0.24);
      float d = min(stroke, cursor);
      color = mix(color, vec3(0.13, 0.10, 0.05), 0.86 * (1.0 - smoothstep(width, 2.8 * width, d)));
      return mix(color, vec3(1.0, 0.83, 0.52), 1.0 - smoothstep(0.0, 1.35 * width, d));
    }
  `;

  const surfaceMarks = azimuth + transectLine + `
    uniform vec2 uRelease;
    uniform vec3 uArrival;
    vec3 surfaceInk(vec3 color, vec2 p, float width) {
      color = markTransect(color, p, width);
      if (uArrival.z < 0.5) return color;
      float outer = length(uRelease), inner = length(uArrival.xy), r = length(p);
      float track = 100.0;
      if (outer > inner && r > 0.001) {
        float turn = log(r / outer) * ${(1 / Math.tan(field.INFLOW)).toFixed(7)};
        float angle = azimuth(p) - azimuth(uRelease) - turn;
        float across = abs(atan(sin(angle), cos(angle))) * r * ${Math.sin(field.INFLOW).toFixed(7)};
        track = max(across, max(r - outer, inner - r));
      }
      float size = max(0.16, 4.0 * width);
      float ring = abs(length(p - uRelease) - size);
      vec2 end = abs(p - uArrival.xy);
      float diamond = (end.x + end.y - size) * 0.7071;
      float distanceToInk = min(track, min(ring, diamond));
      color = mix(color, vec3(0.14, 0.07, 0.08), 0.91 * (1.0 - smoothstep(width, 3.3 * width, distanceToInk)));
      return mix(color, vec3(1.0, 0.67, 0.54), 1.0 - smoothstep(0.0, 1.65 * width, distanceToInk));
    }
  `;

  const seaFragment = precision + surfaceMarks + `
    uniform sampler2D uNoise;
    uniform float uGrid, uPixel;
    uniform vec3 uWater, uLit, uLightDir, uEye;
    uniform float uContrast;
    varying mediump vec2 vWorld;
    float lattice(vec2 p, float interval, float width) {
      vec2 d = abs(fract(p / interval + 0.5) - 0.5) * interval;
      return 1.0 - smoothstep(0.0, width, min(d.x, d.y));
    }
    void main() {
      vec2 p = vWorld;
      float r = length(p);
      vec3 noise = texture2D(uNoise, p * 0.023).rgb;
      float shelf = texture2D(uNoise, p * 0.054 + 0.37).g * 0.48 + noise.r * 0.52;
      float halo = exp(-dot(p, p) * 0.0038);
      vec3 sea = uWater * mix(0.43, 1.0, halo);
      sea += vec3(0.027, 0.049, 0.061) * (shelf - 0.35);
      vec3 normal = normalize(vec3((noise.g - 0.5) * 0.43, 1.0, (noise.b - 0.5) * 0.43));
      vec3 towardEye = normalize(uEye - vec3(p.x, 0.0, p.y));
      float glint = max(0.0, dot(towardEye, reflect(-uLightDir, normal)));
      sea += uLit * uContrast * (0.14 * pow(glint, 9.0) + 0.40 * pow(glint, 72.0));
      float contour = abs(fract(shelf * 14.0) - 0.5);
      sea += vec3(0.012, 0.026, 0.030) * (1.0 - smoothstep(0.015, 0.080, contour));
      float width = max(0.012, uPixel * 1.23) * (1.0 + min(r, 32.0) * 0.018);
      float fade = exp(-r * r * 0.00105);
      float minor = lattice(p, 1.0, width);
      float major = lattice(p, 5.0, width * 1.35);
      vec2 crossD = abs(fract(p / 5.0 + 0.5) - 0.5) * 5.0;
      float crosses = (1.0 - smoothstep(0.11, 0.16, max(crossD.x, crossD.y))) * major;
      float ringD = abs(fract(r / 3.0 + 0.5) - 0.5) * 3.0;
      float ring = 1.0 - smoothstep(0.0, width * 1.4, ringD);
      float dashes = step(0.34, fract(azimuth(p) * 31.83 + 0.5));
      sea += uGrid * fade * (vec3(0.063, 0.091, 0.102) * minor
        + vec3(0.031, 0.055, 0.066) * major + vec3(0.13, 0.20, 0.20) * crosses
        + vec3(0.090, 0.132, 0.14) * ring * dashes * (1.0 - smoothstep(12.1, 14.0, r)));
      gl_FragColor = vec4(surfaceInk(sea, p, width), 1.0);
    }
  `;

  function glColor(hex) {
    const rgb = hex.slice(1).match(/../g).map(channel => (parseInt(channel, 16) / 255).toFixed(4));
    return "vec3(" + rgb.join(", ") + ")";
  }

  function colorRamp(stops, key) {
    const bands = stops.slice(1).map((stop, i) => {
      const low = stops[i][key], span = stop[key] - low;
      return `color = mix(color, ${glColor(stop.color)}, clamp((value - ${low.toFixed(1)}) / ${span.toFixed(1)}, 0.0, 1.0));`;
    });
    return `vec3 ramp(float value) { vec3 color = ${glColor(stops[0].color)}; ${bands.join("\n")} return color; }`;
  }

  const mapSurface = surfaceMarks + `
    float rangeGrid(vec2 p, float width) {
      vec2 d = abs(p);
      float axes = min(min(d.x, d.y), abs(d.x - d.y) * 0.7071);
      float rings = abs(fract(length(p) / 3.0 + 0.5) - 0.5) * 3.0;
      return 1.0 - smoothstep(0.0, width, min(rings, axes));
    }
    vec3 mapDisc(vec3 color, vec2 p, float width) {
      float range = length(p);
      float edge = range - ${field.RANGE.toFixed(1)};
      vec3 outside = vec3(0.044, 0.083, 0.103) * (0.70 + 0.22 * exp(-range * 0.04));
      color = mix(color, outside, smoothstep(-width, width, edge));
      color += vec3(0.10, 0.20, 0.20) * (1.0 - smoothstep(0.0, 1.4 * width, abs(edge)));
      return surfaceInk(color, p, width);
    }
  `;

  const radarFragment = precision + mapSurface + `
    uniform sampler2D uEcho;
    uniform float uGrid, uPixel, uPhase, uStrength, uScale, uRain, uSweep;
    varying mediump vec2 vWorld;
    void main() {
      vec2 p = vWorld / uScale;
      float r = length(p);
      float turn = uPhase - 0.12 * sin(uPhase - r * 0.56) + uStrength * r * 0.032;
      float c = cos(turn), s = sin(turn);
      vec2 uv = (mat2(c, s, -s, c) * p) / ${(2 * field.MAP_EXTENT).toFixed(1)} + 0.5;
      float rate = texture2D(uEcho, uv).r * uRain;
      float range = length(vWorld);
      float width = max(0.014, uPixel * 1.2);
      vec3 ink = vec3(0.044, 0.083, 0.103);
      vec3 color = ink + vec3(0.018, 0.065, 0.074) * exp(-range * range * 0.005);
      ${field.BANDS.map(({ rate, color }) =>
        `color = mix(color, ${glColor(color)}, smoothstep(${(rate - 0.15).toFixed(2)}, ${(rate + 0.15).toFixed(2)}, rate));`).join("\n      ")}
      color += uGrid * rangeGrid(vWorld, width) * vec3(0.115, 0.19, 0.19);
      vec2 beam = vec2(cos(uSweep), sin(uSweep));
      vec2 dir = vWorld / max(range, 0.001);
      float alignment = max(0.0, dot(dir, beam));
      float trail = pow(alignment, 24.0) * step(0.0, dir.x * beam.y - dir.y * beam.x);
      color += vec3(0.038, 0.10, 0.085) * trail;
      gl_FragColor = vec4(mapDisc(color, vWorld, width), 1.0);
    }
  `;

  const surfaceWind = `
    uniform float uScale, uPeakWind;
    const float wall = ${field.WALL_RADIUS.toFixed(4)};
    const float inward = ${Math.sin(field.INFLOW).toFixed(6)};
    const float tangent = ${Math.cos(field.INFLOW).toFixed(6)};
    float windSpeed(float radius) {
      float r = radius / uScale;
      if (r <= wall) return uPeakWind * mix(${field.EYE_WIND.toFixed(4)}, 1.0, r / wall);
      return uPeakWind * pow(wall / r, ${field.WIND_DECAY.toFixed(4)});
    }
    vec2 windDirection(vec2 p, float radius) {
      return (vec2(p.y, -p.x) * tangent - p * inward) / radius;
    }
  `;

  const windFragment = precision + mapSurface + surfaceWind + colorRamp(field.WIND_STOPS, "speed") + `
    uniform float uGrid, uPixel, uPulse;
    varying mediump vec2 vWorld;
    float segment(vec2 p, vec2 a, vec2 b) {
      vec2 ab = b - a;
      return length(p - a - ab * clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0));
    }
    void main() {
      vec2 p = vWorld;
      float r = length(p);
      float width = max(0.018, uPixel * 1.15);
      vec3 color = vec3(0.0);
      if (r < ${field.RANGE.toFixed(1)} + 2.0 * width) {
        color = ramp(windSpeed(r));
        // Curves of constant angle - log(r) / tan(inflow) follow the local vector.
        float lane = (azimuth(p) - log(max(r, 0.08)) * tangent / inward) * 3.8197186;
        float across = abs(fract(lane + 0.5) - 0.5) * 0.2617994 * r * inward;
        color += vec3(0.07, 0.11, 0.10) * smoothstep(0.5, 1.8, r) * (1.0 - smoothstep(0.0, width, across));
        color += uGrid * rangeGrid(p, width) * vec3(0.07, 0.09, 0.08);
        vec2 cell = floor(p / 1.55 + 0.5);
        vec2 centre = cell * 1.55;
        float radius = length(centre);
        if (radius > 0.5 && radius < ${field.RANGE.toFixed(1)} - 0.4) {
          vec2 flow = windDirection(centre, radius);
          vec2 offset = p - centre;
          vec2 uv = vec2(dot(offset, flow), dot(offset, vec2(-flow.y, flow.x)));
          float reach = 0.20 + 0.34 * windSpeed(radius) / 190.0;
          float shaft = segment(uv, vec2(-reach, 0.0), vec2(reach, 0.0));
          float head = segment(vec2(uv.x, abs(uv.y)), vec2(reach, 0.0), vec2(reach - 0.16, 0.13));
          float d = min(shaft, head);
          color = mix(color, vec3(0.08, 0.16, 0.19), 0.75 * (1.0 - smoothstep(width, width * 2.8, d)));
          color = mix(color, vec3(0.80, 0.93, 0.86), 0.86 * (1.0 - smoothstep(0.0, width * 1.4, d)));
          float pulse = fract(uPulse + dot(cell, vec2(0.37, 0.23)));
          float bead = length(uv - vec2(mix(-reach, reach, pulse), 0.0));
          color = mix(color, vec3(0.94, 1.0, 0.88), 1.0 - smoothstep(0.015, 0.052 + width, bead));
        }
      }
      gl_FragColor = vec4(mapDisc(color, p, width), 1.0);
    }
  `;

  const dopplerFragment = precision + mapSurface + surfaceWind + colorRamp(doppler.STOPS, "speed") + `
    uniform float uGrid, uPixel;
    uniform vec2 uSite;
    varying mediump vec2 vWorld;
    void main() {
      vec2 p = vWorld, beam = p - uSite;
      float r = length(p), range = length(beam), width = max(0.014, uPixel * 1.2);
      vec3 color = ramp(0.0);
      if (r <= ${field.RANGE.toFixed(1)} + width) {
        if (min(range, r) > ${doppler.BLIND_RADIUS.toFixed(3)}) {
          float radial = windSpeed(r) * dot(windDirection(p, r), beam / range);
          color = ramp(radial);
        }
        color += uGrid * rangeGrid(beam, width) * vec3(0.075, 0.10, 0.11);
      }
      color = mapDisc(color, p, width);
      // Concentric ink and a centre dot keep the antenna visible on both lobes.
      float mark = min(abs(range - max(0.22, width * 4.5)), range);
      color = mix(color, vec3(0.07, 0.10, 0.13), 1.0 - smoothstep(width, 2.8 * width, mark));
      color = mix(color, vec3(0.96, 0.98, 0.91), 1.0 - smoothstep(0.0, 1.4 * width, mark));
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const reliefVertex = `
    attribute vec2 aPlane;
    uniform mat4 uVP;
    uniform float uScale, uCentral;
    varying mediump vec2 vWorld;
    varying mediump float vDeficit;
    varying mediump vec3 vNormal;
    void main() {
      float r = length(aPlane);
      float radius = ${field.PRESSURE_RADIUS.toFixed(1)} * uScale;
      float power = pow(r / radius, ${field.PRESSURE_EXPONENT.toFixed(1)});
      float deficit = (${field.AMBIENT_PRESSURE.toFixed(1)} - uCentral) * exp(-power);
      float depth = deficit * ${relief.DEPTH_PER_HPA.toFixed(3)};
      float slope = depth * ${field.PRESSURE_EXPONENT.toFixed(1)} * power / max(r, 0.0001);
      vWorld = aPlane;
      vDeficit = deficit;
      vNormal = normalize(vec3(-slope * aPlane.x / max(r, 0.0001), 1.0, -slope * aPlane.y / max(r, 0.0001)));
      gl_Position = uVP * vec4(aPlane.x, -depth, aPlane.y, 1.0);
    }
  `;
  const reliefFragment = precision + mapSurface + colorRamp(relief.STOPS, "pressure") + `
    uniform float uGrid, uPixel;
    varying mediump vec2 vWorld;
    varying mediump float vDeficit;
    varying mediump vec3 vNormal;
    void main() {
      vec3 n = normalize(vNormal);
      float width = max(0.013, uPixel * 1.2);
      vec3 color = ramp(${field.AMBIENT_PRESSURE.toFixed(1)} - vDeficit);
      color *= 0.69 + 0.43 * max(0.0, dot(n, vec3(-0.58, 0.72, -0.38)));
      // Work in pressure differences to retain thin isolines on mediump hardware.
      float stepHpa = ${relief.CONTOUR_HPA.toFixed(1)};
      float level = (${(field.AMBIENT_PRESSURE % relief.CONTOUR_HPA).toFixed(1)} - vDeficit) / stepHpa;
      float delta = abs(fract(level + 0.5) - 0.5) * stepHpa;
      float gradient = length(n.xz) / (max(n.y, 0.001) * ${relief.DEPTH_PER_HPA.toFixed(3)});
      float ink = 1.0 - smoothstep(0.0, max(0.045, width * gradient * 1.6), delta);
      color = mix(color, vec3(0.88, 0.85, 0.98), ink * 0.79);
      color += uGrid * rangeGrid(vWorld, width) * vec3(0.058, 0.073, 0.084);
      gl_FragColor = vec4(mapDisc(color, vWorld, width), 1.0);
    }
  `;

  const deckFragment = precision + azimuth + `
    uniform sampler2D uNoise;
    uniform float uPhase, uStrength;
    uniform vec2 uCut;
    uniform vec3 uShadow, uLit, uLightDir;
    uniform float uContrast;
    varying mediump vec2 vWorld;
    float band(float r, float angle, float arm, float reach, float warp) {
      float centre = 2.4 * log(1.0 + 0.90 * r) + 0.065 * r + arm * 2.0943951 + 2.48
        + 0.19 * sin(r * 0.77 + arm * 1.8);
      float delta = angle - centre + warp;
      float d = atan(sin(delta), cos(delta)) * r / (0.72 + 0.036 * r);
      float tail = 1.0 - smoothstep(reach - 2.9, reach + 0.45, r);
      float mainBand = exp(-d * d * 0.68);
      float feeder = d - (0.39 + 0.12 * sin(r * 1.12)) * r;
      return tail * (mainBand + 0.41 * exp(-feeder * feeder * 2.3));
    }
    void main() {
      if (dot(vWorld, uCut) > 0.0) discard;
      vec2 p = vWorld / (1.055 - 0.105 * uStrength);
      float r = length(p);
      float c = cos(uPhase), s = sin(uPhase);
      vec2 q = mat2(c, s, -s, c) * p;
      vec3 n = texture2D(uNoise, q * 0.071).rgb;
      float fine = texture2D(uNoise, q * 0.24 + 0.24).r;
      float detail = n.r * 0.67 + fine * 0.33;
      float angle = azimuth(p) + uPhase - 0.12 * sin(uPhase - r * 0.56) + uStrength * r * 0.032;
      float warp = (n.g - 0.5) * 0.53;
      float arms = max(band(r, angle, 0.0, ${storm.ARM_REACH[0]}, warp),
        max(band(r, angle, 1.0, ${storm.ARM_REACH[1]}, warp), band(r, angle, 2.0, ${storm.ARM_REACH[2]}, warp)));
      float wall = exp(-pow(abs(r - 2.16 + 0.16 * sin(angle * 3.0)) / 1.13, 2.0));
      float eye = smoothstep(0.99, 1.67, r + (detail - 0.5) * 0.65);
      float skirt = 0.64 * (1.0 - smoothstep(2.5, 5.65, r + (n.g - 0.5) * 2.4));
      float density = max(max(wall, skirt), arms) * eye * smoothstep(0.15, 0.71, detail);
      float alpha = min(0.88, density * (0.83 + 0.24 * uStrength));
      float facing = dot(vec3(p.x / max(r, 1.0), 0.6, p.y / max(r, 1.0)), uLightDir);
      vec3 color = mix(uShadow, uLit, clamp(detail * 0.65 + facing * uContrast * 0.19, 0.0, 1.0));
      gl_FragColor = vec4(color, alpha);
    }
  `;

  const cloudVertex = `
    attribute vec2 aCorner;
    attribute vec4 aProfile;
    attribute vec3 aCenter;
    attribute vec2 aTangent;
    uniform mat4 uVP;
    uniform vec3 uRight, uUp, uSun, uIncident;
    uniform vec2 uCut;
    uniform float uStrength;
    varying mediump vec2 vUV;
    varying mediump vec3 vSun;
    varying mediump float vExposure;
    varying mediump float vCut;
    void main() {
      vec2 tangent = vec2(dot(aTangent, uRight.xz), dot(aTangent, uUp.xz));
      float projected = max(length(tangent), 0.001);
      vec2 along = tangent / projected;
      vec2 across = vec2(-along.y, along.x);
      float stretch = mix(1.0, aProfile.y, min(1.0, projected));
      float size = aProfile.x * (0.91 + 0.19 * uStrength);
      vec2 offset = size * (aCorner.x * stretch * along + aCorner.y * across);
      vec3 world = aCenter + uRight * offset.x + uUp * offset.y;
      vCut = dot(world.xz, uCut);
      gl_Position = uVP * vec4(world, 1.0);
      vec2 tile = vec2(mod(aProfile.z, 2.0), floor(aProfile.z * 0.5));
      vUV = (tile + 0.5 + aCorner * 0.496) * 0.5;
      vSun = vec3(dot(uSun.xy, along), dot(uSun.xy, across), uSun.z);
      vExposure = clamp((aCenter.y - 1.26) * 0.14 + dot(aCenter.xz, uIncident.xz) * 0.06
        + (aProfile.w - 0.5) * 0.10, -0.22, 0.24);
    }
  `;

  const cloudFragment = precision + `
    uniform sampler2D uAtlas;
    uniform vec3 uShadow, uLit;
    varying mediump vec2 vUV;
    varying mediump vec3 vSun;
    varying mediump float vExposure;
    varying mediump float vCut;
    void main() {
      if (vCut > 0.0) discard;
      vec4 sampleCloud = texture2D(uAtlas, vUV);
      vec2 xy = sampleCloud.rg * 2.0 - 1.0;
      vec3 normal = vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
      float diffuse = dot(normal, vSun);
      float light = clamp(0.49 + diffuse + (sampleCloud.b - 0.5) * 0.36 + vExposure, 0.0, 1.0);
      vec3 cloud = mix(uShadow, uLit, light);
      gl_FragColor = vec4(cloud, sampleCloud.a * 0.87);
    }
  `;

  const rainVertex = `
    attribute vec3 aPosition;
    attribute float aBrightness;
    uniform mat4 uVP;
    uniform float uStrength;
    uniform vec2 uCut;
    varying mediump float vAlpha;
    varying mediump float vCut;
    void main() {
      vCut = dot(aPosition.xz, uCut);
      gl_Position = uVP * vec4(aPosition, 1.0);
      vAlpha = (0.14 + 0.39 * aBrightness) * (0.63 + 0.61 * uStrength);
    }
  `;
  const rainFragment = precision + `
    uniform vec3 uRainColor;
    varying mediump float vAlpha;
    varying mediump float vCut;
    void main() {
      if (vCut > 0.0) discard;
      gl_FragColor = vec4(uRainColor, vAlpha);
    }
  `;

  const api = {
    sea: { vertex: planeVertex, fragment: seaFragment },
    radar: { vertex: planeVertex, fragment: radarFragment },
    doppler: { vertex: planeVertex, fragment: dopplerFragment },
    wind: { vertex: planeVertex, fragment: windFragment },
    pressure: { vertex: reliefVertex, fragment: reliefFragment },
    deck: { vertex: planeVertex, fragment: deckFragment },
    cloud: { vertex: cloudVertex, fragment: cloudFragment },
    rain: { vertex: rainVertex, fragment: rainFragment }
  };
  if (common) module.exports = api;
  else (root.Isobar ||= {}).shaders = api;
})(globalThis);
