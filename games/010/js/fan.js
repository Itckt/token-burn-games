/* An enamel desk fan facing the open aisle. The shaft runs along world +Z. */
(function () {
  'use strict';
  const hub = [1.58,1.89,-2.18];
  const speeds = {off:0, low:.42, high:1};
  const modes = Object.keys(speeds);
  const tau = Math.PI*2;
  function create() { return {mode:'low', wind:speeds.low, angle:0}; }
  function setSpeed(fan, mode, still = false) {
    if (!modes.includes(mode)) return;
    fan.mode = mode;
    if (still) fan.wind = speeds[mode];
  }
  function step(fan, seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const target = speeds[fan.mode], gap = fan.wind-target;
    const ease = -Math.expm1(-3*seconds);
    // Integrate the motor speed across this interval, including its run-down.
    fan.angle = (fan.angle + 8*(target*seconds + gap*ease/3)) % tau;
    fan.wind += (target-fan.wind)*ease;
  }

  function build({group,slab,oval,cyl,pipe}, bladePart) {
    const [x,y,z] = hub;
    group(x,y,z,0,7,()=>{
      slab(0,-.638,-.035,.47,.086,.36,.085,'#346958');
      slab(0,-.590,-.035,.42,.026,.32,.070,'#d7b879',.009);
      oval(0,-.534,-.045,.16,.071,.11,'#73a88f');
      pipe([[0,-.56,-.06],[0,-.34,-.11],[0,-.19,-.12],[0,-.04,-.12]],.059,'#4a826c');
      oval(0,0,-.090,.139,.139,.163,'#538c76');
      const metal = '#dcc491', rim = .326;
      function guardRing(radius,depth,wire) {
        const points=[];
        for (let i=0;i<=36;i++) {
          const angle=tau*i/36;
          points.push([radius*Math.cos(angle),radius*Math.sin(angle),depth]);
        }
        pipe(points,wire,metal,{gloss:.55},6);
      }
      guardRing(rim,-.033,.012); guardRing(rim,.031,.012);
      guardRing(.243,.087,.008); guardRing(.139,.113,.008);
      for (let i=0;i<10;i++) {
        const a=tau*i/10;
        const points=[[.075,.127],[.232,.090],[rim,.031],[rim,-.033],[.112,-.105]]
          .map(([r,d])=>[r*Math.cos(a),r*Math.sin(a),d]);
        pipe(points,.0065,metal,{gloss:.5},6);
      }
      // Four pitched, overlapping paddles turn behind the fixed wire guard.
      for (let i=0;i<4;i++) {
        const a=i*tau/4+.30;
        oval(-.163*Math.sin(a),.163*Math.cos(a),.002,.086,.137,.017,
          i%2 ? '#428976' : '#579881',{rz:a-.34,ry:.18,part:bladePart,gloss:.45});
      }
      cyl(0,0,.108,.081,.074,.050,'#397462',32,{rx:Math.PI/2,gloss:.38});
      cyl(0,0,.138,.042,.040,.013,metal,24,{rx:Math.PI/2,gloss:.5});
      for (let i=0;i<3;i++) cyl(-.086+i*.086,-.586,.082,.024,.022,.021,
        ['#d67550','#f0dfad','#83a893'][i],12);
    });
  }
  const api = {hub, modes, create, setSpeed, step, build};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else PocketPlaces.fan = api;
})();
