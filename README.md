# Livewire

Build a power grid and keep every town's lights on. Place power stations, run cables, and keep the grid standing as towns grow and the evening peak hits.

**Play:** https://kieranforde1.github.io/livewire/ (works offline once loaded, and can be added to a phone's home screen)

## How it plays

- You choose where power stations go. New ones arrive each day: coal early on, then more solar and wind.
- Power flows through every cable it can reach, all at once, and splits the way current really does. Shorter routes and thicker cables carry more.
- One strand of cable carries 5 MW. Draw along a cable again to add a strand, up to 3.
- A cable that stays overloaded trips its breaker. Its power moves straight onto the other cables, which can trip too, so one weak line can black out a whole area. Tap the gap to reset it.
- Demand is lowest at night and peaks in the evening, just after solar stops. Batteries store spare daytime power for the peak.
- When a grid is short, every town on it dims. A town that goes fully dark ends the game.
- Upgrades: more cable, sea and underground cables, interconnectors (long, strong links over anything), surge guards (stop trips at a joint), batteries and extra coal plants.
- Five maps, each with its own terrain and target.

## Development

No build step: `index.html` and `game.js` are the whole game. Open `index.html` in a browser, or serve the folder.

`tests/bot.js` is a simple player with the same limits as a real one. `node tests/sim.js [days] [runs]` plays every map with it headlessly, reports how far it gets against each target, and checks invariants, save/load and speed (needs `npm i playwright`). You can also load `tests/bot.js` in the browser console and call `livewireRun(mapIndex, days)`.

When shipping an update, bump `VERSION` in `sw.js` so installed copies refresh.
