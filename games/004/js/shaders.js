(function (root) {
  'use strict';
  const screen = `
    attribute vec2 aPosition;
    varying vec2 vUv;
    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }`;
  const mirrorPlane = `
    uniform float uTide, uMirror;
    float reflectedHeight(float y) { return uTide + (y - uTide) * uMirror; }`;
  const commonJS = typeof module === 'object' && module.exports;
  const timehouse = commonJS ? require('./timehouse.js') : root.HarbourTimehouse;
  const cableway = commonJS ? require('./cableway.js') : root.HarbourCableway;
  const dialTile = timehouse.dialTile.toFixed(1);
  const ballTile = timehouse.ballTile.toFixed(1);
  const buildingVertex = `
    attribute vec3 aPosition, aNormal, aColor;
    attribute vec2 aUv;
    attribute float aTile;
    uniform mat4 uProjection;
    uniform vec4 uModel;
    uniform float uScale;
    uniform vec2 uHoist, uCabin;
    uniform float uBallLift;
    ${mirrorPlane}
    uniform vec3 uWheel;
    uniform float uTramDirection;
    varying vec2 vUv;
    varying vec3 vNormal, vColor, vWorld;
    varying float vTile, vDepth;
    void main() {
      float c = cos(uModel.w), s = sin(uModel.w);
      mat2 turn = mat2(c, s, -s, c);
      vec3 point = aPosition * uScale;
      point.y += dot(aUv, uHoist);
      point.x += aUv.x * uCabin.x;
      vec3 normal = aNormal;
      mat2 spin = mat2(uWheel.x, uWheel.y, -uWheel.y, uWheel.x);
      vTile = aTile;
      if (aTile == -5.0 || aTile == -6.0) {
        point.y += uTide * aUv.x;
        normal.z -= normal.y * uTide * aUv.y;
        normal = normalize(normal);
        vTile = aTile + 4.0;
      } else if (aTile == ${ballTile}) {
        point.y += uBallLift;
        vTile = -1.0;
      } else if (aTile == ${cableway.sheaveTile.toFixed(1)}) {
        point.xz = aUv + spin * (point.xz - aUv);
        normal.xz = spin * normal.xz;
        vTile = -1.0;
      }
      if (uWheel.z > 0.5) {
        if (uWheel.z < 1.5) {
          point.xy = spin * point.xy;
          normal.xy = spin * normal.xy;
        } else {
          point.xy += spin * aUv;
        }
      }
      point.xz = turn * point.xz;
      point += uModel.xyz;
      vWorld = point;
      vNormal = normal;
      vNormal.xz = turn * normal.xz;
      vColor = aColor;
      if (uCabin.y > 0.5 && aUv.y > 0.5) vColor = vec3(0.81, 0.32, 0.17);
      // Both cabs stay in place. Swap the head and tail lamps at a terminus.
      if (aTile == -4.0) {
        vTile = -2.0;
        if (aPosition.x * uTramDirection < 0.0) vColor = vec3(0.99, 0.19, 0.12);
      }
      vUv = aUv;
      point.y = reflectedHeight(point.y);
      gl_Position = uProjection * vec4(point, 1.0);
      vDepth = gl_Position.w;
    }`;
  const atmosphere = `
    uniform vec3 uWeather;
    uniform vec2 uTwilight;
    vec3 watchColor(vec3 night, vec3 dusk, vec3 dawn) {
      return night + (dusk - night) * uTwilight.x + (dawn - night) * uTwilight.y;
    }
    vec3 airLight() {
      vec3 mist = watchColor(vec3(0.36,0.435,0.452), vec3(0.53,0.41,0.50), vec3(0.64,0.52,0.46));
      return mix(mist, vec3(0.205,0.275,0.323), uWeather.y);
    }`;
  const beamProfile = `
    uniform vec4 uOptics; // range, downward slope, spread and lens radius
    float beamProfile(float along, float radiusSquared) {
      float radius = uOptics.w + along * uOptics.z;
      float edge = max(0.0, 1.0 - radiusSquared / (radius * radius));
      return edge * edge * (1.0 - smoothstep(0.62, 1.0, along / uOptics.x));
    }`;
  const building = `
    precision highp float;
    varying vec2 vUv;
    varying vec3 vNormal, vColor, vWorld;
    varying float vTile, vDepth;
    uniform sampler2D uFacades, uSigns;
    uniform float uTide;
    uniform vec4 uHands;
    uniform float uDialPixel;
    uniform vec3 uLamp;
    uniform vec2 uSweep;
    ${atmosphere}
    ${beamProfile}
    float hand(vec2 point, vec2 direction, float reach, float width, float aa) {
      float along = clamp(dot(point, direction), -0.13, reach);
      float taper = width * (1.0 - 0.53 * max(along, 0.0) / reach);
      return 1.0 - smoothstep(taper - aa, taper + aa, length(point - along * direction));
    }
    vec3 dial(vec2 p) {
      float r = length(p);
      float aa = clamp(vDepth * uDialPixel, 0.004, 0.105);
      vec3 enamel = vColor * (0.97 - 0.24 * r * r);
      vec3 ink = vec3(0.065, 0.13, 0.14);
      if (r > 0.57) {
        float bearing = atan(p.x, p.y);
        // Fold the rim into twelve sectors and measure the distance to a baton.
        float sector = mod(bearing + 0.2617994, 0.5235988) - 0.2617994;
        float tick = 1.0 - smoothstep(0.026 - aa, 0.026 + aa, abs(sin(sector)) * r);
        enamel = mix(enamel, ink, tick * smoothstep(0.68-aa, 0.68+aa, r));
        enamel = mix(enamel, ink, smoothstep(0.93-aa, 0.93+aa, r));
      }
      enamel = mix(enamel, ink, hand(p, uHands.xy, 0.51, 0.071, aa));
      enamel = mix(enamel, vec3(0.38,0.13,0.08), hand(p, uHands.zw, 0.77, 0.044, aa));
      return mix(enamel, vec3(0.65,0.43,0.21), 1.0 - smoothstep(0.064-aa, 0.064+aa, r));
    }
    void main() {
      if (vWorld.y < uTide) discard;
      float shade = 0.71 + 0.27 * max(0.0, dot(vNormal, vec3(-0.58, 0.47, 0.65)));
      float west = max(0.0, dot(vNormal, vec3(-0.81,0.32,0.49)));
      float east = max(0.0, dot(vNormal, vec3(0.80,0.41,0.43)));
      vec3 daylight = vec3(1.0) + uTwilight.x * (vec3(0.13,0.11,0.26) + west * vec3(0.38,0.18,0.18))
                                + uTwilight.y * (vec3(0.20,0.18,0.15) + east * vec3(0.62,0.37,0.16));
      vec3 color;
      bool clockFace = vTile < ${dialTile} + 0.5;
      if (clockFace) {
        color = dial(vUv);
      } else if (vTile < -2.5) {
        color = vColor * daylight + clamp(vWorld.y * 0.0003, 0.0, 0.027);
      } else if (vTile < -1.5) {
        color = vColor;
      } else if (vTile < -0.5) {
        float dry = smoothstep(0.02, 0.66, vWorld.y - uTide);
        color = vColor * shade * daylight * mix(vec3(0.59,0.72,0.77), vec3(1.0), dry);
      } else if (vTile < 15.5) {
        float tile = floor(vTile + 0.5);
        vec2 page = vec2(mod(tile, 4.0), floor(tile / 4.0));
        vec2 uv = fract(vec2(vUv.x / 25.3, -vUv.y / 40.8) + vec2(0.07, 0.032));
        vec3 tex = texture2D(uFacades, (page + uv * 0.996 + 0.002) * 0.25).rgb;
        float lit = smoothstep(0.28, 0.8, max(tex.r, max(tex.g, tex.b)));
        color = tex * vColor * mix(shade * daylight, vec3(1.12), lit);
        color += vec3(0.004,0.012,0.015) * clamp(vWorld.y / 45.0,0.0,1.0);
      } else {
        color = texture2D(uSigns, vUv).rgb * 1.08;
      }
      // The same lens that paints the water also picks out passing hulls and the quay.
      if (vTile > -1.5 && vTile < 15.5 && vWorld.y < uLamp.y + uOptics.w) {
        vec3 rel = vWorld - uLamp;
        float along = dot(rel.xz, uSweep);
        if (along > 0.8 && along < uOptics.x) {
          vec2 offset = vec2(dot(rel.xz, vec2(-uSweep.y, uSweep.x)), rel.y + along * uOptics.y);
          float facing = max(0.0, dot(vNormal, vec3(-uSweep.x, uOptics.y, -uSweep.y)));
          color += vec3(0.51,0.35,0.16) * facing * beamProfile(along, dot(offset, offset));
        }
      }
      if (vTile > -2.5 || clockFace) {
        float mist = 1.0 - exp(-max(vDepth - 40.0, 0.0) * 0.0025);
        vec3 distanceColor = watchColor(vec3(0.182,0.248,0.282), vec3(0.34,0.29,0.40), vec3(0.45,0.375,0.355));
        color = mix(color, distanceColor, mist * 0.84);
      }
      float lowBank = mix(1.35, 0.46, smoothstep(5.0, 59.0, vWorld.y));
      float fog = 1.0 - exp(-max(vDepth - 9.0, 0.0) * lowBank * uWeather.x * 0.013);
      color = mix(color, airLight(), fog);
      gl_FragColor = vec4(color,1.0);
    }`;
  const environment = `
    precision highp float;
    varying vec2 vUv;
    uniform vec3 uEye, uForward, uRight, uUp;
    uniform vec2 uLens;
    uniform vec4 uFerryWake, uLaunchWake, uJunkWake;
    uniform float uTime, uMirror, uPixel, uTide;
    uniform sampler2D uReflection, uNoise;
    ${atmosphere}
    float noise(vec2 st) { return texture2D(uNoise,st).r; }
    float hash(vec2 p) {
      vec3 v = fract(vec3(p.xyx) * 0.1031);
      v += dot(v, v.yzx + 33.33);
      return fract((v.x + v.y) * v.z);
    }
    vec3 sky(vec3 rd) {
      float h = max(rd.y, 0.0);
      float az = dot(rd.xz, rd.xz) > 0.000001 ? atan(rd.x, -rd.z) : 0.0;
      vec3 horizon = watchColor(vec3(0.309,0.389,0.416), vec3(0.65,0.44,0.51), vec3(0.83,0.64,0.49));
      vec3 zenith = watchColor(vec3(0.062,0.106,0.157), vec3(0.115,0.16,0.36), vec3(0.19,0.32,0.47));
      vec3 col = mix(horizon, zenith, 1.0-exp(-4.0*h));
      float night = max(0.0, 1.0 - uTwilight.x - uTwilight.y);
      col = mix(col,vec3(0.025,0.053,0.090),smoothstep(0.22,0.95,h)*0.62*night);
      vec2 p = vec2(az*0.045 + 0.31, h*0.215 + 0.21);
      p.x += uTime * (0.000013 + 0.00010 * uWeather.y);
      float cloud = noise(p)*0.52 + noise(p*2.11+0.39)*0.3 + noise(p*4.21-0.16)*0.18;
      float bank = smoothstep(0.38,0.80,cloud)*smoothstep(0.01,0.15,h);
      col += watchColor(vec3(0.068,0.062,0.068), vec3(0.19,0.11,0.16), vec3(0.21,0.15,0.095))*bank;
      col += vec3(0.050,0.024,0.009)*exp(-abs(h-0.075)*9.0);
      if (uTwilight.x > 0.0) {
        col += uTwilight.x * vec3(0.34,0.12,0.08) * exp(-2.7 * length(rd - normalize(vec3(-0.72,0.09,-1.0))));
      }
      if (uTwilight.y > 0.0) {
        float sunDistance = length(rd - normalize(vec3(0.62,0.26,-1.0)));
        col += uTwilight.y * vec3(0.43,0.22,0.09) * exp(-5.5 * sunDistance);
        float sun = 1.0 - smoothstep(0.020-uPixel, 0.020+uPixel, sunDistance);
        col = mix(col, vec3(1.0,0.86,0.62), sun * uTwilight.y * (1.0 - bank * 0.6));
      }
      if (night + uTwilight.x > 0.0) {
        vec2 stars = vec2(az,h)*vec2(115.0,122.0);
        vec2 id = floor(stars);
        vec2 pos = (vec2(hash(id+7.3),hash(id-12.1))-0.5)*0.61;
        float sparkle = 1.0-smoothstep(0.028,0.145,length(fract(stars)-0.5-pos));
        col += vec3(0.54,0.63,0.68)*sparkle*step(0.949,hash(id))*(1.0-bank)*smoothstep(0.08,0.29,h)*(night + 0.17 * uTwilight.x);
        vec3 moon = normalize(vec3(0.58,0.379,-1.0));
        float md = length(rd-moon);
        float disc = 1.0-smoothstep(0.015-uPixel,0.015+uPixel,md);
        float shade = smoothstep(0.0142-uPixel,0.0142+uPixel,length(rd-normalize(moon+vec3(-0.006,0.005,0.0))));
        col += vec3(0.14,0.14,0.12)*exp(-md*32.0)*night;
        col = mix(col,vec3(0.92,0.91,0.78),disc*(0.07+0.93*shade)*(night + 0.23 * uTwilight.x));
      }
      float veil = uWeather.x * (0.28 + 0.68 * exp(-3.4 * h));
      col = mix(col, airLight(), veil);
      vec3 overcast = mix(vec3(0.091,0.128,0.168), vec3(0.245,0.295,0.32), cloud);
      col = mix(col, overcast, uWeather.y * (0.35 + 0.55 * bank));
      return col;
    }
    float wakeAt(vec2 p, vec4 boat, float hullScale) {
      vec2 rel = (p - boat.xy) / hullScale;
      float along = dot(rel, boat.zw);
      float across = abs(dot(rel, vec2(-boat.w, boat.z)));
      return exp(-abs(across+along*0.17-0.5)*2.8)*smoothstep(4.8,8.0,-along)*(1.0-smoothstep(9.0,29.0,-along));
    }
    float rainRing(vec2 point, float time) {
      vec2 cell = floor(point);
      vec2 center = 0.33 + 0.34 * vec2(hash(cell + 2.2), hash(cell - 7.3));
      float age = fract(time * 1.15 + hash(cell));
      float edge = abs(length(fract(point) - center) - age * 0.34);
      return (1.0 - smoothstep(0.013, 0.049, edge)) * (1.0 - age) * smoothstep(0.0, 0.10, age);
    }
    vec3 water(vec3 rd) {
      float distance = (uTide - uEye.y) / min(rd.y,-0.0001);
      vec2 p = uEye.xz + rd.xz * distance;
      float nearWave = 1.0-smoothstep(22.0,210.0,distance);
      float t = mod(uTime, 20000.0);
      float a = noise(p*vec2(0.0019,0.013) + vec2(t*0.00022,-t*0.0019))-0.5;
      float b = noise(p*vec2(0.0048,0.034) + vec2(-t*0.00042,t*0.0026))-0.5;
      float wave = sin(p.y*1.28+p.x*0.10+3.6*a+t*1.05);
      float fine = sin(p.y*3.48-p.x*0.24+3.3*b-t*1.41);
      float ripple = 0.54*a+0.25*b+0.14*wave+0.07*fine;
      vec2 offset = vec2((a*0.77 + b*0.46 + wave*0.16)*(0.003+nearWave*0.022),
                         ripple*(0.013+nearWave*0.082));
      offset *= 1.0 + 0.52 * uWeather.z;
      vec2 sampleUv = clamp(vUv+offset,vec2(0.002),vec2(0.998));
      vec3 image = texture2D(uReflection,sampleUv).rgb;
      vec3 soft = texture2D(uReflection,clamp(sampleUv+vec2(0.0013+nearWave*0.004,b*0.012),0.002,0.998)).rgb;
      image = mix(image,soft,0.24);
      float brightness = max(image.r,max(image.g,image.b));
      float sparkle = smoothstep(0.27,0.75,brightness);
      vec3 deep = mix(vec3(0.12,0.204,0.239),vec3(0.045,0.103,0.131),nearWave);
      deep += uTwilight.x * vec3(0.054,0.024,0.080) + uTwilight.y * vec3(0.089,0.067,0.042);
      vec3 col = mix(deep, image*vec3(0.84,0.91,0.93),0.63+sparkle*0.27);
      col *= 0.84 + ripple*(0.48+nearWave*0.42);
      col += vec3(0.060,0.092,0.099) * smoothstep(0.15,0.46,ripple) * (0.4+nearWave);
      float wake = wakeAt(p,uFerryWake,1.0) + 0.72*wakeAt(p,uLaunchWake,0.64) + 0.57*wakeAt(p,uJunkWake,1.0);
      col += vec3(0.14,0.21,0.21)*wake*(0.55+0.6*b);
      if (uWeather.y > 0.0 && distance < 85.0) {
        float impacts = rainRing(p * 0.69, t) * (1.0 - smoothstep(17.0, 85.0, distance));
        col += vec3(0.17, 0.24, 0.26) * impacts * uWeather.y;
      }
      col = mix(col, airLight(), uWeather.x * 0.48 * smoothstep(20.0, 185.0, distance));
      return col;
    }
    void main() {
      vec2 plane = (vUv*2.0-1.0)*uLens;
      vec3 rd = normalize(uForward+uRight*plane.x+uUp*plane.y);
      vec3 col;
      if (uMirror < 0.0) { rd.y = -rd.y; col = sky(rd); }
      else if (rd.y < -0.0005) col = water(rd);
      else col = sky(rd);
      gl_FragColor = vec4(col,1.0);
    }`;
  const lanternVertex = `
    attribute vec3 aSail, aCurrent, aFlower, aColor;
    attribute vec2 aCorner;
    uniform vec3 uOrigin, uWeights, uWeather;
    uniform vec2 uTwilight;
    uniform mat4 uProjection;
    uniform vec4 uLampSize;
    ${mirrorPlane}
    varying vec2 vCorner;
    varying vec3 vLight;
    void main() {
      vec3 point = uOrigin + aSail * uWeights.x + aCurrent * uWeights.y + aFlower * uWeights.z;
      point.y = reflectedHeight(point.y);
      vec4 clip = uProjection * vec4(point, 1.0);
      // A small pixel floor keeps each soft light legible in the reduced mirror.
      clip.xy += aCorner * max(uLampSize.xy, clip.w * uLampSize.zw);
      gl_Position = clip;
      vCorner = aCorner;
      vec3 tint = mix(aColor, aColor.brg, 0.65 * uWeights.y);
      tint = mix(tint, vec3(0.98,0.47,0.68) + 0.18 * aColor, 0.69 * uWeights.z);
      float clarity = exp(-max(clip.w - 9.0, 0.0) * uWeather.x * 0.006);
      vLight = tint * clarity * (1.0 - 0.21 * uTwilight.y - 0.08 * uTwilight.x);
    }`;
  const lantern = `
    precision highp float;
    varying vec2 vCorner;
    varying vec3 vLight;
    void main() {
      float r = dot(vCorner, vCorner);
      float core = 1.0 - smoothstep(0.018, 0.13, r);
      float halo = max(1.0 - r, 0.0);
      gl_FragColor = vec4(vLight * (0.95 * core + 0.34 * halo * halo * halo), 0.0);
    }`;
  const beaconVertex = `
    attribute vec3 aBeam;
    uniform mat4 uProjection;
    uniform vec3 uLamp, uEye, uWeather, uContact;
    uniform vec2 uSweep, uLens, uTwilight;
    uniform vec4 uOptics;
    ${mirrorPlane}
    varying vec3 vSample;
    varying float vPart, vGain;
    void main() {
      vPart = aBeam.z;
      vec3 axis = vec3(uSweep.x, -uOptics.y, uSweep.y);
      vec3 eye = vec3(uEye.x, reflectedHeight(uEye.y), uEye.z);
      vec3 toEye = eye - uLamp;
      float daylight = 1.0 - 0.22 * uTwilight.x - 0.53 * uTwilight.y;
      vec3 point;
      vec2 flare = vec2(0.0);
      if (vPart < 0.5) {
        float along = aBeam.x * uOptics.x;
        float across = aBeam.y * (uOptics.w + along * uOptics.z);
        vec3 side = cross(axis, toEye);
        if (dot(side, side) < 0.000001) side = vec3(-uSweep.y, 0.0, uSweep.x);
        point = uLamp + axis * along + normalize(side) * across;
        vSample = vec3(along, across, point.y - uTide);
        vGain = daylight * (0.21 + 0.40 * uWeather.x + 0.10 * uWeather.y);
      } else if (vPart < 1.5) {
        float alignment = dot(normalize(axis), toEye / max(length(toEye), 0.001));
        float flash = smoothstep(0.87, 0.997, alignment);
        point = uLamp + axis * 0.80;
        flare = aBeam.xy * mix(1.04, 2.9, flash) / uLens;
        vSample = vec3(aBeam.xy, 0.0);
        vGain = daylight * (0.27 + 0.95 * flash);
      } else {
        float along = mix(uContact.x, uContact.z, aBeam.x);
        float across = aBeam.y * (uOptics.w + along * uOptics.z);
        vec2 water = uLamp.xz + uSweep * along + vec2(-uSweep.y, uSweep.x) * across;
        point = vec3(water.x, uTide, water.y);
        vSample = vec3(along, across, (uContact.y - along) * uOptics.y);
        vGain = daylight * (0.46 - 0.13 * uWeather.x);
      }
      point.y = reflectedHeight(point.y);
      gl_Position = uProjection * vec4(point, 1.0);
      gl_Position.xy += flare;
      // The reflected shaft already reaches the water. Paint the surface glint once.
      if (vPart > 1.5 && uMirror < 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    }`;
  const beacon = `
    precision highp float;
    ${beamProfile}
    uniform float uPhase;
    varying vec3 vSample;
    varying float vPart, vGain;
    void main() {
      float light;
      if (vPart > 0.5 && vPart < 1.5) {
        float r = dot(vSample.xy, vSample.xy);
        float halo = max(1.0 - r, 0.0);
        light = exp(-19.0 * r) + 0.38 * halo * halo * halo;
      } else {
        float crossSection = vSample.y * vSample.y;
        if (vPart < 0.5 && vSample.z < 0.0) discard;
        if (vPart > 1.5) crossSection += vSample.z * vSample.z;
        light = beamProfile(vSample.x, crossSection);
        if (vPart > 1.5) {
          float ripple = sin(vSample.x * 2.4 + sin(vSample.y * 0.7 + uPhase) - uPhase);
          light *= 0.32 + 0.68 * smoothstep(-0.28, 0.83, ripple);
        }
      }
      gl_FragColor = vec4(vec3(1.0, 0.76, 0.44) * light * vGain, 0.0);
    }`;
  const extract = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uImage;
    uniform vec2 uTexel;
    vec3 glow(vec2 uv) {
      vec3 s = texture2D(uImage,uv).rgb;
      return s*smoothstep(0.37,0.86,max(s.r,max(s.g,s.b)));
    }
    void main() {
      vec2 d = uTexel*0.97;
      gl_FragColor = vec4((glow(vUv-d)+glow(vUv+d)+glow(vUv+vec2(-d.x,d.y))+glow(vUv+vec2(d.x,-d.y)))*0.25,1.0);
    }`;
  const blur = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uImage;
    uniform vec2 uStep;
    void main() {
      vec3 s = texture2D(uImage,vUv).rgb * 0.227027;
      s += (texture2D(uImage,vUv+uStep*1.384615).rgb+texture2D(uImage,vUv-uStep*1.384615).rgb)*0.316216;
      s += (texture2D(uImage,vUv+uStep*3.230769).rgb+texture2D(uImage,vUv-uStep*3.230769).rgb)*0.070270;
      gl_FragColor = vec4(s,1.0);
    }`;
  const finish = `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D uImage, uBloom;
    uniform vec3 uRain;
    float streaks(vec2 p, float time) {
      // Each slanted column carries drops of a different length and speed.
      vec2 grid = vec2((p.x + 0.17 * p.y) * 124.0, p.y * 10.0);
      float lane = fract(sin(mod(floor(grid.x), 911.0) * 78.217) * 4375.47);
      grid.y += time * (4.8 + lane * 2.2) + lane * 23.0;
      float bead = fract(floor(grid.y) * (0.619 + lane * 0.11) + lane * 97.3);
      float shaft = 1.0 - smoothstep(0.025, 0.13, abs(fract(grid.x) - mix(0.17, 0.83, bead)));
      float drop = smoothstep(0.75 - 0.18 * bead, 0.93, fract(grid.y)) * (1.0 - smoothstep(0.93, 1.0, fract(grid.y)));
      return shaft * drop * smoothstep(0.28, 0.88, bead) * (0.48 + 0.52 * lane);
    }
    void main() {
      vec3 col = texture2D(uImage,vUv).rgb;
      vec3 bloom = texture2D(uBloom,vUv).rgb;
      col += bloom * vec3(0.87,0.73,0.66);
      if (uRain.x > 0.0) {
        vec2 p = (vUv - 0.5) * vec2(uRain.z, 1.0);
        float drops = streaks(p, uRain.y) + 0.43 * streaks(p * 1.56 + 0.31, uRain.y * 0.81);
        col += vec3(0.19, 0.25, 0.29) * drops * uRain.x;
      }
      float vignette = 1.0 - 0.105 * dot((vUv-0.5)*1.55,(vUv-0.5)*1.55);
      float grain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056,0.00583715))))-0.5;
      gl_FragColor = vec4(col*vignette+grain*0.009,1.0);
    }`;
  root.HarbourShaders = {screen, buildingVertex, building, environment, lanternVertex, lantern, beaconVertex, beacon, extract, blur, finish};
  if (commonJS) module.exports = root.HarbourShaders;
})(typeof globalThis !== 'undefined' ? globalThis : this);
