# TableForge for Foundry VTT — SPEC

A port of the TableForge session-prep app (donor: `Jondude1/TableForge-web`,
TypeScript PWA) to a Foundry VTT **v13** module. Scope per the 2026-11-13
brief: port everything that can work in Foundry; exclude only what genuinely
can't, with reasons (below).

## Ported features

| Donor feature | Module form |
|---|---|
| **Forge** generators (NPC, Event, Location, Dungeon room, Magic item, Story beat) | Forge tab. Same card model `{title, body, tags}`, same system prompt + per-type shapes, same vibe chips, pin-keepers / regenerate-rest / reroll-one mechanics, card counts 1/3/4/6/8 (default 4), "flesh out" named-idea flow (1–3 versions). |
| **Tables** (random tables d4–d100) | Tables tab. Same table math as the donor (`tablemath.ts`): contiguous even ranges over 1..sides, d100 displayed with 100 as "00", default entry count = sides except d100 → 20. Entries editable as one-per-line text; generated entries via AI or the offline name-theme pools. Roll log (world setting, newest first, capped at 100) and dice tray d4/d6/d8/d10/d12/d20/d100. Native RollTable export on demand. |
| **Story** outline | Story tab. Campaign note (name/premise/setting/tone) is the context block every prompt uses — ported from the donor's `describe(ctx)`. Beats grouped by act, statuses Planned / In play / Done, reorder, "suggest next" and "fill gap" (AI or offline). |
| **Ideas** bank | Ideas tab. Forge saves land here automatically; manual entries too. Search / type filter / favorites / unused-only, and send-to: outline (beat), concepts (node), loot (item in the party stash), journal. |
| **Concepts** board | Concepts tab: an SVG board inside the module window — add/drag nodes, labeled directed links, delete cascades edges. Persisted in module world data. |
| **Maps** | Maps tab: square-grid editor (paint 15 donor terrains, place/move features, drag selection, multi-step undo), AI placement requests with an offline size-parsing fallback ("a lighthouse that takes up 4 squares" → 2×2 feature; "make this water" paints the selection), read-aloud/GM notes. **Export** renders the grid to a PNG, uploads it to the world's data, and creates a grid-aligned Foundry **Scene** plus a companion journal with the read-aloud text and feature notes. |
| **Loot** | Loot tab: a native-backed view over the world's actors/items — holder, rarity, charges, attunement (3-item limit), and a designated party-stash actor (created on demand). Moving an item copies it to the destination actor and removes it from the source. |
| **AI layer** | Same design as the donor: offline first, Claude API if a key is set, Ollama if a URL is set, graceful fallback to offline on any error. Same prompt shapes and fence-tolerant JSON parsing. |

## Design decisions

- **UI framework**: Foundry v13 `ApplicationV2` + `HandlebarsApplicationMixin`,
  one window, seven tabs. Board/grid interactions (Concepts, Maps) are SVG
  inside the window with pointer events — no dependency on Foundry's canvas.
- **GM-only, three ways**: the launcher and `openTableForge()` refuse
  non-GM users; table/dice-tray rolls are whispered to GM users only; and
  **every created document gets `ownership.default = 0`** (journals, items,
  exported RollTables, exported Scenes, the stash actor). The module is a
  prep tool in worlds where the host may be a player.
- **NPC → JournalEntry, not Actor.** Actor creation is game-system-specific
  (stat schemas differ per system); a journal page with the NPC's labeled
  fields is system-agnostic and robust. Magic items → **Item** (type picked
  from the running system's item types, preferring equipment/loot-like types;
  the full card text always lives in `flags.tableforge.body`, with a
  best-effort write to `system.description.value`). Events, locations, rooms
  and beats → JournalEntry. All go into a "TableForge" folder.
- **User tables live in a world setting, not documents.** The module's table
  model (even ranges recomputed on save, one-per-line editing, d100 "00"
  label) doesn't map 1:1 onto native RollTable results; storing JSON in a
  world setting keeps the donor's exact behavior and survives re-renders.
  Native RollTable export is offered per table for anyone who wants Foundry's
  own roller. Beats, ideas, concepts, maps, campaign and the roll log are
  likewise world settings (structured, module-managed data; the GM-gated UI
  is the access control, and settings never render for players).
- **Loot is a view, never a second store.** It reads native actors/items.
  Attunement is tracked in `flags.tableforge.attuned` (module-owned, works in
  any system); if the dnd5e `system.attunement` field is present it is
  honored as the source of truth for display state. Charges read
  `system.uses`/`system.quantity` when present, else flags. *Simplification:*
  item "move" is copy-then-delete between actors (Foundry's model for
  cross-actor transfer); container nesting is not specially handled.
- **AI layer is thin.** One `aiComplete(system, user)` function: Anthropic
  Messages API when a key is set (client-scoped setting — stored on the GM's
  own machine, never in world data), else Ollama `/api/chat` with
  `format: "json"` when a URL is set, else an error that callers catch to
  fall back offline. Claude model defaults to `claude-sonnet-4-5`
  (configurable); Ollama model defaults to `llama3.1`.
- **Maps undo** is a snapshot stack (donor had single-step undo; the stack
  is a strict improvement with the same model).
- **Scene export grid**: scene grid size is fixed at 100 px/square and the
  rendered image is exactly `cols*100 × rows*100`, so the background aligns
  with Foundry's grid; distance/units come from the map's feet-per-square.

## Deliberately excluded (with reasons)

- **Nostr sync** — the Foundry world *is* the shared, authoritative state;
  there is no second device to sync with. Sync has no object here.
- **PWA / app shell** (install prompts, offline service worker, standalone
  windowing) — modules have no shell; Foundry provides the runtime.
- **Auto-building native tiles / walls / lighting from map features** —
  unreliable: feature footprints in the donor are loose rectangles with
  free-text descriptions, and auto-generated walls would be wrong often
  enough to mislead at the table. The Scene export ships the rendered map as
  the background; the GM draws walls in Foundry where precision matters.
- **Donor "Monsters" / stat-block tooling** — a faithful port needs
  system-specific Actor schemas; the module is deliberately system-agnostic
  (see NPC → JournalEntry above). Monster ideas still generate fine as
  Forge cards and Ideas.
- **Donor fonts (Cinzel / Crimson Text)** — not bundled; the module uses a
  system serif stack in the donor's palette instead. (Fonts are OFL-licensed
  in the donor; see CREDITS.md.)

## Verification

Headless smoke harness (`tests/smoke.mjs`, Node): exercises the pure logic
libraries — offline Forge cards for all six types, table range/roll math,
dice ranges, beat operations incl. fill-gap insertion, idea filters and
send-to shapes, concepts graph round-trip, map paint/offline edits and the
scene-export payload shape, and the attunement limit. See the release notes
for the run results and for what was *not* verified (no live Foundry
instance was used in this phase).
