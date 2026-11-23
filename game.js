'use strict';
(function () {
  // ---------------------------------------------------------------- constants
  const CACHE_PREFIX = 'livewire-';
  const OFFLINE_ASSETS = 7;

  const COLORS = [
    { fill: '#ff6a4d', dark: '#a8321c', name: 'red' },
    { fill: '#2fe0c0', dark: '#128670', name: 'teal' },
    { fill: '#ffc83d', dark: '#a67a0c', name: 'yellow' },
    { fill: '#a98bff', dark: '#5b3fb0', name: 'purple' },
    { fill: '#4aa8ff', dark: '#1f61a8', name: 'blue' },
    { fill: '#ff5fa8', dark: '#a82a6a', name: 'pink' },
  ];
  const PAL = {
    bg: '#0b0f18',
    land: '#151c2b',
    landOut: '#0e1320',
    grid: 'rgba(120,170,255,0.06)',
    water: '#0c2d4d',
    waterEdge: '#12426b',
    road: '#7b8db0',
    roadEdge: '#56658a',
    bridge: '#8aa0cc',
    motor: '#2a3550',
    motorLine: '#ffd45e',
    tree: '#1b2438',
    mount: '#26314a',
    mountDark: '#1d2740',
    mountLight: '#33405f',
  };

  const CAR_SPEED = 1.6;        // tiles per second
  const MOTOR_SPEED = 4.2;
  const GAP = 0.55;             // spacing between queued cars
  const CROSS = 0.7;            // seconds a 3-way junction is blocked per car
  const CROSS_PER_ARM = 0.15;   // extra for each road beyond 3
  const ROUND_CROSS = 0.18;     // same, for a roundabout
  const GATE_CROSS = 0.45;      // cars take turns at a car park gate, in or out
  const INTER_PENALTY = 0.45;   // routing cost of passing a plain junction
  const DWELL = 0.8;
  const PIN_LIMIT = 5;          // waiting visitors (no car on the way, or one stuck in traffic) before the timer starts
  const OVER_FILL = 1 / 60;     // overflow timer fills in 60s
  const OVER_DRAIN = 1 / 30;    // and empties at half that speed once things improve
  const LATE = 3;               // seconds stuck in traffic before a car's visitor counts as waiting again
  const WEEK_LEN = 70;
  const CARS_PER_HOUSE = 2;
  const MAX_SPAN = 6;           // longest bridge or tunnel, in tiles
  const BUS_CAP = 4;            // visitors a shuttle bus carries per trip
  const BUS_SPEED = 0.8;        // buses are a bit slower than cars
  const BIG_PARK = 0.5;         // a bigger car park's gate works twice as fast
  const SQRT2 = Math.SQRT2;
  const SAVE_KEY = 'livewire-save-v1';
  const BEST_KEY = 'livewire-best';
  const PROGRESS_KEY = 'livewire-progress';
  const SEEN_HELP_KEY = 'livewire-seen-help';
  const SHAPES_KEY = 'livewire-shapes';
  let shapesOn = false;
  try { shapesOn = localStorage.getItem(SHAPES_KEY) === '1'; } catch (e) { /* storage unavailable */ }

  // Maps are drawn in landscape (28 x 18) and turned on their side for portrait.
  // Each has fixed terrain, so it feels like a place; houses and buildings
  // appear in different spots every game.
  const MAPS = [
    {
      id: 'millbrook', name: 'Ampton', seed: 7193, target: 500, demand: 1, solar: 3, wind: 6, trip: 5, swing: 0.25,
      blurb: 'One river runs through town.',
      rivers: [{ axis: 'v', pos: 0.42 }], lakes: 1, hills: 0, bridges: 1, tunnels: 0,
    },
    {
      id: 'twinford', name: 'Wattford', seed: 4410, target: 650, demand: 1.1, solar: 2, wind: 5, trip: 4, swing: 0.3,
      blurb: 'Two rivers cross in the middle. You only get a few sea cables.',
      rivers: [{ axis: 'v', pos: 0.4 }, { axis: 'h', pos: 0.58 }], lakes: 0, hills: 0, bridges: 2, tunnels: 0,
    },
    {
      id: 'stonehill', name: 'Ohmstone', seed: 2231, target: 800, demand: 1, solar: 2, wind: 4, trip: 3, swing: 0.35,
      blurb: 'Hills get in the way. Go round them or under them.',
      rivers: [{ axis: 'v', pos: 0.66 }], lakes: 0, hills: 6, bridges: 1, tunnels: 1,
    },
    {
      id: 'cragmoor', name: 'Faradale', seed: 9067, target: 950, demand: 1.15, solar: 2, wind: 3, trip: 3, swing: 0.4,
      blurb: 'Rivers, lakes and hills, and not much open ground.',
      rivers: [{ axis: 'v', pos: 0.32 }, { axis: 'v', pos: 0.7 }], lakes: 2, hills: 7, bridges: 2, tunnels: 1,
    },
    {
      id: 'voltmere', name: 'Voltmere', seed: 5521, target: 1100, demand: 1.25, solar: 1, wind: 3, trip: 2, swing: 0.45,
      blurb: 'A row of islands. Most cables have to cross water.',
      rivers: [{ axis: 'h', pos: 0.5 }], lakes: 4, hills: 3, bridges: 3, tunnels: 1,
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
  let tool = 'road';
  let modal = null;
  let motorStart = -1;
  let hoverTile = -1;

  const rnd = (a, b) => a + Math.random() * (b - a);
  const rint = (a, b) => Math.floor(rnd(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fmt = (n) => n.toLocaleString("en-GB");

  // ---------------------------------------------------------------- grid helpers
  // Graph nodes are tile indexes. An overpass tile has a second node for its
  // upper deck: tile + G.N. It carries the east-west road over the north-south one.
  const idx = (x, y) => y * G.W + x;
  const tx = (i) => i % G.W;
  const ty = (i) => ((i % G.N) / G.W) | 0;
  const deck = (i) => i + G.N;
  const isDeck = (n) => n >= G.N;
  const base = (n) => (n >= G.N ? n - G.N : n); // the tile under a node, deck or not
  const inMap = (x, y) => x >= 0 && y >= 0 && x < G.W && y < G.H;
  const inB = (x, y) => x >= G.bounds.x0 && x <= G.bounds.x1 && y >= G.bounds.y0 && y <= G.bounds.y1;
  const ekey = (a, b) => (a < b ? a * 65536 + b : b * 65536 + a);
  const dkey = (a, b) => a * 65536 + b;

  // water and hills can't be built on without a bridge or tunnel
  const rough = (i) => G.water[i] || G.mount[i];

  function freeTile(i) {
    return !rough(i) && !G.road[i] && !G.occ[i];
  }

  function kind(i) {
    const o = G.occ[i];
    if (o) return o.kind === 'dest' ? null : o.kind;
    if (G.road[i]) return 'road';
    if (G.water[i]) return 'water';
    if (G.mount[i]) return 'mount';
    return 'land';
  }

  function nodeValid(n) {
    if (isDeck(n)) return !!G.overpass[n - G.N];
    if (G.road[n]) return true;
    const o = G.occ[n];
    return !!o && (o.kind === 'house' || o.kind === 'port');
  }

  // ---------------------------------------------------------------- new game
  function newGame(map) {
    undoStack = [];
    pendingSnap = null;
    const portrait = window.innerHeight >= window.innerWidth;
    const W = portrait ? 18 : 28;
    const H = portrait ? 28 : 18;
    G = blankState(W, H);
    G.map = map;
    G.res.bridges = map.bridges;
    G.res.tunnels = map.tunnels;
    genTerrain(map, portrait);
    const bw = portrait ? 10 : 15;
    const bh = portrait ? 15 : 10;
    const x0 = Math.floor((W - bw) / 2);
    const y0 = Math.floor((H - bh) / 2);
    G.bounds = { x0, y0, x1: x0 + bw - 1, y1: y0 + bh - 1 };
    fitBoundsToScreen();

    const d = spawnDest(0);
    G.colorsUsed = 1;
    if (d) {
      for (let k = 0; k < 3; k++) spawnHouse(0, { x: d.x + 0.5, y: d.y + 0.5, rmin: 4, rmax: 7 });
      d.pinT = 3;
    }
    user.zoom = 1; user.px = 0; user.py = 0;
    camSnap = true;
    tool = 'road';
    motorStart = -1;
    graphChanged();
  }

  function blankState(W, H) {
    const N = W * H;
    return {
      W, H, N,
      map: MAPS[0],
      water: new Uint8Array(N),
      mount: new Uint8Array(N),
      road: new Uint8Array(N),
      round: new Uint8Array(N),
      overpass: new Uint8Array(N),
      deco: new Uint8Array(N),
      occ: new Array(N).fill(null),
      adj: Array.from({ length: N * 2 }, () => new Map()),
      edges: new Map(),
      queues: new Map(),
      lock: new Float64Array(N * 2),
      houses: [],
      dests: [],
      cars: [],
      fx: [],
      res: {
        roads: 30, bridges: 1, tunnels: 0, rounds: 0, motors: 0,
        entrances: 0, dozers: 0, moves: 0, batteries: 0,
      },
      owned: {}, // upgrade tools picked up this game, so they stay in the toolbar
      bridgesUsed: 0,
      tunnelsUsed: 0,
      cutOff: 0,
      targetHit: false,
      time: 0, week: 1, weekT: 0, score: 0,
      speed: 1, paused: false, over: false,
      bounds: { x0: 0, y0: 0, x1: W - 1, y1: H - 1 },
      colorsUsed: 0,
      nextHouse: 4,
      nextDest: 32,
      noted: {},
      trips: [],       // cables tripped by sustained overload, waiting to reset
      rush: null,      // { color, left, mult } while a rush hour is on
      nextRush: 150,
      dispatchT: 0,
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

  // ---------------------------------------------------------------- spawning
  function distToBlock(px, py, d) {
    const cx = clamp(px, d.x, d.x + 1);
    const cy = clamp(py, d.y, d.y + 1);
    return Math.max(Math.abs(px - cx), Math.abs(py - cy));
  }

  // Splits the open land into areas you can build roads across without a new
  // bridge or tunnel. An area is "settled" if it already touches your town.
  function landAreas() {
    const area = new Int32Array(G.N).fill(-1);
    const settled = [];
    const open = (i) => (!rough(i) || G.road[i]) && !G.occ[i];
    let any = false;
    for (let s = 0; s < G.N; s++) {
      if (area[s] >= 0 || !inB(tx(s), ty(s)) || !open(s)) continue;
      const id = settled.length;
      let town = false;
      const stack = [s];
      area[s] = id;
      while (stack.length) {
        const u = stack.pop();
        if (G.road[u]) town = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = tx(u) + dx, y = ty(u) + dy;
          if (!inB(x, y)) continue;
          const v = idx(x, y);
          if (G.occ[v]) { if (G.occ[v].kind !== 'dest' && G.adj[v].size) town = true; continue; }
          if (area[v] < 0 && open(v)) { area[v] = id; stack.push(v); }
        }
      }
      settled.push(town);
      if (town) any = true;
    }
    // Before anything is built, everywhere counts.
    return { area, ok: (i) => !any || (area[i] >= 0 && settled[area[i]]) };
  }

  function spawnDest(color) {
    const B = G.bounds;
    const land = landAreas();
    let best = null;
    let bestScore = -Infinity;
    for (let tries = 0; tries < 500; tries++) {
      const x = rint(B.x0, B.x1 - 1);
      const y = rint(B.y0, B.y1 - 1);
      const cells = [idx(x, y), idx(x + 1, y), idx(x, y + 1), idx(x + 1, y + 1)];
      if (!cells.every(freeTile)) continue;
      let crowded = false;
      for (let yy = y - 1; yy <= y + 2 && !crowded; yy++) {
        for (let xx = x - 1; xx <= x + 2; xx++) {
          if (inMap(xx, yy) && G.occ[idx(xx, yy)]) { crowded = true; break; }
        }
      }
      if (crowded) continue;
      const ports = [
        [x, y - 1, 0, -1], [x + 1, y - 1, 0, -1], [x, y + 2, 0, 1], [x + 1, y + 2, 0, 1],
        [x - 1, y, -1, 0], [x - 1, y + 1, -1, 0], [x + 2, y, 1, 0], [x + 2, y + 1, 1, 0],
      ].filter(([px, py, dx, dy]) => {
        if (!inB(px, py) || !freeTile(idx(px, py))) return false;
        const ox = px + dx, oy = py + dy;
        return inB(ox, oy) && !rough(idx(ox, oy)) && !G.occ[idx(ox, oy)] && land.ok(idx(ox, oy));
      });
      if (!ports.length) continue;
      let score = rnd(0, 3);
      let nearest = 99;
      for (const d of G.dests) {
        const dd = Math.max(Math.abs(d.x - x), Math.abs(d.y - y));
        nearest = Math.min(nearest, dd + (d.color === color ? -2 : 0));
      }
      score += Math.min(nearest, 8);
      for (const h of G.houses) {
        const dd = distToBlock(tx(h.i), ty(h.i), { x, y });
        if (dd < 2) score -= 4;
      }
      if (score > bestScore) {
        bestScore = score;
        const p = pick(ports);
        best = { x, y, port: idx(p[0], p[1]) };
      }
    }
    if (!best) return null;
    const d = {
      id: G.nextId++, color, x: best.x, y: best.y, ports: [best.port],
      pins: 0, assigned: 0, overflow: 0, pinT: rnd(6, 9), born: G.time, bigPark: false,
    };
    for (const c of [idx(d.x, d.y), idx(d.x + 1, d.y), idx(d.x, d.y + 1), idx(d.x + 1, d.y + 1)]) {
      G.occ[c] = { kind: 'dest', d };
      G.deco[c] = 0;
    }
    G.occ[best.port] = { kind: 'port', d };
    G.deco[best.port] = 0;
    G.dests.push(d);
    countCutOff();
    return d;
  }

  function houseSpotOK(i) {
    const x = tx(i), y = ty(i);
    if (!inB(x, y) || !freeTile(i)) return false;
    // keep a ring clear around buildings
    for (let yy = y - 1; yy <= y + 1; yy++) {
      for (let xx = x - 1; xx <= x + 1; xx++) {
        if (!inMap(xx, yy)) continue;
        const o = G.occ[idx(xx, yy)];
        if (o && (o.kind === 'dest' || o.kind === 'port')) return false;
      }
    }
    // needs a way out
    let exits = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (!inB(xx, yy)) continue;
      const j = idx(xx, yy);
      if (!rough(j) && (!G.occ[j] || G.road[j])) exits++;
    }
    if (!exits) return false;
    // must not box in a neighbouring unconnected house
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (!inMap(xx, yy)) continue;
      const j = idx(xx, yy);
      const o = G.occ[j];
      if (o && o.kind === 'house' && G.adj[j].size === 0) {
        let ex = 0;
        for (const [ex1, ey1] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ax = xx + ex1, ay = yy + ey1;
          if (!inB(ax, ay)) continue;
          const k = idx(ax, ay);
          if (k === i) continue;
          if (!rough(k) && !G.occ[k]) ex++;
        }
        if (!ex) return false;
      }
    }
    return true;
  }

  function spawnHouse(color, near) {
    const B = G.bounds;
    const mine = G.houses.filter((h) => h.color === color);
    // Houses only appear across water or hills when you have a bridge or tunnel to reach them.
    const spare = G.res.bridges - G.bridgesUsed + G.res.tunnels - G.tunnelsUsed;
    const land = spare > 0 ? null : landAreas();
    const reachable = (i) => !land || [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
      const x = tx(i) + dx, y = ty(i) + dy;
      return inB(x, y) && land.ok(idx(x, y));
    });
    let spot = -1;
    for (let tries = 0; tries < 400 && spot < 0; tries++) {
      let x, y;
      if (near) {
        const r = rnd(near.rmin, near.rmax);
        const a = rnd(0, Math.PI * 2);
        x = Math.round(near.x + Math.cos(a) * r);
        y = Math.round(near.y + Math.sin(a) * r);
      } else if (mine.length && Math.random() < 0.72) {
        const h = pick(mine);
        x = tx(h.i) + rint(-2, 2);
        y = ty(h.i) + rint(-2, 2);
      } else {
        x = rint(B.x0, B.x1);
        y = rint(B.y0, B.y1);
      }
      if (!inMap(x, y)) continue;
      const i = idx(x, y);
      if (houseSpotOK(i) && reachable(i)) spot = i;
    }
    if (spot < 0 && near) return spawnHouse(color, null);
    if (spot < 0) return null;
    const h = { id: G.nextId++, color, i: spot, born: G.time, type: pick(genTypes()) };

    G.occ[spot] = { kind: 'house', h };
    G.deco[spot] = 0;
    G.houses.push(h);
    for (let k = 0; k < CARS_PER_HOUSE; k++) addCar(h);
    countCutOff();
    return h;
  }

  function addCar(h, bus = false) {
    G.cars.push({
      id: G.nextId++, house: h, color: h.color, state: 'home', leg: null,
      path: null, s: 0, t: 0, len: 1, dk: -1, dest: null, timer: 0, wx: 0, wy: 0, ang: 0,
      bus, cap: bus ? BUS_CAP : 1, load: 0,
    });
  }

  function spawnNewDest() {
    const target = Math.min(COLORS.length, 2 + Math.floor((G.week - 1) / 2));
    let color;
    if (G.colorsUsed < target) {
      color = G.colorsUsed;
    } else {
      const counts = new Array(G.colorsUsed).fill(0);
      for (const d of G.dests) counts[d.color]++;
      const min = Math.min(...counts);
      const options = counts.map((c, i) => (c === min ? i : -1)).filter((i) => i >= 0);
      color = pick(options);
    }
    const d = spawnDest(color);
    if (!d) return;
    if (color === G.colorsUsed) G.colorsUsed++;
    const n = G.houses.some((h) => h.color === color) ? 1 : 2;
    for (let k = 0; k < n; k++) spawnHouse(color, { x: d.x + 0.5, y: d.y + 0.5, rmin: 3, rmax: 7 });
  }

  function chooseHouseColor() {
    const dc = new Array(G.colorsUsed).fill(0);
    const hc = new Array(G.colorsUsed).fill(0);
    for (const d of G.dests) dc[d.color]++;
    for (const h of G.houses) hc[h.color]++;
    const w = dc.map((d, i) => (d ? Math.max(0.3, d * 3 - hc[i] + 1) : 0));
    let sum = w.reduce((a, b) => a + b, 0);
    let r = Math.random() * sum;
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
    return 0;
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

  // ---------------------------------------------------------------- graph
  function addEdge(a, b, type) {
    const len = type === 'motor'
      ? Math.hypot(tx(a) - tx(b), ty(a) - ty(b))
      : (tx(a) !== tx(b) && ty(a) !== ty(b) ? SQRT2 : 1);
    const e = { a, b, type, len };
    G.adj[a].set(b, e);
    G.adj[b].set(a, e);
    G.edges.set(ekey(a, b), e);
    return e;
  }

  function removeEdge(a, b, refund = true) {
    const e = G.adj[a].get(b);
    if (!e) return;
    G.adj[a].delete(b);
    G.adj[b].delete(a);
    G.edges.delete(ekey(a, b));
    if (e.type === 'motor' && refund) G.res.motors++;
  }

  // Can a car drive from a to b? Roads are two-way unless made one-way.
  function canGo(a, b) {
    const e = G.adj[a].get(b);
    return !!e && (e.from === undefined || e.from === a);
  }

  // The graph node a road enters when it reaches tile i from tile j.
  // On an overpass, east-west traffic uses the upper deck.
  function nodeFor(i, j) {
    if (!G.overpass[i]) return i;
    return ty(i) === ty(j) ? deck(i) : i;
  }

  // A bridge is a connected run of road tiles over water; a tunnel is the same
  // through hills. Each one uses up one bridge or tunnel.
  function spanInfo(layer) {
    const seen = new Uint8Array(G.N);
    let count = 0, maxSize = 0;
    for (let i = 0; i < G.N; i++) {
      if (!layer[i] || !G.road[i] || seen[i]) continue;
      count++;
      maxSize = Math.max(maxSize, spanComponent(i, layer, seen).length);
    }
    return { count, maxSize };
  }

  function spanComponent(start, layer, seen = new Uint8Array(G.N)) {
    const out = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const n = stack.pop();
      out.push(n);
      for (const m of G.adj[n].keys()) {
        if (!seen[m] && layer[m] && G.road[m]) { seen[m] = 1; stack.push(m); }
      }
    }
    return out;
  }

  // Houses that can't get to a building of their colour and back.
  function countCutOff() {
    const reach = new Uint8Array(G.N);
    const walk = (d, forward) => {
      const seen = new Uint8Array(G.N * 2);
      const stack = [...d.ports];
      for (const p of d.ports) seen[p] = 1;
      const got = [];
      while (stack.length) {
        const n = stack.pop();
        const o = G.occ[n];
        if (o && o.kind === 'house') { if (o.h.color === d.color) got.push(n); continue; }
        if (o && o.kind !== 'port') continue;
        if (o && o.d !== d) continue;
        for (const m of G.adj[n].keys()) {
          if (seen[m]) continue;
          if (forward ? !canGo(n, m) : !canGo(m, n)) continue;
          seen[m] = 1;
          stack.push(m);
        }
      }
      return got;
    };
    for (const d of G.dests) {
      const there = new Set(walk(d, false));
      d.cut = true;
      for (const n of walk(d, true)) if (there.has(n)) { reach[n] = 1; d.cut = false; }
    }
    let n = 0;
    for (const h of G.houses) {
      h.cut = !reach[h.i];
      if (h.cut) n++;
    }
    G.cutOff = n;
  }

  function tryConnect(p, q) {
    const px = tx(p), py = ty(p), qx = tx(q), qy = ty(q);
    const dx = qx - px, dy = qy - py;
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return 'bad';
    if (!inB(px, py) || !inB(qx, qy)) return 'bounds';
    const diag = dx !== 0 && dy !== 0;
    if (diag && (G.overpass[p] || G.overpass[q])) return 'bad';
    const pn = nodeFor(p, q), qn = nodeFor(q, p);
    if (G.adj[pn].has(qn)) return 'ok';
    const kp = kind(p), kq = kind(q);
    if (!kp || !kq) return 'bad';
    const special = (k) => k === 'house' || k === 'port';
    if (special(kp) || special(kq)) {
      if (diag) return 'bad';
      if (special(kp) && special(kq)) return 'bad';
    }
    if (kp === 'house' && G.adj[p].size > 0) return 'bad';
    if (kq === 'house' && G.adj[q].size > 0) return 'bad';
    if (diag) {
      const c1 = idx(px + dx, py), c2 = idx(px, py + dy);
      if (G.adj[c1].has(c2)) return 'bad';
    }
    const need = (kp === 'land' ? 1 : 0) + (kq === 'land' ? 1 : 0);
    if (need > G.res.roads) return 'roads';

    const setP = kp === 'land' || kp === 'water' || kp === 'mount';
    const setQ = kq === 'land' || kq === 'water' || kq === 'mount';
    if (setP) G.road[p] = 1;
    if (setQ) G.road[q] = 1;
    addEdge(pn, qn, 'road');
    const undo = (why) => {
      removeEdge(pn, qn, false);
      if (setP) G.road[p] = 0;
      if (setQ) G.road[q] = 0;
      return why;
    };
    if (G.water[p] || G.water[q]) {
      const info = spanInfo(G.water);
      if (info.count > G.res.bridges) return undo('bridges');
      if (info.maxSize > MAX_SPAN) return undo('long');
    }
    if (G.mount[p] || G.mount[q]) {
      const info = spanInfo(G.mount);
      if (info.count > G.res.tunnels) return undo('tunnels');
      if (info.maxSize > MAX_SPAN) return undo('long');
    }
    if (setP) G.deco[p] = 0;
    if (setQ) G.deco[q] = 0;
    G.res.roads -= need;
    graphChanged();
    return 'ok';
  }

  function clearRoadTile(t) {
    for (const n of [...G.adj[t].keys()]) removeEdge(t, n);
    for (const n of [...G.adj[deck(t)].keys()]) removeEdge(deck(t), n);
    G.road[t] = 0;
    if (!rough(t)) G.res.roads++;
    if (G.round[t]) { G.round[t] = 0; G.res.rounds++; }
    G.overpass[t] = 0;
  }

  function eraseAt(i) {
    const o = G.occ[i];
    if (o && (o.kind === 'house' || o.kind === 'port')) {
      if (!G.adj[i].size) return false;
      for (const n of [...G.adj[i].keys()]) removeEdge(i, n);
      graphChanged();
      return true;
    }
    if (o || !G.road[i]) return false;
    if (G.water[i] || G.mount[i]) {
      for (const t of spanComponent(i, G.water[i] ? G.water : G.mount)) clearRoadTile(t);
    } else {
      clearRoadTile(i);
    }
    graphChanged();
    return true;
  }

  function placeRoundabout(i) {
    if (G.res.rounds <= 0) { toast('No transformers left. You can pick more at the end of the day.'); return false; }
    if (!G.road[i] || rough(i) || G.round[i] || G.occ[i]) { toast('Tap a point where cables meet to place a transformer.'); return false; }
    G.round[i] = 1;
    G.res.rounds--;
    graphChanged();
    return true;
  }

  function placeMotorway(a, b) {
    const ka = kind(a), kb = kind(b);
    const okKind = (k) => k === 'road' || k === 'land';
    if (!okKind(ka) || !okKind(kb) || rough(a) || rough(b)) {
      toast('Express lines start and end on land, not on generators or towns.');
      return false;
    }
    if (Math.max(Math.abs(tx(a) - tx(b)), Math.abs(ty(a) - ty(b))) < 2) { toast('Pick an end point further away.'); return false; }
    if (G.adj[a].has(b)) return false;
    const need = (ka === 'land' ? 1 : 0) + (kb === 'land' ? 1 : 0);
    if (need > G.res.roads) { toast('You need a cable tile at each end.'); flashCount('road'); return false; }
    G.road[a] = 1; G.road[b] = 1; G.deco[a] = 0; G.deco[b] = 0;
    G.res.roads -= need;
    addEdge(a, b, 'motor');
    G.res.motors--;
    graphChanged();
    return true;
  }

  // ---------------------------------------------------------------- upgrades you place
  const ORTHO = [[0, -1], [0, 1], [-1, 0], [1, 0]];

  function destAt(i) {
    const o = G.occ[i];
    return o && (o.kind === 'dest' || o.kind === 'port') ? o.d : null;
  }

  // Tap a building (or the tile beside it) and a new car park appears on the
  // free side furthest from its existing ones.
  function addEntrance(t) {
    let d = destAt(t);
    if (!d) {
      for (const [dx, dy] of ORTHO) {
        const x = tx(t) + dx, y = ty(t) + dy;
        if (inMap(x, y) && G.occ[idx(x, y)] && G.occ[idx(x, y)].kind === 'dest') d = G.occ[idx(x, y)].d;
      }
    }
    if (!d) { toast('Tap a town to give it another substation.'); return false; }
    if (d.ports.length >= 3) { toast('That town already has three substations.'); return false; }
    const { x, y } = d;
    const sides = [
      [x, y - 1, 0, -1], [x + 1, y - 1, 0, -1], [x, y + 2, 0, 1], [x + 1, y + 2, 0, 1],
      [x - 1, y, -1, 0], [x - 1, y + 1, -1, 0], [x + 2, y, 1, 0], [x + 2, y + 1, 1, 0],
    ];
    let best = -1, bestScore = -Infinity;
    for (const [px, py, dx, dy] of sides) {
      if (!inB(px, py)) continue;
      const p = idx(px, py);
      if (!freeTile(p)) continue;
      const ox = px + dx, oy = py + dy;
      const open = inB(ox, oy) && !rough(idx(ox, oy)) && !(G.occ[idx(ox, oy)] && G.occ[idx(ox, oy)].kind !== 'port');
      let score = open ? 10 : 0;
      for (const q of d.ports) score += Math.abs(tx(q) - px) + Math.abs(ty(q) - py);
      if (score > bestScore) { bestScore = score; best = p; }
    }
    if (best < 0) { toast('There is no free space around that town.'); return false; }
    G.occ[best] = { kind: 'port', d };
    G.deco[best] = 0;
    d.ports.push(best);
    G.res.entrances--;
    G.fx.push({ type: 'poof', x: tx(best) + 0.5, y: ty(best) + 0.5, t: 0 });
    graphChanged();
    toast('New substation added. Connect a cable to it.');
    return true;
  }

  function bulldoze(i) {
    if (!inB(tx(i), ty(i)) || !rough(i) || G.road[i]) { toast('Tap a hill or water tile with no cable on it.'); return false; }
    G.water[i] = 0;
    G.mount[i] = 0;
    G.res.dozers--;
    G.fx.push({ type: 'poof', x: tx(i) + 0.5, y: ty(i) + 0.5, t: 0 });
    return true;
  }

  function moveHouse(h, t) {
    if (!houseSpotOK(t)) { toast('A generator needs an empty tile with room for a cable, away from towns.'); return false; }
    for (const n of [...G.adj[h.i].keys()]) removeEdge(h.i, n);
    G.occ[h.i] = null;
    h.i = t;
    h.born = G.time;
    G.occ[t] = { kind: 'house', h };
    G.deco[t] = 0;
    G.res.moves--;
    graphChanged();
    return true;
  }

  // ---------------------------------------------------------------- undo
  // Covers changes to the road network. Each undo puts the roads back and
  // returns what the change cost, but keeps anything you've earned since.
  const UNDO_TOOLS = new Set(['road', 'erase', 'round', 'motor']);
  const NET_RES = ['roads', 'rounds', 'motors'];
  let undoStack = [];
  let pendingSnap = null;

  function snapNet() {
    return {
      ver: G.gver,
      road: G.road.slice(), round: G.round.slice(), overpass: G.overpass.slice(),
      edges: [...G.edges.values()].map((e) => [e.a, e.b, e.type, e.from]),
      res: { ...G.res },
    };
  }

  function commitUndo() {
    if (!pendingSnap) return;
    const s = pendingSnap;
    pendingSnap = null;
    if (G.gver === s.ver) return;
    undoStack.push({ s, after: { ...G.res } });
    if (undoStack.length > 30) undoStack.shift();
    hudCache = '';
  }

  function undo() {
    commitUndo();
    const u = undoStack.pop();
    if (!u) return;
    const { s, after } = u;
    for (const e of [...G.edges.values()]) removeEdge(e.a, e.b, false);
    for (let i = 0; i < G.N; i++) {
      G.road[i] = G.occ[i] ? 0 : s.road[i]; // something may have been built there since
      G.round[i] = G.road[i] ? s.round[i] : 0;
      G.overpass[i] = G.road[i] ? s.overpass[i] : 0;
    }
    for (const [a, b, type, from] of s.edges) {
      if (!nodeValid(a) || !nodeValid(b)) continue;
      const houseFull = (n) => G.occ[n] && G.occ[n].kind === 'house' && G.adj[n].size > 0;
      if (houseFull(a) || houseFull(b)) continue;
      const e = addEdge(a, b, type);
      if (from !== undefined) e.from = from;
    }
    for (const k of NET_RES) G.res[k] = Math.max(0, G.res[k] + s.res[k] - after[k]);
    graphChanged();
    hudCache = '';
    toast('Undone.');
  }

  function graphChanged() {
    G.gver = (G.gver || 0) + 1;
    G.bridgesUsed = spanInfo(G.water).count;
    G.tunnelsUsed = spanInfo(G.mount).count;
    for (const c of G.cars) validateCar(c);
    countCutOff();
  }

  // ---------------------------------------------------------------- routing
  function heapPush(h, d, n) {
    h.push([d, n]);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p][0] <= h[i][0]) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  function heapPop(h) {
    const top = h[0];
    const last = h.pop();
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < h.length && h[l][0] < h[m][0]) m = l;
        if (r < h.length && h[r][0] < h[m][0]) m = r;
        if (m === i) break;
        [h[m], h[i]] = [h[i], h[m]];
        i = m;
      }
    }
    return top;
  }

  // Shortest times *to* the targets, so the search walks roads backwards:
  // stepping from u to v means a car would drive v -> u.
  function dijkstra(targets, stop = -1) {
    const list = Array.isArray(targets) ? targets : [targets];
    const dist = new Float64Array(G.N * 2).fill(Infinity);
    const prev = new Int32Array(G.N * 2).fill(-1);
    const heap = [];
    for (const t of list) { dist[t] = 0; heap.push([0, t]); }
    while (heap.length) {
      const [d, u] = heapPop(heap);
      if (d > dist[u]) continue;
      if (u === stop) break;
      if (d > 0 && G.occ[u]) continue; // houses and car parks are ends only
      for (const [v, e] of G.adj[u]) {
        if (e.from !== undefined && e.from !== v) continue;
        let w = e.len / (e.type === 'motor' ? MOTOR_SPEED : CAR_SPEED);
        if (!G.occ[v] && G.adj[v].size >= 3) w += G.round[v] ? 0.08 : INTER_PENALTY;
        const nd = d + w;
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heapPush(heap, nd, v); }
      }
    }
    return { dist, prev };
  }

  function findPath(src, dst) {
    const targets = Array.isArray(dst) ? dst : [dst];
    if (targets.includes(src)) return [src];
    const { dist, prev } = dijkstra(targets, src);
    if (!isFinite(dist[src])) return null;
    const path = [];
    let n = src;
    while (n !== -1) { path.push(n); if (targets.includes(n)) return path; n = prev[n]; }
    return null;
  }

  function dispatch() {
    for (const d of G.dests) {
      const waiting = d.pins - d.assigned;
      if (waiting <= 0) continue;
      const idle = G.cars.filter((c) => c.color === d.color && c.state === 'home' && !c.retire && genOnline(c.house));
      if (!idle.length) continue;
      const { dist, prev } = dijkstra(d.ports);
      let best = null, bd = Infinity;
      for (const c of idle) {
        const v = dist[c.house.i];
        if (v < bd) { bd = v; best = c; }
      }
      if (!best) continue;
      const path = [];
      let n = best.house.i;
      while (n !== -1) { path.push(n); if (d.ports.includes(n)) break; n = prev[n]; }
      if (!d.ports.includes(path[path.length - 1])) continue;
      best.leg = 'out';
      best.dest = d;
      best.path = path;
      best.s = 0;
      best.state = 'wait';
      best.load = Math.min(best.cap, waiting);
      d.assigned += best.load;
    }
  }

  // ---------------------------------------------------------------- cars
  function queueOf(k) {
    let q = G.queues.get(k);
    if (!q) { q = []; G.queues.set(k, q); }
    return q;
  }
  // A one-way road has two lanes going the same way, so it carries twice the cars.
  const LANE2 = 2 ** 30;
  function laneRoom(k) {
    const q = G.queues.get(k);
    return !q || !q.length ? Infinity : q[q.length - 1].t;
  }
  // Which lane a car can join on a -> b: 0, 1, or -1 when both are full.
  function freeLane(a, b) {
    const k = dkey(a, b);
    const r0 = laneRoom(k);
    const e = G.adj[a].get(b);
    if (!e || e.from === undefined) return r0 >= GAP ? 0 : -1;
    const r1 = laneRoom(k + LANE2);
    if (Math.max(r0, r1) < GAP) return -1;
    return r0 >= r1 ? 0 : 1;
  }
  function enterEdge(car, s, lane) {
    const a = car.path[s], b = car.path[s + 1];
    const e = G.adj[a].get(b);
    car.s = s; car.t = 0; car.len = e.len; car.motor = e.type === 'motor';
    car.lane = lane;
    car.dk = dkey(a, b) + (lane ? LANE2 : 0);
    queueOf(car.dk).push(car);
    car.state = 'drive';
  }
  function leaveEdge(car) {
    if (car.dk < 0) return;
    const q = G.queues.get(car.dk);
    if (q) {
      const i = q.indexOf(car);
      if (i >= 0) q.splice(i, 1);
      if (!q.length) G.queues.delete(car.dk);
    }
    car.dk = -1;
  }
  function isJunction(n) {
    return G.road[n] && G.adj[n].size >= 3;
  }
  function passJunction(n) {
    const o = G.occ[n];
    const gate = !!o && o.kind === 'port';
    if (!gate && !isJunction(n)) return true;
    if (G.lock[n] > G.time) return false;
    G.lock[n] = G.time + (gate ? GATE_CROSS * (o.d.bigPark ? BIG_PARK : 1)
      : G.round[n] ? ROUND_CROSS
      : CROSS + CROSS_PER_ARM * (G.adj[n].size - 3));
    return true;
  }

  function carTarget(car) {
    return car.leg === 'out' ? car.dest.ports : car.house.i;
  }

  // Give up on the visit this car was heading to, so another car can take it.
  function dropTrip(car) {
    if (car.leg === 'out' && car.dest) car.dest.assigned = Math.max(0, car.dest.assigned - car.load);
    car.dest = null;
    car.load = 0;
    car.leg = 'back';
  }

  function goneHome(car) {
    car.state = car.retire ? 'gone' : 'home';
    car.leg = null; car.path = null; car.dest = null; car.load = 0;
  }

  function poof(car) {
    const p = carPos(car);
    if (p) G.fx.push({ type: 'poof', x: p.x, y: p.y, t: 0 });
    leaveEdge(car);
    dropTrip(car);
    goneHome(car);
  }

  function pathOK(path, from) {
    for (let k = from; k < path.length - 1; k++) if (!canGo(path[k], path[k + 1])) return false;
    return true;
  }

  function replanFrom(car, node) {
    let np = findPath(node, carTarget(car));
    if (!np && car.leg === 'out') {
      dropTrip(car);
      np = findPath(node, car.house.i);
    }
    if (!np) { poof(car); return; }
    car.path = np; car.s = 0; car.state = 'wait';
    if (np.length === 1) arrive(car);
  }

  function validateCar(car) {
    if (car.state === 'drive') {
      const a = car.path[car.s], b = car.path[car.s + 1];
      if (!G.adj[a].has(b)) {
        leaveEdge(car);
        let node = car.t > car.len / 2 ? b : a;
        if (!nodeValid(node)) node = node === a ? b : a;
        if (!nodeValid(node)) { poof(car); return; }
        car.wx = tx(node) + 0.5; car.wy = ty(node) + 0.5;
        replanFrom(car, node);
        return;
      }
      // re-route only when the planned way is broken
      if (!pathOK(car.path, car.s + 1) || !nodeValid(car.path[car.path.length - 1])) {
        let np = findPath(b, carTarget(car));
        if (!np && car.leg === 'out') {
          dropTrip(car);
          np = findPath(b, car.house.i);
        }
        if (!np) { poof(car); return; }
        car.path = [a, ...np];
        car.s = 0;
      }
    } else if (car.state === 'wait') {
      const broken = (car.leg === 'out' && !car.dest) || !pathOK(car.path, 0) || !nodeValid(car.path[car.path.length - 1]);
      if (broken || !nodeValid(car.path[0])) {
        if (!nodeValid(car.path[0])) { poof(car); return; }
        replanFrom(car, car.path[0]);
      }
    }
  }

  function arrive(car) {
    leaveEdge(car);
    if (car.leg === 'out') {
      const d = car.dest;
      const port = car.path[car.path.length - 1];
      d.pins = Math.max(0, d.pins - car.load);
      d.assigned = Math.max(0, d.assigned - car.load);
      G.score += car.load;
      car.load = 0;
      G.fx.push({ type: 'ring', x: tx(port) + 0.5, y: ty(port) + 0.5, t: 0, color: COLORS[d.color].fill });
      car.state = 'park';
      car.timer = DWELL;
      car.at = port;
    } else {
      goneHome(car);
    }
  }

  function updateCar(car, dt) {
    switch (car.state) {
      case 'home':
        return;
      case 'park':
        car.timer -= dt;
        if (car.timer <= 0) {
          const port = car.at;
          car.dest = null;
          car.leg = 'back';
          const p = findPath(port, car.house.i);
          if (!p) { car.timer = 0.5; car.stuck = (car.stuck || 0) + 0.5; if (car.stuck > 6) { car.stuck = 0; poof(car); } return; }
          car.stuck = 0;
          car.path = p; car.s = 0; car.state = 'wait';
        }
        return;
      case 'wait': {
        const a = car.path[0], b = car.path[1];
        if (b === undefined) { arrive(car); return; }
        if (!canGo(a, b)) { validateCar(car); return; }
        const lane = freeLane(a, b);
        if (lane < 0) return;
        if (!passJunction(a)) return;
        enterEdge(car, 0, lane);
        return;
      }
      case 'drive': {
        const speed = (car.motor ? MOTOR_SPEED : CAR_SPEED) * (car.bus ? BUS_SPEED : 1);
        const q = G.queues.get(car.dk);
        const qi = q ? q.indexOf(car) : -1;
        let lim = car.len;
        if (qi > 0) lim = Math.min(lim, q[qi - 1].t - GAP);
        if (car.t < lim) car.t = Math.min(lim, car.t + speed * dt);
        if (car.t >= car.len - 1e-4) {
          const s1 = car.s + 1;
          if (s1 === car.path.length - 1) {
            if (passJunction(car.path[s1])) arrive(car);
            return;
          }
          const a = car.path[s1], b = car.path[s1 + 1];
          if (!canGo(a, b)) { validateCar(car); return; }
          const lane = freeLane(a, b);
          if (lane < 0) return;
          if (!passJunction(a)) return;
          leaveEdge(car);
          enterEdge(car, s1, lane);
        }
        return;
      }
    }
  }

  function carPos(car) {
    if (car.state === 'drive') {
      const a = car.path[car.s], b = car.path[car.s + 1];
      const ax = tx(a) + 0.5, ay = ty(a) + 0.5, bx = tx(b) + 0.5, by = ty(b) + 0.5;
      const f = clamp(car.t / car.len, 0, 1);
      const dx = (bx - ax) / car.len, dy = (by - ay) / car.len;
      // pulses run down the middle of the cable; a doubled cable carries two side by side
      const off = car.lane ? -0.07 : 0;
      return { x: ax + (bx - ax) * f + dy * off, y: ay + (by - ay) * f - dx * off, ang: Math.atan2(dy, dx) };
    }
    if (car.state === 'wait' && car.path && !G.occ[car.path[0]]) {
      return { x: tx(car.path[0]) + 0.5, y: ty(car.path[0]) + 0.5, ang: car.ang || 0 };
    }
    return null;
  }

  // A road counts as jammed while cars on it are crawling or stopped.
  // The level eases up and down so the red tint doesn't flicker.
  function updateJams(dt) {
    const stuck = new Map();
    for (const d of G.dests) d.late = 0;
    for (const c of G.cars) {
      if (c.state !== 'drive' || c.dk !== c.prevDk) { c.stuckT = 0; continue; }
      const free = (c.motor ? MOTOR_SPEED : CAR_SPEED) * (c.bus ? BUS_SPEED : 1) * dt;
      if (c.t - c.prevT >= free * 0.4) { c.stuckT = 0; continue; }
      c.stuckT = (c.stuckT || 0) + dt;
      if (c.leg === 'out' && c.dest && c.stuckT > LATE) c.dest.late += c.load || 1;
      const e = G.adj[c.path[c.s]].get(c.path[c.s + 1]);
      if (e) stuck.set(e, (stuck.get(e) || 0) + 1);
    }
    const k = Math.min(1, dt * 1.5);
    for (const e of G.edges.values()) {
      const target = Math.min(1, (stuck.get(e) || 0) / 2);
      e.jam = (e.jam || 0) + (target - (e.jam || 0)) * k;
    }
  }

  // ---------------------------------------------------------------- simulation
  // More visitors from the start, so you can see where traffic will build up,
  // and a gentler climb after that.
  // ---- Generator types. Coal is steady. Solar only runs in daylight. Wind comes and goes.
  // An offline generator's cars stay parked, so a town needs a mix. A battery keeps one running.
  function genTypes() {
    if (G.week < G.map.solar) return ['coal'];
    if (G.week < G.map.wind) return ['coal', 'coal', 'solar'];
    return ['coal', 'coal', 'coal', 'solar', 'solar', 'wind'];
  }
  // dayPhase is the clock: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. Each week starts at sunrise.
  function sunUp() { const p = dayPhase(); return p >= 0.25 && p < 0.75; }
  function genOnline(h) {
    if (h.battery || !h.type || h.type === 'coal') return true;
    return h.type === 'solar' ? sunUp() : h.windOn !== false;
  }
  function updateGens(dt) {
    for (const h of G.houses) {
      if (h.type !== 'wind') continue;
      h.windT = (h.windT === undefined ? rnd(10, 25) : h.windT) - dt;
      if (h.windT <= 0) {
        h.windOn = h.windOn === false;
        h.windT = h.windOn ? rnd(14, 30) : rnd(7, 13);
      }
    }
  }

  // ---- Day and night. One day lasts one week: demand dips overnight and peaks in the evening.
  const TRIP_AFTER = 9;         // seconds of heavy overload before a cable trips
  const TRIP_GAP = 25;          // at most one trip this often, so it stays an event
  const TRIP_RESET = 12;        // seconds before a tripped cable resets on its own
  function dayPhase() { return (G.weekT / WEEK_LEN + 0.25) % 1; } // each week starts at sunrise
  function demandMult() { return 1 + G.map.swing * Math.sin(2 * Math.PI * (dayPhase() - 0.55)); } // peaks at 0.8, dips at 0.3
  function dayLabel() {
    const p = dayPhase();
    return p < 0.25 || p >= 0.9 ? 'Night' : p < 0.5 ? 'Morning' : p < 0.7 ? 'Afternoon' : 'Evening peak';
  }

  // Sustained overload trips the breaker: the cable drops out for a while.
  // A transformer at either end protects it. Tap the gap to reset it early.
  function updateTrips(dt) {
    // a trip whose cable was redrawn (or undone) is already fixed
    G.trips = G.trips.filter((t) => !G.adj[t.e.a].has(t.e.b));
    for (const t of G.trips) t.left -= dt;
    for (const t of G.trips) if (t.left <= 0) restoreTrip(t);
    if (G.week < G.map.trip) return;
    G.tripCD = Math.max(0, (G.tripCD || 0) - dt);
    // Only trunk cables trip: never a generator's own link or a substation gate.
    const end = (n) => !isDeck(n) && G.occ[n] && (G.occ[n].kind === 'house' || G.occ[n].kind === 'port');
    let worst = null;
    for (const e of G.edges.values()) {
      if (e.type === 'motor' || end(e.a) || end(e.b)) continue;
      if (e.jam > 0.85 && !G.round[base(e.a)] && !G.round[base(e.b)]) e.hot = (e.hot || 0) + dt;
      else e.hot = Math.max(0, (e.hot || 0) - dt * 2);
      if (e.hot > TRIP_AFTER && (!worst || e.hot > worst.hot)) worst = e;
    }
    if (worst && G.tripCD <= 0) {
      const e = worst;
      G.tripCD = TRIP_GAP;
      removeEdge(e.a, e.b, false);
      G.trips.push({ e, left: TRIP_RESET, occA: G.occ[base(e.a)], occB: G.occ[base(e.b)] });
      e.hot = 0; e.jam = 0;
      const mx = (tx(base(e.a)) + tx(base(e.b))) / 2 + 0.5, my = (ty(base(e.a)) + ty(base(e.b))) / 2 + 0.5;
      G.fx.push({ type: 'poof', x: mx, y: my, t: 0 });
      graphChanged();
      sfx('trip');
      if (!mechTip('trip', 'A cable carried too much for too long, so its breaker tripped. It comes back on by itself in a few seconds, or tap the gap to reset it now. Transformers stop cables tripping.')) toast('A cable tripped. Tap the gap to reset it.');
    }
  }

  function restoreTrip(t) {
    G.trips = G.trips.filter((x) => x !== t);
    const { a, b, type, from } = t.e;
    // skip if the player rebuilt or erased it, or a tile now holds something else
    if (G.adj[a].has(b) || !nodeValid(a) || !nodeValid(b)) return;
    if (G.occ[base(a)] !== t.occA || G.occ[base(b)] !== t.occB) return;
    const houseFull = (n) => G.occ[n] && G.occ[n].kind === 'house' && G.adj[n].size > 0;
    if (houseFull(a) || houseFull(b)) return;
    const e = addEdge(a, b, type);
    if (from !== undefined) e.from = from;
    graphChanged();
  }

  // The climb never stops: late weeks keep getting busier until the roads give out.
  function pinInterval(d) {
    const rush = G.rush && G.rush.color === d.color ? G.rush.mult : 1;
    return Math.max(0.15, Math.max(0.3, 3 * Math.pow(0.93, G.week - 1)) / G.map.demand / rush / demandMult());
  }

  // Rush hour: every building of one colour gets a burst of visitors for a short while.
  const RUSH_FROM_WEEK = 6;
  function updateRush(dt) {
    if (G.rush) {
      G.rush.left -= dt;
      if (G.rush.left <= 0) G.rush = null;
      return;
    }
    if (G.week < RUSH_FROM_WEEK) return;
    G.nextRush -= dt;
    if (G.nextRush > 0) return;
    const colors = [...new Set(G.dests.map((d) => d.color))];
    if (!colors.length) return;
    const color = pick(colors);
    const mult = 2 + Math.min(1.5, (G.week - RUSH_FROM_WEEK) * 0.08);
    G.rush = { color, left: 18, mult };
    G.nextRush = rnd(55, 80) * Math.max(0.5, 1 - (G.week - RUSH_FROM_WEEK) * 0.02);
    toast(`Demand surge in the ${COLORS[color].name} towns.`);
  }

  // When the map has no room for new houses, an old household moves out and a
  // new one (maybe a different colour) moves in, so the roads slowly go out of date.
  function churnHouse() {
    const movable = G.houses.filter((h) => !h.bus && !h.battery && G.cars.every((c) => c.house !== h || c.state === 'home'));
    if (!movable.length) return;
    const h = pick(movable);
    const i = h.i;
    for (const n of [...G.adj[i].keys()]) removeEdge(i, n);
    G.occ[i] = null;
    G.houses = G.houses.filter((x) => x !== h);
    G.cars = G.cars.filter((c) => c.house !== h);
    G.fx.push({ type: 'poof', x: tx(i) + 0.5, y: ty(i) + 0.5, t: 0 });
    const nh = spawnHouse(chooseHouseColor(), null);
    if (nh) G.fx.push({ type: 'poof', x: tx(nh.i) + 0.5, y: ty(nh.i) + 0.5, t: 0 });
    graphChanged();
  }

  // Visitors with no car on the way, plus those whose car is stuck in a jam.
  const waitingAt = (d) => Math.max(0, d.pins - d.assigned + (d.late || 0));
  // 0 when calm. Starts once 3 visitors are waiting, then climbs with the
  // timer once it's past the limit. Drives both the warning pulse and the sound.
  const urgencyOf = (d) => {
    const w = waitingAt(d);
    return w > PIN_LIMIT ? 0.4 + 0.6 * d.overflow : w > 2 ? (0.3 * (w - 2)) / (PIN_LIMIT - 2) : 0;
  };
  const pulsePeriod = (u) => 1.4 - 0.95 * u;

  function step(dt) {
    G.time += dt;

    for (const d of G.dests) {
      d.pinT -= dt;
      if (d.pinT <= 0) {
        d.pins++;
        d.pinT = pinInterval(d) * rnd(0.7, 1.3);
      }
      // Only visitors with no car on the way count towards the timer, so
      // what fails you is cars being stuck or too few houses, not distance.
      if (waitingAt(d) > PIN_LIMIT) d.overflow += OVER_FILL * dt;
      else d.overflow = Math.max(0, d.overflow - OVER_DRAIN * dt);
      if (d.overflow >= 1) { gameOver(d); return; }
    }
    if (!G.targetHit && !modal && G.score >= G.map.target) {
      G.targetHit = true;
      onTargetReached();
      return;
    }

    G.nextHouse -= dt;
    if (G.nextHouse <= 0) {
      if (!spawnHouse(chooseHouseColor(), null) && Math.random() < 0.35) churnHouse();
      G.nextHouse = Math.max(3.4, 6.5 - 0.35 * (G.week - 1)) * rnd(0.75, 1.25);
    }
    updateRush(dt);
    updateTrips(dt);
    updateGens(dt);
    // a heads-up shortly before sunset, when unprotected solar is feeding a town
    if (dayPhase() > 0.68 && dayPhase() < 0.75 && G.duskWarn !== G.week) {
      const exposed = G.houses.filter((h) => h.type === 'solar' && !h.battery && G.adj[h.i].size > 0).length;
      if (exposed) { G.duskWarn = G.week; toast(`Sunset soon. ${exposed} solar ${exposed === 1 ? 'generator stops' : 'generators stop'} until morning.`); }
    }
    const sun = sunUp();
    if (G.lastSun !== undefined && sun !== G.lastSun && G.houses.some((h) => h.type === 'solar')) sfx(sun ? 'dawn' : 'dusk');
    G.lastSun = sun;
    if (!mechSeen.solar && G.houses.some((h) => h.type === 'solar')) mechTip('solar', 'This is a solar generator. It only works in daylight. At night it goes dim and sends nothing. Coal works day and night, and a battery keeps solar running overnight.');
    if (!mechSeen.wind && G.houses.some((h) => h.type === 'wind')) mechTip('wind', 'This is a wind generator. It stops when the wind drops. Batteries keep solar and wind generators running.');
    if (!mechSeen.day && dayPhase() > 0.62 && dayPhase() < 0.75) mechTip('day', 'Evening is coming. Demand is highest in the evening and lowest at night. The bar at the top shows the time of day.');
    G.nextDest -= dt;
    if (G.nextDest <= 0) {
      spawnNewDest();
      G.nextDest = rnd(50, 65);
    }

    G.dispatchT -= dt;
    if (G.dispatchT <= 0) { dispatch(); G.dispatchT = 0.25; }

    for (const c of G.cars) {
      c.prevT = c.t;
      c.prevDk = c.dk;
      updateCar(c, dt);
    }
    updateJams(dt);
    if (G.cars.some((c) => c.state === 'gone')) G.cars = G.cars.filter((c) => c.state !== 'gone');

    for (const f of G.fx) f.t += dt;
    G.fx = G.fx.filter((f) => f.t < 0.8);

    G.weekT += dt;
    if (G.weekT >= WEEK_LEN) {
      G.weekT -= WEEK_LEN;
      G.week++;
      G.res.roads += 15;
      expandBounds();
      showUpgrade();
    }

    G.saveT += dt;
    if (G.saveT > 15) { G.saveT = 0; save(); }
  }

  // ---------------------------------------------------------------- progress
  function getProgress() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(PROGRESS_KEY) || 'null'); } catch (e) { p = null; }
    if (!p) {
      p = { unlocked: 1, best: {} };
      // carry over a best score from before maps existed
      let old = 0;
      try { old = +(localStorage.getItem(BEST_KEY) || 0); } catch (e) { /* storage unavailable */ }
      if (old) {
        p.best.millbrook = old;
        if (old >= MAPS[0].target) p.unlocked = 2;
      }
    }
    return p;
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
    $('#tgText').textContent = `You made ${fmt(G.map.target)} MW in ${G.map.name}. ${next.name} is next. ${next.blurb}`;
    const go = $('#btnTgNext');
    go.textContent = `Play ${next.name}`;
    go.onclick = () => { save(); closeScreen(); startNew(next); };
    openScreen('sTarget');
  }

  function gameOver(d) {
    G.over = true;
    const p = getProgress();
    const prev = p.best[G.map.id] || 0;
    p.best[G.map.id] = Math.max(prev, G.score);
    setProgress(p);
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage unavailable */ }
    G.overDest = d;
    // centre on the problem
    user.zoom = 1; user.px = 0; user.py = 0;
    const game = G;
    setTimeout(() => {
      if (G !== game) return; // a new game started in the meantime
      $('#overWhy').textContent = `The ${COLORS[d.color].name} town in ${game.map.name} went without power for too long.`;
      $('#overScore').textContent = game.score;
      $('#overSub').textContent = `MW in ${game.week} ${game.week === 1 ? 'day' : 'days'}`;
      $('#overBest').textContent = !prev ? '' : game.score > prev ? `New best for ${game.map.name}.` : `Best in ${game.map.name}: ${prev} MW`;
      openScreen('sOver');
    }, 1400);
  }

  // ---------------------------------------------------------------- upgrades
  const UPGRADES = {
    bridges: { label: 'Sea cable', note: 'Cross water', n: 1, icon: '<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round"><path d="M4 34h40" stroke="#7ec0ff" stroke-width="8"/><path d="M6 24c6-8 30-8 36 0" stroke="#2f7fd1" stroke-width="4"/><path d="M6 24h36" stroke="#56658a" stroke-width="6"/></svg>' },
    rounds: { label: '2 transformers', note: 'Busy joins flow better, and never trip', n: 2, icon: '<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round"><path d="M4 24h8M36 24h8" stroke="#56658a" stroke-width="5"/><circle cx="19" cy="24" r="10" stroke="#ffb400" stroke-width="4"/><circle cx="29" cy="24" r="10" stroke="#ffb400" stroke-width="4"/></svg>' },
    motors: { label: 'Express line', note: 'Fast underground link', n: 1, icon: '<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round"><path d="M6 34h36" stroke="#56658a" stroke-width="3" stroke-dasharray="4 4" opacity=".55"/><path d="M4 26a8 8 0 0 1 16 0z" fill="#9aa9c9"/><path d="M7 26a5 5 0 0 1 10 0z" fill="#56658a"/><path d="M28 26a8 8 0 0 1 16 0z" fill="#9aa9c9"/><path d="M31 26a5 5 0 0 1 10 0z" fill="#56658a"/><path d="M2 26h44" stroke="#56658a" stroke-width="3"/></svg>' },
    roads: { label: '20 cable tiles', note: 'More cable to lay', n: 20, icon: '<svg viewBox="0 0 48 48" fill="none" stroke="#56658a" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M8 40V24h16V8h16"/></svg>' },
    tunnels: { label: 'Underground', note: 'Go through a hill', n: 1, icon: '<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M3 40 18 12l7 10 5-6 15 24z" fill="#9aa9c9"/><path d="M15 40v-6a9 9 0 0 1 18 0v6z" fill="#56658a"/><path d="M3 41h42" stroke="#56658a" stroke-width="4"/></svg>' },
    entrances: { label: 'Extra substation', note: 'A second way in for a busy town', n: 1, icon: '<svg viewBox="0 0 48 48" fill="none" stroke-linejoin="round"><rect x="14" y="10" width="20" height="20" rx="4" fill="#ff6a4d"/><rect x="6" y="32" width="10" height="10" rx="2" fill="#a8321c"/><rect x="32" y="32" width="10" height="10" rx="2" fill="#a8321c"/></svg>' },
    dozers: { label: 'Excavator', note: 'Clear 3 hill or water tiles', n: 3, icon: '<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M6 38 18 16l8 12 4-5 12 15z" fill="#9aa9c9"/><rect x="18" y="26" width="18" height="10" rx="2" fill="#e9a93a"/><path d="M14 22v16" stroke="#56658a" stroke-width="4"/><circle cx="22" cy="40" r="3" fill="#0b0f18"/><circle cx="32" cy="40" r="3" fill="#0b0f18"/></svg>' },
    batteries: { label: '2 batteries', note: 'Keep a solar or wind generator running', n: 2, icon: '<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="14" width="30" height="20" rx="4" fill="#ffc83d" stroke="#a67a0c" stroke-width="3"/><rect x="38" y="20" width="4" height="8" rx="1.5" fill="#a67a0c"/><path d="M25 17l-6 8h5l-2 6 7-9h-5z" fill="#fff"/></svg>' },
    moves: { label: 'Move a generator', note: 'Move 2 generators somewhere better', n: 2, icon: '<svg viewBox="0 0 48 48" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="26" width="14" height="14" rx="3" fill="#ff6a4d" opacity=".35"/><rect x="24" y="8" width="18" height="18" rx="4" fill="#ff6a4d"/><path d="M34 11l-6 8h5l-2 6 7-9h-5z" fill="#a8321c"/><path d="M16 32c3-8 8-12 12-12" stroke="#56658a" stroke-width="3"/></svg>' },
  };

  function upgradeKeys() {
    return Object.keys(UPGRADES).filter((k) => (k !== 'tunnels' || G.map.hills > 0) && (k !== 'batteries' || G.houses.some((h) => h.type && h.type !== 'coal')));
  }

  // Three different choices: always one of road tiles, a bridge or a tunnel,
  // always a roundabout or a motorway, then one more from anything left.
  function pickUpgrades() {
    const keys = upgradeKeys();
    const out = [];
    const take = (list) => {
      const pool = list.filter((k) => keys.includes(k) && !out.includes(k));
      if (pool.length) out.push(pick(pool));
    };
    take(['roads', 'bridges', 'tunnels']);
    take(['rounds', 'motors']);
    take(keys);
    return out;
  }

  function showUpgrade() {
    $('#upTitle').textContent = `Day ${G.week}`;
    $('#upText').textContent = 'A new day. You get 15 more cable tiles. Pick one upgrade.';
    const box = $('#choices');
    box.innerHTML = '';
    for (const k of pickUpgrades()) {
      const u = UPGRADES[k];
      const btn = document.createElement('button');
      btn.className = 'choice';
      btn.innerHTML = `${u.icon}<span>${u.label}</span><small>${u.note}</small>`;
      btn.addEventListener('click', () => {
        G.res[k] += u.n;
        G.owned[k] = true;
        hudCache = '';
        closeScreen();
        measure();
        save();
      });
      box.appendChild(btn);
    }
    openScreen('sUpgrade');
  }

  // ---------------------------------------------------------------- save / load
  function save() {
    if (!G || G.over || G.demo) return;
    const roads = [], water = [], mount = [], rounds = [], deco = [], overpass = [];
    for (let i = 0; i < G.N; i++) {
      if (G.road[i]) roads.push(i);
      if (G.water[i]) water.push(i);
      if (G.mount[i]) mount.push(i);
      if (G.round[i]) rounds.push(i);
      if (G.overpass[i]) overpass.push(i);
      if (G.deco[i]) deco.push(i, G.deco[i]);
    }
    const data = {
      v: 3, map: G.map.id, targetHit: G.targetHit, W: G.W, H: G.H, roads, water, mount, rounds, overpass, deco,
      edges: [...G.edges.values(), ...G.trips.map((t) => t.e)].map((e) => [e.a, e.b, e.type === 'motor' ? 1 : 0, e.from === undefined ? -1 : e.from]),
      houses: G.houses.map((h) => [h.i, h.color, h.bus ? 1 : 0, h.type || 'coal', h.battery ? 1 : 0]),
      dests: G.dests.map((d) => [d.x, d.y, d.ports, d.color, d.pins, d.overflow, d.pinT, d.bigPark ? 1 : 0]),
      res: G.res, owned: G.owned, time: G.time, week: G.week, weekT: G.weekT, score: G.score,
      bounds: G.bounds, colorsUsed: G.colorsUsed, nextHouse: G.nextHouse, nextDest: G.nextDest,
      speed: G.speed,
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) { /* storage unavailable */ }
  }

  function load() {
    let data;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { data = null; }
    if (!data || ![1, 2, 3].includes(data.v)) return false;
    G = blankState(data.W, data.H);
    G.map = MAPS.find((m) => m.id === data.map) || MAPS[0];
    G.targetHit = !!data.targetHit;
    for (const i of data.water) G.water[i] = 1;
    for (const i of data.mount || []) G.mount[i] = 1;
    for (const i of data.roads) G.road[i] = 1;
    for (const i of data.rounds) G.round[i] = 1;
    for (const i of data.overpass || []) G.overpass[i] = 1;
    for (let k = 0; k < data.deco.length; k += 2) G.deco[data.deco[k]] = data.deco[k + 1];
    for (const [a, b, m, from] of data.edges) {
      const e = addEdge(a, b, m ? 'motor' : 'road');
      if (from !== undefined && from >= 0) e.from = from;
    }
    for (const [x, y, ports, color, pins, overflow, pinT, bigPark] of data.dests) {
      const list = Array.isArray(ports) ? ports : [ports];
      const d = { id: G.nextId++, color, x, y, ports: list, pins, assigned: 0, overflow, pinT, born: -10, bigPark: !!bigPark };
      for (const c of [idx(x, y), idx(x + 1, y), idx(x, y + 1), idx(x + 1, y + 1)]) G.occ[c] = { kind: 'dest', d };
      for (const p of list) G.occ[p] = { kind: 'port', d };
      G.dests.push(d);
    }
    for (const [i, color, bus, type, battery] of data.houses) {
      const h = { id: G.nextId++, color, i, born: -10, bus: !!bus, type: type || 'coal', battery: !!battery };
      G.occ[i] = { kind: 'house', h };
      G.houses.push(h);
      if (h.bus) addCar(h, true);
      else for (let k = 0; k < CARS_PER_HOUSE; k++) addCar(h);
    }
    Object.assign(G.res, data.res);
    G.owned = data.owned || {};
    undoStack = [];
    pendingSnap = null;
    Object.assign(G, {
      time: data.time, week: data.week, weekT: data.weekT, score: data.score, bounds: data.bounds,
      colorsUsed: data.colorsUsed, nextHouse: data.nextHouse, nextDest: data.nextDest, speed: data.speed || 1,
    });
    user.zoom = 1; user.px = 0; user.py = 0;
    camSnap = true;
    graphChanged();
    return true;
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
    // Only allow panning as far as zoom makes room for, so the town stays on screen.
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

  function lastFeedback(res) {
    if (res === 'roads') { toast('Out of cable. Erase some, or wait for the next day.'); flashCount('road'); }
    else if (res === 'bridges') { toast('You need a sea cable to cross water.'); flashCount('bridge'); }
    else if (res === 'tunnels') { toast(G.map.hills ? 'You need an underground cable to go through a hill.' : 'Hills block cables.'); flashCount('tunnel'); }
    else if (res === 'long') toast(`That's too long. Sea cables and underground cables can be up to ${MAX_SPAN} tiles.`);
  }

  function roadMove(wx, wy, a) {
    const c = tileAtWorld(wx, wy);
    if (c < 0 || c === a.last) return;
    if (a.last < 0) {
      if (kind(c) !== null && inB(tx(c), ty(c))) a.last = c;
      return;
    }
    const cx = tx(c) + 0.5, cy = ty(c) + 0.5;
    const near = Math.hypot(wx - cx, wy - cy) < 0.46;
    const lx = tx(a.last), ly = ty(a.last);
    const cheb = Math.max(Math.abs(tx(c) - lx), Math.abs(ty(c) - ly));
    if (!near && cheb <= 1) return;
    let cur = a.last;
    let guard = 0;
    while (cur !== c && guard++ < 64) {
      const nx = stepToward(cur, c);
      const r = tryConnect(cur, nx);
      if (r !== 'ok') {
        if (!a.warned) { lastFeedback(r); if (r !== 'bad' && r !== 'bounds') a.warned = true; }
        // let the stroke restart from a valid tile under the finger
        if (r === 'bad' && kind(nx) !== null) { cur = nx; continue; }
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

  let moveFrom = null;

  // Taps for the upgrade tools. Each returns to the road tool once used up.
  function tapTool(t, c) {
    const done = (key) => { if (G.res[key] <= 0) setTool('road'); };
    if (t === 'entrance') { if (addEntrance(c)) done('entrances'); }
    else if (t === 'dozer') { if (bulldoze(c)) done('dozers'); }
    else if (t === 'battery') {
      const o = G.occ[c];
      if (!o || o.kind !== 'house') toast('Tap a generator to give it a battery.');
      else if (o.h.type === 'coal' || !o.h.type) toast('Coal runs all the time. Give the battery to a solar or wind generator.');
      else if (o.h.battery) toast('That generator already has a battery.');
      else {
        o.h.battery = true;
        G.res.batteries--;
        G.fx.push({ type: 'poof', x: tx(c) + 0.5, y: ty(c) + 0.5, t: 0 });
        done('batteries');
      }
    }
    else if (t === 'move') {
      const o = G.occ[c];
      if (!moveFrom) {
        if (o && o.kind === 'house') { moveFrom = o.h; toast('Now tap where the generator should go.'); }
        else toast('Tap the generator you want to move.');
      } else if (o && o.kind === 'house') {
        moveFrom = o.h === moveFrom ? null : o.h;
      } else if (moveHouse(moveFrom, c)) {
        moveFrom = null;
        done('moves');
      }
    }
  }

  function resetTouches() {
    pointers.clear();
    action = null;
    pinch = null;
    gestureLock = false;
  }

  function onDown(e) {
    if (!G || modal) return;
    if (inspect) { closeInspect(); return; }
    const arrow = e.isPrimary && edgeArrows.find((a) => Math.hypot(a.x - e.clientX, a.y - e.clientY) < 26);
    if (arrow) { lookAt(arrow.d); return; }
    // A primary pointer means no other finger is down, so anything still
    // tracked is stale (iOS can swallow a finger lift near the Home bar).
    if (e.isPrimary) resetTouches();
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1 && !gestureLock) {
      const wx = wxOf(e.clientX), wy = wyOf(e.clientY);
      commitUndo();
      if (UNDO_TOOLS.has(tool)) pendingSnap = snapNet();
      action = { tool, sx: e.clientX, sy: e.clientY, moved: false, last: -1, warned: false };
      if (tool === 'road') {
        const c = tileAtWorld(wx, wy);
        if (c >= 0 && kind(c) !== null && inB(tx(c), ty(c))) action.last = c;
      } else if (tool === 'erase') {
        eraseMove(wx, wy, action);
      }
    } else if (pointers.size === 2) {
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
      if (G && !modal && e.pointerType === 'mouse') {
        hoverTile = tileAtWorld(wxOf(e.clientX), wyOf(e.clientY));
      }
      return;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [p1, p2] = [...pointers.values()];
      const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
      const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      user.zoom = clamp(pinch.z0 * d / pinch.d0, 1, 3.2);
      const b = baseCam();
      const s = b.s * user.zoom;
      const cx = pinch.wx - (mx - screenCenterX()) / s;
      const cy = pinch.wy - (my - screenCenterY()) / s;
      user.px = cx - b.x; user.py = cy - b.y;
      camSnap = true;
      return;
    }
    if (!action) return;
    if (Math.hypot(e.clientX - action.sx, e.clientY - action.sy) > 6) action.moved = true;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (events.length ? events : [e])) {
      const wx = wxOf(ev.clientX), wy = wyOf(ev.clientY);
      if (action.tool === 'road') roadMove(wx, wy, action);
      else if (action.tool === 'erase') eraseMove(wx, wy, action);
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
    setTimeout(commitUndo, 0); // after this lift's taps have been applied
    if (a.moved || e.type === 'pointercancel') return;
    const c = tileAtWorld(wxOf(e.clientX), wyOf(e.clientY));
    if (c < 0) return;
    const tripped = G.trips.filter((t) => base(t.e.a) === c || base(t.e.b) === c);
    if (tripped.length) { tripped.forEach(restoreTrip); sfx('reset'); toast('Breaker reset.'); return; }
    if (a.tool === 'road' && destAt(c) && !G.over) { openInspect(destAt(c)); return; }
    tapTool(a.tool, c);
    if (a.tool === 'round') {
      if (placeRoundabout(c) && G.res.rounds <= 0) setTool('road');
    } else if (a.tool === 'motor') {
      if (G.res.motors <= 0) { toast('No express lines left. You can pick more at the end of the day.'); return; }
      if (motorStart < 0) {
        const k = kind(c);
        if ((k === 'road' || k === 'land') && !rough(c) && inB(tx(c), ty(c))) { motorStart = c; toast('Now tap where the underground cable should come out.'); }
        else toast('Tap an empty tile or a cable to start the underground cable.');
      } else if (c === motorStart) {
        motorStart = -1;
      } else if (inB(tx(c), ty(c))) {
        if (placeMotorway(motorStart, c)) { motorStart = -1; setTool('road'); }
      }
    }
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
        if (rough(i) || G.road[i] || G.occ[i]) continue;
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
        if (!G.mount[i] || G.road[i]) continue;
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
    ctx.fillStyle = 'rgba(220,235,255,0.35)';
    const bx0 = sx(B.x0), by0 = sy(B.y0), bx1 = sx(B.x1 + 1), by1 = sy(B.y1 + 1);
    ctx.fillRect(sx(0), sy(0), G.W * s, by0 - sy(0));
    ctx.fillRect(sx(0), by1, G.W * s, sy(G.H) - by1);
    ctx.fillRect(sx(0), by0, bx0 - sx(0), by1 - by0);
    ctx.fillRect(bx1, by0, sx(G.W) - bx1, by1 - by0);

    // roads
    const roadEdges = [];
    const motorEdges = [];
    for (const e of G.edges.values()) (e.type === 'motor' ? motorEdges : roadEdges).push(e);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const line = (e) => { ctx.moveTo(sx(tx(e.a) + 0.5), sy(ty(e.a) + 0.5)); ctx.lineTo(sx(tx(e.b) + 0.5), sy(ty(e.b) + 0.5)); };

    // express tunnels run underground: a faint dashed line under everything,
    // with their cars as faint shapes, so nothing on the surface is hidden
    for (const e of motorEdges) {
      ctx.strokeStyle = 'rgba(255,212,94,0.10)';
      ctx.lineWidth = s * 0.5;
      ctx.beginPath(); line(e); ctx.stroke();
      if (e.jam > 0.06) {
        ctx.strokeStyle = `rgba(226,74,40,${Math.min(0.5, e.jam * 0.6).toFixed(3)})`;
        ctx.beginPath(); line(e); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,212,94,0.7)';
      ctx.lineWidth = Math.max(1.5, s * 0.08);
      ctx.setLineDash([s * 0.22, s * 0.2]);
      ctx.beginPath(); line(e); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 0.5;
    drawCars(true);
    ctx.globalAlpha = 1;
    // bridge decks
    // sea cables: a lit channel under the cable
    ctx.strokeStyle = 'rgba(74,168,255,0.35)';
    ctx.lineWidth = s * 0.5;
    ctx.beginPath();
    for (const e of roadEdges) if (G.water[e.a] || G.water[e.b]) line(e);
    ctx.stroke();
    // cables are thin lines with a soft glow, not fat roads
    ctx.strokeStyle = 'rgba(120,170,255,0.13)';
    ctx.lineWidth = s * 0.62;
    ctx.beginPath();
    for (const e of roadEdges) line(e);
    ctx.stroke();
    ctx.strokeStyle = PAL.roadEdge;
    ctx.lineWidth = s * 0.26;
    ctx.beginPath();
    for (const e of roadEdges) line(e);
    ctx.stroke();
    ctx.strokeStyle = PAL.road;
    ctx.lineWidth = s * 0.15;
    ctx.beginPath();
    for (const e of roadEdges) line(e);
    ctx.stroke();
    // current flowing along every cable
    ctx.strokeStyle = 'rgba(210,230,255,0.45)';
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.setLineDash([s * 0.12, s * 0.38]);
    ctx.lineDashOffset = -(G.time * s * 0.7) % (s * 0.5);
    ctx.beginPath();
    for (const e of roadEdges) line(e);
    ctx.stroke();
    ctx.setLineDash([]);
    // overload: cables run hot, glowing amber then red
    ctx.lineWidth = s * 0.2;
    for (const e of roadEdges) {
      if (!(e.jam > 0.06)) continue;
      const g = Math.round(200 - 120 * Math.min(1, e.jam));
      ctx.strokeStyle = `rgba(255,${g},60,${Math.min(0.95, 0.3 + e.jam * 0.7).toFixed(3)})`;
      ctx.beginPath(); line(e); ctx.stroke();
    }
    // one-way arrows
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = Math.max(1.2, s * 0.06);
    for (const e of roadEdges) {
      if (e.from === undefined) continue;
      const to = e.from === e.a ? e.b : e.a;
      const ax = tx(e.from) + 0.5, ay = ty(e.from) + 0.5, bx = tx(to) + 0.5, by = ty(to) + 0.5;
      ctx.save();
      ctx.translate(sx((ax + bx) / 2), sy((ay + by) / 2));
      ctx.rotate(Math.atan2(by - ay, bx - ax));
      ctx.beginPath();
      ctx.moveTo(-s * 0.1, -s * 0.12); ctx.lineTo(s * 0.05, 0); ctx.lineTo(-s * 0.1, s * 0.12);
      ctx.stroke();
      ctx.restore();
    }
    // lone road tiles and node caps
    ctx.fillStyle = PAL.road;
    for (let y = vy0; y <= vy1; y++) {
      for (let x = vx0; x <= vx1; x++) {
        const i = idx(x, y);
        if (G.road[i] && G.adj[i].size === 0) {
          ctx.beginPath(); ctx.arc(sx(x + 0.5), sy(y + 0.5), s * 0.13, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    // roundabouts
    for (let y = vy0; y <= vy1; y++) {
      for (let x = vx0; x <= vx1; x++) {
        const i = idx(x, y);
        if (!G.round[i]) continue;
        const cx = sx(x + 0.5), cy = sy(y + 0.5);
        // transformer: a coil of rings with a bright core
        ctx.fillStyle = '#10182a';
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.42, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#ffd45e';
        ctx.lineWidth = Math.max(1.5, s * 0.07);
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.36, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = Math.max(1, s * 0.04);
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.25, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#ffd45e';
        ctx.beginPath(); ctx.arc(cx, cy, s * 0.1, 0, Math.PI * 2); ctx.fill();
      }
    }
    // crossings
    for (let y = vy0; y <= vy1; y++) {
      for (let x = vx0; x <= vx1; x++) {
        if (!G.overpass[idx(x, y)]) continue;
        // the east-west cable hops over the north-south one
        const xc = sx(x + 0.5), yc = sy(y + 0.5);
        ctx.fillStyle = PAL.land;
        ctx.beginPath(); ctx.arc(xc, yc, s * 0.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = PAL.road;
        ctx.lineWidth = s * 0.15;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sx(x) - s * 0.05, yc);
        ctx.lineTo(xc - s * 0.3, yc);
        ctx.arc(xc, yc, s * 0.3, Math.PI, 0);
        ctx.lineTo(sx(x + 1) + s * 0.05, yc);
        ctx.stroke();
      }
    }

    // cars on ordinary roads
    drawCars(false);

    // tunnels: cover the road inside the hill, and draw a mouth at each end
    ctx.fillStyle = 'rgba(195,180,154,0.82)';
    for (let y = vy0; y <= vy1; y++) {
      for (let x = vx0; x <= vx1; x++) {
        const i = idx(x, y);
        if (G.mount[i] && G.road[i]) ctx.fillRect(sx(x) - 0.5, sy(y) - 0.5, s + 1, s + 1);
      }
    }
    ctx.fillStyle = '#3a332b';
    for (const e of roadEdges) {
      if (!G.mount[e.a] === !G.mount[e.b]) continue;
      const inside = G.mount[e.a] ? e.a : e.b;
      const outside = inside === e.a ? e.b : e.a;
      const ix = tx(inside) + 0.5, iy = ty(inside) + 0.5, ox = tx(outside) + 0.5, oy = ty(outside) + 0.5;
      const mx = (ix + ox) / 2, my = (iy + oy) / 2;
      ctx.save();
      ctx.translate(sx(mx), sy(my));
      ctx.rotate(Math.atan2(oy - iy, ox - ix));
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.32, -Math.PI / 2, Math.PI / 2, true);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // destinations
    for (const d of G.dests) drawDest(d);
    // houses
    for (const h of G.houses) drawHouse(h);

    // express tunnel entrances: a tunnel mouth at each end, facing the other end
    for (const e of motorEdges) {
      for (const [n, o] of [[e.a, e.b], [e.b, e.a]]) {
        const ang = Math.atan2(ty(o) - ty(n), tx(o) - tx(n));
        ctx.save();
        ctx.translate(sx(tx(n) + 0.5), sy(ty(n) + 0.5));
        ctx.rotate(ang);
        ctx.fillStyle = PAL.mountLight;
        ctx.beginPath(); ctx.arc(0, 0, s * 0.42, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#3a332b';
        ctx.beginPath(); ctx.arc(0, 0, s * 0.3, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }

    // effects
    for (const f of G.fx) {
      const k = f.t / 0.8;
      if (f.type === 'ring') {
        ctx.strokeStyle = f.color;
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = s * 0.1;
        ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), s * (0.3 + k * 0.6), 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (f.type === 'poof') {
        ctx.fillStyle = 'rgba(120,120,120,' + (0.5 * (1 - k)) + ')';
        ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), s * (0.15 + k * 0.4), 0, Math.PI * 2); ctx.fill();
      }
    }

    // tool hints
    if (tool === 'motor' && motorStart >= 0) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
      ctx.strokeStyle = PAL.motorLine;
      ctx.lineWidth = s * 0.12;
      ctx.beginPath(); ctx.arc(sx(tx(motorStart) + 0.5), sy(ty(motorStart) + 0.5), s * (0.42 + pulse * 0.1), 0, Math.PI * 2); ctx.stroke();
    }
    if (action && action.tool === 'road' && action.last >= 0) {
      ctx.strokeStyle = 'rgba(220,235,255,0.45)';
      ctx.lineWidth = Math.max(1.5, s * 0.06);
      ctx.beginPath(); ctx.arc(sx(tx(action.last) + 0.5), sy(ty(action.last) + 0.5), s * 0.46, 0, Math.PI * 2); ctx.stroke();
    }
    if (tool === 'move' && moveFrom) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 180);
      ctx.strokeStyle = COLORS[moveFrom.color].dark;
      ctx.lineWidth = s * 0.1;
      ctx.beginPath(); ctx.arc(sx(tx(moveFrom.i) + 0.5), sy(ty(moveFrom.i) + 0.5), s * (0.5 + pulse * 0.1), 0, Math.PI * 2); ctx.stroke();
    }
    if (hoverTile >= 0 && !action && tool !== 'road') {
      ctx.strokeStyle = 'rgba(220,235,255,0.3)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx(tx(hoverTile)) + 1, sy(ty(hoverTile)) + 1, s - 2, s - 2);
    }

    if (G.over && G.overDest) {
      const d = G.overDest;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 150);
      ctx.strokeStyle = COLORS[d.color].fill;
      ctx.lineWidth = s * 0.15;
      ctx.globalAlpha = 0.5 + pulse * 0.5;
      ctx.beginPath(); ctx.arc(sx(d.x + 1), sy(d.y + 1), s * (1.8 + pulse * 0.3), 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    drawTipHighlights();
    drawInspect();
    drawEdgeArrows();
    drawTrips();
    drawNight();
  }

  function drawTrips() {
    const s = cam.s;
    for (const t of G.trips) {
      const a = base(t.e.a), b = base(t.e.b);
      const x1 = sx(tx(a) + 0.5), y1 = sy(ty(a) + 0.5), x2 = sx(tx(b) + 0.5), y2 = sy(ty(b) + 0.5);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
      // dashed ghost of the missing cable, with a flashing bolt in the gap
      ctx.save();
      ctx.strokeStyle = `rgba(255,106,77,${0.35 + 0.3 * pulse})`;
      ctx.lineWidth = s * 0.3;
      ctx.setLineDash([s * 0.18, s * 0.18]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(255,106,77,${0.8 + 0.2 * pulse})`;
      ctx.beginPath(); ctx.arc(mx, my, s * (0.3 + 0.05 * pulse), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      const r = s * 0.2;
      ctx.beginPath();
      ctx.moveTo(mx + r * 0.25, my - r); ctx.lineTo(mx - r * 0.6, my + r * 0.1); ctx.lineTo(mx - r * 0.05, my + r * 0.1);
      ctx.lineTo(mx - r * 0.25, my + r); ctx.lineTo(mx + r * 0.6, my - r * 0.1); ctx.lineTo(mx + r * 0.05, my - r * 0.1);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // Overnight the board dims; in the evening peak it warms up slightly.
  function drawNight() {
    const p = dayPhase();
    const night = Math.min(1, Math.max(0, -Math.sin(2 * Math.PI * (p - 0.25)) * 1.5));
    const dusk = Math.min(1, Math.max(0, 1 - Math.abs(p - 0.78) / 0.1));
    const dark = night * 0.3, warm = dusk * 0.07;
    if (dark <= 0 && warm <= 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = dark > 0 ? `rgba(2,4,16,${dark.toFixed(3)})` : `rgba(255,170,60,${warm.toFixed(3)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  function drawCars(motor) {
    const s = cam.s;
    for (const c of G.cars) {
      if (!!c.motor !== motor && c.state === 'drive') continue;
      if (motor && c.state !== 'drive') continue;
      const p = carPos(c);
      if (!p) continue;
      c.ang = p.ang;
      const col = COLORS[c.color];
      ctx.save();
      ctx.translate(sx(p.x), sy(p.y));
      ctx.rotate(p.ang);
      const L = s * (c.bus ? 0.6 : 0.36), Wd = s * (c.bus ? 0.25 : 0.21);
      const rad = c.bus ? Wd * 0.95 : Wd * 0.62;
      const a0 = ctx.globalAlpha;
      if (c.leg === 'back') {
        // spent: an empty ring heading home to recharge
        ctx.strokeStyle = col.fill;
        ctx.globalAlpha = a0 * 0.6;
        ctx.lineWidth = Math.max(1, s * 0.04);
        ctx.beginPath(); ctx.arc(0, 0, rad * 0.75, 0, Math.PI * 2); ctx.stroke();
      } else {
        // charged: a glowing pulse carrying power to a town
        ctx.fillStyle = col.fill;
        ctx.globalAlpha = a0 * 0.22;
        ctx.beginPath(); ctx.arc(0, 0, rad * 2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = a0;
        ctx.beginPath(); ctx.arc(0, 0, rad, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.beginPath(); ctx.arc(0, 0, rad * 0.42, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
  }

  // One shape per colour, so colours can be told apart without relying on hue.
  function drawSymbol(color, cx, cy, r, fill) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = fill;
    ctx.lineCap = 'round';
    ctx.beginPath();
    switch (color % 6) {
      case 0: ctx.arc(cx, cy, r * 0.8, 0, Math.PI * 2); ctx.fill(); break;
      case 1: ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.95, cy + r * 0.7); ctx.lineTo(cx - r * 0.95, cy + r * 0.7); ctx.closePath(); ctx.fill(); break;
      case 2: ctx.rect(cx - r * 0.72, cy - r * 0.72, r * 1.44, r * 1.44); ctx.fill(); break;
      case 3: ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.8, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.8, cy); ctx.closePath(); ctx.fill(); break;
      case 4: ctx.lineWidth = r * 0.55; ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.stroke(); break;
      default: ctx.lineWidth = r * 0.55; ctx.moveTo(cx - r * 0.75, cy - r * 0.75); ctx.lineTo(cx + r * 0.75, cy + r * 0.75); ctx.moveTo(cx + r * 0.75, cy - r * 0.75); ctx.lineTo(cx - r * 0.75, cy + r * 0.75); ctx.stroke();
    }
  }

  function drawGenGlyph(h, cx, cy, size, ink) {
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineCap = 'round';
    if (h.type === 'solar') {
      ctx.beginPath(); ctx.arc(cx, cy, size * 0.15, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = Math.max(1, size * 0.07);
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = k * Math.PI / 4;
        ctx.moveTo(cx + Math.cos(a) * size * 0.24, cy + Math.sin(a) * size * 0.24);
        ctx.lineTo(cx + Math.cos(a) * size * 0.36, cy + Math.sin(a) * size * 0.36);
      }
      ctx.stroke();
    } else if (h.type === 'wind') {
      const spin = genOnline(h) ? G.time * 2.2 : 0.4;
      ctx.lineWidth = Math.max(1, size * 0.07);
      ctx.beginPath(); ctx.moveTo(cx, cy - size * 0.05); ctx.lineTo(cx, cy + size * 0.36); ctx.stroke();
      ctx.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = spin + k * Math.PI * 2 / 3;
        ctx.moveTo(cx, cy - size * 0.05);
        ctx.lineTo(cx + Math.sin(a) * size * 0.34, cy - size * 0.05 - Math.cos(a) * size * 0.34);
      }
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(cx + size * 0.08, cy - size * 0.34);
      ctx.lineTo(cx - size * 0.2, cy + size * 0.02);
      ctx.lineTo(cx - size * 0.02, cy + size * 0.02);
      ctx.lineTo(cx - size * 0.1, cy + size * 0.28);
      ctx.lineTo(cx + size * 0.22, cy - size * 0.1);
      ctx.lineTo(cx + size * 0.03, cy - size * 0.1);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawHouse(h) {
    const s = cam.s;
    const x = tx(h.i), y = ty(h.i);
    const k = popScale(h.born);
    if (k <= 0) return;
    const col = COLORS[h.color];
    const cx = sx(x + 0.5), cy = sy(y + 0.5);
    const size = s * 0.66 * k;
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    rr(cx - size / 2 + s * 0.05, cy - size / 2 + s * 0.08, size, size, size * 0.22);
    ctx.fill();
    ctx.fillStyle = col.fill;
    rr(cx - size / 2, cy - size / 2, size, size, size * 0.22);
    ctx.fill();
    if (shapesOn) {
      drawSymbol(h.color, cx, cy - size * 0.1, size * 0.2, '#fff');
    } else {
      // roof ridge
      drawGenGlyph(h, cx, cy, size, col.dark);
    }
    if (!genOnline(h)) {
      // offline: dimmed until the sun comes up or the wind returns
      ctx.fillStyle = 'rgba(11,15,24,0.55)';
      rr(cx - size / 2, cy - size / 2, size, size, size * 0.22);
      ctx.fill();
    }
    if (h.battery) {
      const bw = size * 0.3, bh = size * 0.17;
      ctx.fillStyle = '#fff';
      rr(cx + size * 0.2, cy - size * 0.58, bw, bh, bh * 0.25);
      ctx.fill();
      ctx.fillRect(cx + size * 0.2 + bw, cy - size * 0.58 + bh * 0.3, bh * 0.2, bh * 0.4);
    }
    // cars at home
    let home = 0;
    for (const c of G.cars) if (c.house === h && c.state === 'home') home++;
    ctx.fillStyle = shapesOn ? col.dark : '#fff';
    for (let n = 0; n < home; n++) {
      ctx.beginPath();
      ctx.arc(cx + (n - (home - 1) / 2) * size * 0.26, cy + size * (shapesOn ? 0.29 : 0.2), s * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
    if (h.cut) {
      // can't reach its building: gentle pulse ring
      const pulse = 0.5 + 0.5 * Math.sin(G.time * 4 + h.id);
      ctx.strokeStyle = col.fill;
      ctx.globalAlpha = 0.25 + 0.35 * pulse;
      ctx.lineWidth = Math.max(1, s * 0.05);
      ctx.beginPath(); ctx.arc(cx, cy, s * 0.55, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawDest(d) {
    const s = cam.s;
    const k = popScale(d.born);
    if (k <= 0) return;
    const col = COLORS[d.color];
    const cx = sx(d.x + 1), cy = sy(d.y + 1);
    const w = s * 1.76 * k;
    // substations: a cable from the town to a round terminal with a bolt on it
    for (const port of d.ports) {
      const px = sx(tx(port) + 0.5), py = sy(ty(port) + 0.5);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(120,170,255,0.13)';
      ctx.lineWidth = s * 0.62;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
      ctx.strokeStyle = col.dark;
      ctx.lineWidth = s * 0.2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
      ctx.fillStyle = col.dark;
      ctx.beginPath(); ctx.arc(px, py, s * 0.32, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col.fill;
      ctx.lineWidth = Math.max(1, s * 0.06);
      ctx.beginPath(); ctx.arc(px, py, s * 0.32, 0, Math.PI * 2); ctx.stroke();
      if (d.bigPark) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = Math.max(1, s * 0.04);
        ctx.beginPath(); ctx.arc(px, py, s * 0.42, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      const br = s * 0.2;
      ctx.beginPath();
      ctx.moveTo(px + br * 0.25, py - br); ctx.lineTo(px - br * 0.6, py + br * 0.1); ctx.lineTo(px - br * 0.05, py + br * 0.1);
      ctx.lineTo(px - br * 0.25, py + br); ctx.lineTo(px + br * 0.6, py - br * 0.1); ctx.lineTo(px + br * 0.05, py - br * 0.1);
      ctx.closePath(); ctx.fill();
    }

    const waiting = waitingAt(d);
    const over = waiting > PIN_LIMIT;
    if (d.cut && !over) {
      // no matching house can reach it yet: same pulse ring as a cut-off house
      const pulse = 0.5 + 0.5 * Math.sin(G.time * 4 + d.id);
      ctx.strokeStyle = col.fill;
      ctx.globalAlpha = 0.25 + 0.35 * pulse;
      ctx.lineWidth = Math.max(1.5, s * 0.08);
      ctx.beginPath(); ctx.arc(cx, cy, w * 0.82, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (G.rush && G.rush.color === d.color) {
      // rush hour: a dashed ring spins round the building
      ctx.save();
      ctx.strokeStyle = col.dark;
      ctx.lineWidth = Math.max(2, s * 0.1);
      ctx.setLineDash([s * 0.28, s * 0.22]);
      ctx.lineDashOffset = -G.time * s * 0.6;
      ctx.beginPath(); ctx.arc(cx, cy, w * 0.78, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    const u = urgencyOf(d);
    const phase = u > 0 ? (G.time % pulsePeriod(u)) / pulsePeriod(u) : 0;
    if (u > 0) {
      // ripples spreading out from the building, faster and stronger as it fills
      ctx.strokeStyle = over ? col.dark : col.fill;
      ctx.lineWidth = Math.max(2, s * (0.08 + 0.14 * u));
      for (const off of [0, 0.5]) {
        const p = (phase + off) % 1;
        ctx.globalAlpha = (1 - p) * (0.35 + 0.6 * u);
        ctx.beginPath(); ctx.arc(cx, cy, w * (0.62 + 0.8 * p), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    const shake = over ? Math.sin(G.time * 30) * s * 0.04 : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    rr(cx - w / 2 + s * 0.08, cy - w / 2 + s * 0.12, w, w, s * 0.28);
    ctx.fill();
    ctx.fillStyle = col.fill;
    rr(cx - w / 2 + shake, cy - w / 2, w, w, s * 0.28);
    ctx.fill();
    if (over) {
      // the building flashes bright on each pulse
      ctx.fillStyle = `rgba(255,255,255,${0.55 * Math.max(0, 1 - phase * 2.5)})`;
      rr(cx - w / 2 + shake, cy - w / 2, w, w, s * 0.28);
      ctx.fill();
    }
    ctx.strokeStyle = col.dark;
    ctx.lineWidth = Math.max(1, s * 0.06);
    rr(cx - w / 2 + shake + s * 0.18, cy - w / 2 + s * 0.18, w - s * 0.36, w - s * 0.36, s * 0.16);
    ctx.stroke();

    // pins: solid dots are waiting for a car, rings have a car on the way
    const n = Math.min(d.pins, 12);
    const cols = 4;
    const gap = w * 0.2;
    ctx.lineWidth = Math.max(1, s * 0.035);
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const px2 = cx - gap * 1.5 + c * gap + shake;
      const py2 = cy - gap * 0.9 + r * gap * 0.9;
      ctx.beginPath(); ctx.arc(px2, py2, s * 0.085, 0, Math.PI * 2);
      if (i < waiting) {
        ctx.fillStyle = i >= PIN_LIMIT ? '#24262c' : '#fff';
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.stroke();
      }
    }

    if (shapesOn) {
      const bx = cx + w / 2 - s * 0.08, by = cy - w / 2 + s * 0.08;
      ctx.fillStyle = col.dark;
      ctx.beginPath(); ctx.arc(bx, by, s * 0.3, 0, Math.PI * 2); ctx.fill();
      drawSymbol(d.color, bx, by, s * 0.16, '#fff');
    }

    if (d.overflow > 0.001) {
      const R = s * 1.4;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = s * 0.34;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(36,38,44,0.22)';
      ctx.lineWidth = s * 0.24;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = col.dark;
      ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, d.overflow)); ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- HUD + screens
  const el = {
    top: $('#top'), bottom: $('#bottom'), score: $('#score'), weekLabel: $('#weekLabel'), weekBar: $('#weekBar'),
    cRoads: $('#cRoads'), cRounds: $('#cRounds'), cMotors: $('#cMotors'), cBridges: $('#cBridges'),
    cTunnels: $('#cTunnels'), tunnelTool: $('#tunnelTool'), scoreSub: $('#scoreSub'),
    cut: $('#cutPill'), cCut: $('#cCut'), btnFit: $('#btnFit'), btnUndo: $('#btnUndo'),
    btnPause: $('#btnPause'), btnSpeed: $('#btnSpeed'), toast: $('#toast'),
  };
  const ICON_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>';
  const ICON_PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';

  let hudCache = '';
  function updateHud() {
    if (!G) return;
    const zoomed = user.zoom > 1.02;
    const key = [G.score, G.week, Math.floor(G.weekT), JSON.stringify(G.res), Object.keys(G.owned).join(), G.bridgesUsed,
      G.tunnelsUsed, G.cutOff, G.targetHit, zoomed, undoStack.length, !!(pendingSnap && pendingSnap.ver !== G.gver), G.map.id, G.paused, G.speed, tool].join('|');
    el.weekBar.style.width = (G.weekT / WEEK_LEN * 100).toFixed(1) + '%';
    if (key === hudCache) return;
    hudCache = key;
    el.score.textContent = G.score;
    el.scoreSub.textContent = G.targetHit ? 'MW' : `/ ${fmt(G.map.target)}`;
    el.cCut.textContent = G.cutOff;
    el.cut.classList.toggle('alert', G.cutOff > 0);
    el.cut.setAttribute('aria-label', `${G.cutOff} ${G.cutOff === 1 ? 'generator' : 'generators'} cut off`);
    el.btnFit.hidden = !zoomed;
    el.btnUndo.hidden = !undoStack.length && !(pendingSnap && pendingSnap.ver !== G.gver);
    el.weekLabel.textContent = `Day ${G.week} · ${dayLabel()}`;
    el.cRoads.textContent = G.res.roads;
    el.cRoads.classList.toggle('zero', G.res.roads === 0);
    // upgrade tools only appear once you've picked them up this game
    let shown = 3 + (G.map.hills ? 1 : 0);
    document.querySelectorAll('.tool[data-res]').forEach((b) => {
      const k = b.dataset.res;
      const n = G.res[k];
      const count = b.querySelector('.count');
      count.textContent = n;
      count.classList.toggle('zero', n === 0);
      b.hidden = !(G.owned[k] || n > 0);
      if (!b.hidden) shown++;
    });
    const bridgesLeft = Math.max(0, G.res.bridges - G.bridgesUsed);
    const tunnelsLeft = Math.max(0, G.res.tunnels - G.tunnelsUsed);
    el.cBridges.textContent = bridgesLeft;
    el.cBridges.classList.toggle('zero', bridgesLeft === 0);
    el.cTunnels.textContent = tunnelsLeft;
    el.cTunnels.classList.toggle('zero', tunnelsLeft === 0);
    el.tunnelTool.hidden = !G.map.hills;
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
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
  }
  function flashCount(which) {
    const target = which === 'bridge' ? $('#bridgeTool') : which === 'tunnel' ? $('#tunnelTool') : document.querySelector('.tool[data-tool="road"]');
    target.classList.remove('flash');
    void target.offsetWidth;
    target.classList.add('flash');
  }

  function setTool(t) {
    tool = t;
    motorStart = -1;
    moveFrom = null;
    hudCache = '';
  }

  document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.info === 'bridge') { toast('Sea cables are used automatically. Draw a cable across water.'); return; }
    if (b.dataset.info === 'tunnel') { toast('Underground cables are used automatically. Draw a cable through a hill.'); return; }
    const t = b.dataset.tool;
    const k = b.dataset.res;
    if (k && G.res[k] <= 0) {
      const names = {
        rounds: 'transformers', motors: 'express lines', entrances: 'extra substations',
        dozers: 'excavator uses', moves: 'generator moves', batteries: 'batteries',
      };
      toast(`No ${names[k]} left. You can pick more at the end of the day.`);
      return;
    }
    setTool(t);
    const hints = {
      round: 'Tap a junction to add a transformer.',
      motor: 'Tap where the express line should go in.',
      erase: 'Drag over cables to remove them. You get the tiles back.',
      entrance: 'Tap a town to add another substation.',
      dozer: 'Tap a hill or water tile to turn it into land.',
      move: 'Tap a generator, then tap where it should go.',
      battery: 'Tap a solar or wind generator to keep it running day and night.',
    };
    if (hints[t]) toast(hints[t]);
  }));

  el.btnPause.addEventListener('click', () => { if (!G) return; G.paused = !G.paused; hudCache = ''; if (G.paused) toast('Paused. You can still draw cables.'); });
  el.btnSpeed.addEventListener('click', () => { if (!G) return; G.speed = G.speed === 1 ? 2 : 1; hudCache = ''; });
  $('#btnMenu').addEventListener('click', () => { if (!G) return; save(); openScreen('sMenu'); });
  $('#btnResume').addEventListener('click', () => closeScreen());
  $('#btnRestart').addEventListener('click', () => { closeScreen(); startNew(G.map); });
  $('#btnMenuMaps').addEventListener('click', () => { save(); showMaps('sMenu'); });
  el.btnFit.addEventListener('click', () => { user.zoom = 1; user.px = 0; user.py = 0; hudCache = ''; });
  el.btnUndo.addEventListener('click', () => { if (G) undo(); });
  $('#btnShapes').addEventListener('click', () => {
    shapesOn = !shapesOn;
    try { localStorage.setItem(SHAPES_KEY, shapesOn ? '1' : '0'); } catch (e) { /* storage unavailable */ }
    shapesLabel();
  });
  function shapesLabel() { $('#btnShapes').textContent = `Colour shapes: ${shapesOn ? 'on' : 'off'}`; }
  shapesLabel();
  el.cut.addEventListener('click', () => {
    toast(G.cutOff ? `${G.cutOff} ${G.cutOff === 1 ? 'generator has' : 'generators have'} no cable to a town of the same colour. Look for pulsing rings.` : 'Every generator can reach its town.');
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
        ? `Make ${fmt(MAPS[i - 1].target)} MW in ${MAPS[i - 1].name} to unlock`
        : `Target ${fmt(m.target)} MW${best ? ` · Best ${fmt(best)}` : ''}`;
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
  // "what's feeding this building" view.
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
  // When you're zoomed in, a building filling up out of view gets an arrow at
  // the edge of the screen, pulsing in time with the warning sound. Tap it to look.
  let edgeArrows = [];
  function drawEdgeArrows() {
    edgeArrows = [];
    if (!G || G.over || inspect) return;
    const pad = 28;
    const L = pad, R = view.w - view.right - pad, T = view.top + pad, Bt = view.h - view.bottom - pad;
    const cx0 = (L + R) / 2, cy0 = (T + Bt) / 2;
    for (const d of G.dests) {
      const u = urgencyOf(d);
      if (u <= 0) continue;
      const px = sx(d.x + 1), py = sy(d.y + 1);
      if (px > L - pad && px < R + pad && py > T - pad && py < Bt + pad) continue;
      const dx = px - cx0, dy = py - cy0;
      const kx = dx > 0 ? (R - cx0) / dx : dx < 0 ? (L - cx0) / dx : Infinity;
      const ky = dy > 0 ? (Bt - cy0) / dy : dy < 0 ? (T - cy0) / dy : Infinity;
      const k = Math.min(kx, ky);
      const ax = cx0 + dx * k, ay = cy0 + dy * k;
      const phase = (G.time % pulsePeriod(u)) / pulsePeriod(u);
      const col = COLORS[d.color];
      ctx.save();
      ctx.translate(ax, ay);
      ctx.globalAlpha = (1 - phase) * (0.4 + 0.5 * u);
      ctx.strokeStyle = col.fill;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, 16 + phase * 14, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = col.fill;
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
      edgeArrows.push({ x: ax, y: ay, d });
    }
  }
  function lookAt(d) {
    const b = baseCam();
    user.px = d.x + 1 - b.x;
    user.py = d.y + 1 - b.y;
    hudCache = '';
  }

  // ---------------------------------------------------------------- what's feeding a building
  // Tap a building: the game pauses, everything else fades, and the houses and
  // roads that can reach it light up.
  let inspect = null;
  function openInspect(d) {
    const { dist, prev } = dijkstra(d.ports);
    const edges = new Set();
    const served = [], stranded = [];
    for (const h of G.houses) {
      if (h.color !== d.color) continue;
      if (!isFinite(dist[h.i])) { stranded.push(h); continue; }
      served.push(h);
      let n = h.i;
      for (let guard = 0; guard < 400 && prev[n] !== -1 && !d.ports.includes(n); guard++) {
        const m = prev[n];
        const e = G.adj[n].get(m);
        if (e) edges.add(e);
        n = m;
      }
    }
    inspect = { d, edges, served, stranded, wasPaused: G.paused };
    G.paused = true;
    hudCache = '';
    const name = COLORS[d.color].name;
    const onWay = G.cars.filter((c) => c.dest === d && c.leg === 'out' && c.state !== 'home').length;
    const waiting = Math.round(waitingAt(d));
    const stuck = d.late || 0;
    const total = served.length + stranded.length;
    let text = `${served.length} of ${total} ${name} ${total === 1 ? 'generator' : 'generators'} can reach this town, with ${served.length * CARS_PER_HOUSE} pulses between them. ` +
      `${onWay} ${onWay === 1 ? 'pulse is' : 'pulses are'} on the way and ${waiting} ${waiting === 1 ? 'unit of demand is' : 'units of demand are'} waiting` +
      (stuck ? `, ${stuck} of them overloaded. ` : '. ');
    const off = served.filter((h) => !genOnline(h)).length;
    if (!served.length) text += `Connect a ${name} generator to it.`;
    else if (off === served.length) text += 'Every generator feeding it is off right now. Connect a coal generator, or give one a battery.';
    else if (stuck) text += 'Overloaded cables are holding power up. A transformer or another route would help.';
    else if (waiting > 2) text += `It needs more ${name} generators connected to it.`;
    else text += "It's coping fine.";
    if (off && off < served.length) text += ` ${off} of its generators ${off === 1 ? 'is' : 'are'} off right now.`;
    if (stranded.length && served.length) text += ` ${stranded.length} ${name} ${stranded.length === 1 ? 'generator has' : 'generators have'} no cable to it yet.`;
    coach(text, 'Carry on', closeInspect);
    if (tut && tut.cur && tut.cur.id === 'busy') tut.inspected = true;
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
    const s = cam.s;
    const { d, edges, served, stranded } = inspect;
    const col = COLORS[d.color];
    ctx.fillStyle = 'rgba(24,25,30,0.55)';
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = s * 0.62;
    ctx.beginPath();
    for (const e of edges) { ctx.moveTo(sx(tx(e.a) + 0.5), sy(ty(e.a) + 0.5)); ctx.lineTo(sx(tx(e.b) + 0.5), sy(ty(e.b) + 0.5)); }
    ctx.stroke();
    ctx.strokeStyle = col.fill;
    ctx.lineWidth = s * 0.46;
    ctx.stroke();
    for (const e of edges) {
      if (!(e.jam > 0.06)) continue;
      ctx.strokeStyle = `rgba(226,74,40,${Math.min(0.9, e.jam).toFixed(3)})`;
      ctx.beginPath(); ctx.moveTo(sx(tx(e.a) + 0.5), sy(ty(e.a) + 0.5)); ctx.lineTo(sx(tx(e.b) + 0.5), sy(ty(e.b) + 0.5)); ctx.stroke();
    }
    drawDest(d);
    for (const h of served) drawHouse(h);
    ctx.setLineDash([s * 0.18, s * 0.14]);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1.5, s * 0.07);
    for (const h of stranded) {
      drawHouse(h);
      ctx.beginPath(); ctx.arc(sx(tx(h.i) + 0.5), sy(ty(h.i) + 0.5), s * 0.62, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // ---------------------------------------------------------------- first game tips
  // The first time you play Millbrook, tips appear one at a time as each idea
  // comes up, instead of everything at once before you've played.
  const TUT_KEY = 'livewire-tutorial-done';
  let tut = null;
  const busiest = () => G.dests.reduce((a, d) => (!a || urgencyOf(d) > urgencyOf(a) ? d : a), null);
  const TIPS = [
    {
      id: 'road', pause: true,
      text: 'Drag a cable from a generator to the round bolt next to the town.',
      ready: () => G.time > 0.8,
      until: () => G.houses.some((h) => !h.cut),
      hl: () => {
        const d = G.dests[0];
        const h = G.houses.find((x) => x.cut);
        const out = [];
        if (h) out.push({ x: tx(h.i) + 0.5, y: ty(h.i) + 0.5, r: 0.7 });
        if (d) out.push({ x: tx(d.ports[0]) + 0.5, y: ty(d.ports[0]) + 0.5, r: 0.7 });
        return out;
      },
    },
    {
      id: 'more', btn: 'Got it',
      text: 'Power is flowing. Each generator holds two pulses, the white dots on it. A pulse carries power to the town, then goes back empty to recharge. The more generators a town has, the faster it gets power. Connect the others too.',
      ready: (done) => done.has('road'),
      until: () => G.cutOff === 0 && G.houses.length > 3,
    },
    {
      id: 'bridge', btn: 'Got it',
      text: 'This generator can’t be reached over land. Draw straight across the water and a sea cable is built for you. The toolbar shows how many you have left.',
      ready: (done) => done.has('more') && G.bridgesUsed === 0 && G.houses.some((h) => h.cut && G.time - h.born > 10),
      until: () => G.bridgesUsed > 0,
    },
    {
      id: 'busy', pause: true,
      text: 'The rings round this town mean it’s waiting for power. Tap it to see what feeds it.',
      ready: (done) => done.has('more') && G.dests.some((d) => urgencyOf(d) > 0),
      until: () => tut.inspected && !inspect,
      hl: () => { const d = busiest(); return d ? [{ x: d.x + 1, y: d.y + 1, r: 1.7 }] : []; },
    },
    {
      id: 'jam', pause: true, btn: 'Got it',
      text: 'Cables turn amber, then red, when they carry too much. Pulses stuck on them still count as waiting. A transformer or a second route helps. You pick an upgrade at the end of each day.',
      ready: (done) => done.has('more') && [...G.edges.values()].some((e) => e.jam > 0.5),
    },
    {
      id: 'end', btn: 'Play on',
      get text() { return `Reach ${fmt(G.map.target)} MW to unlock the next map. The tips are under How to play in the menu.`; },
      ready: (done) => done.has('more') && ((done.has('busy') && done.has('jam')) || G.week >= 5),
    },
  ];
  // One-off cards the first time each new mechanic shows up, on any map.
  let mechCur = null;
  let mechSeen = {};
  try { mechSeen = JSON.parse(localStorage.getItem('livewire-mech') || '{}'); } catch (e) { /* storage unavailable */ }
  function mechTip(id, text) {
    if (mechSeen[id] || mechCur || inspect || modal || (tut && (tut.cur || !tut.done.has('more')))) return false;
    mechSeen[id] = 1;
    try { localStorage.setItem('livewire-mech', JSON.stringify(mechSeen)); } catch (e) { /* storage unavailable */ }
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
    ctx.strokeStyle = '#24262c';
    ctx.lineWidth = Math.max(2, s * 0.09);
    for (const p of tut.cur.hl()) {
      ctx.globalAlpha = 0.45 + 0.45 * pulse;
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
  // gentle rain. When a building fills up, a low pulse fades in from its
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
      const feedback = ctx.createGain();
      feedback.gain.value = 0.35;
      const wet = ctx.createGain();
      wet.gain.value = 0.45;
      echo.connect(feedback); feedback.connect(echo); echo.connect(wet); wet.connect(snd.tone);
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
  function playStep(t, step) {
    const off = step % 2 === 1;
    const beat = (step >> 1) % 4;
    const chord = CHORDS[(step >> 3) % 4];
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

  // Grid sound effects: a zap when a breaker trips, a rising chime on reset,
  // and soft tones as the sun sets and rises.
  function sfx(kind) {
    if (!soundOn || !snd.ctx || snd.ctx.state !== 'running' || !snd.master) return;
    const t = snd.ctx.currentTime + 0.02;
    const out = snd.master;
    if (kind === 'trip') {
      noiseHit(t, 'highpass', 2500, 0.22, 0.18, out);
      const o = snd.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(520, t);
      o.frequency.exponentialRampToValueAtTime(70, t + 0.35);
      const g = snd.ctx.createGain();
      g.gain.setValueAtTime(0.09, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + 0.45);
    } else if (kind === 'reset') {
      voice('sine', hz(60), t, 0.35, 0.09, 0.01, out);
      voice('sine', hz(67), t + 0.09, 0.5, 0.09, 0.01, out);
    } else if (kind === 'dusk') {
      voice('sine', hz(72), t, 0.9, 0.06, 0.05, out);
      voice('sine', hz(65), t + 0.25, 1.2, 0.06, 0.05, out);
    } else if (kind === 'dawn') {
      voice('sine', hz(65), t, 0.9, 0.06, 0.05, out);
      voice('sine', hz(72), t + 0.25, 1.2, 0.06, 0.05, out);
    }
  }

  // A soft low thump and a chime, panned towards the building that's filling up.
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
      // past the limit: a second, higher chime, and the music dips so it cuts through
      voice('sine', hz(chord[0] + 31), t + 0.09, 0.6, 0.02 + 0.06 * u, 0.01, out);
      snd.music.gain.setTargetAtTime(0.7, t, 0.03);
      snd.music.gain.setTargetAtTime(1, t + 0.25, 0.3);
    }
    // close to failing: the thump doubles up like a heartbeat
    if (u >= 0.7) kick(t + 0.2, 0.3 * u, out);
  }

  function audioTick() {
    const ctx = snd.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const live = G && !G.over && !modal && !G.paused;
    snd.master.gain.setTargetAtTime(!soundOn ? 0 : live ? 0.55 : 0.22, now, 0.4);
    if (snd.next < now) snd.next = now + 0.05;
    while (snd.next < now + 0.25) {
      playStep(snd.next, snd.step);
      snd.step = (snd.step + 1) % 32;
      snd.next += BEAT / 2;
    }
    // How urgent is the fullest building? Starts once 3 visitors are waiting,
    // then climbs with the timer once it's past the limit.
    let u = 0, pan = 0;
    if (live) {
      for (const d of G.dests) {
        const v = urgencyOf(d);
        if (v > u) { u = v; pan = clamp((sx(d.x + 1) / view.w) * 2 - 1, -1, 1) * 0.6; }
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
    updateCamera(dt);
    render();
    updateHud();
    tutTick();
    audioTick();
    requestAnimationFrame(frame);
  }

  measure();
  // Show a live map behind the title screen.
  newGame(MAPS[0]);
  G.demo = true;
  showTitle();
  requestAnimationFrame(frame);

  // exposed for testing in the browser console
  window.__livewire = { get G() { return G; }, get tut() { return tut; }, get inspect() { return inspect; }, tutTick, openInspect, closeInspect, render, snd, audioStart, audioTick, landAreas, cam, step, tryConnect, idx, findPath, save, load, sx, sy, MAPS, user, startNew, getProgress, addEntrance, bulldoze, moveHouse, canGo, nodeFor, deck, showUpgrade, dispatch };
})();
