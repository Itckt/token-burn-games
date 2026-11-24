(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./track.js") : root.FoundryTrack);
  if (node) module.exports = api;
  else root.FoundryBlueprint = api;
})(globalThis, function (T) {
  "use strict";
  const pieces = [...T.LIBRARY, {id: "rise", code: "U"}];
  const toCode = new Map(pieces.map(piece => [piece.id, piece.code]));
  const fromCode = new Map(pieces.map(piece => [piece.code, piece.id]));
  function trackName(value) {
    const name = typeof value === "string" ? value.trim() : "";
    if (!name || name.length > 48 || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(name)) {
      throw new Error("Use a track name of 1 to 48 characters on one line.");
    }
    return name;
  }
  function releaseHeight(height) {
    if (!T.validHeight(height)) {
      throw new Error("The release height must be between " + T.MIN_HEIGHT + " and " + T.MAX_HEIGHT + " metres.");
    }
    return height;
  }
  function translate(items, map) {
    if (!Array.isArray(items)) throw new Error("A blueprint needs a list of pieces.");
    if (items.length > T.LIMIT) throw new Error("A blueprint can hold up to " + T.LIMIT + " pieces.");
    return Array.from(items, item => {
      if (!map.has(item)) throw new Error("The blueprint contains an unknown piece.");
      return map.get(item);
    });
  }
  function encode(layout) {
    const name = trackName(layout.name), height = releaseHeight(layout.height);
    return "LF1/" + height + "/" + translate(layout.pieces,toCode).join("") + "/" + name;
  }
  function decode(text) {
    if (typeof text !== "string" || text.length > 256) throw new Error("Paste a complete LF1 track code.");
    const fields = /^LF1\/(\d+(?:\.\d+)?)\/([^/]*)\/(.+)$/u.exec(text.trim());
    if (!fields) throw new Error("Paste a complete LF1 track code, including its name.");
    return {name: trackName(fields[3]), height: releaseHeight(Number(fields[1])),
      pieces: translate(Array.from(fields[2]),fromCode)};
  }
  return {encode, decode};
});
