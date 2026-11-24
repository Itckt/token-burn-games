/* Original scores for a small mono radio. A whole phrase is synthesized once
   and looped by the audio device, independently of the scene's frame rate. */
(function () {
  'use strict';
  const local=typeof module==='object' && module.exports;
  const {parts}=local ? require('./mesh.js') : PocketPlaces.mesh;
  const id=8, origin=[-2.17,1.027,1.35], yaw=.23;
  const stations=[
    {name:'Cup Rim Waltz',frequency:'88.6',bpm:108,beats:3,tone:.31,
      roots:[50,55,52,45],melody:[74,0,69,73,74,78, 79,0,74,71,0,69,
        67,71,76,0,74,71, 69,0,73,76,73,0]},
    {name:'Tin Roof Two-Step',frequency:'95.2',bpm:126,beats:4,tone:.64,
      roots:[53,58,55,48],melody:[69,0,72,0,0,74,72,69, 70,0,65,67,0,69,70,0,
        67,0,70,74,0,72,70,67, 64,67,0,70,69,0,67,0]},
    {name:'Last Minibus',frequency:'101.8',bpm:84,beats:4,tone:.16,
      roots:[48,45,53,43],melody:[67,0,0,64,67,0,71,0, 72,0,69,0,0,67,64,0,
        65,0,69,72,0,0,69,67, 62,0,67,0,71,69,0,0]}
  ];
  const dialPosition=i=>i/(stations.length-1);
  function synthesize(station,sampleRate=22050) {
    if (!Number.isInteger(sampleRate) || sampleRate<8000 || sampleRate>96000) throw new RangeError('Invalid audio sample rate');
    const beat=60/station.bpm;
    const samples=new Float32Array(Math.round(station.melody.length*beat*.5*sampleRate));
    function strike(time,midi,length,gain,brightness) {
      let at=Math.round(time*sampleRate);
      const omega=2*Math.PI*440*2**((midi-69)/12)/sampleRate;
      const count=Math.round(length*sampleRate);
      const sinStep=Math.sin(omega), cosStep=Math.cos(omega), damping=Math.exp(-3/(sampleRate*length));
      const attack=1/(.012*sampleRate), release=1/(.06*sampleRate), min=Math.min;
      let sine=0, cosine=1, amplitude=gain;
      // Rotate a unit phasor and derive its harmonics. The inner loop needs
      // no trigonometric calls, even on the first tune of a long phrase.
      for (let n=0;n<count;n++) {
        const second=2*sine*cosine, fourth=2*second*(cosine*cosine-sine*sine);
        const edge=min(1,n*attack,(count-1-n)*release);
        samples[at]+=amplitude*edge*(sine+brightness*(second+.28*fourth));
        if (++at===samples.length) at=0;
        const nextSine=sine*cosStep+cosine*sinStep;
        cosine=cosine*cosStep-sine*sinStep; sine=nextSine; amplitude*=damping;
      }
    }
    station.melody.forEach((note,i)=>{
      if (note) strike(i*beat/2,note,beat*.95,.20,station.tone);
    });
    station.roots.forEach((root,bar)=>{
      const start=bar*station.beats*beat;
      strike(start,root-12,beat*1.62,.19,.32);
      for (let b=1;b<station.beats;b++) {
        const time=start+b*beat;
        strike(time,root+7,beat*.48,.075,.17);
        strike(time,root+12,beat*.48,.058,.17);
      }
    });
    return samples;
  }
  function build({group,box,cyl,panel,pipe}) {
    group(...origin,yaw,id,()=>{
      for (const x of [-.205,.205]) box(x,.022,0,.092,.044,.153,'#394c41',.009);
      box(0,.220,0,.598,.365,.224,'#875735',.035);
      box(0,.222,.108,.574,.335,.035,'#d1ab73',.016);
      panel(0,.226,.128,.542,.296,'#ffffff','radioFace');
      pipe([[-.174,.389,0],[-.174,.44,0],[-.139,.481,0],[.139,.481,0],[.174,.44,0],[.174,.389,0]],
        .016,'#b79a62',{gloss:.5});
      box(0,.479,0,.209,.039,.048,'#405849',.013);
      for (const x of [.07,.196]) {
        cyl(x,.165,.142,.040,.039,.036,'#446a56',18,{rx:Math.PI/2});
        cyl(x,.165,.162,.023,.022,.009,'#e3bc7d',16,{rx:Math.PI/2});
      }
      box(.074,.270,.131,.007,.055,.004,'#dd5639',0,{part:parts.radioNeedle});
      cyl(.209,.224,.132,.012,.012,.008,'#ab8660',12,{rx:Math.PI/2,part:parts.radioLamp});
    });
  }
  const api={id,origin,yaw,stations,dialPosition,synthesize,build};
  if (local) module.exports=api; else PocketPlaces.radio=api;
})();
