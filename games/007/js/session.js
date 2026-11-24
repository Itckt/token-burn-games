"use strict";

var TwistSession = (function (cube, trials) {
  const SPEEDS = [0.5, 0.75, 1, 1.5, 2];
  const BOUNDARY_EPSILON_MS = 1e-9;
  class Session {
    constructor(initial = cube.STARTER, now = () => performance.now()) {
      this.now = now;
      this.speed = 1;
      this.ticket = 0;
      this.revision = 0;
      this.load(initial, initial.length ? "Starter mix" : "Free play");
    }
    load(moves, label) {
      if (!Array.isArray(moves)) throw new TypeError("Expected an array of cube turns.");
      this.pieces = cube.apply(cube.create(), moves);
      this.ticket++;
      this.history = moves.slice();
      this.source = label;
      this.solved = cube.isSolved(this.pieces);
      this.trial = null;
      this.clearPlan();
      this.revision++;
    }
    clearPlan() {
      this.playback = null;
      this.plan = [];
      this.cursor = 0;
      this.active = null;
      this.paused = false;
      this.singleStep = false;
      this.mode = "idle";
    }
    reset() { this.load([], "Free play"); }
    get trialActive() { return this.trial !== null && this.trial.finishedAt === null; }
    get canStartSequence() { return this.mode === "idle" && !this.trialActive; }
    startTrial(code) {
      if (!this.canStartSequence) return false;
      const challenge = trials.challenge(code);
      this.load(challenge.moves, "Time trial");
      this.trial = { code: challenge.code, turns: 0, startedAt: null, finishedAt: null };
      return true;
    }
    trialElapsed() {
      if (this.trial?.startedAt == null) return 0;
      return Math.max(0, (this.trial.finishedAt ?? this.now()) - this.trial.startedAt);
    }
    endTrial() {
      if (!this.trialActive) return false;
      this.trial = null;
      this.clearPlan();
      this.source = "Free play";
      this.revision++;
      return true;
    }
    get solution() { return this.playback === "solving" ? this.plan : null; }
    get playing() { return this.playback !== null && this.mode === this.playback; }
    setSpeed(speed) {
      if (!SPEEDS.includes(speed)) throw new RangeError("Unsupported playback speed");
      this.speed = speed;
      this.revision++;
    }
    start(mode, moves) {
      if (!this.trialActive) this.trial = null;
      this.mode = mode;
      this.playback = mode === "solving" || mode === "algorithm" ? mode : null;
      this.plan = moves.slice();
      this.cursor = 0;
      this.paused = false;
      this.singleStep = false;
      this.startTurn();
      this.revision++;
    }
    startTurn() {
      const move = this.plan[this.cursor];
      const spec = cube.describe(move);
      this.active = { move, ...spec, progress: 0, angle: 0 };
    }
    manual(move) {
      cube.describe(move);
      if (this.mode === "manual" && this.plan.length - this.cursor < 16) {
        this.plan.push(move);
        return true;
      }
      if (this.mode !== "idle") return false;
      if (this.trialActive) {
        if (this.trial.startedAt === null) this.trial.startedAt = this.now();
      } else this.source = "Free play";
      this.start("manual", [move]);
      return true;
    }
    undo() {
      if (!this.canStartSequence || !this.history.length) return false;
      this.source = "Free play";
      this.start("undo", [cube.inverse(this.history[this.history.length - 1])]);
      return true;
    }
    scramble(random = Math.random) {
      if (!this.canStartSequence) return false;
      const moves = cube.scramble(20, random);
      this.load([], "Scramble");
      this.start("scrambling", moves);
      return true;
    }
    playAlgorithm(moves) {
      if (!this.canStartSequence || !Array.isArray(moves) || !moves.length) return false;
      for (const move of moves) cube.describe(move);
      this.source = "Algorithm";
      this.start("algorithm", moves);
      return true;
    }
    requestSolve() {
      if (!this.canStartSequence || this.solved) return null;
      this.playback = null;
      this.mode = "planning";
      this.revision++;
      return { ticket: ++this.ticket, state: cube.coordinates(this.pieces) };
    }
    receiveSolution(ticket, route) {
      if (this.mode !== "planning" || ticket !== this.ticket) return false;
      if (!Array.isArray(route)) throw new TypeError("Expected a route of cube turns.");
      const moves = cube.simplify(route);
      if (!moves.length || !cube.isSolved(cube.apply(cube.clone(this.pieces), moves))) {
        throw new Error("The route did not solve this cube.");
      }
      this.source = "Auto-solve";
      this.start("solving", moves);
      return true;
    }
    cancelPlanning(ticket) {
      if (this.mode !== "planning" || this.ticket !== ticket) return false;
      this.mode = "idle";
      this.revision++;
      return true;
    }
    togglePause() {
      if (!this.playing) return false;
      this.paused = !this.paused;
      this.singleStep = false;
      this.revision++;
      return true;
    }
    stepOnce() {
      if (!this.playing || !this.paused) return false;
      this.paused = false;
      this.singleStep = true;
      this.revision++;
      return true;
    }
    commitNext() {
      const move = this.plan[this.cursor];
      cube.turn(this.pieces, move);
      if (this.mode === "undo") this.history.pop();
      else this.history.push(move);
      this.cursor++;
    }
    alignTurn(paused) {
      this.singleStep = false;
      if (this.cursor === this.plan.length) {
        this.active = null;
        this.mode = "idle";
        this.paused = false;
      } else {
        this.startTurn();
        this.paused = paused;
      }
    }
    seek(completed) {
      if (!this.playback || !Number.isInteger(completed) || completed < 0 || completed > this.plan.length) return false;
      // The model contains exactly the completed prefix. A partially drawn
      // turn has no integer state to undo. The pre-playback history stays put.
      this.mode = this.playback;
      while (this.cursor > completed) {
        this.cursor--;
        cube.turn(this.pieces, cube.inverse(this.plan[this.cursor]));
        this.history.pop();
      }
      while (this.cursor < completed) this.commitNext();
      this.solved = cube.isSolved(this.pieces);
      this.alignTurn(true);
      this.revision++;
      return true;
    }
    endPlayback() {
      if (!this.playback) return false;
      this.clearPlan();
      this.source = "Free play";
      this.revision++;
      return true;
    }
    tick(milliseconds) {
      if (!this.active || this.paused || !Number.isFinite(milliseconds) || milliseconds <= 0) return false;
      let remaining = milliseconds;
      while (this.active && !this.paused && remaining > 0) {
        const turn = this.active;
        // A trial always animates at the same pace, regardless of playback speed.
        const quarterMs = this.trialActive ? 160 : (this.mode === "scrambling" ? 85 : 530) / this.speed;
        const duration = quarterMs * (turn.turns === 2 ? 1.25 : 1);
        const excess = remaining - (1 - turn.progress) * duration;
        // Fractional frames can sum just either side of an exact boundary.
        if (excess < -BOUNDARY_EPSILON_MS) {
          turn.progress += remaining / duration;
          const p = turn.progress;
          turn.angle = turn.quarter * Math.PI / 2 * p * p * (3 - 2 * p);
          break;
        }
        remaining = excess > BOUNDARY_EPSILON_MS ? excess : 0;
        this.commitNext();
        this.solved = cube.isSolved(this.pieces);
        this.revision++;
        if (this.trialActive) {
          this.trial.turns++;
          if (this.solved) {
            this.trial.finishedAt = this.now();
            this.clearPlan(); // Later buffered inputs belong to neither the result nor free play.
            break;
          }
        }
        this.alignTurn(this.singleStep);
      }
      return true;
    }
  }
  return { Session, SPEEDS };
})(typeof module !== "undefined" && module.exports ? require("./cube.js") : TwistCube,
   typeof module !== "undefined" && module.exports ? require("./trials.js") : TwistTrials);

if (typeof module !== "undefined" && module.exports) module.exports = TwistSession;
