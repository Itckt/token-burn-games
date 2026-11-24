(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./collision.js'));
  else root.Atlas.notebook = factory(root.Atlas.collision);
})(globalThis, function (collision) {
  'use strict';
  const {canWalk} = collision;
  const PREFIX = 'campus-atlas.stamp.v1.';
  const REACH = 1.65;
  function pressAt(x, z, world) {
    return world.places.find(({stamp}) => {
      const [px, pz] = stamp.at;
      return Math.hypot(x-px, z-pz) <= REACH && canWalk(x, z, px, pz, world);
    });
  }
  class Collection {
    constructor(items, getStorage, prefix) {
      this.prefix = prefix;
      this.ids = new Set(items.map(item => item.id));
      this.entries = new Set();
      this.unsaved = new Set();
      // Some browsers throw on the localStorage getter itself for file URLs.
      try { this.storage = getStorage(); } catch { this.storage = null; }
      this.saved = !!this.storage;
      this.read();
    }
    read() {
      if (!this.storage) return;
      try {
        const stored = [...this.ids].filter(id => this.storage.getItem(this.prefix + id) === '1');
        for (const id of stored) this.unsaved.delete(id);
        this.entries.clear();
        for (const id of [...stored, ...this.unsaved]) this.entries.add(id);
        this.saved = this.unsaved.size === 0;
      } catch { this.saved = false; }
    }
    collect(id) {
      if (!this.ids.has(id) || this.entries.has(id)) return false;
      this.entries.add(id);
      // Separate keys let two open walks collect different impressions independently.
      if (this.storage) {
        try { this.storage.setItem(this.prefix + id, '1'); }
        catch { this.unsaved.add(id); this.saved = false; }
      }
      return true;
    }
  }
  class Notebook extends Collection {
    constructor(places, getStorage) { super(places,getStorage,PREFIX); }
    get stamps() { return this.entries; }
  }
  return {PREFIX, REACH, pressAt, Collection, Notebook};
});
