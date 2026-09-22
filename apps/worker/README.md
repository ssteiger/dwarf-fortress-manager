# Fortress worker

The only process that talks to the game. It installs `src/dfhack/fortress-snapshot.lua` into the game's `dfhack-config/` folder, asks DFHack to write a dump of the loaded fortress on a timer, stores the result in Postgres, and imports any `*-legends.xml` exports it finds next to the game.

```bash
bun run dev:worker   # from the repo root
```

Configuration lives in `.env` (see `.env.example`): game folder, DFHack host and port, and the poll intervals.
