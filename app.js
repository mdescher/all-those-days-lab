// The web Lab: the rooms of LabLevels.json (as levels.json), the clock of
// YesterlightLab/LabStore.swift, the guide's demos, and the export of the results.
(function () {
  const R = window.Rules;
  const $ = id => document.getElementById(id);
  const KEY = "all-those-days-lab.v1";
  // The clock stops this long after the last tap, as LabStore.idleLimit.
  const IDLE = 180;
  // Which guide lessons belong to which chapter's mechanics.
  const LESSONS = { 1: ["light", "twice", "door"], 2: ["plate"], 3: ["colour"], 4: ["oneway", "teleport"], 5: ["block", "hole"], 6: ["forget"], 7: [] };

  let data = null, guide = null;
  const rooms = new Map(), lessons = new Map();

  // MARK: Storage: per room id {mapHash, seconds, attempts, solvedAt, firstSteps, bestSteps,
  // interesting, rating}, as LabStore.Record; plus the tester's name. `rating` is 1 to 5 stars
  // or null while unrated (since 2026-11-13); `interesting` is the former mark, kept but no
  // longer shown.

  let store = { name: "", guideSeen: false, records: {} };
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) store = Object.assign(store, JSON.parse(raw));
    } catch (e) { /* storage blocked: the page works, nothing is kept */ }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* see load */ }
  }
  // Asks the browser not to clear the store under storage pressure; it may say no.
  function askToPersist() {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
  function record(room) {
    const r = store.records[room.id];
    return r && r.mapHash === room.hash ? r : null;
  }
  function ensure(room) {
    if (!record(room)) store.records[room.id] = { mapHash: room.hash, seconds: 0, attempts: 0, solvedAt: null, firstSteps: null, bestSteps: null, interesting: false, rating: null };
    return store.records[room.id];
  }
  // A record may exist for the stars alone; the room counts as played once time ran.
  const played = r => !!(r && (r.seconds > 0 || r.attempts > 0 || r.solvedAt));
  const isRating = v => Number.isInteger(v) && v >= 1 && v <= 5;

  // MARK: Stars: 1 to 5, any room, solved or not; the star already set clears the rating.

  function starsPicker(room) {
    const r = record(room), rating = r && isRating(r.rating) ? r.rating : 0;
    let html = `<div class="stars" role="group" aria-label="Bewertung">`;
    for (let n = 1; n <= 5; n++) {
      html += `<button type="button" data-n="${n}" aria-pressed="${n <= rating}" aria-label="${n} von 5 Sternen">${n <= rating ? "★" : "☆"}</button>`;
    }
    html += `</div><p class="small muted stars-hint">${rating ? "Tipp denselben Stern noch einmal, um die Bewertung zu löschen." : "Wie findest du den Raum? Schwierigkeit und Spaß zusammen."}</p>`;
    return html;
  }
  // Wires the picker inside `el`; `changed` runs after every change.
  function wireStars(el, room, changed) {
    for (const b of el.querySelectorAll(".stars button")) {
      b.onclick = () => {
        const r = ensure(room), n = Number(b.dataset.n);
        r.rating = r.rating === n ? null : n;
        save();
        const wrap = b.closest(".stars-wrap");
        wrap.innerHTML = starsPicker(room);
        wireStars(wrap, room, changed);
        if (changed) changed();
      };
    }
  }
  function starsShown(r) {
    const rating = r && isRating(r.rating) ? r.rating : 0;
    return "★".repeat(rating) + "☆".repeat(5 - rating);
  }

  // MARK: The clock of the room on screen

  const clock = { id: null, segmentStart: null, lastInput: 0, lastSave: 0 };
  const nowS = () => Date.now() / 1000;

  function flush(now) {
    if (!clock.id || clock.segmentStart === null) return;
    const end = Math.min(now, clock.lastInput + IDLE);
    if (end > clock.segmentStart) store.records[clock.id].seconds += end - clock.segmentStart;
    clock.segmentStart = now > clock.lastInput + IDLE ? null : now;
  }
  function elapsed(room) {
    const r = record(room);
    let seconds = r ? r.seconds : 0;
    if (clock.id === room.id && clock.segmentStart !== null) {
      seconds += Math.max(0, Math.min(nowS(), clock.lastInput + IDLE) - clock.segmentStart);
    }
    return seconds;
  }
  function clockOpen(room) {
    const r = ensure(room);
    clock.id = room.id;
    clock.lastInput = nowS();
    clock.segmentStart = r.solvedAt ? null : nowS();
    save();
  }
  function clockInput() {
    const now = nowS();
    flush(now);
    clock.lastInput = now;
    if (clock.segmentStart === null && clock.id && !store.records[clock.id].solvedAt) clock.segmentStart = now;
  }
  function clockClose() {
    flush(nowS());
    clock.segmentStart = null;
    clock.id = null;
    save();
  }
  function clockPause() {
    flush(nowS());
    clock.segmentStart = null;
    save();
  }
  function clockResume() {
    if (!clock.id || store.records[clock.id].solvedAt) return;
    clock.lastInput = nowS();
    clock.segmentStart = nowS();
  }
  setInterval(() => {
    if (!clock.id) return;
    flush(nowS());
    if (nowS() - clock.lastSave > 5) { save(); clock.lastSave = nowS(); }
    if (player && player.room) showClock();
  }, 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") clockPause(); else clockResume();
  });
  window.addEventListener("pagehide", clockPause);

  function ended(room, solved, steps) {
    const r = ensure(room);
    r.attempts++;
    if (solved) {
      if (!r.solvedAt) {
        flush(nowS());
        clock.segmentStart = null;
        r.solvedAt = new Date().toISOString();
        r.firstSteps = steps;
      }
      r.bestSteps = Math.min(r.bestSteps ?? steps, steps);
    }
    save();
  }

  // MARK: Formatting

  function time(seconds) {
    const t = Math.floor(seconds), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
    const pad = n => String(n).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }
  const plural = (n, one, other) => `${n} ${n === 1 ? one : other}`;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function moonsSVG(count) {
    let out = "";
    for (let i = 0; i < 3; i++) {
      const on = i < count;
      out += `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13.5 2.5a8 8 0 1 0 4 12.6A7 7 0 0 1 13.5 2.5z" fill="${on ? "var(--gold)" : "none"}" stroke="${on ? "var(--gold)" : "var(--muted)"}" stroke-width="1.5" opacity="${on ? 1 : 0.5}"/></svg>`;
    }
    return `<span class="moons" aria-label="${count} von 3 Monden">${out}</span>`;
  }

  // MARK: Drawing loop: the play screen and the guide demos on screen

  const boards = new Set();
  function frame(now) {
    for (const b of boards) b.paint(now);
    requestAnimationFrame(frame);
  }

  // MARK: Play screen

  let player = null;

  class Player {
    // `room`: a Lab room (timed and recorded) or a guide lesson (neither).
    constructor(room, lesson) {
      this.room = lesson ? null : room;
      this.lesson = lesson;
      this.puzzle = R.parse(room);
      this.canvas = $("room-canvas");
      this.board = new window.Board(this.canvas, this.puzzle, !!lesson);
      this.runner = new window.Runner(this.puzzle, { onFlash: () => this.flash() });
      this.onPointer = e => this.pointer(e);
      this.canvas.addEventListener("pointerdown", this.onPointer);
      this.board.resize();
      boards.add(this);
      if (this.room) clockOpen(this.room);
      $("room-card").hidden = true;
      $("room-flash").classList.remove("on");
      this.status();
      showClock();
    }

    close() {
      this.runner.cancel();
      this.canvas.removeEventListener("pointerdown", this.onPointer);
      boards.delete(this);
      if (this.room) clockClose();
    }

    paint(now) {
      this.board.resize();
      this.board.draw(this.runner.view(now), now);
    }

    pointer(e) {
      const rect = this.canvas.getBoundingClientRect();
      const cell = this.board.cellAt(e.clientX - rect.left, e.clientY - rect.top);
      if (this.room) clockInput();
      if (cell !== null) this.tap(cell);
    }

    async tap(cell) {
      const s = this.runner.s;
      if (s.isFinished || this.runner.busy) return;
      if (s.active === null) {
        const ghost = s.waiting.find(g => this.puzzle.starts[g] === cell);
        if (ghost !== undefined) { s.choose(ghost); this.status(); }
        return;
      }
      if (cell === s.position && s.canDeselect) { s.deselect(); this.status(); return; }
      const path = s.straightPath(cell);
      if (!path) return;
      this.status();
      const done = await this.runner.walk(path);
      this.status();
      if (done && s.isFinished) this.finish();
    }

    async finish() {
      const s = this.runner.s, solved = s.isSolved, steps = s.steps;
      const first = this.room && !(record(this.room) || {}).solvedAt;
      if (this.room) { ended(this.room, solved, steps); showClock(); }
      this.status();
      if (await this.runner.playEnding()) this.verdict(solved, steps, first && solved);
    }

    flash() {
      const f = $("room-flash");
      f.classList.add("on");
      setTimeout(() => f.classList.remove("on"), 450);
    }

    restart() {
      const s = this.runner.s;
      if (this.room && (s.steps > 0 || s.out.size > 0) && !s.isFinished) { ensure(this.room).attempts++; save(); }
      if (this.room) clockInput();
      this.runner.restart();
      $("room-card").hidden = true;
      this.status();
      showClock();
    }

    status() {
      const s = this.runner.s;
      const dots = this.puzzle.starts.map((_, g) => `<i style="background:${window.GhostColors[g % 4]};opacity:${s.out.has(g) ? 0.2 : 1}"></i>`).join("");
      let text;
      if (s.active === null && !s.isFinished && s.steps === 0) text = "Tippe einen Geist an";
      else if (s.active === null && !s.isFinished && !this.runner.busy) text = "Wer geht als Nächstes?";
      // Steps only: moons going from 3 to 2 would give the best step count away, which is
      // never shown (2026-11-13); the moons come after the solve.
      else text = `<span class="num">${plural(s.steps, "Schritt", "Schritte")}</span>`;
      $("room-status").innerHTML = `<span class="ghosts" aria-label="${plural(this.puzzle.starts.length - s.out.size, "Geist", "Geister")} übrig">${dots}</span> ${text}`;
    }

    verdict(solved, steps, firstSolve) {
      const card = $("room-card");
      const moons = this.puzzle.best ? R.moons(this.puzzle, steps) : 0;
      let html;
      if (solved) {
        html = `<span class="eyebrow">Gelöst</span>${moonsSVG(moons)}<p class="num">${plural(steps, "Schritt", "Schritte")}</p>`;
        if (this.room) {
          const r = record(this.room);
          html += `<div class="time num">${time(r.seconds)}</div><p class="small muted">${firstSolve ? "bis zur ersten Lösung" : "Zeit bis zur ersten Lösung"} · ${plural(r.attempts, "Versuch", "Versuche")}</p>`;
          html += `<div class="stars-wrap" id="card-stars">${starsPicker(this.room)}</div>`;
        }
      } else {
        html = `<span class="eyebrow">Noch nicht</span><h2>Nicht alle Lichter brennen</h2><p class="small muted">Die Uhr läuft weiter, bis du den Raum löst.</p>`;
      }
      const next = this.room ? nextRoom(this.room) : null;
      html += `<div class="row"><button type="button" id="card-again">${solved ? "Nochmal" : "Neu beginnen"}</button>`;
      if (next && solved) html += `<a class="button quiet" href="#room-${next.chapter}-${next.number}">Nächster Raum</a>`;
      html += `</div>`;
      card.innerHTML = html;
      card.hidden = false;
      $("card-again").onclick = () => this.restart();
      const stars = $("card-stars");
      if (stars) wireStars(stars, this.room);
    }
  }

  function showClock() {
    const el = $("room-clock");
    if (!player || !player.room) { el.hidden = true; return; }
    const r = record(player.room);
    el.hidden = false;
    el.textContent = `${time(elapsed(player.room))} · ${r ? r.attempts : 0}`;
    el.classList.toggle("done", !!(r && r.solvedAt));
    el.title = "Zeit bis zur ersten Lösung · Versuche";
  }

  function nextRoom(room) {
    const list = data.levels.filter(l => l.chapter === room.chapter);
    const after = list.slice(list.indexOf(room) + 1).concat(list.slice(0, list.indexOf(room)));
    return after.find(l => !(record(l) || {}).solvedAt) || null;
  }

  $("room-restart").addEventListener("click", () => player && player.restart());

  // MARK: Guide demos: the wrong way first (where there is one), then the solution, each
  // with its ending, over and over while on screen.

  class Demo {
    constructor(lesson, el) {
      this.lesson = lesson;
      this.puzzle = R.parse(lesson);
      this.canvas = el.querySelector("canvas");
      this.caption = el.querySelector(".caption");
      this.board = new window.Board(this.canvas, this.puzzle, true);
      this.canvas.style.aspectRatio = `${this.board.box.w} / ${this.board.box.h}`;
      this.runner = new window.Runner(this.puzzle, {});
      this.running = false;
    }

    paint(now) {
      this.board.resize();
      this.board.draw(this.runner.view(now), now);
    }

    say(text, kind) {
      this.caption.textContent = text;
      this.caption.className = "caption" + (kind ? " " + kind : "");
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.gen = (this.gen || 0) + 1;
      boards.add(this);
      this.loop(this.gen);
    }

    stop() {
      this.running = false;
      this.gen = (this.gen || 0) + 1;
      boards.delete(this);
      this.runner.restart();
    }

    // Plays one attempt; false once the demo was stopped (or stopped and started again).
    async attempt(moves, wrong, gen) {
      const r = this.runner, pause = ms => new Promise(res => setTimeout(res, ms));
      const live = () => this.running && this.gen === gen;
      r.restart();
      this.say(wrong ? "Ein Versuch …" : "So geht’s", wrong ? "" : "good");
      await pause(900);
      if (!live()) return false;
      for (const { ghost, moves: m } of moves) {
        if (!live()) return false;
        if (r.s.active !== ghost) r.s.choose(ghost);
        await pause(450);
        if (!(await window.tapMoves(r, m))) return false;
        await pause(300);
        if (r.s.active === ghost) {
          this.say("Steckt fest", "bad");
          await pause(2000);
          return live();
        }
      }
      if (!live()) return false;
      if (!(await r.playEnding())) return false;
      this.say(r.s.isSolved ? "Alle Lichter brennen" : "Dunkel geblieben", r.s.isSolved ? "good" : "bad");
      await pause(2200);
      return live();
    }

    async loop(gen) {
      while (this.running && this.gen === gen) {
        if (this.lesson.wrong && !(await this.attempt(this.lesson.wrong, true, gen))) break;
        if (!(await this.attempt(this.lesson.solution, false, gen))) break;
      }
    }
  }

  let demos = [];
  const watcher = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
    for (const e of entries) {
      const demo = demos.find(d => d.el === e.target);
      if (demo) { if (e.isIntersecting) demo.demo.start(); else demo.demo.stop(); }
    }
  }, { threshold: 0.3 }) : null;

  function renderGuide() {
    const list = $("guide-list");
    if (!list.childElementCount) {
      list.innerHTML = guide.levels.map(l => `
        <article class="lesson" id="lesson-${l.id}">
          <h2>${esc(l.title)}</h2>
          <div class="demo"><canvas aria-label="Vorführung: ${esc(l.title)}"></canvas><span class="caption"></span></div>
          <p>${esc(l.text)}</p>
          <div class="row"><a class="button quiet" href="#try-${l.id}">Selbst probieren</a></div>
        </article>`).join("");
      demos = guide.levels.map(l => {
        const el = $(`lesson-${l.id}`);
        return { el, demo: new Demo(l, el.querySelector(".demo")) };
      });
    }
    for (const d of demos) {
      if (watcher) watcher.observe(d.el); else d.demo.start();
    }
    store.guideSeen = true;
    save();
  }
  function stopGuide() {
    for (const d of demos) { if (watcher) watcher.unobserve(d.el); d.demo.stop(); }
  }

  // MARK: Lists

  function renderHome() {
    $("tester-name").value = store.name || "";
    $("guide-note").hidden = !!store.guideSeen;
    $("guide-link").hidden = !store.guideSeen;
    $("chapter-list").innerHTML = data.chapters.map(c => {
      const list = data.levels.filter(l => l.chapter === c.number);
      const solved = list.filter(l => (record(l) || {}).solvedAt).length;
      return `<li><a class="item" href="#chapter-${c.number}">
        <span class="chapter-no">${c.number}</span>
        <span class="main"><span class="title">${esc(c.title)}</span><span class="sub">${esc(c.mechanics)}</span>
          <span class="bar"><i style="width:${list.length ? solved / list.length * 100 : 0}%"></i></span></span>
        <span class="side num"><span class="big">${solved}/${list.length}</span><span class="muted">gelöst</span></span>
      </a></li>`;
    }).join("");
  }

  function renderChapter(n) {
    const c = data.chapters.find(c => c.number === n);
    if (!c) return false;
    $("chapter-eyebrow").textContent = `Kapitel ${c.number}`;
    $("chapter-title").textContent = c.title;
    $("chapter-mechanics").textContent = `${c.mechanics}. Die Räume nutzen außerdem alles aus den Kapiteln davor.`;
    const own = LESSONS[n] || [];
    $("chapter-guide").innerHTML = own.length ? "Regeln: " + own.map(id => {
      const l = guide.levels.find(l => l.id === id);
      return `<a href="#guide-${id}">${esc(l.title)}</a>`;
    }).join(" · ") : `<a href="#guide">Alle Regeln in der Anleitung</a>`;
    const list = data.levels.filter(l => l.chapter === n);
    $("room-list").innerHTML = list.map(l => {
      const r = record(l), p = R.parse(l);
      let side = `<span class="big muted">–</span>`;
      if (played(r)) {
        const tries = plural(r.attempts, "Versuch", "Versuche");
        side = `<span class="big">${time(r.seconds)}</span><span class="muted">${r.solvedAt ? `${tries} · ${plural(r.firstSteps, "Schritt", "Schritte")} ${Number.isInteger(r.bestSteps) ? moonsSVG(R.moons(p, r.bestSteps)) : ""}` : `offen · ${tries}`}</span>`;
      }
      return `<li class="room ${r && r.solvedAt ? "solved" : ""}">
        <a class="item" href="#room-${l.chapter}-${l.number}">
          <span class="main"><span class="room-id">${l.id}</span><span class="sub">${plural(p.starts.length, "Geist", "Geister")} · ${plural(p.lights.length, "Licht", "Lichter")}</span>${l.built ? `<span class="sub built">${builtText(l.built)}</span>` : ""}</span>
          <span class="side num">${side}</span>
        </a>
        <button type="button" class="star${r && isRating(r.rating) ? " rated" : ""}" data-id="${l.id}" aria-label="${r && isRating(r.rating) ? `${r.rating} von 5 Sternen, ändern` : "Bewerten"}">${starsShown(r)}</button>
      </li>`;
    }).join("");
    for (const b of $("room-list").querySelectorAll(".star")) {
      b.onclick = () => openRating(rooms.get(b.dataset.id), () => {
        const r = record(rooms.get(b.dataset.id));
        b.textContent = starsShown(r);
        b.classList.toggle("rated", !!(r && isRating(r.rating)));
        b.setAttribute("aria-label", r && isRating(r.rating) ? `${r.rating} von 5 Sternen, ändern` : "Bewerten");
      });
    }
    return true;
  }

  // When a room was built ("YYYY-MM-DD" in levels.json), in the page's language; rooms without
  // a known date show none.
  function builtText(day) {
    const date = new Date(day + "T12:00:00Z");
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(document.documentElement.lang || undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  // The stars of a room, set from the list.
  function openRating(room, changed) {
    const dialog = $("rate-dialog"), r = record(room);
    $("rate-title").textContent = `Raum ${room.id} bewerten`;
    $("rate-status").textContent = !played(r) ? "noch nicht gespielt"
      : r.solvedAt ? `gelöst in ${time(r.seconds)}` : `offen nach ${time(r.seconds)}`;
    const wrap = $("rate-stars");
    wrap.innerHTML = starsPicker(room);
    wireStars(wrap, room, changed);
    if (dialog.showModal) dialog.showModal(); else dialog.setAttribute("open", "");
  }
  $("rate-done").addEventListener("click", () => {
    const dialog = $("rate-dialog");
    if (dialog.close) dialog.close(); else dialog.removeAttribute("open");
  });

  // MARK: Results

  function exportText() {
    const records = {};
    for (const [id, r] of Object.entries(store.records)) {
      const room = rooms.get(id);
      if (!room || r.mapHash !== room.hash || (!r.attempts && !r.seconds && !r.interesting && !isRating(r.rating))) continue;
      records[id] = { ...r, seconds: Math.round(r.seconds * 10) / 10 };
    }
    return JSON.stringify({
      lab: "all-those-days-web", version: 1, tester: store.name || "", set: data.set,
      exportedAt: new Date().toISOString(),
      device: { userAgent: navigator.userAgent, screen: `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}`, language: navigator.language },
      records,
    }, null, 1);
  }

  function renderResults() {
    $("results-name").value = store.name || "";
    const rs = Object.entries(store.records).filter(([id, r]) => rooms.has(id) && r.mapHash === rooms.get(id).hash);
    const solved = rs.filter(([, r]) => r.solvedAt);
    const seconds = rs.reduce((t, [, r]) => t + r.seconds, 0);
    $("result-stats").innerHTML = `
      <div><b class="num">${solved.length}</b><span>gelöst</span></div>
      <div><b class="num">${rs.length - solved.length}</b><span>offen</span></div>
      <div><b class="num">${time(seconds)}</b><span>Spielzeit</span></div>`;
    $("results-text").value = exportText();
    $("copy-state").textContent = store.name ? "" : "Trag bitte erst deinen Namen ein.";
  }

  for (const id of ["tester-name", "results-name"]) {
    $(id).addEventListener("input", e => {
      store.name = e.target.value.trim();
      save();
      if (id === "results-name") renderResults();
    });
  }

  $("copy-results").addEventListener("click", () => {
    const text = exportText();
    $("results-text").value = text;
    const fallback = () => {
      $("results-text").focus();
      $("results-text").select();
      $("copy-state").textContent = "Text ist markiert: kopiere ihn von Hand.";
    };
    if (!store.name) { $("copy-state").textContent = "Trag bitte erst deinen Namen ein."; $("results-name").focus(); return; }
    if (!navigator.clipboard) { fallback(); return; }
    navigator.clipboard.writeText(text).then(() => { $("copy-state").textContent = "Kopiert. Jetzt in eine Nachricht einfügen."; }, fallback);
  });

  // MARK: Restore: merges an exported text back in, also one of the former claude.ai page.

  const isCount = v => typeof v === "number" && Number.isFinite(v) && v >= 0;
  function cleanRecord(room, r) {
    if (!r || typeof r !== "object" || r.mapHash !== room.hash || !isCount(r.seconds) || !isCount(r.attempts)) return null;
    const solved = typeof r.solvedAt === "string" && !Number.isNaN(Date.parse(r.solvedAt));
    return {
      mapHash: room.hash, seconds: r.seconds, attempts: r.attempts, solvedAt: solved ? r.solvedAt : null,
      firstSteps: solved && isCount(r.firstSteps) ? r.firstSteps : null,
      bestSteps: solved && isCount(r.bestSteps) ? r.bestSteps : null, interesting: r.interesting === true,
      rating: isRating(r.rating) ? r.rating : null,
    };
  }
  // The further of two records of a room: solved beats open, then the earlier solve, then
  // more time spent; the old star, the rating (this device's first) and the fewest steps
  // survive either way.
  function merged(a, b) {
    if (!a) return b;
    const keep = a.solvedAt && b.solvedAt ? (Date.parse(b.solvedAt) < Date.parse(a.solvedAt) ? b : a)
      : a.solvedAt ? a : b.solvedAt ? b : (b.seconds > a.seconds ? b : a);
    const steps = [a.bestSteps, b.bestSteps].filter(isCount);
    return { ...keep, bestSteps: steps.length ? Math.min(...steps) : null, interesting: a.interesting || b.interesting,
      rating: isRating(a.rating) ? a.rating : isRating(b.rating) ? b.rating : null };
  }
  function restore(text) {
    let input;
    try { input = JSON.parse(text); } catch (e) { return "Das ist kein kopierter Ergebnistext."; }
    if (!input || !["yesterlight-web", "all-those-days-web"].includes(input.lab) || !input.records || typeof input.records !== "object") return "Das ist kein kopierter Ergebnistext.";
    let count = 0;
    for (const [id, r] of Object.entries(input.records)) {
      const room = rooms.get(id), clean = room && cleanRecord(room, r);
      if (!clean) continue;
      store.records[id] = merged(record(room), clean);
      count++;
    }
    if (!store.name && typeof input.tester === "string") store.name = input.tester.trim().slice(0, 40);
    save();
    return count === 1 ? "1 Raum wiederhergestellt." : `${count} Räume wiederhergestellt.`;
  }
  $("restore").addEventListener("click", () => {
    const message = restore($("restore-text").value);
    renderResults();
    $("restore-text").value = "";
    $("restore-state").textContent = message;
  });

  $("erase").addEventListener("click", () => {
    store.records = {};
    save();
    renderResults();
    $("erase").closest("details").open = false;
  });

  // MARK: Routing: #chapter-3, #room-3-12, #guide, #guide-plate, #try-plate, #results

  function show(id) {
    for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== id;
    document.body.classList.toggle("playing", id === "view-room");
  }

  function route() {
    const hash = location.hash.slice(1);
    if (player) { player.close(); player = null; }
    stopGuide();
    let m;
    if ((m = hash.match(/^chapter-(\d+)$/)) && renderChapter(+m[1])) {
      show("view-chapter");
    } else if ((m = hash.match(/^room-(\d+)-(\d+)$/)) && rooms.has(`${m[1]}.${m[2]}`)) {
      const room = rooms.get(`${m[1]}.${m[2]}`);
      show("view-room");
      $("room-title").textContent = `Raum ${room.id}`;
      $("room-back").href = `#chapter-${room.chapter}`;
      $("room-back").textContent = "‹ Kapitel " + room.chapter;
      player = new Player(room, null);
    } else if ((m = hash.match(/^try-([a-z]+)$/)) && lessons.has(m[1])) {
      const lesson = lessons.get(m[1]);
      show("view-room");
      $("room-title").textContent = lesson.title;
      $("room-back").href = `#guide-${lesson.id}`;
      $("room-back").textContent = "‹ Anleitung";
      player = new Player(lesson, lesson);
    } else if (hash === "guide" || ((m = hash.match(/^guide-([a-z]+)$/)) && lessons.has(m[1]))) {
      show("view-guide");
      renderGuide();
      const target = m && $(`lesson-${m[1]}`);
      if (target) target.scrollIntoView(); else window.scrollTo(0, 0);
      return;
    } else if (hash === "results") {
      show("view-results");
      renderResults();
    } else {
      show("view-home");
      renderHome();
    }
    window.scrollTo(0, 0);
  }

  async function start() {
    load();
    askToPersist();
    try {
      const [levels, lessonsFile] = await Promise.all([fetch("levels.json"), fetch("guide.json")].map(p => p.then(r => r.json())));
      data = levels;
      guide = lessonsFile;
    } catch (e) {
      document.querySelector("main").innerHTML = `<section class="view"><h2>Die Räume ließen sich nicht laden</h2><p class="muted">Lade die Seite neu. Hilft das nicht, schick mir bitte eine Nachricht.</p></section>`;
      return;
    }
    for (const l of data.levels) rooms.set(l.id, l);
    for (const l of guide.levels) lessons.set(l.id, l);
    window.addEventListener("hashchange", route);
    route();
    requestAnimationFrame(frame);
  }
  start();
})();
