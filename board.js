// Draws a room on a canvas, after Yesterlight/Puzzle/BoardView.swift: walls, tiles, blocks,
// trail, ghosts, the flicker of a light, and during the ending the lights themselves, their
// pulse and the swirl. It keeps no game state: `draw` gets a view of what to show.
(function (root) {
  const R = root.Rules;
  const GHOST = ["#bf9eff", "#80edd1", "#ffb38c", "#ff99d1"];
  const MECH = { A: "#73ebdb", B: "#ff85d1", C: "#ffa84d", D: "#99f273" };
  const PORTAL = { q: "#66b3ff", r: "#ff8c73", s: "#b3ff80", t: "#ffd966" };
  const GOLD = "#ffd27a", LAVENDER = "#b9a6ff";

  const rgba = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  };

  class Board {
    // `crop`: show only the rows and columns with floor in them (the guide).
    constructor(canvas, puzzle, crop) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.p = puzzle;
      let x0 = 0, x1 = R.W - 1, y0 = 0, y1 = R.H - 1;
      if (crop) {
        x0 = R.W; x1 = -1; y0 = R.H; y1 = -1;
        for (let c = 0; c < R.W * R.H; c++) {
          if (puzzle.tiles[c].kind === "wall") continue;
          x0 = Math.min(x0, R.cx(c)); x1 = Math.max(x1, R.cx(c));
          y0 = Math.min(y0, R.cy(c)); y1 = Math.max(y1, R.cy(c));
        }
      }
      this.box = { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    }

    get aspect() { return this.box.w / this.box.h; }

    // Fits the canvas into its CSS box; returns the tile size in CSS pixels.
    resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(rect.width * dpr)), h = Math.max(1, Math.round(rect.height * dpr));
      if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
      this.dpr = dpr;
      this.size = Math.min(rect.width / this.box.w, rect.height / this.box.h);
      this.ox = (rect.width - this.size * this.box.w) / 2;
      this.oy = (rect.height - this.size * this.box.h) / 2;
      return this.size;
    }

    // The cell under a point in CSS pixels relative to the canvas, or null.
    cellAt(px, py) {
      const x = Math.floor((px - this.ox) / this.size) + this.box.x0;
      const y = Math.floor((py - this.oy) / this.size) + this.box.y0;
      return x < 0 || x >= R.W || y < 0 || y >= R.H ? null : R.cell(x, y);
    }

    // Centre of a cell, or of a point in cell units, in CSS pixels.
    px(x) { return this.ox + (x - this.box.x0 + 0.5) * this.size; }
    py(y) { return this.oy + (y - this.box.y0 + 0.5) * this.size; }

    // view: doors, blocks, sunk, usedExits, lit (null while hidden), waiting [{ghost, alpha,
    // beckon}], walker {ghost, x, y, alpha, halo}, trail, trailGhost, forgotten {cells, at},
    // flickers [{cell, on, at}], pulse {at}, swirl {at, duration}, endingLights (bool).
    draw(view, now) {
      const ctx = this.ctx, s = this.size, p = this.p;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.drawFloor();
      for (let c = 0; c < R.W * R.H; c++) {
        const x = R.cx(c), y = R.cy(c);
        if (x < this.box.x0 || x >= this.box.x0 + this.box.w || y < this.box.y0 || y >= this.box.y0 + this.box.h) continue;
        this.drawTile(c, view, now);
      }
      this.drawTrail(view, now);
      this.drawBlocks(view);
      for (const f of view.flickers || []) this.drawFlicker(f, now);
      if (view.pulse && !view.swirl && view.lit) {
        const t = (now - view.pulse.at) / 550;
        if (t < 1) for (const c of view.lit) this.glow(this.px(R.cx(c)), this.py(R.cy(c)), s * 1.3 * (0.6 + t * 0.5), GOLD, 0.95 * (1 - t));
      }
      for (const w of view.waiting || []) this.drawGhost(R.cx(p.starts[w.ghost]), R.cy(p.starts[w.ghost]), w.ghost, w.alpha, w.beckon ? 1 : 0.8, now, w.beckon);
      if (view.walker) {
        const w = view.walker;
        if (w.halo) this.glow(this.px(w.x), this.py(w.y), s * 0.95, GHOST[w.ghost % 4], 0.35 * w.alpha);
        this.drawGhost(w.x, w.y, w.ghost, w.alpha, w.scale || 1.2, now, false);
      }
      if (view.swirl) this.drawSwirl(view.swirl, now);
    }

    rect(x, y) { return [this.ox + (x - this.box.x0) * this.size, this.oy + (y - this.box.y0) * this.size]; }

    // The room's floor as soft tiles; walls are the night around them.
    drawFloor() {
      const ctx = this.ctx, s = this.size, p = this.p;
      for (let c = 0; c < R.W * R.H; c++) {
        if (p.tiles[c].kind === "wall") continue;
        const [x, y] = this.rect(R.cx(c), R.cy(c));
        ctx.fillStyle = "rgba(196,182,255,0.12)";
        this.round(x + s * 0.03, y + s * 0.03, s * 0.94, s * 0.94, s * 0.16);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(196,182,255,0.10)";
        ctx.stroke();
      }
    }

    round(x, y, w, h, r) {
      const ctx = this.ctx;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    glow(x, y, r, color, alpha) {
      if (alpha <= 0 || r <= 0) return;
      const g = this.ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, rgba(color, alpha));
      g.addColorStop(1, rgba(color, 0));
      this.ctx.fillStyle = g;
      this.ctx.beginPath();
      this.ctx.arc(x, y, r, 0, Math.PI * 2);
      this.ctx.fill();
    }

    drawTile(c, view, now) {
      const ctx = this.ctx, s = this.size, p = this.p, t = p.tiles[c];
      const x = this.px(R.cx(c)), y = this.py(R.cy(c));
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      switch (t.kind) {
        case "light": {
          const on = view.lit ? view.lit.has(c) : null;
          if (on) this.glow(x, y, s * 0.75, GOLD, 0.6);
          ctx.beginPath();
          ctx.arc(x, y, s * 0.2, 0, Math.PI * 2);
          ctx.fillStyle = on ? "#fff2c7" : on === false ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.13)";
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = rgba(GOLD, on === false ? 0.25 : 0.6);
          ctx.stroke();
          if (t.owner !== null) {
            ctx.beginPath();
            ctx.arc(x, y, s * 0.31, 0, Math.PI * 2);
            ctx.lineWidth = s * 0.07;
            ctx.strokeStyle = rgba(GHOST[t.owner % 4], on === false ? 0.45 : 1);
            ctx.stroke();
          }
          break;
        }
        case "exit": {
          const open = !view.usedExits.has(c);
          if (!open) break;
          this.glow(x, y, s * 0.48, LAVENDER, 0.45);
          ctx.beginPath();
          ctx.arc(x, y, s * 0.3, 0, Math.PI * 2);
          ctx.lineWidth = 2;
          ctx.strokeStyle = "rgba(255,255,255,0.85)";
          ctx.stroke();
          break;
        }
        case "switch":
        case "toggle": {
          const color = MECH[t.letter], open = view.doors.has(t.letter);
          // A switch shows pressed once its door is open; a plate glows while its door is open.
          ctx.lineWidth = 2;
          ctx.strokeStyle = color;
          ctx.fillStyle = rgba(color, open ? 0.55 : 0.12);
          if (t.kind === "switch") this.round(x - s * 0.24, y - s * 0.24, s * 0.48, s * 0.48, s * 0.1);
          else { ctx.beginPath(); ctx.arc(x, y, s * 0.26, 0, Math.PI * 2); }
          ctx.fill();
          ctx.stroke();
          if (t.kind === "toggle") {
            // Two arrows round: it flips.
            ctx.lineWidth = s * 0.05;
            ctx.strokeStyle = open ? "#15121f" : color;
            ctx.beginPath(); ctx.arc(x, y, s * 0.12, -2.6, 0.2); ctx.stroke();
            ctx.beginPath(); ctx.arc(x, y, s * 0.12, 0.54, 3.34); ctx.stroke();
          }
          break;
        }
        case "door": {
          const color = MECH[t.letter], open = view.doors.has(t.letter);
          const side = s * 0.84;
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          this.round(x - side / 2, y - side / 2, side, side, side * 0.1);
          ctx.fill();
          ctx.lineWidth = open ? 1.5 : 2;
          ctx.strokeStyle = rgba(color, open ? 0.65 : 1);
          ctx.stroke();
          // The pins of the grating rise when shut, sink when open.
          if (!open) {
            const pin = side * 0.12;
            for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
              ctx.fillStyle = color;
              this.round(x + i * side * 0.27 - pin / 2, y + j * side * 0.27 - pin / 2, pin, pin, pin * 0.22);
              ctx.fill();
            }
          } else {
            ctx.lineWidth = 1;
            ctx.strokeStyle = rgba(color, 0.35);
            for (let i = -1; i <= 1; i++) {
              ctx.beginPath(); ctx.moveTo(x + i * side * 0.27, y - side * 0.4); ctx.lineTo(x + i * side * 0.27, y + side * 0.4); ctx.stroke();
            }
          }
          break;
        }
        case "oneway": {
          ctx.strokeStyle = "rgba(255,255,255,0.7)";
          ctx.lineWidth = s * 0.07;
          const a = Math.atan2(t.dy, t.dx);
          for (const k of [-0.16, 0.12]) {
            const cx = x + Math.cos(a) * k * s, cy = y + Math.sin(a) * k * s;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a + 2.4) * s * 0.17, cy + Math.sin(a + 2.4) * s * 0.17);
            ctx.lineTo(cx, cy);
            ctx.lineTo(cx + Math.cos(a - 2.4) * s * 0.17, cy + Math.sin(a - 2.4) * s * 0.17);
            ctx.stroke();
          }
          break;
        }
        case "hole": {
          const filled = view.sunk && [...view.sunk].some(i => view.blocks[i] === c);
          if (filled) {
            ctx.fillStyle = "rgba(158,133,191,0.22)";
            this.round(x - s * 0.36, y - s * 0.36, s * 0.72, s * 0.72, s * 0.08);
            ctx.fill();
            break;
          }
          ctx.fillStyle = "#000";
          ctx.beginPath();
          ctx.ellipse(x, y + s * 0.03, s * 0.36, s * 0.32, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = "rgba(217,199,255,0.6)";
          ctx.stroke();
          break;
        }
        case "forget": {
          this.glow(x, y, s * 0.42, "#bfd9ff", 0.4);
          for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(x, y, s * (0.1 + i * 0.09), 0, Math.PI * 2);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = `rgba(209,230,255,${0.75 - i * 0.2})`;
            ctx.stroke();
          }
          break;
        }
        case "portal": {
          const color = PORTAL[t.letter];
          const g = ctx.createRadialGradient(x, y, 0, x, y, s * 0.32);
          g.addColorStop(0, "#15121f");
          g.addColorStop(1, rgba(color, 0.45));
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(x, y, s * 0.32, 0, Math.PI * 2); ctx.fill();
          ctx.lineWidth = s * 0.06;
          ctx.strokeStyle = color;
          ctx.stroke();
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(now / 1400);
          ctx.setLineDash([s * 0.06, s * 0.07]);
          ctx.lineWidth = s * 0.035;
          ctx.strokeStyle = rgba(color, 0.8);
          ctx.beginPath(); ctx.arc(0, 0, s * 0.18, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
          break;
        }
      }
      // A waiting ghost's start: a faint dashed ring under it.
      if (p.starts.includes(c)) {
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.beginPath(); ctx.arc(x, y, s * 0.36, 0, Math.PI * 2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    drawBlocks(view) {
      const ctx = this.ctx, s = this.size;
      (view.blocks || []).forEach((c, i) => {
        if (view.sunk && view.sunk.has(i)) return;
        const x = this.px(R.cx(c)), y = this.py(R.cy(c));
        const g = ctx.createLinearGradient(x, y - s * 0.38, x, y + s * 0.38);
        g.addColorStop(0, "#8a7bb0");
        g.addColorStop(1, "#4c4170");
        ctx.fillStyle = g;
        this.round(x - s * 0.38, y - s * 0.38, s * 0.76, s * 0.76, s * 0.12);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(225,215,255,0.55)";
        ctx.stroke();
      });
    }

    drawTrail(view, now) {
      const ctx = this.ctx, s = this.size;
      const color = GHOST[(view.trailGhost || 0) % 4];
      const line = (cells, alpha) => {
        if (!cells || cells.length < 1) return;
        ctx.lineWidth = s * 0.08;
        ctx.strokeStyle = rgba(color, 0.35 * alpha);
        ctx.beginPath();
        cells.forEach((c, i) => {
          const x = this.px(R.cx(c)), y = this.py(R.cy(c));
          if (i === 0 || !R.isNeighbour(c, cells[i - 1])) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.fillStyle = rgba(color, 0.7 * alpha);
        for (const c of cells.slice(0, -1)) {
          ctx.beginPath(); ctx.arc(this.px(R.cx(c)), this.py(R.cy(c)), s * 0.07, 0, Math.PI * 2); ctx.fill();
        }
      };
      if (view.forgotten) {
        const t = (now - view.forgotten.at) / 900;
        if (t < 1) line(view.forgotten.cells, 1 - t);
      }
      line(view.trail, 1);
    }

    drawFlicker(f, now) {
      const t = (now - f.at) / 500;
      if (t >= 1) return;
      const x = this.px(R.cx(f.cell)), y = this.py(R.cy(f.cell));
      this.glow(x, y, this.size * (0.5 + 0.5 * t), f.on ? GOLD : "#8cb3ff", (f.on ? 0.95 : 0.7) * (1 - t));
    }

    // A ghost: a dome with a wavy hem and two eyes; `beckon` makes it bob while it waits.
    drawGhost(gx, gy, ghost, alpha, scale, now, beckon) {
      if (alpha <= 0) return;
      const ctx = this.ctx, s = this.size * 0.62 * scale;
      const x = this.px(gx), y = this.py(gy) + (beckon ? Math.sin(now / 350 + ghost) * this.size * 0.04 : 0);
      const color = GHOST[ghost % 4];
      ctx.save();
      ctx.globalAlpha = alpha;
      this.glow(x, y, s * 0.9, color, 0.35);
      ctx.beginPath();
      const top = y - s * 0.5, bottom = y + s * 0.45, r = s * 0.42;
      ctx.moveTo(x - r, bottom);
      ctx.lineTo(x - r, top + r);
      ctx.arc(x, top + r, r, Math.PI, 0);
      ctx.lineTo(x + r, bottom);
      const waves = 3, wv = (2 * r) / waves, phase = Math.sin(now / 260) * s * 0.03;
      for (let i = 0; i < waves; i++) {
        const x0 = x + r - i * wv;
        ctx.quadraticCurveTo(x0 - wv / 2, bottom - s * 0.14 + phase, x0 - wv, bottom);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.fillStyle = "#1b1630";
      for (const dx of [-0.15, 0.15]) {
        ctx.beginPath(); ctx.ellipse(x + dx * s, y - s * 0.08, s * 0.065, s * 0.09, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    // The lights leave their tiles, circle once and spin into the centre.
    drawSwirl(swirl, now) {
      const u = Math.min(1, (now - swirl.at) / swirl.duration);
      const cx = this.ox + this.box.w * this.size / 2, cy = this.oy + this.box.h * this.size / 2;
      const radius = this.box.w * this.size * 0.36;
      const lights = this.p.lights;
      lights.forEach((c, i) => {
        const sx = this.px(R.cx(c)), sy = this.py(R.cy(c));
        const angle = (i / lights.length) * Math.PI * 2 - Math.PI / 2;
        let x, y;
        if (u < 0.25) {
          const k = u / 0.25, e = k * k * (3 - 2 * k);
          x = sx + (cx + Math.cos(angle) * radius - sx) * e;
          y = sy + (cy + Math.sin(angle) * radius - sy) * e;
        } else {
          const k = (u - 0.25) / 0.75;
          const a = angle + k * k * Math.PI * 2.5, r = radius * (1 - k * k);
          x = cx + Math.cos(a) * r;
          y = cy + Math.sin(a) * r;
        }
        this.glow(x, y, this.size * 0.6, GOLD, 0.75);
        this.ctx.fillStyle = "#fff2c7";
        this.ctx.beginPath(); this.ctx.arc(x, y, this.size * 0.12, 0, Math.PI * 2); this.ctx.fill();
      });
      if (u > 0.75) this.glow(cx, cy, this.size * (1 + (u - 0.75) * 12), "#ffffff", (u - 0.75) * 3);
    }
  }

  root.Board = Board;
  root.GhostColors = GHOST;
})(this);
