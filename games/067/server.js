"use strict";
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const files = new Map([
  ["/", "index.html"], ["/index.html", "index.html"], ["/styles.css", "styles.css"],
  ...["model", "storage", "art", "views", "app"].map(name => ["/js/" + name + ".js", "js/" + name + ".js"]),
  ...["ember.svg", "highland-dusk.png", "night-camp.png"].map(name => ["/assets/" + name, "assets/" + name])
]);
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png"
};

async function serve(req, res) {
  const sendText = (status, message, headers = {}) => {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", ...headers });
    res.end(req.method === "HEAD" ? undefined : message);
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(405, "Use GET or HEAD.", { Allow: "GET, HEAD" });
    return;
  }
  const file = files.get(req.url.split("?", 1)[0]);
  if (!file) { sendText(404, "Page not found."); return; }
  try {
    const bytes = await fs.readFile(path.join(__dirname, file));
    res.writeHead(200, { "Content-Type": types[path.extname(file)], "Content-Length": bytes.length,
      "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : bytes);
  } catch {
    sendText(500, "Could not read a project file.");
  }
}

function portNumber(value) {
  if (!/^\d{1,5}$/.test(String(value)) || Number(value) > 65535 || Number(value) < 1) {
    throw new Error("Choose a port between 1 and 65535.");
  }
  return Number(value);
}

if (require.main === module) {
  try {
    const at = process.argv.indexOf("--port");
    const port = portNumber(at < 0 ? process.env.PORT || "3000" : process.argv[at + 1]);
    const server = http.createServer(serve);
    server.on("error", error => { console.error("Embertrail could not start. " + error.message); process.exitCode = 1; });
    server.listen(port, "127.0.0.1", () => console.log(`Embertrail is available at http://127.0.0.1:${port}`));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
module.exports = { files, serve, portNumber };
