// Plays a room with its animations, after PlayView.swift: walks a ghost step by step, lets
// it fade on its exit, and runs the ending (every ghost walks its way again, the lights
// switch for all to see, pulse twice, and swirl if all burn). Used by the play screen and by
// the guide's demos; `view()` gives Board what to draw.
(function (root) {
  const R = root.Rules;
  const CANCELLED = { cancelled: true };
  const STEP = 110, GLIDE = 100, REPLAY = 1000 / 9, SWIRL = 1700;

  class Runner {
    constructor(puzzle, hooks) {
      this.p = puzzle;
      this.hooks = hooks || {};
      this.s = new R.Session(puzzle);
      this.token = 0;
      this.reset();
    }

    reset() {
      this.busy = false;
      this.move = null;
      this.flickers = [];
      this.leaving = null;
      this.forgot = null;
      this.ending = null;
    }

    // Stops every running walk or ending.
    cancel() { this.token++; this.reset(); }

    restart() {
      this.cancel();
      this.s.restart();
    }

    async sleep(ms, token) {
      await new Promise(r => setTimeout(r, ms));
      if (token !== this.token) throw CANCELLED;
    }

    // Runs an animation; a cancelled one ends quietly.
    async run(fn) {
      const token = this.token;
      try { await fn(token); return true; } catch (e) { if (e === CANCELLED) return false; throw e; }
    }

    // Walks the active ghost along `cells` (from Session.straightPath); returns when it has
    // stopped, left (and faded) or the walk was cancelled.
    walk(cells) {
      return this.run(async token => {
        this.busy = true;
        for (let i = 0; i < cells.length; i++) {
          if (i > 0) await this.sleep(STEP, token);
          const from = this.s.position;
          const outcome = this.s.step(cells[i]);
          if (outcome === null) break;
          this.move = { from, to: outcome === "teleported" ? this.s.position : cells[i], at: performance.now(), jump: outcome === "teleported" };
          if (outcome === "on" || outcome === "off") this.flickers.push({ cell: cells[i], on: outcome === "on", at: performance.now() });
          if (outcome === "forgot") this.forgot = { cells: this.s.forgotten, at: performance.now() };
          if (outcome === "filled") await this.sleep(300, token);
          if (this.hooks.onStep) this.hooks.onStep(outcome);
        }
        await this.sleep(80, token);
        if (this.s.leaving) {
          // The step onto the exit is seen whole, then the ghost fades and the last waiting
          // one, if only one is left, is chosen.
          this.leaving = { ghost: this.s.leaving.ghost, cell: this.s.leaving.cell, at: performance.now() + 60 };
          this.forgot = null;
          await this.sleep(360, token);
          this.leaving = null;
          this.s.leaving = null;
          this.s.chooseTheLastOne();
        }
        this.busy = false;
      });
    }

    // Every ghost walks its way again from a reset room, the lights visible; resolves with
    // whether the room is solved, after the swirl and flash or the dark pulse.
    playEnding() {
      const walks = this.s.walks.slice();
      const solved = this.s.isSolved;
      return this.run(async token => {
        this.busy = true;
        await this.sleep(500, token);
        const rs = new R.Session(this.p);
        rs.active = null; rs.trail = []; rs.walked = [];
        this.ending = { rs, started: new Set(), walker: null, pulse: null, swirl: null };
        await this.sleep(500, token);
        for (const walk of walks) {
          this.ending.started.add(walk.ghost);
          rs.choose(walk.ghost);
          const cells = walk.cells;
          this.ending.walker = { ghost: walk.ghost, x: R.cx(cells[0]), y: R.cy(cells[0]) };
          for (let i = 1; i < cells.length; i++) {
            if (cells[i] === rs.position) continue;
            const from = cells[i - 1], to = cells[i];
            const t0 = performance.now();
            this.ending.glide = { from, to, t0, ghost: walk.ghost };
            await this.sleep(REPLAY / 2, token);
            const outcome = rs.step(to);
            if (outcome === "on" || outcome === "off") this.flickers.push({ cell: to, on: outcome === "on", at: performance.now() });
            if (outcome === "teleported") {
              await this.sleep(REPLAY / 2, token);
              this.ending.glide = { from: rs.position, to: rs.position, t0, ghost: walk.ghost };
              continue;
            }
            if (outcome === "filled") await this.sleep(300, token);
            await this.sleep(REPLAY / 2, token);
          }
          this.ending.glide = null;
          this.ending.walker = null;
          await this.sleep(250, token);
        }
        for (let i = 0; i < 2; i++) {
          this.ending.pulse = { at: performance.now() };
          await this.sleep(550, token);
        }
        if (solved) {
          this.ending.swirl = { at: performance.now(), duration: SWIRL };
          await this.sleep(SWIRL, token);
          if (this.hooks.onFlash) this.hooks.onFlash();
          await this.sleep(450, token);
        } else {
          await this.sleep(400, token);
        }
        this.busy = false;
      });
    }

    view(now) {
      const s = this.s;
      this.flickers = this.flickers.filter(f => now - f.at < 600);
      if (this.ending) {
        const e = this.ending, rs = e.rs;
        let walker = null;
        if (e.glide) {
          const g = e.glide, k = Math.min(1, (now - g.t0) / REPLAY);
          walker = { ghost: g.ghost, x: R.cx(g.from) + (R.cx(g.to) - R.cx(g.from)) * k, y: R.cy(g.from) + (R.cy(g.to) - R.cy(g.from)) * k, alpha: 1, scale: 1.1 };
        } else if (e.walker) {
          walker = { ...e.walker, alpha: 1, scale: 1.1 };
        }
        return {
          doors: rs.openDoors, blocks: rs.blocks, sunk: rs.sunk, usedExits: rs.usedExits,
          lit: e.swirl ? new Set() : rs.lit,
          waiting: this.p.starts.map((_, g) => g).filter(g => !e.started.has(g)).map(g => ({ ghost: g, alpha: 0.55 })),
          walker, trail: [], flickers: this.flickers, pulse: e.pulse, swirl: e.swirl,
        };
      }
      const choosing = s.active === null && !this.leaving && !s.isFinished;
      let walker = null;
      if (this.leaving) {
        const k = Math.max(0, (now - this.leaving.at) / 300);
        walker = { ghost: this.leaving.ghost, x: R.cx(this.leaving.cell), y: R.cy(this.leaving.cell), alpha: Math.max(0, 1 - k), halo: true };
        if (this.move && now - this.move.at < GLIDE) walker = { ...walker, ...this.tween(now) };
      } else if (s.active !== null) {
        walker = { ghost: s.active, x: R.cx(s.position), y: R.cy(s.position), alpha: 1, halo: true };
        if (this.move && this.move.to === s.position && now - this.move.at < GLIDE) walker = { ...walker, ...this.tween(now) };
      }
      return {
        doors: s.openDoors, blocks: s.blocks, sunk: s.sunk, usedExits: s.usedExits, lit: null,
        waiting: s.waiting.map(g => ({ ghost: g, alpha: choosing ? 1 : 0.3, beckon: choosing })),
        walker, trail: s.active !== null ? s.trail : [], trailGhost: s.active,
        forgotten: s.active !== null ? this.forgot : null,
        flickers: this.flickers,
      };
    }

    tween(now) {
      const m = this.move, k = m.jump ? 1 : Math.min(1, (now - m.at) / GLIDE);
      const e = k * (2 - k);
      return { x: R.cx(m.from) + (R.cx(m.to) - R.cx(m.from)) * e, y: R.cy(m.from) + (R.cy(m.to) - R.cy(m.from)) * e };
    }
  }

  // Walks a stored solution's moves for one ghost the way a player taps: one tap per straight
  // stretch, single steps where a stretch can't be walked at once (a portal or a block on the
  // way). Resolves false when cancelled.
  async function tapMoves(runner, moves) {
    const DIR = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
    let i = 0;
    while (i < moves.length) {
      let j = i + 1;
      while (j < moves.length && moves[j] === moves[i]) j++;
      const [dx, dy] = DIR[moves[i]], at = runner.s.position;
      if (at === null || at === undefined) return true;
      const x = R.cx(at) + dx * (j - i), y = R.cy(at) + dy * (j - i);
      let path = x >= 0 && x < R.W && y >= 0 && y < R.H ? runner.s.straightPath(R.cell(x, y)) : null;
      if (path && path.length === j - i) {
        i = j;
      } else {
        path = runner.s.straightPath(R.cell(R.cx(at) + dx, R.cy(at) + dy));
        if (!path) return true;
        i++;
      }
      if (!(await runner.walk(path))) return false;
    }
    return true;
  }

  root.Runner = Runner;
  root.tapMoves = tapMoves;
})(this);
