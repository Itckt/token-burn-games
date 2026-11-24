(function () {
  'use strict';
  const { BLADE } = Nightline.weather;
  const { PART, STRAP_RAIL } = Nightline.mesh;
  const { DIVIDER, ATLAS_SIZE, ROWS } = Nightline.saloon;

  const VERTEX = `
    attribute vec3 aPosition, aNormal, aSurface;
    attribute vec4 aColor;
    attribute vec2 aUV;
    attribute vec2 aTrackPart;
    uniform mat4 uViewProjection;
    uniform vec3 uOrigin;
    uniform vec2 uRotation;
    uniform float uDoor;
    uniform float uBladeAngle;
    uniform float uAspect;
    uniform float uGuardLamp;
    uniform vec4 uSwing;
    uniform vec4 uRiders[${Nightline.passengers.MAX_WAITING + 1}];
    uniform mediump float uSky;
    varying mediump vec3 vPosition, vNormal, vLocal;
    varying mediump vec4 vColor;
    varying mediump vec2 vUV;
    varying mediump vec3 vSurface;
    vec3 turn(vec3 p) {
      return vec3(p.x*uRotation.x-p.z*uRotation.y, p.y, p.x*uRotation.y+p.z*uRotation.x);
    }
    vec3 swingGrip(vec3 p) {
      vec2 yz = mat2(uSwing.z,-uSwing.w,uSwing.w,uSwing.z)*p.yz;
      vec2 xy = mat2(uSwing.x,uSwing.y,-uSwing.y,uSwing.x)*vec2(p.x,yz.x);
      return vec3(xy,yz.y);
    }
    void main() {
      vec3 p = aPosition;
      vec3 normal = aNormal;
      float part = aTrackPart.y;
      float trackOffset = aTrackPart.x;
      if (part == ${PART.WIPER}.0) {
        vec2 pivot = vec2(${BLADE.x}, ${BLADE.y});
        float s = sin(uBladeAngle), c = cos(uBladeAngle);
        mat2 rotate = mat2(c, -s, s, c);
        p.xy = pivot + rotate * (p.xy - pivot);
        normal.xy = rotate * normal.xy;
      } else if (part == ${PART.STRAP}.0) {
        vec3 hinge = vec3(sign(p.x)*${STRAP_RAIL.x},${STRAP_RAIL.y},aTrackPart.x);
        p = hinge + swingGrip(p-hinge);
        normal = swingGrip(normal);
        trackOffset = 0.0;
      } else if (part >= ${PART.RIDER}.0) {
        vec4 rider = uRiders[int(part) - ${PART.RIDER}];
        p.x += (rider.w-1.0)*sign(p.z)*0.20*(1.0-smoothstep(0.08,0.78,p.y));
        if (part == ${PART.RIDER + Nightline.passengers.MAX_WAITING}.0) { p.xz = -p.xz; normal.xz = -normal.xz; }
        p = p * step(0.001,rider.w) + rider.xyz;
      }
      p.z += aSurface.z * uDoor;
      vLocal = p-vec3(trackOffset,0.0,0.0); vPosition = turn(p) + uOrigin; vNormal = turn(normal);
      vUV = aUV; vColor = aColor; vSurface = vec3(aSurface.xy, part);
      if (part == ${PART.GUARD_LAMP}.0) {
        if (uGuardLamp > 0.5) {
          vColor.rgb = uGuardLamp > 2.5 ? vec3(0.48,1.0,0.71)
                     : uGuardLamp > 1.5 ? vec3(0.85,0.96,1.0) : vec3(1.0,0.64,0.23);
          vSurface.y = 0.94;
        }
      } else if (part < -0.5 && part > -3.5) {
        float lit = 1.0-step(0.5,abs(part+1.0+uAspect));
        vColor.rgb = mix(vec3(0.075,0.10,0.105),aColor.rgb,lit);
        vSurface.y *= lit;
      }
      gl_Position = uViewProjection * vec4(vPosition, 1.0);
      if (uSky > 0.5) {
        vLocal = aPosition / 120.0;
        gl_Position.z = gl_Position.w;
      }
    }`;

  const FRAGMENT = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
    #else
      precision mediump float;
    #endif
    varying mediump vec3 vPosition, vNormal, vLocal;
    varying mediump vec4 vColor;
    varying mediump vec2 vUV;
    varying mediump vec3 vSurface;
    uniform sampler2D uAtlas;
    uniform sampler2D uSaloonText;
    uniform vec2 uPassengerRows;
    uniform vec3 uEye;
    uniform vec2 uDisplay;
    uniform float uCab, uStation, uOutdoor;
    uniform vec3 uWeather; // cloud cover, water outside the swept fan, droplet clock
    uniform vec4 uSun; // daylight, twilight, east bearing, solar elevation
    uniform vec2 uHeading; // cosine and sine of the train's heading
    uniform vec2 uLampOrigin;
    uniform vec4 uFilmLow, uFilmHigh;
    uniform mediump float uSky;
    vec3 horizon() {
      vec3 blue = mix(vec3(0.095,0.14,0.22),vec3(0.69,0.82,0.85),uSun.x);
      vec3 peach = mix(vec3(0.86,0.54,0.37),vec3(0.94,0.72,0.59),0.5+0.5*uSun.z);
      return mix(blue,peach,0.84*uSun.y);
    }
    vec3 skyColor(vec3 ray) {
      float y = ray.y;
      vec3 zenith = mix(vec3(0.025,0.043,0.096),vec3(0.25,0.49,0.72),uSun.x);
      vec3 sky = mix(horizon(),zenith,smoothstep(-0.06,0.52,y));
      vec3 sunDir = normalize(vec3(0.55*uSun.z,uSun.w,-0.82));
      float sun = length(ray-sunDir);
      sky += vec3(1.0,0.79,0.46)*(0.22*exp(-8.0*sun)+0.92*(1.0-smoothstep(0.021,0.025,sun)));
      float moon = length(ray-normalize(vec3(-0.36*uSun.z,0.18-0.21*uSun.w,-1.0)));
      float night = (1.0-uSun.x)*(1.0-0.78*uSun.y);
      vec2 field = 175.0*ray.xz/(1.0+max(0.0,y));
      float star = fract(sin(dot(floor(field),vec2(13.1,17.7)))*1291.6);
      float pin = 1.0-smoothstep(0.02,0.15,length(fract(field)-0.5));
      sky += night*(vec3(0.66,0.77,0.93)*pin*step(0.961,star)*smoothstep(0.03,0.25,y)
             + vec3(0.96,0.86,0.68)*(0.74*(1.0-smoothstep(0.015,0.018,moon))+0.10*exp(-15.0*moon)));
      float bank = 0.5+0.5*sin(14.0*y+2.1*sin(4.8*ray.x)+3.2*ray.z);
      vec3 cloud = mix(vec3(0.40,0.45,0.49),vec3(0.13,0.20,0.27),smoothstep(0.01,0.55,y));
      sky = mix(sky,(cloud+0.035*bank)*(0.35+0.65*max(uSun.x,uSun.y)),uWeather.x);
      float farRidge = 0.042+0.042*sin(6.0*ray.x+4.0*ray.z)+0.017*sin(17.0*ray.x-7.0*ray.z);
      float nearRidge = 0.014+0.030*sin(10.0*ray.x-3.0*ray.z)+0.008*sin(27.0*ray.z+ray.x);
      float ridgeLight = 0.30+0.70*max(uSun.x,0.72*uSun.y);
      sky = mix(ridgeLight*vec3(0.32,0.37,0.46),sky,smoothstep(farRidge-0.002,farRidge,y));
      return mix(ridgeLight*vec3(0.20,0.28,0.32),sky,smoothstep(nearRidge-0.002,nearRidge,y));
    }
    float headlights(vec3 position) {
      vec2 offset = position.xz-uLampOrigin;
      float ahead = dot(offset,vec2(uHeading.y,-uHeading.x));
      float side = abs(dot(offset,uHeading)) - 0.78;
      vec2 spread = vec2(side, position.y-1.16)/(0.72+0.08*max(0.0,ahead));
      return smoothstep(0.0,2.0,ahead)/(1.0+dot(spread,spread)+0.0022*ahead*ahead);
    }
    float lamp(vec3 toLight, vec3 n, float radius) {
      float d = dot(toLight,toLight);
      float diffuse = max(0.0,dot(n,toLight)*inversesqrt(max(d,0.008)));
      return (0.26+0.74*diffuse)/(1.0+d*radius);
    }
    bool inPanel(vec2 p) {
      return all(greaterThanEqual(p,vec2(0.0))) && all(lessThan(p,vec2(1.0)));
    }
    float sweptFilm(float a) {
      float t = clamp(a,0.0,1.0)*7.0;
      if (t < 1.0) return mix(uFilmLow.x,uFilmLow.y,t);
      if (t < 2.0) return mix(uFilmLow.y,uFilmLow.z,t-1.0);
      if (t < 3.0) return mix(uFilmLow.z,uFilmLow.w,t-2.0);
      if (t < 4.0) return mix(uFilmLow.w,uFilmHigh.x,t-3.0);
      if (t < 5.0) return mix(uFilmHigh.x,uFilmHigh.y,t-4.0);
      if (t < 6.0) return mix(uFilmHigh.y,uFilmHigh.z,t-5.0);
      return mix(uFilmHigh.z,uFilmHigh.w,t-6.0);
    }
    vec2 rainBeads(vec2 pane) {
      vec2 radial = vec2(${BLADE.x}-pane.x,pane.y-${BLADE.y});
      float angle = (atan(radial.y,radial.x)-${BLADE.park})/${BLADE.arc};
      float radius = length(radial);
      float fan = smoothstep(${BLADE.inner}-0.01,${BLADE.inner}+0.01,radius)
        * (1.0-smoothstep(${BLADE.outer}-0.01,${BLADE.outer}+0.01,radius))
        * smoothstep(-0.02,0.005,angle)*(1.0-smoothstep(0.995,1.02,angle));
      float water = mix(uWeather.y,sweptFilm(angle),fan);
      vec2 grid = pane*vec2(26.0,17.0);
      float column = fract(sin(dot(vec2(floor(grid.x),1.0),vec2(1.7,6.4)))*127.1);
      grid.y += uWeather.z*(1.0+floor(3.0*column)) + column;
      vec2 cell = floor(grid);
      cell.y = mod(cell.y,16.0);
      float seed = fract(sin(dot(cell,vec2(5.7,9.1)))*187.3);
      vec2 q = fract(grid)-vec2(0.19+0.62*seed,0.30+0.34*column);
      q.x += 0.06*q.y;
      float bead = 1.0-smoothstep(0.54,1.0,length(q*vec2(6.2,6.8)));
      float trail = (1.0-smoothstep(0.012,0.043,abs(q.x)))*smoothstep(0.0,0.09,q.y)*(1.0-smoothstep(0.11,0.39,q.y));
      float glint = 1.0-smoothstep(0.015,0.077,length(q-vec2(-0.035,0.045)));
      return vec2(bead+0.27*trail,glint)*water;
    }
    vec3 cabDisplay(vec2 p, vec3 base) {
      vec2 digits = (p-vec2(0.045,0.235))/vec2(0.31,0.38);
      if (inPanel(digits)) {
        float numeral = digits.x < 0.5 ? floor(uDisplay.x/10.0) : mod(uDisplay.x,10.0);
        vec2 slot = vec2(mod(numeral,5.0),floor(numeral/5.0));
        vec2 glyph = (slot+vec2(fract(digits.x*2.0),digits.y))/vec2(5.0,2.0);
        float ink = texture2D(uAtlas,(vec2(3.0,7.0)+glyph)/vec2(4.0,8.0)).r;
        return mix(base,vec3(1.0,0.83,0.50),ink);
      }
      vec2 signUV = (p-vec2(0.43,0.235))/vec2(0.52,0.38);
      if (inPanel(signUV)) {
        float id = 8.0+uDisplay.y;
        vec2 cell = vec2(mod(id,4.0),floor(id/4.0));
        return texture2D(uAtlas,(cell+clamp(signUV,0.005,0.995))/vec2(4.0,8.0)).rgb;
      }
      vec2 led = p*vec2(512.0,256.0)-vec2(40.0+108.0*uDisplay.y,215.0);
      return mix(base,vec3(1.0,0.81,0.41),1.0-smoothstep(5.0,7.0,length(led)));
    }
    void main() {
      if (uSky > 0.5) {
        gl_FragColor = vec4(skyColor(normalize(vLocal)),1.0);
        return;
      }
      if (vSurface.z == ${PART.SALOON_SIGN}.0) {
        float row = vUV.x < ${DIVIDER / ATLAS_SIZE} ? uPassengerRows.x : uPassengerRows.y;
        vec2 uv = vec2(vUV.x,(row+clamp(vUV.y,0.018,0.982))/${ROWS}.0);
        gl_FragColor = vec4(texture2D(uSaloonText,uv).rgb,1.0);
        return;
      }
      float id = floor(vSurface.x+0.5);
      vec2 cell = vec2(mod(id,4.0),floor(id*0.25));
      vec2 uv = mix(vec2(0.0022,0.0044), vec2(0.9978,0.9956),fract(vUV));
      vec3 texel = texture2D(uAtlas,(cell+uv)/vec2(4.0,8.0)).rgb;
      vec3 base = texel*vColor.rgb;
      if (uCab > 0.5 && id == 22.0) base = cabDisplay(fract(vUV),base);
      vec3 n = normalize(vNormal);
      vec3 view = uEye-vPosition;
      float dist = length(view);
      vec3 eyeDir = view/max(dist,0.001);
      vec3 lit;
      if (uCab > 0.5) {
        float side = max(0.0,dot(n,normalize(vec3(0.42,0.8,-0.4))));
        vec3 light = vec3(0.44,0.53,0.55) + vec3(0.34,0.32,0.23)*side;
        light += uOutdoor*(0.20+0.80*max(uSun.x,uSun.y))*mix(vec3(0.12,0.14,0.20),vec3(0.06,0.10,0.16),uWeather.x)*(0.5+0.5*max(n.y,0.0));
        float edge = pow(max(0.0,1.0-abs(dot(n,eyeDir))),4.0);
        lit = base*light+vec3(0.045,0.064,0.065)*edge;
      } else if (uOutdoor > 0.5) {
        float sun = max(0.0,dot(n,normalize(vec3(0.55*uSun.z,max(0.06,uSun.w),-0.82))));
        vec3 light = mix(vec3(0.16,0.21,0.32),vec3(0.54,0.62,0.68),max(uSun.x,0.63*uSun.y));
        light += mix(vec3(0.50,0.48,0.42),vec3(0.53,0.31,0.18),uSun.y)*sun*uSun.x;
        light *= mix(vec3(1.0),vec3(0.64,0.76,0.88),uWeather.x);
        float dz = mod(vLocal.z+16.0,16.0)-8.0;
        light += vec3(0.97,0.72,0.43)*lamp(vec3(-2.8-vLocal.x,4.09-vLocal.y,-dz),n,0.38);
        light += vec3(0.94,0.85,0.64)*headlights(vPosition)*(1.0-uSun.x);
        lit = base*light;
        float sheen = pow(1.0-abs(clamp(dot(n,eyeDir),-1.0,1.0)),3.0);
        lit += uWeather.x*max(n.y,0.0)*sheen*vec3(0.085,0.13,0.16);
        if (id == 29.0) {
          float windowLight = smoothstep(0.12,0.27,texel.r-texel.b);
          lit += vec3(0.56,0.42,0.23)*windowLight*(1.0-0.77*uSun.x);
        }
      } else {
        vec3 p = vLocal;
        vec3 ambient = mix(vec3(0.25,0.31,0.34),vec3(0.47,0.54,0.54),uStation);
        ambient += 0.045*n.y;
        float dz = mod(p.z+1.65+2.0,4.0)-2.0;
        dz = sign(dz)*max(abs(dz)-0.78,0.0);
        vec3 sideLight = vec3(mix(-3.17,-2.94,uStation)-p.x,mix(2.55,3.53,uStation)-p.y,-dz);
        float left = lamp(sideLight,n,0.63);
        float roof = lamp(vec3(0.65-p.x,4.71-p.y,0.0),n,0.19);
        float right = lamp(vec3(3.10-p.x,4.73-p.y,0.0),n,0.22);
        float wall = lamp(vec3(6.42-p.x,4.74-p.y,0.0),n,0.31);
        vec3 illum = ambient + vec3(1.50,0.94,0.45)*left;
        illum += uStation*(vec3(0.60,0.48,0.32)*roof + vec3(0.86,0.79,0.60)*right + vec3(0.56,0.72,0.62)*wall);
        float service = mod(p.z+8.5+8.0,16.0)-8.0;
        illum += (1.0-uStation)*vec3(0.36,0.63,0.64)*lamp(vec3(3.37-p.x,2.16-p.y,-service),n,0.39);
        illum += vec3(0.65,0.63,0.52)*headlights(vPosition);
        float railShadow = 1.0-0.28*exp(-8.0*abs(abs(p.x)-0.755))*step(p.y,0.21);
        float doorShadow = 1.0-0.18*exp(-1.7*abs(p.x-1.93))*step(p.y,1.11)*uStation;
        lit = base*illum*railShadow*doorShadow;
        float edge = pow(max(0.0,1.0-abs(dot(n,eyeDir))),5.0);
        if (id < 0.5) lit += edge*vec3(0.085,0.11,0.105)*(0.25+uStation*0.75);
        if (id > 1.5 && id < 2.5) lit += vec3(0.07,0.095,0.075)*wall*edge;
      }
      vec3 color = mix(lit,base*1.06,vSurface.y);
      float mist = (1.0-uCab)*(1.0-exp(-(0.0095+0.009*uOutdoor*uWeather.x)*max(0.0,dist-4.0)));
      vec3 haze = mix(vec3(0.065,0.095,0.15),vec3(0.43,0.48,0.55),max(uSun.x,0.70*uSun.y));
      color = mix(color,mix(vec3(0.075,0.107,0.113),haze,uOutdoor),mist);
      float alpha = vColor.a;
      if (vSurface.z == ${PART.WINDSCREEN}.0 && uWeather.y > 0.001) {
        vec2 drops = rainBeads(vLocal.xy);
        color = mix(color,vec3(0.52,0.65,0.71),drops.x) + vec3(0.43,0.42,0.38)*drops.y;
        alpha += 0.54*drops.x;
      }
      float dither = fract(dot(gl_FragCoord.xy,vec2(0.75487766,0.56984029)))-0.5;
      gl_FragColor = vec4(color+dither/255.0,alpha);
    }`;

  Nightline.shaders = { VERTEX, FRAGMENT };
})();
