'use strict';
const assert=require('node:assert/strict');

// A graph recorder. Nothing is connected to an audio device.
class RecordingAudio {
  constructor(options={}) {
    this.options=options;
    this.currentTime=0;
    this.state='suspended';
    this.destination={};
    this.sources=[];
    this.buffers=[];
    this.gains=[];
  }
  async resume() {
    if (this.options.resume) await this.options.resume();
    if (this.options.deny) throw Error('audio denied');
    this.state='running';
  }
  async suspend() { this.state='suspended'; }
  async close() { this.state='closed'; }
  createBuffer(channels,length,rate) {
    assert.equal(channels,1);
    const clip={length,rate,copyToChannel(data,channel) {
      assert.equal(channel,0); assert.equal(data.length,length); this.data=data;
    }};
    this.buffers.push(clip);
    return clip;
  }
  createGain() {
    const node={gain:{value:1,targets:[],cancelScheduledValues(){this.targets.length=0;},
      setTargetAtTime(value,time,decay) {
        assert.ok(Number.isFinite(value) && time>=0 && decay>0);
        this.value=value; this.targets.push(value);
      }},connect(to){this.output=to;}};
    this.gains.push(node);
    return node;
  }
  createBufferSource() {
    const options=this.options;
    const source={playbackRate:{value:1},loop:false,connect(to){this.output=to;},
      disconnect(){this.output=null;},
      start(){
        assert.ok(this.buffer && this.output && !this.started);
        if (!this.loop && options.failStep) throw Error('interrupted audio');
        this.started=true;
      },
      stop(){this.stopped=true; this.onended?.();}};
    this.sources.push(source);
    return source;
  }
}
module.exports={RecordingAudio};
