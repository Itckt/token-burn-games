/* GLSL ES 1.00. All geometry is in the café's world coordinate system. */
(function () {
  'use strict';
  const local = typeof module === 'object' && module.exports;
  const art = local ? require('./art.js') : PocketPlaces.art;
  const {hub} = local ? require('./fan.js') : PocketPlaces.fan;
  const {cup} = local ? require('./tea.js') : PocketPlaces.tea;
  const cat = local ? require('./shop-cat.js') : PocketPlaces.shopCat;
  const radio = local ? require('./radio.js') : PocketPlaces.radio;
  const blinds = local ? require('./blinds.js') : PocketPlaces.blinds;
  const toast = local ? require('./toast.js') : PocketPlaces.toast;
  const till = local ? require('./till.js') : PocketPlaces.till;
  const {parts} = local ? require('./mesh.js') : PocketPlaces.mesh;
  const {bus} = local ? require('./street.js') : PocketPlaces.street;
  const [u,v,right,bottom] = art.regions.street;
  const [bu,bv,br,bb] = art.regions.minibus;
  const vec2 = (x,y) => 'vec2('+x.toFixed(8)+', '+y.toFixed(8)+')';

  // The depth-tested pick uses precisely the pose that was drawn to the screen.
  const pose = `
    uniform vec2 u_rotor, u_liquid, u_walk, u_tuning;
    uniform mediump float u_blind;
    uniform vec2 u_slice, u_till;
    uniform mediump vec4 u_catPose;
    const vec2 fanHub = ${vec2(hub[0],hub[1])};
    const vec2 cupCenter = ${vec2(cup.x,cup.z)};
    const float blade = ${parts.fanBlade.toFixed(1)}, tea = ${parts.teaSurface.toFixed(1)};
    const float fur = ${parts.catBody.toFixed(1)}, leftPaw = ${parts.catLeft.toFixed(1)}, rightPaw = ${parts.catRight.toFixed(1)};
    const float needle = ${parts.radioNeedle.toFixed(1)}, pilotLamp = ${parts.radioLamp.toFixed(1)};
    const vec2 catMat = ${vec2(...cat.home)};
    const vec2 pawDirection = ${vec2(Math.sin(cat.homeYaw),Math.cos(cat.homeYaw))};
    const vec2 dialTravel = ${vec2(.133*Math.cos(radio.yaw),-.133*Math.sin(radio.yaw))};
    const float cloth = ${parts.blindCloth.toFixed(1)}, hem = ${parts.blindHem.toFixed(1)};
    const float nearSlice = ${parts.toastNear.toFixed(1)}, farSlice = ${parts.toastFar.toFixed(1)};
    const float drawer = ${parts.tillDrawer.toFixed(1)};
    const float rollerY = ${blinds.top.toFixed(4)}, valance = ${blinds.valance}, rollout = ${blinds.travel};
    mat2 spin() { return mat2(u_rotor.x, u_rotor.y, -u_rotor.y, u_rotor.x); }
    mat2 catTurn() { return mat2(u_catPose.z, -u_catPose.w, u_catPose.w, u_catPose.z); }
    bool isCat(float part) { return part >= fur && part <= rightPaw; }
    vec3 posed(vec3 p, float part) {
      if (part == blade) p.xy = fanHub + spin() * (p.xy - fanHub);
      if (part == tea) {
        p.xz = cupCenter + (p.xz - cupCenter) * u_liquid.x;
        p.y += u_liquid.y;
      }
      if (isCat(part)) {
        if (part == leftPaw || part == rightPaw) {
          float stride = part == leftPaw ? u_walk.y : -u_walk.y;
          p.xz += stride * pawDirection;
          p.y += max(0.0, stride) * 0.52 - u_walk.x * 1.52;
        }
        p.xz = u_catPose.xy + catTurn() * (p.xz - catMat);
        p.y += u_walk.x;
      }
      if (part == needle) p.xz += dialTravel * u_tuning.x;
      if (part == cloth) p.y -= (rollerY-p.y) * (rollout/valance) * u_blind;
      if (part == hem) p.y -= rollout * u_blind;
      if (part == nearSlice || part == farSlice) {
        p.xz += ${vec2(...toast.travel)} * (part == nearSlice ? u_slice.x : -u_slice.x);
      }
      if (part == drawer) p.xz += ${vec2(...till.travel)} * u_till.x;
      return p;
    }
  `;

  const precision = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
  `;
  const surface = {
    vertex: `
      attribute vec3 a_position, a_normal, a_color;
      attribute vec2 a_uv;
      attribute vec3 a_material;
      uniform mat4 u_camera, u_light;
      uniform vec3 u_teaTint;
      varying mediump vec3 v_normal, v_color, v_position;
      varying mediump vec4 v_shadow;
      varying mediump vec3 v_material;
      varying mediump vec2 v_uv, v_street;
      ${pose}
      void main() {
        v_normal = a_normal;
        if (a_material.z == blade) v_normal.xy = spin() * a_normal.xy;
        if (isCat(a_material.z)) v_normal.xz = catTurn() * a_normal.xz;
        v_color = a_color;
        if (a_material.z == tea) v_color *= u_teaTint;
        if (a_material.z == pilotLamp) v_color = mix(a_color, vec3(1.65, 0.95, 0.32), u_tuning.y);
        vec3 p = posed(a_position, a_material.z);
        v_position = p;
        v_uv = a_uv;
        if (a_material.z == cloth) {
          float lowerEdge = ${art.regions.blind[3]};
          v_uv.y = lowerEdge + (a_uv.y-lowerEdge) * (valance+rollout*u_blind)/(valance+rollout);
        }
        if ((a_material.z == nearSlice || a_material.z == farSlice) && a_uv.x < 0.99) {
          v_uv.x += u_slice.y * ${art.regions.toastSyrup[0]-art.regions.toastPlain[0]};
        }
        if (a_material.z == ${parts.tillTens.toFixed(1)} || a_material.z == ${parts.tillOnes.toFixed(1)}) {
          float digit = a_material.z == ${parts.tillTens.toFixed(1)} ? floor(u_till.y / 10.0) : mod(u_till.y, 10.0);
          v_uv.x += digit * ${art.blocks.digits[2]/10/art.SIZE};
        }
        v_material = a_material;
        // All three sashes share one panoramic coordinate system.
        v_street = vec2(-1.0);
        if (a_uv.x >= ${u} && a_uv.x <= ${right} && a_uv.y >= ${v} && a_uv.y <= ${bottom}) {
          v_street = (a_uv - ${vec2(u,v)}) * ${vec2(1/(right-u),1/(bottom-v))};
        }
        v_shadow = u_light * vec4(p, 1.0);
        gl_Position = u_camera * vec4(p, 1.0);
      }
    `,
    fragment: precision + `
      uniform sampler2D u_atlas, u_shadow;
      uniform vec3 u_sun, u_eye;
      uniform float u_shadowStep, u_hover;
      uniform float u_rain, u_night, u_rainTime, u_busLeft;
      uniform float u_swirl;
      uniform mediump float u_blind;
      uniform mediump vec4 u_catPose;
      varying mediump vec3 v_normal, v_color, v_position;
      varying mediump vec4 v_shadow;
      varying mediump vec3 v_material;
      varying mediump vec2 v_uv, v_street;

      vec3 windowPrint(vec3 paper) {
        if (u_night > 0.0) {
          vec2 nightUV = v_uv + ${vec2(art.regions.streetNight[0]-u,art.regions.streetNight[1]-v)};
          paper = mix(paper, texture2D(u_atlas, nightUV).rgb, u_night);
        }
        vec2 vehicle = (v_street - vec2(u_busLeft, ${bus.top})) / ${vec2(bus.width,bus.height)};
        // The print has a clear margin. Clamping keeps implicit texture derivatives
        // available even on fragments straddling the edge of the moving artwork.
        vec4 ink = texture2D(u_atlas, ${vec2(bu,bv)} + clamp(vehicle, 0.0, 1.0) * ${vec2(br-bu,bb-bv)});
        float inside = step(0.0, min(vehicle.x, vehicle.y)) * step(max(vehicle.x, vehicle.y), 1.0);
        paper = mix(paper, ink.rgb * mix(vec3(1.0), vec3(0.81, 0.80, 0.83), u_night), inside * ink.a);
        if (u_rain > 0.0) {
          float lane = v_street.x * 42.0 + v_street.y * 0.78;
          float seed = fract(floor(lane) * 0.618);
          float fall = fract(v_street.y * 2.6 - u_rainTime + seed * 5.0);
          float bead = 1.0 - smoothstep(0.025, 0.12, abs(fract(lane) - 0.5));
          float trail = smoothstep(0.06, 0.55, fall) * (1.0 - smoothstep(0.55, 0.64, fall));
          paper *= mix(vec3(1.0), vec3(0.70, 0.83, 0.91), u_rain);
          paper = mix(paper, vec3(0.88, 0.95, 0.95), bead * trail * u_rain * 0.82);
        }
        return paper;
      }

      float kitchenLight(vec3 p) {
        // The two booth lamps and the light under the striped serving hatch.
        float alongWall = min(abs(p.z - 1.08), abs(p.z + 1.03));
        vec3 booth = vec3(p.x + 3.80, p.y - 2.82, alongWall);
        vec3 hatch = vec3(max(abs(p.x - 0.71) - 1.50, 0.0), p.y - 2.60, p.z + 2.80);
        return 1.4 / (1.0 + dot(booth, booth)*1.2) + 0.9 / (1.0 + dot(hatch, hatch));
      }

      float sunlight(vec3 normal) {
        vec3 p = v_shadow.xyz / v_shadow.w * 0.5 + 0.5;
        float bias = 0.00055 + 0.0014 * (1.0 - max(dot(normal, u_sun), 0.0));
        float light = 0.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 offset = vec2(float(x), float(y)) * u_shadowStep * 1.55;
            vec2 sampleDepth = texture2D(u_shadow, p.xy + offset).rg;
            float closest = dot(sampleDepth, vec2(1.0, 1.0 / 255.0));
            light += step(p.z - bias, closest);
          }
        }
        return light / 9.0;
      }
      void main() {
        vec4 ink = texture2D(u_atlas, v_uv);
        if (ink.a < 0.45) discard;
        bool windowPane = v_street.x >= -0.01;
        if (windowPane) ink.rgb = windowPrint(ink.rgb);
        vec3 n = normalize(v_normal);
        float direct = max(dot(n, u_sun), 0.0);
        float visibility = sunlight(n);
        float sky = 0.5 + 0.5 * n.y;
        vec3 bounce = mix(vec3(0.48, 0.45, 0.38), vec3(0.74, 0.77, 0.73), sky);
        vec3 fill = vec3(0.10, 0.12, 0.13) * max(dot(n, vec3(0.86, 0.24, 0.44)), 0.0);
        vec3 lamp = vec3(0.43, 0.38, 0.31) * direct * visibility;
        vec3 halfVector = normalize(u_sun + normalize(u_eye - v_position));
        float glint = pow(max(dot(halfVector, n), 0.0), 36.0) * v_material.y * visibility;
        vec3 color = ink.rgb * v_color * (bounce + lamp + fill) + vec3(0.48, 0.43, 0.32) * glint;
        if (u_blind > 0.0 && v_position.x > -4.12 && n.y > 0.1) {
          float run = v_position.x + 4.15;
          float atGlass = v_position.y + 0.82 * run;
          float bottomEdge = ${(blinds.top-blinds.valance).toFixed(4)} - ${blinds.travel} * u_blind;
          float band = smoothstep(bottomEdge-0.16,bottomEdge+0.13,atGlass) * (1.0-smoothstep(2.86,3.14,atGlass));
          float sash = abs(mod(v_position.z + 0.95, 2.06) - 1.03);
          float shade = band * (1.0-smoothstep(0.83,1.02,sash)) * (1.0-smoothstep(1.0,3.5,run));
          color *= 1.0 - 0.28 * shade * smoothstep(0.0,0.18,u_blind);
        }
        color *= mix(vec3(1.0), vec3(0.80, 0.89, 0.95), u_rain);
        if (u_night > 0.0) {
          float enamelSign = smoothstep(3.45, 3.75, v_position.y);
          vec3 tungsten = vec3(0.86, 0.53, 0.25) * (kitchenLight(v_position) + enamelSign*0.59);
          vec3 evening = ink.rgb * v_color * (vec3(0.40, 0.48, 0.62) + tungsten + lamp*0.20);
          if (windowPane) evening = ink.rgb;
          color = mix(color, evening, u_night);
        }
        if (v_material.z == ${parts.teaSurface.toFixed(1)} && u_swirl > 0.0) {
          vec2 q = v_position.xz - ${vec2(cup.x,cup.z)};
          float ripple = sin(88.0 * length(q) + sin(q.x * 19.0) + 9.0 * u_swirl);
          color = mix(color, vec3(0.97, 0.79, 0.56), smoothstep(0.3, 0.95, ripple) * u_swirl * 0.33);
        }
        if (v_position.y < 0.12 && n.y > 0.55) {
          vec2 pawPrint = (v_position.xz - u_catPose.xy) * vec2(2.4, 2.1);
          color *= mix(0.67, 1.0, smoothstep(0.04, 1.0, dot(pawPrint, pawPrint)));
        }
        float hover = 1.0 - step(0.4, abs(v_material.x - u_hover));
        gl_FragColor = vec4(mix(color, vec3(1.0, 0.84, 0.58), 0.10 * hover), 1.0);
      }
    `
  };

  function maskVertex(picking) { return `
    attribute vec3 a_position;
    attribute vec2 a_uv;
    attribute vec3 a_material;
    uniform mat4 u_camera;
    varying mediump vec2 v_uv;
    varying mediump float v_id;
    ${picking ? pose : ''}
    void main() {
      v_uv = a_uv;
      v_id = a_material.x;
      gl_Position = ${picking ? 'u_camera * vec4(posed(a_position, a_material.z), 1.0)' :
        'a_material.z > 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : u_camera * vec4(a_position, 1.0)'};
    }
  `; }
  const maskFragment = precision + `
    uniform sampler2D u_atlas;
    varying mediump vec2 v_uv;
    varying mediump float v_id;
    void main() {
      if (texture2D(u_atlas, v_uv).a < 0.45) discard;
  `;
  const shadow = {vertex:maskVertex(false), fragment:maskFragment + `
      float z = min(gl_FragCoord.z, 0.99999);
      vec2 packedDepth = fract(z * vec2(1.0, 255.0));
      packedDepth.x -= packedDepth.y / 255.0;
      gl_FragColor = vec4(packedDepth, 0.0, 1.0);
    }
  `};
  const pick = {vertex:maskVertex(true), fragment:maskFragment + `
      gl_FragColor = vec4(v_id / 255.0, 0.0, 0.0, 1.0);
    }
  `};
  const ground = {
    vertex: `
      attribute vec2 a_ground;
      uniform mat4 u_camera;
      varying mediump vec2 v_floor;
      void main() {
        v_floor = a_ground;
        gl_Position = u_camera * vec4(a_ground.x, -0.532, a_ground.y, 1.0);
      }
    `,
    fragment: precision + `
      varying mediump vec2 v_floor;
      float boxDistance(vec2 p, vec2 size) {
        vec2 q = abs(p) - size;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
      }
      void main() {
        float contact = boxDistance(v_floor - vec2(0.05, -0.03), vec2(4.48, 3.30)) - 0.17;
        float soft = boxDistance(v_floor - vec2(0.32, -0.24), vec2(4.32, 3.10)) - 0.20;
        float alpha = 0.23 * (1.0 - smoothstep(-0.12, 0.29, contact))
                    + 0.19 * (1.0 - smoothstep(-0.58, 0.86, soft));
        gl_FragColor = vec4(0.33, 0.24, 0.15, alpha);
      }
    `
  };
  const steam = {
    vertex: `
      attribute vec3 a_position;
      attribute vec2 a_wisp;
      uniform mat4 u_camera;
      varying mediump vec2 v_wisp;
      void main() {
        v_wisp = a_wisp;
        gl_Position = u_camera * vec4(a_position, 1.0);
      }
    `,
    fragment: precision + `
      varying mediump vec2 v_wisp;
      void main() {
        float feather = 1.0 - smoothstep(0.08, 1.0, abs(v_wisp.x));
        gl_FragColor = vec4(1.0, 0.977, 0.89, feather * v_wisp.y);
      }
    `
  };

  const api = {surface, shadow, pick, ground, steam};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else PocketPlaces.shaders = api;
})();
