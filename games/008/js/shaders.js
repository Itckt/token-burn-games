(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./waterways"));
  else root.FieldAtlas.shaders = factory(root.FieldAtlas.waterways);
})(globalThis, function (W) {
  "use strict";
  const skyVertex = `
    attribute vec2 aPosition;
    varying vec2 vClip;
    void main() { vClip = aPosition; gl_Position = vec4(aPosition, 1.0, 1.0); }
  `;
  const noise = `
    float hash(vec2 p) {
      vec3 v = fract(vec3(p.xyx) * vec3(0.1031, 0.11369, 0.13787));
      v += dot(v, v.yzx + 19.19);
      return fract((v.x + v.y) * v.z);
    }
    float grain(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
                 mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
    }
  `;
  const atmosphere = `
    uniform vec3 uSun, uHigh, uLow, uEye;
    uniform float uDay, uWarm;
    uniform vec2 uWeather;
    vec3 cloudLight() {
      return mix(vec3(0.115, 0.16, 0.22), vec3(0.66, 0.73, 0.73), uDay);
    }
    vec3 haze(vec3 color, vec3 eyeOffset, float density) {
      float fog = 1.0 - exp(-length(eyeOffset * density) * (1.0 + 3.7 * uWeather.x));
      vec3 air = mix(uLow, vec3(0.46, 0.59, 0.62), 0.31 * uDay);
      air = mix(air, cloudLight(), max(uWeather.x, uWeather.y));
      return mix(color, air, fog);
    }
  `;
  const skyFragment = `
    precision highp float;
    varying vec2 vClip;
    uniform vec3 uForward, uRight, uUp;
    uniform vec2 uFrustum;
    uniform float uTime;
  ` + atmosphere + noise + `
    void main() {
      vec3 rd = normalize(uForward + uRight * vClip.x * uFrustum.x + uUp * vClip.y * uFrustum.y);
      float altitude = max(rd.y, 0.0);
      vec3 color = mix(uLow, uHigh, 1.0 - exp(-altitude * 3.65));
      float cover = max(uWeather.x * 0.64, uWeather.y * 0.93);
      color = mix(color, cloudLight() * (1.0 - 0.24 * altitude), cover);
      float sunDistance = length(rd - uSun);
      color += vec3(0.22, 0.14, 0.061) * exp(-sunDistance * 4.8) * uDay * (1.0 - cover);
      float disc = 1.0 - smoothstep(0.037, 0.040, sunDistance);
      color = mix(color, vec3(1.0, 0.963, 0.78), disc * uDay * (1.0 - cover));
      vec2 p = rd.xz / max(rd.y + 0.105, 0.055);
      p = p * vec2(1.9, 7.3) + vec2(uTime * 0.009, 3.4);
      float cloud = grain(p) * 0.57 + grain(p * 2.06 + 4.2) * 0.29 + grain(p * 4.13 - 3.1) * 0.14;
      float veil = smoothstep(0.52 - 0.28 * cover, 0.78, cloud) * smoothstep(0.025, 0.19, rd.y);
      vec3 cloudColor = mix(vec3(0.24, 0.31, 0.40), vec3(0.992, 0.946, 0.828), uDay);
      cloudColor = mix(cloudColor, cloudLight() * (0.55 + cloud * 0.48), uWeather.y);
      color = mix(color, cloudColor, veil * (0.65 + 0.32 * cover));
      if (uDay < 0.98 && rd.y > 0.012) {
        vec2 stars = vec2(atan(rd.z, rd.x) * 102.0, asin(clamp(rd.y, -1.0, 1.0)) * 102.0);
        vec2 cell = floor(stars), pixel = fract(stars) - 0.5;
        float star = step(0.956, hash(cell)) * (1.0 - smoothstep(0.025, 0.11, length(pixel)));
        color += star * (1.0 - uDay) * (1.0 - cover) * (0.45 + 0.4 * hash(cell + 4.0)) * smoothstep(0.01, 0.22, rd.y);
        vec3 moon = normalize(vec3(-uSun.x, -uSun.y, uSun.z));
        float lunar = 1.0 - smoothstep(0.023, 0.025, length(rd - moon));
        color = mix(color, vec3(0.80, 0.86, 0.89), lunar * (1.0 - uDay) * (1.0 - cover));
      }
      gl_FragColor = vec4(color, 1.0);
    }
  `;
  const shadowVertex = `
    attribute vec3 aPosition;
    uniform mat4 uLightVP;
    void main() { gl_Position = uLightVP * vec4(aPosition, 1.0); }
  `;
  const shadowFragment = `
    precision highp float;
    void main() {
      float depth = gl_FragCoord.z * 255.0;
      gl_FragColor = vec4(floor(depth) / 255.0, fract(depth), 0.0, 1.0);
    }
  `;
  // Interpolate four visibility comparisons. Interpolating packed depths
  // themselves would let sky texels erase a thin ridge at its silhouette.
  const ridgeLight = `
    uniform sampler2D uShadow;
    uniform vec2 uShade;
    float occluded(vec2 uv, float depth) {
      float bed = dot(texture2D(uShadow, uv).rg, vec2(1.0, 1.0 / 255.0));
      return smoothstep(0.0012, 0.0035, depth - bed);
    }
    float ridgeShadow(vec3 point) {
      if (uShade.x <= 0.0 || any(lessThan(point, vec3(0.0))) || any(greaterThan(point, vec3(1.0)))) return 0.0;
      vec2 texel = point.xy / uShade.y - 0.5;
      vec2 uv = (floor(texel) + 0.5) * uShade.y, f = fract(texel);
      vec2 stepUV = vec2(uShade.y, 0.0);
      float a = mix(occluded(uv, point.z), occluded(uv + stepUV, point.z), f.x);
      float b = mix(occluded(uv + stepUV.yx, point.z), occluded(uv + stepUV.xx, point.z), f.x);
      return uShade.x * mix(a, b, f.y);
    }
  `;
  const landVertex = `
    attribute vec3 aPosition, aNormal, aColor;
    uniform mat4 uVP, uLightVP;
    varying vec3 vPosition, vColor, vNormal, vLight;
    void main() {
      vPosition = aPosition; vColor = aColor; vNormal = aNormal;
      vLight = (uLightVP * vec4(aPosition, 1.0)).xyz * 0.5 + 0.5;
      gl_Position = uVP * vec4(aPosition, 1.0);
    }
  `;
  const landFragment = `
    precision highp float;
    varying vec3 vPosition, vColor, vNormal, vLight;
    uniform sampler2D uLandscape;
    uniform float uHalf, uForest, uKind, uReflect, uLevel, uProbe;
  ` + atmosphere + ridgeLight + `
    void main() {
      if (uReflect > 0.5 && vPosition.y < uLevel - 0.15) discard;
      vec3 n = normalize(vNormal);
      vec3 light = normalize(vec3(uSun.x, max(0.21, abs(uSun.y)), uSun.z));
      float diffuse = max(dot(n, light), 0.0);
      float sky = n.y * 0.5 + 0.5;
      vec3 ambient = vec3(0.60, 0.69, 0.73) + sky * vec3(0.17, 0.15, 0.11);
      vec3 direct = mix(vec3(0.41, 0.37, 0.28), vec3(0.58, 0.43, 0.23), uWarm);
      float shade = (uKind > 1.5 && uKind < 2.5) ? 0.0 : ridgeShadow(vLight);
      ambient *= vec3(1.0) - shade * vec3(0.23, 0.16, 0.09);
      vec3 lit = vColor * (ambient + (1.0 - shade) * diffuse * direct * (1.0 - 0.75 * max(uWeather.x, uWeather.y)));
      if (uKind < 0.5 && uForest > 0.5) {
        vec2 uv = vPosition.xz / (2.0 * uHalf) + 0.5;
        float root = texture2D(uLandscape, uv).g;
        float shadow = texture2D(uLandscape, uv + light.xz * 0.006).g;
        lit *= vec3(1.0) - vec3(0.35, 0.27, 0.19) * max(root * 0.88, shadow);
      }
      vec3 night = vColor * (vec3(0.18, 0.29, 0.43) + diffuse * vec3(0.11, 0.14, 0.18));
      vec3 shaded = mix(night, lit, uDay);
      shaded *= mix(vec3(1.0), vec3(0.77, 0.84, 0.86), uWeather.y);
      if (uKind > 2.5) {
        shaded += vec3(0.81, 0.68, 0.35) * smoothstep(0.75, 0.90, vColor.g) * (1.0 - uDay);
      }
      if (uProbe > 0.5 && uKind < 0.5) {
        float range = length((vPosition - uEye) * 0.004);
        float width = clamp(0.085 + range * 0.16, 0.085, 0.39);
        float minor = abs(mod(vPosition.y + 1.0, 2.0) - 1.0);
        float major = abs(mod(vPosition.y + 5.0, 10.0) - 5.0);
        float fine = (1.0 - smoothstep(width * 0.3, width, minor)) * (1.0 - smoothstep(0.5, 1.8, range));
        float indexLine = 1.0 - smoothstep(width * 0.6, width * 1.9, major);
        float ink = max(fine * 0.47, indexLine * 0.86) * smoothstep(0.012, 0.09, length(n.xz));
        shaded = mix(shaded, mix(vec3(0.48, 0.71, 0.68), vec3(0.99, 0.86, 0.60), uDay), ink);
      }
      float fog = uKind > 1.5 && uKind < 2.5 ? 0.0027 : 0.00155;
      gl_FragColor = vec4(haze(shaded, vPosition - uEye, fog), 1.0);
    }
  `;
  const waterVertex = `
    attribute vec3 aPosition;
    uniform mat4 uVP, uMirrorVP, uLightVP;
    uniform float uLevel;
    varying vec3 vPosition, vLight;
    varying vec4 vProjected;
    varying float vChartDepth;
    void main() {
      vPosition = vec3(aPosition.x, uLevel, aPosition.z);
      vChartDepth = uLevel - aPosition.y;
      vProjected = uMirrorVP * vec4(vPosition, 1.0);
      vLight = (uLightVP * vec4(vPosition, 1.0)).xyz * 0.5 + 0.5;
      gl_Position = uVP * vec4(vPosition, 1.0);
    }
  `;
  const rgb = hex => "vec3(" + hex.slice(1).match(/../g).map(v => (parseInt(v, 16) / 255).toFixed(4)).join(", ") + ")";
  const chartInk = W.BANDS.slice(1).map(band => {
    const cut = band.depth.toFixed(1);
    return "if (depth >= " + cut + ") ink = " + rgb(band.color) + ";\n" +
      "edge = min(edge, abs(depth - " + cut + "));";
  }).join("\n");
  const waterFragment = `
    precision highp float;
    varying vec3 vPosition, vLight;
    varying vec4 vProjected;
    varying float vChartDepth;
    uniform sampler2D uLandscape, uMirror;
    uniform vec3 uDeep, uShallow;
    uniform float uHalf, uTime, uHasMirror, uChart;
  ` + atmosphere + noise + ridgeLight + `
    vec3 depthInk(float depth) {
      vec3 ink = ` + rgb(W.BANDS[0].color) + `;
      float edge = depth;
      ` + chartInk + `
      return mix(ink, vec3(0.89, 0.92, 0.8), (1.0 - smoothstep(0.015, 0.11, edge)) * 0.75);
    }
    void main() {
      if (uChart > 0.5 && vChartDepth <= 0.0) discard;
      vec2 p = vPosition.xz;
      vec2 bed = texture2D(uLandscape, p / (2.0 * uHalf) + 0.5).rb;
      float depth = max(0.0, vPosition.y + 16.0 - dot(bed, vec2(20.0, 8.0)));
      vec3 eye = normalize((uEye - vPosition) * 0.015625);
      float t = uTime * 0.62;
      float wave = sin(p.y * 1.8 + p.x * 0.18 + 2.1 * sin(p.x * 0.19 + t) + t * 2.0);
      float chop = sin(p.y * 0.87 - p.x * 0.30 + t + sin(p.x * 0.12));
      vec2 ripple = vec2(chop * 0.0019, (wave + chop) * 0.0034);
      ripple += uWeather.y * vec2(sin(p.x * 2.1 + p.y * 1.4 - t * 5.0) * 0.004, wave * 0.005);
      vec3 reflection = mix(uLow, uHigh, clamp(eye.y, 0.0, 1.0));
      reflection = mix(reflection, cloudLight(), max(uWeather.x, uWeather.y));
      if (uHasMirror > 0.5 && vProjected.w > 0.0) {
        vec2 uv = vProjected.xy / vProjected.w * 0.5 + 0.5;
        reflection = texture2D(uMirror, clamp(uv + ripple, 0.003, 0.997)).rgb;
      }
      vec3 body = mix(uShallow, uDeep, smoothstep(0.2, 10.0, depth));
      float shade = ridgeShadow(vLight);
      body *= vec3(1.0) - shade * vec3(0.29, 0.23, 0.15);
      body *= mix(vec3(0.20, 0.31, 0.44), vec3(1.0), uDay);
      float fresnel = 0.15 + 0.48 * pow(1.0 - clamp(eye.y, 0.0, 1.0), 2.6);
      vec3 water = mix(body, reflection, fresnel);
      float fleck = grain(p * vec2(0.19, 0.79) + vec2(t * 0.12, 0.0));
      if (uWeather.y > 0.001) {
        vec2 cell = p * 1.55;
        float age = fract(t * 1.65 + hash(floor(cell)));
        float radius = length(fract(cell) - 0.5);
        float ring = 1.0 - smoothstep(0.009, 0.06, abs(radius - age * 0.48));
        water += cloudLight() * (0.16 * ring * (1.0 - age) * uWeather.y)
          * (1.0 - smoothstep(0.36, 1.7, length((uEye - vPosition) * 0.01)));
      }
      float glitter = smoothstep(0.90, 0.995, wave * 0.73 + chop * 0.27) * smoothstep(0.49, 0.75, fleck);
      float reach = pow(max(dot(reflect(-eye, vec3(0, 1, 0)), uSun), 0.0), 23.0);
      water += (1.0 - shade) * glitter * mix(vec3(0.13, 0.18, 0.16), vec3(0.92, 0.77, 0.49), reach) * (0.2 + uDay);
      float shore = (1.0 - smoothstep(0.10, 0.67, depth)) * (0.5 + 0.5 * fleck);
      water = mix(water, mix(uLow, uShallow, 0.45), shore * 0.55);
      if (uChart > 0.5) water = mix(water, depthInk(vChartDepth) * (0.62 + 0.38 * uDay), 0.82);
      gl_FragColor = vec4(haze(water, vPosition - uEye, 0.0014), 1.0);
    }
  `;
  const rainVertex = `
    attribute vec3 aPosition;
    attribute vec2 aCorner;
    uniform mat4 uVP;
    uniform vec3 uEye, uRight;
    uniform float uTime, uRain;
    varying float vAlpha;
    void main() {
      vec3 box = vec3(64.0, 44.0, 64.0);
      vec3 wind = vec3(6.5, -24.0, 2.0);
      vec3 centre = aPosition * box + wind * (uTime * (0.82 + 0.32 * aPosition.z));
      vec3 offset = mod(centre - uEye + box * 0.5, box) - box * 0.5;
      vec3 edge = abs(offset) * 2.0 / box;
      float fade = 1.0 - smoothstep(0.77, 1.0, max(max(edge.x, edge.y), edge.z));
      vec3 tip = wind * (0.022 + 0.018 * aPosition.y) * aCorner.y;
      vec3 side = uRight * aCorner.x * (0.014 + 0.0006 * length(offset));
      vAlpha = uRain * fade * (0.18 + 0.29 * aCorner.y);
      gl_Position = uVP * vec4(uEye + offset + tip + side, 1.0);
    }
  `;
  const rainFragment = `
    precision highp float;
    varying float vAlpha;
    uniform vec3 uTint;
    void main() { gl_FragColor = vec4(uTint, vAlpha); }
  `;
  const runoffVertex = `
    attribute vec3 aPosition;
    attribute vec2 aFlow;
    uniform mat4 uVP;
    uniform vec3 uEye;
    uniform float uDensity;
    varying vec2 vFlow;
    varying float vFog, vHeight;
    void main() {
      vFlow = aFlow;
      vFog = 1.0 - exp(-length((aPosition - uEye) * uDensity));
      vHeight = aPosition.y;
      gl_Position = uVP * vec4(aPosition, 1.0);
    }
  `;
  const runoffFragment = `
    precision highp float;
    uniform vec3 uTint, uHaze;
    uniform float uTime, uLevel, uReflect;
    varying vec2 vFlow;
    varying float vFog, vHeight;
    void main() {
      if (uReflect > 0.5 && vHeight < uLevel) discard;
      float side = abs(vFlow.y);
      float phase = fract(vFlow.x * 0.105 - uTime * 0.48 + 0.18 * side);
      float crest = 1.0 - smoothstep(0.045, 0.19, abs(phase - 0.5));
      vec3 dye = mix(uTint * vec3(0.35, 0.75, 0.78), uTint, crest);
      gl_FragColor = vec4(mix(dye, uHaze, vFog), 0.91 * (1.0 - smoothstep(0.65, 1.0, side)));
    }
  `;
  const gateVertex = `
    attribute vec3 aPosition, aRing;
    uniform mat4 uVP;
    uniform vec3 uEye;
    uniform float uDensity;
    varying vec3 vRing;
    varying float vFog;
    void main() {
      vRing = aRing;
      vFog = 1.0 - exp(-length((aPosition - uEye) * uDensity));
      gl_Position = uVP * vec4(aPosition, 1.0);
    }
  `;
  const gateFragment = `
    precision highp float;
    uniform vec3 uHaze;
    uniform float uNext, uTime, uDay;
    varying vec3 vRing;
    varying float vFog;
    void main() {
      if (vRing.x < uNext - 0.5) discard;
      float activeGate = 1.0 - step(0.5, abs(vRing.x - uNext));
      float tick = smoothstep(0.64, 0.93, cos(vRing.y * 25.13274));
      float rim = 1.0 - smoothstep(0.20 + tick * 0.31, 0.95, vRing.z);
      float sweep = pow(0.5 + 0.5 * cos(vRing.y * 6.28319 - uTime * 2.6), 9.0);
      vec3 color = mix(vec3(0.41, 0.83, 0.79), vec3(1.0, 0.71, 0.28), activeGate);
      color = mix(color, vec3(1.0, 0.96, 0.79), max(tick * 0.74, activeGate * sweep));
      color *= 0.83 + 0.17 * uDay;
      gl_FragColor = vec4(mix(color, uHaze, vFog), rim * (0.62 + 0.38 * activeGate));
    }
  `;
  return { skyVertex, skyFragment, landVertex, landFragment, waterVertex, waterFragment, rainVertex, rainFragment,
    runoffVertex, runoffFragment, gateVertex, gateFragment, shadowVertex, shadowFragment };
});
