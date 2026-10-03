# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One player, the owner of this repo, playing Dwarf Fortress with DFHack and keeping this app open on a second monitor or beside the game window. They glance at it between moves in the game, then go back to the game to act on what it said. No other audience is confirmed: not other players running it from the repo, not phones or tablets, not streams or shared screenshots.

## Product Purpose

A companion for a running Dwarf Fortress game. A worker next to the game reads the loaded fortress through DFHack on a timer and stores it in Postgres; the web app turns that into pages a player can use. Success means the player knows what needs attention and how to fix it in the game, knows their dwarves as people, can follow the fortress's story, and can read the world's history, without digging through the game's own screens.

## Positioning

It reads the live game itself (units, items, buildings, jobs, announcements, the map, the legends export) and answers in plain sentences with steps to take in the game. It can also act back on the game, but only through a short, checked whitelist of DFHack commands that the worker carries out; the browser never talks to the game directly.

## Operating Context

- Used during play, next to the game window: glanced at, then acted on in the game.
- The game is read every 30 seconds by default, or only on request. Each read pauses the game while it runs. The refresh button at the top right asks for a read now and follows it step by step.
- The game can be live, on a menu, or offline; pages say which and keep the last read in place.
- ⌘K / Ctrl+K searches pages, dwarves and creatures, items, buildings and zones, chronicle entries and legends records. ⌘J / Ctrl+J opens the "Ask how to…" assistant.
- While the app is open in a tab it raises alerts for deaths, threats, strange moods, births, arrivals and more.
- Everything runs locally: local Supabase, sign-in by emailed code caught by Mailpit.

## Capabilities and Constraints

All five jobs are central:

1. **Running the fortress**: what needs attention and how to fix it in the game. Overview notices, advice with step-by-step guides you can tick off, stores and items, work and workshops.
2. **Getting to know the dwarves**: everyone on the map as cards or a table, and a page per dwarf with overview, mind, skills and body, people, role play, actions and gear tabs. Nickname ideas for the whole fortress.
3. **Following the fortress's story**: the chronicle, how the fortress feels, the story so far, and what changed since the last look.
4. **Reading the world's history in Legends**: world map, chart of the ages, stories, figures and races, an archive of every record and event, a page per record, a private journal, an optional narrator.
5. **Acting on the game**: one-click DFHack fixes in guides (or the exact command to copy when one-click is off), unit actions, cheats behind a confirmation, the assistant's command cards.

Pages: Overview, Dwarves, a dwarf's page, Items and an item's page, Work, Map, Chronicle, Legends (world, history, archive, stories, journal, record pages), Nickname dwarves, Settings, Worker logs, sign in and sign up.

Constraints:

- The sprites and interface art belong to Kitfox and Bay 12. Each user extracts them from their own install into `apps/web/public/df-assets/`, which is gitignored. Until they are extracted the pages show no sprites, so every surface must still work without them.
- The language model is optional. Without it every page keeps to its own deterministic prose. Neither the app nor the model may state anything beyond the dump, the chronicle or the legends export.
- Stack: TanStack Start (React 19), Tailwind v4, shadcn/ui owned in `packages/ui`, lucide-react, sonner.
- Existing settings: theme (light, dark, system), text size, reduced motion, walking dwarves on or off. Text size and reduced motion were not named as binding, but they exist and work.

## Brand Commitments

- The name **Dwarf Fortress Manager**.
- The game's own sprites, drawn the way the game draws them (dwarves composited from the game's layer rules).
- The walking dwarves along the bottom of the window, which the cursor can knock over and Settings can turn off.
- Both a light and a dark theme.
- The voice: plain language, full sentences, no jargon, and the game's own words where they exist (a need runs from "unfettered" to "badly distracted"). For example: "Nothing needs you right now. The fortress runs itself for a while." and "Open one for the steps in the game."

## Evidence on Hand

- Real data from the owner's own fortress and world in the local database, for example the world Ngutegoram, "The Cyclopean World", 2,000 years of history in 416,175 records.
- Extracted game art in `apps/web/public/df-assets/`: creatures, items, buildings, environment, interface, world map, art. Local only, not redistributable.
- README screenshots of an older look: `apps/web/public/screenshot-1.jpg`, `apps/web/public/screenshot-2.jpg`.
- No other users, testimonials or public deployment exist. Do not invent them.

## Product Principles

1. The game is where things happen; the app says what to do there, in steps a player can follow.
2. Glanceable during play: the urgent thing first, detail on demand.
3. Every statement comes from the game's own data; nothing is invented.
4. Dwarves are people with names and stories, not rows.
5. Acting on the game is deliberate: checked, confirmed where it is not safe to repeat, and visible while it runs.
