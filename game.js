'use strict';
(function () {
  // ---------------------------------------------------------------- constants
  const CACHE_PREFIX = 'livewire-';
  const OFFLINE_ASSETS = 7;

  const PAL = {
    bg: '#0b0f18',
    land: '#151c2b',
    landOut: '#0e1320',
    grid: 'rgba(120,170,255,0.06)',
    water: '#0c2d4d',
    waterEdge: '#12426b',
    tree: '#1b2438',
    mount: '#26314a',
    mountDark: '#1d2740',
    mountLight: '#33405f',
    link: '#ffd45e',
    lit: '#ffd76a',
    unlit: '#0d1220',
    hot: '#ff5a3c',
  };

  const DAY_LEN = 70;           // seconds in one day
  const MAX_SPAN = 6;           // longest sea or underground cable, in tiles
  const LINK_RANGE = 8;         // longest interconnector, in tiles
  const STRAND_CAP = 5;         // MW one strand of cable carries
  const MAX_STRANDS = 3;
  const LINK_CAP = 20;
  const HEAT_RATE = 0.57;       // at 150% load a cable trips in about 3.5 s, at 110% in about 17 s
  const COOL_RATE = 0.25;
  const TRIP_RESET = 15;        // seconds before a tripped cable comes back by itself
  const CASCADE_GAP = 0.7;      // seconds between one trip and the next, so a cascade can be followed
  const DARK_FILL = 1 / 25;     // a town with no power at all goes dark in 25 s
  const DARK_DRAIN = 1 / 20;
  const GRACE = 14;             // seconds a new town waits before its timer starts
  const SOLVE_EVERY = 0.2;
  const COAL_CLEAR = 2;         // coal plants stay more than this many tiles from a town
  const START_CABLE = 30;
  const DAILY_CABLE = 20;
  const GEN = {
    coal: { max: 8, name: 'coal plant', plural: 'coal plants' },
    solar: { max: 7, name: 'solar farm', plural: 'solar farms' },
    wind: { max: 8, name: 'wind farm', plural: 'wind farms' },
    battery: { max: 5, name: 'battery', plural: 'batteries', store: 120 },
  };
  const GEN_TYPES = ['coal', 'solar', 'wind', 'battery'];
  const SAVE_KEY = 'livewire-save-v4';
  const PROGRESS_KEY = 'livewire-progress-v2';
  const SEEN_HELP_KEY = 'livewire-seen-help-v2';
  const TUT_KEY = 'livewire-tutorial-v2';
  const MECH_KEY = 'livewire-mech-v2';

  // Maps are drawn in landscape (28 x 18) and turned on their side for portrait.
  // Each has fixed terrain, so it feels like a place; towns appear in different spots every game.
  const MAPS = [
    {
      id: 'ampton', name: 'Ampton', seed: 7193, target: 1500, demand: 1, swing: 0.3, solarDay: 3, windDay: 5,
      blurb: 'One river runs through town.',
      rivers: [{ axis: 'v', pos: 0.42 }], lakes: 1, hills: 0, sea: 1, under: 0,
    },
    {
      id: 'wattford', name: 'Wattford', seed: 4410, target: 2000, demand: 1.1, swing: 0.33, solarDay: 2, windDay: 4,
      blurb: 'Two rivers cross in the middle. You only get a few sea cables.',
      rivers: [{ axis: 'v', pos: 0.4 }, { axis: 'h', pos: 0.58 }], lakes: 0, hills: 0, sea: 2, under: 0,
    },
    {
      id: 'ohmstone', name: 'Ohmstone', seed: 2231, target: 2200, demand: 1, swing: 0.36, solarDay: 2, windDay: 3,
      blurb: 'Hills get in the way. Go round them or under them.',
      rivers: [{ axis: 'v', pos: 0.66 }], lakes: 0, hills: 6, sea: 1, under: 1,
    },
    {
      id: 'faradale', name: 'Faradale', seed: 9067, target: 2500, demand: 1.15, swing: 0.4, solarDay: 2, windDay: 3,
      blurb: 'Rivers, lakes and hills, and not much open ground.',
      rivers: [{ axis: 'v', pos: 0.32 }, { axis: 'v', pos: 0.7 }], lakes: 2, hills: 7, sea: 2, under: 1,
    },
    {
      id: 'voltmere', name: 'Voltmere', seed: 5521, target: 2500, demand: 1.2, swing: 0.45, solarDay: 1, windDay: 2,
      blurb: 'A row of islands. Wind farms by the water do well here.',
      rivers: [{ axis: 'h', pos: 0.5 }], lakes: 4, hills: 3, sea: 3, under: 1,
    },
  ];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const $ = (s) => document.querySelector(s);
  const canvas = $('#c');
  const ctx = canvas.getContext('2d');

  let G = null;
  const view = { w: 0, h: 0, dpr: 1, top: 0, bottom: 0, right: 0 };
  const cam = { x: 0, y: 0, s: 30 };
  const user = { zoom: 1, px: 0, py: 0 };
  let camSnap = true;
  let tool = 'cable';
  let modal = null;
  let linkStart = -1;
  let hoverTile = -1;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const rint = (a, b) => Math.floor(rnd(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fmt = (n) => Math.floor(n).toLocaleString('en-GB');
  const mw = (n) => (Math.round(n * 10) / 10).toLocaleString('en-GB');

  // ---------------------------------------------------------------- grid helpers
  const idx = (x, y) => y * G.W + x;
  const tx = (i) => i % G.W;
  const ty = (i) => (i / G.W) | 0;
  const inMap = (x, y) => x >= 0 && y >= 0 && x < G.W && y < G.H;
  const inB = (x, y) => x >= G.bounds.x0 && x <= G.bounds.x1 && y >= G.bounds.y0 && y <= G.bounds.y1;
  const inBi = (i) => inB(tx(i), ty(i));
  const ekey = (a, b) => (a < b ? a * 65536 + b : b * 65536 + a);
  const cheb = (a, b) => Math.max(Math.abs(tx(a) - tx(b)), Math.abs(ty(a) - ty(b)));
  const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // water and hills can't be built on without a sea or underground cable
  const rough = (i) => G.water[i] || G.mount[i];
  const terrainOf = (i) => (G.water[i] ? 'sea' : G.mount[i] ? 'under' : null);

  // ---------------------------------------------------------------- new game
  function newGame(map) {
    undoStack = [];
    pendingSnap = null;
    const portrait = window.innerHeight >= window.innerWidth;
    const W = portrait ? 18 : 28;
    const H = portrait ? 28 : 18;
    G = blankState(W, H);
    G.map = map;
    G.res.sea = map.sea;
    G.res.under = map.under;
    G.res.coal = 2;
    genTerrain(map, portrait);
    const bw = portrait ? 10 : 15;
    const bh = portrait ? 15 : 10;
    const x0 = Math.floor((W - bw) / 2);
    const y0 = Math.floor((H - bh) / 2);
    G.bounds = { x0, y0, x1: x0 + bw - 1, y1: y0 + bh - 1 };
    fitBoundsToScreen();
    spawnTown(true);
    user.zoom = 1; user.px = 0; user.py = 0;
    camSnap = true;
    tool = 'cable';
    linkStart = -1;
    graphChanged();
  }

  function blankState(W, H) {
    const N = W * H;
    return {
      W, H, N,
      map: MAPS[0],
      water: new Uint8Array(N),
      mount: new Uint8Array(N),
      deco: new Uint8Array(N),
      guard: new Uint8Array(N),
      occ: new Array(N).fill(null),
      adj: Array.from({ length: N }, () => new Map()),
      edges: new Map(),
      runs: new Map(),   // sea and underground runs, so erasing one gives the token back
      trips: [],         // cables whose breaker has tripped: { e, left }
      theta: new Float64Array(N),
      towns: [],
      gens: [],
      comps: [],
      comp: new Int32Array(N).fill(-1),
      fx: [],
      res: { cable: START_CABLE, sea: 0, under: 0, link: 0, guard: 0, coal: 0, solar: 0, wind: 0, battery: 0 },
      owned: {},
      time: 0, day: 1, dayT: 0, score: 0,
      speed: 1, paused: false, over: false, targetHit: false,
      bounds: { x0: 0, y0: 0, x1: W - 1, y1: H - 1 },
      nextTown: 22,
      solveT: 0, tripCD: 0, gver: 0, fver: -1, uver: 0,
      chain: 0, chainT: -99, trips_total: 0, longestChain: 0,
      wind: 0.6, windTarget: 0.6, windT: 15,
      supply: 0, demand: 0, delivered: 0,
      saveT: 0,
      nextId: 1,
    };
  }

  function genTerrain(map, portrait) {
    const R = mulberry32(map.seed);
    const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
    const CW = 28, CH = 18;
    const T = new Uint8Array(CW * CH); // 0 land, 1 water, 2 hill
    const at = (x, y) => (x >= 0 && y >= 0 && x < CW && y < CH ? T[y * CW + x] : -1);
    const put = (x, y, v) => { if (x >= 0 && y >= 0 && x < CW && y < CH) T[y * CW + x] = v; };

    for (const rv of map.rivers) {
      const along = rv.axis === 'v' ? CH : CW;
      const across = rv.axis === 'v' ? CW : CH;
      const home = Math.floor(across * rv.pos);
      let c = home;
      let width = 2;
      const set = (a, b) => (rv.axis === 'v' ? put(b, a, 1) : put(a, b, 1));
      for (let a = 0; a < along; a++) {
        if (a > 0 && R() < 0.35) {
          const nc = c + (R() < 0.5 ? -1 : 1);
          if (Math.abs(nc - home) <= 3) {
            for (let w = 0; w < width; w++) set(a, nc + w);
            c = nc;
          }
        }
        if (R() < 0.15) width = width === 2 ? 3 : 2;
        for (let w = 0; w < width; w++) set(a, c + w);
      }
    }
    for (let k = 0; k < map.lakes; k++) {
      for (let tries = 0; tries < 50; tries++) {
        const x = ri(2, CW - 5), y = ri(2, CH - 4);
        let clear = true;
        for (let yy = y - 1; yy <= y + 2; yy++) for (let xx = x - 1; xx <= x + 3; xx++) if (at(xx, yy) !== 0) clear = false;
        if (!clear) continue;
        for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 3; xx++) put(xx, yy, 1);
        if (R() < 0.5) put(x + 1, y + 2, 1);
        break;
      }
    }
    for (let k = 0; k < map.hills; k++) {
      for (let tries = 0; tries < 50; tries++) {
        const x = ri(1, CW - 2), y = ri(1, CH - 2);
        if (at(x, y) !== 0) continue;
        const cells = [[x, y]];
        put(x, y, 2);
        const size = ri(6, 12);
        for (let g = 0; g < 80 && cells.length < size; g++) {
          const [cx, cy] = cells[Math.floor(R() * cells.length)];
          const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(R() * 4)];
          const nx = cx + dx, ny = cy + dy;
          if (at(nx, ny) !== 0 || nx < 1 || ny < 1 || nx > CW - 2 || ny > CH - 2) continue;
          put(nx, ny, 2);
          cells.push([nx, ny]);
        }
        break;
      }
    }
    for (let cy = 0; cy < CH; cy++) {
      for (let cx = 0; cx < CW; cx++) {
        const v = T[cy * CW + cx];
        const i = portrait ? idx(cy, cx) : idx(cx, cy);
        if (v === 1) G.water[i] = 1;
        else if (v === 2) G.mount[i] = 1;
        else if (R() < 0.08) G.deco[i] = 1 + Math.floor(R() * 3);
      }
    }
  }

  // ---------------------------------------------------------------- towns
  function nearOcc(i, r, pred) {
    for (let yy = ty(i) - r; yy <= ty(i) + r; yy++) {
      for (let xx = tx(i) - r; xx <= tx(i) + r; xx++) {
        if (!inMap(xx, yy)) continue;
        const o = G.occ[idx(xx, yy)];
        if (o && (!pred || pred(o))) return true;
      }
    }
    return false;
  }

  // Land you can reach from what's already built without crossing water or hills.
  function reachableLand() {
    const seen = new Uint8Array(G.N);
    const stack = [];
    const add = (i) => { if (!seen[i]) { seen[i] = 1; stack.push(i); } };
    for (const t of G.towns) add(t.i);
    for (const g of G.gens) add(g.i);
    for (const e of G.edges.values()) { add(e.a); add(e.b); }
    while (stack.length) {
      const u = stack.pop();
      if (rough(u)) continue;
      for (const [dx, dy] of DIR4) {
        const x = tx(u) + dx, y = ty(u) + dy;
        if (!inB(x, y)) continue;
        const v = idx(x, y);
        if (!rough(v)) add(v);
      }
    }
    return seen;
  }

  function spawnTown(first) {
    const B = G.bounds;
    const spare = G.res.sea + G.res.under > 0;
    const reach = first || spare ? null : reachableLand();
    const mx = (B.x0 + B.x1) / 2, my = (B.y0 + B.y1) / 2;
    let best = -1, bestScore = -Infinity;
    for (let tries = 0; tries < 500; tries++) {
      const x = rint(B.x0 + 1, B.x1 - 1), y = rint(B.y0 + 1, B.y1 - 1);
      const i = idx(x, y);
      if (rough(i) || G.occ[i] || G.adj[i].size) continue;
      if (reach && !reach[i]) continue;
      if (nearOcc(i, 1)) continue;
      if (nearOcc(i, COAL_CLEAR, (o) => o.kind === 'gen' && o.g.type === 'coal')) continue;
      let open = 0;
      for (const [dx, dy] of DIR4) { const j = idx(x + dx, y + dy); if (!rough(j) && !G.occ[j]) open++; }
      if (open < 3) continue;
      let near = 99;
      for (const t of G.towns) near = Math.min(near, cheb(i, t.i));
      const score = first ? -Math.hypot(x - mx, y - my) + rnd(0, 2) : rnd(0, 3) - Math.abs(Math.min(near, 12) - 5);
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) return null;
    const t = { id: G.nextId++, i: best, bornDay: G.day, born: G.time, need: 0, served: 0, draw: 0, lit: 0, dark: 0, grid: -1 };
    G.occ[best] = { kind: 'town', t };
    G.deco[best] = 0;
    G.towns.push(t);
    graphChanged();
    return t;
  }

  function expandBounds() {
    const B = G.bounds;
    B.x0 = Math.max(0, B.x0 - 1);
    B.x1 = Math.min(G.W - 1, B.x1 + 1);
    B.y0 = Math.max(0, B.y0 - 1);
    B.y1 = Math.min(G.H - 1, B.y1 + 1);
    fitBoundsToScreen();
  }

  // Grow the open land along its shorter side until it has the same shape as
  // the space on screen, so none of the screen is wasted on locked land.
  function fitBoundsToScreen() {
    const B = G.bounds;
    const availW = Math.max(100, view.w - view.right);
    const availH = Math.max(100, view.h - view.top - view.bottom);
    const ratio = availH / availW;
    for (let guard = 0; guard < 40; guard++) {
      const bw = B.x1 - B.x0 + 1.6, bh = B.y1 - B.y0 + 1.6;
      if (bh / bw < ratio - 0.04) {
        if (B.y0 === 0 && B.y1 === G.H - 1) break;
        if ((guard % 2 === 0 && B.y0 > 0) || B.y1 === G.H - 1) B.y0--; else B.y1++;
      } else if (bw / bh < 1 / ratio - 0.04) {
        if (B.x0 === 0 && B.x1 === G.W - 1) break;
        if ((guard % 2 === 0 && B.x0 > 0) || B.x1 === G.W - 1) B.x0--; else B.x1++;
      } else break;
    }
  }

  // ---------------------------------------------------------------- power stations
  function coastal(i) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = tx(i) + dx, y = ty(i) + dy;
        if (inMap(x, y) && G.water[idx(x, y)]) return true;
      }
    }
    return false;
  }

  function placeCheck(type, i) {
    if (i < 0 || !inBi(i)) return 'bounds';
    if (rough(i)) return 'rough';
    if (G.occ[i]) return 'occ';
    if (type === 'coal' && nearOcc(i, COAL_CLEAR, (o) => o.kind === 'town')) return 'coal-near';
    return 'ok';
  }

  function placeGen(type, i) {
    if (G.res[type] < 1) return 'none';
    const r = placeCheck(type, i);
    if (r !== 'ok') return r;
    const g = {
      id: G.nextId++, type, i, born: G.time, out: 0, rate: 0, ang: Math.random() * 6,
      soc: type === 'battery' ? GEN.battery.store * 0.5 : 0, coast: coastal(i),
    };
    G.occ[i] = { kind: 'gen', g };
    G.deco[i] = 0;
    G.gens.push(g);
    G.res[type]--;
    G.owned[type] = true;
    G.uver++;
    graphChanged();
    sfx('place');
    return 'ok';
  }

  function removeGen(g) {
    G.occ[g.i] = null;
    G.gens = G.gens.filter((x) => x !== g);
    G.res[g.type]++;
    G.uver++;
    graphChanged();
  }

  function sun() {
    const p = dayPhase();
    return p < 0.25 || p > 0.75 ? 0 : Math.sin(Math.PI * (p - 0.25) / 0.5);
  }
  function avail(g) {
    if (g.type === 'coal') return GEN.coal.max;
    if (g.type === 'solar') return GEN.solar.max * sun();
    if (g.type === 'wind') return GEN.wind.max * G.wind * (g.coast ? 1.3 : 1);
    return 0;
  }
  function genMax(g) { return g.type === 'wind' && g.coast ? GEN.wind.max * 1.3 : GEN[g.type].max; }

  function updateWind(dt) {
    G.windT -= dt;
    if (G.windT <= 0) {
      G.windTarget = Math.random() < 0.25 ? rnd(0, 0.15) : rnd(0.35, 1);
      G.windT = rnd(10, 22);
    }
    G.wind += (G.windTarget - G.wind) * Math.min(1, dt * 0.25);
  }

  // ---------------------------------------------------------------- day and night
  // dayPhase is the clock: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. Each day starts at sunrise.
  function dayPhase() { return (G.dayT / DAY_LEN + 0.25) % 1; }
  function demandMult() { return 1 + G.map.swing * Math.sin(2 * Math.PI * (dayPhase() - 0.55)); } // peaks at 0.8, just after sunset
  function dayLabel() {
    const p = dayPhase();
    return p < 0.25 || p >= 0.9 ? 'Night' : p < 0.5 ? 'Morning' : p < 0.7 ? 'Afternoon' : 'Evening peak';
  }
  function townBase(t) { return Math.min(6, 2 + 0.35 * (G.day - t.bornDay)); }
  function townDemand(t) { return townBase(t) * G.map.demand * demandMult(); }

  // ---------------------------------------------------------------- graph
  function edgeLen(a, b) { return Math.hypot(tx(a) - tx(b), ty(a) - ty(b)); }
  function addEdge(a, b, kind, lvl = 1, run = 0) {
    const e = { a, b, kind, lvl, run, len: edgeLen(a, b), flow: 0, load: 0, heat: 0 };
    linkEdge(e);
    return e;
  }
  function linkEdge(e) {
    G.adj[e.a].set(e.b, e);
    G.adj[e.b].set(e.a, e);
    G.edges.set(ekey(e.a, e.b), e);
  }
  function removeEdge(e) {
    G.adj[e.a].delete(e.b);
    G.adj[e.b].delete(e.a);
    G.edges.delete(ekey(e.a, e.b));
  }
  const capOf = (e) => (e.kind === 'link' ? LINK_CAP : STRAND_CAP * e.lvl);
  const condOf = (e) => (e.kind === 'link' ? 4 / e.len : e.lvl / e.len);
  const allEdges = () => [...G.edges.values(), ...G.trips.map((t) => t.e)];
  function graphChanged() { G.gver++; }

  // two diagonal cables can't cross in the middle of a square
  function crosses(a, b) {
    const ax = tx(a), ay = ty(a), bx = tx(b), by = ty(b);
    if (ax === bx || ay === by) return false;
    const other = G.edges.get(ekey(idx(ax, by), idx(bx, ay)));
    return !!other && other.kind !== 'link';
  }

  function newStroke() { return { run: null, touched: new Set(), warned: false }; }

  // Lay one step of cable from a to b. Drawing along a cable that's already
  // there adds a strand to it instead.
  function tryConnect(a, b, st) {
    if (a === b) return 'ok';
    if (!inBi(a) || !inBi(b)) return 'bounds';
    if (cheb(a, b) !== 1) return 'bad';
    const k = ekey(a, b);
    const ex = G.edges.get(k);
    if (ex) {
      if (ex.kind === 'link' || st.touched.has(ex)) return 'ok';
      st.touched.add(ex);
      if (ex.lvl >= MAX_STRANDS) return 'max';
      if (G.res.cable < 1) return 'cable';
      ex.lvl++;
      G.res.cable--;
      G.uver++;
      G.fx.push({ type: 'strand', x: (tx(a) + tx(b)) / 2 + 0.5, y: (ty(a) + ty(b)) / 2 + 0.5, t: 0 });
      graphChanged();
      sfx('strand');
      return 'ok';
    }
    const trip = G.trips.find((t) => ekey(t.e.a, t.e.b) === k);
    if (trip) { st.touched.add(trip.e); restoreTrip(trip, true); return 'ok'; }
    if (crosses(a, b)) return 'cross';
    const ra = rough(a), rb = rough(b);
    let kind = 'land', run = 0;
    if (ra || rb) {
      if (!ra) {
        const tk = terrainOf(b);
        if (G.res[tk] < 1) return tk;
        if (G.res.cable < 1) return 'cable';
        st.run = { id: G.nextId++, kind: tk, len: 1, edges: [], open: true, last: a };
      } else {
        if (!st.run || !st.run.open || st.run.last !== a) return 'bad';
        if (rb) {
          if (terrainOf(b) !== st.run.kind) return 'bad';
          if (st.run.len >= MAX_SPAN) return 'long';
          st.run.len++;
        }
      }
      kind = st.run.kind;
      run = st.run.id;
    }
    if (G.res.cable < 1) return 'cable';
    const e = addEdge(a, b, kind, 1, run);
    G.res.cable--;
    G.uver++;
    st.touched.add(e);
    if (run) {
      st.run.edges.push(e);
      st.run.last = b;
      if (!rb) {
        st.run.open = false;
        G.res[st.run.kind]--;
        G.runs.set(run, st.run.kind);
        st.run = null;
      }
    }
    graphChanged();
    return 'ok';
  }

  // A sea or underground cable left unfinished at the end of a drag is taken back up.
  function endStroke(st) {
    if (st && st.run && st.run.open) {
      for (const e of st.run.edges) { removeEdge(e); G.res.cable += e.lvl; }
      st.run = null;
      graphChanged();
    }
  }

  function eraseEdge(e) {
    const drop = (x) => {
      if (G.edges.get(ekey(x.a, x.b)) === x) removeEdge(x);
      G.trips = G.trips.filter((t) => t.e !== x);
      if (x.kind === 'link') G.res.link++;
      else G.res.cable += x.lvl;
    };
    if (e.run) {
      for (const x of allEdges().filter((y) => y.run === e.run)) drop(x);
      const kind = G.runs.get(e.run);
      if (kind) { G.res[kind]++; G.runs.delete(e.run); }
    } else drop(e);
  }

  function eraseAt(i) {
    let any = false;
    for (const e of allEdges().filter((x) => x.a === i || x.b === i)) {
      if (G.edges.get(ekey(e.a, e.b)) === e || G.trips.some((t) => t.e === e)) { eraseEdge(e); any = true; }
    }
    if (G.guard[i]) { G.guard[i] = 0; G.res.guard++; any = true; }
    if (any) { G.uver++; graphChanged(); }
    return any;
  }

  function placeLink(a, b) {
    if (G.res.link < 1) return 'none';
    for (const i of [a, b]) if (!inBi(i) || rough(i)) return 'rough';
    const d = edgeLen(a, b);
    if (d > LINK_RANGE) return 'far';
    if (d < 2) return 'short';
    if (G.edges.has(ekey(a, b))) return 'exists';
    addEdge(a, b, 'link');
    G.res.link--;
    G.owned.link = true;
    G.uver++;
    graphChanged();
    sfx('strand');
    return 'ok';
  }

  function placeGuard(i) {
    if (G.res.guard < 1) return 'none';
    if (!G.adj[i].size && !G.trips.some((t) => t.e.a === i || t.e.b === i)) return 'nocable';
    if (G.guard[i]) return 'already';
    G.guard[i] = 1;
    G.res.guard--;
    G.owned.guard = true;
    G.uver++;
    for (const e of G.adj[i].values()) e.heat = 0;
    sfx('strand');
    return 'ok';
  }

  // ---------------------------------------------------------------- power flow
  // Every tile with a cable is a node. Each separate grid shares its power out:
  // solar and wind first, then coal, with batteries soaking up spare power or
  // covering a shortfall. If a grid is still short, every town on it gets the
  // same share. Then the flow along each cable is worked out the way current
  // really splits: more strands and shorter routes carry more.
  function solveFlow() {
    const N = G.N;
    const comp = G.comp;
    comp.fill(-1);
    const comps = [];
    for (const g of G.gens) { g.out = 0; g.rate = 0; }
    for (const t of G.towns) { t.need = townDemand(t); t.draw = 0; t.served = 0; t.grid = -1; }
    for (const e of G.edges.values()) e.flow = 0;
    for (let s = 0; s < N; s++) {
      if (comp[s] >= 0 || !G.adj[s].size) continue;
      const id = comps.length;
      const nodes = [s];
      comp[s] = id;
      for (let k = 0; k < nodes.length; k++) {
        for (const v of G.adj[nodes[k]].keys()) if (comp[v] < 0) { comp[v] = id; nodes.push(v); }
      }
      comps.push({ id, nodes, towns: [], gens: [], supply: 0, demand: 0, served: 0 });
    }
    for (const t of G.towns) if (comp[t.i] >= 0) { comps[comp[t.i]].towns.push(t); t.grid = comp[t.i]; }
    for (const g of G.gens) if (comp[g.i] >= 0) comps[comp[g.i]].gens.push(g);
    const P = new Float64Array(N);
    let supply = 0, demand = 0;
    for (const t of G.towns) demand += t.need;
    for (const c of comps) {
      dispatch(c, P);
      supply += c.supply;
      solveComp(c, P);
    }
    for (const e of G.edges.values()) e.load = Math.abs(e.flow) / capOf(e);
    G.comps = comps;
    G.supply = supply;
    G.demand = demand;
  }

  function dispatch(c, P) {
    let D = 0;
    for (const t of c.towns) D += t.need;
    let R = 0, C = 0, chargeRoom = 0, dischargeRoom = 0;
    for (const g of c.gens) {
      if (g.type === 'battery') {
        g.cIn = g.soc < GEN.battery.store - 0.01 ? GEN.battery.max : 0;
        g.cOut = g.soc > 0.01 ? GEN.battery.max : 0;
        chargeRoom += g.cIn;
        dischargeRoom += g.cOut;
      } else if (g.type === 'coal') C += avail(g);
      else R += avail(g);
    }
    const A = R + C;
    let total, served, batt;
    if (A >= D) {
      const charge = Math.min(A - D, chargeRoom);
      batt = -charge;
      total = D + charge;
      served = D > 0 ? 1 : 0;
    } else {
      const dis = Math.min(D - A, dischargeRoom);
      batt = dis;
      total = A;
      served = D > 0 ? (A + dis) / D : 0;
    }
    const rOut = Math.min(R, total), cOut = total - rOut;
    for (const g of c.gens) {
      if (g.type === 'battery') {
        g.rate = batt > 0 ? (dischargeRoom ? (batt * g.cOut) / dischargeRoom : 0) : (chargeRoom ? (batt * g.cIn) / chargeRoom : 0);
        g.out = g.rate;
      } else {
        const a = avail(g);
        g.out = g.type === 'coal' ? (C ? (a * cOut) / C : 0) : (R ? (a * rOut) / R : 0);
      }
      P[g.i] += g.out;
    }
    for (const t of c.towns) { t.served = served; t.draw = t.need * served; P[t.i] -= t.draw; }
    c.supply = A + dischargeRoom;
    c.avail = A;
    c.demand = D;
    c.served = served;
  }

  // Conjugate gradient on the grid's network, with one node held at zero.
  function solveComp(c, P) {
    const nodes = c.nodes, n = nodes.length;
    if (n < 2) return;
    let any = false;
    for (const v of nodes) if (Math.abs(P[v]) > 1e-9) { any = true; break; }
    const th = G.theta;
    if (!any) { for (const v of nodes) th[v] = 0; return; }
    const loc = new Map();
    nodes.forEach((v, k) => loc.set(v, k));
    const nbJ = [], nbG = [];
    for (let k = 0; k < n; k++) {
      const js = [], gs = [];
      for (const [w, e] of G.adj[nodes[k]]) { js.push(loc.get(w)); gs.push(condOf(e)); }
      nbJ.push(js); nbG.push(gs);
    }
    const x = new Float64Array(n), b = new Float64Array(n), r = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
    const t0 = th[nodes[0]];
    let bn = 0;
    for (let k = 1; k < n; k++) { x[k] = th[nodes[k]] - t0; b[k] = P[nodes[k]]; bn += b[k] * b[k]; }
    const mul = (v, out) => {
      for (let k = 1; k < n; k++) {
        let s = 0;
        const js = nbJ[k], gs = nbG[k];
        for (let q = 0; q < js.length; q++) s += gs[q] * (v[k] - (js[q] === 0 ? 0 : v[js[q]]));
        out[k] = s;
      }
    };
    mul(x, Ap);
    let rs = 0;
    for (let k = 1; k < n; k++) { r[k] = b[k] - Ap[k]; p[k] = r[k]; rs += r[k] * r[k]; }
    const tol = 1e-10 * (1 + bn);
    for (let it = 0; it < 4 * n + 20 && rs > tol; it++) {
      mul(p, Ap);
      let pAp = 0;
      for (let k = 1; k < n; k++) pAp += p[k] * Ap[k];
      if (pAp <= 0) break;
      const alpha = rs / pAp;
      let rsn = 0;
      for (let k = 1; k < n; k++) { x[k] += alpha * p[k]; r[k] -= alpha * Ap[k]; rsn += r[k] * r[k]; }
      const beta = rsn / rs;
      rs = rsn;
      for (let k = 1; k < n; k++) p[k] = r[k] + beta * p[k];
    }
    th[nodes[0]] = 0;
    for (let k = 1; k < n; k++) th[nodes[k]] = x[k];
    for (const v of nodes) {
      for (const e of G.adj[v].values()) if (v === e.a) e.flow = condOf(e) * (th[e.a] - th[e.b]);
    }
  }

  // ---------------------------------------------------------------- overload and trips
  // A cable that carries more than it's rated for heats up and trips. Its power
  // moves straight onto the other cables, which may then overload too.
  function updateHeat(dt) {
    G.tripCD = Math.max(0, G.tripCD - dt);
    let worst = null;
    for (const e of G.edges.values()) {
      const guarded = G.guard[e.a] || G.guard[e.b];
      if (e.load > 1 && !guarded) e.heat += HEAT_RATE * (e.load - 1) * dt;
      else e.heat = Math.max(0, e.heat - COOL_RATE * dt);
      if (e.heat >= 1 && (!worst || e.heat > worst.heat)) worst = e;
    }
    if (worst && G.tripCD <= 0) tripEdge(worst);
  }

  function tripEdge(e) {
    removeEdge(e);
    e.heat = 0; e.flow = 0; e.load = 0;
    G.trips.push({ e, left: TRIP_RESET });
    G.tripCD = CASCADE_GAP;
    G.trips_total++;
    G.chain = G.time - G.chainT < 4 ? G.chain + 1 : 1;
    G.chainT = G.time;
    G.longestChain = Math.max(G.longestChain, G.chain);
    G.fx.push({ type: 'spark', x: (tx(e.a) + tx(e.b)) / 2 + 0.5, y: (ty(e.a) + ty(e.b)) / 2 + 0.5, t: 0 });
    graphChanged();
    solveFlow();
    G.fver = G.gver;
    sfx(G.chain >= 2 ? 'cascade' : 'trip');
    if (G.chain === 3) toast('Cascade! Power keeps moving onto cables that can’t take it.');
    else if (!mechTip('trip', 'A cable carried too much for too long and its breaker tripped. Its power moved straight onto the other cables, which can trip too. Tap the gap to reset it, or wait and it comes back by itself.')) {
      if (G.chain < 2) toast('A cable tripped. Tap the gap to reset it.');
    }
  }

  function restoreTrip(t, quiet) {
    G.trips = G.trips.filter((x) => x !== t);
    const e = t.e;
    if (G.edges.has(ekey(e.a, e.b))) return;
    e.heat = 0;
    linkEdge(e);
    graphChanged();
    if (!quiet) sfx('reset');
  }

  // ---------------------------------------------------------------- simulation
  function step(dt) {
    G.time += dt;
    G.dayT += dt;
    updateWind(dt);
    for (const g of G.gens) if (g.type === 'wind') g.ang += dt * G.wind * 7;
    G.solveT -= dt;
    if (G.solveT <= 0 || G.fver !== G.gver) { solveFlow(); G.solveT = SOLVE_EVERY; G.fver = G.gver; }
    for (const g of G.gens) if (g.type === 'battery') g.soc = clamp(g.soc - g.rate * dt, 0, GEN.battery.store);

    let delivered = 0;
    for (const t of G.towns) {
      delivered += t.draw;
      t.lit += (t.served - t.lit) * Math.min(1, dt * 3);
      const graced = G.time - t.born < GRACE;
      if (t.served < 0.995 && !graced) t.dark += DARK_FILL * (1 - t.served) * dt;
      else t.dark = Math.max(0, t.dark - DARK_DRAIN * dt);
      if (t.dark >= 1) { gameOver(t); return; }
    }
    G.delivered = delivered;
    G.score += (delivered * dt * 24) / DAY_LEN;
    if (!G.targetHit && !modal && G.score >= G.map.target) {
      G.targetHit = true;
      onTargetReached();
      return;
    }

    updateHeat(dt);
    for (const t of G.trips) t.left -= dt;
    for (const t of G.trips.filter((x) => x.left <= 0)) restoreTrip(t);

    G.nextTown -= dt;
    if (G.nextTown <= 0) {
      spawnTown(false);
      G.nextTown = Math.max(11, 30 - 2 * (G.day - 1)) * rnd(0.8, 1.2);
    }

    for (const f of G.fx) f.t += dt;
    G.fx = G.fx.filter((f) => f.t < 0.8);

    const p = dayPhase();
    const sunNow = sun() > 0;
    if (G.lastSun !== undefined && sunNow !== G.lastSun && G.gens.some((g) => g.type === 'solar')) sfx(sunNow ? 'dawn' : 'dusk');
    G.lastSun = sunNow;
    if (p > 0.68 && p < 0.75 && G.duskWarn !== G.day) {
      const n = G.gens.filter((g) => g.type === 'solar' && G.adj[g.i].size).length;
      if (n) { G.duskWarn = G.day; toast(`Sunset soon. ${n} solar ${n === 1 ? 'farm stops' : 'farms stop'} just as the evening peak arrives.`); }
    }
    if (p > 0.74 && p < 0.8) mechTip('evening', 'Evening peak. Towns need the most power now, and solar has stopped for the night. Batteries charged during the day help here.');

    if (G.dayT >= DAY_LEN) {
      G.dayT -= DAY_LEN;
      G.day++;
      newDay();
    }

    G.saveT += dt;
    if (G.saveT > 15) { G.saveT = 0; save(); }
  }

  function deliveries() {
    const d = G.day, m = G.map, out = [];
    const n = 2 + Math.floor((d - 1) / 4);
    for (let k = 0; k < n; k++) {
      const opts = [['coal', Math.max(0.12, 0.75 - 0.09 * (d - 1))]];
      if (d >= m.solarDay) opts.push(['solar', 0.5]);
      if (d >= m.windDay) opts.push(['wind', 0.45]);
      let r = Math.random() * opts.reduce((s, o) => s + o[1], 0);
      let got = opts[0][0];
      for (const [type, w] of opts) { r -= w; if (r <= 0) { got = type; break; } }
      out.push(got);
    }
    if (d > m.solarDay && d % 2 === 0) out.push('battery');
    return out;
  }

  function newDay() {
    G.res.cable += DAILY_CABLE;
    const cards = deliveries();
    for (const k of cards) G.res[k]++;
    expandBounds();
    showUpgrade(cards);
  }

  // ---------------------------------------------------------------- progress
  function getProgress() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null'); } catch (e) { p = null; }
    return p || { unlocked: 1, best: {} };
  }
  function setProgress(p) {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(p)); } catch (e) { /* storage unavailable */ }
  }

  function onTargetReached() {
    const i = MAPS.indexOf(G.map);
    const next = MAPS[i + 1];
    const p = getProgress();
    const isNew = !!next && p.unlocked < i + 2;
    if (next) p.unlocked = Math.max(p.unlocked, i + 2);
    setProgress(p);
    if (!isNew) {
      toast(`Target reached in ${G.map.name}. Play on for a best score.`);
      return;
    }
    $('#tgTitle').textContent = `${next.name} unlocked`;
    $('#tgText').textContent = `You delivered ${fmt(G.map.target)} MWh in ${G.map.name}. ${next.name} is next. ${next.blurb}`;
    const go = $('#btnTgNext');
    go.textContent = `Play ${next.name}`;
    go.onclick = () => { save(); closeScreen(); startNew(next); };
    openScreen('sTarget');
  }

  function gameOver(t) {
    G.over = true;
    const p = getProgress();
    const prev = p.best[G.map.id] || 0;
    const score = Math.floor(G.score);
    p.best[G.map.id] = Math.max(prev, score);
    setProgress(p);
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage unavailable */ }
    G.overTown = t;
    user.zoom = 1; user.px = 0; user.py = 0;
    const game = G;
    sfx('cascade');
    setTimeout(() => {
      if (G !== game) return;
      $('#overWhy').textContent = t.grid < 0
        ? `A town in ${game.map.name} was never connected, and its lights went out.`
        : `A town in ${game.map.name} went without enough power for too long, and its lights went out.`;
      $('#overScore').textContent = fmt(score);
      $('#overSub').textContent = `MWh delivered in ${game.day} ${game.day === 1 ? 'day' : 'days'}`;
      $('#overBest').textContent = !prev ? '' : score > prev ? `New best for ${game.map.name}.` : `Best in ${game.map.name}: ${fmt(prev)} MWh`;
      openScreen('sOver');
    }, 1400);
  }

  // ---------------------------------------------------------------- upgrades
  const ICON = {
    cable: '<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round"><path d="M6 36C14 36 16 12 24 12s10 24 18 24" stroke="#7fb0ff" stroke-width="3"/><path d="M6 31C14 31 16 7 24 7s10 24 18 24" stroke="#7fb0ff" stroke-width="3" opacity=".6"/></svg>',
    sea: '<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round"><path d="M4 30c4-3 8-3 12 0s8 3 12 0 8-3 12 0" stroke="#2f7fd1" stroke-width="4"/><path d="M6 22h36" stroke="#7fb0ff" stroke-width="3"/><circle cx="6" cy="22" r="3" fill="#7fb0ff"/><circle cx="42" cy="22" r="3" fill="#7fb0ff"/></svg>',
    under: '<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 38 18 12l7 10 5-6 15 22z" fill="#33405f"/><path d="M4 32h40" stroke="#7fb0ff" stroke-width="3" stroke-dasharray="4 4"/></svg>',
    link: '<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round"><path d="M6 34Q24 4 42 34" stroke="#ffd45e" stroke-width="4"/><circle cx="6" cy="34" r="4" fill="#ffd45e"/><circle cx="42" cy="34" r="4" fill="#ffd45e"/></svg>',
    guard: '<svg viewBox="0 0 48 48" fill="none" stroke-linejoin="round"><path d="M24 6 39 12v11c0 9-6 16-15 19-9-3-15-10-15-19V12z" fill="#2fe0c0" opacity=".25" stroke="#2fe0c0" stroke-width="3"/><path d="m26 14-6 10h5l-3 9 8-12h-5z" fill="#2fe0c0"/></svg>',
    battery: '<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="14" width="30" height="20" rx="4" stroke="#2fe0c0" stroke-width="3"/><rect x="12" y="18" width="14" height="12" rx="2" fill="#2fe0c0"/><rect x="38" y="20" width="4" height="8" rx="1.5" fill="#2fe0c0"/></svg>',
    coal: '<svg viewBox="0 0 48 48" fill="none" stroke-linejoin="round"><rect x="8" y="22" width="32" height="18" rx="3" fill="#56658a"/><rect x="28" y="8" width="7" height="16" fill="#56658a"/><circle cx="34" cy="6" r="3" fill="#8b93a7"/><rect x="13" y="28" width="5" height="5" fill="#ffd76a"/><rect x="22" y="28" width="5" height="5" fill="#ffd76a"/></svg>',
    solar: '<svg viewBox="0 0 48 48" fill="none"><rect x="8" y="12" width="32" height="24" rx="3" fill="#1f61a8"/><path d="M24 12v24M8 24h32" stroke="#7fb0ff" stroke-width="2"/><circle cx="38" cy="10" r="5" fill="#ffc83d"/></svg>',
    wind: '<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round"><path d="M24 24v18" stroke="#c9d6ee" stroke-width="3"/><path d="M24 24 24 6M24 24 39 32M24 24 9 32" stroke="#c9d6ee" stroke-width="4"/><circle cx="24" cy="24" r="3" fill="#fff"/></svg>',
  };
  const UPGRADES = {
    cable: { label: '20 cable', note: 'More to lay, or to re-lay busy lines', n: 20 },
    sea: { label: 'Sea cable', note: 'Cross water', n: 1 },
    under: { label: 'Underground', note: 'Go through a hill', n: 1 },
    link: { label: 'Interconnector', note: `A strong link up to ${LINK_RANGE} tiles long, over anything`, n: 1 },
    guard: { label: '2 surge guards', note: 'Cables joined at a guard never trip', n: 2 },
    battery: { label: 'Battery', note: 'Stores spare power for later', n: 1 },
    coal: { label: 'Coal plant', note: 'Steady power, day and night', n: 1 },
  };

  function upgradeKeys() {
    return Object.keys(UPGRADES).filter((k) =>
      (k !== 'sea' || G.water.some((v) => v)) &&
      (k !== 'under' || G.map.hills > 0) &&
      (k !== 'battery' || G.day > G.map.solarDay));
  }

  // Three different choices: always one way to build further, one way to
  // protect or strengthen the grid, then one more from anything left.
  function pickUpgrades() {
    const keys = upgradeKeys();
    const out = [];
    const take = (list) => {
      const pool = list.filter((k) => keys.includes(k) && !out.includes(k));
      if (pool.length) out.push(pick(pool));
    };
    take(['cable', 'sea', 'under']);
    take(['link', 'guard']);
    take(keys);
    return out;
  }

  function listCards(cards) {
    const counts = {};
    for (const c of cards) counts[c] = (counts[c] || 0) + 1;
    const parts = Object.entries(counts).map(([k, n]) => `${n} ${n === 1 ? GEN[k].name : GEN[k].plural}`);
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] || '';
  }

  function showUpgrade(cards) {
    $('#upTitle').textContent = `Day ${G.day}`;
    $('#upText').textContent = `A new day. You get ${DAILY_CABLE} more cable${cards && cards.length ? ` and ${listCards(cards)}` : ''}. Pick one upgrade.`;
    const box = $('#choices');
    box.innerHTML = '';
    for (const k of pickUpgrades()) {
      const u = UPGRADES[k];
      const btn = document.createElement('button');
      btn.className = 'choice';
      btn.innerHTML = `${ICON[k]}<span>${u.label}</span><small>${u.note}</small>`;
      btn.addEventListener('click', () => {
        G.res[k] += u.n;
        G.owned[k] = true;
        hudCache = '';
        closeScreen();
        measure();
        save();
        if (k === 'link') mechTip('link', `Interconnector: tap the Interconnector tool, then tap two points up to ${LINK_RANGE} tiles apart. It jumps over anything and carries ${LINK_CAP} MW.`);
        if (k === 'guard') mechTip('guard', 'Surge guard: tap a cable joint to protect it. Cables joined there never trip, so a cascade stops there.');
      });
      box.appendChild(btn);
    }
    openScreen('sUpgrade');
    if (cards && cards.includes('solar')) mechTip('solar', 'You have a solar farm. It only works in daylight, and the evening peak comes just after sunset. A battery stores spare daytime power for the evening.', true);
    else if (cards && cards.includes('wind')) mechTip('wind', 'You have a wind farm. It makes power when the wind blows. Wind farms next to water make more.', true);
    else if (cards && cards.includes('battery')) mechTip('battery', 'You have a battery. Put it on a grid and it charges from spare power, then gives it back when the grid runs short.', true);
  }

  // ---------------------------------------------------------------- save / load
  function save() {
    if (!G || G.over || G.demo) return;
    const water = [], mount = [], deco = [], guard = [];
    for (let i = 0; i < G.N; i++) {
      if (G.water[i]) water.push(i);
      if (G.mount[i]) mount.push(i);
      if (G.deco[i]) deco.push(i, G.deco[i]);
      if (G.guard[i]) guard.push(i);
    }
    const tripLeft = new Map(G.trips.map((t) => [t.e, t.left]));
    const data = {
      v: 4, map: G.map.id, W: G.W, H: G.H, water, mount, deco, guard, targetHit: G.targetHit,
      edges: allEdges().map((e) => [e.a, e.b, e.kind, e.lvl, e.run, tripLeft.has(e) ? tripLeft.get(e) : -1]),
      runs: [...G.runs],
      towns: G.towns.map((t) => [t.i, t.bornDay, t.dark]),
      gens: G.gens.map((g) => [g.type, g.i, g.soc]),
      res: G.res, owned: G.owned, time: G.time, day: G.day, dayT: G.dayT, score: G.score,
      bounds: G.bounds, nextTown: G.nextTown, wind: G.wind, windTarget: G.windTarget, speed: G.speed, nextId: G.nextId,
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* storage unavailable */ }
  }

  function load() {
    let data;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { data = null; }
    if (!data || data.v !== 4) return false;
    G = blankState(data.W, data.H);
    G.map = MAPS.find((m) => m.id === data.map) || MAPS[0];
    for (const i of data.water) G.water[i] = 1;
    for (const i of data.mount) G.mount[i] = 1;
    for (let k = 0; k < data.deco.length; k += 2) G.deco[data.deco[k]] = data.deco[k + 1];
    for (const i of data.guard) G.guard[i] = 1;
    Object.assign(G, {
      targetHit: !!data.targetHit, time: data.time, day: data.day, dayT: data.dayT, score: data.score, bounds: data.bounds,
      nextTown: data.nextTown, wind: data.wind, windTarget: data.windTarget, speed: data.speed || 1, nextId: data.nextId,
    });
    Object.assign(G.res, data.res);
    G.owned = data.owned || {};
    for (const [a, b, kind, lvl, run, left] of data.edges) {
      const e = { a, b, kind, lvl, run, len: edgeLen(a, b), flow: 0, load: 0, heat: 0 };
      if (left >= 0) G.trips.push({ e, left }); else linkEdge(e);
    }
    G.runs = new Map(data.runs);
    for (const [i, bornDay, dark] of data.towns) {
      const t = { id: G.nextId++, i, bornDay, born: -99, need: 0, served: 0, draw: 0, lit: 1, dark, grid: -1 };
      G.occ[i] = { kind: 'town', t };
      G.towns.push(t);
    }
    for (const [type, i, soc] of data.gens) {
      const g = { id: G.nextId++, type, i, born: -99, out: 0, rate: 0, ang: 0, soc, coast: coastal(i) };
      G.occ[i] = { kind: 'gen', g };
      G.gens.push(g);
    }
    undoStack = [];
    pendingSnap = null;
    user.zoom = 1; user.px = 0; user.py = 0;
    camSnap = true;
    graphChanged();
    return true;
  }

  // ---------------------------------------------------------------- undo
  // Covers cables, power stations and guards. Each undo puts them back and
  // returns what they cost.
  let undoStack = [];
  let pendingSnap = null;
  function snapNet() {
    const tripLeft = new Map(G.trips.map((t) => [t.e, t.left]));
    return {
      uver: G.uver,
      edges: allEdges().map((e) => [e, e.lvl, tripLeft.has(e) ? tripLeft.get(e) : -1]),
      runs: [...G.runs], res: { ...G.res }, gens: G.gens.slice(), guard: G.guard.slice(),
    };
  }
  function commitUndo() {
    if (pendingSnap && pendingSnap.uver !== G.uver) {
      undoStack.push(pendingSnap);
      if (undoStack.length > 30) undoStack.shift();
    }
    pendingSnap = null;
    hudCache = '';
  }
  function undo() {
    commitUndo();
    const s = undoStack.pop();
    if (!s) return;
    for (const e of [...G.edges.values()]) removeEdge(e);
    G.trips = [];
    for (const [e, lvl, left] of s.edges) {
      e.lvl = lvl; e.heat = 0;
      if (left >= 0) G.trips.push({ e, left }); else linkEdge(e);
    }
    G.runs = new Map(s.runs);
    Object.assign(G.res, s.res);
    for (const g of G.gens) if (G.occ[g.i] && G.occ[g.i].g === g) G.occ[g.i] = null;
    G.gens = [];
    for (const g of s.gens) {
      if (G.occ[g.i]) { G.res[g.type]++; continue; }
      G.occ[g.i] = { kind: 'gen', g };
      G.gens.push(g);
    }
    G.guard.set(s.guard);
    G.uver++;
    graphChanged();
    hudCache = '';
  }

  // ---------------------------------------------------------------- camera
  function baseCam() {
    const B = G.bounds;
    const bw = B.x1 - B.x0 + 1.6;
    const bh = B.y1 - B.y0 + 1.6;
    const availH = Math.max(100, view.h - view.top - view.bottom);
    const availW = Math.max(100, view.w - view.right);
    const s = Math.min(availW / bw, availH / bh);
    return { x: (B.x0 + B.x1 + 1) / 2, y: (B.y0 + B.y1 + 1) / 2, s };
  }
  function targetCam() {
    const b = baseCam();
    const B = G.bounds;
    const s = b.s * user.zoom;
    // Only allow panning as far as zoom makes room for, so the map stays on screen.
    const slack = 1 - 1 / user.zoom;
    const hx = ((B.x1 - B.x0 + 1.6) / 2) * slack;
    const hy = ((B.y1 - B.y0 + 1.6) / 2) * slack;
    user.px = clamp(user.px, -hx, hx);
    user.py = clamp(user.py, -hy, hy);
    return { x: b.x + user.px, y: b.y + user.py, s };
  }
  function updateCamera(dt) {
    if (!G) return;
    const t = targetCam();
    if (camSnap) { cam.x = t.x; cam.y = t.y; cam.s = t.s; camSnap = false; return; }
    const k = 1 - Math.exp(-dt * 6);
    cam.x += (t.x - cam.x) * k;
    cam.y += (t.y - cam.y) * k;
    cam.s += (t.s - cam.s) * k;
  }
  function screenCenterY() { return view.top + (view.h - view.top - view.bottom) / 2; }
  function screenCenterX() { return (view.w - view.right) / 2; }
  const sx = (wx) => (wx - cam.x) * cam.s + screenCenterX();
  const sy = (wy) => (wy - cam.y) * cam.s + screenCenterY();
  const wxOf = (px) => (px - screenCenterX()) / cam.s + cam.x;
  const wyOf = (py) => (py - screenCenterY()) / cam.s + cam.y;

  // ---------------------------------------------------------------- input
  const pointers = new Map();
  let action = null;
  let pinch = null;
  let gestureLock = false;
  const EDIT_TOOLS = new Set(['cable', 'erase', 'coal', 'solar', 'wind', 'battery', 'link', 'guard']);

  function tileAtWorld(wx, wy) {
    const x = Math.floor(wx), y = Math.floor(wy);
    if (!inMap(x, y)) return -1;
    return idx(x, y);
  }

  function stepToward(from, to) {
    const fx = tx(from), fy = ty(from), gx = tx(to), gy = ty(to);
    const dx = gx - fx, dy = gy - fy;
    const ax = Math.abs(dx), ay = Math.abs(dy);
    let sxv = Math.sign(dx), syv = Math.sign(dy);
    if (ax > ay * 2) syv = 0;
    else if (ay > ax * 2) sxv = 0;
    return idx(fx + sxv, fy + syv);
  }

  function feedback(res) {
    const msg = {
      cable: 'Out of cable. Erase some, or wait for the next day.',
      sea: 'You need a sea cable to cross water.',
      under: G.map.hills ? 'You need an underground cable to go through a hill.' : 'Hills block cables.',
      long: `That's too long. Sea and underground cables can be up to ${MAX_SPAN} tiles.`,
      cross: 'Cables can’t cross diagonally in the middle of a square.',
      max: `That cable already has ${MAX_STRANDS} strands, the most it can take.`,
      'coal-near': `Coal plants have to be more than ${COAL_CLEAR} tiles from a town.`,
      occ: 'Something is already there.',
      rough: 'Build on open land.',
      bounds: 'That land isn’t open yet. The map grows each day.',
      far: `Interconnectors can be up to ${LINK_RANGE} tiles long.`,
      short: 'Interconnectors are for longer jumps. Use cable for short ones.',
      exists: 'Those two points are already joined.',
      nocable: 'Tap a cable joint to put a surge guard on it.',
      already: 'That joint already has a surge guard.',
    }[res];
    if (msg) toast(msg);
    if (res === 'cable') flashCount('cable');
    else if (res === 'sea' || res === 'under') flashCount(res);
  }

  const canStart = (c) => c >= 0 && inBi(c) && !rough(c);

  function cableMove(wx, wy, a) {
    const c = tileAtWorld(wx, wy);
    if (c < 0 || c === a.last) return;
    if (a.last < 0) {
      if (canStart(c)) a.last = c;
      return;
    }
    const cx = tx(c) + 0.5, cy = ty(c) + 0.5;
    const near = Math.hypot(wx - cx, wy - cy) < 0.46;
    const cheb1 = cheb(c, a.last);
    if (!near && cheb1 <= 1) return;
    let cur = a.last;
    let guard = 0;
    while (cur !== c && guard++ < 64) {
      const nx = stepToward(cur, c);
      const r = tryConnect(cur, nx, a.st);
      if (r === 'max') { if (!a.st.warned) { feedback(r); a.st.warned = true; } cur = nx; continue; }
      if (r !== 'ok') {
        if (!a.st.warned && r !== 'bad') { feedback(r); a.st.warned = true; }
        if ((r === 'bad' || r === 'cross') && canStart(nx) && !(a.st.run && a.st.run.open)) { cur = nx; continue; }
        break;
      }
      cur = nx;
    }
    a.last = cur;
  }

  function eraseMove(wx, wy, a) {
    const c = tileAtWorld(wx, wy);
    if (c < 0) return;
    if (a.last < 0 || a.last === c) { if (a.last !== c) eraseAt(c); a.last = c; return; }
    let cur = a.last, guard = 0;
    while (cur !== c && guard++ < 64) { cur = stepToward(cur, c); eraseAt(cur); }
    a.last = c;
  }

  function tappedTrip(c, wx, wy) {
    let best = null, bd = 0.9;
    for (const t of G.trips) {
      const mx = (tx(t.e.a) + tx(t.e.b)) / 2 + 0.5, my = (ty(t.e.a) + ty(t.e.b)) / 2 + 0.5;
      const d = Math.hypot(wx - mx, wy - my);
      if (d < bd) { bd = d; best = t; }
    }
    if (best) return best;
    return G.trips.find((t) => t.e.a === c || t.e.b === c) || null;
  }

  function tapAt(a, c, wx, wy) {
    const trip = tappedTrip(c, wx, wy);
    if (trip && (a.tool === 'cable' || a.tool === 'erase')) {
      if (a.tool === 'erase') { eraseEdge(trip.e); G.uver++; graphChanged(); return; }
      restoreTrip(trip);
      toast('Breaker reset.');
      return;
    }
    if (c < 0) return;
    const o = G.occ[c];
    if (a.tool === 'cable') {
      if (o && o.kind === 'town' && !G.over) { openInspect(o.t); return; }
      if (o && o.kind === 'gen') { toast(genInfo(o.g)); return; }
      if (G.adj[c].size) toast(cableInfo(c));
      return;
    }
    if (a.tool === 'erase') {
      if (o && o.kind === 'gen') { removeGen(o.g); toast(`${cap1(GEN[o.g.type].name)} removed. You can build it again somewhere else.`); }
      else eraseAt(c);
      return;
    }
    if (GEN[a.tool]) {
      const r = placeGen(a.tool, c);
      if (r !== 'ok') { feedback(r); return; }
      if (G.res[a.tool] <= 0) setTool('cable');
      return;
    }
    if (a.tool === 'link') {
      if (linkStart < 0) {
        if (!inBi(c) || rough(c)) { feedback('rough'); return; }
        linkStart = c;
        toast('Now tap the other end.');
      } else if (c === linkStart) {
        linkStart = -1;
      } else {
        const r = placeLink(linkStart, c);
        if (r !== 'ok') { feedback(r); return; }
        linkStart = -1;
        setTool('cable');
      }
      return;
    }
    if (a.tool === 'guard') {
      const r = placeGuard(c);
      if (r !== 'ok') { feedback(r); return; }
      if (G.res.guard <= 0) setTool('cable');
    }
  }

  const cap1 = (s) => s[0].toUpperCase() + s.slice(1);
  function genInfo(g) {
    const name = cap1(GEN[g.type].name);
    if (!G.adj[g.i].size) return `${name}. It has no cable yet.`;
    if (g.type === 'battery') {
      const pct = Math.round((g.soc / GEN.battery.store) * 100);
      const doing = g.rate > 0.05 ? `giving ${mw(g.rate)} MW` : g.rate < -0.05 ? `charging at ${mw(-g.rate)} MW` : 'idle';
      return `Battery, ${pct}% full, ${doing}.`;
    }
    let text = `${name}: making ${mw(g.out)} of ${mw(genMax(g))} MW.`;
    if (g.type === 'solar' && sun() <= 0) text += ' The sun is down.';
    if (g.type === 'wind') text += ` Wind is at ${Math.round(G.wind * 100)}%.${g.coast ? ' Next to water, so it makes more.' : ''}`;
    if (g.type === 'coal' && g.out < avail(g) - 0.1) text += ' Running below full because the grid doesn’t need more.';
    return text;
  }
  function cableInfo(c) {
    let e = null;
    for (const x of G.adj[c].values()) if (!e || x.load > e.load) e = x;
    if (!e) return '';
    if (e.kind === 'link') return `Interconnector: carrying ${mw(Math.abs(e.flow))} of ${LINK_CAP} MW.`;
    const strands = `${e.lvl} ${e.lvl === 1 ? 'strand' : 'strands'}`;
    const more = e.lvl < MAX_STRANDS ? ' Draw along it again to add a strand.' : '';
    return `Carrying ${mw(Math.abs(e.flow))} of ${capOf(e)} MW on ${strands}.${more}`;
  }

  function resetTouches() {
    pointers.clear();
    if (action) endStroke(action.st);
    action = null;
    pinch = null;
    gestureLock = false;
  }

  function onDown(e) {
    if (!G || modal) return;
    if (inspect) { closeInspect(); return; }
    const arrow = e.isPrimary && edgeArrows.find((a) => Math.hypot(a.x - e.clientX, a.y - e.clientY) < 26);
    if (arrow) { lookAt(arrow.t); return; }
    if (e.isPrimary) resetTouches();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1 && !gestureLock) {
      const wx = wxOf(e.clientX), wy = wyOf(e.clientY);
      commitUndo();
      if (EDIT_TOOLS.has(tool)) pendingSnap = snapNet();
      action = { tool, sx: e.clientX, sy: e.clientY, moved: false, last: -1, st: newStroke() };
      if (tool === 'cable') {
        const c = tileAtWorld(wx, wy);
        if (canStart(c)) action.last = c;
      } else if (tool === 'erase') {
        action.startTile = tileAtWorld(wx, wy);
      }
    } else if (pointers.size === 2) {
      if (action) endStroke(action.st);
      action = null;
      gestureLock = true;
      startPinch();
    }
  }

  function startPinch() {
    const [p1, p2] = [...pointers.values()];
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    pinch = { d0: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, z0: user.zoom, wx: wxOf(mx), wy: wyOf(my) };
  }

  function onMove(e) {
    if (!pointers.has(e.pointerId)) {
      if (G && !modal && e.pointerType === 'mouse') hoverTile = tileAtWorld(wxOf(e.clientX), wyOf(e.clientY));
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [p1, p2] = [...pointers.values()];
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      user.zoom = clamp((pinch.z0 * d) / pinch.d0, 1, 3.2);
      const b = baseCam();
      const s = b.s * user.zoom;
      user.px = pinch.wx - (mx - screenCenterX()) / s - b.x;
      user.py = pinch.wy - (my - screenCenterY()) / s - b.y;
      camSnap = true;
      return;
    }
    if (!action) return;
    if (Math.hypot(e.clientX - action.sx, e.clientY - action.sy) > 6) {
      if (!action.moved && action.tool === 'erase') { action.last = action.startTile; if (action.last >= 0) eraseAt(action.last); }
      action.moved = true;
    }
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (events.length ? events : [e])) {
      const wx = wxOf(ev.clientX), wy = wyOf(ev.clientY);
      if (action.tool === 'cable') cableMove(wx, wy, action);
      else if (action.tool === 'erase' && action.moved) eraseMove(wx, wy, action);
    }
  }

  function onUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) gestureLock = false;
    if (!action) return;
    const a = action;
    action = null;
    endStroke(a.st);
    setTimeout(commitUndo, 0);
    if (a.moved || e.type === 'pointercancel') return;
    const wx = wxOf(e.clientX), wy = wyOf(e.clientY);
    tapAt(a, tileAtWorld(wx, wy), wx, wy);
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', (e) => {
    if (pointers.has(e.pointerId)) onUp(new PointerEvent('pointercancel', { pointerId: e.pointerId }));
  });
  // Belt and braces: when the last finger leaves the glass, forget everything.
  window.addEventListener('touchend', (e) => {
    if (e.touches.length) return;
    setTimeout(() => { if (pointers.size) resetTouches(); }, 60);
  });
  window.addEventListener('touchcancel', (e) => {
    if (e.touches.length) return;
    setTimeout(() => { if (pointers.size) resetTouches(); }, 60);
  });
  canvas.addEventListener('pointerleave', () => { hoverTile = -1; });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    if (!G || modal) return;
    e.preventDefault();
    const before = { x: wxOf(e.clientX), y: wyOf(e.clientY) };
    user.zoom = clamp(user.zoom * Math.exp(-e.deltaY * 0.0015), 1, 3.2);
    const b = baseCam();
    const s = b.s * user.zoom;
    user.px = before.x - (e.clientX - screenCenterX()) / s - b.x;
    user.py = before.y - (e.clientY - screenCenterY()) / s - b.y;
    camSnap = true;
  }, { passive: false });

  // ---------------------------------------------------------------- rendering
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function popScale(born) {
    const t = (G.time - born) / 0.45;
    if (t >= 1) return 1;
    if (t <= 0) return 0;
    return 1 + Math.sin(t * Math.PI) * 0.25 - (1 - t) * (1 - t) * 0.9;
  }

  const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const COOL = hexRgb('#7fb0ff'), WARM = hexRgb('#ffc83d'), HOT = hexRgb(PAL.hot);
  function loadRgb(L) {
    const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
    if (L < 0.6) return COOL;
    if (L < 0.9) return mix(COOL, WARM, (L - 0.6) / 0.3);
    if (L < 1) return mix(WARM, HOT, (L - 0.9) / 0.1);
    return HOT;
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;

  function render() {
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, view.w, view.h);
    if (!G) return;
    const s = cam.s;
    const B = G.bounds;

    const vx0 = Math.max(0, Math.floor(wxOf(0)) - 1);
    const vx1 = Math.min(G.W - 1, Math.ceil(wxOf(view.w)) + 1);
    const vy0 = Math.max(0, Math.floor(wyOf(0)) - 1);
    const vy1 = Math.min(G.H - 1, Math.ceil(wyOf(view.h)) + 1);

    // land
    ctx.fillStyle = PAL.landOut;
    ctx.fillRect(sx(0), sy(0), G.W * s, G.H * s);
    ctx.fillStyle = PAL.land;
    ctx.fillRect(sx(B.x0), sy(B.y0), (B.x1 - B.x0 + 1) * s, (B.y1 - B.y0 + 1) * s);

    // decoration + grid
    for (let y = vy0; y <= vy1; y++) {
      for (let x = vx0; x <= vx1; x++) {
        const i = idx(x, y);
        if (rough(i) || G.adj[i].size || G.occ[i]) continue;
        const cx = sx(x + 0.5), cy = sy(y + 0.5);
        if (G.deco[i]) {
          ctx.fillStyle = inB(x, y) ? PAL.tree : 'rgba(0,0,0,0.06)';
          const r = s * (0.12 + G.deco[i] * 0.04);
          ctx.beginPath(); ctx.arc(cx + (G.deco[i] - 2) * s * 0.12, cy, r, 0, Math.PI * 2); ctx.fill();
        } else if (inB(x, y)) {
          ctx.fillStyle = PAL.grid;
          ctx.fillRect(cx - 1, cy - 1, 2, 2);
        }
      }
    }

    // water
    ctx.fillStyle = PAL.water;
    for (let y = vy0; y <= vy1; y++) {
      for (let x = vx0; x <= vx1; x++) {
        if (G.water[idx(x, y)]) ctx.fillRect(sx(x) - 0.5, sy(y) - 0.5, s + 1, s + 1);
      }
    }
    // soft shoreline
    ctx.strokeStyle = PAL.waterEdge;
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.beginPath();
    for (let y = vy0; y <= vy1; y++) {
      for (let x = vx0; x <= vx1; x++) {
        if (!G.water[idx(x, y)]) continue;
        if (y > 0 && !G.water[idx(x, y - 1)]) { ctx.moveTo(sx(x), sy(y)); ctx.lineTo(sx(x + 1), sy(y)); }
        if (y < G.H - 1 && !G.water[idx(x, y + 1)]) { ctx.moveTo(sx(x), sy(y + 1)); ctx.lineTo(sx(x + 1), sy(y + 1)); }
        if (x > 0 && !G.water[idx(x - 1, y)]) { ctx.moveTo(sx(x), sy(y)); ctx.lineTo(sx(x), sy(y + 1)); }
        if (x < G.W - 1 && !G.water[idx(x + 1, y)]) { ctx.moveTo(sx(x + 1), sy(y)); ctx.lineTo(sx(x + 1), sy(y + 1)); }
      }
    }
    ctx.stroke();

    // hills
    ctx.fillStyle = PAL.mount;
    for (let y = vy0; y <= vy1; y++) {
      for (let x = vx0; x <= vx1; x++) {
        if (G.mount[idx(x, y)]) ctx.fillRect(sx(x) - 0.5, sy(y) - 0.5, s + 1, s + 1);
      }
    }
    for (let y = vy0; y <= vy1; y++) {
      for (let x = vx0; x <= vx1; x++) {
        const i = idx(x, y);
        if (!G.mount[i] || G.adj[i].size) continue;
        const cx = sx(x + 0.5), base = sy(y + 0.85);
        const h = s * (0.5 + ((x * 7 + y * 13) % 3) * 0.08);
        const w = s * 0.42;
        ctx.fillStyle = PAL.mountDark;
        ctx.beginPath(); ctx.moveTo(cx - w, base); ctx.lineTo(cx, base - h); ctx.lineTo(cx + w, base); ctx.closePath(); ctx.fill();
        ctx.fillStyle = PAL.mountLight;
        ctx.beginPath(); ctx.moveTo(cx - w, base); ctx.lineTo(cx, base - h); ctx.lineTo(cx - w * 0.1, base); ctx.closePath(); ctx.fill();
      }
    }

    // dim outside bounds
    ctx.fillStyle = 'rgba(2,4,10,0.45)';
    const bx0 = sx(B.x0), by0 = sy(B.y0), bx1 = sx(B.x1 + 1), by1 = sy(B.y1 + 1);
    ctx.fillRect(sx(0), sy(0), G.W * s, by0 - sy(0));
    ctx.fillRect(sx(0), by1, G.W * s, sy(G.H) - by1);
    ctx.fillRect(sx(0), by0, bx0 - sx(0), by1 - by0);
    ctx.fillRect(bx1, by0, sx(G.W) - bx1, by1 - by0);

    drawNight();
    drawCables();
    drawTrips();
    for (const g of G.gens) drawGen(g);
    for (const t of G.towns) drawTown(t);

    // effects
    for (const f of G.fx) {
      const k = f.t / 0.8;
      if (f.type === 'spark') {
        ctx.strokeStyle = rgba(HOT, 1 - k);
        ctx.lineWidth = s * 0.08;
        for (let r = 0; r < 6; r++) {
          const a = r * 1.05 + f.x;
          ctx.beginPath();
          ctx.moveTo(sx(f.x) + Math.cos(a) * s * 0.2 * k, sy(f.y) + Math.sin(a) * s * 0.2 * k);
          ctx.lineTo(sx(f.x) + Math.cos(a) * s * (0.3 + k * 0.7), sy(f.y) + Math.sin(a) * s * (0.3 + k * 0.7));
          ctx.stroke();
        }
      } else if (f.type === 'strand') {
        ctx.strokeStyle = `rgba(200,225,255,${(0.8 * (1 - k)).toFixed(3)})`;
        ctx.lineWidth = s * 0.06;
        ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), s * (0.15 + k * 0.4), 0, Math.PI * 2); ctx.stroke();
      }
    }

    // tool hints
    if (tool === 'link' && linkStart >= 0) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
      ctx.strokeStyle = PAL.link;
      ctx.lineWidth = s * 0.1;
      ctx.beginPath(); ctx.arc(sx(tx(linkStart) + 0.5), sy(ty(linkStart) + 0.5), s * (0.42 + pulse * 0.1), 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([s * 0.1, s * 0.15]);
      ctx.lineWidth = Math.max(1, s * 0.04);
      ctx.beginPath(); ctx.arc(sx(tx(linkStart) + 0.5), sy(ty(linkStart) + 0.5), s * LINK_RANGE, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (action && action.tool === 'cable' && action.last >= 0) {
      ctx.strokeStyle = 'rgba(220,235,255,0.45)';
      ctx.lineWidth = Math.max(1.5, s * 0.06);
      ctx.beginPath(); ctx.arc(sx(tx(action.last) + 0.5), sy(ty(action.last) + 0.5), s * 0.46, 0, Math.PI * 2); ctx.stroke();
    }
    if (hoverTile >= 0 && !action && tool !== 'cable') {
      const ok = GEN[tool] ? placeCheck(tool, hoverTile) === 'ok' : true;
      ctx.strokeStyle = ok ? 'rgba(220,235,255,0.35)' : 'rgba(255,90,60,0.6)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx(tx(hoverTile)) + 1, sy(ty(hoverTile)) + 1, s - 2, s - 2);
    }
    if (GEN[tool] === GEN.coal && G.res.coal > 0) {
      // show where coal can't go
      ctx.fillStyle = 'rgba(255,90,60,0.08)';
      for (const t of G.towns) {
        const r = COAL_CLEAR;
        ctx.fillRect(sx(tx(t.i) - r), sy(ty(t.i) - r), s * (2 * r + 1), s * (2 * r + 1));
      }
    }

    if (G.over && G.overTown) {
      const t = G.overTown;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
      ctx.strokeStyle = PAL.hot;
      ctx.lineWidth = s * 0.15;
      ctx.globalAlpha = 0.5 + pulse * 0.5;
      ctx.beginPath(); ctx.arc(sx(tx(t.i) + 0.5), sy(ty(t.i) + 0.5), s * (1.3 + pulse * 0.3), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    drawTipHighlights();
    drawInspect();
    drawEdgeArrows();
  }

  function seg(e) {
    ctx.moveTo(sx(tx(e.a) + 0.5), sy(ty(e.a) + 0.5));
    ctx.lineTo(sx(tx(e.b) + 0.5), sy(ty(e.b) + 0.5));
  }
  function linkPath(e) {
    const x1 = sx(tx(e.a) + 0.5), y1 = sy(ty(e.a) + 0.5), x2 = sx(tx(e.b) + 0.5), y2 = sy(ty(e.b) + 0.5);
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1;
    const cx = mx - dy * 0.22, cy = my + dx * 0.22;
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(cx, cy, x2, y2);
  }

  function drawCables() {
    const s = cam.s;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const edges = [...G.edges.values()];
    // channels under sea and underground cables
    for (const e of edges) {
      if (e.kind !== 'sea' && e.kind !== 'under') continue;
      ctx.strokeStyle = e.kind === 'sea' ? 'rgba(74,168,255,0.28)' : 'rgba(5,8,16,0.6)';
      ctx.lineWidth = s * 0.55;
      ctx.beginPath(); seg(e); ctx.stroke();
    }
    for (const e of edges) {
      const col = loadRgb(e.load);
      const isLink = e.kind === 'link';
      const path = () => { ctx.beginPath(); if (isLink) linkPath(e); else seg(e); };
      // glow
      ctx.strokeStyle = rgba(col, 0.14 + Math.min(0.25, e.load * 0.18));
      ctx.lineWidth = s * (isLink ? 0.5 : 0.3 + 0.12 * e.lvl);
      path(); ctx.stroke();
      if (e.heat > 0.05) {
        const pulse = 0.5 + 0.5 * Math.sin(G.time * (6 + e.heat * 14));
        ctx.strokeStyle = rgba(HOT, Math.min(0.85, e.heat * (0.4 + 0.5 * pulse)));
        ctx.lineWidth = s * (0.45 + 0.25 * e.heat);
        path(); ctx.stroke();
      }
      // strands, side by side
      if (isLink) {
        ctx.strokeStyle = PAL.link;
        ctx.lineWidth = Math.max(2, s * 0.12);
        path(); ctx.stroke();
      } else {
        const x1 = sx(tx(e.a) + 0.5), y1 = sy(ty(e.a) + 0.5), x2 = sx(tx(e.b) + 0.5), y2 = sy(ty(e.b) + 0.5);
        const L = Math.hypot(x2 - x1, y2 - y1) || 1;
        const nx = -(y2 - y1) / L, ny = (x2 - x1) / L;
        ctx.strokeStyle = rgba(col, e.kind === 'under' ? 0.6 : 1);
        ctx.lineWidth = Math.max(1.2, s * 0.075);
        if (e.kind === 'under') ctx.setLineDash([s * 0.16, s * 0.1]);
        for (let k = 0; k < e.lvl; k++) {
          const off = (k - (e.lvl - 1) / 2) * s * 0.14;
          ctx.beginPath();
          ctx.moveTo(x1 + nx * off, y1 + ny * off);
          ctx.lineTo(x2 + nx * off, y2 + ny * off);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      // current flowing along it, in the direction it really flows
      const f = Math.abs(e.flow);
      if (f > 0.05) {
        const speed = s * (0.5 + 0.22 * Math.min(10, f));
        const period = s * 0.42;
        ctx.save();
        ctx.strokeStyle = `rgba(235,245,255,${(0.35 + 0.5 * Math.min(1, e.load)).toFixed(3)})`;
        ctx.lineWidth = Math.max(1.5, s * 0.07);
        ctx.setLineDash([s * 0.08, period - s * 0.08]);
        ctx.lineDashOffset = -((G.time * speed) % period);
        ctx.beginPath();
        const fwd = e.flow > 0;
        const a = fwd ? e.a : e.b, b = fwd ? e.b : e.a;
        if (isLink) {
          const x1 = sx(tx(a) + 0.5), y1 = sy(ty(a) + 0.5), x2 = sx(tx(b) + 0.5), y2 = sy(ty(b) + 0.5);
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1;
          const sign = fwd ? 1 : -1;
          ctx.moveTo(x1, y1);
          ctx.quadraticCurveTo(mx - dy * 0.22 * sign, my + dx * 0.22 * sign, x2, y2);
        } else {
          ctx.moveTo(sx(tx(a) + 0.5), sy(ty(a) + 0.5));
          ctx.lineTo(sx(tx(b) + 0.5), sy(ty(b) + 0.5));
        }
        ctx.stroke();
        ctx.restore();
      }
    }
    // joints
    const seen = new Set();
    for (const e of edges) {
      for (const n of [e.a, e.b]) {
        if (seen.has(n) || G.occ[n]) continue;
        seen.add(n);
        const deg = G.adj[n].size;
        let worst = 0, lvl = 1;
        for (const x of G.adj[n].values()) { worst = Math.max(worst, x.load); lvl = Math.max(lvl, x.kind === 'link' ? 2 : x.lvl); }
        const cx = sx(tx(n) + 0.5), cy = sy(ty(n) + 0.5);
        ctx.fillStyle = rgba(loadRgb(worst), 1);
        const r = s * (deg >= 3 ? 0.13 + 0.03 * lvl : 0.06 + 0.035 * lvl);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
        if (G.guard[n]) drawGuard(cx, cy);
      }
    }
    for (const t of G.trips) {
      for (const n of [t.e.a, t.e.b]) if (G.guard[n] && !seen.has(n)) { seen.add(n); drawGuard(sx(tx(n) + 0.5), sy(ty(n) + 0.5)); }
    }
  }

  function drawGuard(cx, cy) {
    const s = cam.s, r = s * 0.3;
    ctx.fillStyle = 'rgba(47,224,192,0.22)';
    ctx.strokeStyle = '#2fe0c0';
    ctx.lineWidth = Math.max(1.5, s * 0.06);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.85, cy - r * 0.6);
    ctx.lineTo(cx + r * 0.85, cy + r * 0.05);
    ctx.quadraticCurveTo(cx + r * 0.7, cy + r * 0.8, cx, cy + r);
    ctx.quadraticCurveTo(cx - r * 0.7, cy + r * 0.8, cx - r * 0.85, cy + r * 0.05);
    ctx.lineTo(cx - r * 0.85, cy - r * 0.6);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
  }

  function drawTrips() {
    const s = cam.s;
    for (const t of G.trips) {
      const a = t.e.a, b = t.e.b;
      const x1 = sx(tx(a) + 0.5), y1 = sy(ty(a) + 0.5), x2 = sx(tx(b) + 0.5), y2 = sy(ty(b) + 0.5);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
      // dashed ghost of the missing cable, with a flashing bolt in the gap
      ctx.save();
      ctx.strokeStyle = `rgba(255,106,77,${(0.35 + 0.3 * pulse).toFixed(3)})`;
      ctx.lineWidth = s * 0.22;
      ctx.setLineDash([s * 0.14, s * 0.16]);
      ctx.beginPath();
      if (t.e.kind === 'link') linkPath(t.e); else { ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); }
      ctx.stroke();
      ctx.setLineDash([]);
      // the ring empties as the breaker counts down to resetting itself
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = Math.max(1.5, s * 0.05);
      ctx.beginPath(); ctx.arc(mx, my, s * 0.36, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (t.left / TRIP_RESET)); ctx.stroke();
      ctx.fillStyle = `rgba(255,106,77,${(0.8 + 0.2 * pulse).toFixed(3)})`;
      ctx.beginPath(); ctx.arc(mx, my, s * (0.28 + 0.04 * pulse), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      const r = s * 0.19;
      ctx.beginPath();
      ctx.moveTo(mx + r * 0.25, my - r); ctx.lineTo(mx - r * 0.6, my + r * 0.1); ctx.lineTo(mx - r * 0.05, my + r * 0.1);
      ctx.lineTo(mx - r * 0.25, my + r); ctx.lineTo(mx + r * 0.6, my - r * 0.1); ctx.lineTo(mx + r * 0.05, my - r * 0.1);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  function drawGen(g) {
    const s = cam.s;
    const k = popScale(g.born);
    if (k <= 0) return;
    const cx = sx(tx(g.i) + 0.5), cy = sy(ty(g.i) + 0.5);
    const w = s * 0.86 * k;
    const wired = G.adj[g.i].size > 0;
    const active = g.type === 'battery' ? Math.abs(g.rate) > 0.05 || g.soc > 1 : g.out > 0.05 || (g.type === 'coal' && wired);
    const bodies = { coal: '#2a2f3c', solar: '#122a4d', wind: '#163634', battery: '#14302b' };
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    rr(cx - w / 2 + s * 0.05, cy - w / 2 + s * 0.08, w, w, s * 0.18);
    ctx.fill();
    ctx.fillStyle = bodies[g.type];
    rr(cx - w / 2, cy - w / 2, w, w, s * 0.18);
    ctx.fill();
    ctx.strokeStyle = active ? 'rgba(220,235,255,0.75)' : 'rgba(220,235,255,0.25)';
    ctx.lineWidth = Math.max(1, s * 0.04);
    ctx.stroke();
    const u = w / 2;
    if (g.type === 'coal') {
      ctx.fillStyle = '#56658a';
      ctx.fillRect(cx - u * 0.7, cy - u * 0.05, u * 1.4, u * 0.7);
      ctx.fillRect(cx + u * 0.15, cy - u * 0.7, u * 0.35, u * 0.7);
      ctx.fillStyle = active ? PAL.lit : '#34405a';
      ctx.fillRect(cx - u * 0.5, cy + u * 0.15, u * 0.25, u * 0.25);
      ctx.fillRect(cx - u * 0.1, cy + u * 0.15, u * 0.25, u * 0.25);
      if (active) {
        for (let n = 0; n < 3; n++) {
          const p = ((G.time * 0.5 + n / 3) % 1);
          ctx.fillStyle = `rgba(150,160,180,${(0.5 * (1 - p)).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(cx + u * 0.32 + p * u * 0.4, cy - u * 0.8 - p * u * 0.6, u * (0.12 + p * 0.2), 0, Math.PI * 2); ctx.fill();
        }
      }
    } else if (g.type === 'solar') {
      const b = sun();
      ctx.fillStyle = b > 0 ? `rgb(${Math.round(40 + 40 * b)},${Math.round(100 + 80 * b)},${Math.round(180 + 60 * b)})` : '#1a2a44';
      for (let r = 0; r < 2; r++) for (let q = 0; q < 2; q++) ctx.fillRect(cx - u * 0.68 + q * u * 0.7, cy - u * 0.55 + r * u * 0.6, u * 0.62, u * 0.52);
    } else if (g.type === 'wind') {
      ctx.strokeStyle = '#c9d6ee';
      ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + u * 0.8); ctx.stroke();
      ctx.lineWidth = Math.max(1.5, s * 0.07);
      for (let n = 0; n < 3; n++) {
        const a = g.ang + (n * Math.PI * 2) / 3;
        ctx.beginPath(); ctx.moveTo(cx, cy - u * 0.1); ctx.lineTo(cx + Math.cos(a) * u * 0.72, cy - u * 0.1 + Math.sin(a) * u * 0.72); ctx.stroke();
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx, cy - u * 0.1, u * 0.1, 0, Math.PI * 2); ctx.fill();
    } else {
      const frac = g.soc / GEN.battery.store;
      ctx.strokeStyle = '#2fe0c0';
      ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.strokeRect(cx - u * 0.6, cy - u * 0.4, u * 1.1, u * 0.8);
      ctx.fillStyle = '#2fe0c0';
      ctx.fillRect(cx + u * 0.5, cy - u * 0.15, u * 0.15, u * 0.3);
      ctx.fillRect(cx - u * 0.5, cy - u * 0.3, u * 0.9 * frac, u * 0.6);
      if (Math.abs(g.rate) > 0.05) {
        ctx.fillStyle = '#fff';
        const up = g.rate < 0;
        const ay = cy + (up ? -1 : 1) * Math.sin(G.time * 5) * u * 0.05;
        ctx.beginPath();
        ctx.moveTo(cx - u * 0.05, ay + (up ? -u * 0.2 : u * 0.2));
        ctx.lineTo(cx - u * 0.25, ay + (up ? u * 0.1 : -u * 0.1));
        ctx.lineTo(cx + u * 0.15, ay + (up ? u * 0.1 : -u * 0.1));
        ctx.closePath(); ctx.fill();
      }
    }
    // output bar
    const frac = g.type === 'battery' ? Math.abs(g.rate) / GEN.battery.max : g.out / genMax(g);
    const bw = w * 0.8, by = cy + w / 2 + s * 0.06;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(cx - bw / 2, by, bw, Math.max(2, s * 0.07));
    ctx.fillStyle = g.type === 'battery' && g.rate < 0 ? '#2fe0c0' : PAL.lit;
    ctx.fillRect(cx - bw / 2, by, bw * clamp(frac, 0, 1), Math.max(2, s * 0.07));
    if (!wired) {
      const pulse = 0.5 + 0.5 * Math.sin(G.time * 4 + g.id);
      ctx.strokeStyle = `rgba(220,235,255,${(0.2 + 0.35 * pulse).toFixed(3)})`;
      ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.62, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // A town is a block of windows. As it loses power its lights go out a few
  // at a time, in a scattered order, until the whole block is dark.
  function drawTown(t) {
    const s = cam.s;
    const k = popScale(t.born);
    if (k <= 0) return;
    const cx = sx(tx(t.i) + 0.5), cy = sy(ty(t.i) + 0.5);
    const base = townBase(t);
    const n = base < 3 ? 2 : base < 4.5 ? 3 : 4;
    const w = s * (1.1 + 0.08 * n) * k;
    const graced = G.time - t.born < GRACE;
    const short = t.served < 0.995 && !graced;
    if (t.dark > 0.01) {
      const pulse = 0.5 + 0.5 * Math.sin(G.time * (3 + 8 * t.dark));
      ctx.strokeStyle = rgba(HOT, 0.25 + 0.3 * pulse * (short ? 1 : 0.3));
      ctx.lineWidth = s * 0.1;
      ctx.beginPath(); ctx.arc(cx, cy, w * 0.82, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = PAL.hot;
      ctx.lineWidth = s * 0.12;
      ctx.beginPath(); ctx.arc(cx, cy, w * 0.82, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t.dark); ctx.stroke();
    } else if (graced && t.grid < 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(220,235,255,0.55)';
      ctx.lineWidth = Math.max(1.5, s * 0.06);
      ctx.setLineDash([s * 0.2, s * 0.16]);
      ctx.lineDashOffset = -G.time * s * 0.5;
      ctx.beginPath(); ctx.arc(cx, cy, w * 0.8, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (t.lit > 0.05) {
      const glow = ctx.createRadialGradient(cx, cy, w * 0.2, cx, cy, w * 1.1);
      glow.addColorStop(0, `rgba(255,200,90,${(0.22 * t.lit).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(255,200,90,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(cx - w * 1.1, cy - w * 1.1, w * 2.2, w * 2.2);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    rr(cx - w / 2 + s * 0.06, cy - w / 2 + s * 0.1, w, w, s * 0.16);
    ctx.fill();
    ctx.fillStyle = '#273250';
    rr(cx - w / 2, cy - w / 2, w, w, s * 0.16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(220,235,255,0.35)';
    ctx.lineWidth = Math.max(1, s * 0.03);
    ctx.stroke();
    const total = n * n;
    const on = Math.round(t.lit * total);
    const pad = w * 0.14, cell = (w - pad * 2) / n, win = cell * 0.62;
    for (let q = 0; q < total; q++) {
      const order = (q * 7 + t.id * 3) % total; // scattered: windows go dark in a mixed-up order
      const r = Math.floor(q / n), c = q % n;
      const x = cx - w / 2 + pad + c * cell + (cell - win) / 2;
      const y = cy - w / 2 + pad + r * cell + (cell - win) / 2;
      const lit = order < on;
      const flicker = lit && short && Math.sin(G.time * 13 + q * 2.1) > 0.92;
      ctx.fillStyle = lit && !flicker ? PAL.lit : PAL.unlit;
      ctx.fillRect(x, y, win, win);
    }
  }

  // Overnight the board dims; in the evening peak it warms up slightly.
  function drawNight() {
    const p = dayPhase();
    const night = Math.min(1, Math.max(0, -Math.sin(2 * Math.PI * (p - 0.25)) * 1.5));
    const dusk = Math.min(1, Math.max(0, 1 - Math.abs(p - 0.78) / 0.1));
    const dark = night * 0.38, warm = dusk * 0.07;
    if (dark <= 0 && warm <= 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = dark > 0 ? `rgba(2,4,16,${dark.toFixed(3)})` : `rgba(255,170,60,${warm.toFixed(3)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  // ---------------------------------------------------------------- HUD + screens
  const el = {
    top: $('#top'), bottom: $('#bottom'), score: $('#score'), scoreSub: $('#scoreSub'), weekLabel: $('#weekLabel'), weekBar: $('#weekBar'),
    gauge: $('#gauge'), gDel: $('#gDel'), gDem: $('#gDem'), gFill: $('#gFill'), gSpare: $('#gSpare'),
    cCable: $('#cCable'), cSea: $('#cSea'), cUnder: $('#cUnder'), underTool: $('#underTool'), seaTool: $('#seaTool'),
    btnFit: $('#btnFit'), btnUndo: $('#btnUndo'), btnPause: $('#btnPause'), btnSpeed: $('#btnSpeed'), toast: $('#toast'),
  };
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';

  let hudCache = '';
  function updateHud() {
    if (!G) return;
    const zoomed = user.zoom > 1.02;
    el.weekBar.style.width = ((G.dayT / DAY_LEN) * 100).toFixed(1) + '%';
    const ratio = G.demand > 0 ? G.delivered / G.demand : 1;
    el.gFill.style.width = (clamp(ratio, 0, 1) * 100).toFixed(1) + '%';
    el.gSpare.style.left = (clamp(G.demand > 0 ? G.supply / G.demand : 1, 0, 1.5) / 1.5 * 100).toFixed(1) + '%';
    const key = [Math.floor(G.score), G.day, dayLabel(), JSON.stringify(G.res), Object.keys(G.owned).join(), G.targetHit, zoomed,
      undoStack.length, !!(pendingSnap && pendingSnap.uver !== G.uver), G.map.id, G.paused, G.speed, tool,
      Math.round(G.delivered), Math.round(G.demand), Math.round(ratio * 50)].join('|');
    if (key === hudCache) return;
    hudCache = key;
    el.score.textContent = fmt(G.score);
    el.scoreSub.innerHTML = G.targetHit ? 'MWh' : `/ ${fmt(G.map.target)}<span class="unit"> MWh</span>`;
    el.gDel.textContent = Math.round(G.delivered);
    el.gDem.textContent = `/ ${Math.round(G.demand)} MW`;
    el.gauge.classList.toggle('short', ratio < 0.995 && ratio >= 0.85);
    el.gauge.classList.toggle('dark', ratio < 0.85);
    el.btnFit.hidden = !zoomed;
    el.btnUndo.hidden = !undoStack.length && !(pendingSnap && pendingSnap.uver !== G.uver);
    el.weekLabel.innerHTML = `Day ${G.day}<span class="tod"> · ${dayLabel()}</span>`;
    el.weekLabel.parentElement.setAttribute('aria-label', `Day ${G.day}, ${dayLabel()}`);
    el.cCable.textContent = G.res.cable;
    el.cCable.classList.toggle('zero', G.res.cable === 0);
    let shown = 2;
    document.querySelectorAll('.tool[data-res]').forEach((b) => {
      const k = b.dataset.res;
      const n = G.res[k];
      const count = b.querySelector('.count');
      count.textContent = n;
      count.classList.toggle('zero', n === 0);
      b.hidden = !(G.owned[k] || n > 0);
      if (!b.hidden) shown++;
    });
    el.cSea.textContent = G.res.sea;
    el.cSea.classList.toggle('zero', G.res.sea === 0);
    el.cUnder.textContent = G.res.under;
    el.cUnder.classList.toggle('zero', G.res.under === 0);
    el.seaTool.hidden = !G.water.some((v) => v);
    el.underTool.hidden = !G.map.hills;
    if (!el.seaTool.hidden) shown++;
    if (!el.underTool.hidden) shown++;
    const bar = el.bottom.querySelector('.toolbar');
    const wasCompact = bar.classList.contains('six');
    bar.classList.toggle('six', shown > 5);
    if (wasCompact !== shown > 5 || bar.dataset.shown !== String(shown)) { bar.dataset.shown = shown; measure(); }
    scrollHint();
    el.btnPause.innerHTML = G.paused ? ICON_PLAY : ICON_PAUSE;
    el.btnPause.setAttribute('aria-label', G.paused ? 'Play' : 'Pause');
    el.btnSpeed.textContent = G.speed === 1 ? '1×' : '2×';
    document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
  }

  // Fade the toolbar's edge when there are more tools to scroll to.
  function scrollHint() {
    const bar = el.bottom.querySelector('.toolbar');
    const sideways = getComputedStyle(bar).flexDirection === 'row';
    bar.classList.toggle('more-start', sideways && bar.scrollLeft > 2);
    bar.classList.toggle('more-end', sideways && bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 2);
  }
  el.bottom.querySelector('.toolbar').addEventListener('scroll', scrollHint, { passive: true });

  let toastTimer = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600);
  }
  function flashCount(which) {
    const target = which === 'sea' ? el.seaTool : which === 'under' ? el.underTool : document.querySelector('.tool[data-tool="cable"]');
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
  }

  function setTool(t) {
    tool = t;
    linkStart = -1;
    hudCache = '';
  }

  document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.info === 'sea') { toast('Sea cables are used automatically. Draw a cable across water.'); return; }
    if (b.dataset.info === 'under') { toast('Underground cables are used automatically. Draw a cable through a hill.'); return; }
    const t = b.dataset.tool;
    const k = b.dataset.res;
    if (k && G.res[k] <= 0) {
      const names = { coal: 'coal plants', solar: 'solar farms', wind: 'wind farms', battery: 'batteries', link: 'interconnectors', guard: 'surge guards' };
      toast(`No ${names[k]} left. More arrive each day.`);
      return;
    }
    setTool(t);
    const hints = {
      cable: 'Drag to lay cable. Drag along a cable again to add a strand.',
      erase: 'Drag over cables to remove them. Tap a power station to pick it back up.',
      coal: `Tap open land to build a coal plant. It has to be more than ${COAL_CLEAR} tiles from a town.`,
      solar: 'Tap open land to build a solar farm.',
      wind: 'Tap open land to build a wind farm. Next to water, it makes more.',
      battery: 'Tap open land to build a battery, then cable it to a grid.',
      link: 'Tap where the interconnector starts.',
      guard: 'Tap a cable joint to protect it.',
    };
    if (hints[t]) toast(hints[t]);
  }));

  el.btnPause.addEventListener('click', () => { if (!G) return; G.paused = !G.paused; hudCache = ''; if (G.paused) toast('Paused. You can still build.'); });
  el.btnSpeed.addEventListener('click', () => { if (!G) return; G.speed = G.speed === 1 ? 2 : 1; hudCache = ''; });
  $('#btnMenu').addEventListener('click', () => { if (!G) return; save(); openScreen('sMenu'); });
  $('#btnResume').addEventListener('click', () => closeScreen());
  $('#btnRestart').addEventListener('click', () => { closeScreen(); startNew(G.map); });
  $('#btnMenuMaps').addEventListener('click', () => { save(); showMaps('sMenu'); });
  el.btnFit.addEventListener('click', () => { user.zoom = 1; user.px = 0; user.py = 0; hudCache = ''; });
  el.btnUndo.addEventListener('click', () => { if (G) undo(); });
  el.gauge.addEventListener('click', () => {
    if (!G) return;
    const spare = G.supply - G.demand;
    toast(`Towns need ${mw(G.demand)} MW and are getting ${mw(G.delivered)} MW. ` +
      (G.delivered < G.demand - 0.05
        ? (spare > 0 ? 'There is enough power, but not where it’s needed. Join your grids, or connect the dark towns.' : 'Build more power stations, or store power in batteries.')
        : `Spare: ${mw(Math.max(0, spare))} MW.`));
  });
  $('#btnTgStay').addEventListener('click', () => closeScreen());
  $('#btnMapsBack').addEventListener('click', () => openScreen(mapsReturn || 'sTitle'));
  $('#btnOverMaps').addEventListener('click', () => showMaps('sOver'));
  $('#btnHowMenu').addEventListener('click', () => openScreen('sHelp', 'sMenu'));
  $('#btnHowTitle').addEventListener('click', () => openScreen('sHelp', 'sTitle'));
  $('#btnHelpDone').addEventListener('click', () => {
    try { localStorage.setItem(SEEN_HELP_KEY, '1'); } catch (e) { /* storage unavailable */ }
    if (helpReturn) openScreen(helpReturn); else closeScreen();
  });
  // First time through there's only one map, so skip the chooser and go straight in.
  $('#btnNew').addEventListener('click', () => { if (getProgress().unlocked <= 1) { closeScreen(); startNew(MAPS[0]); } else showMaps('sTitle'); });
  $('#btnContinue').addEventListener('click', () => { if (load()) { tut = null; inspect = null; coach(null); closeScreen(); showHud(true); } else showMaps('sTitle'); });
  $('#btnAgain').addEventListener('click', () => { closeScreen(); startNew(G.map); });

  let mapsReturn = null;
  function showMaps(returnTo) {
    mapsReturn = returnTo;
    const p = getProgress();
    const list = $('#mapList');
    list.innerHTML = '';
    MAPS.forEach((m, i) => {
      const locked = i >= p.unlocked;
      const best = p.best[m.id] || 0;
      const btn = document.createElement('button');
      btn.className = 'mapcard';
      btn.disabled = locked;
      const status = locked
        ? `Deliver ${fmt(MAPS[i - 1].target)} MWh in ${MAPS[i - 1].name} to unlock`
        : `Target ${fmt(m.target)} MWh${best ? ` · Best ${fmt(best)}` : ''}`;
      btn.innerHTML = `<span class="mapnum">${locked ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>' : i + 1}</span>`
        + `<span class="maptext"><b>${m.name}</b><small>${m.blurb}</small><em>${status}</em></span>`;
      if (!locked) btn.addEventListener('click', () => { closeScreen(); startNew(m); });
      list.appendChild(btn);
    });
    openScreen('sMaps');
  }

  let helpReturn = null;
  function openScreen(id, returnTo) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('show'));
    $('#' + id).classList.add('show');
    modal = id;
    helpReturn = id === 'sHelp' ? (returnTo || null) : helpReturn;
    if (id === 'sTitle' || id === 'sMenu') refreshOffline();
    pointers.clear(); action = null; pinch = null; gestureLock = false;
  }
  function closeScreen() {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('show'));
    modal = null;
    if (pendingMech) { const m = pendingMech; pendingMech = null; mechTip(m.id, m.text); }
  }
  function showHud(on) {
    el.top.hidden = !on;
    el.bottom.hidden = !on;
    measure();
    camSnap = true;
  }

  function startNew(map) {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage unavailable */ }
    showHud(true);
    newGame(map || MAPS[0]);
    save();
    inspect = null;
    coach(null);
    if (startTutorial()) return;
    let seen = false;
    try { seen = !!localStorage.getItem(SEEN_HELP_KEY); } catch (e) { /* storage unavailable */ }
    if (!seen) openScreen('sHelp');
  }

  function showTitle() {
    let hasSave = false;
    try { hasSave = !!localStorage.getItem(SAVE_KEY); } catch (e) { /* storage unavailable */ }
    $('#btnContinue').hidden = !hasSave;
    $('#btnNew').className = hasSave ? 'btn secondary' : 'btn';
    $('#btnNew').textContent = hasSave ? 'New game' : 'Play';
    const p = getProgress();
    setProgress(p);
    $('#bestLine').textContent = `${Math.min(p.unlocked, MAPS.length)} of ${MAPS.length} maps unlocked`;
    openScreen('sTitle');
  }

  // ---------------------------------------------------------------- offline status
  let offlineReady = false;
  function setOffline(state, text) {
    for (const id of ['#offline', '#offline2']) {
      const box = $(id);
      box.classList.toggle('ready', state === 'ready');
      box.querySelector('span').textContent = text;
    }
  }
  async function refreshOffline() {
    if (!('serviceWorker' in navigator) || !window.caches) {
      setOffline('no', 'Offline play needs Safari and a secure (https) address.');
      return;
    }
    try {
      offlineReady = false;
      for (const name of await caches.keys()) {
        if (!name.startsWith(CACHE_PREFIX)) continue;
        const keys = await (await caches.open(name)).keys();
        if (keys.length >= OFFLINE_ASSETS) offlineReady = true;
      }
      if (offlineReady) setOffline('ready', 'Saved for offline play');
      else setOffline('wait', 'Saving for offline play…');
    } catch (e) {
      setOffline('no', 'Offline play isn’t available here.');
    }
  }
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then(() => {
        let tries = 0;
        const poll = () => { refreshOffline(); if (!offlineReady && tries++ < 20) setTimeout(poll, 700); };
        poll();
      }).catch(() => setOffline('no', 'Offline play couldn’t be set up.'));
    });
  }

  // ---------------------------------------------------------------- coach card
  // One small card under the top bar, used by the first-game tips and by the
  // "what's on this town's grid" view.
  let coachCb = null;
  function coach(text, btnLabel, onBtn, showSkip) {
    $('#coachText').textContent = text || '';
    const b = $('#coachBtn');
    b.hidden = !btnLabel;
    b.textContent = btnLabel || '';
    $('#coachSkip').hidden = !showSkip;
    coachCb = onBtn || null;
    $('#coach').hidden = !text;
    document.body.classList.toggle('coaching', !!text);
    measure();
  }
  $('#coachBtn').addEventListener('click', () => { const cb = coachCb; coachCb = null; if (cb) cb(); });
  $('#coachSkip').addEventListener('click', () => endTutorial());

  // ---------------------------------------------------------------- trouble off screen
  // When you're zoomed in, a town losing power out of view gets an arrow at
  // the edge of the screen, pulsing in time with the warning sound. Tap it to look.
  const urgencyOf = (t) => (t.served < 0.995 && t.dark > 0.02 && G.time - t.born >= GRACE ? clamp(0.25 + 0.75 * t.dark, 0, 1) : 0);
  const pulsePeriod = (u) => 1.4 - 0.95 * u;
  let edgeArrows = [];
  function drawEdgeArrows() {
    edgeArrows = [];
    if (!G || G.over || inspect) return;
    const pad = 28;
    const L = pad, R = view.w - view.right - pad, T = view.top + pad, Bt = view.h - view.bottom - pad;
    const cx0 = (L + R) / 2, cy0 = (T + Bt) / 2;
    for (const t of G.towns) {
      const u = urgencyOf(t);
      if (u <= 0) continue;
      const px = sx(tx(t.i) + 0.5), py = sy(ty(t.i) + 0.5);
      if (px > L - pad && px < R + pad && py > T - pad && py < Bt + pad) continue;
      const dx = px - cx0, dy = py - cy0;
      const kx = dx > 0 ? (R - cx0) / dx : dx < 0 ? (L - cx0) / dx : Infinity;
      const ky = dy > 0 ? (Bt - cy0) / dy : dy < 0 ? (T - cy0) / dy : Infinity;
      const k = Math.min(kx, ky);
      const ax = cx0 + dx * k, ay = cy0 + dy * k;
      const phase = (G.time % pulsePeriod(u)) / pulsePeriod(u);
      ctx.save();
      ctx.translate(ax, ay);
      ctx.globalAlpha = (1 - phase) * (0.4 + 0.5 * u);
      ctx.strokeStyle = PAL.hot;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 16 + phase * 14, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = PAL.hot;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.rotate(Math.atan2(dy, dx));
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.moveTo(1, -6); ctx.lineTo(7, 0); ctx.lineTo(1, 6); ctx.stroke();
      ctx.restore();
      edgeArrows.push({ x: ax, y: ay, t });
    }
  }
  function lookAt(t) {
    const b = baseCam();
    user.px = tx(t.i) + 0.5 - b.x;
    user.py = ty(t.i) + 0.5 - b.y;
    hudCache = '';
  }

  // ---------------------------------------------------------------- what's on this town's grid
  // Tap a town: the game pauses, everything else fades, and its grid lights up.
  let inspect = null;
  function openInspect(t) {
    solveFlow();
    G.fver = G.gver;
    const c = t.grid >= 0 ? G.comps[t.grid] : null;
    inspect = { t, c, wasPaused: G.paused };
    G.paused = true;
    hudCache = '';
    const pct = Math.round(t.served * 100);
    let text = `This town needs ${mw(t.need)} MW and is getting ${mw(t.draw)} MW (${pct}%). `;
    if (!c) text += 'It has no cable yet. Connect it to a power station.';
    else {
      const stations = c.gens.filter((g) => g.type !== 'battery').length;
      text += `Its grid has ${stations} power ${stations === 1 ? 'station' : 'stations'} able to make ${mw(c.avail)} MW` +
        `${c.gens.some((g) => g.type === 'battery') ? `, plus batteries,` : ''} for ${c.towns.length} ${c.towns.length === 1 ? 'town' : 'towns'} needing ${mw(c.demand)} MW. `;
      const hot = [...G.edges.values()].filter((e) => G.comp[e.a] === c.id && e.load > 0.9).length;
      if (!c.gens.length) text += 'Nothing on this grid makes power. Connect a power station to it.';
      else if (c.served < 0.995) {
        const off = c.gens.filter((g) => g.type !== 'battery' && g.type !== 'coal' && avail(g) < 0.1).length;
        text += off ? `${off} of its solar or wind ${off === 1 ? 'farm is' : 'farms are'} making nothing right now. Add coal or a battery, or join this grid to another.` : 'It’s short. Add a power station, or join this grid to another one.';
      } else if (hot) text += `${hot} ${hot === 1 ? 'cable is' : 'cables are'} close to tripping. Add a strand, or another route.`;
      else text += 'It’s coping fine.';
    }
    coach(text, 'Carry on', closeInspect);
    if (tut && tut.cur && tut.cur.id === 'inspect') tut.inspected = true;
  }
  function closeInspect() {
    if (!inspect) return;
    G.paused = inspect.wasPaused;
    inspect = null;
    hudCache = '';
    if (tut && tut.cur) showTipCard(tut.cur); else coach(null);
  }
  function drawInspect() {
    if (!inspect) return;
    const { t, c } = inspect;
    ctx.fillStyle = 'rgba(8,10,18,0.6)';
    ctx.fillRect(0, 0, view.w, view.h);
    if (c) {
      const s = cam.s;
      ctx.lineCap = 'round';
      for (const e of G.edges.values()) {
        if (G.comp[e.a] !== c.id) continue;
        ctx.strokeStyle = rgba(loadRgb(e.load), 1);
        ctx.lineWidth = s * (0.12 + 0.07 * e.lvl);
        ctx.beginPath(); if (e.kind === 'link') linkPath(e); else seg(e); ctx.stroke();
      }
      for (const g of c.gens) drawGen(g);
      for (const x of c.towns) drawTown(x);
    } else drawTown(t);
  }

  // ---------------------------------------------------------------- first game tips
  // The first time you play Ampton, tips appear one at a time as each idea
  // comes up, instead of everything at once before you've played.
  let tut = null;
  const hottest = () => [...G.edges.values()].reduce((a, e) => (!a || e.load > a.load ? e : a), null);
  const TIPS = [
    {
      id: 'place', pause: true,
      text: `This town needs power. Tap Coal in the toolbar, then tap open land to build a coal plant. Coal plants have to be more than ${COAL_CLEAR} tiles from a town.`,
      ready: () => G.time > 0.3 || G.paused,
      until: () => G.gens.length > 0,
      hl: () => G.towns.slice(0, 1).map((t) => ({ x: tx(t.i) + 0.5, y: ty(t.i) + 0.5, r: 1 })),
    },
    {
      id: 'wire', pause: true,
      text: 'Now drag a cable from the coal plant to the town.',
      ready: (done) => done.has('place'),
      until: () => G.towns.some((t) => t.served > 0),
      hl: () => G.gens.slice(0, 1).map((g) => ({ x: tx(g.i) + 0.5, y: ty(g.i) + 0.5, r: 0.7 })),
    },
    {
      id: 'flow', btn: 'Got it',
      text: `The lights are on. Power spreads through every cable it can reach, all at once. One strand of cable carries ${STRAND_CAP} MW. Draw along a cable again to add a strand, up to ${MAX_STRANDS}.`,
      ready: (done) => done.has('wire'),
    },
    {
      id: 'hot', pause: true, btn: 'Got it',
      text: 'This cable is near its limit. If it stays red, its breaker trips and its power moves onto the other cables, which can trip too. Add a strand, or give the power another route.',
      ready: (done) => done.has('flow') && [...G.edges.values()].some((e) => e.load > 0.85),
      hl: () => { const e = hottest(); return e ? [{ x: (tx(e.a) + tx(e.b)) / 2 + 0.5, y: (ty(e.a) + ty(e.b)) / 2 + 0.5, r: 0.8 }] : []; },
    },
    {
      id: 'gauge', btn: 'Got it',
      text: 'The gauge at the top shows power reaching towns against what they need. When a grid is short, every town on it dims and a timer starts. If a town goes fully dark, the game ends.',
      ready: (done) => done.has('flow') && G.time > 20 && G.delivered < G.demand * 0.98,
    },
    {
      id: 'inspect', pause: true,
      text: 'Tap a town to see its grid and what it needs.',
      ready: (done) => done.has('gauge') && G.towns.some((t) => t.served < 0.995 && G.time - t.born > GRACE),
      until: () => tut.inspected && !inspect,
      hl: () => G.towns.filter((t) => t.served < 0.995).slice(0, 1).map((t) => ({ x: tx(t.i) + 0.5, y: ty(t.i) + 0.5, r: 1.2 })),
    },
    {
      id: 'end', btn: 'Play on',
      get text() { return `Deliver ${fmt(G.map.target)} MWh to unlock the next map. New power stations and cable arrive each day. The tips are under How to play in the menu.`; },
      ready: (done) => done.has('flow') && ((done.has('hot') && done.has('gauge')) || G.day >= 4),
    },
  ];
  // One-off cards the first time each new mechanic shows up, on any map.
  let mechCur = null;
  let pendingMech = null;
  let mechSeen = {};
  try { mechSeen = JSON.parse(localStorage.getItem(MECH_KEY) || '{}'); } catch (e) { /* storage unavailable */ }
  function mechTip(id, text, afterModal) {
    if (mechSeen[id] || mechCur || G.demo) return false;
    if (afterModal && modal) { if (!pendingMech) pendingMech = { id, text }; return false; }
    if (inspect || modal || (tut && (tut.cur || !tut.done.has('flow')))) return false;
    mechSeen[id] = 1;
    try { localStorage.setItem(MECH_KEY, JSON.stringify(mechSeen)); } catch (e) { /* storage unavailable */ }
    mechCur = id;
    G.paused = true;
    hudCache = '';
    coach(text, 'Got it', () => { mechCur = null; G.paused = false; hudCache = ''; coach(null); });
    return true;
  }
  function startTutorial() {
    let finished = false;
    try { finished = !!localStorage.getItem(TUT_KEY); } catch (e) { /* storage unavailable */ }
    tut = finished || G.map.id !== MAPS[0].id ? null : { done: new Set(), cur: null, inspected: false };
    return !!tut;
  }
  function showTipCard(t) { coach(t.text, t.btn, finishTip, true); }
  function showTip(t) {
    tut.cur = t;
    if (t.pause) { G.paused = true; hudCache = ''; }
    showTipCard(t);
  }
  function finishTip() {
    if (!tut || !tut.cur) return;
    const t = tut.cur;
    tut.done.add(t.id);
    tut.cur = null;
    if (t.pause) { G.paused = false; hudCache = ''; }
    coach(null);
    if (t.id === 'end') endTutorial();
  }
  function endTutorial() {
    if (tut && tut.cur && tut.cur.pause) { G.paused = false; hudCache = ''; }
    tut = null;
    try { localStorage.setItem(TUT_KEY, '1'); localStorage.setItem(SEEN_HELP_KEY, '1'); } catch (e) { /* storage unavailable */ }
    if (!inspect) coach(null);
  }
  function tutTick() {
    if (!tut || !G || G.demo || G.over || modal || inspect) return;
    if (tut.cur) {
      if (tut.cur.until && tut.cur.until()) finishTip();
      return;
    }
    const next = TIPS.find((t) => !tut.done.has(t.id) && t.ready(tut.done));
    if (next) showTip(next);
  }
  function drawTipHighlights() {
    if (!tut || !tut.cur || !tut.cur.hl || inspect || modal) return;
    const s = cam.s;
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 220);
    ctx.strokeStyle = '#e6eefc';
    ctx.lineWidth = Math.max(2, s * 0.08);
    for (const p of tut.cur.hl()) {
      ctx.globalAlpha = 0.35 + 0.45 * pulse;
      ctx.beginPath(); ctx.arc(sx(p.x), sy(p.y), s * (p.r + 0.12 * pulse), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- lifecycle
  function measure() {
    view.dpr = Math.min(3, window.devicePixelRatio || 1);
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.round(view.w * view.dpr);
    canvas.height = Math.round(view.h * view.dpr);
    view.top = el.top.hidden ? 0 : el.top.getBoundingClientRect().bottom;
    // keep the map clear of the tip card while it's showing
    const card = $('#coach');
    if (!card.hidden) view.top = Math.max(view.top, card.getBoundingClientRect().bottom + 6);
    view.bottom = 0;
    view.right = 0;
    if (!el.bottom.hidden) {
      const bar = el.bottom.querySelector('.toolbar').getBoundingClientRect();
      const sideways = getComputedStyle(el.bottom).flexDirection === 'column';
      if (sideways) view.right = view.w - bar.left + 6;
      else view.bottom = view.h - bar.top + 6;
    }
  }
  window.addEventListener('resize', () => { measure(); camSnap = true; });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G && !G.over) {
      save();
      if (!modal) { G.paused = true; hudCache = ''; }
    }
  });
  window.addEventListener('pagehide', () => save());

  // ---------------------------------------------------------------- sound
  // Lo-fi music made live in the browser, so there are no audio files to
  // download and it works offline: a slow four-chord loop, a soft beat and
  // gentle rain. When a town is losing power, a low pulse fades in from its
  // side of the screen and speeds up as its timer runs down.
  const SOUND_KEY = 'livewire-sound';
  let soundOn = true;
  try { soundOn = localStorage.getItem(SOUND_KEY) !== '0'; } catch (e) { /* storage unavailable */ }
  const BEAT = 60 / 72;
  // Fmaj7, Em7, Dm7, Cmaj7 as MIDI note numbers
  const CHORDS = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  const snd = { ctx: null, master: null, music: null, melody: null, tone: null, noise: null, next: 0, step: 0, pulseAt: 0 };

  function audioStart() {
    if (!soundOn) return;
    if (!snd.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      // "ambient" respects the silent switch and plays alongside your own music or podcasts
      try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch (e) { /* not supported */ }
      const ctx = new AC();
      snd.ctx = ctx;
      snd.master = ctx.createGain();
      snd.master.gain.value = 0;
      snd.master.connect(ctx.destination);
      // the music runs through a warm low-pass filter, which opens up a little when things get tense
      snd.tone = ctx.createBiquadFilter();
      snd.tone.type = 'lowpass';
      snd.tone.frequency.value = 1300;
      snd.tone.Q.value = 0.4;
      snd.tone.connect(snd.master);
      snd.music = ctx.createGain();
      snd.music.connect(snd.tone);
      // melody notes also go into a soft echo
      const echo = ctx.createDelay(1);
      echo.delayTime.value = BEAT * 0.75;
      const feedbackGain = ctx.createGain();
      feedbackGain.gain.value = 0.35;
      const wet = ctx.createGain();
      wet.gain.value = 0.45;
      echo.connect(feedbackGain); feedbackGain.connect(echo); echo.connect(wet); wet.connect(snd.tone);
      snd.melody = ctx.createGain();
      snd.melody.connect(snd.music); snd.melody.connect(echo);
      // white noise for the brushes and hi-hat
      snd.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const nd = snd.noise.getChannelData(0);
      for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
      // gentle rain: soft, slowly swelling hiss with the odd quiet droplet, on a loop
      const sr = ctx.sampleRate;
      const rainBuf = ctx.createBuffer(1, sr * 7, sr);
      const rd = rainBuf.getChannelData(0);
      let soft = 0;
      for (let i = 0; i < rd.length; i++) {
        soft = soft * 0.92 + (Math.random() * 2 - 1) * 0.08;
        const swell = 0.75 + 0.25 * Math.sin((i / rd.length) * Math.PI * 2);
        rd[i] = soft * 0.5 * swell;
      }
      for (let k = 0; k < 160; k++) {
        const at = Math.floor(Math.random() * (rd.length - sr * 0.05));
        const f = 1800 + Math.random() * 2600;
        const amp = 0.02 + Math.random() * 0.05;
        const len = Math.floor(sr * (0.015 + Math.random() * 0.02));
        for (let n = 0; n < len; n++) rd[at + n] += amp * Math.exp(-n / (len * 0.25)) * Math.sin((2 * Math.PI * f * n) / sr);
      }
      const rain = ctx.createBufferSource();
      rain.buffer = rainBuf;
      rain.loop = true;
      const rainHi = ctx.createBiquadFilter();
      rainHi.type = 'highpass';
      rainHi.frequency.value = 350;
      const rainLo = ctx.createBiquadFilter();
      rainLo.type = 'lowpass';
      rainLo.frequency.value = 3200;
      const rg = ctx.createGain();
      rg.gain.value = 0.15;
      rain.connect(rainHi); rainHi.connect(rainLo); rainLo.connect(rg); rg.connect(snd.master);
      rain.start();
      snd.next = ctx.currentTime + 0.1;
    }
    if (snd.ctx.state !== 'running') snd.ctx.resume().catch(() => {});
  }

  function voice(type, freq, t, len, peak, attack, out, detune = 0) {
    const o = snd.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = snd.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(out || snd.music);
    o.start(t);
    o.stop(t + len + 0.05);
  }

  function noiseHit(t, type, freq, peak, len, out) {
    const src = snd.ctx.createBufferSource();
    src.buffer = snd.noise;
    const f = snd.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = snd.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(f); f.connect(g); g.connect(out || snd.music);
    src.start(t, Math.random() * 1.5);
    src.stop(t + len + 0.05);
  }

  function kick(t, peak, out) {
    const o = snd.ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
    const g = snd.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g); g.connect(out || snd.music);
    o.start(t);
    o.stop(t + 0.45);
  }

  // One half-beat of music. Off-beats are pushed slightly late for a lazy swing.
  function playStep(t, stepN) {
    const off = stepN % 2 === 1;
    const beat = (stepN >> 1) % 4;
    const chord = CHORDS[(stepN >> 3) % 4];
    const tt = off ? t + BEAT * 0.08 : t;
    if (!off && beat === 0) {
      for (const n of chord) {
        voice('triangle', hz(n), t, BEAT * 4.3, 0.028, 1.1, null, -6);
        voice('triangle', hz(n), t, BEAT * 4.3, 0.028, 1.1, null, 6);
      }
    }
    if (!off && (beat === 0 || beat === 2)) {
      kick(t, 0.2);
      voice('sine', hz(chord[0] - 12 + (beat === 2 ? 7 : 0)), t, BEAT * 1.7, 0.13, 0.03);
    }
    if (!off && (beat === 1 || beat === 3)) noiseHit(t, 'bandpass', 1800, 0.05, 0.2);
    if (off) noiseHit(tt, 'highpass', 6500, 0.006, 0.05, snd.master);
    if (Math.random() < 0.2) {
      const n = chord[(Math.random() * 4) | 0] + (Math.random() < 0.5 ? 12 : 24);
      voice('sine', hz(n), tt, BEAT * 1.6, 0.04, 0.02, snd.melody);
    }
  }

  // Grid sound effects: a zap when a breaker trips, a harsher one in a cascade,
  // a chime on reset, a click when building, and soft tones at dusk and dawn.
  function sfx(kind) {
    if (!soundOn || !snd.ctx || snd.ctx.state !== 'running' || !snd.master) return;
    const t = snd.ctx.currentTime + 0.02;
    const out = snd.master;
    if (kind === 'trip' || kind === 'cascade') {
      noiseHit(t, 'highpass', 2500, kind === 'cascade' ? 0.3 : 0.22, 0.18, out);
      const o = snd.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(kind === 'cascade' ? 380 : 520, t);
      o.frequency.exponentialRampToValueAtTime(kind === 'cascade' ? 40 : 70, t + 0.35);
      const g = snd.ctx.createGain();
      g.gain.setValueAtTime(kind === 'cascade' ? 0.12 : 0.09, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.45);
    } else if (kind === 'reset') {
      voice('sine', hz(60), t, 0.35, 0.09, 0.01, out);
      voice('sine', hz(67), t + 0.09, 0.5, 0.09, 0.01, out);
    } else if (kind === 'place') {
      voice('triangle', hz(57), t, 0.25, 0.08, 0.005, out);
      voice('sine', hz(69), t + 0.05, 0.3, 0.05, 0.005, out);
    } else if (kind === 'strand') {
      voice('sine', hz(76), t, 0.18, 0.05, 0.005, out);
    } else if (kind === 'dusk') {
      voice('sine', hz(72), t, 0.9, 0.06, 0.05, out);
      voice('sine', hz(65), t + 0.25, 1.2, 0.06, 0.05, out);
    } else if (kind === 'dawn') {
      voice('sine', hz(65), t, 0.9, 0.06, 0.05, out);
      voice('sine', hz(72), t + 0.25, 1.2, 0.06, 0.05, out);
    }
  }

  // A soft low thump and a chime, panned towards the town that's losing power.
  function pulse(t, u, pan) {
    let out = snd.master;
    if (snd.ctx.createStereoPanner) {
      const p = snd.ctx.createStereoPanner();
      p.pan.value = pan;
      p.connect(snd.master);
      out = p;
    }
    kick(t, 0.05 + 0.4 * u, out);
    const chord = CHORDS[(snd.step >> 3) % 4];
    voice('sine', hz(chord[0] + 24), t, 0.7, 0.03 + 0.07 * u, 0.01, out);
    if (u >= 0.4) {
      voice('sine', hz(chord[0] + 31), t + 0.09, 0.6, 0.02 + 0.06 * u, 0.01, out);
      snd.music.gain.setTargetAtTime(0.7, t, 0.03);
      snd.music.gain.setTargetAtTime(1, t + 0.25, 0.3);
    }
    if (u >= 0.7) kick(t + 0.2, 0.3 * u, out);
  }

  function audioTick() {
    const actx = snd.ctx;
    if (!actx || actx.state !== 'running') return;
    const now = actx.currentTime;
    const live = G && !G.over && !modal && !G.paused;
    snd.master.gain.setTargetAtTime(!soundOn ? 0 : live ? 0.55 : 0.22, now, 0.4);
    if (snd.next < now) snd.next = now + 0.05;
    while (snd.next < now + 0.25) {
      playStep(snd.next, snd.step);
      snd.step = (snd.step + 1) % 32;
      snd.next += BEAT / 2;
    }
    let u = 0, pan = 0;
    if (live) {
      for (const t of G.towns) {
        const v = urgencyOf(t);
        if (v > u) { u = v; pan = clamp((sx(tx(t.i) + 0.5) / view.w) * 2 - 1, -1, 1) * 0.6; }
      }
    }
    if (u > 0.01 && now >= snd.pulseAt) {
      pulse(now + 0.02, u, pan);
      snd.pulseAt = now + pulsePeriod(u);
    }
    snd.tone.frequency.setTargetAtTime(1300 + 1500 * u, now, 0.5);
  }

  for (const type of ['pointerdown', 'touchend', 'click', 'keydown']) {
    document.addEventListener(type, audioStart, { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => {
    if (!snd.ctx) return;
    if (document.hidden) snd.ctx.suspend().catch(() => {});
    else if (soundOn) snd.ctx.resume().catch(() => {});
  });
  $('#btnSound').addEventListener('click', () => {
    soundOn = !soundOn;
    try { localStorage.setItem(SOUND_KEY, soundOn ? '1' : '0'); } catch (e) { /* storage unavailable */ }
    soundLabel();
    if (soundOn) audioStart();
    else if (snd.ctx) {
      snd.master.gain.setTargetAtTime(0, snd.ctx.currentTime, 0.1);
      setTimeout(() => { if (!soundOn) snd.ctx.suspend().catch(() => {}); }, 600);
    }
  });
  function soundLabel() { $('#btnSound').textContent = `Sound: ${soundOn ? 'on' : 'off'}`; }
  soundLabel();

  let last = performance.now();
  let acc = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (G && !G.paused && !G.over && !modal) {
      acc += dt * G.speed;
      const h = 1 / 60;
      let n = 0;
      while (acc >= h && n++ < 12) {
        step(h);
        acc -= h;
        if (G.over || modal) { acc = 0; break; }
      }
    } else {
      acc = 0;
    }
    if (G && G.fver !== G.gver) { solveFlow(); G.fver = G.gver; }
    updateCamera(dt);
    render();
    updateHud();
    tutTick();
    audioTick();
    requestAnimationFrame(frame);
  }

  // A small working grid behind the title screen.
  function demoGrid() {
    const t = G.towns[0];
    if (!t) return;
    const spots = [];
    for (let dy = -4; dy <= 4; dy++) for (let dx = -5; dx <= 5; dx++) {
      const x = tx(t.i) + dx, y = ty(t.i) + dy;
      if (!inB(x, y)) continue;
      const i = idx(x, y);
      if (cheb(i, t.i) >= 3 && placeCheck('coal', i) === 'ok') spots.push(i);
    }
    if (!spots.length) return;
    const g = spots[Math.floor(spots.length / 2)];
    G.res.coal = 1;
    placeGen('coal', g);
    const st = newStroke();
    let cur = g, guard = 0;
    while (cur !== t.i && guard++ < 20) { const nx = stepToward(cur, t.i); if (tryConnect(cur, nx, st) !== 'ok') break; cur = nx; }
    for (const x of G.gens) x.born = -10;
    for (const x of G.towns) { x.born = -99; x.lit = 1; }
    G.dayT = DAY_LEN * 0.6;
    solveFlow();
  }

  measure();
  newGame(MAPS[0]);
  G.demo = true;
  demoGrid();
  showTitle();
  requestAnimationFrame(frame);

  // exposed for testing in the browser console
  window.__livewire = {
    get G() { return G; }, get tut() { return tut; }, get inspect() { return inspect; }, MAPS, GEN,
    step, render, solveFlow, tryConnect, endStroke, newStroke, placeGen, placeCheck, placeLink, placeGuard, eraseAt,
    restoreTrip, startNew, save, load, undo, showUpgrade, openInspect, closeInspect, idx, tx, ty, cheb, rough, capOf,
    getProgress, sx, sy, cam, user, dayPhase, sun,
  };
})();
