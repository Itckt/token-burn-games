"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { entries } = require("./entries.js");

function filePhrasebook(directory = path.join(__dirname, ".street-cantonese")) {
  function read() {
    try {
      const names = new Set(fs.readdirSync(directory, { withFileTypes: true })
        .filter(file => file.isFile()).map(file => file.name));
      return new Set(entries.filter(entry => names.has(entry.term + ".saved")).map(entry => entry.term));
    } catch (err) {
      if (err.code === "ENOENT") return new Set();
      throw new Error(`Could not read the phrasebook (${err.code}).`);
    }
  }

  // One marker per canonical headword lets separate CLI sessions edit different entries independently.
  function set(entry, saved) {
    if (!entries.includes(entry)) throw new Error("Choose an entry from the dictionary.");
    const filename = path.join(directory, entry.term + ".saved");
    try {
      if (saved) {
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(filename, "", { flag: "wx" });
      } else {
        fs.unlinkSync(filename);
      }
      return true;
    } catch (err) {
      if (saved && err.syscall === "open" && err.code === "EEXIST") {
        const existing = fs.lstatSync(filename, { throwIfNoEntry: false });
        if (!existing || existing.isFile()) return false;
      }
      if (!saved && err.code === "ENOENT") return false;
      throw new Error(`Could not update the phrasebook (${err.code}).`);
    }
  }

  return { read, set };
}

module.exports = { filePhrasebook };
