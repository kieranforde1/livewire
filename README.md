# Livewire

Run cables so every town keeps its lights on. Wire generators to towns of the same colour with a limited supply of cable, and keep the grid standing as demand climbs.

**Play:** https://kieranforde1.github.io/livewire/ (works offline once loaded, and can be added to a phone's home screen)

## How it plays

- Pulses of power travel along your cables from generators to towns. Towns that wait too long black out, and the game ends.
- Demand dips at night and peaks in the evening.
- Coal runs all the time, solar only in daylight, and wind comes and goes. Batteries keep solar and wind running.
- Cables that stay overloaded glow hot and trip their breaker. Tap the gap to reset it. Transformers protect them.
- Each day brings more cable and a choice of upgrades. Five maps, each introducing the mechanics a little sooner.

## Development

No build step: `index.html` and `game.js` are the whole game. Open `index.html` in a browser, or serve the folder.

`node tests/sim.js [days]` plays every map headlessly with a simple bot and checks invariants, save/load and speed (needs `npm i playwright`).

When shipping an update, bump `VERSION` in `sw.js` so installed copies refresh.
