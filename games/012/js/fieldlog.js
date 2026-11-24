(function (root) {
  "use strict";
  const common = typeof module === "object" && module.exports;
  const dep = name => common ? require("./" + name + ".js") : root.OrbitAtlas[name];
  const { validPair } = dep("encounters"), { inCalendar } = dep("time");
  const prefix = "orbit-atlas.observation.v1/";
  const keyFor = ({ from, to, day }) => prefix + [from, to, day].join("/");
  const cleanName = name => typeof name === "string" ? name.trim().slice(0, 60) : "";

  class FieldLog {
    constructor(storage = null) {
      this.storage = storage;
      this.notes = new Map();
      this.refresh();
    }
    refresh() {
      if (!this.storage) return;
      const notes = new Map();
      try {
        for (let i = 0; i < this.storage.length; i++) {
          const key = this.storage.key(i);
          if (!key?.startsWith(prefix)) continue;
          const [from, to, instant] = key.slice(prefix.length).split("/");
          const day = Number(instant);
          if (!validPair(from, to) || !inCalendar(day) || keyFor({ from, to, day }) !== key) continue;
          const name = cleanName(this.storage.getItem(key));
          if (name) notes.set(key, { from, to, day, name });
        }
        this.notes = notes;
      } catch {
        this.storage = null;
      }
    }
    get entries() {
      return [...this.notes.values()].sort((a, b) => b.day - a.day || a.name.localeCompare(b.name));
    }
    save(from, to, day, name) {
      name = cleanName(name);
      if (!validPair(from, to) || !inCalendar(day) || !name) throw new RangeError("Invalid field note");
      const note = { from, to, day, name }, key = keyFor(note);
      // A separate key per instant and ordered pair lets two tabs add distinct notes independently.
      this.notes.set(key, note);
      try { this.storage?.setItem(key, name); }
      catch { this.storage = null; }
    }
    remove(note) {
      const key = keyFor(note);
      if (!this.notes.delete(key)) return;
      try { this.storage?.removeItem(key); }
      catch { this.storage = null; }
    }
  }

  const api = { FieldLog };
  if (common) module.exports = api;
  else (root.OrbitAtlas ||= {}).fieldlog = api;
})(globalThis);
