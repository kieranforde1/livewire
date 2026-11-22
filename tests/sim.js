// Headless simulation test: plays every map with a simple bot and checks the
// game's invariants, save/load and speed. Needs Playwright (npm i playwright).
//   node tests/sim.js [weeks=12]
const path = require('path');
const { chromium } = require('playwright');
const WEEKS = +process.argv[2] || 12;
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await chromium.launch();
  let failed = false;
  for (let m = 0; m < 5; m++) {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('livewire-tutorial-done', '1');
      localStorage.setItem('livewire-seen-help', '1');
      localStorage.setItem('livewire-mech', '{"solar":1,"wind":1,"day":1,"trip":1}');
      localStorage.setItem('livewire-progress', JSON.stringify({ unlocked: 5, best: {} }));
    });
    await page.goto(URL);
    await page.waitForTimeout(500);
    const r = await page.evaluate(({ m, WEEKS }) => {
      const w = window.__livewire;
      w.startNew(w.MAPS[m]);
      const G = w.G, W = G.W, N = G.N;
      const tx = (i) => i % W, ty = (i) => Math.floor(i / W);
      const problems = new Set();
      const assigned = new Map();
      // Bot: wire each new generator to the same-colour town with fewest generators.
      function connect(h) {
        const towns = G.dests.filter((d) => d.color === h.color);
        if (!towns.length) return;
        const load = (d) => [...assigned.values()].filter((x) => x === d).length;
        towns.sort((a, b) => load(a) - load(b));
        const ports = new Set(towns[0].ports);
        assigned.set(h, towns[0]);
        const dist = new Float64Array(N).fill(1e9), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
        dist[h.i] = 0;
        const Q = [h.i];
        while (Q.length) {
          let bi = 0;
          for (let k = 1; k < Q.length; k++) if (dist[Q[k]] < dist[Q[bi]]) bi = k;
          const u = Q.splice(bi, 1)[0];
          if (done[u]) continue;
          done[u] = 1;
          if (ports.has(u)) break;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const x = tx(u) + dx, y = ty(u) + dy, B = G.bounds;
            if (x < B.x0 || y < B.y0 || x > B.x1 || y > B.y1) continue;
            const v = y * W + x, o = G.occ[v];
            let c;
            if (o) { if (!(o.kind === 'port' && ports.has(v))) continue; c = 1; }
            else if (G.road[v]) c = 0.25;
            else if (G.mount[v]) continue;
            else c = G.water[v] ? 4 : 1;
            if (dist[u] + c < dist[v]) { dist[v] = dist[u] + c; prev[v] = u; Q.push(v); }
          }
        }
        let t = -1;
        for (const q of ports) if (dist[q] < 1e9 && (t < 0 || dist[q] < dist[t])) t = q;
        if (t < 0) return;
        const p = [];
        for (let n = t; n !== -1; n = prev[n]) p.push(n);
        p.reverse();
        for (let k = 0; k < p.length - 1; k++) if (w.tryConnect(p[k], p[k + 1]) !== 'ok') return;
      }
      let trips = 0, prevTrips = 0, maxStep = 0;
      for (let i = 0; i < WEEKS * 700; i++) {
        G.res.roads = Math.max(G.res.roads, 200);
        G.res.bridges = Math.max(G.res.bridges, 9);
        G.res.tunnels = Math.max(G.res.tunnels, 9);
        const t0 = performance.now();
        w.step(0.1);
        maxStep = Math.max(maxStep, performance.now() - t0);
        for (const d of G.dests) d.overflow = Math.min(d.overflow, 0.5); // keep playing
        if (G.trips.length > prevTrips) trips += G.trips.length - prevTrips;
        prevTrips = G.trips.length;
        const choice = document.querySelector('#sUpgrade.show .choice');
        if (choice) choice.click();
        if (i % 20 === 10) for (const h of G.houses) if (G.adj[h.i].size === 0) connect(h);
        if (i % 350 === 0) {
          for (const h of G.houses) {
            if (G.adj[h.i].size > 1) problems.add('generator with more than one cable');
            if (!G.occ[h.i] || G.occ[h.i].h !== h) problems.add('tile and generator out of sync');
          }
          for (const c of G.cars) if (!G.houses.includes(c.house)) problems.add('pulse without a generator');
          for (const d of G.dests) if (!(d.pins >= 0)) problems.add('bad demand count');
          for (const k in G.res) if (!(G.res[k] >= 0)) problems.add('negative ' + k);
        }
      }
      const t1 = performance.now();
      for (let k = 0; k < 20; k++) w.render();
      const renderMs = (performance.now() - t1) / 20;
      const snap = () => JSON.stringify([w.G.houses.length, w.G.edges.size + (w.G.trips || []).length,
        w.G.houses.filter((h) => h.battery).length, w.G.houses.map((h) => h.type).sort().join(), w.G.score]);
      const before = snap();
      w.save();
      w.G.trips.length = 0;
      const loaded = w.load();
      if (!loaded || snap() !== before) problems.add('save and load differ');
      for (let i = 0; i < 200; i++) w.step(0.1);
      return { map: G.map.name, week: G.week, trips, maxStep, renderMs, problems: [...problems] };
    }, { m, WEEKS });
    const ok = !errors.length && !r.problems.length && r.maxStep < 50;
    if (!ok) failed = true;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.map.padEnd(9)} week ${r.week}, ${r.trips} trips, ` +
      `step ${r.maxStep.toFixed(1)}ms, frame ${r.renderMs.toFixed(1)}ms` +
      (r.problems.length ? `, problems: ${r.problems.join('; ')}` : '') + (errors.length ? `, errors: ${errors.join('; ')}` : ''));
    await page.close();
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
