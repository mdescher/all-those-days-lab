// The rules of a room, ported from Yesterlight/Puzzle/Puzzle.swift and Session.swift for the
// web Lab. Change all three (and Tools/afterglow_solver.py) together.
//
// Cells are numbers y * W + x. A tile is an object {kind, ...}: floor, wall, exit, light
// (owner: ghost index or null), switch / toggle / door (letter A-D), oneway (dx, dy), hole,
// forget, portal (letter q-t).
(function (root) {
  const W = 7, H = 10;
  const cell = (x, y) => y * W + x;
  const cx = c => c % W, cy = c => Math.floor(c / W);
  const isNeighbour = (a, b) => Math.abs(cx(a) - cx(b)) + Math.abs(cy(a) - cy(b)) === 1;
  const WALL = { kind: "wall" };

  // FNV-1a, 64 bit, as Puzzle.mapHash: over the map rows joined by newlines, "|" and the
  // open doors.
  function fnv1a(text) {
    let hash = 0xcbf29ce484222325n;
    const prime = 0x100000001b3n, mask = 0xffffffffffffffffn;
    for (const byte of new TextEncoder().encode(text)) {
      hash ^= BigInt(byte);
      hash = (hash * prime) & mask;
    }
    return hash.toString(16).padStart(16, "0");
  }

  // A room from a level entry {id, best, map, open}; null if malformed.
  function parse(level) {
    const tiles = [], lights = [], blocks = [], startsByNumber = {}, ends = {};
    if (!Array.isArray(level.map) || level.map.length !== H) return null;
    for (let y = 0; y < H; y++) {
      const row = level.map[y];
      if (row.length !== W) return null;
      for (let x = 0; x < W; x++) {
        const ch = row[x], c = cell(x, y);
        let t;
        if (ch === "#") t = WALL;
        else if (ch === "*") { t = { kind: "light", owner: null }; lights.push(c); }
        else if (ch >= "w" && ch <= "z") { t = { kind: "light", owner: ch.charCodeAt(0) - 119 }; lights.push(c); }
        else if (ch === "E") t = { kind: "exit" };
        else if (ch >= "1" && ch <= "4") { t = { kind: "floor" }; startsByNumber[ch] = c; }
        else if (ch >= "a" && ch <= "d") t = { kind: "switch", letter: ch.toUpperCase() };
        else if (ch >= "m" && ch <= "p") t = { kind: "toggle", letter: String.fromCharCode(ch.charCodeAt(0) - 109 + 65) };
        else if (ch >= "A" && ch <= "D") t = { kind: "door", letter: ch };
        else if (ch === "$") { t = { kind: "floor" }; blocks.push(c); }
        else if (ch === "O") t = { kind: "hole" };
        else if (ch === "f") t = { kind: "forget" };
        else if (ch >= "q" && ch <= "t") { t = { kind: "portal", letter: ch }; (ends[ch] = ends[ch] || []).push(c); }
        else if (ch === "^") t = { kind: "oneway", dx: 0, dy: -1 };
        else if (ch === "v") t = { kind: "oneway", dx: 0, dy: 1 };
        else if (ch === "<") t = { kind: "oneway", dx: -1, dy: 0 };
        else if (ch === ">") t = { kind: "oneway", dx: 1, dy: 0 };
        else t = { kind: "floor" };
        tiles.push(t);
      }
    }
    const numbers = Object.keys(startsByNumber).sort();
    if (!numbers.length || Object.values(ends).some(e => e.length !== 2)) return null;
    const portals = new Map();
    for (const [a, b] of Object.values(ends)) { portals.set(a, b); portals.set(b, a); }
    return {
      id: level.id, best: level.best, tiles, lights, blocks, portals,
      starts: numbers.map(n => startsByNumber[n]),
      openAtStart: new Set(level.open || ""),
      mapHash: fnv1a(level.map.join("\n") + "|" + (level.open || "")),
    };
  }

  function tile(p, c, x, y) {
    if (x === undefined) { x = cx(c); y = cy(c); }
    if (x < 0 || x >= W || y < 0 || y >= H) return WALL;
    return p.tiles[cell(x, y)];
  }
  // Out of the room counts as wall; a step direction never wraps around a row.
  const tileAt = (p, x, y) => tile(p, null, x, y);

  // A wall with no open tile around it, not even diagonally: drawn as nothing.
  function isHidden(p, c) {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        if (tileAt(p, cx(c) + dx, cy(c) + dy).kind !== "wall") return false;
    return true;
  }

  function moons(p, steps) { return steps <= p.best ? 3 : steps <= p.best + 3 ? 2 : 1; }

  // Whether the light at c burns after `ghost` enters it, or null for no light.
  function lightAfter(p, c, wasOn, ghost) {
    const t = p.tiles[c];
    if (t.kind !== "light") return null;
    if (t.owner !== null && t.owner !== ghost) return false;
    return !wasOn;
  }

  function mayLeave(p, c, dx, dy) {
    const t = p.tiles[c];
    return t.kind !== "oneway" || (t.dx === dx && t.dy === dy);
  }

  function press(p, c, doors) {
    const t = p.tiles[c];
    if (t.kind === "switch") doors.add(t.letter);
    else if (t.kind === "toggle") { if (doors.has(t.letter)) doors.delete(t.letter); else doors.add(t.letter); }
  }

  // One attempt at a room, as Session.swift.
  class Session {
    constructor(p) { this.p = p; this.restart(); }

    restart() {
      const p = this.p;
      this.lit = new Set();
      this.openDoors = new Set(p.openAtStart);
      this.blocks = p.blocks.slice();
      this.sunk = new Set();
      this.usedExits = new Set();
      this.out = new Set();
      this.active = null;
      this.trail = [];
      this.usedForgets = new Set();
      this.walked = [];
      this.forgotten = null;
      this.leaving = null;
      this.steps = 0;
      this.walks = [];
      this.chooseTheLastOne();
    }

    get position() { return this.active === null ? null : this.trail[this.trail.length - 1]; }
    get waiting() { return this.p.starts.map((_, i) => i).filter(i => !this.out.has(i) && i !== this.active); }
    get isFinished() { return this.out.size === this.p.starts.length; }
    get isSolved() { return this.isFinished && this.lit.size === this.p.lights.length; }
    get moons() { return moons(this.p, this.steps); }
    get canDeselect() { return this.active !== null && this.walked.length === 1 && this.out.size < this.p.starts.length - 1; }

    isExit(c) { return this.p.tiles[c].kind === "exit" && !this.usedExits.has(c); }
    isPortal(c) { return this.p.tiles[c].kind === "portal"; }
    filledHoles() { return new Set([...this.sunk].map(i => this.blocks[i])); }
    blockAt(c) {
      for (let i = 0; i < this.blocks.length; i++) if (!this.sunk.has(i) && this.blocks[i] === c) return i;
      return -1;
    }
    hasBlock(c) { return this.blockAt(c) >= 0; }
    visited() { return new Set([...this.trail, ...this.usedForgets]); }
    isWaitingStart(c) { return this.waiting.some(g => this.p.starts[g] === c); }

    canEnter(c, avoiding, doors, ignoringBlocks) {
      if (avoiding.has(c) || this.isWaitingStart(c) || (!ignoringBlocks && this.hasBlock(c))) return false;
      const t = this.p.tiles[c];
      switch (t.kind) {
        case "wall": return false;
        case "hole": return this.filledHoles().has(c);
        case "portal": return !avoiding.has(this.p.portals.get(c));
        case "door": return doors.has(t.letter);
        default: return true;
      }
    }

    // The tile beyond `c` seen from `from`, or null when it is outside the room.
    beyond(c, from) {
      const x = 2 * cx(c) - cx(from), y = 2 * cy(c) - cy(from);
      return x < 0 || x >= W || y < 0 || y >= H ? null : cell(x, y);
    }

    canPush(c, from) {
      if (!this.hasBlock(c) || !this.canEnter(c, this.visited(), this.openDoors, true)) return false;
      const b = this.beyond(c, from);
      if (b === null) return false;
      const k = this.p.tiles[b].kind;
      return (k === "floor" || k === "hole") && !this.hasBlock(b) && !this.isWaitingStart(b);
    }

    // The tiles walked to reach `target` in a straight line, one by one, as if each were
    // tapped; null if the way is not free.
    straightPath(target) {
      const pos = this.position;
      if (pos === null || pos === undefined || target === pos || (cx(target) !== cx(pos) && cy(target) !== cy(pos))) return null;
      const dx = Math.sign(cx(target) - cx(pos)), dy = Math.sign(cy(target) - cy(pos));
      let visited = this.visited();
      const doors = new Set(this.openDoors);
      const cells = [];
      let at = pos;
      while (at !== target) {
        const next = cell(cx(at) + dx, cy(at) + dy);
        if (next === target && this.hasBlock(next)) {
          if (!mayLeave(this.p, at, dx, dy) || !this.canPush(next, at)) return null;
          return cells.concat([next]);
        }
        if (!mayLeave(this.p, at, dx, dy) || !this.canEnter(next, visited, doors, false)) return null;
        if ((this.isExit(next) || this.isPortal(next)) && next !== target) return null;
        cells.push(next);
        if (this.p.tiles[next].kind === "forget") visited = new Set(this.usedForgets);
        visited.add(next);
        at = next;
        press(this.p, next, doors);
      }
      return cells;
    }

    choose(g) {
      if (this.active !== null || !this.waiting.includes(g)) return false;
      this.leaving = null;
      this.active = g;
      this.trail = [this.p.starts[g]];
      this.walked = this.trail.slice();
      this.usedForgets = new Set();
      this.forgotten = null;
      return true;
    }

    deselect() {
      if (!this.canDeselect) return false;
      this.active = null;
      this.trail = [];
      this.walked = [];
      return true;
    }

    chooseTheLastOne() {
      const w = this.waiting;
      if (this.active === null && w.length === 1) this.choose(w[0]);
    }

    // Steps the active ghost onto a neighbouring tile. Returns the outcome ("moved",
    // "on", "off", "left", "pushed", "filled", "forgot", "teleported") or null.
    step(c) {
      const g = this.active, pos = this.position;
      if (g === null || !isNeighbour(pos, c) || !mayLeave(this.p, pos, cx(c) - cx(pos), cy(c) - cy(pos))) return null;
      const b = this.blockAt(c);
      if (b >= 0) {
        if (!this.canPush(c, pos)) return null;
        this.steps++;
        const to = this.beyond(c, pos);
        const falls = this.p.tiles[to].kind === "hole" && !this.filledHoles().has(to);
        this.blocks[b] = to;
        if (falls) this.sunk.add(b);
        this.trail.push(c);
        this.walked.push(c);
        return falls ? "filled" : "pushed";
      }
      if (!this.canEnter(c, this.visited(), this.openDoors, false)) return null;
      this.steps++;
      if (this.isExit(c)) {
        this.usedExits.add(c);
        this.out.add(g);
        this.walks.push({ ghost: g, cells: this.walked.concat([c]) });
        this.active = null;
        this.trail = [];
        this.walked = [];
        this.forgotten = null;
        this.leaving = { ghost: g, cell: c };
        return "left";
      }
      const other = this.p.portals.get(c);
      if (other !== undefined) {
        this.trail.push(c, other);
        this.walked.push(c, other);
        return "teleported";
      }
      this.walked.push(c);
      if (this.p.tiles[c].kind === "forget") {
        this.forgotten = this.trail.concat([c]);
        this.usedForgets.add(c);
        this.trail = [c];
        return "forgot";
      }
      this.trail.push(c);
      const wasOn = this.lit.has(c);
      const on = lightAfter(this.p, c, wasOn, g);
      if (on !== null) {
        if (on === wasOn) return "moved";
        if (on) this.lit.add(c); else this.lit.delete(c);
        return on ? "on" : "off";
      }
      press(this.p, c, this.openDoors);
      return "moved";
    }
  }

  const api = { W, H, cell, cx, cy, isNeighbour, parse, tile: (p, c) => p.tiles[c], tileAt, isHidden, moons, press, mayLeave, Session };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Rules = api;
})(this);
