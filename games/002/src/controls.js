(() => {
  "use strict";
  const movementKeys = ["KeyW", "KeyA", "KeyS", "KeyD"];

  // Keep short taps until the next simulation tick, even on a fast display.
  class Controls {
    constructor() {
      this.keys = new Set();
      this.clear();
    }
    clear() {
      this.keys.clear();
      this.held = false;
      this.tap = false;
      this.dash = false;
      this.pulse = false;
      this.vane = false;
      this.rally = false;
      this.rallyPoint = null;
      this.focusTarget = undefined;
      this.pass = false;
      this.passPoint = null;
      this.cards = [];
    }
    press(code, ground) {
      if (movementKeys.includes(code)) this.keys.add(code);
      if (code === "Space") this.dash = true;
      if (code === "KeyE") this.pulse = true;
      if (code === "KeyF") this.vane = true;
      if (code === "KeyR") {
        this.rally = true;
        this.rallyPoint = ground;
      }
      if (code === "KeyQ") {
        this.pass = true;
        this.passPoint = ground;
      }
      if (code === "Digit1" || code === "Digit2") this.card(code === "Digit1" ? 0 : 1);
    }
    card(slot) {
      if (this.cards.length < 2) this.cards.push(slot);
    }
    trigger() {
      this.tap = true;
      this.held = true;
    }
    sample(cameraYaw, aim) {
      const right = Number(this.keys.has("KeyD")) - Number(this.keys.has("KeyA"));
      const down = Number(this.keys.has("KeyS")) - Number(this.keys.has("KeyW"));
      const c = Math.cos(cameraYaw), s = Math.sin(cameraYaw);
      const input = {
        mx: right * c + down * s, mz: down * c - right * s,
        aimX: aim?.[0], aimZ: aim?.[2], fire: this.held || this.tap,
        dash: this.dash, pulse: this.pulse, vane: this.vane, card: this.cards.shift(),
        rally: this.rally, rallyX: this.rallyPoint?.[0], rallyZ: this.rallyPoint?.[2],
        focusTarget: this.focusTarget,
        pass: this.pass, passX: this.passPoint?.[0], passZ: this.passPoint?.[2]
      };
      this.tap = this.dash = this.pulse = this.vane = this.rally = this.pass = false;
      this.rallyPoint = this.passPoint = null;
      this.focusTarget = undefined;
      return input;
    }
  }
  const api = { Controls, movementKeys };
  if (typeof module === "object" && module.exports) module.exports = api;
  else (globalThis.Slipwake ||= {}).controls = api;
})();
