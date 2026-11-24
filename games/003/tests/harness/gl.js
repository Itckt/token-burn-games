'use strict';
const assert = require('node:assert/strict');

function declarations(source, qualifier) {
  const pattern = new RegExp('\\b' + qualifier + '\\s+(?:(lowp|mediump|highp)\\s+)?(\\w+)\\s+([^;]+);', 'g');
  const result = new Map();
  for (const [,precision,type,names] of source.matchAll(pattern)) {
    for (const part of names.split(',')) {
      const name = part.trim();
      result.set(name,{name,type,precision});
    }
  }
  return result;
}

// Records WebGL contracts and resource lifetimes without creating a graphics device.
function recordingGL(options = {}) {
  const gl = {};
  const constants = ('VERTEX_SHADER FRAGMENT_SHADER COMPILE_STATUS LINK_STATUS ACTIVE_ATTRIBUTES ACTIVE_UNIFORMS ' +
    'TRIANGLES ARRAY_BUFFER STATIC_DRAW FLOAT TEXTURE_2D TEXTURE_MAG_FILTER TEXTURE_MIN_FILTER TEXTURE_WRAP_S TEXTURE_WRAP_T ' +
    'CLAMP_TO_EDGE LINEAR RGBA UNSIGNED_BYTE FRAMEBUFFER FRAMEBUFFER_COMPLETE COLOR_ATTACHMENT0 DEPTH_ATTACHMENT RENDERBUFFER ' +
    'DEPTH_COMPONENT16 DEPTH_TEST CULL_FACE BLEND SRC_ALPHA ONE ONE_MINUS_SRC_ALPHA MAX_TEXTURE_SIZE MAX_RENDERBUFFER_SIZE').split(' ');
  constants.forEach((name,i) => { gl[name] = 100+i; });
  Object.assign(gl,{TEXTURE0:33984, COLOR_BUFFER_BIT:16384, DEPTH_BUFFER_BIT:256});
  const programs = [], shaders = [], draws = [], uploads = [], targets = [];
  const enabled = new Set(), pointers = new Map(), textures = new Map();
  let buffer, framebuffer, renderbuffer, program, unit = 0, viewport;
  gl.createShader = type => {
    const shader = {type};
    shaders.push(shader);
    return shader;
  };
  gl.shaderSource = (shader,source) => { shader.source = source; };
  gl.compileShader = shader => {
    assert.match(shader.source,/void\s+main\s*\(\s*\)/);
    assert.match(shader.source,shader.type === gl.VERTEX_SHADER ? /gl_Position\s*=/ : /gl_FragColor\s*=/);
    const stack = [], closers = {')':'(', '}':'{', ']':'['};
    for (const c of shader.source) {
      if ('({['.includes(c)) stack.push(c);
      if (')}]'.includes(c)) assert.equal(stack.pop(),closers[c],'unbalanced shader delimiters');
    }
    assert.equal(stack.length,0);
    shader.compiled = !options.failShader;
  };
  gl.getShaderParameter = (shader,param) => { assert.equal(param,gl.COMPILE_STATUS); return shader.compiled; };
  gl.getShaderInfoLog = () => 'Test compilation failure';
  gl.deleteShader = s => { s.deleted = true; };
  gl.createProgram = () => {
    const p = {shaders:[],values:new Map()};
    programs.push(p);
    return p;
  };
  gl.attachShader = (p,s) => p.shaders.push(s);
  gl.linkProgram = p => {
    const v = p.shaders.find(s => s.type === gl.VERTEX_SHADER), f = p.shaders.find(s => s.type === gl.FRAGMENT_SHADER);
    assert.ok(v.compiled && f.compiled);
    const varying = declarations(v.source,'varying');
    for (const [name,decl] of declarations(f.source,'varying')) {
      const out = varying.get(name);
      assert.equal(out?.type,decl.type,'varying ' + name);
      assert.equal(out.precision || 'highp',decl.precision || 'mediump','varying precision ' + name);
    }
    p.attributes = [...declarations(v.source,'attribute').values()];
    p.uniforms = [...declarations(v.source+'\n'+f.source,'uniform').values()];
    p.linked = !options.failLink;
  };
  gl.getProgramParameter = (p,param) => {
    if (param === gl.ACTIVE_ATTRIBUTES) return p.attributes.length;
    if (param === gl.ACTIVE_UNIFORMS) return p.uniforms.length;
    assert.equal(param,gl.LINK_STATUS);
    return p.linked;
  };
  gl.getProgramInfoLog = () => 'Test link failure';
  gl.deleteProgram = p => { p.deleted = true; };
  gl.getActiveAttrib = (p,i) => p.attributes[i];
  gl.getAttribLocation = (p,name) => p.attributes.findIndex(a => a.name === name);
  gl.getActiveUniform = (p,i) => p.uniforms[i];
  gl.getUniformLocation = (p,name) => ({program:p,...p.uniforms.find(u => u.name === name)});
  gl.useProgram = p => { program = p; };
  function uniform(loc,type,values) {
    assert.equal(loc.program,program);
    assert.equal(loc.type,type);
    assert.ok(Array.from(values).every(Number.isFinite),'nonfinite uniform ' + loc.name);
    program.values.set(loc.name,Array.from(values));
  }
  gl.uniform1i = (loc,x) => uniform(loc,'sampler2D',[x]);
  gl.uniform1f = (loc,x) => uniform(loc,'float',[x]);
  gl.uniform2f = (loc,x,y) => uniform(loc,'vec2',[x,y]);
  gl.uniform3fv = (loc,v) => { assert.equal(v.length,3); uniform(loc,'vec3',v); };
  gl.uniformMatrix4fv = (loc,transpose,m) => {
    assert.equal(transpose,false);
    assert.equal(m.length,16);
    uniform(loc,'mat4',m);
  };
  gl.createBuffer = () => ({});
  gl.bindBuffer = (target,b) => { assert.equal(target,gl.ARRAY_BUFFER); buffer = b; };
  gl.bufferData = (_,data,usage) => {
    assert.equal(usage,gl.STATIC_DRAW);
    assert.ok(data.byteLength > 0 && data.byteLength % 4 === 0);
    buffer.bytes = data.byteLength;
    uploads.push(buffer);
  };
  gl.deleteBuffer = b => { b.deleted = true; };
  gl.enableVertexAttribArray = loc => enabled.add(loc);
  gl.disableVertexAttribArray = loc => enabled.delete(loc);
  gl.vertexAttribPointer = (loc,size,type,normalized,stride,offset) => {
    assert.equal(type,gl.FLOAT);
    assert.equal(normalized,false);
    pointers.set(loc,{buffer,size,stride:stride || size*4,offset});
  };
  gl.createTexture = () => ({});
  gl.activeTexture = slot => { unit = slot-gl.TEXTURE0; };
  gl.bindTexture = (_,tex) => textures.set(unit,tex);
  gl.texImage2D = (_,level,format,w,h) => {
    assert.equal(level,0);
    assert.equal(format,gl.RGBA);
    assert.ok(w >= 1 && h >= 1 && Number.isInteger(w) && Number.isInteger(h));
    Object.assign(textures.get(unit),{w,h});
  };
  gl.texParameteri = () => {};
  gl.deleteTexture = tex => { tex.deleted = true; };
  gl.createFramebuffer = () => { const f = {}; targets.push(f); return f; };
  gl.createRenderbuffer = () => ({});
  gl.bindFramebuffer = (_,fb) => { framebuffer = fb; };
  gl.bindRenderbuffer = (_,rb) => { renderbuffer = rb; };
  gl.framebufferTexture2D = (_,attachment,target,tex) => { framebuffer.tex = tex; };
  gl.renderbufferStorage = (_,format,w,h) => { Object.assign(renderbuffer,{w,h}); };
  gl.framebufferRenderbuffer = (_,attachment,target,rb) => { framebuffer.depth = rb; };
  gl.checkFramebufferStatus = () => {
    if (framebuffer.depth) {
      assert.equal(framebuffer.tex.w,framebuffer.depth.w);
      assert.equal(framebuffer.tex.h,framebuffer.depth.h);
    }
    return options.failTarget || options.rejectTarget === targets.length ? 0 : gl.FRAMEBUFFER_COMPLETE;
  };
  gl.deleteFramebuffer = f => { f.deleted = true; };
  gl.deleteRenderbuffer = rb => { rb.deleted = true; };
  gl.getParameter = name => {
    assert.ok([gl.MAX_TEXTURE_SIZE,gl.MAX_RENDERBUFFER_SIZE].includes(name));
    return options.limit || 4096;
  };
  gl.viewport = (x,y,w,h) => { viewport = [w,h]; };
  for (const name of ['enable','disable','blendFunc','depthMask','clear','clearColor']) gl[name] = () => {};
  gl.drawArrays = (mode,first,count) => {
    assert.equal(mode,gl.TRIANGLES);
    assert.ok(count > 0 && count % 3 === 0 && first >= 0);
    for (const [loc,attr] of program.attributes.entries()) {
      const attrPointer = pointers.get(loc);
      assert.ok(enabled.has(loc) && !attrPointer.buffer.deleted, 'inactive attribute ' + attr.name);
      assert.ok(attrPointer.offset+(first+count-1)*attrPointer.stride+attrPointer.size*4 <= attrPointer.buffer.bytes, 'attribute buffer overrun');
    }
    for (const u of program.uniforms) {
      assert.ok(program.values.has(u.name), 'unbound uniform ' + u.name);
      if (u.type !== 'sampler2D') continue;
      const tex = textures.get(program.values.get(u.name)[0]);
      assert.ok(tex?.w && !tex.deleted && tex !== framebuffer?.tex,'invalid sample or feedback loop');
    }
    if (framebuffer) {
      assert.ok(!framebuffer.deleted && !framebuffer.tex.deleted);
      assert.deepEqual(viewport,[framebuffer.tex.w,framebuffer.tex.h]);
    }
    draws.push({program:programs.indexOf(program),buffer:pointers.get(0).buffer,framebuffer,count});
  };
  return {gl,programs,shaders,draws,uploads,targets};
}
module.exports = {recordingGL};
