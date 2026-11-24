// Headless simulation test: plays every map with the bot in tests/bot.js, with
// the same limits a real player has, and reports how far it gets. Also checks
// the game's invariants, save/load and speed. Needs Playwright (npm i playwright).
//   node tests/sim.js [days=14] [runs=5]
const path = require('path');
const { chromium } = require('playwright');
const DAYS = +process.argv[2] || 14;
const RUNS = +process.argv[3] || 5;
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch();
  let failed = false;
  for (let m = 0; m < 5; m++) {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(URL);
    await page.addScriptTag({ path: path.resolve(__dirname, 'bot.js') });
    await page.waitForTimeout(300);
    const r = await page.evaluate(({ m, DAYS, RUNS }) => {
      const w = window.__livewire;
      const runs = [];
      for (let k = 0; k < RUNS; k++) runs.push(window.livewireRun(m, DAYS));
      const G = w.G;
      const problems = new Set();
      for (const g of G.gens) if (!G.occ[g.i] || G.occ[g.i].g !== g) problems.add('tile and power station out of sync');
      for (const t of G.towns) if (!G.occ[t.i] || G.occ[t.i].t !== t) problems.add('tile and town out of sync');
      for (const k in G.res) if (!(G.res[k] >= 0)) problems.add('negative ' + k);
      for (const e of G.edges.values()) if (e.kind !== 'link' && (e.lvl < 1 || e.lvl > 3)) problems.add('bad strand count');
      for (const c of G.comps) {
        let sum = 0;
        for (const g of c.gens) sum += g.out;
        for (const t of c.towns) sum -= t.draw;
        if (Math.abs(sum) > 0.01) problems.add('power made and used don’t match on a grid');
      }
      let maxStep = 0;
      for (let i = 0; i < 100 && !G.over; i++) { const t0 = performance.now(); w.step(0.1); maxStep = Math.max(maxStep, performance.now() - t0); }
      const t1 = performance.now();
      for (let k = 0; k < 20; k++) w.render();
      const renderMs = (performance.now() - t1) / 20;
      if (!G.over) {
        const snap = () => JSON.stringify([w.G.edges.size, w.G.trips.length, w.G.gens.length, w.G.towns.length, Object.values(w.G.res), Math.floor(w.G.score)]);
        const before = snap();
        w.save();
        if (!w.load() || snap() !== before) problems.add('save and load differ');
      }
      return { map: runs[0].map, target: runs[0].target, runs, maxStep, renderMs, problems: [...problems] };
    }, { m, DAYS, RUNS });
    const ok = !errors.length && !r.problems.length && r.maxStep < 50;
    if (!ok) failed = true;
    const hit = r.runs.filter((x) => x.targetDay).length;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.map.padEnd(9)} target ${r.target}: bot reached it ${hit}/${r.runs.length} times. ` +
      `step ${r.maxStep.toFixed(1)}ms, frame ${r.renderMs.toFixed(1)}ms` +
      (r.problems.length ? `, problems: ${r.problems.join('; ')}` : '') + (errors.length ? `, errors: ${errors.join('; ')}` : ''));
    for (const x of r.runs) {
      console.log(`       ${x.over ? `lost on day ${x.day}` : `alive on day ${x.day}`}, ${x.score} MWh${x.targetDay ? ` (target on day ${x.targetDay})` : ''}, ` +
        `${x.towns} towns, ${x.trips} trips, longest cascade ${x.longestCascade}, short of power ${x.shortSecs}s`);
    }
    await page.close();
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
