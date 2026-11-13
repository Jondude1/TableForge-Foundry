# TableForge for Foundry VTT

A GM's session-prep forge, ported from the TableForge app to a Foundry VTT
**v13** module. One window, seven tools:

- **Forge** — generate NPCs, events, locations, dungeon rooms, magic items and
  story beats. Steer with free text + vibe chips, pin the keepers, regenerate
  the rest, reroll single cards, flesh out an idea you already have. Saving a
  card creates it in the world (journal or item) and files it in the Ideas bank.
- **Tables** — build your own random tables (d4–d100) with manual or generated
  entries, roll on them, keep a roll log, use the quick dice tray, and export
  any table as a native Foundry RollTable.
- **Story** — a campaign note plus a beat outline grouped by act, with
  Planned / In play / Done statuses, "suggest next beats" and "fill the gap".
- **Ideas** — the saved-ideas bank: search, filter, favorite, mark used, and
  send ideas to the outline, the concepts board, the party stash, or a journal.
- **Concepts** — an in-module relationship board: draggable nodes and labeled
  links ("secretly funds", "rivals").
- **Maps** — a square-grid sketch editor (paint terrain, place and move
  features, undo) that understands requests like "a lighthouse that takes up
  4 squares", and exports to a real Foundry **Scene** with a notes journal.
- **Loot** — a party loot sheet over the world's real actors and items:
  rarity, charges, attunement tracking (3-item limit), and a party stash.

## GM-only by design

The window only opens for GM users, table and tray rolls are whispered to
GMs, and **every document the module creates defaults to GM-only ownership**
— journals, items, RollTables, Scenes and the stash actor. It's a prep tool;
players never see its output unless you choose to share it.

## Works offline — AI is optional

Everything runs with **zero keys and zero network** using built-in word
tables and generators. For richer results, open the module settings and add:

- an **Anthropic API key** (stored as a *client* setting on your own machine,
  never in world data), and/or
- an **Ollama** base URL + model for local generation.

If the AI is unreachable or returns junk, TableForge falls back to offline
generation and carries on.

## Install

In Foundry: **Add-on Modules → Install Module**, paste the manifest URL:

```
https://github.com/Jondude1/TableForge-Foundry/releases/latest/download/module.json
```

Then enable **TableForge** in your world and launch it from the token
controls (anvil icon) or `game.modules.get("tableforge").api.open()`.

See [SPEC.md](SPEC.md) for what was ported, what was deliberately left out,
and the design decisions. Attribution in [CREDITS.md](CREDITS.md).
