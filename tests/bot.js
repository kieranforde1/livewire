// A simple player for testing, with the same limits as a real one. It builds
// power stations near towns that are short, wires everything into one grid,
// re-lays busy cables and resets tripped breakers. Load it in the page, then
// call livewireRun(mapIndex, days).
(function () {
  const PRIORITY = ['20 cable', 'Battery', 'Coal plant', 'surge', 'Interconnector', 'Sea cable', 'Underground'];

  function makeBot(w, opts) {
    const o = Object.assign({ reinforce: true, resetAfter: 1.5 }, opts);
    const G = () => w.G;
    const { idx, tx, ty, cheb, rough } = w;
    const inB = (i) => { const B = G().bounds; return tx(i) >= B.x0 && tx(i) <= B.x1 && ty(i) >= B.y0 && ty(i) <= B.y1; };
    const ekey = (a, b) => (a < b ? a * 65536 + b : b * 65536 + a);

    function path(from, targets) {
      const g = G(), N = g.N;
      const dist = new Float64Array(N).fill(1e9), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
      dist[from] = 0;
      const Q = [from];
      while (Q.length) {
        let bi = 0;
        for (let k = 1; k < Q.length; k++) if (dist[Q[k]] < dist[Q[bi]]) bi = k;
        const u = Q.splice(bi, 1)[0];
        if (done[u]) continue;
        done[u] = 1;
        if (u !== from && targets.has(u)) {
          const p = [];
          for (let n = u; n !== -1; n = prev[n]) p.push(n);
          return p.reverse();
        }
        if (u !== from && g.occ[u] && !targets.has(u)) continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const x = tx(u) + dx, y = ty(u) + dy;
          if (x < 0 || y < 0 || x >= g.W || y >= g.H) continue;
          const v = idx(x, y);
          if (!inB(v)) continue;
          if (g.edges.has(ekey(u, v))) continue;
          if (dx && dy) {
            const other = g.edges.get(ekey(idx(tx(u), y), idx(x, ty(u))));
            if (other && other.kind !== 'link') continue;
          }
          let c = dx && dy ? 1.42 : 1;
          if (rough(v)) {
            const kind = g.water[v] ? 'sea' : 'under';
            if (g.res[kind] < 1) continue;
            c += 3;
          }
          if (g.occ[v] && !targets.has(v)) continue;
          if (dist[u] + c < dist[v]) { dist[v] = dist[u] + c; prev[v] = u; Q.push(v); }
        }
      }
      return null;
    }

    function wire(from, targets) {
      const p = path(from, targets);
      if (!p) return false;
      if (p.length - 1 > G().res.cable) return false;
      const st = w.newStroke();
      let ok = true;
      for (let k = 0; k < p.length - 1; k++) {
        const r = w.tryConnect(p[k], p[k + 1], st);
        if (r !== 'ok' && r !== 'max') { ok = false; break; }
      }
      w.endStroke(st);
      return ok;
    }

    const gridNodes = () => {
      const s = new Set();
      for (const e of G().edges.values()) { s.add(e.a); s.add(e.b); }
      for (const g of G().gens) s.add(g.i);
      return s;
    };

    function spotNear(type, t) {
      const g = G();
      let best = -1, bs = 1e9;
      const lo = type === 'coal' ? 3 : 2, hi = type === 'coal' ? 5 : 4;
      for (let dy = -hi; dy <= hi; dy++) for (let dx = -hi; dx <= hi; dx++) {
        const x = tx(t.i) + dx, y = ty(t.i) + dy;
        if (x < 0 || y < 0 || x >= g.W || y >= g.H) continue;
        const i = idx(x, y);
        const d = cheb(i, t.i);
        if (d < lo || d > hi || w.placeCheck(type, i) !== 'ok' || g.adj[i].size) continue;
        let near = false;
        for (const u of g.towns) if (u !== t && cheb(i, u.i) < 2) near = true;
        if (near) continue;
        let coast = false;
        for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) { const xi = x + xx, yi = y + yy; if (xi >= 0 && yi >= 0 && xi < g.W && yi < g.H && g.water[idx(xi, yi)]) coast = true; }
        const sc = d + (type === 'wind' && !coast ? 2 : 0) + Math.random() * 0.5;
        if (sc < bs) { bs = sc; best = i; }
      }
      return best;
    }

    function neediest() {
      const g = G();
      let best = null;
      for (const t of g.towns) if (!best || t.served < best.served - 0.01 || (Math.abs(t.served - best.served) < 0.01 && t.born > best.born)) best = t;
      return best;
    }

    let lastTick = -99;
    return function tick() {
      const g = G();
      if (g.time - lastTick < 1) return;
      lastTick = g.time;
      for (const t of g.trips.slice()) if (TRIP_LEFT(t) > o.resetAfter) w.restoreTrip(t);
      const nodes = gridNodes();
      for (const t of g.towns) if (g.adj[t.i].size === 0 && nodes.size) { if (wire(t.i, nodes)) return; }
      for (const type of ['coal', 'wind', 'solar', 'battery'].filter((x) => !(o.skip || []).includes(x))) {
        if (g.res[type] < 1) continue;
        const t = neediest();
        if (!t) break;
        const i = spotNear(type, t);
        if (i < 0) continue;
        if (w.placeGen(type, i) !== 'ok') continue;
        const tg = new Set([t.i]);
        if (t.grid >= 0 && g.comps[t.grid]) for (const n of g.comps[t.grid].nodes) tg.add(n);
        if (!wire(i, tg)) wire(i, gridNodes());
        return;
      }
      if (o.reinforce) {
        const hot = [...g.edges.values()].filter((e) => e.kind !== 'link' && e.load > 0.8 && e.lvl < 3).sort((a, b) => b.load - a.load);
        for (const e of hot.slice(0, 3)) { if (g.res.cable < 2) break; w.tryConnect(e.a, e.b, w.newStroke()); }
      }
      if (g.res.guard > 0) {
        const e = [...g.edges.values()].filter((x) => x.load > 1).sort((a, b) => b.load - a.load)[0];
        if (e) w.placeGuard(e.a);
      }
    };
    function TRIP_LEFT(t) { return 15 - t.left; }
  }

  function pickUpgrade(priority) {
    const btns = [...document.querySelectorAll('#sUpgrade.show .choice')];
    if (!btns.length) return false;
    for (const p of priority || PRIORITY) {
      const b = btns.find((x) => x.textContent.includes(p));
      if (b) { b.click(); return true; }
    }
    btns[0].click();
    return true;
  }

  window.livewireRun = function (m, days, opts) {
    const w = window.__livewire;
    try {
      localStorage.setItem('livewire-tutorial-v2', '1');
      localStorage.setItem('livewire-seen-help-v2', '1');
      localStorage.setItem('livewire-mech-v2', JSON.stringify({ solar: 1, wind: 1, battery: 1, trip: 1, evening: 1, link: 1, guard: 1 }));
    } catch (e) { /* storage unavailable */ }
    w.startNew(w.MAPS[m]);
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('show'));
    const bot = makeBot(w, opts);
    const G = () => w.G;
    let minRatio = 1, shortSecs = 0, maxCascade = 0, targetDay = null;
    const log = [];
    let lastHalf = -1;
    for (let i = 0; i < days * 700; i++) {
      w.step(0.1);
      const half = Math.floor((G().day - 1) * 4 + G().dayT / 17.5);
      if (half !== lastHalf) {
        lastHalf = half;
        const g = G();
        log.push(`d${g.day} ${['dawn', 'noon', 'dusk', 'night'][half % 4]}: need ${g.demand.toFixed(0)} got ${g.delivered.toFixed(0)} can ${g.supply.toFixed(0)} | towns ${g.towns.length} unwired ${g.towns.filter((t) => t.grid < 0).length} | cable ${g.res.cable} | trips ${g.trips_total} open ${g.trips.length} | grids ${g.comps.filter((c) => c.towns.length).length} | worstDark ${Math.max(0, ...g.towns.map((t) => t.dark)).toFixed(2)}`);
      }
      if (G().over) { const t = G().overTown; log.push(`OVER: town wired=${t.grid >= 0} served=${t.served.toFixed(2)}`); break; }
      if (document.querySelector('#sTarget.show')) { targetDay = targetDay || G().day; document.querySelector('#btnTgStay').click(); }
      if (G().targetHit && !targetDay) targetDay = G().day;
      pickUpgrade(opts && opts.priority);
      bot();
      if (G().demand > 0) {
        const r = G().delivered / G().demand;
        minRatio = Math.min(minRatio, r);
        if (r < 0.995) shortSecs += 0.1;
      }
      maxCascade = Math.max(maxCascade, G().longestChain);
    }
    const g = G();
    return {
      map: g.map.name, over: g.over, day: g.day, score: Math.floor(g.score), target: g.map.target, targetDay,
      towns: g.towns.length, gens: g.gens.reduce((c, x) => { c[x.type] = (c[x.type] || 0) + 1; return c; }, {}),
      trips: g.trips_total, longestCascade: maxCascade, shortSecs: Math.round(shortSecs), minRatio: +minRatio.toFixed(2),
      cableLeft: g.res.cable, edges: g.edges.size, strands: [...g.edges.values()].reduce((s, e) => s + (e.kind === 'link' ? 0 : e.lvl), 0),
      log: opts && opts.log ? log : undefined,
    };
  };
})();
