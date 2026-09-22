# Fortress worker

The only process that talks to the game. It installs `src/dfhack/fortress-snapshot.lua` into the game's `dfhack-config/` folder, asks DFHack to write a dump of the loaded fortress on a timer, stores the result in Postgres, and imports any `*-legends.xml` exports it finds next to the game.

```bash
bun run dev:worker   # from the repo root
```

Configuration lives in `.env` (see `.env.example`): game folder, DFHack host and port, and the poll intervals.

## Extracting sprites

```bash
bun run assets:extract   # from apps/worker
```

`src/scripts/extract-assets.ts` copies every sprite sheet (creatures incl. dwarves, items, map tiles, buildings, plants, interface art, classic tilesets) from the local game install into `apps/web/public/df-assets/` and writes an `index.json` that maps sheet names, named tiles, creature states, and item subtypes (weapons, armour, tools) to pixel coordinates. The game stores all of this as plain PNGs plus text raws under `data/vanilla/*/graphics/`, so it is a copy-and-parse job — no unpacking.

Civilized races (dwarves, humans, elves, goblins, kobolds, animal people) are not single sprites in the game but *layer sets*: body parts, hair, beards, clothes, and weapons picked by conditions on caste, skin and hair colour, hair length and styling, worn items and their materials, profession, curses, missing body parts, and face shape, then recoloured through palette PNGs. The extractor exports those rules verbatim to `df-assets/layers/<CREATURE>.json` (including the 96px portraits and the global colour palette), and the dump script records per unit everything the conditions read (`look` column: tissues, appearance modifiers, body parts, worn items, profession category, syndromes). The web app evaluates the rules for each unit and composites the result on a canvas, so a dwarf looks the way the game draws it.

The output folder is **gitignored on purpose**: the sprites are Kitfox/Bay 12 property and stay local. Anyone cloning the repo re-runs the script against their own copy of the game.
