"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { inflateSync } = require("node:zlib");
const { root, MemoryStorage, Document, Window, fixture } = require("../test-support/platform.js");
const { files, serve, portNumber } = require("../server.js");
const { landscape, campsite } = require("../tools/draw-art.js");
const { bucketDays } = require("../js/views.js");

async function request(url, method = "GET") {
  const response = {
    writeHead(status,headers) { this.status = status; this.headers = headers; },
    end(data) { this.data = data; this.finished = true; }
  };
  await serve({url,method},response);
  assert.equal(response.finished,true);
  return response;
}

test("the entry point and stylesheet resolve every runtime resource inside the project", () => {
  const doc = new Document();
  const scripts = doc.querySelectorAll("script");
  assert.equal(scripts.length,5);
  assert.ok(scripts.every(s => Object.hasOwn(s.attrs,"defer")));
  const urls = [...scripts.map(s => s.attrs.src), ...doc.querySelectorAll("link").map(link => link.attrs.href)];
  const css = fs.readFileSync(path.join(root,"styles.css"),"utf8");
  urls.push(...[...css.matchAll(/url\("([^"]+)"\)/g)].map(hit => hit[1]));
  for (const url of urls) {
    assert.match(url,/^\.\/[\w./-]+$/);
    const file = path.resolve(root,url);
    assert.ok(file.startsWith(root + path.sep));
    assert.ok(fs.statSync(file).isFile());
    assert.ok(files.has("/" + url.slice(2)));
  }
  assert.ok(!css.includes("@import"));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).dependencies,undefined);
});

test("the shipped scripts boot in HTML order with browser globals and no module loader", () => {
  const document = new Document();
  const win = new Window("#overview",new MemoryStorage());
  const env = {document,location:win.location,localStorage:win.localStorage,navigator:win.navigator};
  for (const method of ["setTimeout","clearTimeout","setInterval","clearInterval","addEventListener","removeEventListener","scrollTo"]) {
    env[method] = win[method].bind(win);
  }
  const context = vm.createContext(env);
  for (const script of document.querySelectorAll("script")) {
    const file = path.join(root,script.attrs.src);
    vm.runInContext(fs.readFileSync(file,"utf8"),context,{filename:file});
  }
  const main = document.getElementById("main-content");
  assert.equal(main.querySelector("h1").textContent,"Trail overview");
  assert.equal(document.title,"Overview · Embertrail");
  assert.equal(main.querySelectorAll(".habit-row").length,4);
  assert.ok(win.localStorage.getItem("embertrail.journal.v1"));
  for (const use of document.querySelectorAll("use")) {
    assert.ok(document.querySelector(use.attrs.href),"Missing sprite " + use.attrs.href);
  }
});

test("every navigation view and dialog has named controls and resolved label and sprite references", async () => {
  const f = fixture();
  function checkTree(tree) {
    for (const button of tree.querySelectorAll("button")) {
      assert.ok((button.attrs["aria-label"] || button.textContent.trim()).length,"Unnamed button");
    }
    for (const link of tree.querySelectorAll("a")) assert.ok(link.attrs["aria-label"] || link.textContent.trim());
    for (const use of tree.querySelectorAll("use")) assert.ok(f.doc.querySelector(use.attrs.href));
    for (const attr of ["aria-labelledby","aria-describedby","for"]) {
      for (const el of tree.querySelectorAll("[" + attr + "]")) {
        for (const id of el.attrs[attr].split(" ")) assert.ok(f.doc.getElementById(id),"Missing label " + id);
      }
    }
    const ids = tree.querySelectorAll("[id]").map(el => el.id);
    assert.equal(ids.length,new Set(ids).size);
  }
  for (const route of ["habits","statistics","rewards","overview"]) {
    f.navigate(route);
    checkTree(f.main);
    assert.equal(f.main.querySelectorAll("h1").length,1);
  }
  checkTree(f.doc.getElementById("sidebar"));
  for (const [action,data] of [["settings",{}],["new-habit",{}],["goal",{}],["progress",{ id:"water" }],["day",{day:"2026-11-23"}]]) {
    await f.click(action,data); checkTree(f.dialog); await f.click("close");
  }
  await f.click("notes"); checkTree(f.dialog);
  await f.click("note-today"); checkTree(f.dialog); await f.click("close");
  f.navigate("statistics");
  await f.click("weekday", { index: "0" }); checkTree(f.dialog);
  await f.click("day", { day: "2026-11-23" }); checkTree(f.dialog); await f.click("close");
  await f.click("settings");
  await f.chooseBackup(Object.assign(new Blob([JSON.stringify(f.app.context().state)]), { name: "journal.json" }));
  checkTree(f.dialog);
  await f.click("close");
  f.navigate("habits");
  await f.click("edit",{id:"reading"}); checkTree(f.dialog);
  await f.click("remove-prompt"); checkTree(f.dialog); await f.click("close");
  f.navigate("rewards");
  await f.click("pennants"); checkTree(f.dialog); await f.click("close");
  await f.click("reward",{reward:"chest"}); checkTree(f.dialog);
  assert.equal(f.dialog.attrs["aria-labelledby"],"dialog-title");
  assert.ok(f.doc.getElementById("dialog-title"));
});

test("the stylesheet includes layouts for small screens, keyboard focus and reduced motion", () => {
  const doc = new Document();
  assert.ok(doc.querySelector('[name="viewport"]').attrs.content.includes("width=device-width"));
  const css = fs.readFileSync(path.join(root,"styles.css"),"utf8");
  assert.match(css,/@media \(max-width: 530px\)/);
  assert.match(css,/@media \(prefers-reduced-motion: no-preference\)/);
  assert.match(css,/button:focus-visible/);
  let depth = 0;
  for (const char of css) {
    if (char === "{") depth++;
    if (char === "}") depth--;
    assert.ok(depth >= 0);
  }
  assert.equal(depth,0);
});

test("chart bucketing handles an empty series and rejects intervals that cannot advance", () => {
  assert.deepEqual(bucketDays([], 1), []);
  for (const size of [0, -1, 0.5, NaN, "2"]) assert.throws(() => bucketDays([{ day: "2026-11-23", done: 1 }], size), /interval/);
});

test("both bundled pixel landscapes reproduce byte-for-byte and decode to valid indexed rasters", () => {
  for (const [file,draw,w,h] of [["highland-dusk",landscape,576,140],["night-camp",campsite,148,61]]) {
    const bytes = fs.readFileSync(path.join(root,"assets",file + ".png"));
    assert.deepEqual(bytes,draw().png());
    assert.equal(bytes.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
    const chunks = new Map();
    let offset = 8;
    while (offset < bytes.length) {
      const length = bytes.readUInt32BE(offset);
      const key = bytes.toString("ascii",offset+4,offset+8);
      chunks.set(key,bytes.subarray(offset+8,offset+8+length));
      offset += length + 12;
    }
    assert.equal(offset,bytes.length);
    assert.equal(chunks.get("IHDR").readUInt32BE(0),w);
    assert.equal(chunks.get("IHDR").readUInt32BE(4),h);
    assert.deepEqual([...chunks.get("IHDR").subarray(8)],[8,3,0,0,0]);
    const raw = inflateSync(chunks.get("IDAT"));
    const colors = chunks.get("PLTE").length / 3;
    assert.equal(raw.length,(w+1)*h);
    assert.ok(colors >= 16 && colors <= 256);
    for (let row = 0; row < h; row++) {
      assert.equal(raw[row*(w+1)],0);
      assert.ok(raw.subarray(row*(w+1)+1,(row+1)*(w+1)).every(index => index < colors));
    }
    assert.ok(new Set(raw).size >= 16);
  }
});

test("the optional local server serves all published files with their exact bytes and content types", async () => {
  for (const [route,file] of files) {
    const response = await request(route + "?v=1");
    const bytes = fs.readFileSync(path.join(root,file));
    assert.equal(response.status,200);
    assert.equal(response.headers["Content-Length"],bytes.length);
    const expected = {".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".png":"image/png"};
    assert.equal(response.headers["Content-Type"].split(";")[0],expected[path.extname(file)]);
    assert.deepEqual(response.data,bytes);
  }
});

test("HEAD returns metadata, and the local server handles missing pages and unsupported methods", async () => {
  const head = await request("/","HEAD");
  assert.equal(head.status,200);
  assert.equal(head.data,undefined);
  assert.ok(head.headers["Content-Length"] > 0);
  assert.equal((await request("/not-a-page")).status,404);
  assert.equal((await request("/package.json")).status,404);
  assert.equal((await request("/missing","HEAD")).data,undefined);
  const unsupported = await request("/","POST");
  assert.equal(unsupported.status,405);
  assert.equal(unsupported.headers.Allow,"GET, HEAD");
});

test("the local server accepts only valid port numbers", () => {
  for (const [arg,valid] of [["3000",3000],[1,1],["65535",65535]]) assert.equal(portNumber(arg),valid);
  for (const arg of [undefined,"",0,"0","-1",65536,"1.5","8000abc"]) assert.throws(() => portNumber(arg),/port/);
});
