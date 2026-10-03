# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One player, the owner of this repo, playing Dwarf Fortress with DFHack. They keep the app open beside the game while playing, and also open it on its own, away from the game, to read about their fortress and their world. No other audience is confirmed: not other players running it from the repo, not phones or tablets, not streams or shared screenshots.

## Product Purpose

A companion for a running Dwarf Fortress game with two halves that matter equally. One half makes the dwarves feel like people and the fortress and its world feel like a story worth following. The other helps keep the fortress alive, so the story can go on. If only one could be done really well, it would be the story.

A worker next to the game reads the loaded fortress through DFHack on a timer and stores it in Postgres; the web app turns that into pages a player can use.

Success means the player knows their dwarves by name and cares what happens to them, can follow what happened in the fortress and the world without digging through the game's own screens, and knows what needs attention and how to fix it in the game.

## Positioning

It reads the live game itself (units, items, buildings, jobs, announcements, the map, the legends export) and turns it into people and a story: who each dwarf is and what they are going through, what happened since the last look, and the world's long history. Alongside that it answers in plain sentences with steps to take in the game. It can also act back on the game, but only through a short, checked whitelist of DFHack commands that the worker carries out; the browser never talks to the game directly.

## Operating Context

The app is opened at five kinds of moments, all of them real:

- **While playing**, on a second screen beside the game: glanced at between moves, then acted on in the game.
- **With the game paused**, to dig into a problem or a dwarf.
- **When something goes wrong** (an alert, a death, a tantrum), to understand why it happened.
- **Before or between sessions**, to plan what to do next.
- **Away from the game**, to read the fortress's story or the world's history for its own sake.

Coming back after time away, the app first gives a short mix, in this order: what happened since the last look, told as a story; then the dwarves who are struggling; then anything that needs attention to keep the fortress alive.

How it runs:

- The game is read every 30 seconds by default, or only on request. Each read pauses the game while it runs. The refresh button at the top right asks for a read now and follows it step by step.
- The game can be live, on a menu, or offline; pages say which and keep the last read in place.
- ⌘K / Ctrl+K searches pages, dwarves and creatures, items, buildings and zones, chronicle entries and legends records. ⌘J / Ctrl+J opens the "Ask how to…" assistant.
- While the app is open in a tab it raises alerts for deaths, threats, strange moods, births, arrivals and more.
- Everything runs locally: local Supabase, sign-in by emailed code caught by Mailpit.

## Capabilities and Constraints

The two halves, equal in weight:

**The story**

1. **Getting to know the dwarves**: everyone on the map as cards or a table, and a page per dwarf with overview, mind, skills and body, people, role play, actions and gear tabs. Nicknames for the whole fortress, built on what only each dwarf has done, eaten, lost or loved, carried on through family and successors, drawn from the player's own list of favourite names too, with the reason behind each name kept on the dwarf's page.
2. **Following the fortress's story**: the chronicle, how the fortress feels, the story so far, and what changed since the last look.
3. **Reading the world's history in Legends**: world map, chart of the ages, stories, figures and races, an archive of every record and event, a page per record, a private journal, an optional narrator.

**Running the fortress**

4. **Keeping it alive**: what needs attention and how to fix it in the game. Overview notices, advice with step-by-step guides you can tick off, stores and items, work and workshops.
5. **Acting on the game**: one-click DFHack fixes in guides (or the exact command to copy when one-click is off), unit actions, cheats behind a confirmation, the assistant's command cards.

Pages: Overview, Dwarves, a dwarf's page, Items and an item's page, Work, Map, Chronicle, Legends (world, history, archive, stories, journal, record pages), Nickname dwarves, Settings, Worker logs, sign in and sign up.

Constraints:

- The sprites and interface art belong to Kitfox and Bay 12. Each user extracts them from their own install into `apps/web/public/df-assets/`, which is gitignored. Until they are extracted the pages show no sprites, so every surface must still work without them.
- The language model is optional. Without it every page keeps to its own deterministic prose.
- Facts come only from the dump, the chronicle or the legends export; neither the app nor the model may state anything else as what happened. The one exception is role play: a dwarf's own voice on the Role play tab (monologue, diary, tavern gossip, biography, conversation) may invent freely, as long as it is clearly marked as fiction.
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
- README screenshots of the current look, light theme, from the owner's own fortress Fluffleduffmoonshine: search over the overview (`apps/web/public/screenshot-search.jpg`), the work checklist (`screenshot-work.jpg`), the assistant answering a question (`screenshot-assistant.jpg`) and the legends overview for Ngutegoram (`screenshot-legends.jpg`).
- No other users, testimonials or public deployment exist. Do not invent them.

## Product Principles

1. The story is what the app does best. Dwarves are people with names, wants and histories, not rows; the fortress and the world are a story worth following.
2. Keeping the fortress alive matters just as much. The game is where things happen; the app says what needs attention and what to do there, in steps a player can follow.
3. Glanceable during play: the urgent thing first, detail on demand.
4. What happened comes from the game's own data and is never invented. Role play may invent, and always says so.
5. Acting on the game is deliberate: checked, confirmed where it is not safe to repeat, and visible while it runs.
