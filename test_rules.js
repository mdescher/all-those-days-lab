// Checks rules.js against the rooms: every stored solution of the game repo's
// YesterlightLab/LabLevels.json (and of the guide's rooms in guide.json) must solve its room in
// exactly `best` steps, walked once step by step and once with one tap per straight stretch,
// and the map hash must match the one Tools/make_web_lab.py wrote into levels.json. The game
// repo (private; it holds the solutions) is expected next to this one, or at $GAME_REPO.
//
//     node test_rules.js
const fs = require("fs");
const path = require("path");
const R = require("./rules.js");

const game = process.env.GAME_REPO || path.join(__dirname, "..", "all-those-days");
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
const lab = read(path.join(game, "YesterlightLab", "LabLevels.json")).levels;
const guide = read(path.join(__dirname, "guide.json")).levels;
const web = read(path.join(__dirname, "levels.json"));
const DIR = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };

// Replays a solution; `stretches` taps the end of each run of equal moves at once.
// `demo` replaces the solution (the guide's wrong demos), which then only has to be walkable.
function play(level, stretches, demo) {
  const p = R.parse(level);
  if (!p) return "malformed";
  const s = new R.Session(p);
  for (const { ghost, moves } of demo || level.solution) {
    if (s.active !== ghost && !s.choose(ghost)) return `ghost ${ghost + 1} can't be chosen`;
    let i = 0;
    while (i < moves.length) {
      let j = i + 1;
      if (stretches) while (j < moves.length && moves[j] === moves[i]) j++;
      const [dx, dy] = DIR[moves[i]];
      let x = R.cx(s.position), y = R.cy(s.position);
      const cells = [];
      for (let k = i; k < j; k++) { x += dx; y += dy; cells.push(R.cell(x, y)); }
      // A block in the way stops a stretch: walk it in single taps from there.
      const path = stretches ? s.straightPath(cells[cells.length - 1]) : null;
      const steps = path && path.length === cells.length ? path : null;
      if (steps) {
        for (const c of steps) if (s.step(c) === null) return `ghost ${ghost + 1} stuck at move ${i}`;
        i = j;
      } else {
        const one = s.straightPath(cells[0]);
        if (!one || one.length !== 1 || s.step(one[0]) === null) return `ghost ${ghost + 1} can't make move ${i} (${moves[i]})`;
        i++;
      }
    }
    if (demo) continue;
    if (s.active === ghost) return `ghost ${ghost + 1} is not out`;
    s.chooseTheLastOne();
  }
  if (demo) return s.isSolved ? "the wrong demo solves" : null;
  if (!s.isSolved) return `not solved (${s.lit.size}/${p.lights.length} lights, ${s.out.size} out)`;
  if (s.steps !== level.best) return `${s.steps} steps, best ${level.best}`;
  return null;
}

let failures = 0;
const rooms = lab.map(l => ["lab", l]).concat(guide.map(l => ["guide", l]));
for (const [set, level] of rooms) {
  for (const stretches of [false, true]) {
    const error = level.solution ? play(level, stretches) : "no solution";
    if (error) { failures++; console.log(`${set} ${level.id} (${stretches ? "stretches" : "steps"}): ${error}`); }
    const wrong = level.wrong && play(level, stretches, level.wrong);
    if (wrong) { failures++; console.log(`${set} ${level.id} wrong demo: ${wrong}`); }
  }
}
{
  const byID = new Map(web.levels.map(l => [l.id, l]));
  for (const level of lab) {
    const w = byID.get(level.id), p = R.parse(level);
    if (!w) { failures++; console.log(`levels.json lacks ${level.id}`); continue; }
    if (w.hash !== p.mapHash) { failures++; console.log(`${level.id}: hash ${p.mapHash} vs ${w.hash}`); }
  }
  if (web.levels.length !== lab.length) { failures++; console.log(`levels.json has ${web.levels.length} rooms, LabLevels.json ${lab.length}`); }
}
console.log(failures ? `${failures} failures` : `ok: ${lab.length} Lab rooms and ${guide.length} guide rooms solve in best steps`);
process.exit(failures ? 1 : 0);
